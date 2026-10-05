/**
 * Skill Mastery: das zentrale Modell, wie gut ein Skill beherrscht wird.
 *
 * Eingabe ist ein projizierter Skill (projection.js), Ausgabe sind Beherrschungsstufe,
 * typspezifischer Entwicklungspfad, Fehlertrend und Trend-Grundlage. Alles sind reine,
 * deterministische Funktionen: dieselbe Projektion und derselbe Stichtag ergeben immer
 * dasselbe Ergebnis. Kein Zufall, keine Uhr, kein KI-Einfluss (Qwen-Nachweise sind
 * schon in der Projektion ausgeklammert).
 *
 * ─── Beherrschungsstufen ───────────────────────────────────────────────────────
 *
 *   unknown     Kein Nachweis: der Skill wurde nie richtig oder falsch verwendet.
 *   introduced  Begegnet, aber nicht gefestigt: nur Fehler, nur erkannt
 *               (Karteikarte) oder zu wenig Nachweis.
 *   practicing  Wird geübt und gelingt schon: Nachweiswert ≥ 1 und mindestens ein
 *               Erfolg ab "controlled" (z. B. zwei Lückentexte oder eine geführte Antwort).
 *   stable      Sitzt in der Übung: Nachweiswert ≥ 6, Erfolge an ≥ 3 Tagen, mindestens
 *               ein Erfolg ohne vorgegebene Form (ab "guided"), letzte 10 Nachweise
 *               ≥ 75 % richtig.
 *   mastered    Wird selbstständig und dauerhaft richtig verwendet: Nachweiswert ≥ 15,
 *               Erfolge an ≥ 5 Tagen über ≥ 21 Tage verteilt, ≥ 3 selbst gewählte
 *               Verwendungen ("free"/"spontaneous"), letzte 10 Nachweise ≥ 90 % richtig,
 *               letzter Nachweis ist ein Erfolg.
 *
 * Nachweiswert = Summe über alle Erfolge: Gewicht der Nachweisstufe × Verlässlichkeit.
 *
 * ─── Übergangsregeln ───────────────────────────────────────────────────────────
 *
 *   - Die Stufe wird bei jedem Aufruf aus allen Nachweisen neu berechnet; es gibt keinen
 *     gespeicherten Vorzustand. Übergänge sind also nur die Folge neuer Ereignisse.
 *   - Stufen bauen aufeinander auf: geprüft wird von unten nach oben, die erste nicht
 *     erfüllte Stufe beendet die Prüfung. Stufen werden nicht übersprungen.
 *   - Aufstieg: nur durch neue Erfolge (mehr Nachweiswert, mehr Tage, höhere Nachweisstufe).
 *   - Abstieg: durch neue Fehler, weil die Quote der letzten 10 Nachweise sinkt
 *     (mastered → stable schon beim ersten Fehler, da der letzte Nachweis ein Erfolg sein muss).
 *   - Typische Fehler haben zusätzlich eine Obergrenze aus ihrem Pfad (siehe unten):
 *     "active" höchstens practicing, "declining" höchstens stable.
 *   - next_level_missing nennt jede noch nicht erfüllte Bedingung der nächsten Stufe.
 *
 * ─── Warum keine XP ────────────────────────────────────────────────────────────
 *
 *   XP messen Fleiß: Jede Übung bringt Punkte, Punkte gehen nie verloren. Für
 *   Fortgeschrittene ist aber entscheidend, ob eine Struktur ohne Hilfe und dauerhaft
 *   richtig kommt. 500 XP aus Lückentexten sagen darüber nichts. Hier zählt die
 *   Art des Nachweises (Gewicht 0.5 bis 3), Fehler senken die Stufe wieder, und
 *   Lückentexte allein reichen nie für "stable".
 *
 * ─── Warum keine Prozentwerte ──────────────────────────────────────────────────
 *
 *   "80 %" vermischt, WAS gelungen ist (Lückentext oder Gespräch), WIE OFT (2 oder 200
 *   Versuche) und WANN (gestern oder vor einem Jahr). Zwei richtige Lückentexte ergeben
 *   100 %, obwohl kaum etwas bewiesen ist. Eine Stufe mit festen, benannten Bedingungen
 *   sagt dagegen, was erreicht ist und was fehlt ("Erfolg ohne vorgegebene Form").
 *   Die Quote der letzten Nachweise ist nur eine von mehreren Bedingungen, nie das Ergebnis.
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { evidenceRank } from "./evidence.js";
import { round } from "./projection.js";

export const MASTERY_LEVELS = Object.freeze(["unknown", "introduced", "practicing", "stable", "mastered"]);

/** Schwellen je Stufe. Absichtlich an einer Stelle, damit sie später justiert werden können. */
export const MASTERY_RULES = Object.freeze({
  practicing: Object.freeze({ minScore: 1, minEvidence: "controlled" }),
  stable: Object.freeze({ minScore: 6, minSuccessDays: 3, minEvidence: "guided", minRecentAccuracy: 0.75 }),
  mastered: Object.freeze({
    minScore: 15,
    minSuccessDays: 5,
    minSpanDays: 21,
    minSelfChosen: 3,
    minRecentAccuracy: 0.9,
    lastMustSucceed: true,
  }),
});

const DAY_MS = 86_400_000;

/**
 * @param {ReturnType<import("./projection.js").projectSkill>} skill
 * @param {{ceiling?: string}} [options]  höchste erreichbare Stufe (aus dem Pfad)
 * @returns {{level: string, missing: string[]}}  missing = was zur nächsten Stufe fehlt
 */
export function classifyMastery(skill, { ceiling = "mastered" } = {}) {
  const facts = masteryFacts(skill);
  if (facts.signals === 0) return { level: "unknown", missing: ["erster Nachweis"] };

  const checks = {
    practicing: [
      [facts.score >= MASTERY_RULES.practicing.minScore, `Nachweiswert ≥ ${MASTERY_RULES.practicing.minScore}`],
      [atLeast(facts.highest, MASTERY_RULES.practicing.minEvidence), "Erfolg ab Stufe 'controlled'"],
    ],
    stable: [
      [facts.score >= MASTERY_RULES.stable.minScore, `Nachweiswert ≥ ${MASTERY_RULES.stable.minScore}`],
      [facts.successDays >= MASTERY_RULES.stable.minSuccessDays, `Erfolge an ≥ ${MASTERY_RULES.stable.minSuccessDays} Tagen`],
      [atLeast(facts.highest, MASTERY_RULES.stable.minEvidence), "Erfolg ohne vorgegebene Form (ab 'guided')"],
      [facts.recentAccuracy >= MASTERY_RULES.stable.minRecentAccuracy, "zuletzt ≥ 75 % richtig"],
    ],
    mastered: [
      [facts.score >= MASTERY_RULES.mastered.minScore, `Nachweiswert ≥ ${MASTERY_RULES.mastered.minScore}`],
      [facts.successDays >= MASTERY_RULES.mastered.minSuccessDays, `Erfolge an ≥ ${MASTERY_RULES.mastered.minSuccessDays} Tagen`],
      [facts.spanDays >= MASTERY_RULES.mastered.minSpanDays, `über ≥ ${MASTERY_RULES.mastered.minSpanDays} Tage verteilt`],
      [facts.selfChosen >= MASTERY_RULES.mastered.minSelfChosen, `≥ ${MASTERY_RULES.mastered.minSelfChosen} selbst gewählte Verwendungen`],
      [facts.recentAccuracy >= MASTERY_RULES.mastered.minRecentAccuracy, "zuletzt ≥ 90 % richtig"],
      [facts.lastSucceeded, "letzter Nachweis ist ein Erfolg"],
    ],
  };

  let level = "introduced";
  for (const next of ["practicing", "stable", "mastered"]) {
    const unmet = checks[next].filter(([ok]) => !ok).map(([, label]) => label);
    if (MASTERY_LEVELS.indexOf(next) > MASTERY_LEVELS.indexOf(ceiling)) unmet.push(CEILING_REASON);
    if (unmet.length) return { level, missing: unmet };
    level = next;
  }
  return { level, missing: [] };
}

const CEILING_REASON = "Fehler seltener machen (Fehlerpfad)";

/** Die Kennzahlen, auf denen die Einstufung beruht (auch für die Sessionplanung nützlich). */
export function masteryFacts(skill) {
  const recent = skill.recent;
  const weight = recent.reduce((sum, r) => sum + r.confidence, 0);
  const good = recent.filter((r) => r.outcome === "success").reduce((sum, r) => sum + r.confidence, 0);
  return {
    signals: recent.length,
    score: skill.evidence_score,
    highest: skill.highest_success_evidence,
    successDays: skill.success_days,
    spanDays: skill.first_success_at ? daysBetween(skill.first_success_at, skill.last_success_at) : 0,
    selfChosen: skill.evidence.free.successes + skill.evidence.spontaneous.successes,
    recentAccuracy: weight > 0 ? good / weight : 0,
    lastSucceeded: recent.at(-1)?.outcome === "success",
  };
}

// ---------------------------------------------------------------- Entwicklungspfade

/**
 * Jeder Skill-Typ hat einen eigenen Entwicklungspfad (im Snapshot: skills[].path).
 * Die Beherrschungsstufe ist für alle Typen gleich definiert; der Pfad erklärt,
 * WORIN der Fortschritt beim jeweiligen Typ besteht.
 *
 *   grammar_structure  "production": recognized → controlled → free → spontaneous
 *                      Wie selbstständig wird die Struktur produziert?
 *                      (controlled umfasst die Nachweisstufen controlled und guided)
 *   lexical_item       "lexical": recognized → reproduced → self_produced
 *                      Erkannt, auf Anfrage abrufbar, von selbst verwendet?
 *                      (reproduced = controlled/guided, self_produced = free/spontaneous)
 *   common_error       "error": active → declining → resolved   (none = nie aufgetreten)
 *                      Wie sehr steckt der Fehler noch drin?
 *
 * Sprossen von production und lexical gelten als erreicht, sobald ihre Erfolge
 * zusammen ≥ 1 ergeben (ein Regel-/Referenznachweis oder zwei Karteikarten).
 */
export const SKILL_PATHS = Object.freeze({
  [SKILL_TYPES.GRAMMAR_STRUCTURE]: Object.freeze({
    name: "production",
    stages: Object.freeze([
      ["recognized", ["recognized"]],
      ["controlled", ["controlled", "guided"]],
      ["free", ["free"]],
      ["spontaneous", ["spontaneous"]],
    ]),
  }),
  [SKILL_TYPES.LEXICAL_ITEM]: Object.freeze({
    name: "lexical",
    stages: Object.freeze([
      ["recognized", ["recognized"]],
      ["reproduced", ["controlled", "guided"]],
      ["self_produced", ["free", "spontaneous"]],
    ]),
  }),
  [SKILL_TYPES.COMMON_ERROR]: Object.freeze({ name: "error", stages: Object.freeze(["active", "declining", "resolved"]) }),
});

const PATH_MIN_SUCCESS = 1;

/**
 * Fehlerpfad (common_error). "Vermieden" = Erfolg: die Situation hätte den Fehler
 * nahegelegt, die Antwort war richtig.
 *
 *   none       noch nie aufgetreten
 *   active     aufgetreten und seitdem weniger als 3-mal vermieden
 *   declining  seit dem letzten Auftreten ≥ 3-mal vermieden
 *   resolved   seit dem letzten Auftreten ≥ 6-mal an ≥ 3 Tagen vermieden
 *              und das letzte Auftreten liegt ≥ 21 Tage zurück
 *
 * Ein erneuter Fehler setzt den Pfad sofort auf "active" zurück.
 */
export const ERROR_PATH_RULES = Object.freeze({
  decliningMinAvoided: 3,
  resolvedMinAvoided: 6,
  resolvedMinDays: 3,
  resolvedMinDaysSinceError: 21,
});

/** Höchste Beherrschungsstufe je Fehlerpfad-Stufe. */
const ERROR_PATH_CEILING = Object.freeze({ none: "mastered", active: "practicing", declining: "stable", resolved: "mastered" });

/** @returns {{name: string, stage: string|null, stages: Object<string, number>|null}} */
export function skillPath(skill, asOf) {
  const path = SKILL_PATHS[skill.type];
  if (skill.type === SKILL_TYPES.COMMON_ERROR) return { name: path.name, stage: errorPathStage(skill, asOf), stages: null };

  const stages = {};
  let stage = null;
  for (const [name, levels] of path.stages) {
    stages[name] = round(levels.reduce((sum, level) => sum + skill.evidence[level].successes, 0));
    if (stages[name] >= PATH_MIN_SUCCESS) stage = name;
  }
  return { name: path.name, stage, stages };
}

/** Obergrenze der Beherrschungsstufe, die sich aus dem Pfad ergibt. */
export function pathCeiling(path) {
  return path.name === "error" ? ERROR_PATH_CEILING[path.stage] : "mastered";
}

function errorPathStage(skill, asOf) {
  if (!skill.last_failure_at) return "none";
  const avoided = skill.since_last_failure;
  const daysSince = daysBetween(skill.last_failure_at, asOf.toISOString());
  const rules = ERROR_PATH_RULES;
  if (avoided.successes >= rules.resolvedMinAvoided && avoided.success_days >= rules.resolvedMinDays
    && daysSince >= rules.resolvedMinDaysSinceError) return "resolved";
  if (avoided.successes >= rules.decliningMinAvoided) return "declining";
  return "active";
}

// ---------------------------------------------------------------- Fehlerhäufigkeit

/**
 * Wie oft trat ein Fehler auf? (für jeden Skill, bei typischen Fehlern am wichtigsten)
 *
 *   never           nie aufgetreten
 *   occasional      an 1–2 Tagen aufgetreten
 *   repeated        an ≥ 3 verschiedenen Tagen aufgetreten
 *   recent_relapse  schon früher aufgetreten und in den letzten 14 Tagen erneut
 *
 * Gezählt werden Kalendertage, nicht Einzelfehler: fünf gleiche Fehler in einer
 * Sitzung sind ein schlechter Tag, noch kein Muster.
 */
export const ERROR_TRENDS = Object.freeze(["never", "occasional", "repeated", "recent_relapse"]);
export const ERROR_TREND_RULES = Object.freeze({ repeatedMinDays: 3, recentDays: 14 });

export function errorTrend(skill, asOf) {
  const days = skill.history_by_day.filter((d) => d.failures > 0);
  const lastAt = skill.last_failure_at;
  const daysSinceLast = lastAt ? daysBetween(lastAt, asOf.toISOString()) : null;

  let status = "never";
  if (days.length > 0) {
    if (days.length >= 2 && daysSinceLast <= ERROR_TREND_RULES.recentDays) status = "recent_relapse";
    else if (days.length >= ERROR_TREND_RULES.repeatedMinDays) status = "repeated";
    else status = "occasional";
  }
  return {
    status,
    occurrences: days.reduce((sum, d) => sum + d.failures, 0),
    occurrence_days: days.length,
    last_at: lastAt,
    days_since_last: daysSinceLast,
  };
}

// ---------------------------------------------------------------- Trend-Grundlage

/**
 * Datengrundlage für eine spätere Trenderkennung (improving / stable / declining).
 * Bewusst noch KEINE Einordnung: nur zwei gleich lange Zeitfenster vor dem Stichtag
 * zum Vergleichen. Die vollständige Tagesliste steht in history_by_day.
 *
 *   recent     die letzten 14 Kalendertage bis zum Stichtag
 *   previous   die 14 Kalendertage davor
 */
export const TREND_WINDOW_DAYS = 14;

export function trendBasis(skill, asOf) {
  const today = asOf.toISOString().slice(0, 10);
  const recentFrom = shiftDay(today, -(TREND_WINDOW_DAYS - 1));
  const previousFrom = shiftDay(today, -(2 * TREND_WINDOW_DAYS - 1));
  const window = (from, to) => {
    const days = skill.history_by_day.filter((d) => d.day >= from && d.day <= to);
    return {
      from,
      to,
      successes: days.reduce((sum, d) => sum + d.successes, 0),
      failures: days.reduce((sum, d) => sum + d.failures, 0),
      active_days: days.length,
    };
  };
  return {
    window_days: TREND_WINDOW_DAYS,
    recent: window(recentFrom, today),
    previous: window(previousFrom, shiftDay(recentFrom, -1)),
  };
}

/**
 * Einordnung der Trend-Grundlage. Deterministisch, ohne Statistikmodell:
 *
 *   insufficient_data  in einem der beiden Fenster weniger als 3 Nachweise
 *   improving          Quote richtig im letzten Fenster ≥ 20 Prozentpunkte höher als davor
 *   declining          ≥ 20 Prozentpunkte niedriger
 *   stable             sonst
 *
 * Bei typischen Fehlern heißt "richtig": Fehler vermieden. "plateau" (Stufe bewegt sich
 * trotz Übung nicht) braucht den Verlauf über mehrere Stichtage und wird im Coaching
 * erkannt (coaching/analysis.js).
 */
export const TRENDS = Object.freeze(["insufficient_data", "improving", "stable", "declining", "plateau"]);
export const TREND_RULES = Object.freeze({ minSignalsPerWindow: 3, minDelta: 0.2 });

export function classifyTrend(basis) {
  const rate = (w) => w.successes / (w.successes + w.failures);
  const enough = (w) => w.successes + w.failures >= TREND_RULES.minSignalsPerWindow;
  if (!enough(basis.recent) || !enough(basis.previous)) return "insufficient_data";
  const delta = rate(basis.recent) - rate(basis.previous);
  if (delta >= TREND_RULES.minDelta) return "improving";
  if (delta <= -TREND_RULES.minDelta) return "declining";
  return "stable";
}

// ---------------------------------------------------------------- Hilfen

function atLeast(level, minimum) {
  return level !== null && evidenceRank(level) >= evidenceRank(minimum);
}

function daysBetween(fromIso, toIso) {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}
