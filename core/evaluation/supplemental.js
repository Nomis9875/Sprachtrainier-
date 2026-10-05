/**
 * KI-Zusatzanalyse (Qwen) in eine Bewertung übernehmen: nur als Ergänzung, nie gegen die Regeln.
 *
 * Gegenstück: core/coach/supplemental.py (Prompt, Schema, erste Prüfung). Hier wird die Antwort des
 * lokalen Servers noch einmal streng geprüft, bevor sie in das EvaluationResult v2 kommt:
 *
 * - Nur Hinweise (findings) mit Quelle "llm" und Autorität "supplemental". Keine Beobachtungen
 *   (also keine Kompetenz, kein Gedächtnis, keine Lernbedarfe), kein error_key (also keine neue
 *   Fehlerklasse, kein Fehlerereignis), kein Skill, kein Gesamturteil.
 * - Hat die Regel/Referenz die Antwort sicher als richtig bewertet, werden ERROR-Hinweise verworfen.
 * - Hinweise zur selben Stelle wie ein Regelbefund verwirft addLlmAnalysis (Regel hat Vorrang).
 * - Keine Hinweise zu Stellen aus einer Referenzantwort der Übung (die ist geprüft richtig).
 * - GERMAN_INFLUENCE nur als ERROR/UNNATURAL; Erklärung mindestens 3 Wörter, nicht = Vorschlag.
 *   (Gemessen mit qwen2.5:3b, siehe docs/sprache.md.)
 * - Jede Stelle muss wörtlich in der Antwort stehen; höchstens MAX_SUPPLEMENTAL Hinweise.
 * - Ist irgendetwas ungültig, bleibt die Bewertung unverändert (status "invalid").
 *
 * Kategorien → Befundart (SEVERITY_BY_KIND):
 *   ERROR → GRAMMATICAL_ERROR | PREPOSITION_ERROR (PREPOSITION, POR_PARA) | WRONG_WORD (Wortwahl,
 *           Vokabular, Kollokation) | GERMANISM (GERMAN_INFLUENCE)
 *   UNNATURAL → UNNATURAL (REPETITION → REPETITION)
 *   CORRECT_BUT_SIMPLE → CORRECT_BUT_SIMPLE;  IDIOMATIC_UPGRADE, STYLE → IDIOMATIC_UPGRADE
 */

import { LLM_TOPIC_BY_CATEGORY, addLlmAnalysis, resultVersion, validateEvaluationResult } from "./result.js";
import { normalize } from "./text.js";

export const SUPPLEMENTAL_CATEGORIES = Object.freeze(["ERROR", "UNNATURAL", "CORRECT_BUT_SIMPLE", "IDIOMATIC_UPGRADE", "STYLE"]);
export const MAX_SUPPLEMENTAL = 3;
const FINDING_KEYS = ["category", "topic", "original", "suggestion", "explanation_de"];
const SAFE_DECIDERS = new Set(["reference", "rule"]);
const GERMANISM_CATEGORIES = Object.freeze(["ERROR", "UNNATURAL"]);
const MAX_TEXT = 300;

/**
 * @param {object} evaluation EvaluationResult v2 der Regeln (bleibt unverändert)
 * @param {unknown} analysis  Antwort von POST /api/analyze: {model, findings[], discarded?, processing_seconds?}
 * @param {{references?: string[]}} [options] Referenzantworten der Übung (accepted_answers)
 * @returns {{evaluation: object, status: "ok"|"invalid", added: number, discarded: number}}
 */
export function mergeSupplemental(evaluation, analysis, { references = [] } = {}) {
  if (resultVersion(evaluation) !== 2) throw new TypeError("mergeSupplemental erwartet EvaluationResult v2");
  const unchanged = (discarded = 0) => ({ evaluation, status: "invalid", added: 0, discarded });
  if (!isObject(analysis) || typeof analysis.model !== "string" || !analysis.model || !Array.isArray(analysis.findings)) {
    return unchanged();
  }
  if (!analysis.findings.every(validShape)) return unchanged(analysis.findings.length);

  const safeCorrect = evaluation.overall.outcome === "correct" && SAFE_DECIDERS.has(evaluation.overall.decided_by);
  const answer = ` ${normalize(evaluation.input.text)} `;
  const referenceTexts = references.map((r) => ` ${normalize(r)} `);
  const accepted = [];
  let discarded = 0;
  for (const raw of analysis.findings) {
    const original = normalize(raw.original);
    const grounded = original && answer.includes(` ${original} `) && original !== normalize(raw.suggestion);
    const explained = raw.explanation_de.trim().split(/\s+/).length >= 3 && normalize(raw.explanation_de) !== normalize(raw.suggestion);
    const germanismOk = raw.topic !== "GERMAN_INFLUENCE" || GERMANISM_CATEGORIES.includes(raw.category);
    const inReference = referenceTexts.some((r) => r.includes(` ${original} `));
    if (!grounded || !explained || !germanismOk || inReference || (safeCorrect && raw.category === "ERROR")
      || accepted.length >= MAX_SUPPLEMENTAL) {
      discarded += 1;
      continue;
    }
    accepted.push(raw);
  }

  // Nur Befunde: keine observations, kein outcome → Kompetenz, Gedächtnis und Urteil bleiben unberührt
  const merged = addLlmAnalysis(evaluation, {
    model: analysis.model,
    findings: accepted.map((raw) => ({
      kind: kindOf(raw),
      category: raw.topic,
      topic_id: Object.hasOwn(LLM_TOPIC_BY_CATEGORY, raw.topic) ? LLM_TOPIC_BY_CATEGORY[raw.topic] : null,
      error_key: null,
      original: raw.original.trim(),
      suggestion: raw.suggestion.trim(),
      explanation_de: raw.explanation_de.trim(),
      confidence: 0.5,
    })),
  });
  if (validateEvaluationResult(merged).length) return unchanged(analysis.findings.length);
  const added = merged.findings.length - evaluation.findings.length;
  return { evaluation: merged, status: "ok", added, discarded: discarded + (accepted.length - added) };
}

/** Anfrage an POST /api/analyze: nur, was die KI zum Einordnen braucht (keine Lernhistorie). */
export function supplementalRequest({ learnerId, exercise, evaluation, context = null, language }) {
  if (typeof language !== "string" || !language) throw new TypeError("supplementalRequest: Lernsprache (language) fehlt"); // P20
  return {
    learner_id: learnerId,
    language,
    exercise_id: exercise.id,
    answer_text: evaluation.input.text,
    prompt_de: exercise.prompt_de ?? "",
    reference_answers: (exercise.accepted_answers ?? []).slice(0, 5).map((a) => a.text),
    rule_outcome: evaluation.overall.outcome,
    rule_findings: evaluation.findings
      .filter((f) => f.authority === "authoritative")
      .map((f) => ({ kind: f.kind, original: f.original ?? "", suggestion: f.suggestion ?? "" })),
    conversation_id: evaluation.input.conversation_id,
    context,
  };
}

function kindOf({ category, topic }) {
  if (category === "ERROR") {
    if (topic === "PREPOSITION" || topic === "POR_PARA") return "PREPOSITION_ERROR";
    if (topic === "GERMAN_INFLUENCE") return "GERMANISM";
    if (topic === "WORD_CHOICE" || topic === "VOCABULARY" || topic === "COLLOCATION") return "WRONG_WORD";
    return "GRAMMATICAL_ERROR";
  }
  if (category === "UNNATURAL") return topic === "REPETITION" ? "REPETITION" : "UNNATURAL";
  if (category === "CORRECT_BUT_SIMPLE") return "CORRECT_BUT_SIMPLE";
  return "IDIOMATIC_UPGRADE";
}

function validShape(raw) {
  if (!isObject(raw)) return false;
  const keys = Object.keys(raw);
  if (keys.length !== FINDING_KEYS.length || !FINDING_KEYS.every((k) => typeof raw[k] === "string" && raw[k].length <= MAX_TEXT)) {
    return false;
  }
  return SUPPLEMENTAL_CATEGORIES.includes(raw.category) && Object.hasOwn(LLM_TOPIC_BY_CATEGORY, raw.topic)
    && raw.explanation_de.trim() !== "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
