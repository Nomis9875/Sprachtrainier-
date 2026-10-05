/**
 * Skill Coverage: Wie gut decken die vorhandenen Inhalte einen Skill ab?
 *
 * Reine Analyse des Inhaltspakets, keine Lerndaten, kein Zufall, keine KI. Wiederverwendet:
 * Nachweisstufe je Übung (evidenceForExercise), "trainiert die Übung den Skill?" (isTargetOf),
 * die Entwicklungsstufen des Coachings (DEVELOPMENT_STAGES) und die Sessionlängen des Planners.
 *
 * ─── Beobachtbarkeit (so arbeitet die Regelbewertung, core/evaluation/answer_check.py) ───
 *
 *   grammar_structure  in JEDER freien/spontanen Antwort (alle Detektoren laufen), in geschlossenen
 *                      Übungen nur als deren Lernziel; ohne Detektor nie als "verwendet"
 *   lexical_item       wie grammar_structure
 *   common_error       Fehler in JEDER Antwort erkannt (alle Fehler-Detektoren laufen immer);
 *                      "vermieden" nur, wenn der Fehler ein Muster für die richtige Form hat
 *
 *   Beiläufige Treffer zählen nur so viel, wie der Detektor verlässlich ist (detect_reliability:
 *   high voll, medium halb, low gar nicht). Transfer ist deshalb nur mit Detektor ≥ medium erkennbar.
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { DEVELOPMENT_STAGES } from "../coaching/analysis.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { isAdvancedTopic } from "../planning/needs.js";
import { PLANNER_RULES, SESSION_LENGTHS, isTargetOf } from "../planning/planner.js";

export const OBSERVATION_SCOPE = Object.freeze({
  [SKILL_TYPES.GRAMMAR_STRUCTURE]: "all_free_answers",
  [SKILL_TYPES.LEXICAL_ITEM]: "all_free_answers",
  [SKILL_TYPES.COMMON_ERROR]: "all_answers",
});

/** Die drei Produktionsstufen, nach denen klassifiziert wird (wie im Coaching zusammengefasst). */
export const PRODUCTION_STAGES = Object.freeze({
  controlled: ["controlled", "guided"],
  free: ["free"],
  spontaneous: ["spontaneous"],
});

/**
 *   MISSING  keine Übung
 *   WEAK     Übungen nur auf einer Produktionsstufe
 *   PARTIAL  Übungen auf zwei der drei Produktionsstufen
 *   GOOD     alle drei Produktionsstufen (kontrolliert, frei, spontan) abgedeckt
 *   STRONG   alle drei Stufen mit je ≥ 2 Übungen und ≥ 2 Übungen, in denen der Skill Lernziel ist
 */
export const COVERAGE_CLASSES = Object.freeze(["MISSING", "WEAK", "PARTIAL", "GOOD", "STRONG"]);
export const COVERAGE_RULES = Object.freeze({ strongPerStage: 2, strongTargets: 2 });

/**
 * @param {import("../../content/library.js").ContentLibrary} library
 * @param {string} skillId
 */
export function skillCoverage(library, skillId) {
  const skill = library.skill(skillId);
  const exercises = library.exercisesForSkill(skillId).map((exercise) => describeExercise(exercise, skillId));
  const byStage = Object.fromEntries(Object.entries(PRODUCTION_STAGES).map(([stage, levels]) => [
    stage, exercises.filter((e) => levels.includes(e.evidence)),
  ]));
  const counts = {
    exercises: exercises.length,
    target_exercises: exercises.filter((e) => e.role === "target").length,
    observed_exercises: exercises.filter((e) => e.role === "observed").length,
    controlled: byStage.controlled.length,
    free: byStage.free.length,
    spontaneous: byStage.spontaneous.length,
  };
  const detection = detectionOf(library, skill);
  return {
    skill_id: skillId,
    type: skill.type,
    level: skill.level,
    topic_id: skill.topic_id,
    advanced_topic: isAdvancedTopic(library, skill.topic_id),
    label: skill.label,
    error_kind: skill.type === SKILL_TYPES.COMMON_ERROR ? library.commonError(skill.ref_id)?.kind ?? null : null,
    counts,
    by_evidence: countBy(exercises, "evidence"),
    production_forms: [...new Set(exercises.map((e) => e.type))].sort(),
    classification: classify(counts, byStage),
    path: trainingPath(skill.type, byStage, detection, exercises.filter((e) => e.evidence === "recognized")),
    detection,
    transfer_observable: transferObservable(library, skill, detection),
    exercises,
  };
}

function describeExercise(exercise, skillId) {
  return {
    exercise_id: exercise.id,
    type: exercise.type,
    mode: exercise.mode,
    level: exercise.level,
    stage: exercise.stage,
    evidence: evidenceForExercise(exercise),
    estimated_seconds: exercise.estimated_seconds,
    min_session_minutes: minSessionMinutes(exercise.estimated_seconds),
    role: isTargetOf(exercise, skillId) ? "target" : "observed",
    status: exercise.status,
  };
}

/** Genau eine Einstufung je Skill (Regeln oben). */
export function classify(counts, byStage) {
  const covered = Object.values(byStage).filter((list) => list.length > 0).length;
  if (counts.exercises === 0) return "MISSING";
  if (covered <= 1) return "WEAK";
  if (covered === 2) return "PARTIAL";
  const thick = Object.values(byStage).every((list) => list.length >= COVERAGE_RULES.strongPerStage);
  return thick && counts.target_exercises >= COVERAGE_RULES.strongTargets ? "STRONG" : "GOOD";
}

// ---------------------------------------------------------------- Entwicklungspfad

/**
 * Kann der Nutzer den ganzen Entwicklungspfad mit vorhandenen Inhalten durchlaufen?
 *
 *   grammar_structure  controlled → free → spontaneous
 *   lexical_item       recognized → reproduced → used_freely → used_spontaneously
 *                      ("recognized" über eine Auswahlaufgabe (P12) oder, ohne sie, über Karteikarten
 *                       aus dem Lexikoneintrag; der Planner plant Karteikarten bisher nicht)
 *   common_error       detected → trained → avoided_free → avoided_spontaneous
 *                      (detected = Fehler-Detektor; trained = kontrollierte/geführte Übung,
 *                       die den Fehler provoziert; avoided_* = freie/spontane Übung, die ihn provoziert,
 *                       und "vermieden" ist überhaupt beobachtbar)
 *
 * complete = alle Schritte verfügbar; ends_after = letzter Schritt, bis zu dem der Pfad
 * lückenlos läuft (null, wenn schon der erste fehlt); missing = alle fehlenden Schritte.
 */
export function trainingPath(type, byStage, detection, recognition = []) {
  const step = (stage, available, via, exerciseIds = []) => ({ stage, available, via, exercises: exerciseIds });
  const ids = (list) => list.map((e) => e.exercise_id);
  let steps;
  if (type === SKILL_TYPES.COMMON_ERROR) {
    steps = [
      step("detected", detection.detector, detection.detector ? "error_detector" : null),
      step("trained", byStage.controlled.length > 0, "exercise", ids(byStage.controlled)),
      step("avoided_free", byStage.free.length > 0 && detection.avoidance_detectable, "exercise", ids(byStage.free)),
      step("avoided_spontaneous", byStage.spontaneous.length > 0 && detection.avoidance_detectable, "exercise", ids(byStage.spontaneous)),
    ];
  } else {
    const names = DEVELOPMENT_STAGES[type].map(([name]) => name);
    const [recognized, controlled, free, spontaneous] = names;
    steps = [
      step(controlled, byStage.controlled.length > 0, "exercise", ids(byStage.controlled)),
      step(free, byStage.free.length > 0, "exercise", ids(byStage.free)),
      step(spontaneous, byStage.spontaneous.length > 0, "exercise", ids(byStage.spontaneous)),
    ];
    if (type === SKILL_TYPES.LEXICAL_ITEM) {
      steps.unshift(recognition.length
        ? step(recognized, true, "exercise", ids(recognition))
        : step(recognized, detection.flashcard, "lexicon_flashcard"));
    }
  }
  let endsAfter = null;
  for (const s of steps) {
    if (!s.available) break;
    endsAfter = s.stage;
  }
  const missing = steps.filter((s) => !s.available).map((s) => s.stage);
  return {
    steps,
    complete: missing.length === 0,
    ends_after: endsAfter,
    missing,
    // "realistisch": freie Produktion ist erreichbar (für Fehler: der Fehler lässt sich überhaupt provozieren)
    realistic: type === SKILL_TYPES.COMMON_ERROR
      ? steps.slice(1).some((s) => s.available)
      : steps.some((s) => ["free", "used_freely", "spontaneous", "used_spontaneously"].includes(s.stage) && s.available),
  };
}

/**
 * Transfer ist erkennbar, wenn der Skill einen verlässlichen Detektor hat (nicht "low") und es
 * mindestens eine freie/spontane offene Übung gibt, die ihn NICHT als Lernziel führt: Dort wird er
 * beiläufig beobachtet. Welche Übungen den Skill tatsächlich trainiert haben, entscheidet später
 * die Lerngeschichte (Snapshot), nicht diese Inhaltsanalyse.
 */
function transferObservable(library, skill, detection) {
  if (skill.type === SKILL_TYPES.COMMON_ERROR || !detection.detector || detection.incidental_reliability === "low") return false;
  return library.exercises().some((e) => e.evaluation_mode === "open" && !isTargetOf(e, skill.id)
    && ["free", "spontaneous"].includes(evidenceForExercise(e)));
}

/** Kann die Regelbewertung den Skill überhaupt erkennen, und wie verlässlich beiläufig? (aus den Inhalten) */
function detectionOf(library, skill) {
  if (skill.type === SKILL_TYPES.GRAMMAR_STRUCTURE) {
    const rule = library.grammarRule(skill.ref_id);
    return {
      scope: OBSERVATION_SCOPE[skill.type],
      detector: hasPatterns(rule?.detector),
      incidental_reliability: hasPatterns(rule?.detector) ? rule.detector.reliability ?? "high" : null,
    };
  }
  if (skill.type === SKILL_TYPES.LEXICAL_ITEM) {
    const item = library.lexicalItem(skill.ref_id);
    return {
      scope: OBSERVATION_SCOPE[skill.type],
      detector: hasPatterns(item?.detector),
      incidental_reliability: hasPatterns(item?.detector) ? item.detector.reliability ?? "high" : null,
      flashcard: Boolean(item?.text_es && item?.meaning_de),
    };
  }
  const error = library.commonError(skill.ref_id);
  return {
    scope: OBSERVATION_SCOPE[skill.type],
    detector: hasPatterns(error?.wrong),
    avoidance_detectable: hasPatterns(error?.correct),
    avoidance_reliability: hasPatterns(error?.correct) ? error.correct.reliability ?? "high" : null,
  };
}

/** Kürzeste Sessionlänge, in die die Übung passt (Budget des Planners inkl. Toleranz). */
export function minSessionMinutes(seconds) {
  const fits = Object.keys(SESSION_LENGTHS).map(Number).sort((a, b) => a - b)
    .find((minutes) => seconds <= Math.floor(minutes * 60 * (1 - PLANNER_RULES.safetyMargin)));
  return fits ?? null;
}

function hasPatterns(detector) {
  return Array.isArray(detector?.patterns) && detector.patterns.length > 0;
}

function countBy(list, key) {
  // "recognized": Auswahlaufgaben (P12); zählen nicht als Produktionsstufe, werden aber ausgewiesen
  const counts = { recognized: 0, controlled: 0, guided: 0, free: 0, spontaneous: 0 };
  for (const item of list) counts[item[key]] += 1;
  return counts;
}
