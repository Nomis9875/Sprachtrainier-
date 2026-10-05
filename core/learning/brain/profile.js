/**
 * LearnerProfile v1: das persönliche Lernprofil (Adaptive Learning Brain, Teil 1).
 *
 *   Ereignisse → CompetenceSnapshot ("wie sicher?")  ┐
 *              → ReviewSnapshot     ("wann wieder?") ├─▶ buildLearnerProfile() ─▶ LearnerProfile
 *              → Erinnerungen       ("welches Muster?")┘         je Skill und je Bereich
 *
 * Das Profil ist KEINE neue Wissensbasis: Es führt die drei bestehenden Projektionen je Skill zusammen,
 * ordnet ein und zählt. Es ist wie sie deterministisch (Stichtag = Snapshot, kein Zufall, keine Uhr),
 * nie gespeichert und jederzeit aus den Ereignissen neu berechenbar.
 *
 * ─── Fehlerlage je Skill (error_state) ───────────────────────────────────────
 *
 *   none        keine verlässlichen Fehler
 *   one_off     Fehler ohne Muster (z. B. ein einzelner Fehler): noch kein Wissen über den Lerner
 *               (danach ≥ 3 Erfolge an ≥ 2 Tagen → overcome: der Fehler ist widerlegt)
 *   recurring   Erinnerung "recurring_error" candidate/active: wiederkehrend
 *   persistent  dieselbe Erinnerung, hartnäckig (Fehler an ≥ 4 Tagen über ≥ 21 Tage)
 *   weakening   Erinnerung lässt nach: seit dem letzten Fehler richtig verwendet (Gegenbeleg)
 *   unverified  (P13) lange kein Fehler, aber auch nie richtig gezeigt: Ruhe ist kein Beleg, nicht überwunden
 *   avoided     (P13) wie unverified, und der Lerner hatte ≥ 2 Gelegenheiten (freie/spontane Aufgaben, die den
 *               Fehler provozieren) und hat die Struktur dort umgangen
 *   overcome    Erinnerung resolved: überwunden (auch auf der Stufe des Fehlers gezeigt)
 *
 * ─── Zustand je Skill (status) ───────────────────────────────────────────────
 *
 *   new         noch nie beobachtet
 *   unsure      aktuell unsicher: wiederkehrender/hartnäckiger Fehler, Relearning oder
 *               zuletzt < 75 % richtig bei vorhandenen Fehlern, außer die letzten ≥ 3 Abrufe gelangen
 *               (eine aktuelle Erfolgsserie zählt mehr als die alte Quote)
 *   developing  eingeführt / in Übung, ohne akute Unsicherheit
 *   stable      Kompetenzstufe "stable"
 *   mastered    Kompetenzstufe "mastered" und nicht im Relearning (stabil beherrscht)
 *
 * Kompetenz bleibt die des Kompetenzmodells: Ein Lückentext zählt als "controlled", eine freie
 * Antwort als "free", ein Gespräch als "spontaneous". "mastered" verlangt freie/spontane Nachweise
 * (MASTERY_RULES); kontrollierte Erfolge allein führen nie dorthin.
 */

import { EVIDENCE_LEVELS, evidenceRank } from "../competence/evidence.js";
import { MASTERY_LEVELS } from "../competence/mastery.js";
import { DAY_MS } from "../repetition/model.js";

export const LEARNER_PROFILE_FORMAT = "learner_profile";
export const LEARNER_PROFILE_VERSION = 1;
export const ERROR_STATES = Object.freeze(["none", "one_off", "recurring", "persistent", "weakening", "unverified", "avoided", "overcome"]);
/** Ab so vielen umgangenen Gelegenheiten gilt ein ruhender Fehler als umgangen (P13). */
export const AVOIDANCE_MIN_OPPORTUNITIES = 2;
export const SKILL_STATUSES = Object.freeze(["new", "unsure", "developing", "stable", "mastered"]);

export const PROFILE_RULES = Object.freeze({
  /** Ab so vielen verlässlichen Nachweisen gilt die Aussage über einen Skill als voll belegt. */
  confidenceSaturation: 8,
  /** "sicher" auf einer Stufe: mindestens so viele Erfolge und diese Quote (Zielniveau knapp darüber). */
  secureMinSuccesses: 2,
  secureMinRate: 0.8,
  /** "aktuell unsicher", wenn zuletzt weniger richtig war (wie das Kompetenzmodell: 75 %) … */
  unsureAccuracy: 0.75,
  /** … es sei denn, so viele Abrufe in Folge gelangen. */
  recoveredStreak: 3,
  /** Ein Fehler ohne Muster gilt als widerlegt nach so vielen Erfolgen an so vielen Tagen (wie das Gedächtnis). */
  oneOffOvercomeSuccesses: 3,
  oneOffOvercomeDays: 2,
});

const OPEN = new Set(["candidate", "active", "weakening"]);
const URGENCY = Object.freeze({ overdue: "high", due: "medium", soon: "low", not_due: "none" });

/**
 * @param {{snapshot: object, reviews: object, memories: object[], library?: object|null}} input
 *   snapshot: CompetenceSnapshot v1, reviews: ReviewSnapshot v1 zum selben Stichtag,
 *   memories: MemoryRecords aus deriveMemories() zum selben Stichtag
 */
export function buildLearnerProfile({ snapshot, reviews, memories, library = null }) {
  if (snapshot?.format !== "competence_snapshot") throw new TypeError("snapshot: CompetenceSnapshot v1 erwartet");
  if (reviews?.format !== "review_snapshot" || reviews.generated_at !== snapshot.generated_at) {
    throw new TypeError("reviews: ReviewSnapshot v1 zum Stichtag des CompetenceSnapshot erwartet");
  }
  if (!Array.isArray(memories)) throw new TypeError("memories: Liste von MemoryRecords erwartet");
  const now = new Date(snapshot.generated_at);
  const reviewOf = new Map(reviews.items.map((item) => [item.skill_id, item]));
  const memoriesOf = new Map();
  for (const memory of memories) {
    if (!memory.skill_id) continue;
    const list = memoriesOf.get(memory.skill_id) ?? [];
    list.push(memory);
    memoriesOf.set(memory.skill_id, list);
  }

  const skills = snapshot.skills.map((skill) => profileSkill(skill, reviewOf.get(skill.skill_id) ?? null,
    memoriesOf.get(skill.skill_id) ?? [], library, now));
  return {
    format: LEARNER_PROFILE_FORMAT,
    version: LEARNER_PROFILE_VERSION,
    generated_at: snapshot.generated_at,
    user_id: snapshot.user_id,
    skills,
    areas: areasOf(skills, library),
    summary: {
      observed_skills: skills.filter((s) => s.status !== "new").length,
      by_status: countBy(skills, "status", SKILL_STATUSES),
      by_error_state: countBy(skills, "error_state", ERROR_STATES),
      open_memories: memories.filter((m) => OPEN.has(m.status)).length,
    },
    metadata: {
      derivation: "competence_snapshot + review_snapshot + memories",
      persisted: false,
      rules: PROFILE_RULES,
      snapshot_version: snapshot.version,
      review_version: reviews.version,
    },
  };
}

function profileSkill(skill, review, memories, library, now) {
  const signals = skill.successes + skill.failures;
  const lastSeenDays = skill.last_seen_at ? round1((now.getTime() - Date.parse(skill.last_seen_at)) / DAY_MS) : null;
  const recurring = memories.find((m) => m.memory_type === "recurring_error" && m.status !== "superseded") ?? null;
  const errorState = errorStateOf(skill, recurring);
  return {
    skill_id: skill.skill_id,
    type: skill.type,
    label: library?.skill?.(skill.skill_id)?.label ?? skill.skill_id,
    topic_id: library?.skill?.(skill.skill_id)?.topic_id ?? null,
    status: statusOf(skill, review, errorState),
    error_state: errorState,
    stats: {
      attempts: round2(signals + skill.missed_opportunities),
      successes: round2(skill.successes),
      failures: round2(skill.failures),
      missed_opportunities: skill.missed_opportunities,
      error_rate: signals > 0 ? round2(skill.failures / signals) : null,
      recent_accuracy: skill.recent_accuracy,
      consecutive_successes: review?.consecutive_successes ?? 0,
      consecutive_failures: review?.consecutive_failures ?? 0,
      successes_since_last_failure: skill.since_last_failure.successes,
      exercises_tried: skill.exercise_contexts.length,
      exercises_succeeded: skill.exercise_contexts.filter((c) => c.successes > 0).length,
      last_seen_at: skill.last_seen_at,
      last_success_at: skill.last_success_at,
      last_failure_at: skill.last_failure_at,
      last_seen_days: lastSeenDays,
    },
    competence: {
      mastery: skill.mastery,
      level_index: MASTERY_LEVELS.indexOf(skill.mastery),
      highest_evidence: skill.highest_success_evidence,
      secure_evidence: secureLevel(skill),
      path_stage: skill.path.stage,
      next_level_missing: skill.next_level_missing,
      evidence: skill.evidence,
    },
    repetition: review ? {
      phase: review.phase,
      due_status: review.phase === "new" ? null : review.due_status,
      urgency: review.phase === "new" ? "none" : review.phase === "relearning" ? "high" : URGENCY[review.due_status],
      retrievability: review.retrievability,
      stability_days: review.stability,
      lapses: review.lapses,
    } : null,
    confidence: round2(Math.min(1, signals / PROFILE_RULES.confidenceSaturation)),
    memories: memories.map((m) => ({ memory_id: m.memory_id, memory_type: m.memory_type, status: m.status, importance: m.importance })),
  };
}

function errorStateOf(skill, recurring) {
  if (recurring) {
    if (recurring.status === "resolved") return "overcome";
    if (recurring.status === "weakening") {
      const facts = recurring.content.facts;
      if (facts.weakening_reason !== "quiet") return "weakening";
      return (facts.silent_opportunities ?? 0) >= AVOIDANCE_MIN_OPPORTUNITIES ? "avoided" : "unverified";
    }
    return recurring.content.facts.persistent ? "persistent" : "recurring";
  }
  if (skill.failures <= 0) return "none";
  const after = skill.since_last_failure;
  return after.successes >= PROFILE_RULES.oneOffOvercomeSuccesses && after.success_days >= PROFILE_RULES.oneOffOvercomeDays
    ? "overcome"
    : "one_off";
}

function statusOf(skill, review, errorState) {
  if (skill.mastery === "unknown") return "new";
  const recovered = (review?.consecutive_successes ?? 0) >= PROFILE_RULES.recoveredStreak;
  const lowAccuracy = skill.failures > 0 && skill.recent_accuracy !== null && skill.recent_accuracy < PROFILE_RULES.unsureAccuracy && !recovered;
  if (errorState === "recurring" || errorState === "persistent" || review?.phase === "relearning" || lowAccuracy) return "unsure";
  if (skill.mastery === "mastered") return "mastered";
  if (skill.mastery === "stable") return "stable";
  return "developing";
}

/** Höchste Stufe, auf der der Skill sicher gelingt (≥ 2 Erfolge, ≥ 80 %); null, wenn keine. */
export function secureLevel(skill) {
  let secure = null;
  for (const level of EVIDENCE_LEVELS) {
    const { successes, failures } = skill.evidence[level];
    if (successes >= PROFILE_RULES.secureMinSuccesses && successes / (successes + failures) >= PROFILE_RULES.secureMinRate
      && (secure === null || evidenceRank(level) > evidenceRank(secure))) secure = level;
  }
  return secure;
}

/**
 * Bereiche: die ersten zwei Ebenen des Themenbaums aus dem Inhalt (z. B. grammar.subjunctive,
 * vocabulary.collocations, interference.german). Sprachneutral: die Namen kommen aus dem Inhalt.
 */
function areasOf(skills, library) {
  const groups = new Map();
  for (const skill of skills) {
    if (!skill.topic_id) continue;
    const id = skill.topic_id.split(".").slice(0, 2).join(".");
    const list = groups.get(id) ?? [];
    list.push(skill);
    groups.set(id, list);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, list]) => {
    const observed = list.filter((s) => s.status !== "new");
    const successes = observed.reduce((sum, s) => sum + s.stats.successes, 0);
    const failures = observed.reduce((sum, s) => sum + s.stats.failures, 0);
    return {
      area_id: id,
      name: library?.topic?.(id)?.name_de ?? id,
      skills: list.length,
      observed: observed.length,
      unsure: observed.filter((s) => s.status === "unsure").length,
      secure: observed.filter((s) => s.status === "stable" || s.status === "mastered").length,
      open_error_patterns: observed.filter((s) => ["recurring", "persistent", "weakening", "unverified", "avoided"].includes(s.error_state)).length,
      error_rate: successes + failures > 0 ? round2(failures / (successes + failures)) : null,
      level: list.length ? round2(list.reduce((sum, s) => sum + s.competence.level_index, 0) / (list.length * 4)) : 0,
    };
  });
}

function countBy(list, key, keys) {
  return Object.fromEntries(keys.map((k) => [k, list.filter((x) => x[key] === k).length]));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
