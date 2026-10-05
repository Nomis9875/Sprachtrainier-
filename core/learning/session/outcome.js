/**
 * ExerciseOutcome v1: das gemeinsame Ergebnis einer Übung innerhalb einer Session.
 *
 * Wird nie gespeichert, sondern aus dem EvaluationResult des Versuchs abgeleitet
 * (das im attempt-Ereignis steckt). Deterministisch, ohne KI-Einfluss auf das Ergebnis:
 * Es zählen nur autoritative Befunde und Beobachtungen (Regel, Referenz); eine
 * Qwen-Entscheidung senkt nur die Verlässlichkeit.
 *
 *   result       correct            Gesamtergebnis "correct"
 *                partially_correct  Gesamtergebnis "incorrect", aber mindestens ein Skill
 *                                   laut Regel richtig verwendet; oder noch nicht entschieden
 *                incorrect          Gesamtergebnis "incorrect" ohne richtig verwendeten Skill;
 *                                   oder unentschieden, aber mit autoritativem Fehler
 *   confidence   1    entschieden von Referenz/Regel
 *                0.5  entschieden von Qwen, oder unentschieden mit Regelbeobachtungen
 *                0    niemand hat entschieden, keine Beobachtung ("undecided")
 *   target       wie der geplante Skill der Übung abgeschnitten hat:
 *                success | failure | null (nicht beobachtet oder nicht verlässlich)
 *
 * Folgeschichten (adaptiver Ablauf, Zusammenfassung) ignorieren Ergebnisse mit
 * confidence 0.
 *
 * Gelesen wird über readEvaluation() (v1 und v2). Beobachtungen mit Verlässlichkeit "low"
 * zählen nicht: Ein unsicherer Treffer macht eine Antwort nicht "teilweise richtig".
 */

import { readEvaluation } from "../../evaluation/result.js";

export const EXERCISE_OUTCOME_VERSION = 1;
export const EXERCISE_RESULTS = Object.freeze(["correct", "partially_correct", "incorrect"]);

const CONFIDENCE_BY_DECIDER = Object.freeze({ reference: 1, rule: 1, llm: 0.5 });

/**
 * @param {object} evaluation   EvaluationResult (v2, v1 weiterhin lesbar)
 * @param {string|null} skillId geplanter Skill der Übung
 */
export function exerciseOutcome(evaluation, skillId = null) {
  const view = readEvaluation(evaluation);
  const observations = reliableObservations(view);
  const correctSkills = observations.filter((o) => o.outcome === "demonstrated").length;
  const errorSkills = observations.filter((o) => o.outcome === "error").length;
  const blocking = view.findings.some((f) => f.authoritative && (f.severity === "error" || f.severity === "goal"));
  const { outcome, decided_by: decidedBy } = view.overall;

  let result;
  let confidence = CONFIDENCE_BY_DECIDER[decidedBy] ?? 0;
  if (outcome === "correct") {
    result = "correct";
  } else if (outcome === "incorrect") {
    result = correctSkills > 0 ? "partially_correct" : "incorrect";
  } else {
    // needs_review / not_evaluated: nur, was die Regeln schon sicher wissen
    const known = correctSkills + errorSkills > 0 || blocking;
    confidence = known ? 0.5 : 0;
    result = (errorSkills > 0 || blocking) && correctSkills === 0 ? "incorrect" : "partially_correct";
  }

  return {
    version: EXERCISE_OUTCOME_VERSION,
    exercise_id: view.exercise_id,
    skill_id: skillId,
    result,
    confidence,
    decided_by: decidedBy,
    target: targetSignal(evaluation, skillId, result, confidence),
    evaluation,
  };
}

/** Erfolg oder Fehler für einen bestimmten Skill (Regelbeobachtung vor Gesamtergebnis). */
export function skillSignal(evaluation, skillId) {
  const view = readEvaluation(evaluation);
  const observation = reliableObservations(view).find((o) => o.skill_id === skillId);
  const errorFound = view.findings.some((f) => f.authoritative && (f.error_key === skillId || f.skill_id === skillId)
    && (f.severity === "error" || f.severity === "goal"));
  if (observation?.outcome === "error" || errorFound) return "failure";
  if (observation?.outcome === "demonstrated") return "success";
  return null;
}

/** Autoritative Beobachtungen, auf die sich eine Aussage stützen darf (nicht "low"). */
export function reliableObservations(view) {
  return view.observations.filter((o) => o.authoritative && o.reliability !== "low");
}

function targetSignal(evaluation, skillId, result, confidence) {
  if (!skillId) return null;
  const signal = skillSignal(evaluation, skillId);
  if (signal) return signal;
  if (confidence < 1) return null;
  if (result === "correct") return "success";
  if (result === "incorrect") return "failure";
  return null;
}
