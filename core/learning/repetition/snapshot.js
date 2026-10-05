/**
 * ReviewSnapshot v1: Wiederholungsstand aller Skills zu einem Stichtag.
 *
 *   Ereignisse ─collectEvidence─▶ Nachweise ─reviewInputs─▶ Abrufe ─calculateReviewState─▶ Zustand je Skill
 *                                                                    ─describeReviewState(now)─▶ Snapshot
 *
 * Wie der CompetenceSnapshot ist er eine Projektion: nie gespeichert, bei jedem Aufruf aus allen
 * Ereignissen neu berechnet, deterministisch (Duplikate zählen einmal, Reihenfolge egal, Ereignisse
 * nach dem Stichtag zählen nicht). Er ersetzt die Lernhistorie nicht, er fasst sie für die Frage
 * "wann wieder?" zusammen. Dieselben Nachweise speisen das Kompetenzmodell ("wie sicher?").
 *
 * Welche Nachweise sind Abrufe? (reviewInputs)
 *   success (Erfolg, auch "vermieden" bei typischen Fehlern)   → success mit Nachweisstufe und Gewicht
 *   failure (Fehler, Fehlerereignis, Karteikarte "again")       → failure (Lapse)
 *   missed  (verpasste Gelegenheit: die Aufgabe verlangte es)   → miss
 *   alles andere (nicht gezeigt, nicht beobachtbar, "einfach")  → kein Abruf
 *   Qwen-Beobachtungen und unsichere Treffer ("low") zählen nie.
 *   Karteikarte "hard" zählt als schwacher Erfolg (halbes Gewicht).
 */

import { isSkillId } from "../../content/skills.js";
import { toUtcIso } from "../../util/time.js";
import { collectEvidence } from "../competence/projection.js";
import {
  DUE_STATUSES, REVIEW_PHASES, REVIEW_RULES, calculateReviewState, describeReviewState, newReviewState,
} from "./model.js";

export const REVIEW_SNAPSHOT_FORMAT = "review_snapshot";
export const REVIEW_SNAPSHOT_VERSION = 1;
const HISTORY_LIMIT = 10;

/**
 * @param {{events: object[], userId: string, asOf: Date, skillIds?: string[]}} input
 *   skillIds: Skill-Katalog; Skills ohne Abruf erscheinen als "new"
 */
export function buildReviewSnapshot({ events, userId, asOf, skillIds = [] }) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError("asOf: gültiges Datum erwartet");
  if (!Array.isArray(events)) throw new TypeError("events: Liste erwartet");
  const cutoff = toUtcIso(asOf);
  const evidence = collectEvidence(events.filter((event) => event?.created_at <= cutoff), { userId });

  const states = new Map(skillIds.filter(isSkillId).map((id) => [id, { state: newReviewState(id), history: [] }]));
  for (const input of reviewInputs(evidence.records)) {
    if (!states.has(input.skill_id)) states.set(input.skill_id, { state: newReviewState(input.skill_id), history: [] });
    const entry = states.get(input.skill_id);
    entry.state = calculateReviewState(entry.state, input, input.at);
    entry.history.push({ at: input.at, outcome: input.outcome, evidence: input.evidence, stability: entry.state.stability });
  }

  const items = [...states.keys()].sort().map((id) => {
    const { state, history } = states.get(id);
    return { ...describeReviewState(state, asOf), skill_type: id.split(":")[0], history: history.slice(-HISTORY_LIMIT) };
  });
  return {
    format: REVIEW_SNAPSHOT_FORMAT,
    version: REVIEW_SNAPSHOT_VERSION,
    generated_at: cutoff,
    user_id: userId,
    summary: summarize(items),
    items,
    metadata: { derivation: "event_replay", persisted: false, event_count: evidence.eventCount, rules: REVIEW_RULES },
  };
}

/** Abrufe aus den Nachweisen des Kompetenzmodells (chronologisch; Regeln im Dateikopf). */
export function reviewInputs(records) {
  const inputs = [];
  for (const r of records) {
    if (r.source === "llm" || r.reliability === "low" || !(r.confidence > 0)) continue;
    const base = { skill_id: r.skill_id, at: r.at, day: r.day, evidence: r.evidence, event_id: r.event_id };
    if (r.signal === "success") {
      const weak = r.grade === "hard";
      inputs.push({ ...base, outcome: "success", weight: weak ? r.confidence / 2 : r.confidence });
    } else if (r.signal === "failure") {
      inputs.push({ ...base, outcome: "failure", weight: r.confidence });
    } else if (r.signal === "missed") {
      inputs.push({ ...base, outcome: "miss", weight: r.confidence });
    }
  }
  return inputs;
}

function summarize(items) {
  const reviewed = items.filter((i) => i.phase !== "new");
  return {
    total_skills: items.length,
    by_phase: Object.fromEntries(REVIEW_PHASES.map((phase) => [phase, items.filter((i) => i.phase === phase).length])),
    by_due_status: Object.fromEntries(DUE_STATUSES.map((s) => [s, reviewed.filter((i) => i.due_status === s).length])),
    // fällig und überfällig, dringendste (niedrigste Abrufwahrscheinlichkeit) zuerst
    due_skill_ids: reviewed.filter((i) => i.due_status === "due" || i.due_status === "overdue")
      .sort((a, b) => a.retrievability - b.retrievability || (a.skill_id < b.skill_id ? -1 : 1))
      .map((i) => i.skill_id),
  };
}
