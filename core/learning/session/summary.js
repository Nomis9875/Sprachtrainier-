/**
 * SessionSummary v1: Rückblick auf eine Session, aus Ereignissen berechnet (nie gespeichert).
 *
 *   format, version            "session_summary", 1
 *   session_id, user_id, status, end_reason, objective
 *   started_at, ended_at
 *   duration_seconds           aktive Zeit (ohne Pausen)
 *   elapsed_seconds            Start bis Ende (bzw. letztes Ereignis)
 *   exercises_planned          Übungen im gestarteten Plan
 *   exercises_added            durch Wiederholung (retry) hinzugekommen
 *   exercises_completed, exercises_remaining
 *   results                    Anzahl correct / partially_correct / incorrect / undecided
 *   skills_practiced[]         je Skill: Erfolge, Fehler in dieser Session, Beherrschungsstufe
 *                              vor und nach der Session (Competence Update)
 *   strengths[]                Skills mit Erfolgen und ohne Fehler
 *   weaknesses[]               Skills mit Fehlern
 *   recommended_next_focus[]   höchstens 3: Schwächen, dann nicht erreichte Fokus-Skills
 *   adaptations[], explanation Warum Session, Übungen und Wiederholungen
 *
 * Nur Regel-/Referenzsignale zählen (wie im Kompetenzmodell); Ergebnisse mit
 * confidence 0 zählen als "undecided".
 */

import { buildCompetenceSnapshot } from "../competence/snapshot.js";
import { replaySession } from "./state.js";

export const SESSION_SUMMARY_FORMAT = "session_summary";
export const SESSION_SUMMARY_VERSION = 1;
const MAX_NEXT_FOCUS = 3;

/**
 * @param {{events: object[], sessionId: string, asOf?: Date}} input
 */
export function buildSessionSummary({ events, sessionId, asOf }) {
  const state = replaySession(events, sessionId, { asOf });
  if (!state) throw new Error(`Keine Session ${sessionId}`);

  const endIso = state.ended_at ?? (asOf ? asOf.toISOString() : lastEventAt(events, sessionId));
  const practicedIds = Object.keys(state.skills);
  const before = masteryAt(events, state.user_id, practicedIds, new Date(Date.parse(state.started_at) - 1));
  const after = masteryAt(events, state.user_id, practicedIds, new Date(endIso));

  const skills = practicedIds.map((id) => ({
    skill_id: id,
    successes: state.skills[id].successes,
    failures: state.skills[id].failures,
    focus: state.plan.focus_skills.some((f) => f.skill_id === id),
    mastery_before: before.get(id) ?? "unknown",
    mastery_after: after.get(id) ?? "unknown",
  }));

  const strengths = skills
    .filter((s) => s.successes > 0 && s.failures === 0)
    .sort((a, b) => b.successes - a.successes || cmp(a.skill_id, b.skill_id))
    .map((s) => ({ skill_id: s.skill_id, reason: `${s.successes}× richtig, kein Fehler${changeText(s)}` }));
  const weaknesses = skills
    .filter((s) => s.failures > 0)
    .sort((a, b) => b.failures - a.failures || a.successes - b.successes || cmp(a.skill_id, b.skill_id))
    .map((s) => ({ skill_id: s.skill_id, reason: `${s.failures}× Fehler, ${s.successes}× richtig${changeText(s)}` }));

  const practicedFocus = new Set(skills.filter((s) => s.successes + s.failures > 0).map((s) => s.skill_id));
  const unreached = state.plan.focus_skills
    .filter((f) => !practicedFocus.has(f.skill_id))
    .map((f) => ({ skill_id: f.skill_id, reason: `geplant, aber in dieser Session nicht geübt (${f.reason})` }));
  const nextFocus = [
    ...weaknesses.map((w) => ({ skill_id: w.skill_id, reason: `Schwäche in dieser Session: ${w.reason}` })),
    ...unreached,
  ].slice(0, MAX_NEXT_FOCUS);

  const results = { correct: 0, partially_correct: 0, incorrect: 0, undecided: 0 };
  for (const c of state.completed) results[c.outcome.confidence === 0 ? "undecided" : c.outcome.result] += 1;

  return {
    format: SESSION_SUMMARY_FORMAT,
    version: SESSION_SUMMARY_VERSION,
    session_id: sessionId,
    user_id: state.user_id,
    status: state.status,
    end_reason: state.end_reason,
    objective: state.plan.objective,
    started_at: state.started_at,
    ended_at: state.ended_at,
    duration_seconds: state.active_seconds,
    elapsed_seconds: Math.round((Date.parse(endIso) - Date.parse(state.started_at)) / 1000),
    exercises_planned: state.plan.exercises.length,
    exercises_added: state.adaptations.filter((a) => a.type === "retry").length,
    exercises_completed: state.completed.length,
    exercises_remaining: state.remaining.length,
    results,
    skills_practiced: skills,
    strengths,
    weaknesses,
    recommended_next_focus: nextFocus,
    adaptations: state.adaptations,
    explanation: state.explanation,
  };
}

function masteryAt(events, userId, skillIds, asOf) {
  const snapshot = buildCompetenceSnapshot({ events, userId, asOf, skillIds });
  return new Map(snapshot.skills.map((s) => [s.skill_id, s.mastery]));
}

function changeText(skill) {
  return skill.mastery_before === skill.mastery_after
    ? ` (Stufe bleibt '${skill.mastery_after}')`
    : ` (Stufe '${skill.mastery_before}' → '${skill.mastery_after}')`;
}

function lastEventAt(events, sessionId) {
  return events.filter((e) => e.payload?.session_id === sessionId).map((e) => e.created_at).sort().at(-1);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
