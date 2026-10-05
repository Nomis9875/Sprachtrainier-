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

import { t, uiLanguage } from "./i18n.js";
import { localizedSkillLabel } from "./explain.js";
import { MASTERY_ORDER, masteryLabel, memoryStatusLabel, memoryTypeLabel, skillTitle, strengthLabel } from "./labels.js";

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
export function buildProgress({ snapshot, coaching, memories, reviews, activity, library, language = "de" }) {
  const skills = snapshot.skills;
  const observed = skills.filter((s) => s.mastery !== "unknown");
  const hasHistory = observed.length > 0;
  // Strukturen und Fehler in der Erklärungssprache (wie in Session und Rückmeldung)
  const label = (id) => localizedSkillLabel(library.skill(id), library, language) ?? id;

  const areas = AREAS.map((area) => {
    const own = skills.filter((s) => s.type === area.type);
    const levels = own.map((s) => MASTERY_ORDER.indexOf(s.mastery));
    const value = own.length ? levels.reduce((sum, l) => sum + l, 0) / (own.length * 4) : 0;
    const secure = own.filter((s) => s.mastery === "stable" || s.mastery === "mastered").length;
    const started = own.filter((s) => s.mastery === "introduced" || s.mastery === "practicing").length;
    return {
      key: area.key,
      label: t(`area.${area.key}`),
      value: round(value),
      total: own.length,
      secure,
      started,
      observed: secure + started,
      detail: own.length ? t("area.detail", secure, started, own.length) : t("area.no_content"),
    };
  });

  const productive = observed.filter((s) => s.type !== "common_error");
  const freeCount = productive.filter((s) => s.evidence.free.successes + s.evidence.spontaneous.successes > 0).length;
  const spontaneousCount = productive.filter((s) => s.evidence.spontaneous.successes > 0).length;
  const production = productive.length ? [
    { key: "free", label: t("area.free"), value: round(freeCount / productive.length),
      detail: t("area.free_detail", freeCount, productive.length) },
    { key: "spontaneous", label: t("area.spontaneous"), value: round(spontaneousCount / productive.length),
      detail: t("area.spontaneous_detail", spontaneousCount, productive.length) },
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
      kind_label: memoryTypeLabel(m.memory_type),
      status: m.status,
      status_label: memoryStatusLabel(m.status),
      // Kerntext (Deutsch, mit Zahlen); in anderer Sprache der App ein kurzer Satz je Art
      text: uiLanguage() === "de" ? m.content.text : t(`pattern.${m.memory_type}`) ?? m.content.text,
    }));

  const enoughDays = activity.totals.learning_days >= MIN_DAYS_FOR_STRENGTHS;
  const strengths = enoughDays ? [
    ...openMemories.filter((m) => m.memory_type === "stable_strength")
      .map((m) => ({ skill_id: m.skill_id, title: label(m.skill_id), text: memoryTypeLabel("stable_strength") })),
    ...coaching.strengths.map((s) => ({ skill_id: s.skill_id, title: label(s.skill_id), text: strengthLabel(s.kind) })),
  ].filter((s, i, list) => list.findIndex((x) => x.skill_id === s.skill_id) === i).slice(0, MAX_STRENGTHS) : [];

  // Empfehlungen des Coachings: Handlung und betroffene Skills (die Zahlenbegründung bleibt intern)
  const focus = coaching.recommendations
    .filter((r) => hasHistory || r.action === "start_diagnostic")
    .slice(0, MAX_FOCUS)
    .map((r) => {
      // P22: typische Fehler außerhalb von "Fehler gezielt abbauen" als solche benennen
      const skills = r.skill_ids.map((id) => (r.action === "focus_error_elimination" ? label(id) : skillTitle(library.skill(id), id, { language, library })));
      const shown = skills.slice(0, MAX_FOCUS_SKILLS);
      return { title: t(`rec.${r.action}`) ?? r.title_de, skills: shown, more: skills.length - shown.length };
    });

  return {
    has_history: hasHistory,
    headline: learnerHeadline(coaching.overall_assessment),
    areas,
    production,
    mastery: MASTERY_ORDER.slice(1).map((level) => ({
      level, label: masteryLabel(level), count: skills.filter((s) => s.mastery === level).length,
    })),
    patterns,
    patterns_note: hasHistory && !patterns.length ? t("progress.patterns_empty") : null,
    // "Das sitzt inzwischen gut": überwundene Fehlermuster (Erinnerung resolved)
    overcome: memories.filter((m) => m.memory_type === "recurring_error" && m.status === "resolved")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, MAX_PATTERNS).map((m) => label(m.skill_id)),
    strengths,
    strengths_note: enoughDays ? null : t("progress.strengths_days"),
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
  if (!o.observed_skills) return t("progress.headline_none");
  const free = o.development.free + o.development.spontaneous;
  return t("progress.headline", o.observed_skills, free, o.errors.active);
}
