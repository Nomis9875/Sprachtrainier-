/**
 * Lernereignisse: die eigentliche Wahrheit des Lernsystems.
 *
 * Statt veränderbarer Zähler ("error_count = 7") werden Ereignisse nur angehängt,
 * nie geändert. Profil, Fehlerstatistik, Kompetenz und Wiederholungsstand werden
 * später daraus berechnet. So lassen sich Ereignisse von Laptop und iPhone
 * einfach zusammenführen.
 *
 * Umschlag (für alle Typen gleich):
 *   id, user_id, device_id   UUID v7
 *   language                 Lernsprache (P11B, "es", "en", …). Jedes neue Ereignis gehört genau einem Lerner
 *                            UND einer Sprache; Ereignisse von vor P11B haben keine Angabe und gelten als "es"
 *   event_type, schema_version   Version des Inhalts JE TYP (EVENT_SCHEMA_VERSIONS); ältere
 *                                Versionen bleiben gültig und werden beim Replay weiter gelesen
 *   created_at               UTC ISO-8601 ("…Z")
 *   local_date               Kalendertag auf dem Gerät (für Streaks/Tagesziele)
 *   payload                  typabhängiger Inhalt
 */

import { isSkillId } from "../content/skills.js";
import { EVIDENCE_LEVELS } from "./competence/evidence.js";
import {
  BASES, OBSERVATION_KINDS, OBSERVATION_OUTCOMES as V2_OUTCOMES, OUTCOMES_BY_KIND, RELIABILITIES,
  EVALUATION_MODES, EXERCISE_TYPES, readEvaluation, resultVersion, validateEvaluationResult,
} from "../evaluation/result.js";
import { isUuidV7, uuidv7 } from "../util/ids.js";
import { LISTENING_ACTIONS, SUPPORT_LEVELS } from "./listening/model.js";
import { isLocalDate, isUtcIso, localDateOf, toUtcIso } from "../util/time.js";

/** Standardversion des Ereignisinhalts; abweichende Versionen je Typ stehen in EVENT_SCHEMA_VERSIONS. */
export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = Object.freeze({
  ATTEMPT: "attempt",
  SKILL_OBSERVATION: "skill_observation",
  ERROR_EVENT: "error_event",
  REVIEW_EVENT: "review_event",
  SESSION_STARTED: "session_started",
  SESSION_PAUSED: "session_paused",
  SESSION_RESUMED: "session_resumed",
  SESSION_COMPLETED: "session_completed",
  SESSION_ABANDONED: "session_abandoned",
  CONVERSATION_STARTED: "conversation_started",
  CONVERSATION_TURN: "conversation_turn",
  CONVERSATION_PAUSED: "conversation_paused",
  CONVERSATION_RESUMED: "conversation_resumed",
  CONVERSATION_COMPLETED: "conversation_completed",
  CONVERSATION_ABANDONED: "conversation_abandoned",
  SELF_ASSESSMENT_RECORDED: "self_assessment_recorded",
  ASSESSMENT_STARTED: "assessment_started",
  ASSESSMENT_RESPONSE: "assessment_response",
  ASSESSMENT_ITEM_SKIPPED: "assessment_item_skipped",
  ASSESSMENT_MODULE_SKIPPED: "assessment_module_skipped",
  ASSESSMENT_PAUSED: "assessment_paused",
  ASSESSMENT_RESUMED: "assessment_resumed",
  ASSESSMENT_COMPLETED: "assessment_completed",
  ASSESSMENT_ABANDONED: "assessment_abandoned",
  LANGUAGE_PROFILE_RECORDED: "language_profile_recorded",
  // P15: Kontext beim Hören (abspielen, Pause, wiederholen, Hilfe, überspringen, "nichts verstanden"); KEINE Evidenz
  LISTENING_INTERACTION: "listening_interaction",
});

/** Ereignistypen der Einstufung und des Profilverlaufs (P11B, siehe assessment/state.js). */
export const ASSESSMENT_EVENT_TYPES = Object.freeze([
  "self_assessment_recorded", "assessment_started", "assessment_response", "assessment_item_skipped",
  "assessment_module_skipped", "assessment_paused", "assessment_resumed", "assessment_completed", "assessment_abandoned",
  "language_profile_recorded",
]);
export const CEFR = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const ASSESSMENT_DIMENSIONS = Object.freeze(["grammar", "vocabulary", "reading", "listening", "production", "conversation"]);

/** Ereignistypen des Session-Lebenszyklus (siehe session/state.js). */
export const SESSION_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.SESSION_STARTED, EVENT_TYPES.SESSION_PAUSED, EVENT_TYPES.SESSION_RESUMED,
  EVENT_TYPES.SESSION_COMPLETED, EVENT_TYPES.SESSION_ABANDONED,
]);
export const SESSION_END_REASONS = Object.freeze(["all_exercises_done", "user", "timeout", "replaced"]);

/** Ereignistypen des Gesprächs-Lebenszyklus (siehe conversation/state.js). */
export const CONVERSATION_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.CONVERSATION_STARTED, EVENT_TYPES.CONVERSATION_TURN, EVENT_TYPES.CONVERSATION_PAUSED,
  EVENT_TYPES.CONVERSATION_RESUMED, EVENT_TYPES.CONVERSATION_COMPLETED, EVENT_TYPES.CONVERSATION_ABANDONED,
]);
export const CONVERSATION_COMPLETION_REASONS = Object.freeze(["goal_reached", "time_budget", "max_turns"]);
export const CONVERSATION_PAUSE_REASONS = Object.freeze(["user", "learner_switch", "language_switch"]);
export const CONVERSATION_BUDGETS = Object.freeze([5, 10, 15, 20, 30]);
export const CONVERSATION_VARIANTS = Object.freeze(["standard", "concrete", "challenge"]);
export const CONVERSATION_DIFFICULTIES = Object.freeze(["standard", "struggling", "confident"]);

/** Unter welchen Bedingungen eine Struktur verwendet wurde (siehe competence/evidence.js). */
export const EVIDENCE = EVIDENCE_LEVELS;
export const REVIEW_GRADES = Object.freeze(["again", "hard", "good", "easy"]);
export const INPUT_MODES = Object.freeze(["text", "speech"]);
export const EXERCISE_MODES = Object.freeze(["training", "challenge"]);
export const SOURCES = Object.freeze(["reference", "rule", "llm"]);
/** Ergebnisse in skill_observation Version 1 (ältere Ereignisse, weiterhin gültig). */
export const OBSERVATION_OUTCOMES = Object.freeze(["correct", "error", "not_used", "unknown"]);

/**
 * Aktuelle Version des Inhalts je Ereignistyp. skill_observation Version 2 hält fest, WIE der Skill
 * mit der Aufgabe zusammenhing (observation_kind), wie sicher die Aussage ist (reliability), worauf
 * sie beruht (basis) und unter welchen Bedingungen er gezeigt wurde (evidence, conditions).
 * Version 1 (ohne diese Angaben) bleibt gültig.
 */
export const EVENT_SCHEMA_VERSIONS = Object.freeze({ skill_observation: 2 });
const ACCEPTED_SCHEMA_VERSIONS = Object.freeze({ skill_observation: [1, 2] });

export function schemaVersionOf(type) {
  return EVENT_SCHEMA_VERSIONS[type] ?? EVENT_SCHEMA_VERSION;
}

const ENVELOPE_KEYS = ["id", "user_id", "device_id", "event_type", "schema_version", "created_at", "local_date", "payload"];
const OPTIONAL_ENVELOPE_KEYS = ["language"]; // fehlt nur bei Ereignissen von vor P11B
export const LANGUAGE_ID = /^[a-z]{2}$/;
const ERROR_KEY = /^(?:common_error:[a-z0-9][a-z0-9_]*|llm:\S.*)$/;

export class EventValidationError extends Error {
  constructor(problems) {
    super(`Ungültiges Ereignis:\n- ${problems.join("\n- ")}`);
    this.name = "EventValidationError";
    this.problems = problems;
  }
}

/**
 * Erzeugt ein geprüftes, unveränderliches Ereignis.
 * @param {{type: string, payload: object, userId: string, deviceId: string, now?: Date, newId?: () => string}} input
 */
export function createEvent({ type, payload, userId, deviceId, language, now = new Date(), newId = uuidv7 }) {
  if (typeof language !== "string" || !LANGUAGE_ID.test(language)) {
    throw new EventValidationError(["language: Lernsprache (z. B. \"es\") ist Pflicht"]);
  }
  const event = deepFreeze({
    id: newId(),
    user_id: userId,
    language,
    device_id: deviceId,
    event_type: type,
    schema_version: schemaVersionOf(type),
    created_at: toUtcIso(now),
    local_date: localDateOf(now),
    payload: structuredClone(payload),
  });
  const problems = validateEvent(event);
  if (problems.length) throw new EventValidationError(problems);
  return event;
}

/** Gibt alle Verstöße zurück (leere Liste = gültig). */
export function validateEvent(event) {
  const problems = [];
  if (event === null || typeof event !== "object") return ["Ereignis: Objekt erwartet"];
  const unknown = Object.keys(event).filter((key) => !ENVELOPE_KEYS.includes(key) && !OPTIONAL_ENVELOPE_KEYS.includes(key));
  const missing = ENVELOPE_KEYS.filter((key) => !Object.hasOwn(event, key));
  if (missing.length) problems.push(`fehlende Felder: ${missing.join(", ")}`);
  if (unknown.length) problems.push(`unbekannte Felder: ${unknown.join(", ")}`);
  if (Object.hasOwn(event, "language") && !LANGUAGE_ID.test(event.language ?? "")) problems.push("language: Sprachcode aus zwei Kleinbuchstaben erwartet");
  for (const key of ["id", "user_id", "device_id"]) {
    if (!isUuidV7(event[key])) problems.push(`${key}: UUID v7 erwartet`);
  }
  const accepted = ACCEPTED_SCHEMA_VERSIONS[event.event_type] ?? [EVENT_SCHEMA_VERSION];
  if (!accepted.includes(event.schema_version)) problems.push(`schema_version: erwartet ${accepted.join(" oder ")}`);
  if (!isUtcIso(event.created_at)) problems.push("created_at: UTC im ISO-8601-Format mit 'Z' erwartet");
  if (!isLocalDate(event.local_date)) problems.push("local_date: YYYY-MM-DD erwartet");

  const validatePayload = PAYLOAD_VALIDATORS[event.event_type];
  if (!validatePayload) {
    problems.push(`event_type: unbekannter Typ ${event.event_type}`);
  } else if (event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    problems.push("payload: Objekt erwartet");
  } else {
    validatePayload(event.payload, problems, event.schema_version);
  }
  return problems;
}

// ---------------------------------------------------------------- Inhalte je Typ

const PAYLOAD_VALIDATORS = {
  /** Eine Antwort auf eine Übung, inklusive vollständiger Bewertung. */
  attempt(p, problems) {
    // P15: Höraufgaben tragen zusätzlich "listening" (wie oft gehört, mit welcher Hilfe geantwortet)
    const keys = ["exercise_id", "exercise_revision", "content_version", "answer_text", "input_mode",
      "duration_ms", "session_id", "conversation_id", "evaluation"];
    exactKeys(p, Object.hasOwn(p, "listening") ? [...keys, "listening"] : keys, problems);
    if (Object.hasOwn(p, "listening")) listeningContext(p.listening, "payload.listening", problems);
    text(p.exercise_id, "payload.exercise_id", problems);
    if (!Number.isInteger(p.exercise_revision) || p.exercise_revision < 1) {
      problems.push("payload.exercise_revision: ganze Zahl ≥ 1 erwartet");
    }
    text(p.content_version, "payload.content_version", problems);
    if (typeof p.answer_text !== "string") problems.push("payload.answer_text: muss Text sein");
    oneOf(p.input_mode, INPUT_MODES, "payload.input_mode", problems);
    if (p.duration_ms !== null && !(Number.isInteger(p.duration_ms) && p.duration_ms >= 0)) {
      problems.push("payload.duration_ms: ganze Zahl ≥ 0 oder null erwartet");
    }
    optionalUuid(p.session_id, "payload.session_id", problems);
    optionalUuid(p.conversation_id, "payload.conversation_id", problems);
    const evaluationProblems = validateEvaluationResult(p.evaluation);
    problems.push(...evaluationProblems.map((problem) => `payload.evaluation: ${problem}`));
    if (evaluationProblems.length) return;
    const view = readEvaluation(p.evaluation);
    if (view.exercise_id !== p.exercise_id) problems.push("payload.evaluation: gehört zu einer anderen Übung");
    if (resultVersion(p.evaluation) === 2) {
      const { exercise, input, content } = p.evaluation;
      if (exercise.revision !== p.exercise_revision) problems.push("payload.evaluation.exercise.revision: passt nicht zum Versuch");
      if (content.version !== p.content_version) problems.push("payload.evaluation.content.version: passt nicht zum Versuch");
      if (input.mode !== p.input_mode) problems.push("payload.evaluation.input.mode: passt nicht zum Versuch");
      if (input.conversation_id !== p.conversation_id) {
        problems.push("payload.evaluation.input.conversation_id: passt nicht zum Versuch");
      }
    }
  },

  /**
   * P15: Kontext beim Hören, keine Evidenz. action: play | pause | replay | support | skip | dont_know;
   * play_count: wie oft bisher gehört; support_level: aktuelle Hilfe-Stufe; session_id: optional.
   */
  listening_interaction(p, problems) {
    exactKeys(p, ["exercise_id", "action", "play_count", "support_level", "session_id"], problems);
    text(p.exercise_id, "payload.exercise_id", problems);
    oneOf(p.action, LISTENING_ACTIONS, "payload.action", problems);
    if (!Number.isInteger(p.play_count) || p.play_count < 0) problems.push("payload.play_count: ganze Zahl ≥ 0 erwartet");
    oneOf(p.support_level, SUPPORT_LEVELS, "payload.support_level", problems);
    optionalUuid(p.session_id, "payload.session_id", problems);
  },

  /**
   * Wie eine Struktur/ein Ausdruck in einem Versuch verwendet wurde.
   *   Version 1: attempt_id, skill_id, outcome (correct|error|not_used|unknown), evidence, exercise_mode, source
   *   Version 2: attempt_id, skill_id, observation_kind, outcome, reliability, basis, evidence, source,
   *              conditions {exercise_type, exercise_mode, evaluation_mode, input_mode, conversation_id, duration_ms}
   */
  skill_observation(p, problems, version) {
    if (version === 1) {
      exactKeys(p, ["attempt_id", "skill_id", "outcome", "evidence", "exercise_mode", "source"], problems);
      oneOf(p.outcome, OBSERVATION_OUTCOMES, "payload.outcome", problems);
      oneOf(p.exercise_mode, EXERCISE_MODES, "payload.exercise_mode", problems);
    } else {
      exactKeys(p, ["attempt_id", "skill_id", "observation_kind", "outcome", "reliability", "basis", "evidence",
        "source", "conditions"], problems);
      oneOf(p.observation_kind, OBSERVATION_KINDS, "payload.observation_kind", problems);
      if (!OUTCOMES_BY_KIND[p.observation_kind]?.includes(p.outcome)) {
        problems.push(`payload.outcome: erlaubt für '${p.observation_kind}' sind ${(OUTCOMES_BY_KIND[p.observation_kind] ?? V2_OUTCOMES).join(", ")}`);
      }
      oneOf(p.reliability, RELIABILITIES, "payload.reliability", problems);
      oneOf(p.basis, BASES, "payload.basis", problems);
      if (p.source === "llm" && p.reliability !== "low") problems.push("payload.reliability: Qwen ist immer 'low'");
      if (p.outcome === "not_observable" && p.reliability !== "low") problems.push("payload.reliability: 'not_observable' ist immer 'low'");
      validateConditions(p.conditions, problems);
    }
    if (!isUuidV7(p.attempt_id)) problems.push("payload.attempt_id: UUID v7 erwartet");
    if (!isSkillId(p.skill_id)) problems.push("payload.skill_id: ungültige Skill-ID");
    oneOf(p.evidence, EVIDENCE, "payload.evidence", problems);
    oneOf(p.source, SOURCES, "payload.source", problems);
  },

  /** Ein konkreter Fehler in einem Versuch (Grundlage des Fehlergedächtnisses). */
  error_event(p, problems) {
    exactKeys(p, ["attempt_id", "error_key", "source", "evidence", "skill_id", "topic_id", "original", "suggestion"], problems);
    if (!isUuidV7(p.attempt_id)) problems.push("payload.attempt_id: UUID v7 erwartet");
    if (typeof p.error_key !== "string" || !ERROR_KEY.test(p.error_key)) {
      problems.push("payload.error_key: 'common_error:<id>' oder 'llm:<…>' erwartet");
    }
    oneOf(p.source, SOURCES, "payload.source", problems);
    oneOf(p.evidence, EVIDENCE, "payload.evidence", problems);
    if (p.skill_id !== null && !isSkillId(p.skill_id)) problems.push("payload.skill_id: ungültige Skill-ID");
    if (p.topic_id !== null && typeof p.topic_id !== "string") problems.push("payload.topic_id: Text oder null");
    for (const key of ["original", "suggestion"]) {
      if (typeof p[key] !== "string") problems.push(`payload.${key}: muss Text sein`);
    }
  },

  /** Eine Wiederholung (Spaced Repetition). Der Algorithmus rechnet später aus dem Verlauf. */
  review_event(p, problems) {
    exactKeys(p, ["skill_id", "grade", "source", "attempt_id"], problems);
    if (!isSkillId(p.skill_id)) problems.push("payload.skill_id: ungültige Skill-ID");
    oneOf(p.grade, REVIEW_GRADES, "payload.grade", problems);
    text(p.source, "payload.source", problems);
    optionalUuid(p.attempt_id, "payload.attempt_id", problems);
  },
};

// ---------------------------------------------------------------- Session-Ereignisse

Object.assign(PAYLOAD_VALIDATORS, {
  /**
   * Eine Session beginnt. Enthält den gestarteten Plan in kompakter Form und die
   * Ersatzübungen je Fokus-Skill, damit der Ablauf allein aus Ereignissen
   * rekonstruierbar ist, auch wenn sich die Inhalte später ändern.
   */
  session_started(p, problems) {
    exactKeys(p, ["session_id", "content_version", "plan", "alternatives"], problems);
    if (!isUuidV7(p.session_id)) problems.push("payload.session_id: UUID v7 erwartet");
    if (p.content_version !== null && typeof p.content_version !== "string") {
      problems.push("payload.content_version: Text oder null erwartet");
    }
    validateStartedPlan(p.plan, problems);
    if (p.alternatives === null || typeof p.alternatives !== "object" || Array.isArray(p.alternatives)) {
      problems.push("payload.alternatives: Objekt erwartet");
    } else {
      for (const [skill, list] of Object.entries(p.alternatives)) {
        if (!isSkillId(skill)) problems.push(`payload.alternatives: ungültige Skill-ID ${skill}`);
        if (!Array.isArray(list)) problems.push(`payload.alternatives.${skill}: Liste erwartet`);
        else list.forEach((entry, i) => validateSessionExercise(entry, `payload.alternatives.${skill}[${i}]`, problems, false));
      }
    }
  },
  session_paused(p, problems) {
    exactKeys(p, ["session_id", "reason"], problems);
    if (!isUuidV7(p.session_id)) problems.push("payload.session_id: UUID v7 erwartet");
    if (p.reason !== null && typeof p.reason !== "string") problems.push("payload.reason: Text oder null erwartet");
  },
  session_resumed(p, problems) {
    exactKeys(p, ["session_id"], problems);
    if (!isUuidV7(p.session_id)) problems.push("payload.session_id: UUID v7 erwartet");
  },
  session_completed(p, problems) {
    exactKeys(p, ["session_id", "reason"], problems);
    if (!isUuidV7(p.session_id)) problems.push("payload.session_id: UUID v7 erwartet");
    oneOf(p.reason, SESSION_END_REASONS, "payload.reason", problems);
  },
  session_abandoned(p, problems) {
    exactKeys(p, ["session_id", "reason"], problems);
    if (!isUuidV7(p.session_id)) problems.push("payload.session_id: UUID v7 erwartet");
    oneOf(p.reason, SESSION_END_REASONS, "payload.reason", problems);
  },
});

// ---------------------------------------------------------------- Gesprächs-Ereignisse (P11A)

const DECISION_KEYS = ["rule", "move_id", "exercise_id", "aspect_id", "variant", "difficulty", "reaction_es", "question_es"];
const ANALYSIS_KEYS = ["words", "moves", "aspects", "uncertain", "disagree", "weigh", "pros_cons", "short", "long",
  "off_topic", "asks_question"];

/** Eine Frage der Conversation Engine (Regel, Schritt, Frage). */
function validateDecision(d, path, problems) {
  if (d === null || typeof d !== "object" || Array.isArray(d)) {
    problems.push(`${path}: Objekt erwartet`);
    return;
  }
  exactKeysAt(d, DECISION_KEYS, path, problems);
  for (const key of ["rule", "move_id", "exercise_id", "question_es"]) text(d[key], `${path}.${key}`, problems);
  if (d.aspect_id !== null && typeof d.aspect_id !== "string") problems.push(`${path}.aspect_id: Text oder null`);
  oneOf(d.variant, CONVERSATION_VARIANTS, `${path}.variant`, problems);
  oneOf(d.difficulty, CONVERSATION_DIFFICULTIES, `${path}.difficulty`, problems);
  if (typeof d.reaction_es !== "string") problems.push(`${path}.reaction_es: Text erwartet`);
}

Object.assign(PAYLOAD_VALIDATORS, {
  /** Ein Gespräch beginnt: Szenario, Ziel, Zeitbudget und die Eröffnungsfrage der Engine. */
  conversation_started(p, problems) {
    exactKeys(p, ["conversation_id", "scenario_id", "scenario_revision", "content_version", "goal", "budget_minutes", "opening"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
    text(p.scenario_id, "payload.scenario_id", problems);
    text(p.goal, "payload.goal", problems);
    if (!Number.isInteger(p.scenario_revision) || p.scenario_revision < 1) problems.push("payload.scenario_revision: ganze Zahl ≥ 1 erwartet");
    if (p.content_version !== null && typeof p.content_version !== "string") problems.push("payload.content_version: Text oder null erwartet");
    oneOf(p.budget_minutes, CONVERSATION_BUDGETS, "payload.budget_minutes", problems);
    validateDecision(p.opening, "payload.opening", problems);
  },
  /**
   * Eine beantwortete Runde: Verweis auf die Antwort (attempt), Analyse der Antwort (Gesprächszustand,
   * keine Bewertung) und die nächste Frage (null = Gespräch endet). Gespeichert, damit der Verlauf beim
   * Replay gleich bleibt.
   */
  conversation_turn(p, problems) {
    exactKeys(p, ["conversation_id", "turn_index", "exercise_id", "attempt_id", "analysis", "next", "source", "reason"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
    if (!Number.isInteger(p.turn_index) || p.turn_index < 0) problems.push("payload.turn_index: ganze Zahl ≥ 0 erwartet");
    text(p.exercise_id, "payload.exercise_id", problems);
    if (!isUuidV7(p.attempt_id)) problems.push("payload.attempt_id: UUID v7 erwartet");
    if (p.analysis === null || typeof p.analysis !== "object" || Array.isArray(p.analysis)) problems.push("payload.analysis: Objekt erwartet");
    else exactKeysAt(p.analysis, ANALYSIS_KEYS, "payload.analysis", problems);
    if (p.next !== null) validateDecision(p.next, "payload.next", problems);
    oneOf(p.source, ["policy", "assistant"], "payload.source", problems);
    text(p.reason, "payload.reason", problems);
  },
  conversation_paused(p, problems) {
    exactKeys(p, ["conversation_id", "reason"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
    oneOf(p.reason, CONVERSATION_PAUSE_REASONS, "payload.reason", problems);
  },
  conversation_resumed(p, problems) {
    exactKeys(p, ["conversation_id"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
  },
  conversation_completed(p, problems) {
    exactKeys(p, ["conversation_id", "reason"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
    oneOf(p.reason, CONVERSATION_COMPLETION_REASONS, "payload.reason", problems);
  },
  conversation_abandoned(p, problems) {
    exactKeys(p, ["conversation_id", "reason"], problems);
    if (!isUuidV7(p.conversation_id)) problems.push("payload.conversation_id: UUID v7 erwartet");
    oneOf(p.reason, ["user", "replaced"], "payload.reason", problems);
  },
});

// ---------------------------------------------------------------- Einstufung und Profilverlauf (P11B)

Object.assign(PAYLOAD_VALIDATORS, {
  /** Selbsteinschätzung: KEINE Kompetenz, nur Startpunkt der Einstufung und Vergleichswert im Profil. */
  self_assessment_recorded(p, problems) {
    exactKeys(p, ["level"], problems);
    oneOf(p.level, CEFR, "payload.level", problems);
  },
  assessment_started(p, problems) {
    exactKeys(p, ["assessment_id", "kind", "self_assessment", "modules", "content_version"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.kind, ["initial", "reassessment"], "payload.kind", problems);
    if (p.self_assessment !== null) oneOf(p.self_assessment, CEFR, "payload.self_assessment", problems);
    if (!Array.isArray(p.modules) || !p.modules.every((m) => ASSESSMENT_DIMENSIONS.includes(m))) problems.push("payload.modules: Liste von Bereichen erwartet");
    if (p.content_version !== null && typeof p.content_version !== "string") problems.push("payload.content_version: Text oder null erwartet");
  },
  /** Antwort auf eine Einstufungsaufgabe: verweist auf den Versuch (attempt), score 0–1 aus der Bewertung. */
  assessment_response(p, problems) {
    exactKeys(p, ["assessment_id", "dimension", "item_id", "attempt_id", "score"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.dimension, ASSESSMENT_DIMENSIONS, "payload.dimension", problems);
    text(p.item_id, "payload.item_id", problems);
    if (!isUuidV7(p.attempt_id)) problems.push("payload.attempt_id: UUID v7 erwartet");
    if (typeof p.score !== "number" || !(p.score >= 0 && p.score <= 1)) problems.push("payload.score: Zahl zwischen 0 und 1 erwartet");
  },
  assessment_item_skipped(p, problems) {
    exactKeys(p, ["assessment_id", "dimension", "item_id", "reason"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.dimension, ASSESSMENT_DIMENSIONS, "payload.dimension", problems);
    text(p.item_id, "payload.item_id", problems);
    oneOf(p.reason, ["dont_know"], "payload.reason", problems);
  },
  assessment_module_skipped(p, problems) {
    exactKeys(p, ["assessment_id", "dimension", "reason"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.dimension, ASSESSMENT_DIMENSIONS, "payload.dimension", problems);
    oneOf(p.reason, ["no_microphone", "user"], "payload.reason", problems);
  },
  assessment_paused(p, problems) {
    exactKeys(p, ["assessment_id", "reason"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.reason, ["user", "learner_switch", "language_switch"], "payload.reason", problems);
  },
  assessment_resumed(p, problems) {
    exactKeys(p, ["assessment_id"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
  },
  assessment_completed(p, problems) {
    exactKeys(p, ["assessment_id", "reason"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.reason, ["all_modules_done", "user"], "payload.reason", problems);
  },
  assessment_abandoned(p, problems) {
    exactKeys(p, ["assessment_id", "reason"], problems);
    if (!isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 erwartet");
    oneOf(p.reason, ["user", "replaced"], "payload.reason", problems);
  },
  /**
   * Historischer Profilstand (ProfileHistory): Momentaufnahme der Projektion zu einem Zeitpunkt, z. B. nach
   * einer Einstufung. Wird nur für den Verlauf gelesen; das aktuelle Profil wird immer neu berechnet.
   */
  language_profile_recorded(p, problems) {
    exactKeys(p, ["source", "assessment_id", "model", "overall", "dimensions"], problems);
    oneOf(p.source, ["assessment", "reassessment"], "payload.source", problems);
    if (p.assessment_id !== null && !isUuidV7(p.assessment_id)) problems.push("payload.assessment_id: UUID v7 oder null erwartet");
    text(p.model, "payload.model", problems);
    if (!p.overall || typeof p.overall !== "object") problems.push("payload.overall: Objekt erwartet");
    if (!p.dimensions || typeof p.dimensions !== "object") problems.push("payload.dimensions: Objekt erwartet");
  },
});

/** Bedingungen, unter denen eine Beobachtung entstand (aus Übung und Versuch). */
function validateConditions(c, problems) {
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    problems.push("payload.conditions: Objekt erwartet");
    return;
  }
  const keys = ["exercise_type", "exercise_mode", "evaluation_mode", "input_mode", "conversation_id", "duration_ms"];
  const missing = keys.filter((key) => !Object.hasOwn(c, key));
  const unknown = Object.keys(c).filter((key) => !keys.includes(key));
  if (missing.length) problems.push(`payload.conditions: fehlende Felder ${missing.join(", ")}`);
  if (unknown.length) problems.push(`payload.conditions: unbekannte Felder ${unknown.join(", ")}`);
  oneOf(c.exercise_type, EXERCISE_TYPES, "payload.conditions.exercise_type", problems);
  oneOf(c.exercise_mode, EXERCISE_MODES, "payload.conditions.exercise_mode", problems);
  oneOf(c.evaluation_mode, EVALUATION_MODES, "payload.conditions.evaluation_mode", problems);
  oneOf(c.input_mode, INPUT_MODES, "payload.conditions.input_mode", problems);
  optionalUuid(c.conversation_id, "payload.conditions.conversation_id", problems);
  if (c.duration_ms !== null && !(Number.isInteger(c.duration_ms) && c.duration_ms >= 0)) {
    problems.push("payload.conditions.duration_ms: ganze Zahl ≥ 0 oder null erwartet");
  }
}

function validateStartedPlan(plan, problems) {
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    problems.push("payload.plan: Objekt erwartet");
    return;
  }
  exactKeys(plan, ["format", "version", "generated_at", "minutes", "objective", "focus_skills", "exercises"], problems);
  // v1: Sessions vor der Wiederholungsplanung (bleiben gültig und abspielbar), v2: aktueller Planner
  if (plan.format !== "session_plan" || ![1, 2].includes(plan.version)) problems.push("payload.plan: SessionPlan v1 oder v2 erwartet");
  if (!isUtcIso(plan.generated_at)) problems.push("payload.plan.generated_at: UTC-Zeit erwartet");
  if (!Number.isInteger(plan.minutes) || plan.minutes < 1) problems.push("payload.plan.minutes: ganze Zahl ≥ 1 erwartet");
  if (!plan.objective || typeof plan.objective.id !== "string" || typeof plan.objective.reason !== "string") {
    problems.push("payload.plan.objective: id und reason erwartet");
  }
  if (!Array.isArray(plan.focus_skills)) problems.push("payload.plan.focus_skills: Liste erwartet");
  else plan.focus_skills.forEach((f, i) => {
    if (!isSkillId(f?.skill_id)) problems.push(`payload.plan.focus_skills[${i}].skill_id: ungültig`);
    if (typeof f?.reason !== "string") problems.push(`payload.plan.focus_skills[${i}].reason: Text erwartet`);
  });
  if (!Array.isArray(plan.exercises) || plan.exercises.length === 0) {
    problems.push("payload.plan.exercises: nicht-leere Liste erwartet");
  } else {
    plan.exercises.forEach((e, i) => validateSessionExercise(e, `payload.plan.exercises[${i}]`, problems, true));
  }
}

function listeningContext(value, path, problems) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${path}: Objekt erwartet`);
    return;
  }
  exactKeysAt(value, ["play_count", "support_level"], path, problems);
  if (!Number.isInteger(value.play_count) || value.play_count < 0) problems.push(`${path}.play_count: ganze Zahl ≥ 0 erwartet`);
  oneOf(value.support_level, SUPPORT_LEVELS, `${path}.support_level`, problems);
}

function validateSessionExercise(entry, path, problems, withReason) {
  if (entry === null || typeof entry !== "object") {
    problems.push(`${path}: Objekt erwartet`);
    return;
  }
  text(entry.exercise_id, `${path}.exercise_id`, problems);
  text(entry.type, `${path}.type`, problems);
  oneOf(entry.evidence, EVIDENCE, `${path}.evidence`, problems);
  if (!Number.isInteger(entry.estimated_seconds) || entry.estimated_seconds < 0) {
    problems.push(`${path}.estimated_seconds: ganze Zahl ≥ 0 erwartet`);
  }
  if (withReason) {
    if (!isSkillId(entry.skill_id)) problems.push(`${path}.skill_id: ungültige Skill-ID`);
    if (typeof entry.reason !== "string") problems.push(`${path}.reason: Text erwartet`);
  }
}

function exactKeys(value, keys, problems) {
  exactKeysAt(value, keys, "payload", problems);
}

function exactKeysAt(value, keys, path, problems) {
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (missing.length) problems.push(`${path}: fehlende Felder ${missing.join(", ")}`);
  if (unknown.length) problems.push(`${path}: unbekannte Felder ${unknown.join(", ")}`);
}

function oneOf(value, allowed, path, problems) {
  if (!allowed.includes(value)) problems.push(`${path}: erlaubt sind ${allowed.join(", ")}`);
}

function text(value, path, problems) {
  if (typeof value !== "string" || value === "") problems.push(`${path}: nicht-leerer Text erwartet`);
}

function optionalUuid(value, path, problems) {
  if (value !== null && !isUuidV7(value)) problems.push(`${path}: UUID v7 oder null erwartet`);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
