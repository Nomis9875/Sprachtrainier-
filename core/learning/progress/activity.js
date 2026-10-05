/**
 * ActivitySummary v1: Wie aktiv war der Lerner? Heute, Streak, die letzten Tage.
 *
 * Wie alle Zustände eine Projektion der Ereignisse (nie gespeichert, deterministisch, Stichtag
 * explizit). Sie beantwortet nicht, WAS der Lerner kann (Kompetenzmodell), sondern OB und WIE VIEL
 * er geübt hat. Punkte oder XP gibt es bewusst nicht.
 *
 *   Lerntag       Kalendertag auf dem Gerät (local_date des Ereignisses) mit mindestens einem Versuch
 *   Lernzeit      aktive Zeit der Sessions (ohne Pausen, aus dem Session-Replay) am Tag ihres Starts,
 *                 dazu Versuche außerhalb einer Session mit ihrer Bearbeitungsdauer (höchstens
 *                 PRACTICE_CAP_SECONDS je Versuch, damit ein offen gelassener Tab nicht zählt)
 *   Streak        Anzahl aufeinanderfolgender Lerntage bis heute; ist heute noch nichts passiert,
 *                 zählt die Serie bis gestern (sie reißt erst, wenn ein ganzer Tag ausfällt)
 *   richtig       Versuche mit overall.outcome "correct" (Regel oder Musterlösung)
 *   mit Fehlern   Versuche mit overall.outcome "incorrect" (freie Antworten ohne Befund sind keins von beiden)
 *   Einstufung    Antworten der Einstufung (P22) zählen als Lerntag und Lernzeit, aber nicht als Übungen
 *                 (placement statt attempts/correct/incorrect): Wer nach der Einstufung auf die Startseite kommt,
 *                 soll nicht "21 Übungen, davon 11 mit Fehlern" lesen.
 */

import { localDateOf, toUtcIso } from "../../util/time.js";
import { listSessions, replaySession } from "../session/state.js";

export const ACTIVITY_SUMMARY_FORMAT = "activity_summary";
export const ACTIVITY_SUMMARY_VERSION = 1;
export const PRACTICE_CAP_SECONDS = 600;
const DAY_MS = 86_400_000;

/**
 * @param {{events: object[], userId: string, asOf: Date, days?: number}} input
 *   days: Länge des Verlaufs (Standard 7, heute eingeschlossen)
 */
export function buildActivitySummary({ events, userId, asOf, days = 7 }) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError("asOf: gültiges Datum erwartet");
  if (!Array.isArray(events)) throw new TypeError("events: Liste erwartet");
  if (!(Number.isInteger(days) && days >= 1 && days <= 366)) throw new RangeError("days: 1 bis 366");
  const cutoff = toUtcIso(asOf);
  const own = [...new Map(events.filter((e) => e?.user_id === userId && e.created_at <= cutoff).map((e) => [e.id, e])).values()];
  const today = localDateOf(asOf);

  const byDay = new Map();
  const dayEntry = (day) => {
    if (!byDay.has(day)) byDay.set(day, emptyDay(day));
    return byDay.get(day);
  };
  const placement = new Set(own.filter((e) => e.event_type === "assessment_response").map((e) => e.payload?.attempt_id));
  for (const event of own) {
    if (event.event_type !== "attempt") continue;
    const entry = dayEntry(event.local_date);
    if (placement.has(event.id)) {
      entry.placement += 1;
      if (Number.isFinite(event.payload?.duration_ms)) {
        entry.active_seconds += Math.min(PRACTICE_CAP_SECONDS, Math.max(0, Math.round(event.payload.duration_ms / 1000)));
      }
      continue;
    }
    entry.attempts += 1;
    const outcome = event.payload?.evaluation?.overall?.outcome;
    if (outcome === "correct") entry.correct += 1;
    else if (outcome === "incorrect") entry.incorrect += 1;
    if (!event.payload?.session_id && Number.isFinite(event.payload?.duration_ms)) {
      entry.active_seconds += Math.min(PRACTICE_CAP_SECONDS, Math.max(0, Math.round(event.payload.duration_ms / 1000)));
    }
  }
  const startedDay = new Map(own.filter((e) => e.event_type === "session_started").map((e) => [e.payload.session_id, e.local_date]));
  const sessions = listSessions(own, userId);
  for (const session of sessions) {
    const state = replaySession(own, session.session_id, { asOf });
    const entry = dayEntry(startedDay.get(session.session_id));
    entry.active_seconds += state.active_seconds;
    entry.sessions += 1;
  }

  const learningDays = new Set([...byDay.values()].filter((d) => d.attempts + d.placement > 0).map((d) => d.date));
  const streakFrom = learningDays.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  for (let day = streakFrom; learningDays.has(day); day = shiftDay(day, -1)) streak += 1;

  const recent = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = shiftDay(today, -i);
    recent.push(byDay.get(date) ?? emptyDay(date));
  }
  const sorted = [...learningDays].sort();

  return {
    format: ACTIVITY_SUMMARY_FORMAT,
    version: ACTIVITY_SUMMARY_VERSION,
    generated_at: cutoff,
    user_id: userId,
    today: { ...(byDay.get(today) ?? emptyDay(today)) },
    streak: { current: streak, active_today: learningDays.has(today), longest: longestRun(sorted) },
    recent_days: recent,
    totals: {
      attempts: [...byDay.values()].reduce((sum, d) => sum + d.attempts, 0),
      learning_days: learningDays.size,
      sessions_completed: sessions.filter((s) => s.status === "completed").length,
      first_learning_day: sorted[0] ?? null,
      last_learning_day: sorted.at(-1) ?? null,
    },
    metadata: { derivation: "event_replay", persisted: false, practice_cap_seconds: PRACTICE_CAP_SECONDS },
  };
}

function emptyDay(date) {
  return { date, attempts: 0, correct: 0, incorrect: 0, placement: 0, active_seconds: 0, sessions: 0 };
}

/** Kalendertag ± n Tage, als reine Datumsrechnung (keine Zeitzone, keine Sommerzeit). */
export function shiftDay(day, delta) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

function longestRun(sortedDays) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of sortedDays) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}
