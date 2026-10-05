/**
 * Fortschrittsseite (DOM-frei, testbar).
 *
 * Alles stammt aus Projektionen des Kerns: CompetenceSnapshot (Stufen, Nachweisstufen),
 * CoachingReport (Stärken, Empfehlungen), Lerngedächtnis (Muster), ReviewSnapshot, ActivitySummary.
 * Hier wird nur gezählt und beschriftet. Balken gibt es erst, wenn es Nachweise gibt.
 *
 *   Bereich (Grammatik, Wortschatz, typische Fehler)   Anteil der erreichten Stufen über alle Skills
 *                        des Bereichs im Katalog: (Stufe 0..4) / 4, gemittelt. Dazu: gefestigt
 *                        (stable/mastered) und begonnen (introduced/practicing).
 *   Freie Produktion     geübte Grammatik-/Wortschatz-Skills mit mindestens einem verlässlichen
 *                        Erfolg frei oder spontan
 *   Spontan              dieselben, mit einem Erfolg spontan (Gespräch)
 */

import { MASTERY_LABELS, MASTERY_ORDER, MEMORY_STATUS_LABELS, MEMORY_TYPE_LABELS, STRENGTH_LABELS, skillTitle } from "./labels.js";

const AREAS = Object.freeze([
  { key: "grammar", label: "Grammatik", type: "grammar_structure" },
  { key: "vocabulary", label: "Wortschatz", type: "lexical_item" },
  { key: "errors", label: "Typische Fehler vermeiden", type: "common_error" },
]);
const PATTERN_TYPES = new Set(["recurring_error", "production_gap", "avoided_structure"]);
const OPEN = new Set(["candidate", "active", "weakening"]);
export const MAX_PATTERNS = 6;
export const MAX_STRENGTHS = 4;
export const MAX_FOCUS = 3;
export const MAX_FOCUS_SKILLS = 3;
/** Stärken erst ab so vielen Lerntagen: Ein einzelner Tag ist noch keine Aussage über Stabilität. */
export const MIN_DAYS_FOR_STRENGTHS = 2;

/**
 * @param {{snapshot: object, coaching: object, memories: object[], reviews: object, activity: object, library: object}} input
 */
export function buildProgress({ snapshot, coaching, memories, reviews, activity, library }) {
  const skills = snapshot.skills;
  const observed = skills.filter((s) => s.mastery !== "unknown");
  const hasHistory = observed.length > 0;
  const label = (id) => library.skill(id)?.label ?? id;

  const areas = AREAS.map((area) => {
    const own = skills.filter((s) => s.type === area.type);
    const levels = own.map((s) => MASTERY_ORDER.indexOf(s.mastery));
    const value = own.length ? levels.reduce((sum, l) => sum + l, 0) / (own.length * 4) : 0;
    const secure = own.filter((s) => s.mastery === "stable" || s.mastery === "mastered").length;
    const started = own.filter((s) => s.mastery === "introduced" || s.mastery === "practicing").length;
    return {
      key: area.key,
      label: area.label,
      value: round(value),
      total: own.length,
      secure,
      started,
      observed: secure + started,
      detail: own.length ? `${secure} gefestigt · ${started} begonnen · ${own.length} insgesamt` : "noch keine Inhalte",
    };
  });

  const productive = observed.filter((s) => s.type !== "common_error");
  const freeCount = productive.filter((s) => s.evidence.free.successes + s.evidence.spontaneous.successes > 0).length;
  const spontaneousCount = productive.filter((s) => s.evidence.spontaneous.successes > 0).length;
  const production = productive.length ? [
    { key: "free", label: "Freie Produktion", value: round(freeCount / productive.length),
      detail: `${freeCount} von ${productive.length} geübten Strukturen und Ausdrücken frei verwendet` },
    { key: "spontaneous", label: "Spontane Kommunikation", value: round(spontaneousCount / productive.length),
      detail: `${spontaneousCount} von ${productive.length} spontan im Gespräch verwendet` },
  ] : [];

  const openMemories = memories.filter((m) => OPEN.has(m.status));
  const patterns = openMemories
    .filter((m) => PATTERN_TYPES.has(m.memory_type))
    .sort((a, b) => b.importance - a.importance || (a.memory_id < b.memory_id ? -1 : 1))
    .slice(0, MAX_PATTERNS)
    .map((m) => ({
      memory_id: m.memory_id,
      title: label(m.skill_id),
      kind: m.memory_type,
      kind_label: MEMORY_TYPE_LABELS[m.memory_type],
      status: m.status,
      status_label: MEMORY_STATUS_LABELS[m.status],
      text: m.content.text,
    }));

  const enoughDays = activity.totals.learning_days >= MIN_DAYS_FOR_STRENGTHS;
  const strengths = enoughDays ? [
    ...openMemories.filter((m) => m.memory_type === "stable_strength")
      .map((m) => ({ skill_id: m.skill_id, title: label(m.skill_id), text: MEMORY_TYPE_LABELS.stable_strength })),
    ...coaching.strengths.map((s) => ({ skill_id: s.skill_id, title: label(s.skill_id), text: STRENGTH_LABELS[s.kind] ?? "gut" })),
  ].filter((s, i, list) => list.findIndex((x) => x.skill_id === s.skill_id) === i).slice(0, MAX_STRENGTHS) : [];

  // Empfehlungen des Coachings: Handlung und betroffene Skills (die Zahlenbegründung bleibt intern)
  const focus = coaching.recommendations
    .filter((r) => hasHistory || r.action === "start_diagnostic")
    .slice(0, MAX_FOCUS)
    .map((r) => {
      // P22: typische Fehler außerhalb von "Fehler gezielt abbauen" als solche benennen
      const skills = r.skill_ids.map((id) => (r.action === "focus_error_elimination" ? label(id) : skillTitle(library.skill(id), id)));
      const shown = skills.slice(0, MAX_FOCUS_SKILLS);
      return { title: r.title_de, skills: shown, more: skills.length - shown.length };
    });

  return {
    has_history: hasHistory,
    headline: learnerHeadline(coaching.overall_assessment),
    areas,
    production,
    mastery: MASTERY_ORDER.slice(1).map((level) => ({
      level, label: MASTERY_LABELS[level], count: skills.filter((s) => s.mastery === level).length,
    })),
    patterns,
    patterns_note: hasHistory && !patterns.length ? "Noch nicht genügend Daten für wiederkehrende Muster." : null,
    // "Das sitzt inzwischen gut": überwundene Fehlermuster (Erinnerung resolved)
    overcome: memories.filter((m) => m.memory_type === "recurring_error" && m.status === "resolved")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, MAX_PATTERNS).map((m) => label(m.skill_id)),
    strengths,
    strengths_note: enoughDays ? null : "Stärken zeigen sich, wenn du an mehreren Tagen geübt hast.",
    focus,
    reviews: {
      due: (reviews.summary.by_due_status.due ?? 0) + (reviews.summary.by_due_status.overdue ?? 0),
      soon: reviews.summary.by_due_status.soon ?? 0,
      learning: reviews.summary.by_phase.learning + reviews.summary.by_phase.relearning,
      mastered: reviews.summary.by_phase.mastered,
    },
    activity: {
      learning_days: activity.totals.learning_days,
      attempts: activity.totals.attempts,
      sessions_completed: activity.totals.sessions_completed,
      streak: activity.streak.current,
      longest_streak: activity.streak.longest,
    },
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** Kopfzeile aus Lernersicht (P22): dieselben Zahlen wie der CoachingReport, ohne Fachbegriffe ("Skills", "unter Kontrolle"). */
function learnerHeadline(o) {
  if (!o.observed_skills) return "Noch keine Übungen in dieser Sprache. Deine erste Session legt los.";
  const free = o.development.free + o.development.spontaneous;
  const errors = o.errors.active ? ` ${o.errors.active === 1 ? "Ein typischer Fehler kommt" : `${o.errors.active} typische Fehler kommen`} noch vor.` : "";
  return `${o.observed_skills === 1 ? "1 Struktur oder Ausdruck" : `${o.observed_skills} Strukturen und Ausdrücke`} geübt, davon ${free} schon frei verwendet.${errors}`;
}
