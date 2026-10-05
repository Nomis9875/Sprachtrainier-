/**
 * Startseite (DOM-frei, testbar): fasst berechnete Zustände für die Anzeige zusammen.
 *
 * Eingaben sind ausschließlich Projektionen des Kerns (ActivitySummary, ReviewSnapshot,
 * Lerngedächtnis, SessionPlan in Lernersicht) und die Profileinstellungen. Keine erfundenen
 * Zahlen: Was es (noch) nicht gibt, wird als leerer Zustand gezeigt, nicht als 0 %-Balken.
 */

import { PURPOSE_LABELS, plural, purposeText } from "./labels.js";

const OPEN = new Set(["candidate", "active", "weakening"]);
// Begrüßung in der Lernsprache (P22: vorher immer "Hola", auch beim Deutsch- oder Englischlernen)
const GREETINGS = Object.freeze({ es: "Hola", de: "Hallo", fr: "Bonjour", en: "Hello" });

/**
 * @param {{
 *   profile: {name: string, daily_minutes: number},
 *   activity: object,            ActivitySummary v1 (14 Tage)
 *   reviews: object,             ReviewSnapshot v1
 *   memories: object[],          MemoryRecords (offene und geschlossene)
 *   openSession: object|null,    Session-Zustand (replaySession) oder null
 *   preview: object|null,        describePreview(): nächste Session in Lernersicht
 * }} input
 */
export function buildDashboard({ profile, activity, reviews, memories, openSession, preview, languageId = "es" }) {
  const hasHistory = activity.totals.attempts > 0;
  const goalSeconds = profile.daily_minutes * 60;
  const todaySeconds = activity.today.active_seconds;
  const week = activity.recent_days.slice(-7);
  const previousWeek = activity.recent_days.slice(-14, -7);
  const sum = (days, key) => days.reduce((total, d) => total + d[key], 0);
  const open = memories.filter((m) => OPEN.has(m.status));

  const needs = [
    { key: "reviews", count: dueCount(reviews), text: (n) => `${plural(n, "Wiederholung", "Wiederholungen")} fällig` },
    { key: "recurring_errors", count: open.filter((m) => m.memory_type === "recurring_error").length,
      text: (n) => plural(n, "wiederkehrender Fehler", "wiederkehrende Fehler") },
    { key: "production_gaps", count: open.filter((m) => m.memory_type === "production_gap").length,
      text: (n) => `${plural(n, "Lücke", "Lücken")} in der freien Produktion` },
    { key: "avoided", count: open.filter((m) => m.memory_type === "avoided_structure").length,
      text: (n) => `${plural(n, "Struktur", "Strukturen")}, die du oft umgehst` },
  ].filter((n) => n.count > 0).map((n) => ({ key: n.key, count: n.count, text: n.text(n.count) }));

  return {
    greeting: profile.name ? `${GREETINGS[languageId] ?? "Hallo"}, ${profile.name}` : `${GREETINGS[languageId] ?? "Hallo"}!`,
    has_history: hasHistory,
    today: {
      minutes: Math.round(todaySeconds / 60),
      minutes_text: todaySeconds > 0 && todaySeconds < 30 ? "< 1" : String(Math.round(todaySeconds / 60)),
      goal_minutes: profile.daily_minutes,
      ratio: goalSeconds > 0 ? Math.min(1, todaySeconds / goalSeconds) : 0,
      reached: todaySeconds >= goalSeconds,
      attempts: activity.today.attempts,
      correct: activity.today.correct,
      with_errors: activity.today.incorrect,
    },
    streak: activity.streak,
    week: {
      days: week.map((d) => ({ date: d.date, attempts: d.attempts, correct: d.correct, minutes: Math.round(d.active_seconds / 60) })),
      attempts: sum(week, "attempts"),
      previous_attempts: sum(previousWeek, "attempts"),
      max_attempts: Math.max(0, ...week.map((d) => d.attempts)),
    },
    needs,
    open_session: openSession ? {
      session_id: openSession.session_id,
      status: openSession.status,
      completed: openSession.progress.completed,
      total: openSession.progress.total,
    } : null,
    next_session: preview,
  };
}

/** Fällige und überfällige Wiederholungen (nur Skills, die schon abgerufen wurden). */
export function dueCount(reviews) {
  return (reviews.summary.by_due_status.due ?? 0) + (reviews.summary.by_due_status.overdue ?? 0);
}

/**
 * Vorschau einer Session: Dauer, Anzahl, Zusammensetzung nach Zweck. Nur Lernersicht: keine
 * Skill-Namen von Challenges, keine internen Prioritäten.
 */
export function describePreview({ minutes, view, byPurpose, challengeCount }) {
  const composition = Object.entries(byPurpose)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => Object.keys(PURPOSE_LABELS).indexOf(a) - Object.keys(PURPOSE_LABELS).indexOf(b))
    .map(([purpose, count]) => ({ purpose, count, text: purposeText(purpose, count) }));
  return {
    minutes,
    title: view.title,
    exercise_count: view.exercises.length,
    estimated_minutes: Math.max(1, Math.round(view.estimated_seconds / 60)),
    composition,
    challenge_count: challengeCount,
    empty: view.exercises.length === 0,
  };
}
