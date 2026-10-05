/**
 * Vom Lernereignis zur Messung des Sprachprofils (P11B). Rein, deterministisch.
 *
 * Quelle sind allein die attempt-Ereignisse EINER Sprache und EINES Lerners mit ihrer Bewertung
 * (EvaluationResult v2). Jeder Versuch liefert höchstens eine Messung je Kompetenzbereich:
 *
 *   Einstufungsaufgabe (assessment/…)   → ihr Bereich; richtig/falsch; Schwierigkeit = Stufe der Aufgabe
 *   Übung: Strukturen/typische Fehler   → grammar;    Anteil gezeigt; Schwierigkeit = Stufe der Skills
 *   Übung: Ausdrücke                    → vocabulary; Anteil gezeigt; Schwierigkeit = Stufe der Skills
 *   offene Antwort, getippt             → production;   Leistungswert; Schwierigkeit = Stufe der Übung
 *   im Gespräch oder gesprochen         → conversation; Leistungswert; Schwierigkeit = Stufe der Übung
 *   Leseverstehen                       → reading
 *   Höraufgabe (P15)                    → listening; Hörleistung (listening/model.js), Gewicht × Hilfe × 1/n Hören;
 *                                         KEINE Grammatik-/Wortschatzmessung (falsch gehört ≠ nicht gekonnt);
 *                                         Antwortaufgabe zusätzlich production (Sprache der Antwort)
 *
 * Leistungswert einer offenen Antwort: Ziel verfehlt (zu kurz, Aufgabe nicht erfüllt) → 0; sonst 0,5 + 0,5 ×
 * Anteil der gezeigten Lernziele (ohne Lernziele 0,75), je erkanntem Fehler −0,25 (P14A: ein Text mit einem
 * Präpositionsfehler ist eine Teilleistung, nicht "nichts gekonnt"). KI-Hinweise (supplemental) und unsichere Beobachtungen ("low",
 * "not_observable") zählen nie. Einstufungsantworten liefern NUR die Messung ihres Bereichs (keine
 * zweite Zählung über ihre Beobachtungen).
 */

import { BLOCKING_SEVERITIES, readEvaluation } from "../../evaluation/result.js";
import { EVIDENCE_WEIGHT } from "../competence/evidence.js";
import { levelValue } from "./scale.js";
import { contextKey, guessingOf, isListening, listeningScore, listeningWeight } from "../listening/model.js";

export const DIMENSIONS = Object.freeze(["grammar", "vocabulary", "reading", "listening", "production", "conversation"]);
// Verstehensaufgaben messen Lesen bzw. Hören. Andere Auswahlaufgaben (multiple_choice, P12) zählen über ihre
// Skill-Beobachtungen zu Grammatik bzw. Wortschatz, nie zu Lesen oder Hören.
const COMPREHENSION_DIMENSION = Object.freeze({ reading_comprehension: "reading", listening_comprehension: "listening" });
export const PROFILE_EVIDENCE_RULES = Object.freeze({
  level_offset: 0.3, // eine Aufgabe der Stufe B2 hat die Schwierigkeit 4,3 (B2 = [4, 5))
  evidence_offset: { recognized: -0.5, controlled: -0.3, guided: 0, free: 0.2, spontaneous: 0.3 },
  reliability_weight: { high: 1, medium: 0.5 },
  max_skill_weight: 1.5,
  open_weight: 1,
  error_penalty: 0.25, // je erkanntem Fehler in einer offenen Antwort (P14A)
  challenge_weight: 1.5,
  conversation_weight: 1.5,
  assessment_weight: 1,
});

const R = PROFILE_EVIDENCE_RULES;

/**
 * @param {{events: object[], library: import("../../content/library.js").ContentLibrary}} input
 * @returns {{at: string, dimension: string, difficulty: number, score: number, weight: number, guessing: number,
 *   source: "assessment"|"practice", attempt_id: string, assessment_id: string|null}[]}  zeitlich sortiert
 */
export function collectMeasurements({ events, library }) {
  const assessmentOf = new Map(events
    .filter((e) => e.event_type === "assessment_response")
    .map((e) => [e.payload.attempt_id, e.payload.assessment_id]));
  const attempts = [...new Map(events.filter((e) => e.event_type === "attempt").map((e) => [e.id, e])).values()]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const skillLevels = new Map(library.skills().filter((sk) => sk.level).map((sk) => [sk.id, levelValue(sk.level)]));
  const skillDimensions = new Map(library.skills().map((sk) => [sk.id, dimensionOfSkill(sk, library)]));
  const competenceOf = new Map(library.commonErrors().filter((e) => e.competence).map((e) => [`common_error:${e.id}`, e.competence]));
  const out = [];
  for (const attempt of attempts) {
    const view = safeView(attempt.payload.evaluation);
    if (!view) continue;
    const exercise = library.anyExercise(attempt.payload.exercise_id);
    const base = { at: attempt.created_at, attempt_id: attempt.id, assessment_id: assessmentOf.get(attempt.id) ?? null,
      item_id: String(attempt.payload.exercise_id) };
    const item = library.assessmentItem(String(attempt.payload.exercise_id).replace(/^assessment\//, ""));
    if (item && exercise) {
      out.push({ ...base, source: "assessment", ...assessmentMeasurement(item, exercise, view) });
      continue;
    }
    if (!exercise) continue; // Übung nicht (mehr) im Paket: keine Stufe bekannt
    out.push(...practiceMeasurements(exercise, view, attempt, skillLevels, skillDimensions, competenceOf).map((m) => ({ ...base, source: "practice", ...m })));
  }
  for (const skip of events.filter((e) => e.event_type === "assessment_item_skipped" && e.payload.reason === "dont_know")) {
    const item = library.assessmentItem(skip.payload.item_id);
    if (!item) continue;
    out.push({ at: skip.created_at, attempt_id: null, assessment_id: skip.payload.assessment_id, source: "assessment",
      item_id: `assessment/${skip.payload.item_id}`,
      dimension: item.dimension, difficulty: levelValue(item.level) + R.level_offset, score: 0, weight: R.assessment_weight, guessing: 0 });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function assessmentMeasurement(item, exercise, view) {
  const closed = item.format === "choice";
  return {
    dimension: item.dimension,
    difficulty: levelValue(item.level) + R.level_offset,
    score: closed ? (view.overall.outcome === "correct" ? 1 : 0) : performanceScore(exercise, view),
    weight: R.assessment_weight,
    guessing: closed ? 1 / Math.max(2, item.options.length) : 0,
  };
}

function practiceMeasurements(exercise, view, attempt, skillLevels, skillDimensions, competenceOf = new Map()) {
  if (isListening(exercise)) return listeningMeasurements(exercise, view, attempt);
  const result = [];
  const counted = view.observations.filter((o) => o.authoritative && (o.outcome === "demonstrated" || o.outcome === "error")
    && R.reliability_weight[o.reliability]);
  // P14A: ein typischer Fehler und seine verletzte Kompetenz sind EIN Befund (depende en → depender de), keine zwei
  const observed = new Set(counted.map((o) => o.skill_id));
  const usable = counted.filter((o) => !(competenceOf.has(o.skill_id) && observed.has(competenceOf.get(o.skill_id))));
  for (const dimension of ["grammar", "vocabulary"]) {
    const observed = usable.filter((o) => (skillDimensions.get(o.skill_id) ?? defaultDimension(o.skill_type)) === dimension);
    if (!observed.length) continue;
    const levels = observed.map((o) => skillLevels.get(o.skill_id) ?? (exercise.level ? levelValue(exercise.level) : null)).filter((v) => v !== null);
    if (!levels.length) continue;
    const weight = Math.min(R.max_skill_weight, observed.reduce((sum, o) =>
      sum + (EVIDENCE_WEIGHT[o.evidence] ?? 1) / 2 * R.reliability_weight[o.reliability], 0));
    const offset = mean(observed.map((o) => R.evidence_offset[o.evidence] ?? 0));
    result.push({
      dimension,
      difficulty: mean(levels) + R.level_offset + offset,
      score: observed.filter((o) => o.outcome === "demonstrated").length / observed.length,
      weight,
      guessing: 0,
    });
  }
  const exerciseLevel = exercise.level ? levelValue(exercise.level) + R.level_offset : null;
  if (exerciseLevel !== null && COMPREHENSION_DIMENSION[exercise.type]) {
    result.push({ dimension: COMPREHENSION_DIMENSION[exercise.type], difficulty: exerciseLevel,
      score: view.overall.outcome === "correct" ? 1 : 0, weight: 1, guessing: 0.25 });
  } else if (exerciseLevel !== null && exercise.evaluation_mode === "open") {
    const spoken = Boolean(attempt.payload.conversation_id) || exercise.type === "conversation" || attempt.payload.input_mode === "speech";
    result.push({
      dimension: spoken ? "conversation" : "production",
      difficulty: exerciseLevel,
      score: performanceScore(exercise, view),
      weight: spoken ? R.conversation_weight : exercise.mode === "challenge" ? R.challenge_weight : R.open_weight,
      guessing: 0,
    });
  }
  return result;
}

/** P15: Höraufgabe → Hören (Hörleistung), Antwortaufgabe zusätzlich Produktion (die Antwort selbst). */
function listeningMeasurements(exercise, view, attempt) {
  if (!exercise.level) return [];
  const difficulty = levelValue(exercise.level) + R.level_offset;
  const context = attempt.payload.listening ?? { play_count: 1, support_level: exercise.listening?.base_support ?? "question" };
  const out = [{
    dimension: "listening",
    // P16: Aufgaben derselben Aufnahme teilen einen Kontext (k-te verschiedene Aufgabe zählt 1/k, language-profile.js)
    context_id: exercise.listening?.context ? contextKey(exercise) : null,
    difficulty,
    score: listeningScore(exercise, { outcome: view.overall.outcome, answerText: attempt.payload.answer_text }),
    weight: listeningWeight(context),
    guessing: guessingOf(exercise),
  }];
  if (exercise.type === "listening_response") {
    out.push({ dimension: "production", difficulty, score: performanceScore(exercise, view), weight: R.open_weight, guessing: 0 });
  }
  return out;
}

/**
 * Kompetenzbereich eines Skills (P12): Ausdrücke → Wortschatz, Strukturen → Grammatik. Ein typischer Fehler zählt
 * zum Bereich seiner verletzten Kompetenz (depender_en → lexical_item:depender_de → Wortschatz) bzw. seines Themas
 * (vocabulary.* → Wortschatz), sonst zur Grammatik.
 */
export function dimensionOfSkill(skill, library) {
  if (skill.type !== "common_error") return defaultDimension(skill.type);
  const error = library.commonError(skill.ref_id ?? skill.id.split(":")[1]);
  if (error?.competence?.startsWith("lexical_item:")) return "vocabulary";
  if (error?.competence?.startsWith("grammar_structure:")) return "grammar";
  return (skill.topic_id ?? error?.topic_id ?? "").startsWith("vocabulary") ? "vocabulary" : "grammar";
}

function defaultDimension(skillType) {
  return skillType === "lexical_item" ? "vocabulary" : "grammar";
}

/** Leistungswert einer offenen Antwort (0–1) aus der Regelbewertung. */
export function performanceScore(exercise, view) {
  const blocking = view.findings.filter((f) => f.authoritative && BLOCKING_SEVERITIES.includes(f.severity));
  if (blocking.some((f) => f.severity !== "error")) return 0;
  const penalty = R.error_penalty * blocking.length;
  const expected = [
    ...(exercise.structures ?? []).filter((s) => s.is_target).map((s) => `grammar_structure:${s.rule_id}`),
    ...(exercise.target_items ?? []).map((id) => `lexical_item:${id}`),
  ];
  if (!expected.length) return Math.max(0, 0.75 - penalty);
  const shown = new Set(view.observations.filter((o) => o.authoritative && o.outcome === "demonstrated").map((o) => o.skill_id));
  return Math.max(0, 0.5 + 0.5 * (expected.filter((id) => shown.has(id)).length / expected.length) - penalty);
}

function safeView(evaluation) {
  try {
    return readEvaluation(evaluation);
  } catch {
    return null;
  }
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
