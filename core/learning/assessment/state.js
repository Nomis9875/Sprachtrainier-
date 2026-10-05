/**
 * Einstufung (P11B): AssessmentState v1, vollständig aus Ereignissen rekonstruiert, und die adaptive
 * Auswahl der nächsten Aufgabe. Rein und deterministisch.
 *
 *   (keine)          not_started
 *   assessment_started ─▶ in_progress ─paused─▶ paused ─resumed─▶ in_progress
 *                             ├─completed─▶ completed        └─abandoned─▶ abandoned
 *
 * Module = Kompetenzbereiche in fester Reihenfolge (grammar, vocabulary, reading, listening, production,
 * conversation). Ein Modul ohne Aufgaben im Inhaltspaket ist "unavailable" (Inhaltslücke, ehrlich
 * gekennzeichnet). Jede Antwort ist ein gewöhnlicher Versuch (attempt) plus assessment_response;
 * "weiß ich nicht" ist assessment_item_skipped (zählt als falsch, ohne Rateanteil).
 *
 * Adaptiv: Die nächste Aufgabe eines Moduls ist die noch nicht gestellte, deren Schwierigkeit der aktuellen
 * Schätzung am nächsten liegt (Gleichstand: niedrigere Stufe, dann ID). Startpunkt ist die Schätzung aus den
 * bisherigen Modulen, im ersten Modul die Selbsteinschätzung (nur als Startpunkt, nicht als Ergebnis).
 * Ein Modul endet nach MAX Aufgaben, wenn keine mehr da sind oder ab MIN Aufgaben bei Streuung < SD_STOP.
 */

import { DIMENSIONS } from "../profile/evidence.js";
import { createPosterior, summarize, update } from "../profile/measurement.js";
import { confidenceLabel, levelLabel, levelValue } from "../profile/scale.js";
import { eventLanguage } from "../../util/language.js";

export const ASSESSMENT_STATE_VERSION = 1;
export const ASSESSMENT_STATUSES = Object.freeze(["not_started", "in_progress", "paused", "completed", "abandoned"]);
export const MODULE_RULES = Object.freeze({
  grammar: { min: 3, max: 6 },
  vocabulary: { min: 3, max: 5 },
  reading: { min: 2, max: 4 },
  listening: { min: 2, max: 4 },
  production: { min: 1, max: 1 },
  conversation: { min: 1, max: 1 },
});
export const SD_STOP = 0.5;
const LEVEL_OFFSET = 0.3;
const START_THETA = 3.5;
const FINAL = new Set(["completed", "abandoned"]);

/** Ergebnis einer Aufgabe für die Schätzung innerhalb der Einstufung. */
function measurementOf(item, score) {
  const closed = item.format === "choice";
  return { difficulty: levelValue(item.level) + LEVEL_OFFSET, score, weight: 1, guessing: closed && score !== null ? 1 / Math.max(2, item.options.length) : 0 };
}

/**
 * @param {object[]} events  Ereignisse EINES Lerners in EINER Sprache
 * @param {string} assessmentId
 * @param {object} library   Inhaltspaket dieser Sprache
 */
export function replayAssessment(events, assessmentId, library) {
  const own = dedupe(events).filter((e) => e.payload?.assessment_id === assessmentId).sort(compareEvents);
  const started = own.find((e) => e.event_type === "assessment_started");
  if (!started) return null;
  const p = started.payload;
  let status = "in_progress";
  let completedAt = null;
  let endReason = null;
  const answers = [];
  const skippedModules = new Map();
  const anomalies = [];
  for (const event of own) {
    if (event === started) continue;
    if (event.user_id !== started.user_id || eventLanguage(event) !== eventLanguage(started)) {
      anomalies.push({ event_id: event.id, problem: "Ereignis eines anderen Lerners oder einer anderen Sprache" });
      continue;
    }
    if (FINAL.has(status)) {
      anomalies.push({ event_id: event.id, problem: `${event.event_type} nach dem Ende` });
      continue;
    }
    const q = event.payload;
    switch (event.event_type) {
      case "assessment_response":
      case "assessment_item_skipped":
        if (status !== "in_progress") { anomalies.push({ event_id: event.id, problem: `Antwort im Zustand ${status}` }); break; }
        answers.push({ dimension: q.dimension, item_id: q.item_id, attempt_id: q.attempt_id ?? null,
          score: event.event_type === "assessment_response" ? q.score : 0, skipped: event.event_type === "assessment_item_skipped", at: event.created_at });
        break;
      case "assessment_module_skipped":
        skippedModules.set(q.dimension, q.reason);
        break;
      case "assessment_paused":
        if (status === "in_progress") status = "paused";
        break;
      case "assessment_resumed":
        if (status === "paused") status = "in_progress";
        break;
      case "assessment_completed":
        status = "completed";
        completedAt = event.created_at;
        endReason = q.reason;
        break;
      case "assessment_abandoned":
        status = "abandoned";
        completedAt = event.created_at;
        endReason = q.reason;
        break;
      default:
        break;
    }
  }

  const modules = [];
  let prior = p.self_assessment ? levelValue(p.self_assessment) + 0.5 : START_THETA;
  let current = null;
  for (const dimension of DIMENSIONS) {
    const items = library.assessmentItems({ dimension });
    const own = answers.filter((a) => a.dimension === dimension);
    const estimate = estimateOf(own, library, prior);
    const rules = MODULE_RULES[dimension];
    let moduleStatus;
    if (!p.modules.includes(dimension) || !items.length) moduleStatus = "unavailable";
    else if (skippedModules.has(dimension)) moduleStatus = "skipped";
    else if (own.length >= rules.max || own.length >= items.length || (own.length >= rules.min && estimate.sd < SD_STOP)) moduleStatus = "done";
    else moduleStatus = own.length ? "in_progress" : "pending";
    const entry = {
      dimension, status: moduleStatus, answered: own.length, correct: own.filter((a) => a.score >= 0.5).length,
      available_items: items.length, skip_reason: skippedModules.get(dimension) ?? null,
      estimate: own.length ? summaryOf(estimate) : null, start_theta: round(prior),
    };
    modules.push(entry);
    if (!current && (moduleStatus === "pending" || moduleStatus === "in_progress")) current = entry;
    if (own.length) prior = estimate.theta; // nächstes Modul startet bei der bisherigen Schätzung
  }

  const measured = modules.filter((m) => m.estimate);
  const thetas = measured.map((m) => m.estimate.theta).sort((a, b) => a - b);
  const theta = thetas.length ? median(thetas) : null;
  const band = measured.length ? measured.reduce((s, m) => s + m.estimate.band_probability, 0) / measured.length : 0;
  return {
    version: ASSESSMENT_STATE_VERSION,
    assessment_id: assessmentId,
    learner_id: started.user_id,
    language_id: eventLanguage(started),
    kind: p.kind,
    status,
    self_assessment: p.self_assessment ?? null,
    started_at: started.created_at,
    completed_at: completedAt,
    end_reason: endReason,
    modules,
    current_module: FINAL.has(status) ? null : current?.dimension ?? null,
    answered: answers,
    results: Object.fromEntries(measured.map((m) => [m.dimension, m.estimate])),
    estimated_level: theta === null ? null : levelLabel(theta),
    confidence: theta === null ? "none" : measured.length < 2 ? "low" : confidenceLabel(band),
    anomalies,
  };
}

/** Nächste Aufgabe (adaptiv) oder null, wenn das Modul bzw. die Einstufung fertig ist. */
export function nextItem(state, library) {
  if (!state || state.status !== "in_progress" || !state.current_module) return null;
  const module = state.modules.find((m) => m.dimension === state.current_module);
  const asked = new Set(state.answered.map((a) => a.item_id));
  const target = module.estimate?.theta ?? module.start_theta;
  const candidates = library.assessmentItems({ dimension: module.dimension }).filter((item) => !asked.has(item.id));
  candidates.sort((a, b) => {
    const da = Math.abs(levelValue(a.level) + LEVEL_OFFSET - target);
    const db = Math.abs(levelValue(b.level) + LEVEL_OFFSET - target);
    return da - db || levelValue(a.level) - levelValue(b.level) || (a.id < b.id ? -1 : 1);
  });
  return candidates[0] ?? null;
}

/** Sind alle Module fertig, übersprungen oder ohne Inhalt? */
export function allModulesDone(state) {
  return state.modules.every((m) => ["done", "skipped", "unavailable"].includes(m.status));
}

/** Alle Einstufungen eines Lerners in einer Sprache, älteste zuerst. */
export function listAssessments(events, library) {
  return dedupe(events).filter((e) => e.event_type === "assessment_started").sort(compareEvents)
    .map((e) => replayAssessment(events, e.payload.assessment_id, library));
}

function estimateOf(answers, library, prior) {
  let posterior = createPosterior({ mean: prior, sd: 1.5 });
  for (const answer of answers) {
    const item = library.assessmentItem(answer.item_id);
    if (!item) continue;
    posterior = update(posterior, measurementOf(item, answer.skipped ? 0 : answer.score));
  }
  return summarize(posterior);
}

function summaryOf(s) {
  return { theta: s.theta, sd: s.sd, level_label: levelLabel(s.theta), band_probability: s.band_probability,
    confidence: confidenceLabel(s.band_probability) };
}

function median(values) {
  const mid = values.length / 2;
  return values.length % 2 ? values[Math.floor(mid)] : (values[mid - 1] + values[mid]) / 2;
}

function dedupe(events) {
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

function compareEvents(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
