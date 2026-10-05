/**
 * Coaching-Analysen je Skill: reine, deterministische Regeln über dem CompetenceSnapshot.
 *
 * Keine KI, keine Statistikmodelle. Jede Funktion gibt neben dem Befund die Zahlen
 * zurück, auf denen er beruht (evidence), damit jede Aussage im Bericht belegbar ist.
 *
 *   developmentProfile  Grammatik: erkannt → kontrolliert → frei → spontan produziert
 *                       Wortschatz: erkannt → reproduziert → frei verwendet → spontan verwendet
 *   falseConfidence     hohe Quote, aber nur unter Kontrolle (siehe FALSE_CONFIDENCE_RULES)
 *   plateau             Stufe bewegt sich trotz Übung über 4 Wochen nicht (PLATEAU_RULES)
 *   transfer            Skill gelingt beiläufig frei/spontan, nachdem er anderswo als Lernziel geübt wurde
 *   errorPatterns       wiederkehrend, hartnäckig (persistent_error), sich bessernd
 *   progression         Veränderung der Stufe über die Stichtage des Verlaufs
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { MASTERY_LEVELS } from "../competence/mastery.js";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- Entwicklung

/** Stufen der Entwicklung je Typ: Name → Nachweisstufen. */
export const DEVELOPMENT_STAGES = Object.freeze({
  [SKILL_TYPES.GRAMMAR_STRUCTURE]: Object.freeze([
    ["recognized", ["recognized"]],
    ["controlled", ["controlled", "guided"]],
    ["free", ["free"]],
    ["spontaneous", ["spontaneous"]],
  ]),
  [SKILL_TYPES.LEXICAL_ITEM]: Object.freeze([
    ["recognized", ["recognized"]],
    ["reproduced", ["controlled", "guided"]],
    ["used_freely", ["free"]],
    ["used_spontaneously", ["spontaneous"]],
  ]),
});

/**
 * @returns {null | {reached: string|null, stages: Object<string, {successes: number, failures: number}>}}
 *   reached = höchste Stufe mit Erfolgen ≥ 1 (wie der Pfad im Snapshot)
 */
export function developmentProfile(skill) {
  const ladder = DEVELOPMENT_STAGES[skill.type];
  if (!ladder) return null;
  const stages = {};
  let reached = null;
  for (const [name, levels] of ladder) {
    const successes = round(levels.reduce((sum, l) => sum + skill.evidence[l].successes, 0));
    const failures = round(levels.reduce((sum, l) => sum + skill.evidence[l].failures, 0));
    stages[name] = { successes, failures };
    if (successes >= 1) reached = name;
  }
  return { reached, stages };
}

// ---------------------------------------------------------------- Falsche Sicherheit

/**
 *   controlled_only   ≥ 3 Erfolge unter Kontrolle (controlled/guided), zuletzt ≥ 80 % richtig,
 *                     aber kein einziger freier oder spontaner Erfolg
 *   weak_when_free    unter Kontrolle ≥ 3 Erfolge bei ≥ 80 %, frei/spontan aber ≥ 2 Versuche
 *                     mit < 50 % richtig
 *   mostly_controlled ≥ 10 Erfolge unter Kontrolle und mindestens 5-mal so viele wie freie und
 *                     spontane zusammen (z. B. 18 zu 1): sicher im Lückentext, frei kaum belegt
 *   not_spontaneous   "stable"/"mastered", aber nie spontan verwendet
 */
export const FALSE_CONFIDENCE_RULES = Object.freeze({
  minControlled: 3, controlledRate: 0.8, minFree: 2, freeRate: 0.5, mostlyMinControlled: 10, mostlyRatio: 5,
});

export function falseConfidence(skill) {
  const profile = developmentProfile(skill);
  if (!profile) return null;
  const [, controlledName, freeName, spontaneousName] = Object.keys(profile.stages);
  const controlled = profile.stages[controlledName];
  const free = sum(profile.stages[freeName], profile.stages[spontaneousName]);
  const rules = FALSE_CONFIDENCE_RULES;
  const controlledRate = rate(controlled);
  const evidence = {
    controlled_successes: controlled.successes,
    controlled_failures: controlled.failures,
    free_successes: profile.stages[freeName].successes,
    free_failures: profile.stages[freeName].failures,
    spontaneous_successes: profile.stages[spontaneousName].successes,
    spontaneous_failures: profile.stages[spontaneousName].failures,
    recent_accuracy: skill.recent_accuracy,
    mastery: skill.mastery,
  };
  if (controlled.successes >= rules.minControlled && controlledRate >= rules.controlledRate) {
    if (free.successes === 0 && free.failures === 0 && (skill.recent_accuracy ?? 0) >= rules.controlledRate) {
      return { kind: "controlled_only", evidence };
    }
    if (free.successes + free.failures >= rules.minFree && rate(free) < rules.freeRate) {
      return { kind: "weak_when_free", evidence };
    }
    if (controlled.successes >= rules.mostlyMinControlled && controlled.successes >= rules.mostlyRatio * free.successes) {
      return { kind: "mostly_controlled", evidence };
    }
  }
  if (["stable", "mastered"].includes(skill.mastery) && profile.stages[spontaneousName].successes === 0) {
    return { kind: "not_spontaneous", evidence };
  }
  return null;
}

// ---------------------------------------------------------------- Plateau

/**
 * Plateau: Die Beherrschungsstufe ist an allen Stichtagen der letzten 4 Wochen
 * (heute, −7, −14, −21, −28 Tage) dieselbe und liegt bei "introduced" oder "practicing",
 * OBWOHL geübt wurde: im Zeitraum ≥ 4 Nachweise an ≥ 3 Tagen.
 * Ohne Übung ist es kein Plateau, sondern Pause. Nur für Grammatik und Wortschatz; bei
 * typischen Fehlern beschreiben Fehlerpfad und persistent_error denselben Stillstand.
 */
export const PLATEAU_RULES = Object.freeze({ levels: ["introduced", "practicing"], minSignals: 4, minDays: 3 });

/**
 * @param {object} skill
 * @param {{at: string, mastery: string}[]} timeline  Stichtage, ältester zuerst (letzter = heute)
 */
export function plateau(skill, timeline) {
  if (timeline.length < 2 || skill.type === SKILL_TYPES.COMMON_ERROR) return null;
  const level = timeline.at(-1).mastery;
  if (!PLATEAU_RULES.levels.includes(level) || timeline.some((t) => t.mastery !== level)) return null;
  const from = timeline[0].at.slice(0, 10);
  const days = skill.history_by_day.filter((d) => d.day > from);
  const signals = days.reduce((total, d) => total + d.successes + d.failures, 0);
  if (signals < PLATEAU_RULES.minSignals || days.length < PLATEAU_RULES.minDays) return null;
  return {
    level,
    evidence: {
      levels: timeline.map((t) => ({ at: t.at, mastery: t.mastery })),
      window_days: daysBetween(timeline[0].at, timeline.at(-1).at),
      signals_in_window: signals,
      practice_days_in_window: days.length,
      recent_accuracy: skill.recent_accuracy,
    },
  };
}

// ---------------------------------------------------------------- Transfer

/**
 * Transfer: Der Skill gelingt frei oder spontan beiläufig (incidental) in einer Übung, nachdem er
 * vorher in einer ANDEREN Übung als Lernziel geübt wurde. Das ist ein stärkeres Signal als ein
 * Erfolg in der Übung, für die er gedacht war.
 *
 * Datengrundlage: die Beobachtungen selbst (Snapshot: transfer, trained_in aus den Ereignissen),
 * nicht der aktuelle Inhalt. Ändert sich eine Übung später, ändert sich nicht rückwirkend, was
 * Transfer war. Ältere Beobachtungen ohne Art ergeben nie Transfer.
 */
export function transfer(skill) {
  if (skill.type === SKILL_TYPES.COMMON_ERROR) return null;
  const transferredTo = (skill.transfer ?? []).map((c) => ({
    exercise_id: c.exercise_id, successes: c.successes, highest_success_evidence: c.highest_success_evidence,
  }));
  return {
    detected: transferredTo.length > 0,
    trained_in: skill.trained_in ?? [],
    transferred_to: transferredTo,
    spontaneous: transferredTo.some((t) => t.highest_success_evidence === "spontaneous"),
  };
}

// ---------------------------------------------------------------- Fehlermuster

/**
 *   recurring    in den letzten 14 Tagen ≥ 3 Fehler an ≥ 2 Tagen ("7 Fehler in 10 Tagen")
 *   persistent   typischer Fehler an ≥ 4 Tagen, erster bis letzter Fehler ≥ 21 Tage auseinander,
 *                Fehlerpfad nicht "resolved": Kandidat für einen fossilierten Fehler
 *   improvement  typischer Fehler an ≥ 2 Tagen aufgetreten, Fehlerpfad jetzt "declining" oder "resolved"
 */
export const ERROR_PATTERN_RULES = Object.freeze({
  recurringWindowDays: 14, recurringMinFailures: 3, recurringMinDays: 2,
  persistentMinDays: 4, persistentMinSpanDays: 21,
  improvementMinDays: 2,
});

export function errorPatterns(skill, asOf) {
  const failureDays = skill.history_by_day.filter((d) => d.failures > 0);
  if (!failureDays.length) return { recurring: null, persistent: null, improvement: null };
  const rules = ERROR_PATTERN_RULES;
  const windowStart = shiftDay(asOf.toISOString().slice(0, 10), -(rules.recurringWindowDays - 1));
  const recent = failureDays.filter((d) => d.day >= windowStart);
  const recentFailures = recent.reduce((total, d) => total + d.failures, 0);
  const first = failureDays[0].day;
  const last = failureDays.at(-1).day;
  const span = daysBetween(`${first}T00:00:00Z`, `${last}T00:00:00Z`);
  const isError = skill.type === SKILL_TYPES.COMMON_ERROR;

  const recurring = recentFailures >= rules.recurringMinFailures && recent.length >= rules.recurringMinDays
    ? { failures: recentFailures, days: recent.length, window_days: rules.recurringWindowDays, since: windowStart }
    : null;
  const persistent = isError && failureDays.length >= rules.persistentMinDays && span >= rules.persistentMinSpanDays
    && skill.path.stage !== "resolved"
    ? {
      occurrence_days: failureDays.length, occurrences: skill.errors.occurrences, first_day: first, last_day: last,
      span_days: span, path_stage: skill.path.stage, avoided_since_last: skill.since_last_failure.successes,
    }
    : null;
  const improvement = isError && failureDays.length >= rules.improvementMinDays && ["declining", "resolved"].includes(skill.path.stage)
    ? {
      occurrence_days: failureDays.length, last_day: last, path_stage: skill.path.stage,
      avoided_since_last: skill.since_last_failure.successes, days_since_last: skill.errors.days_since_last,
    }
    : null;
  return { recurring, persistent, improvement };
}

// ---------------------------------------------------------------- Verlauf

/** Veränderung der Beherrschungsstufe und der Entwicklungsstufe über die Stichtage. */
export function progression(timeline) {
  const first = timeline[0];
  const last = timeline.at(-1);
  return {
    from: first.mastery,
    to: last.mastery,
    steps: MASTERY_LEVELS.indexOf(last.mastery) - MASTERY_LEVELS.indexOf(first.mastery),
    highest_from: first.highest_success_evidence,
    highest_to: last.highest_success_evidence,
    window_days: daysBetween(first.at, last.at),
  };
}

// ---------------------------------------------------------------- Hilfen

function sum(a, b) {
  return { successes: a.successes + b.successes, failures: a.failures + b.failures };
}

function rate(stage) {
  const total = stage.successes + stage.failures;
  return total ? stage.successes / total : 0;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
