/**
 * Validierung des Learning Brain: einen Lernverlauf BEOBACHTEN, nicht beeinflussen.
 *
 *   Ereignisse + Stichtag ─buildLearnerBrain + planSession─▶ learnerStateReport()   Zustand zu einem Zeitpunkt
 *   Zustand vorher / nachher ──────────────────────────────▶ compareLearnerStates() was hat sich geändert?
 *   Ereignisse + Stichtage ────────────────────────────────▶ traceLearningJourney() Verlauf über die Zeit
 *   Verlauf ───────────────────────────────────────────────▶ renderJourneyText()   für Menschen lesbar
 *
 * Keine eigene Lernlogik: Alles kommt aus dem bestehenden Learning Brain (Profil, Gedächtnis, Lernbedarfe)
 * und dem bestehenden Planner. Dieselben Funktionen dienen der Simulation (Tests, Validierungsbericht) und
 * der Analyse echter Lernereignisse (Entwicklersicht). Rein, deterministisch, browserfähig.
 */

import { planSession } from "../planning/planner.js";
import { buildLearnerBrain } from "./brain.js";

export const LEARNER_STATE_REPORT_VERSION = 1;
const PROBLEM_STATUSES = new Set(["unsure"]);
const PROBLEM_ERRORS = new Set(["recurring", "persistent"]);
const OPEN = new Set(["candidate", "active", "weakening"]);

/**
 * Zustand des Lerners zu einem Stichtag, wie ihn das Learning Brain sieht, und die Session, die es planen würde.
 * @param {{events: object[], userId: string, asOf: Date, library: object, minutes?: number, topNeeds?: number}} input
 */
export function learnerStateReport({ events, userId, asOf, library, minutes = 15, topNeeds = 8 }) {
  const brain = buildLearnerBrain({ events, userId, asOf, library });
  const plan = planSession({
    library, snapshot: brain.snapshot, reviews: brain.reviews, memories: brain.memories, events, minutes,
  });
  const observed = brain.profile.skills.filter((s) => s.status !== "new");
  const skill = (s) => ({
    skill_id: s.skill_id, label: s.label, status: s.status, error_state: s.error_state, mastery: s.competence.mastery,
    highest_evidence: s.competence.highest_evidence, secure_evidence: s.competence.secure_evidence,
    successes: s.stats.successes, failures: s.stats.failures,
  });
  return {
    version: LEARNER_STATE_REPORT_VERSION,
    as_of: brain.snapshot.generated_at,
    event_count: brain.snapshot.metadata.event_count,
    skills: Object.fromEntries(observed.map((s) => [s.skill_id, skill(s)])),
    problematic: observed.filter((s) => PROBLEM_STATUSES.has(s.status) || PROBLEM_ERRORS.has(s.error_state)).map(skill),
    stable: observed.filter((s) => s.status === "stable" || s.status === "mastered").map(skill),
    memories: brain.memories.filter((m) => m.memory_type !== "note").map((m) => ({
      memory_id: m.memory_id, memory_type: m.memory_type, skill_id: m.skill_id, status: m.status,
      importance: m.importance, sources: m.source_event_ids.length,
    })),
    open_memories: brain.memories.filter((m) => OPEN.has(m.status)).map((m) => m.memory_id),
    needs: brain.needs.slice(0, topNeeds).map((n) => ({
      skill_id: n.skill_id, label: n.label, priority: n.priority, reason_code: n.reason_code, purpose: n.purpose,
      error_state: n.error_state, target_evidence: n.target_evidence, factors: n.priority_factors,
    })),
    plan: {
      minutes,
      objective: plan.objective.id,
      exercises: plan.exercises.map((e) => ({
        exercise_id: e.exercise_id, skill_id: e.skill_id, purpose: e.purpose, role: e.role, evidence: e.evidence,
        mode: e.mode, reason: e.reason,
      })),
      content_gaps: plan.metadata.content_gaps.map((g) => g.skill_id),
    },
  };
}

/** Was hat sich zwischen zwei Zuständen geändert (Kompetenz, Fehlerlage, Gedächtnis, Priorität)? */
export function compareLearnerStates(before, after) {
  const competence = [];
  for (const [id, now] of Object.entries(after.skills)) {
    const was = before?.skills[id] ?? null;
    const changes = ["status", "error_state", "mastery", "highest_evidence"]
      .filter((key) => (was?.[key] ?? null) !== now[key])
      .map((key) => ({ key, from: was?.[key] ?? null, to: now[key] }));
    if (changes.length) competence.push({ skill_id: id, label: now.label, changes });
  }
  const memoryOf = (state) => new Map((state?.memories ?? []).map((m) => [m.memory_id, m.status]));
  const was = memoryOf(before);
  const memories = [...memoryOf(after)].filter(([id, status]) => was.get(id) !== status)
    .map(([id, status]) => ({ memory_id: id, from: was.get(id) ?? null, to: status }));
  const priorityOf = (state) => new Map((state?.needs ?? []).map((n) => [n.skill_id, n.priority]));
  const previous = priorityOf(before);
  const priorities = [...priorityOf(after)].filter(([id, p]) => previous.get(id) !== p)
    .map(([id, p]) => ({ skill_id: id, from: previous.get(id) ?? null, to: p }));
  return { competence, memories, priorities };
}

/**
 * Verlauf: Zustand an jedem Stichtag, dazu die Änderungen gegenüber dem vorigen.
 * @param {{events: object[], userId: string, library: object, checkpoints: {label: string, asOf: Date}[], minutes?: number}} input
 */
export function traceLearningJourney({ events, userId, library, checkpoints, minutes = 15 }) {
  let previous = null;
  return checkpoints.map(({ label, asOf }) => {
    const state = learnerStateReport({ events, userId, asOf, library, minutes });
    const entry = { label, state, changes: compareLearnerStates(previous, state) };
    previous = state;
    return entry;
  });
}

/** Für Menschen lesbar: je Stichtag Probleme, Stabiles, Gedächtnis, Lernbedarfe, gewählte Übungen, Änderungen. */
export function renderJourneyText(trace, { title = "Lernverlauf" } = {}) {
  const lines = [`# ${title}`];
  const short = (id) => id.split(":")[1] ?? id;
  for (const { label, state, changes } of trace) {
    lines.push("", `## ${label} (${state.as_of.slice(0, 10)}, ${state.event_count} Ereignisse)`);
    if (changes.competence.length) {
      lines.push("Kompetenz:", ...changes.competence.map((c) => `  - ${c.label}: ${c.changes.map((x) => `${x.key} ${x.from ?? "–"} → ${x.to}`).join(", ")}`));
    }
    if (changes.memories.length) lines.push("Gedächtnis:", ...changes.memories.map((m) => `  - ${m.memory_id}: ${m.from ?? "–"} → ${m.to}`));
    lines.push(`Problematisch: ${state.problematic.map((s) => `${s.label} (${s.error_state}/${s.status})`).join("; ") || "–"}`);
    lines.push(`Stabil: ${state.stable.map((s) => s.label).join("; ") || "–"}`);
    lines.push(`Offene Erinnerungen: ${state.open_memories.join(", ") || "–"}`);
    lines.push("Lernbedarfe:", ...state.needs.map((n) => `  ${n.priority.toFixed(2)} ${n.label} – ${n.reason_code}, ${n.purpose}, Ziel ${n.target_evidence} | ${n.factors.join(", ")}`));
    lines.push(`Geplante Session (${state.plan.minutes} min, ${state.plan.objective}):`,
      ...state.plan.exercises.map((e, i) => `  ${i + 1}. ${e.exercise_id} → ${short(e.skill_id)} (${e.purpose}, ${e.role}, ${e.evidence})`));
    if (state.plan.content_gaps.length) lines.push(`Inhaltslücken: ${state.plan.content_gaps.map(short).join(", ")}`);
  }
  return lines.join("\n");
}
