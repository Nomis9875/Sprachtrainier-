/**
 * JavaScript-Kern der Spanisch-App: öffentliche Schnittstelle.
 *
 * Läuft ohne DOM und ohne Python, im Browser (Laptop, iPhone-PWA) wie in Node (Tests).
 */

export { CHECKPOINT_DAYS, COACHING_REPORT_VERSION, RECOMMENDATIONS, buildCoachingReport } from "./learning/coaching/report.js";
export { COVERAGE_CLASSES, skillCoverage } from "./learning/coverage/analysis.js";
export { COVERAGE_REPORT_VERSION, buildCoverageReport } from "./learning/coverage/report.js";
export { CURRENT_CAPABILITIES, LIMITATIONS, OBSERVATION_KINDS } from "./learning/observation/capabilities.js";
export { OBSERVATION_REPORT_VERSION, RELIABILITY_LEVELS, buildObservationReport } from "./learning/observation/report.js";
export { ContentLibrary, ContentPackageError, loadContentPackage } from "./content/library.js";
export { SKILL_TYPES, isSkillId, parseSkillId, skillId } from "./content/skills.js";
export { Detector } from "./evaluation/detector.js";
export { EvaluationError, JS_EVALUATOR, evaluateAnswer, rulebookFor } from "./evaluation/evaluate.js";
export { InvalidAnswerError } from "./evaluation/closed.js";
export { PATTERN_SYNTAX_VERSION, PatternError, compilePattern } from "./evaluation/patterns.js";
export {
  RESULT_VERSION, addLlmAnalysis, migrateEvaluationResult, readEvaluation, resultVersion, validateEvaluationResult,
} from "./evaluation/result.js";
export { normalize, prepare, stripAccents } from "./evaluation/text.js";
export { EVIDENCE_LEVELS, EVIDENCE_WEIGHT, evidenceForExercise, evidenceForObservation } from "./learning/competence/evidence.js";
export { ERROR_TRENDS, MASTERY_LEVELS, MASTERY_RULES, SKILL_PATHS, TRENDS, classifyTrend } from "./learning/competence/mastery.js";
export { COMPETENCE_SNAPSHOT_VERSION, buildCompetenceSnapshot } from "./learning/competence/snapshot.js";
export { LearningEngine } from "./learning/engine.js";
export { buildLearnerBrain } from "./learning/brain/brain.js";
export { BRAIN_RULES, LEARNING_NEED_VERSION, RECOMMENDED_EXERCISE, deriveLearningNeeds, learningNeedFor } from "./learning/brain/needs.js";
export {
  ERROR_STATES, LEARNER_PROFILE_VERSION, PROFILE_RULES, SKILL_STATUSES, buildLearnerProfile, secureLevel,
} from "./learning/brain/profile.js";
export { NEED_BASE, assessSkill, isAdvancedTopic } from "./learning/planning/needs.js";
export { OBJECTIVES, SESSION_LENGTHS, SESSION_PLAN_VERSION, learnerItem, learnerTitle, learnerView, planSession } from "./learning/planning/planner.js";
export { PRIORITY_RULES, PURPOSES, scoreSkillForSession } from "./learning/planning/priority.js";
export { ACTIVITY_SUMMARY_VERSION, PRACTICE_CAP_SECONDS, buildActivitySummary, shiftDay } from "./learning/progress/activity.js";
export {
  DUE_STATUSES, REVIEW_PHASES, REVIEW_RULES, calculateReviewState, describeReviewState, newReviewState, retrievability,
} from "./learning/repetition/model.js";
export { REVIEW_SNAPSHOT_VERSION, buildReviewSnapshot, reviewInputs } from "./learning/repetition/snapshot.js";
export {
  EVENT_SCHEMA_VERSIONS, EVENT_TYPES, EventValidationError, SESSION_EVENT_TYPES, createEvent, validateEvent,
} from "./learning/events.js";
export { EXERCISE_RESULTS, exerciseOutcome } from "./learning/session/outcome.js";
export { SessionError, SessionRuntime } from "./learning/session/runtime.js";
export { SESSION_STATUSES, listSessions, plannedSession, replaySession } from "./learning/session/state.js";
export { SESSION_SUMMARY_VERSION, buildSessionSummary } from "./learning/session/summary.js";
export { IndexedDBStorage } from "./storage/indexeddb.js";
export { MemoryStorage } from "./storage/memory.js";
export { DERIVATION_RULES, MEMORY_DERIVATION_VERSION, deriveMemories } from "./memory/derive.js";
export {
  MEMORY_SCHEMA_VERSION, MEMORY_STATUSES, MEMORY_TYPES, MemoryValidationError, OPEN_MEMORY_STATUSES, createMemoryRecord,
  memoryRecordErrors, validateMemoryRecord,
} from "./memory/model.js";
export {
  LexicalMemoryIndex, LocalMemoryStore, MEMORY_INDEX_METHODS, MEMORY_STORE_METHODS, MemoryStoreError, assertMemoryIndex,
  assertMemoryStore,
} from "./memory/store.js";
export { uuidv7 } from "./util/ids.js";
