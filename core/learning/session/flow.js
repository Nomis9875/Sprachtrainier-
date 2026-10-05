/**
 * Übungsablauf einer Session: Warteschlange, erledigte Übungen, adaptive Umplanung.
 *
 * Reine Funktion aus (gestarteter Plan, Ersatzübungen, Versuche der Session). Keine
 * Speicherung, kein Zufall: Dieselben Ereignisse ergeben denselben Ablauf. Die
 * Ersatzübungen stammen aus dem session_started-Ereignis, nicht aus den aktuellen Inhalten,
 * damit eine Session auch nach einem Inhalts-Update gleich rekonstruiert wird.
 *
 * ─── Adaptive Regeln (bewusst einfach, nur Infrastruktur) ─────────────────────
 *
 *   retry     Ein Fokus-Skill ist in dieser Session ≥ 2-mal gescheitert
 *             → er erscheint am Ende der Session noch einmal (einmal pro Skill).
 *             Gewählt wird eine noch nicht gemachte Ersatzübung, möglichst auf der
 *             Nachweisstufe der gescheiterten oder eine darunter; sonst dieselbe Übung.
 *   step_up   Der Skill einer Übung war erfolgreich und ist in dieser Session noch nie
 *             gescheitert → die nächste geplante Übung für diesen Skill, die nicht
 *             schwerer ist, wird durch eine schwerere Ersatzübung ersetzt (falls vorhanden).
 *
 *   Erfolg/Fehler eines Skills: Regelbeobachtungen aus allen Übungen der Session
 *   (skillSignal) plus das Ergebnis der Übung für ihren geplanten Skill.
 *
 *   Kanal (P15/P16): Ersatz nur im Kanal der auslösenden Übung (Hören bleibt Hören, Schreiben bleibt Schreiben),
 *   auch wenn die Ersatzliste eines Skills beide Kanäle enthält.
 */

import { readEvaluation } from "../../evaluation/result.js";
import { isListening } from "../listening/model.js";
import { exerciseOutcome, reliableObservations, skillSignal } from "./outcome.js";

export const FLOW_RULES = Object.freeze({ retryAfterFailures: 2, maxRetriesPerSkill: 1 });

const LADDER = ["recognized", "controlled", "guided", "free", "spontaneous"];

/**
 * @param {{plan: object, alternatives: Object<string, object[]>, attempts: object[]}} input
 *   attempts: attempt-Ereignisse dieser Session, chronologisch
 */
export function runFlow({ plan, alternatives, attempts }) {
  const focus = new Set(plan.focus_skills.map((f) => f.skill_id));
  const queue = plan.exercises.map((e) => ({ ...e, origin: "plan" }));
  const completed = [];
  const adaptations = [];
  const anomalies = [];
  const tally = new Map(); // skill → {successes, failures}
  const retries = new Map();

  for (const attempt of attempts) {
    const exerciseId = attempt.payload.exercise_id;
    const index = queue.findIndex((q) => q.exercise_id === exerciseId);
    if (index < 0) {
      anomalies.push({ at: attempt.created_at, event_id: attempt.id, problem: `Übung ${exerciseId} steht nicht (mehr) in der Session` });
      continue;
    }
    const [item] = queue.splice(index, 1);
    const outcome = exerciseOutcome(attempt.payload.evaluation, item.skill_id);
    completed.push({ ...item, attempt_id: attempt.id, at: attempt.created_at, outcome: withoutEvaluation(outcome) });
    countSignals(tally, attempt.payload.evaluation, item.skill_id, outcome);

    const skill = item.skill_id;
    const done = new Set([...completed.map((c) => c.exercise_id)]);
    const queued = new Set(queue.map((q) => q.exercise_id));
    const counts = tally.get(skill) ?? { successes: 0, failures: 0 };
    const options = (alternatives[skill] ?? []).filter((o) => isListening(o) === isListening(item));

    if (focus.has(skill) && counts.failures >= FLOW_RULES.retryAfterFailures
      && (retries.get(skill) ?? 0) < FLOW_RULES.maxRetriesPerSkill) {
      const choice = retryExercise(options, item, done, queued);
      queue.push({ ...choice, skill_id: skill, origin: "retry", reason: retryReason(skill, counts, choice, item) });
      retries.set(skill, (retries.get(skill) ?? 0) + 1);
      adaptations.push({
        type: "retry", skill_id: skill, exercise_id: choice.exercise_id, after_attempt_id: attempt.id,
        reason: retryReason(skill, counts, choice, item),
      });
    } else if (outcome.target === "success" && counts.failures === 0) {
      const next = queue.findIndex((q) => q.skill_id === skill && rank(q.evidence) <= rank(item.evidence));
      const harder = next >= 0 ? harderExercise(options, item, done, queued) : null;
      if (harder) {
        const replaced = queue[next];
        const reason = `${skill} in '${item.exercise_id}' (Stufe '${item.evidence}') gelungen: `
          + `'${replaced.exercise_id}' (Stufe '${replaced.evidence}') wird durch '${harder.exercise_id}' (Stufe '${harder.evidence}') ersetzt`;
        queue[next] = { ...harder, skill_id: skill, origin: "step_up", reason };
        adaptations.push({
          type: "step_up", skill_id: skill, exercise_id: harder.exercise_id, replaces: replaced.exercise_id,
          after_attempt_id: attempt.id, reason,
        });
      }
    }
  }

  return { queue, completed, adaptations, anomalies, skills: Object.fromEntries([...tally].sort()) };
}

function countSignals(tally, evaluation, plannedSkill, outcome) {
  const view = readEvaluation(evaluation);
  const skills = new Set(reliableObservations(view).map((o) => o.skill_id));
  for (const f of view.findings) if (f.authoritative && f.skill_id) skills.add(f.skill_id);
  if (plannedSkill) skills.add(plannedSkill);
  for (const skill of skills) {
    const signal = skill === plannedSkill ? outcome.target : skillSignal(evaluation, skill);
    if (!signal) continue;
    const entry = tally.get(skill) ?? { successes: 0, failures: 0 };
    entry[signal === "success" ? "successes" : "failures"] += 1;
    tally.set(skill, entry);
  }
}

/** Noch nicht gemachte Ersatzübung auf derselben Stufe oder leichter; sonst dieselbe Übung erneut. */
function retryExercise(options, failed, done, queued) {
  const candidates = options
    .filter((o) => !done.has(o.exercise_id) && !queued.has(o.exercise_id) && rank(o.evidence) <= rank(failed.evidence))
    .sort((a, b) => rank(b.evidence) - rank(a.evidence) || a.estimated_seconds - b.estimated_seconds || cmp(a.exercise_id, b.exercise_id));
  const pick = candidates[0] ?? failed;
  return { exercise_id: pick.exercise_id, type: pick.type, evidence: pick.evidence, estimated_seconds: pick.estimated_seconds };
}

/** Die nächstschwerere, noch nicht gemachte Ersatzübung. */
function harderExercise(options, succeeded, done, queued) {
  const candidates = options
    .filter((o) => !done.has(o.exercise_id) && !queued.has(o.exercise_id) && rank(o.evidence) > rank(succeeded.evidence))
    .sort((a, b) => rank(a.evidence) - rank(b.evidence) || a.estimated_seconds - b.estimated_seconds || cmp(a.exercise_id, b.exercise_id));
  const pick = candidates[0];
  return pick ? { exercise_id: pick.exercise_id, type: pick.type, evidence: pick.evidence, estimated_seconds: pick.estimated_seconds } : null;
}

function retryReason(skill, counts, choice, failed) {
  const how = choice.exercise_id === failed.exercise_id ? `dieselbe Übung '${choice.exercise_id}'` : `'${choice.exercise_id}' (Stufe '${choice.evidence}')`;
  return `${skill} ist in dieser Session ${counts.failures}× gescheitert: später noch einmal mit ${how}`;
}

function withoutEvaluation({ evaluation, ...rest }) {
  return rest;
}

function rank(level) {
  return LADDER.indexOf(level);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
