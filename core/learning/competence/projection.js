/**
 * Skill-Projektion: Ereignisse → Nachweise → Skill-Zustand.
 *
 * Es gibt keinen gespeicherten Skill-Wert. Der Zustand wird bei jedem Aufruf
 * vollständig aus den Ereignissen berechnet (Event Replay). Dieselben Ereignisse
 * ergeben immer denselben Zustand, egal in welcher Reihenfolge oder von welchem
 * Gerät sie kommen.
 *
 * Schritt 1 – collectEvidence(): aus jedem relevanten Ereignis ein Nachweis
 *   skill_observation   Version 2 (mit Art und Verlässlichkeit):
 *                         demonstrated → success, error → failure,
 *                         not_demonstrated → missed (nur Art missed_opportunity: die Aufgabe
 *                           verlangte den Skill) bzw. unused (verdecktes Lernziel nicht gezeigt:
 *                           keine Aussage), not_observable → unknown,
 *                         correct_but_simple → simpler (Hinweis, nie ein Fehler)
 *                       Version 1 (ältere Ereignisse, Art "unclassified"): correct → success,
 *                         error → failure, not_used → missed, unknown → unknown (wie bisher)
 *   error_event         common_error:<id> → failure für diesen Skill;
 *                       llm:<…> → kein Skill, wird als "untracked error" gezählt
 *   review_event        Karteikarte: again → failure, sonst success; Stufe "recognized",
 *                       Quelle "self" (Selbsteinschätzung)
 *   Pro Versuch und Skill zählt höchstens EIN Nachweis: Regel/Referenz vor Qwen,
 *   innerhalb derselben Verlässlichkeit Fehler vor Erfolg.
 *   Mehrere Geräte: Ereignisse werden über ihre ID zusammengeführt (Duplikate aus der
 *   Synchronisation zählen einmal) und nach created_at, bei Gleichstand nach ID sortiert.
 *
 *   Kein KI-Einfluss: Qwen-Nachweise (Quelle "llm") werden nur als ai_signals
 *   mitgezählt. Alles, was die Einstufung bestimmt, stammt aus Regeln, Referenzen
 *   und Karteikarten (Selbsteinschätzung, Verlässlichkeit 0.5).
 *
 *   Keine starken Aussagen aus unsicheren Signalen: Verlässlichkeit "high" zählt voll,
 *   "medium" halb, "low" gar nicht (nur als low_reliability_signals mitgezählt).
 *
 *   Transfer entsteht aus Beobachtungen, nicht aus dem Inhalt: ein beiläufiger Erfolg
 *   (incidental) frei oder spontan in einer Übung, nachdem der Skill VORHER in einer anderen
 *   Übung als Lernziel geübt wurde (target/missed_opportunity). Ältere Beobachtungen ohne Art
 *   ("unclassified") ergeben nie Transfer.
 *
 * Schritt 2 – projectSkill(): Zähler, Gewichte, Zeitpunkte und Verlauf je Skill.
 * Die Einstufung (Beherrschung, Tiefe, Fehlertrend) übernimmt mastery.js,
 * das Gesamtbild (CompetenceSnapshot) snapshot.js.
 */

import { parseSkillId } from "../../content/skills.js";
import { EVIDENCE_LEVELS, EVIDENCE_WEIGHT, SOURCE_CONFIDENCE, evidenceRank } from "./evidence.js";

const SIGNAL_OF_V1_OUTCOME = Object.freeze({ correct: "success", error: "failure", not_used: "missed", unknown: "unknown" });
const SIGNAL_OF_V2_OUTCOME = Object.freeze({
  demonstrated: "success", error: "failure", not_observable: "unknown", correct_but_simple: "simpler",
});
const SIGNAL_PRIORITY = Object.freeze({ failure: 5, success: 4, simpler: 3, missed: 2, unused: 1, unknown: 0 });
/** Gewicht je Verlässlichkeit der Beobachtung: "low" zählt nicht. */
export const RELIABILITY_WEIGHT = Object.freeze({ high: 1, medium: 0.5, low: 0 });
const TRAINING_KINDS = Object.freeze(["target", "missed_opportunity"]);
const TRANSFER_EVIDENCE = Object.freeze(["free", "spontaneous"]);
const RECENT_LIMIT = 10;

/**
 * @typedef {object} EvidenceRecord
 * @property {string} skill_id
 * @property {"success"|"failure"|"missed"|"unused"|"simpler"|"unknown"} signal
 * @property {string} kind          Art der Beobachtung (target, incidental, …; "unclassified" für ältere)
 * @property {string} reliability   high | medium | low
 * @property {string} evidence      Nachweisstufe
 * @property {string} source        reference | rule | llm | self
 * @property {number} confidence    0..1
 * @property {string} at            UTC-Zeitstempel des Ereignisses
 * @property {string} day           Kalendertag auf dem Gerät
 * @property {string} event_id
 * @property {string|null} attempt_id
 * @property {string|null} exercise_id   Übung des Versuchs (null bei Karteikarten)
 * @property {string} [grade]           nur Karteikarten: again | hard | good | easy
 */

/**
 * @param {object[]} events   beliebige Reihenfolge, Duplikate erlaubt
 * @param {{userId?: string}} [options]  nur Ereignisse dieses Nutzers
 * @returns {{records: EvidenceRecord[], untrackedErrors: object[], eventCount: number,
 *   firstEventAt: string|null, lastEventAt: string|null, deviceCount: number}}
 */
export function collectEvidence(events, { userId } = {}) {
  const unique = new Map();
  for (const event of events) {
    if (userId === undefined || event.user_id === userId) unique.set(event.id, event);
  }
  const ordered = [...unique.values()].sort(compareEvents);

  // Übung je Versuch: Grundlage für den Übungskontext eines Nachweises (Transfer-Erkennung)
  const exerciseOfAttempt = new Map(
    ordered.filter((e) => e.event_type === "attempt").map((e) => [e.id, e.payload.exercise_id]),
  );

  const groups = new Map(); // "attempt|skill" → Kandidaten
  const untracked = new Map();
  for (const event of ordered) {
    for (const candidate of candidatesFrom(event, untracked)) {
      candidate.exercise_id = exerciseOfAttempt.get(candidate.attempt_id) ?? null;
      const list = groups.get(candidate.key) ?? [];
      list.push(candidate);
      groups.set(candidate.key, list);
    }
  }

  const records = [...groups.values()].map(merge).sort(compareRecords);
  const untrackedErrors = [...untracked.values()].sort((a, b) => (a.error_key < b.error_key ? -1 : 1));
  return {
    records,
    untrackedErrors,
    eventCount: ordered.length,
    firstEventAt: ordered[0]?.created_at ?? null,
    lastEventAt: ordered.at(-1)?.created_at ?? null,
    deviceCount: new Set(ordered.map((event) => event.device_id)).size,
  };
}

/** Erfolge und Fehler je Nachweisstufe (gewichtet mit der Verlässlichkeit), leer. */
export function emptyEvidenceBuckets() {
  return Object.fromEntries(EVIDENCE_LEVELS.map((level) => [level, { successes: 0, failures: 0 }]));
}

/**
 * Einen Nachweis in die Stufen-Zählung aufnehmen, wenn er zählt (verlässlich, Erfolg oder Fehler).
 * Dieselbe Regel für projectSkill und fortlaufende Berechnungen (Erinnerungen), damit beide gleich zählen.
 */
export function addEvidence(buckets, record) {
  if (!counts(record) || (record.signal !== "success" && record.signal !== "failure")) return false;
  buckets[record.evidence][record.signal === "success" ? "successes" : "failures"] += record.confidence;
  return true;
}

function lastEvidenceAt(signals) {
  const last = Object.fromEntries(EVIDENCE_LEVELS.map((level) => [level, null]));
  for (const r of signals) {
    if ((r.signal === "success" || r.signal === "failure") && r.evidence in last) last[r.evidence] = r.at;
  }
  return last;
}

export function roundedEvidence(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([level, v]) => [level, { successes: round(v.successes), failures: round(v.failures) }]));
}

/**
 * @param {string} skillId
 * @param {EvidenceRecord[]} records  nur Nachweise dieses Skills, chronologisch
 */
export function projectSkill(skillId, records) {
  const { type, refId } = parseSkillId(skillId);
  // Qwen-Nachweise werden nur mitgezählt (ai_signals), unsichere Regeltreffer ("low") als
  // low_reliability_signals; beide bestimmen nichts. Stufe, Pfad und Fehlertrend beruhen allein
  // auf verlässlichen Regeln, Referenzen und Karteikarten.
  const reliable = records.filter(counts);
  const byEvidence = emptyEvidenceBuckets();
  const signals = reliable.filter((r) => r.signal === "success" || r.signal === "failure");
  let successes = 0;
  let failures = 0;
  for (const r of signals) {
    addEvidence(byEvidence, r);
    if (r.signal === "success") successes += r.confidence;
    else failures += r.confidence;
  }
  const successRecords = signals.filter((r) => r.signal === "success");
  const failureRecords = signals.filter((r) => r.signal === "failure");
  const lastFailureAt = failureRecords.at(-1)?.at ?? null;
  const successesSinceFailure = lastFailureAt ? successRecords.filter((r) => r.at > lastFailureAt) : successRecords;
  const highest = successRecords.reduce(
    (best, r) => (best === null || evidenceRank(r.evidence) > evidenceRank(best) ? r.evidence : best),
    null,
  );
  const aiSignals = records.filter((r) => r.source === "llm");
  const lowSignals = records.filter((r) => r.source !== "llm" && r.reliability === "low");
  const upgrades = reliable.filter((r) => r.signal === "simpler");

  return {
    skill_id: skillId,
    type,
    ref_id: refId,
    successes: round(successes),
    failures: round(failures),
    missed_opportunities: reliable.filter((r) => r.signal === "missed").length,
    unused_targets: reliable.filter((r) => r.signal === "unused").length,
    upgrade_opportunities: { count: upgrades.length, days: new Set(upgrades.map((r) => r.day)).size },
    unknown_observations: records.filter((r) => r.source !== "llm" && r.signal === "unknown").length,
    observation_kinds: kindCounts(signals),
    evidence: Object.fromEntries(
      Object.entries(roundedEvidence(byEvidence)),
    ),
    // P13: letzte zählende Antwort je Nachweisstufe (Produktionsprofil, "lange nicht frei produziert")
    last_evidence_at: lastEvidenceAt(signals),
    evidence_score: round(successRecords.reduce((sum, r) => sum + EVIDENCE_WEIGHT[r.evidence] * r.confidence, 0)),
    highest_success_evidence: highest,
    success_days: new Set(successRecords.map((r) => r.day)).size,
    since_last_failure: {
      successes: successesSinceFailure.length,
      success_days: new Set(successesSinceFailure.map((r) => r.day)).size,
    },
    first_seen_at: records[0]?.at ?? null,
    first_success_at: successRecords[0]?.at ?? null,
    last_seen_at: records.at(-1)?.at ?? null,
    last_success_at: successRecords.at(-1)?.at ?? null,
    last_failure_at: lastFailureAt,
    history_by_day: historyByDay(signals),
    exercise_contexts: exerciseContexts(signals),
    trained_in: [...new Set(signals.filter((r) => TRAINING_KINDS.includes(r.kind) && r.exercise_id).map((r) => r.exercise_id))].sort(),
    transfer: transferContexts(reliable),
    ai_signals: {
      successes: aiSignals.filter((r) => r.signal === "success").length,
      failures: aiSignals.filter((r) => r.signal === "failure").length,
    },
    low_reliability_signals: {
      successes: lowSignals.filter((r) => r.signal === "success").length,
      failures: lowSignals.filter((r) => r.signal === "failure").length,
    },
    recent: signals.slice(-RECENT_LIMIT).map((r) => ({
      at: r.at,
      outcome: r.signal,
      evidence: r.evidence,
      source: r.source,
      confidence: r.confidence,
    })),
  };
}

/**
 * In welchen Übungen wurde der Skill verwendet? Je Übung Erfolge, Fehler und die höchste
 * Nachweisstufe eines Erfolgs. Datengrundlage für die Transfer-Erkennung (Coaching).
 */
function exerciseContexts(signals) {
  const contexts = new Map();
  for (const r of signals) {
    if (!r.exercise_id) continue;
    const entry = contexts.get(r.exercise_id)
      ?? { exercise_id: r.exercise_id, successes: 0, failures: 0, highest_success_evidence: null };
    if (r.signal === "success") {
      entry.successes += 1;
      if (entry.highest_success_evidence === null || evidenceRank(r.evidence) > evidenceRank(entry.highest_success_evidence)) {
        entry.highest_success_evidence = r.evidence;
      }
    } else {
      entry.failures += 1;
    }
    contexts.set(r.exercise_id, entry);
  }
  return [...contexts.values()].sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1));
}

/** Erfolge und Fehler je Art der Beobachtung (nur verlässliche Nachweise). */
function kindCounts(signals) {
  const counts = {};
  for (const r of signals) {
    counts[r.kind] ??= { successes: 0, failures: 0 };
    counts[r.kind][r.signal === "success" ? "successes" : "failures"] += 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Transfer aus Beobachtungen: beiläufiger Erfolg (incidental) auf Stufe free/spontaneous in einer
 * Übung, nachdem der Skill vorher in einer ANDEREN Übung als Lernziel geübt wurde. Der Trainings-
 * kontext stammt aus den Ereignissen, nicht aus dem aktuellen Inhalt: Ändert sich eine Übung
 * später, ändert sich nicht rückwirkend, was Transfer war.
 */
function transferContexts(records) {
  const trainedBefore = new Set();
  const contexts = new Map();
  for (const r of records) { // chronologisch
    if (TRAINING_KINDS.includes(r.kind) && (r.signal === "success" || r.signal === "failure" || r.signal === "missed")) {
      if (r.exercise_id) trainedBefore.add(r.exercise_id);
      continue;
    }
    if (r.kind !== "incidental" || r.signal !== "success" || !TRANSFER_EVIDENCE.includes(r.evidence) || !r.exercise_id) continue;
    if (![...trainedBefore].some((id) => id !== r.exercise_id)) continue;
    const entry = contexts.get(r.exercise_id)
      ?? { exercise_id: r.exercise_id, successes: 0, highest_success_evidence: null, first_at: r.at };
    entry.successes += 1;
    if (entry.highest_success_evidence === null || evidenceRank(r.evidence) > evidenceRank(entry.highest_success_evidence)) {
      entry.highest_success_evidence = r.evidence;
    }
    contexts.set(r.exercise_id, entry);
  }
  return [...contexts.values()].sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1));
}

/** Erfolge und Fehler je Kalendertag (Anzahl Nachweise): Datengrundlage für Trends. */
function historyByDay(signals) {
  const days = new Map();
  for (const r of signals) {
    const entry = days.get(r.day) ?? { day: r.day, successes: 0, failures: 0 };
    entry[r.signal === "success" ? "successes" : "failures"] += 1;
    days.set(r.day, entry);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

// ---------------------------------------------------------------- Ereignis → Kandidaten

function candidatesFrom(event, untracked) {
  const p = event.payload ?? {};
  const base = { at: event.created_at, day: event.local_date, event_id: event.id };
  switch (event.event_type) {
    case "skill_observation": {
      const legacy = event.schema_version === 1;
      const kind = legacy ? "unclassified" : p.observation_kind;
      const reliability = legacy ? "high" : p.reliability;
      return [{
        ...base,
        key: `${p.attempt_id}|${p.skill_id}`,
        skill_id: p.skill_id,
        signal: legacy ? SIGNAL_OF_V1_OUTCOME[p.outcome] ?? "unknown" : signalOfV2(p),
        kind,
        reliability,
        evidence: p.evidence,
        source: p.source,
        confidence: (SOURCE_CONFIDENCE[p.source] ?? 0) * RELIABILITY_WEIGHT[reliability],
        attempt_id: p.attempt_id,
      }];
    }
    case "error_event":
      if (p.error_key?.startsWith("common_error:")) {
        return [{
          ...base,
          key: `${p.attempt_id}|${p.error_key}`,
          skill_id: p.error_key,
          signal: "failure",
          kind: "error_event",
          reliability: "high",
          evidence: p.evidence,
          source: p.source,
          confidence: SOURCE_CONFIDENCE[p.source] ?? 0,
          attempt_id: p.attempt_id,
        }];
      }
      trackUntracked(untracked, p, event);
      return [];
    case "review_event":
      return [{
        ...base,
        key: `${event.id}|${p.skill_id}`,
        skill_id: p.skill_id,
        signal: p.grade === "again" ? "failure" : "success",
        grade: p.grade,
        kind: "review",
        reliability: "high",
        evidence: "recognized",
        source: "self",
        confidence: SOURCE_CONFIDENCE.self,
        attempt_id: p.attempt_id ?? null,
      }];
    default:
      return []; // attempt und künftige Typen tragen keine Skill-Nachweise
  }
}

function signalOfV2(p) {
  if (p.outcome !== "not_demonstrated") return SIGNAL_OF_V2_OUTCOME[p.outcome] ?? "unknown";
  if (p.observation_kind === "missed_opportunity" || p.observation_kind === "unclassified") return "missed";
  return "unused"; // verdecktes Lernziel nicht gezeigt: weder Fehler noch verpasste Gelegenheit
}

/** Zählt der Nachweis für die Einstufung? Nicht bei Qwen und nicht bei unsicheren Regeltreffern. */
function counts(record) {
  return record.source !== "llm" && record.reliability !== "low";
}

/**
 * Ein Nachweis je Versuch und Skill: zuerst zählende vor nicht zählenden (Regel vor Qwen,
 * verlässlich vor unsicher), dann die höhere Verlässlichkeit, dann das stärkste Signal.
 */
function merge(candidates) {
  const best = candidates.reduce((a, b) => {
    if (counts(b) !== counts(a)) return counts(b) ? b : a;
    if (b.confidence !== a.confidence) return b.confidence > a.confidence ? b : a;
    return SIGNAL_PRIORITY[b.signal] > SIGNAL_PRIORITY[a.signal] ? b : a;
  });
  const { key, ...record } = best;
  return record;
}

function trackUntracked(untracked, payload, event) {
  const entry = untracked.get(payload.error_key) ?? { error_key: payload.error_key, occurrences: 0, last_at: null };
  entry.occurrences += 1;
  entry.last_at = event.created_at;
  untracked.set(payload.error_key, entry);
}

function compareEvents(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareRecords(a, b) {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.event_id !== b.event_id) return a.event_id < b.event_id ? -1 : 1;
  return a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0;
}

export function round(value) {
  return Math.round(value * 100) / 100;
}
