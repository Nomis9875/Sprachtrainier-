/**
 * EvaluationResult: gemeinsames Ergebnisformat einer Bewertung (aktuell Version 2).
 *
 * Gegenstück: core/contracts/evaluation_result.py (dort ist das Format ausführlich
 * beschrieben). Erlaubte Werte: shared/contracts/evaluation_result_v2.json.
 * Gemeinsame Prüffälle: shared/fixtures/evaluation_results.json.
 *
 *   v2  format, schema_version 2, exercise {id, revision, type, mode, evaluation_mode},
 *       content {version}, input {text (NFC), mode, conversation_id}, overall, findings[] (mit
 *       authority und span), observations[] {skill_id, skill_type, observation_kind, outcome,
 *       evidence, reliability, basis, source, authority}, metadata (mit migrated_from)
 *   v1  version 1, exercise_id, exercise_revision, content_version, answer_text, overall,
 *       findings[] (authoritative), skill_observations[] {skill_id, outcome, source,
 *       authoritative}, metadata
 *
 * Grundregeln:
 * - Befunde/Beobachtungen aus Regeln und Datenbank ("rule", "reference") sind autoritativ.
 * - Qwen ("llm") ist Ergänzung ("supplemental", Verlässlichkeit "low") und überschreibt nie
 *   autoritative Befunde.
 * - v1 wird nie stillschweigend umgedeutet: migrateEvaluationResult() wandelt ausdrücklich um,
 *   readEvaluation() liefert eine Lese-Sicht, in der v1-Beobachtungen "unclassified" bleiben.
 */

import { isSkillId, parseSkillId } from "../content/skills.js";
import { EVIDENCE_LEVELS, evidenceForExercise, evidenceForObservation } from "../learning/competence/evidence.js";
import { isUtcIso } from "../util/time.js";
import { normalize } from "./text.js";

export const RESULT_FORMAT = "spanisch-ai.evaluation-result";
export const RESULT_VERSION = 2;

export const SEVERITY_BY_KIND = Object.freeze({
  GRAMMATICAL_ERROR: "error",
  PREPOSITION_ERROR: "error",
  WRONG_WORD: "error",
  GERMANISM: "error",
  TARGET_NOT_USED: "goal",
  GOAL_NOT_MET: "goal",
  UNNATURAL: "naturalness",
  REGISTER_MISMATCH: "naturalness",
  REPETITION: "naturalness",
  CORRECT_BUT_SIMPLE: "upgrade",
  IDIOMATIC_UPGRADE: "upgrade",
  ACCENT: "hint",
});
export const BLOCKING_SEVERITIES = Object.freeze(["error", "goal"]);

export const OUTCOMES = Object.freeze(["correct", "incorrect", "needs_review", "not_evaluated"]);
export const DECIDERS = Object.freeze(["reference", "rule", "llm", "none"]);
export const SOURCES = Object.freeze(["reference", "rule", "llm"]);
export const AUTHORITIES = Object.freeze(["authoritative", "supplemental"]);
export const V1_OBSERVATION_OUTCOMES = Object.freeze(["correct", "error", "not_used", "unknown"]);

export const OBSERVATION_KINDS = Object.freeze(["target", "incidental", "missed_opportunity", "upgrade_opportunity", "unclassified"]);
export const OBSERVATION_OUTCOMES = Object.freeze(["demonstrated", "error", "not_demonstrated", "not_observable", "correct_but_simple"]);
export const OUTCOMES_BY_KIND = Object.freeze({
  target: Object.freeze(["demonstrated", "error", "not_demonstrated", "not_observable"]),
  incidental: Object.freeze(["demonstrated", "error", "not_observable"]),
  missed_opportunity: Object.freeze(["not_demonstrated"]),
  upgrade_opportunity: Object.freeze(["correct_but_simple"]),
  unclassified: Object.freeze(["demonstrated", "error", "not_demonstrated", "not_observable"]),
});
export const RELIABILITIES = Object.freeze(["high", "medium", "low"]);
export const BASES = Object.freeze([
  "reference_answer", "known_wrong_answer", "structure_detector", "lexical_detector", "error_detector",
  "correct_form_detector", "context_only", "no_detector", "task_requirement", "simpler_phrase", "llm", "v1_migration",
]);
export const EXERCISE_TYPES = Object.freeze([
  "gap_fill", "vocab_active", "transform", "translation", "rephrase", "situational", "opinion", "counterargument",
  "hypothetical", "reaction", "storytelling", "explanation", "persuasion", "discussion", "register_switch",
  "free_production", "conversation", "reading_comprehension", "listening_comprehension", "multiple_choice", "error_correction",
  "dictation", "listening_response", // P15
]);
export const EXERCISE_MODES = Object.freeze(["training", "challenge"]);
export const EVALUATION_MODES = Object.freeze(["closed", "semi_open", "open"]);
export const INPUT_MODES = Object.freeze(["text", "speech"]);
/** v1 → v2: Das Ergebnis bekommt einen eindeutigen Namen, die Bedeutung bleibt gleich. */
export const V1_OUTCOME_TO_V2 = Object.freeze({ correct: "demonstrated", error: "error", not_used: "not_demonstrated", unknown: "not_observable" });

/**
 * Coach-Kategorien (Qwen) → Thema des Inhalts. Kein zweites Skill-System: Qwen-Befunde bekommen
 * ein Thema, nie eine Skill-ID. Vertrag: shared/contracts/llm_topics.json.
 */
export const LLM_TOPIC_BY_CATEGORY = Object.freeze({
  GRAMMAR: "grammar",
  SUBJUNCTIVE: "grammar.subjunctive",
  POR_PARA: "grammar.prepositions.por_para",
  PREPOSITION: "grammar.prepositions",
  TENSE: "grammar.tenses",
  AGREEMENT: "grammar.agreement",
  WORD_CHOICE: "vocabulary",
  VOCABULARY: "vocabulary",
  COLLOCATION: "vocabulary.collocations",
  GERMAN_INFLUENCE: "interference.german",
  REPETITION: "discourse",
  OTHER: null,
});

const REFERENCE_BASES = Object.freeze(["reference_answer", "known_wrong_answer"]);
const V1_TOP_KEYS = ["format", "version", "exercise_id", "exercise_revision", "content_version", "answer_text",
  "overall", "findings", "skill_observations", "metadata"];
const V2_TOP_KEYS = ["format", "schema_version", "exercise", "content", "input", "overall", "findings", "observations", "metadata"];
const EXERCISE_KEYS = ["id", "revision", "type", "mode", "evaluation_mode"];
const INPUT_KEYS = ["text", "mode", "conversation_id"];
const OVERALL_KEYS = ["outcome", "decided_by", "feedback_de"];
const V1_FINDING_KEYS = ["source", "authoritative", "kind", "severity", "error_key", "skill_id", "topic_id",
  "original", "suggestion", "explanation_de", "confidence"];
const V2_FINDING_KEYS = ["source", "authority", "kind", "severity", "error_key", "skill_id", "topic_id",
  "original", "suggestion", "explanation_de", "span", "confidence"];
const V1_OBSERVATION_KEYS = ["skill_id", "outcome", "source", "authoritative"];
const V2_OBSERVATION_KEYS = ["skill_id", "skill_type", "observation_kind", "outcome", "evidence", "reliability",
  "basis", "source", "authority"];
const V1_METADATA_KEYS = ["evaluator", "created_at", "llm_model"];
const V2_METADATA_KEYS = [...V1_METADATA_KEYS, "migrated_from"];
const ERROR_KEY = /^(?:common_error:[a-z0-9][a-z0-9_]*|llm:\S.*)$/;

/** 1, 2 oder null (kein erkennbares Ergebnis). v1 hat "version", v2 "schema_version". */
export function resultVersion(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  if (Object.hasOwn(data, "schema_version")) return data.schema_version === 2 ? 2 : null;
  return data.version === 1 ? 1 : null;
}

// ---------------------------------------------------------------- Prüfung

/** Gibt alle Verstöße gegen das Format zurück (leere Liste = gültig). Versionen 1 und 2. */
export function validateEvaluationResult(data) {
  const version = resultVersion(data);
  if (version === 1) return validateV1(data);
  if (version === 2) return validateV2(data);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return ["Ergebnis: Objekt erwartet"];
  return ["schema_version: 2 erwartet (oder version 1 für ältere Ergebnisse)"];
}

function validateV2(data) {
  const problems = [];
  if (!hasExactKeys(data, V2_TOP_KEYS, "Ergebnis", problems)) return problems;
  if (data.format !== RESULT_FORMAT) problems.push(`format: erwartet ${RESULT_FORMAT}`);

  const exercise = data.exercise;
  const exerciseOk = hasExactKeys(exercise, EXERCISE_KEYS, "exercise", problems);
  if (exerciseOk) {
    requireText(exercise.id, "exercise.id", problems);
    requireRevision(exercise.revision, "exercise.revision", problems);
    oneOf(exercise.type, EXERCISE_TYPES, "exercise.type", problems);
    oneOf(exercise.mode, EXERCISE_MODES, "exercise.mode", problems);
    oneOf(exercise.evaluation_mode, EVALUATION_MODES, "exercise.evaluation_mode", problems);
  }
  if (hasExactKeys(data.content, ["version"], "content", problems)) requireText(data.content.version, "content.version", problems);
  const input = data.input;
  const inputOk = hasExactKeys(input, INPUT_KEYS, "input", problems);
  let textLength = null;
  if (inputOk) {
    if (typeof input.text === "string") {
      if (input.text.normalize("NFC") !== input.text) problems.push("input.text: muss NFC-normalisiert sein");
      textLength = [...input.text].length; // Unicode-Zeichen wie in Python, nicht UTF-16-Einheiten
    } else {
      problems.push("input.text: muss Text sein");
    }
    oneOf(input.mode, INPUT_MODES, "input.mode", problems);
    if (input.conversation_id !== null) requireText(input.conversation_id, "input.conversation_id", problems);
  }
  if (hasExactKeys(data.overall, OVERALL_KEYS, "overall", problems)) checkOverall(data.overall, problems);

  const findings = Array.isArray(data.findings) ? data.findings : [];
  if (!Array.isArray(data.findings)) problems.push("findings: muss eine Liste sein");
  findings.forEach((finding, i) => {
    const path = `findings[${i}]`;
    if (hasExactKeys(finding, V2_FINDING_KEYS, path, problems)) {
      checkFinding(finding, path, problems, "authority");
      checkSpan(finding.span, textLength, `${path}.span`, problems);
    }
  });

  let migrated = false;
  if (hasExactKeys(data.metadata, V2_METADATA_KEYS, "metadata", problems)) {
    checkMetadata(data.metadata, problems);
    if (data.metadata.migrated_from !== null && data.metadata.migrated_from !== 1) {
      problems.push("metadata.migrated_from: null oder 1 erwartet");
    }
    migrated = data.metadata.migrated_from === 1;
  }

  const baseEvidence = exerciseOk && inputOk && EXERCISE_TYPES.includes(exercise.type) && EXERCISE_MODES.includes(exercise.mode)
    && EVALUATION_MODES.includes(exercise.evaluation_mode) && INPUT_MODES.includes(input.mode)
    ? baseEvidenceOf(exercise, input)
    : null;
  const observations = Array.isArray(data.observations) ? data.observations : [];
  if (!Array.isArray(data.observations)) problems.push("observations: muss eine Liste sein");
  const seen = new Set();
  observations.forEach((observation, i) => {
    const path = `observations[${i}]`;
    if (hasExactKeys(observation, V2_OBSERVATION_KEYS, path, problems)) {
      checkObservation(observation, path, problems, { migrated, baseEvidence });
      const key = `${observation.skill_id}\u0000${observation.source}`;
      if (seen.has(key)) problems.push(`${path}: Skill und Quelle kommen doppelt vor`);
      seen.add(key);
    }
  });

  if (data.overall?.outcome === "correct") {
    if (findings.some((f) => isAuthoritativeBlock(f, "authority"))) {
      problems.push("overall.outcome: 'correct' trotz autoritativem Fehlerbefund");
    }
    if (observations.some(isAuthoritativeTargetError)) {
      problems.push("overall.outcome: 'correct' trotz falsch verwendetem Lernziel");
    }
  }
  checkUnambiguous(findings, observations, problems);
  return problems;
}

function validateV1(data) {
  const problems = [];
  if (!hasExactKeys(data, V1_TOP_KEYS, "Ergebnis", problems)) return problems;
  if (data.format !== RESULT_FORMAT) problems.push(`format: erwartet ${RESULT_FORMAT}`);
  requireText(data.exercise_id, "exercise_id", problems);
  requireText(data.content_version, "content_version", problems);
  if (typeof data.answer_text !== "string") problems.push("answer_text: muss Text sein");
  requireRevision(data.exercise_revision, "exercise_revision", problems);
  if (hasExactKeys(data.overall, OVERALL_KEYS, "overall", problems)) checkOverall(data.overall, problems);

  const findings = Array.isArray(data.findings) ? data.findings : [];
  if (!Array.isArray(data.findings)) problems.push("findings: muss eine Liste sein");
  findings.forEach((finding, i) => {
    if (hasExactKeys(finding, V1_FINDING_KEYS, `findings[${i}]`, problems)) {
      checkFinding(finding, `findings[${i}]`, problems, "authoritative");
    }
  });
  const observations = Array.isArray(data.skill_observations) ? data.skill_observations : [];
  if (!Array.isArray(data.skill_observations)) problems.push("skill_observations: muss eine Liste sein");
  const seen = new Set();
  observations.forEach((o, i) => {
    const path = `skill_observations[${i}]`;
    if (!hasExactKeys(o, V1_OBSERVATION_KEYS, path, problems)) return;
    if (!isSkillId(o.skill_id)) problems.push(`${path}.skill_id: ungültige Skill-ID`);
    oneOf(o.outcome, V1_OBSERVATION_OUTCOMES, `${path}.outcome`, problems);
    oneOf(o.source, SOURCES, `${path}.source`, problems);
    if (o.authoritative !== (o.source !== "llm")) problems.push(`${path}.authoritative: nur Regel-/Datenbankbeobachtungen sind autoritativ`);
    const key = `${o.skill_id}\u0000${o.source}`;
    if (seen.has(key)) problems.push(`${path}: Skill und Quelle kommen doppelt vor`);
    seen.add(key);
  });
  if (hasExactKeys(data.metadata, V1_METADATA_KEYS, "metadata", problems)) checkMetadata(data.metadata, problems);
  if (data.overall?.outcome === "correct" && findings.some((f) => isAuthoritativeBlock(f, "authoritative"))) {
    problems.push("overall.outcome: 'correct' trotz autoritativem Fehlerbefund");
  }
  return problems;
}

export function isBlockingSeverity(severity) {
  return BLOCKING_SEVERITIES.includes(severity);
}

function checkOverall(overall, problems) {
  oneOf(overall.outcome, OUTCOMES, "overall.outcome", problems);
  oneOf(overall.decided_by, DECIDERS, "overall.decided_by", problems);
  if (overall.outcome === "not_evaluated" && overall.decided_by !== "none") {
    problems.push("overall: 'not_evaluated' kann nur von 'none' stammen");
  }
  if (overall.decided_by === "none" && !["needs_review", "not_evaluated"].includes(overall.outcome)) {
    problems.push("overall: ohne Entscheider sind nur 'needs_review' oder 'not_evaluated' möglich");
  }
  if (typeof overall.feedback_de !== "string") problems.push("overall.feedback_de: muss Text sein");
}

function checkFinding(f, path, problems, authorityKey) {
  oneOf(f.source, SOURCES, `${path}.source`, problems);
  if (authorityKey === "authority") oneOf(f.authority, AUTHORITIES, `${path}.authority`, problems);
  if (isAuthoritative(f, authorityKey) !== (f.source !== "llm")) {
    problems.push(`${path}.${authorityKey}: nur Regel-/Datenbankbefunde sind autoritativ, Qwen ergänzt`);
  }
  if (!Object.hasOwn(SEVERITY_BY_KIND, f.kind)) {
    problems.push(`${path}.kind: unbekannte Art ${f.kind}`);
  } else if (f.severity !== SEVERITY_BY_KIND[f.kind]) {
    problems.push(`${path}.severity: passt nicht zur Art ${f.kind}`);
  }
  if (f.error_key !== null && (typeof f.error_key !== "string" || !ERROR_KEY.test(f.error_key))) {
    problems.push(`${path}.error_key: 'common_error:<id>' oder 'llm:<…>' erwartet`);
  }
  if (f.skill_id !== null && !isSkillId(f.skill_id)) problems.push(`${path}.skill_id: ungültige Skill-ID`);
  if (f.topic_id !== null && typeof f.topic_id !== "string") problems.push(`${path}.topic_id: Text oder null erwartet`);
  for (const key of ["original", "suggestion", "explanation_de"]) {
    if (typeof f[key] !== "string") problems.push(`${path}.${key}: muss Text sein`);
  }
  if (typeof f.confidence !== "number" || !(f.confidence >= 0 && f.confidence <= 1)) {
    problems.push(`${path}.confidence: Zahl zwischen 0 und 1 erwartet`);
  } else if (isAuthoritative(f, authorityKey) === true && f.confidence !== 1) {
    problems.push(`${path}.confidence: autoritative Befunde haben die Sicherheit 1`);
  }
}

function checkSpan(span, textLength, path, problems) {
  if (span === null) return;
  if (span === undefined || typeof span !== "object" || Array.isArray(span)
    || Object.keys(span).sort().join(",") !== "end,start") {
    problems.push(`${path}: null oder {start, end} erwartet`);
    return;
  }
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || !(span.start >= 0 && span.start < span.end)) {
    problems.push(`${path}: ganze Zahlen mit 0 ≤ start < end erwartet`);
  } else if (textLength !== null && span.end > textLength) {
    problems.push(`${path}: liegt außerhalb von input.text`);
  }
}

function checkObservation(o, path, problems, { migrated, baseEvidence }) {
  if (!isSkillId(o.skill_id)) problems.push(`${path}.skill_id: ungültige Skill-ID`);
  else if (o.skill_type !== parseSkillId(o.skill_id).type) problems.push(`${path}.skill_type: passt nicht zur Skill-ID`);
  if (!OBSERVATION_KINDS.includes(o.observation_kind)) {
    problems.push(`${path}.observation_kind: erlaubt sind ${OBSERVATION_KINDS.join(", ")}`);
  } else if (!OUTCOMES_BY_KIND[o.observation_kind].includes(o.outcome)) {
    problems.push(`${path}.outcome: '${o.outcome}' passt nicht zur Art '${o.observation_kind}'`);
  }
  oneOf(o.outcome, OBSERVATION_OUTCOMES, `${path}.outcome`, problems);
  oneOf(o.source, SOURCES, `${path}.source`, problems);
  oneOf(o.authority, AUTHORITIES, `${path}.authority`, problems);
  if ((o.authority === "authoritative") !== (o.source !== "llm")) {
    problems.push(`${path}.authority: nur Regel-/Datenbankbeobachtungen sind autoritativ, Qwen ergänzt`);
  }
  oneOf(o.reliability, RELIABILITIES, `${path}.reliability`, problems);
  oneOf(o.basis, BASES, `${path}.basis`, problems);
  oneOf(o.evidence, EVIDENCE_LEVELS, `${path}.evidence`, problems);
  if (o.source === "llm" && (o.reliability !== "low" || o.basis !== "llm")) {
    problems.push(`${path}: Qwen-Beobachtungen sind immer 'low' mit Grundlage 'llm'`);
  }
  if (o.basis === "llm" && o.source !== "llm") problems.push(`${path}.basis: 'llm' nur mit Quelle 'llm'`);
  if (REFERENCE_BASES.includes(o.basis) && o.source !== "reference") {
    problems.push(`${path}.source: Musterlösungen und hinterlegte falsche Antworten haben die Quelle 'reference'`);
  }
  if (o.source === "reference" && !REFERENCE_BASES.includes(o.basis) && o.basis !== "v1_migration") {
    problems.push(`${path}.basis: Quelle 'reference' nur mit hinterlegter Antwort`);
  }
  if (o.outcome === "not_observable" && o.reliability !== "low") problems.push(`${path}.reliability: 'not_observable' ist immer 'low'`);
  if (o.observation_kind === "unclassified" && !migrated) {
    problems.push(`${path}.observation_kind: 'unclassified' gibt es nur in umgewandelten v1-Ergebnissen`);
  }
  if (o.basis === "v1_migration" && o.observation_kind !== "unclassified") {
    problems.push(`${path}.basis: 'v1_migration' nur mit der Art 'unclassified'`);
  }
  if (baseEvidence !== null && OBSERVATION_KINDS.includes(o.observation_kind)) {
    const expected = evidenceForObservation(baseEvidence, o.observation_kind);
    if (o.evidence !== expected) problems.push(`${path}.evidence: '${expected}' erwartet (aus Übung, Eingabe und Art)`);
  }
}

function checkMetadata(metadata, problems) {
  requireText(metadata.evaluator, "metadata.evaluator", problems);
  if (!isUtcIso(metadata.created_at)) problems.push("metadata.created_at: UTC im ISO-8601-Format mit 'Z' erwartet");
  if (metadata.llm_model !== null && typeof metadata.llm_model !== "string") {
    problems.push("metadata.llm_model: Text oder null erwartet");
  }
}

/** Eine richtige Verwendung darf nicht zugleich von einer Regel als Fehler gemeldet werden. */
function checkUnambiguous(findings, observations, problems) {
  const errorSkills = new Set(findings.filter((f) => f?.authority === "authoritative" && f.error_key).map((f) => f.skill_id));
  observations.forEach((o, i) => {
    if (o?.authority === "authoritative" && o.outcome === "demonstrated" && errorSkills.has(o.skill_id)) {
      problems.push(`observations[${i}]: gleichzeitig richtig und als Fehler gemeldet`);
    }
  });
}

function isAuthoritative(item, key) {
  return key === "authoritative" ? item.authoritative : item.authority === "authoritative";
}

function isAuthoritativeBlock(finding, key) {
  return finding !== null && typeof finding === "object" && isAuthoritative(finding, key) === true
    && isBlockingSeverity(finding.severity);
}

function isAuthoritativeTargetError(o) {
  return o?.authority === "authoritative" && o.observation_kind === "target" && o.outcome === "error";
}

function baseEvidenceOf(exercise, input) {
  return evidenceForExercise(
    { type: exercise.type, mode: exercise.mode, evaluation_mode: exercise.evaluation_mode },
    { conversationId: input.conversation_id, inputMode: input.mode },
  );
}

// ---------------------------------------------------------------- v1 → v2 und Lese-Sicht

/**
 * Wandelt ein gültiges v1-Ergebnis ausdrücklich in v2 um (das Original bleibt unverändert).
 * v1 kannte weder Übungsart noch Eingabe; der Kontext muss mitgegeben werden (aus dem Inhalt und
 * dem Versuch). Art "unclassified", Nachweisstufe wie in v1 aus der Übung, Regel-/Referenz-
 * beobachtungen "high", Qwen und "unknown" "low", Befunde ohne Textstelle.
 *
 * @param {object} data  gültiges EvaluationResult v1
 * @param {{exercise_type: string, exercise_mode: string, evaluation_mode: string,
 *          input_mode?: string, conversation_id?: string|null}} context
 */
export function migrateEvaluationResult(data, context) {
  const problems = validateEvaluationResult(data);
  if (problems.length || resultVersion(data) !== 1) {
    throw new TypeError(`Kein gültiges v1-Ergebnis: ${problems.join("; ") || "kein v1"}`);
  }
  const { exercise_type: type, exercise_mode: mode, evaluation_mode: evaluationMode } = context;
  const inputMode = context.input_mode ?? "text";
  const conversationId = context.conversation_id ?? null;
  const source = structuredClone(data);
  const evidence = evidenceForExercise({ type, mode, evaluation_mode: evaluationMode }, { conversationId, inputMode });
  return {
    format: RESULT_FORMAT,
    schema_version: RESULT_VERSION,
    exercise: { id: source.exercise_id, revision: source.exercise_revision, type, mode, evaluation_mode: evaluationMode },
    content: { version: source.content_version },
    input: { text: source.answer_text.normalize("NFC"), mode: inputMode, conversation_id: conversationId },
    overall: source.overall,
    findings: source.findings.map((f) => ({
      source: f.source,
      authority: f.authoritative ? "authoritative" : "supplemental",
      kind: f.kind,
      severity: f.severity,
      error_key: f.error_key,
      skill_id: f.skill_id,
      topic_id: f.topic_id,
      original: f.original,
      suggestion: f.suggestion,
      explanation_de: f.explanation_de,
      span: null,
      confidence: f.confidence,
    })),
    observations: source.skill_observations.map((o) => migratedObservation(o, evidence)),
    metadata: { ...source.metadata, migrated_from: 1 },
  };
}

function migratedObservation(o, evidence) {
  const outcome = V1_OUTCOME_TO_V2[o.outcome];
  const llm = o.source === "llm";
  return {
    skill_id: o.skill_id,
    skill_type: parseSkillId(o.skill_id).type,
    observation_kind: "unclassified",
    outcome,
    evidence,
    reliability: llm || outcome === "not_observable" ? "low" : "high",
    basis: llm ? "llm" : "v1_migration",
    source: o.source,
    authority: llm ? "supplemental" : "authoritative",
  };
}

/**
 * Einheitliche Lese-Sicht auf v1 und v2 (für Lernlogik und Session). Ändert nichts und deutet
 * nichts um: v1-Beobachtungen bleiben "unclassified", ihre Nachweisstufe ist null (die Lernlogik
 * bestimmt sie wie bisher aus der Übung).
 *
 * @returns {{version: number, exercise_id: string, overall: object,
 *   findings: {authoritative: boolean, severity: string, error_key: string|null, skill_id: string|null}[],
 *   observations: {skill_id: string, observation_kind: string, outcome: string, evidence: string|null,
 *     reliability: string, basis: string, source: string, authoritative: boolean}[],
 *   input_mode: string|null, conversation_id: string|null}}
 */
export function readEvaluation(evaluation) {
  const version = resultVersion(evaluation);
  if (version === 2) {
    return {
      version,
      exercise_id: evaluation.exercise.id,
      overall: evaluation.overall,
      findings: evaluation.findings.map((f) => ({ ...f, authoritative: f.authority === "authoritative" })),
      observations: evaluation.observations.map((o) => ({ ...o, authoritative: o.authority === "authoritative" })),
      input_mode: evaluation.input.mode,
      conversation_id: evaluation.input.conversation_id,
    };
  }
  if (version === 1) {
    return {
      version,
      exercise_id: evaluation.exercise_id,
      overall: evaluation.overall,
      findings: evaluation.findings.map((f) => ({ ...f })),
      observations: evaluation.skill_observations.map((o) => {
        const { authority, ...view } = migratedObservation(o, null);
        return { ...view, authoritative: authority === "authoritative" };
      }),
      input_mode: null,
      conversation_id: null,
    };
  }
  throw new TypeError("Kein EvaluationResult (weder v1 noch v2)");
}

// ---------------------------------------------------------------- Qwen-Ergänzung

/**
 * Ergänzt ein v2-Ergebnis um eine Qwen-Analyse, ohne autoritative Befunde zu verändern.
 *
 * - Qwen-Befunde, die dieselbe Stelle oder denselben Fehler betreffen wie ein autoritativer
 *   Befund, werden verworfen (Regel/Datenbank haben Vorrang).
 * - Eine Coach-Kategorie (category) wird auf ein Thema des Inhalts abgebildet, nie auf einen Skill.
 * - Qwen-Beobachtungen zählen nur für Skills, die die Regeln nicht entscheiden konnten; sie sind
 *   immer "supplemental" und "low". Die Art übernehmen sie von der Regelbeobachtung desselben
 *   Skills, sonst "incidental".
 * - Das Gesamtergebnis ändert Qwen nur, wenn noch niemand entschieden hat; und nie auf
 *   "correct", solange ein autoritativer Fehler vorliegt.
 *
 * @param {object} result gültiges EvaluationResult v2 (v1 vorher ausdrücklich umwandeln)
 * @param {{model: string, findings?: object[], observations?: object[], outcome?: string, feedback_de?: string}} analysis
 * @returns {object} neues Ergebnis (das übergebene bleibt unverändert)
 */
export function addLlmAnalysis(result, analysis) {
  if (resultVersion(result) !== 2) {
    throw new TypeError("addLlmAnalysis erwartet EvaluationResult v2 (v1 vorher mit migrateEvaluationResult umwandeln)");
  }
  const next = structuredClone(result);
  const authoritative = next.findings.filter((f) => f.authority === "authoritative");
  const coveredKeys = new Set(authoritative.map((f) => f.error_key).filter(Boolean));
  const coveredTexts = new Set(authoritative.map((f) => normalize(f.original)).filter(Boolean));

  for (const raw of analysis.findings ?? []) {
    const finding = llmFinding(raw);
    const text = normalize(finding.original);
    if ((finding.error_key && coveredKeys.has(finding.error_key)) || (text && coveredTexts.has(text))) continue;
    next.findings.push(finding);
  }

  const ruleKinds = new Map(next.observations.filter((o) => o.authority === "authoritative").map((o) => [o.skill_id, o.observation_kind]));
  const decidedSkills = new Set(next.observations
    .filter((o) => o.authority === "authoritative" && o.outcome !== "not_observable").map((o) => o.skill_id));
  const baseEvidence = baseEvidenceOf(next.exercise, next.input);
  const llmSkills = new Set();
  for (const raw of analysis.observations ?? []) {
    if (!isSkillId(raw.skill_id) || decidedSkills.has(raw.skill_id) || llmSkills.has(raw.skill_id)) continue;
    const kind = ruleKinds.get(raw.skill_id) ?? raw.observation_kind ?? "incidental";
    if (!OUTCOMES_BY_KIND[kind]?.includes(raw.outcome) || kind === "unclassified") continue;
    llmSkills.add(raw.skill_id);
    next.observations.push({
      skill_id: raw.skill_id,
      skill_type: parseSkillId(raw.skill_id).type,
      observation_kind: kind,
      outcome: raw.outcome,
      evidence: evidenceForObservation(baseEvidence, kind),
      reliability: "low",
      basis: "llm",
      source: "llm",
      authority: "supplemental",
    });
  }

  const undecided = next.overall.decided_by === "none" || next.overall.decided_by === "llm";
  if (analysis.outcome && undecided) {
    const blocked = analysis.outcome === "correct" && next.findings.some((f) => isAuthoritativeBlock(f, "authority"));
    if (!blocked) {
      next.overall.outcome = analysis.outcome;
      next.overall.decided_by = "llm";
      if (analysis.feedback_de) next.overall.feedback_de = analysis.feedback_de;
    }
  }
  next.metadata.llm_model = analysis.model;
  return next;
}

function llmFinding(raw) {
  const confidence = typeof raw.confidence === "number" ? Math.min(Math.max(raw.confidence, 0), 1) : 0.5;
  const topic = raw.topic_id ?? (Object.hasOwn(LLM_TOPIC_BY_CATEGORY, raw.category ?? "") ? LLM_TOPIC_BY_CATEGORY[raw.category] : null);
  return {
    source: "llm",
    authority: "supplemental",
    kind: raw.kind,
    severity: SEVERITY_BY_KIND[raw.kind],
    error_key: raw.error_key ?? null,
    skill_id: null, // Welche Fähigkeit betroffen ist, entscheiden nur Regeln und Inhalt
    topic_id: topic,
    original: raw.original ?? "",
    suggestion: raw.suggestion ?? "",
    explanation_de: raw.explanation_de ?? "",
    span: null,
    confidence,
  };
}

// ---------------------------------------------------------------- Hilfen

function hasExactKeys(value, keys, label, problems) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${label}: Objekt erwartet`);
    return false;
  }
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (missing.length) problems.push(`${label}: fehlende Felder ${missing.join(", ")}`);
  if (unknown.length) problems.push(`${label}: unbekannte Felder ${unknown.join(", ")}`);
  return missing.length === 0;
}

function requireText(value, path, problems) {
  if (typeof value !== "string" || value === "") problems.push(`${path}: nicht-leerer Text erwartet`);
}

function requireRevision(value, path, problems) {
  if (!Number.isInteger(value) || value < 1) problems.push(`${path}: ganze Zahl ≥ 1 erwartet`);
}

function oneOf(value, allowed, path, problems) {
  if (!allowed.includes(value)) problems.push(`${path}: erlaubt sind ${allowed.join(", ")}`);
}
