/**
 * Erinnerungen aus der Lernhistorie ableiten (regelbasiert, deterministisch, ohne KI).
 *
 *   Ereignisse ─collectEvidence─▶ Nachweise ─Regeln je Skill─▶ MemoryRecords (origin "derived")
 *
 * Wie Kompetenz- und Wiederholungsstand ist das Ergebnis eine Projektion: Dieselben Ereignisse und
 * derselbe Stichtag ergeben dieselben Erinnerungen (Reihenfolge und Duplikate egal, Ereignisse nach
 * dem Stichtag zählen nicht). Es zählen nur verlässliche Nachweise: keine Qwen-Beobachtungen, keine
 * unsicheren Treffer ("low").
 *
 * Grundsatz: Ein einzelner Fehler ist keine Erinnerung, erst ein wiederkehrendes Muster.
 *
 *   recurring_error    Fehler bei einem Skill (auch typische Fehler wie por/para)
 *                      entsteht   ≥ 2 Fehler an ≥ 2 Tagen, oder ≥ 3 Fehler an einem Tag  → candidate
 *                      belegt     ≥ 3 Fehler an ≥ 2 Tagen                                → active
 *                      lässt nach Erfolg nach dem letzten Fehler oder > 30 Tage Ruhe     → weakening
 *                                 (P13: facts.weakening_reason "counter_evidence" oder "quiet"; Ruhe allein
 *                                 ist kein Beleg. facts.silent_opportunities zählt freie/spontane Antworten
 *                                 auf Aufgaben, die den Fehler provozieren, in denen weder Fehler noch richtige
 *                                 Form vorkamen: die Struktur wurde umgangen)
 *                      überwunden ≥ 3 Erfolge an ≥ 2 Tagen nach dem letzten Fehler, davon
 *                                 mindestens einer auf der Stufe, auf der der Fehler passierte
 *                                 (höchstens "free"): drei richtige Lückentexte heben einen Fehler
 *                                 aus freien Antworten nicht auf                        → resolved
 *                      hartnäckig (facts.persistent): Fehler an ≥ 4 Tagen, erster bis letzter ≥ 21
 *                                 Tage auseinander, nicht überwunden (wie das Coaching, ERROR_PATTERN_RULES)
 *                      Ein neuer Fehler nach "resolved" öffnet das Muster wieder (relapses zählt mit).
 *                      Ein einzelner Fehler bleibt bewusst ohne Erinnerung: Das Lernprofil führt ihn als
 *                      "one_off" (brain/profile.js), eine Erinnerung entsteht erst durch Wiederholung.
 *   production_gap     auf einer Stufe sicher, auf der nächsten schwach (dieselbe Regel wie die
 *                      Planung, needs.js weakStep): kontrolliert → frei, frei → spontan.
 *                      Tag für Tag nachgerechnet: Rückt die Lücke von "frei" zu "spontan" weiter,
 *                      wird die alte Erinnerung superseded; schließt sie sich, ist sie resolved.
 *   avoided_structure  wiederholt vermieden: Aufgabe verlangte den Skill und er kam nicht, oder die
 *                      Antwort war richtig, aber einfacher als möglich (C1-Signal, kein Fehler)
 *                      ≥ 2 an ≥ 2 Tagen → candidate, ≥ 3 an ≥ 2 Tagen → active;
 *                      danach frei/spontan gezeigt: 1× → weakening, ≥ 2× → resolved
 *   stable_strength    beherrscht laut Wiederholungsmodell (Phase mastered) → active;
 *                      fällig/überfällig oder nach einem Rückfall → weakening
 *   auditory_recognition_gap (P16) schriftlich sicher, im Gesprochenen wiederholt nicht erkannt (Hörantworten ohne
 *                      Hilfe, listening/evidence.js AUDITORY_GAP_RULES): ≥ 2 Fehler aus ≥ 2 Kontexten → candidate,
 *                      ≥ 3 an ≥ 2 Tagen → active, danach verstanden → weakening, ≥ 2× in ≥ 2 Kontexten → resolved.
 *                      Ein einzelnes Nichtverstehen ist nie eine Erinnerung; ohne Inhaltspaket keine (nur der Inhalt
 *                      sagt, welche Aufgabe eine Höraufgabe ist).
 *
 * confidence  wie gut das Muster belegt ist (Anzahl verlässlicher Nachweise, gesättigt)
 * importance  Grundgewicht der Art × Aktualität (Halbwertszeit 30 Tage) × Status
 */

import { isSkillId, parseSkillId, SKILL_TYPES } from "../content/skills.js";
import { ERROR_PATTERN_RULES } from "../learning/coaching/analysis.js";
import { evidenceForExercise, evidenceRank } from "../learning/competence/evidence.js";
import { addEvidence, collectEvidence, emptyEvidenceBuckets, roundedEvidence } from "../learning/competence/projection.js";
import { weakStep } from "../learning/planning/needs.js";
import { calculateReviewState, DAY_MS, describeReviewState, newReviewState } from "../learning/repetition/model.js";
import { buildCompetenceSnapshot } from "../learning/competence/snapshot.js";
import { auditoryGapPattern, listeningRecords, writtenState } from "../learning/listening/evidence.js";
import { reviewInputs } from "../learning/repetition/snapshot.js";
import { toUtcIso } from "../util/time.js";
import { createMemoryRecord } from "./model.js";

export const MEMORY_DERIVATION_FORMAT = "memory_derivation";
export const MEMORY_DERIVATION_VERSION = 1;

export const DERIVATION_RULES = Object.freeze({
  recurringError: Object.freeze({
    candidateFailures: 2, candidateDays: 2, sameDayFailures: 3, activeFailures: 3, activeDays: 2,
    resolvedSuccesses: 3, resolvedDays: 2, quietDays: 30,
  }),
  avoidance: Object.freeze({ candidateSignals: 2, activeSignals: 3, minDays: 2, resolvedProductions: 2, quietDays: 30 }),
  productionGap: Object.freeze({ quietDays: 30 }),
  confidenceSaturation: Object.freeze({
    recurring_error: 5, production_gap: 4, avoided_structure: 5, stable_strength: 5, auditory_recognition_gap: 4,
  }),
  importanceBase: Object.freeze({
    recurring_error: 0.9, production_gap: 0.75, avoided_structure: 0.6, stable_strength: 0.3, auditory_recognition_gap: 0.6,
  }),
  importanceHalfLifeDays: 30,
  statusWeight: Object.freeze({ candidate: 0.7, active: 1, weakening: 0.5, resolved: 0.1, superseded: 0 }),
});

const PRODUCTION = Object.freeze(["free", "spontaneous"]);
const LEVEL_TEXT = Object.freeze({ free: "frei", spontaneous: "spontan" });

/**
 * @param {{events: object[], userId: string, asOf: Date, library?: object|null}} input
 *   library: nur für lesbare Namen der Skills (ohne Inhalt: Skill-ID)
 * @returns {{format: string, version: number, user_id: string, as_of: string, rules: object,
 *   persisted: false, records: object[]}}
 */
export function deriveMemories({ events, userId, asOf, library = null, snapshot = null }) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError("asOf: gültiges Datum erwartet");
  if (!Array.isArray(events)) throw new TypeError("events: Liste erwartet");
  const cutoff = toUtcIso(asOf);
  const evidence = collectEvidence(events.filter((event) => event?.created_at <= cutoff), { userId });
  const reliable = evidence.records.filter((r) => r.source !== "llm" && r.reliability !== "low" && r.confidence > 0);

  const group = (records) => {
    const map = new Map();
    for (const record of records) {
      if (!isSkillId(record.skill_id)) continue;
      const list = map.get(record.skill_id) ?? [];
      list.push(record);
      map.set(record.skill_id, list);
    }
    return map;
  };
  const bySkill = group(reliable);
  const allBySkill = group(evidence.records); // einmal gruppiert statt je Skill gefiltert
  const label = (skillId) => library?.skill?.(skillId)?.label ?? skillId;
  const silentOpportunities = opportunityCounter(events, cutoff, userId, library, evidence.records);
  const context = { asOf, cutoff, label, silentOpportunities };

  const records = [];
  for (const [skillId, list] of [...bySkill.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const recurring = recurringError(skillId, list, context);
    if (recurring) records.push(recurring);
    records.push(...productionGaps(skillId, allBySkill.get(skillId) ?? [], context));
    const avoided = avoidedStructure(skillId, list, context);
    if (avoided) records.push(avoided);
  }
  records.push(...stableStrengths(evidence.records, context));
  records.push(...auditoryRecognitionGaps({ events, userId, asOf, library, snapshot }, context));
  records.sort((a, b) => (a.memory_id < b.memory_id ? -1 : 1));

  return {
    format: MEMORY_DERIVATION_FORMAT,
    version: MEMORY_DERIVATION_VERSION,
    user_id: userId,
    as_of: cutoff,
    rules: DERIVATION_RULES,
    persisted: false,
    records,
  };
}

// ---------------------------------------------------------------- recurring_error

function recurringError(skillId, records, { asOf, label, silentOpportunities }) {
  const rules = DERIVATION_RULES.recurringError;
  const signals = records.filter((r) => r.signal === "success" || r.signal === "failure");
  const failures = signals.filter((r) => r.signal === "failure");
  if (!failures.length) return null;
  const failureWeight = sum(failures);
  const failureDays = distinctDays(failures);
  const qualifies = (failureWeight >= rules.candidateFailures && failureDays >= rules.candidateDays)
    || failureWeight >= rules.sameDayFailures;
  if (!qualifies) return null; // ein einzelner Fehler (oder zwei in einer Sitzung) ist kein Muster

  const last = failures.at(-1);
  const after = signals.filter((r) => r.signal === "success" && r.at > last.at);
  const quiet = daysBetween(last.at, asOf);
  // Stufe, auf der sich der Fehler zeigte (höchstens "free"): dort muss er auch gelingen
  const errorLevel = Math.min(evidenceRank("free"), Math.max(...failures.map((r) => evidenceRank(r.evidence))));
  const provenAtLevel = after.some((r) => evidenceRank(r.evidence) >= errorLevel);
  let status;
  if (after.length >= rules.resolvedSuccesses && distinctDays(after) >= rules.resolvedDays && provenAtLevel) status = "resolved";
  else if (after.length > 0 || quiet > rules.quietDays) status = "weakening";
  else if (failureWeight >= rules.activeFailures && failureDays >= rules.activeDays) status = "active";
  else status = "candidate";

  const weakeningReason = status !== "weakening" ? null : after.length > 0 ? "counter_evidence" : "quiet";
  const silent = silentOpportunities(skillId, last.at);
  const relapses = countRelapses(signals, rules);
  const failureDayList = [...new Set(failures.map((r) => r.day))].sort();
  const span = failureDayList.length ? (Date.parse(failureDayList.at(-1)) - Date.parse(failureDayList[0])) / DAY_MS : 0;
  const persistent = status !== "resolved" && failureDayList.length >= ERROR_PATTERN_RULES.persistentMinDays
    && span >= ERROR_PATTERN_RULES.persistentMinSpanDays;
  const common = parseSkillId(skillId).type === SKILL_TYPES.COMMON_ERROR;
  const text = `${common ? "Typischer Fehler" : "Wiederkehrende Fehler"}: ${label(skillId)} `
    + `(${round(failureWeight)}× an ${failureDays} Tagen, zuletzt ${last.day}`
    + `${after.length ? `; seitdem ${after.length}× richtig` : ""})`;
  const sources = [...failures, ...after];
  return build("recurring_error", skillId, null, {
    text,
    facts: {
      failures: round(failureWeight),
      failure_days: failureDays,
      successes_since_last_failure: after.length,
      last_failure_at: last.at,
      relapses,
      persistent,
      proven_at_error_level: provenAtLevel,
      evidence_levels: countBy(failures, "evidence"),
      weakening_reason: weakeningReason,
      silent_opportunities: silent,
    },
    sources,
    createdAt: failures[0].at,
    status,
    confidence: failureWeight / DERIVATION_RULES.confidenceSaturation.recurring_error,
    asOf,
  });
}

/**
 * Gelegenheiten ohne Spur (P13): Antworten nach dem letzten Fehler, frei oder spontan, auf Aufgaben, die den
 * typischen Fehler provozieren oder seine Kompetenz verdeckt beobachten, in denen der Skill weder als Fehler noch
 * als richtig beobachtet wurde. Nur mit Inhaltspaket (sonst 0): Welche Aufgabe was provoziert, steht im Inhalt.
 */
function opportunityCounter(events, cutoff, userId, library, records) {
  if (!library?.anyExercise) return () => 0;
  const observed = new Map();
  for (const r of records) {
    if (!r.attempt_id) continue;
    const set = observed.get(r.skill_id) ?? new Set();
    set.add(r.attempt_id);
    observed.set(r.skill_id, set);
  }
  const attempts = [];
  for (const e of events) {
    if (e?.event_type !== "attempt" || e.user_id !== userId || !(e.created_at <= cutoff)) continue;
    const exercise = library.anyExercise(e.payload.exercise_id);
    if (!exercise) continue;
    const evidence = evidenceForExercise(exercise, { conversationId: e.payload.conversation_id, inputMode: e.payload.input_mode });
    if (!PRODUCTION.includes(evidence)) continue;
    attempts.push({ id: e.id, at: e.created_at, exercise });
  }
  const cache = new Map();
  return (skillId, since) => {
    const { type, refId } = parseSkillId(skillId);
    if (type !== SKILL_TYPES.COMMON_ERROR) return 0;
    const key = `${skillId}|${since}`;
    if (cache.has(key)) return cache.get(key);
    const competence = library.commonError?.(refId)?.competence ?? null;
    const provokes = (exercise) => (exercise.common_errors ?? []).includes(refId)
      || (competence && [...(exercise.structures ?? []).map((s) => `grammar_structure:${s.rule_id}`),
        ...(exercise.target_items ?? []).map((i) => `lexical_item:${i}`)].includes(competence));
    const seen = observed.get(skillId) ?? new Set();
    const seenCompetence = competence ? observed.get(competence) ?? new Set() : new Set();
    const count = attempts.filter((a) => a.at > since && provokes(a.exercise) && !seen.has(a.id) && !seenCompetence.has(a.id)).length;
    cache.set(key, count);
    return count;
  };
}

/** Wie oft kam der Fehler zurück, nachdem er schon als überwunden galt? */
function countRelapses(signals, rules) {
  let relapses = 0;
  let seenFailure = false; // Erfolge vor dem allerersten Fehler sind kein "überwunden"
  let streak = [];
  for (const r of signals) {
    if (r.signal === "success") {
      streak.push(r);
      continue;
    }
    if (seenFailure && streak.length >= rules.resolvedSuccesses && distinctDays(streak) >= rules.resolvedDays) relapses += 1;
    seenFailure = true;
    streak = [];
  }
  return relapses;
}

// ---------------------------------------------------------------- production_gap

function productionGaps(skillId, allRecords, { asOf, label }) {
  if (parseSkillId(skillId).type === SKILL_TYPES.COMMON_ERROR) return [];
  const byDay = new Map();
  for (const r of allRecords) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  // Tag für Tag fortlaufend zählen (linear, nicht je Tag alles neu), welche Lücke bestand
  const type = parseSkillId(skillId).type;
  const buckets = emptyEvidenceBuckets();
  const timeline = [];
  let lastAt = null;
  for (const day of [...byDay.keys()].sort()) {
    for (const r of byDay.get(day)) {
      addEvidence(buckets, r);
      if (lastAt === null || r.at > lastAt) lastAt = r.at;
    }
    timeline.push({ day, at: lastAt, step: weakStep({ type, evidence: roundedEvidence(buckets) }) });
  }
  const episodes = [];
  for (const [i, point] of timeline.entries()) {
    const target = point.step?.target ?? null;
    const open = episodes.at(-1);
    if (open && open.end === null && open.target !== target) open.end = i;
    if (target && !(open && open.end === null && open.target === target)) episodes.push({ target, start: i, end: null });
  }
  if (!episodes.length) return [];

  const rules = DERIVATION_RULES.productionGap;
  const latest = new Map(); // je Ziel nur die letzte Episode (eine Erinnerung je Ziel)
  for (const episode of episodes) latest.set(episode.target, { ...episode, count: (latest.get(episode.target)?.count ?? 0) + 1 });

  return [...latest.values()].map((episode) => {
    const startPoint = timeline[episode.start];
    const endIndex = episode.end ?? timeline.length - 1;
    const endPoint = timeline[endIndex];
    const successor = episode.end === null ? null : timeline[episode.end].step?.target ?? null;
    const step = timeline[episode.end === null ? endIndex : episode.end - 1].step;
    const relevant = allRecords.filter((r) => r.day <= endPoint.day && (r.signal === "success" || r.signal === "failure")
      && r.source !== "llm" && r.reliability !== "low" && r.confidence > 0);
    let status;
    let supersededBy = null;
    if (episode.end === null) {
      status = daysBetween(endPoint.at, asOf) > rules.quietDays ? "weakening" : "active";
    } else if (successor) {
      status = "superseded";
      supersededBy = gapId(skillId, successor);
    } else {
      status = "resolved";
    }
    const weak = step.weak;
    const attempts = weak.successes + weak.failures;
    const text = `${label(skillId)}: ${step.strongLabel} sicher, ${step.weakLabel} schwach `
      + `(${round(weak.successes)} von ${round(attempts)} richtig)`
      + (status === "resolved" ? "; inzwischen geschlossen" : "");
    return build("production_gap", skillId, episode.target, {
      text,
      facts: {
        target_evidence: episode.target,
        weak_level: LEVEL_TEXT[episode.target],
        weak_successes: round(weak.successes),
        weak_attempts: round(attempts),
        since_day: startPoint.day,
        episodes: episode.count,
      },
      sources: relevant,
      createdAt: startPoint.at,
      updatedAt: endPoint.at,
      status,
      supersededBy,
      confidence: attempts / DERIVATION_RULES.confidenceSaturation.production_gap,
      asOf,
    });
  });
}

function gapId(skillId, target) {
  return `production_gap:${skillId}:${target}`;
}

// ---------------------------------------------------------------- avoided_structure

function avoidedStructure(skillId, records, { asOf, label }) {
  if (parseSkillId(skillId).type === SKILL_TYPES.COMMON_ERROR) return null; // Vermeiden eines Fehlers ist gut
  const rules = DERIVATION_RULES.avoidance;
  const signals = records.filter((r) => r.signal === "missed" || r.signal === "simpler");
  if (signals.length < rules.candidateSignals || distinctDays(signals) < rules.minDays) return null;
  const last = signals.at(-1);
  const produced = records.filter((r) => r.signal === "success" && PRODUCTION.includes(r.evidence) && r.at > last.at);
  let status;
  if (produced.length >= rules.resolvedProductions) status = "resolved";
  else if (produced.length > 0 || daysBetween(last.at, asOf) > rules.quietDays) status = "weakening";
  else if (signals.length >= rules.activeSignals) status = "active";
  else status = "candidate";
  const missed = signals.filter((r) => r.signal === "missed").length;
  const simpler = signals.length - missed;
  return build("avoided_structure", skillId, null, {
    text: `${label(skillId)} wird oft umgangen (${missed}× nicht verwendet, obwohl verlangt; `
      + `${simpler}× richtig, aber einfacher als möglich)`,
    facts: { missed_opportunities: missed, simpler_answers: simpler, days: distinctDays(signals), produced_since: produced.length },
    sources: [...signals, ...produced],
    createdAt: signals[0].at,
    status,
    confidence: signals.length / DERIVATION_RULES.confidenceSaturation.avoided_structure,
    asOf,
  });
}

// ---------------------------------------------------------------- stable_strength

function stableStrengths(allRecords, { asOf, label }) {
  const bySkill = new Map();
  for (const input of reviewInputs(allRecords)) {
    const entry = bySkill.get(input.skill_id) ?? { state: newReviewState(input.skill_id), masteredAt: null, sources: [] };
    entry.state = calculateReviewState(entry.state, input, input.at);
    entry.sources.push(input);
    if (!entry.masteredAt && describeReviewState(entry.state, input.at).phase === "mastered") entry.masteredAt = input.at;
    bySkill.set(input.skill_id, entry);
  }
  const out = [];
  for (const [skillId, entry] of [...bySkill.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!entry.masteredAt) continue;
    const now = describeReviewState(entry.state, asOf);
    const status = now.phase === "mastered" && ["not_due", "soon"].includes(now.due_status) ? "active" : "weakening";
    const sources = entry.sources.filter((s) => s.at >= entry.masteredAt || s.outcome === "success");
    out.push(build("stable_strength", skillId, null, {
      text: `${label(skillId)} sitzt sicher (stabil über ${Math.round(now.stability)} Tage`
        + `${status === "weakening" ? "; sollte wieder geprüft werden" : ""})`,
      facts: {
        phase: now.phase,
        due_status: now.due_status,
        stability_days: now.stability,
        retrievability: now.retrievability,
        consecutive_successes: now.consecutive_successes,
        lapses: now.lapses,
      },
      sources,
      createdAt: entry.masteredAt,
      status,
      confidence: now.consecutive_successes / DERIVATION_RULES.confidenceSaturation.stable_strength,
      asOf,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- auditory_recognition_gap (P16)

/**
 * Hörerkennungs-Lücke: dieselben Hörantworten und dieselbe Regel wie das Hörprofil (listening/evidence.js), dieselbe
 * Bedingung "schriftlich sicher" (writtenState aus dem Kompetenzstand). snapshot: vom Learning Brain mitgegeben,
 * sonst nur für die Skills mit Hörantworten berechnet.
 */
function auditoryRecognitionGaps({ events, userId, asOf, library, snapshot }, { label }) {
  if (!library?.anyExercise) return [];
  const { records } = listeningRecords({ events, library, userId, asOf });
  if (!records.length) return [];
  const bySkill = new Map();
  for (const record of records) {
    for (const skillId of record.skills) {
      if (!isSkillId(skillId)) continue;
      const list = bySkill.get(skillId) ?? [];
      list.push(record);
      bySkill.set(skillId, list);
    }
  }
  const skillIds = [...bySkill.keys()].sort();
  const written = snapshot ?? buildCompetenceSnapshot({ events, userId, asOf, skillIds });
  const writtenOf = new Map(written.skills.map((s) => [s.skill_id, s]));
  const out = [];
  for (const skillId of skillIds) {
    if (writtenState(writtenOf.get(skillId) ?? null).state !== "secure") continue; // sonst: noch nicht gelernt
    const pattern = auditoryGapPattern(bySkill.get(skillId), asOf);
    if (!pattern) continue;
    const { facts, failures, after, status } = pattern;
    out.push(build("auditory_recognition_gap", skillId, null, {
      text: `Beim Hören noch nicht sicher erkannt: ${label(skillId)} (schriftlich sicher; ${facts.failures}× nicht verstanden `
        + `in ${facts.failure_contexts} Hörtexten${after.length ? `, seitdem ${after.length}× verstanden` : ""})`,
      facts,
      sources: [...failures, ...after],
      createdAt: failures[0].at,
      status,
      confidence: failures.length / DERIVATION_RULES.confidenceSaturation.auditory_recognition_gap,
      asOf,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- Hilfen

function build(type, skillId, detail, { text, facts, sources, createdAt, updatedAt, status, supersededBy = null, confidence, asOf }) {
  const lastAt = updatedAt ?? sources.reduce((max, s) => (s.at > max ? s.at : max), createdAt);
  const recency = 0.5 ** (daysBetween(lastAt, asOf) / DERIVATION_RULES.importanceHalfLifeDays);
  const importance = DERIVATION_RULES.importanceBase[type] * recency * DERIVATION_RULES.statusWeight[status];
  return createMemoryRecord({
    memoryId: detail ? `${type}:${skillId}:${detail}` : `${type}:${skillId}`,
    memoryType: type,
    skillId,
    text,
    facts,
    metadata: {
      origin: "derived",
      rule_version: MEMORY_DERIVATION_VERSION,
      evidence_count: sources.length,
      days: distinctDays(sources),
      first_evidence_at: createdAt,
      last_evidence_at: lastAt,
    },
    sourceEventIds: sources.map((s) => s.event_id),
    createdAt,
    updatedAt: lastAt,
    confidence: round(Math.min(1, confidence)),
    importance: round(importance),
    status,
    supersededBy,
  });
}

function sum(records) {
  return records.reduce((total, r) => total + r.confidence, 0);
}

function distinctDays(records) {
  return new Set(records.map((r) => r.day)).size;
}

function countBy(records, key) {
  const counts = {};
  for (const r of records) counts[r[key]] = (counts[r[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function daysBetween(iso, asOf) {
  return Math.max(0, (asOf.getTime() - Date.parse(iso)) / DAY_MS);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
