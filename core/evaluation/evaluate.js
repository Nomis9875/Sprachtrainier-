/**
 * Lokale Bewertung einer Antwort: Übung + Antwort → EvaluationResult v2.
 *
 *   Antwort ─▶ evaluateAnswer() ─▶ EvaluationResult v2 ─▶ engine.recordAttempt() ─▶ Ereignisse
 *
 * Läuft vollständig im Browser (Laptop, iPhone-PWA) und in Node: kein Python, kein Netzwerk, kein
 * Ollama, keine KI, kein DOM, kein Dateisystem. Grundlage sind allein die Regeln und Lösungen des
 * Inhaltspakets (ContentLibrary). Die Bewertung verändert nichts: Sie erzeugt ein Ergebnis, die
 * Lernhistorie entsteht erst, wenn die Engine es als Ereignisse speichert.
 *
 * Gegenstück (Referenzsemantik): core/contracts/evaluation_result.py (from_rule_report,
 * from_closed_result) mit core/evaluation/answer_check.py und closed.py. Für denselben Inhalt und
 * dieselbe Antwort entsteht dasselbe Ergebnis (nur metadata.evaluator unterscheidet sich):
 * geprüft über shared/fixtures/evaluation_parity.json.
 */

import { evidenceForExercise, evidenceForObservation } from "../learning/competence/evidence.js";
import { checkAnswer } from "./check.js";
import { evaluateClosed } from "./closed.js";
import { sourceOf } from "./observations.js";
import { Rulebook } from "./rulebook.js";
import {
  BLOCKING_SEVERITIES, INPUT_MODES, RESULT_FORMAT, RESULT_VERSION, SEVERITY_BY_KIND, validateEvaluationResult,
} from "./result.js";
import { pythonStrip } from "./text.js";

export const JS_EVALUATOR = "js-core@2";

export class EvaluationError extends Error {
  constructor(message, problems = []) {
    super(problems.length ? `${message}:\n- ${problems.join("\n- ")}` : message);
    this.name = "EvaluationError";
    this.problems = problems;
  }
}

const RULEBOOKS = new WeakMap();

/** Das kompilierte Regelwerk eines Inhaltspakets (einmal je Bibliothek, danach aus dem Zwischenspeicher). */
export function rulebookFor(library) {
  let rulebook = RULEBOOKS.get(library);
  if (!rulebook) {
    rulebook = new Rulebook(library);
    RULEBOOKS.set(library, rulebook);
  }
  return rulebook;
}

/**
 * Bewertet eine Antwort lokal und gibt ein geprüftes EvaluationResult v2 zurück.
 *
 * @param {{
 *   library: import("../content/library.js").ContentLibrary,
 *   exercise: string|object,        Übungs-ID oder Übung aus dem Inhaltspaket
 *   answerText: string,
 *   inputMode?: "text"|"speech",
 *   conversationId?: string|null,   Antwort innerhalb eines Gesprächs (Nachweisstufe "spontaneous")
 *   now?: Date                      Zeitpunkt für metadata.created_at (für Tests festlegbar)
 * }} input
 * @returns {object} EvaluationResult v2
 * @throws {EvaluationError} unbekannte Übung, ungültige Eingabe; InvalidAnswerError bei leerer Antwort
 */
export function evaluateAnswer({ library, exercise, answerText, inputMode = "text", conversationId = null, now = new Date() }) {
  if (!library || typeof library.exercise !== "function") throw new EvaluationError("library: ContentLibrary erwartet");
  const item = typeof exercise === "string" ? library.exercise(exercise) : exercise;
  if (!item?.id) throw new EvaluationError(`Unbekannte Übung: ${typeof exercise === "string" ? exercise : "?"}`);
  if (typeof answerText !== "string") throw new EvaluationError("answerText: Text erwartet");
  if (!INPUT_MODES.includes(inputMode)) throw new EvaluationError(`inputMode: erlaubt sind ${INPUT_MODES.join(", ")}`);
  const rulebook = rulebookFor(library);
  const context = { library, exercise: item, inputMode, conversationId, createdAt: now.toISOString() };

  let result;
  if (item.evaluation_mode === "open") {
    result = fromRuleReport(checkAnswer(answerText, item, rulebook), { ...context, text: answerText.normalize("NFC") });
  } else {
    result = fromClosedResult(evaluateClosed(answerText, item, rulebook), { ...context, text: pythonStrip(answerText).normalize("NFC") });
  }
  const problems = validateEvaluationResult(result);
  if (problems.length) throw new EvaluationError("Die lokale Bewertung ergab kein gültiges EvaluationResult v2", problems);
  return result;
}

/**
 * Regelprüfung einer offenen Antwort → EvaluationResult v2. Ohne blockierenden Regelbefund bleibt das
 * Ergebnis offen ("needs_review"): Regeln können Fehler nachweisen, nicht die Korrektheit freier Antworten.
 */
export function fromRuleReport(report, context) {
  const findings = report.findings.map(findingJson);
  const blocking = findings.some((f) => BLOCKING_SEVERITIES.includes(f.severity));
  const overall = {
    outcome: blocking ? "incorrect" : "needs_review",
    decided_by: blocking ? "rule" : "none",
    feedback_de: "",
  };
  return build(context, overall, findings, report.observations);
}

/** Geschlossene Bewertung → EvaluationResult v2. */
export function fromClosedResult(closed, context) {
  const findings = closed.findings.map(findingJson);
  let overall;
  if (closed.outcome === "correct") {
    overall = { outcome: "correct", decided_by: "reference" };
  } else if (closed.outcome === "incorrect") {
    const ruleBlock = findings.some((f) => f.source === "rule" && BLOCKING_SEVERITIES.includes(f.severity));
    overall = { outcome: "incorrect", decided_by: ruleBlock ? "rule" : "reference" };
  } else {
    overall = { outcome: "needs_review", decided_by: "none" };
  }
  return build(context, { ...overall, feedback_de: closed.feedback_de }, findings, closed.observations);
}

function build({ library, exercise, inputMode, conversationId, createdAt, text }, overall, findings, observations) {
  const base = evidenceForExercise(exercise, { conversationId, inputMode });
  return {
    format: RESULT_FORMAT,
    schema_version: RESULT_VERSION,
    exercise: {
      id: exercise.id,
      revision: exercise.revision,
      type: exercise.type,
      mode: exercise.mode,
      evaluation_mode: exercise.evaluation_mode,
    },
    content: { version: library.contentVersion },
    input: { text, mode: inputMode, conversation_id: conversationId },
    overall,
    findings,
    observations: observations.map((o) => observationJson(o, base)),
    metadata: { evaluator: JS_EVALUATOR, created_at: createdAt, llm_model: null, migrated_from: null },
  };
}

function observationJson(o, base) {
  return {
    skill_id: o.skill_id,
    skill_type: o.skill_id.split(":")[0],
    observation_kind: o.kind,
    outcome: o.result,
    evidence: evidenceForObservation(base, o.kind),
    reliability: o.reliability,
    basis: o.basis,
    source: sourceOf(o),
    authority: "authoritative",
  };
}

function findingJson(f) {
  const errorKey = f.error_id ? `common_error:${f.error_id}` : null;
  let skill = null;
  if (f.error_id) skill = errorKey;
  else if (f.rule_id) skill = `grammar_structure:${f.rule_id}`;
  else if (f.item_id) skill = `lexical_item:${f.item_id}`;
  return {
    source: f.source,
    authority: "authoritative",
    kind: f.kind,
    severity: SEVERITY_BY_KIND[f.kind],
    error_key: errorKey,
    skill_id: skill,
    topic_id: f.topic_id,
    original: f.original,
    suggestion: f.suggestion,
    explanation_de: f.explanation_de,
    span: f.span ? { start: f.span[0], end: f.span[1] } : null,
    confidence: 1,
  };
}
