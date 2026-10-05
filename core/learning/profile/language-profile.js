/**
 * LanguageProfile v1 (P11B): Sprachprofil EINES Lerners in EINER Sprache. Eine Projektion, nie gespeichert.
 *
 *   Ereignisse (Lerner × Sprache) ─▶ Messungen (evidence.js) ─▶ je Bereich eine θ-Verteilung (measurement.js)
 *                                 ─▶ LanguageProfile: Stufe je Bereich mit Sicherheit, Gesamtstufe, Stärken,
 *                                    Schwächen, Inhaltslücken, nächste Neubewertung
 *
 * Grundsätze:
 * - Die Wahrheit sind die Lernereignisse. Das Profil wird bei jedem Aufruf neu berechnet; ein Modellwechsel
 *   gilt rückwirkend. Eine Selbsteinschätzung fließt NICHT in die Schätzung ein (sie steht getrennt daneben).
 * - Keine Scheingenauigkeit: Ohne Messung "unknown", mit wenig Evidenz "insufficient", sonst eine Stufe mit
 *   qualitativer Sicherheit (low/medium/high = Wahrscheinlichkeit, dass die Stufe stimmt). Die Aufgaben
 *   sind von Hand eingestuft, nicht kalibriert: Es sind Schätzungen.
 * - Qwen schreibt nie ins Profil; es gibt dafür keinen Weg.
 * - Kalibrierung (P14A): Dieselbe Aufgabe mehrfach ist keine neue, unabhängige Messung. Die n-te Antwort auf
 *   dieselbe Aufgabe zählt mit Gewicht 1/n. Die Sicherheit hängt auch von der Breite ab: aus weniger als 3
 *   verschiedenen Aufgaben höchstens "low", aus weniger als 6 höchstens "medium" (eine Aufgabe sagt wenig über
 *   einen ganzen Bereich). Die Herkunft bleibt erhalten: je Bereich zusätzlich die Schätzung nur aus der
 *   Einstufung und nur aus dem Üben (by_source). Obergrenze: höchstens 0,7 über der schwersten gelösten Aufgabe
 *   (nicht mehr behaupten, als belegt ist).
 * - Herkunft (P14B): Hat ein Bereich eine Einstufung, zählen Übungsantworten dort nur halb (practice_factor).
 */

import { DIMENSIONS, collectMeasurements } from "./evidence.js";
import { createPosterior, inflate, quickSummary, repetitionWeight, summarize, truncateAbove, update } from "./measurement.js";
import { CEFR_LEVELS, CONFIDENCE_ORDER, confidenceLabel, levelLabel, levelValue } from "./scale.js";
import { eventLanguage } from "../../util/language.js";

export const LANGUAGE_PROFILE_VERSION = 1;
export const PROFILE_MODEL = "grid-irt@1";
export const PROFILE_RULES = Object.freeze({
  min_weight: 2, // weniger Evidenz: "insufficient" (keine Stufe)
  strength_delta: 0.5, // Bereich mindestens eine halbe Stufe über/unter dem Gesamtniveau
  reassess_days: { high: 120, medium: 60, low: 30 },
  // P12: früher neu einstufen, wenn sich viel getan hat, aber nie öfter als alle reassess_min_days Tage
  reassess_min_days: 14,
  reassess_attempts: 150, // so viele neue Übungsantworten seit der letzten Einstufung
  reassess_shift: 0.5, // Gesamtschätzung hat sich um mindestens eine halbe Stufe verändert (sicher geschätzt)
  // P14A: Breite der Evidenz (verschiedene Aufgaben) begrenzt die Sicherheit
  breadth_for_medium: 3,
  breadth_for_high: 6,
  // P14A: höchstens so weit über der schwersten gelösten Aufgabe (Leistung ≥ 0,5)
  ceiling_margin: 0.7,
  // P14B: Übungsantworten zählen halb, sobald der Bereich eine Einstufung hat (Einstufung = Niveau, Üben = Lernen)
  practice_factor: 0.5,
});
const DAY_MS = 86_400_000;

/**
 * @param {{events: object[], library: object, learnerId: string, languageId: string, asOf: Date,
 *   competence?: object|null}} input  events: nur dieses Lerners und dieser Sprache (engine.history())
 */
export function buildLanguageProfile({ events, library, learnerId, languageId, asOf, competence = null }) {
  if (!(asOf instanceof Date)) throw new TypeError("buildLanguageProfile: asOf (Stichtag) ist Pflicht");
  const own = events.filter((e) => e.user_id === learnerId && eventLanguage(e) === languageId && e.created_at <= asOf.toISOString());
  const measurements = collectMeasurements({ events: own, library });
  const dimensions = Object.fromEntries(DIMENSIONS.map((d) => [d, estimate(measurements.filter((m) => m.dimension === d), asOf)]));
  const overall = overallOf(dimensions);
  const assessments = completedAssessments(own);
  const lastAssessment = assessments.at(-1) ?? null;
  const self = own.filter((e) => e.event_type === "self_assessment_recorded").sort(byTime).at(-1) ?? null;
  const gaps = contentGaps(library);

  return {
    format: "spanisch-ai.language-profile",
    version: LANGUAGE_PROFILE_VERSION,
    model: PROFILE_MODEL,
    learner_id: learnerId,
    language_id: languageId,
    as_of: asOf.toISOString(),
    overall,
    dimensions,
    // die im Auftrag genannten Felder als eigene Einträge (gleiche Daten wie in dimensions)
    grammar_competence: { ...dimensions.grammar, by_level: grammarByLevel(competence, library) },
    vocabulary_estimate: vocabularyEstimate(dimensions.vocabulary, competence),
    reading_competence: dimensions.reading,
    listening_competence: dimensions.listening,
    production_competence: dimensions.production,
    conversation_competence: dimensions.conversation,
    ...strengthsAndWeaknesses(dimensions, overall),
    self_assessment: self ? { level: self.payload.level, at: self.created_at } : null,
    last_assessment: lastAssessment,
    next_reassessment: nextReassessment(overall, lastAssessment, dimensions, asOf, gaps, own),
    content_gaps: gaps,
    measurements: measurements.length,
  };
}

/** Schätzung eines Bereichs aus seinen Messungen (zeitlich geordnet, mit Zuwachs an Unsicherheit). */
function estimate(measurements, asOf, { bySource = true } = {}) {
  if (!measurements.length) return { status: "unknown", confidence: "none", measurements: 0 };
  const tracker = createDimensionTracker();
  for (const m of measurements) tracker.add(m);
  const result = tracker.summary(asOf);
  if (bySource && result.sources.assessment && result.sources.practice) {
    result.by_source = Object.fromEntries(["assessment", "practice"].map((source) => {
      const own = estimate(measurements.filter((m) => m.source === source), asOf, { bySource: false });
      return [source, { status: own.status, theta: own.theta ?? null, confidence: own.confidence, measurements: own.measurements }];
    }));
  }
  return result;
}

/**
 * Schätzung EINES Bereichs als Strom (P14B): Messungen in zeitlicher Reihenfolge hinzufügen, jederzeit den Stand
 * abfragen. Dasselbe Modell wie das Profil (das Profil ist der Stand am Stichtag); die Kalibrierung fragt den Stand
 * VOR jeder Antwort ab ("was war von diesem Lerner damals zu erwarten?").
 *
 *   Wiederholung: n-te Antwort auf dieselbe Aufgabe mit 1/n (repetitionWeight)
 *   Hörkontext (P16): k-te verschiedene Aufgabe zu derselben Aufnahme (context_id) zusätzlich mit 1/k
 *   Herkunft (P14B): Sobald der Bereich eine Einstufung hat, zählen Übungsantworten mit practice_factor (0,5):
 *                    Die Einstufung bestimmt das Niveau, das Üben verschiebt es langsamer.
 */
export function createDimensionTracker() {
  let posterior = createPosterior();
  let last = null;
  let weight = 0;
  let count = 0;
  let solvedMax = -Infinity;
  let assessed = false;
  const sources = { assessment: 0, practice: 0 };
  const seen = new Map(); // Aufgabe → bisherige Antworten
  const contexts = new Map(); // P16: Hörkontext → Aufgabe → wievielte verschiedene Aufgabe
  return {
    add(m) {
      if (last !== null) posterior = inflate(posterior, (Date.parse(m.at) - Date.parse(last)) / DAY_MS);
      const n = (seen.get(m.item_id) ?? 0) + 1;
      seen.set(m.item_id, n);
      if (m.source === "assessment") assessed = true;
      const factor = m.source === "practice" && assessed ? PROFILE_RULES.practice_factor : 1;
      let k = 1;
      if (m.context_id) {
        const tasks = contexts.get(m.context_id) ?? new Map();
        if (!tasks.has(m.item_id)) tasks.set(m.item_id, tasks.size + 1);
        contexts.set(m.context_id, tasks);
        k = tasks.get(m.item_id);
      }
      const w = m.weight * repetitionWeight(n) * repetitionWeight(k) * factor;
      posterior = update(posterior, { ...m, weight: w });
      last = m.at;
      weight += w;
      count += 1;
      sources[m.source] += 1;
      if (m.score >= 0.5) solvedMax = Math.max(solvedMax, m.difficulty);
    },
    /**
     * Schneller Stand für die Kalibrierung: nur Fähigkeit und Sicherheit (dieselben Regeln wie summary, ohne die
     * Drift seit der letzten Messung und ohne Intervalle).
     */
    peek() {
      if (!count || weight < PROFILE_RULES.min_weight) return null;
      const ceiling = Number.isFinite(solvedMax) ? solvedMax + PROFILE_RULES.ceiling_margin : Infinity;
      const s = quickSummary(posterior, ceiling);
      const byBand = confidenceLabel(s.band_probability);
      const breadth = seen.size;
      const cap = breadth < PROFILE_RULES.breadth_for_medium ? "low" : breadth < PROFILE_RULES.breadth_for_high ? "medium" : "high";
      return { status: "estimated", theta: s.theta, confidence: CONFIDENCE_ORDER.indexOf(byBand) <= CONFIDENCE_ORDER.indexOf(cap) ? byBand : cap };
    },
    /** Stand am Stichtag (asOf ≥ letzte Messung); ohne Messung "unknown". */
    summary(asOf) {
      if (!count) return { status: "unknown", confidence: "none", measurements: 0 };
      let current = inflate(posterior, (asOf.getTime() - Date.parse(last)) / DAY_MS);
      const ceiling = Number.isFinite(solvedMax) ? solvedMax + PROFILE_RULES.ceiling_margin : null;
      const uncapped = summarize(current).theta;
      if (ceiling !== null) current = truncateAbove(current, ceiling);
      const s = summarize(current);
      const breadth = seen.size;
      const base = { measurements: count, weight: round(weight), sources: { ...sources }, breadth, last_at: last };
      if (weight < PROFILE_RULES.min_weight) return { status: "insufficient", confidence: "none", ...base };
      const byBand = confidenceLabel(s.band_probability);
      const cap = breadth < PROFILE_RULES.breadth_for_medium ? "low" : breadth < PROFILE_RULES.breadth_for_high ? "medium" : "high";
      const confidence = CONFIDENCE_ORDER.indexOf(byBand) <= CONFIDENCE_ORDER.indexOf(cap) ? byBand : cap;
      return {
        status: "estimated",
        level: s.level,
        level_label: levelLabel(s.theta),
        theta: s.theta,
        sd: s.sd,
        interval80: s.interval80,
        band_probability: s.band_probability,
        confidence,
        confidence_basis: confidence === byBand ? "band" : "breadth",
        ceiling: ceiling === null ? null : round(ceiling),
        capped: ceiling !== null && uncapped > ceiling,
        ...base,
      };
    },
  };
}

/**
 * Gesamtstufe: Median der geschätzten Bereiche; Sicherheit höchstens "low" bei nur einem Bereich und nie sicherer
 * als der sicherste Bereich (P14A: aus lauter unsicheren Bereichen wird keine sichere Gesamtstufe). Gibt es
 * Bereiche mit Sicherheit mindestens "medium", zählen nur diese.
 */
function overallOf(dimensions) {
  const all = DIMENSIONS.filter((d) => dimensions[d].status === "estimated");
  if (!all.length) return { status: "unknown", confidence: "none", basis: [] };
  // P14A: unsichere Bereiche (low) verschieben die Gesamtstufe nicht, solange es sichere gibt
  const reliable = all.filter((d) => dimensions[d].confidence !== "low");
  const estimated = reliable.length ? reliable : all;
  const thetas = estimated.map((d) => dimensions[d].theta).sort((a, b) => a - b);
  // P21: gewichteter Median über ALLE geschätzten Bereiche (Gewicht nach Sicherheit). Vorher zählten nur Bereiche mit
  // mindestens "medium": Fiel ein Bereich nach einer Pause knapp darunter, sprang die Gesamtstufe (Bereich ganz drin
  // oder ganz draußen). Unsichere Bereiche zählen halb, als Median bleibt das Ergebnis robust gegen Ausreißer.
  const theta = weightedMedian(all.map((d) => [dimensions[d].theta, OVERALL_WEIGHT[dimensions[d].confidence] ?? 0.5]));
  const band = estimated.reduce((sum, d) => sum + dimensions[d].band_probability, 0) / estimated.length;
  const best = estimated.reduce((top, d) => Math.max(top, CONFIDENCE_ORDER.indexOf(dimensions[d].confidence)), 0);
  const byBand = confidenceLabel(band);
  const confidence = estimated.length < 2 ? "low" : CONFIDENCE_ORDER[Math.min(best, CONFIDENCE_ORDER.indexOf(byBand))];
  return {
    status: confidence === "low" ? "provisional" : "estimated",
    level: levelLabel(theta).replace("+", ""),
    level_label: levelLabel(theta),
    theta: round(theta),
    band_probability: round(band),
    confidence,
    basis: estimated,
    spread: round(thetas.at(-1) - thetas[0]),
  };
}

/**
 * Stärken und Schwächen: Bereich mindestens eine halbe Stufe über/unter dem Gesamtniveau, mit Sicherheit
 * mindestens "medium". P14A: oder das 80-%-Intervall liegt ganz auf einer Seite der übrigen Bereiche (deren Median;
 * aus ≥ 2 verschiedenen Aufgaben).
 * "Sicherheit low" heißt oft nur "zwischen zwei Stufen", nicht "unklar, ob schwächer": 9 Antworten auf 3 Aufgaben,
 * alle ohne Leistung, zeigen eine Schwäche, auch wenn A1 und A2 nicht zu trennen sind.
 */
function strengthsAndWeaknesses(dimensions, overall) {
  const strengths = [];
  const weaknesses = [];
  if (overall.status === "unknown") return { strengths, weaknesses };
  const D = PROFILE_RULES.strength_delta;
  for (const d of DIMENSIONS) {
    const x = dimensions[d];
    if (x.status !== "estimated") continue;
    const [lower, upper] = x.interval80 ?? [x.theta, x.theta];
    const others = DIMENSIONS.filter((o) => o !== d && dimensions[o].status === "estimated").map((o) => dimensions[o].theta);
    const reference = others.length ? median(others) : overall.theta;
    const broad = (x.breadth ?? 0) >= 2;
    const surelyBelow = broad && upper <= reference - D;
    const surelyAbove = broad && lower >= reference + D;
    if (x.confidence === "low" && !surelyBelow && !surelyAbove) continue;
    const delta = round(x.theta - overall.theta);
    const entry = { dimension: d, level_label: x.level_label, delta, confidence: x.confidence,
      basis: x.confidence === "low" ? "interval" : "confidence" };
    if (delta >= D && (x.confidence !== "low" || surelyAbove)) strengths.push({ ...entry, reason: `${x.level_label}, deutlich über dem Gesamtniveau` });
    if (delta <= -D && (x.confidence !== "low" || surelyBelow)) weaknesses.push({ ...entry, reason: `${x.level_label}, deutlich unter dem Gesamtniveau` });
  }
  strengths.sort((a, b) => b.delta - a.delta);
  weaknesses.sort((a, b) => a.delta - b.delta);
  return { strengths, weaknesses };
}

function grammarByLevel(competence, library) {
  if (!competence) return null;
  const result = {};
  for (const skill of competence.skills.filter((s) => s.type === "grammar_structure")) {
    const level = library.skill(skill.skill_id)?.level;
    if (!level) continue;
    const entry = result[level] ??= { skills: 0, practicing: 0, stable_or_better: 0 };
    entry.skills += 1;
    if (skill.mastery === "practicing") entry.practicing += 1;
    if (skill.mastery === "stable" || skill.mastery === "mastered") entry.stable_or_better += 1;
  }
  return result;
}

function vocabularyEstimate(dimension, competence) {
  const lexical = competence ? competence.skills.filter((s) => s.type === "lexical_item") : [];
  return {
    ...dimension,
    active_items: lexical.filter((s) => ["practicing", "stable", "mastered"].includes(s.mastery)).length,
    stable_items: lexical.filter((s) => s.mastery === "stable" || s.mastery === "mastered").length,
    catalog_items: lexical.length,
    size_estimate: null,
    size_note: "Wortschatzgröße noch nicht schätzbar: Dafür fehlen Wortlisten nach Häufigkeit im Inhalt.",
  };
}

function completedAssessments(events) {
  const started = new Map(events.filter((e) => e.event_type === "assessment_started").map((e) => [e.payload.assessment_id, e]));
  return events.filter((e) => e.event_type === "assessment_completed").sort(byTime).map((e) => ({
    assessment_id: e.payload.assessment_id,
    kind: started.get(e.payload.assessment_id)?.payload.kind ?? "initial",
    completed_at: e.created_at,
  }));
}

/**
 * Nächste Neubewertung: je sicherer, desto später; ohne Einstufung sofort sinnvoll (wenn Aufgaben vorhanden).
 * P12: früher fällig, wenn seit der letzten Einstufung viel gelernt wurde (Anzahl Antworten) oder sich die sichere
 * Gesamtschätzung deutlich verschoben hat; beides frühestens nach reassess_min_days (nicht nach jedem Fehler).
 */
function nextReassessment(overall, last, dimensions, asOf, gaps, events = []) {
  if (!last) return { due_at: asOf.toISOString(), reason: "noch keine Einstufung", due: true, triggers: ["no_assessment"] };
  const R = PROFILE_RULES;
  const days = R.reassess_days[overall.confidence] ?? R.reassess_days.low;
  const since = Date.parse(last.completed_at);
  const dueAt = new Date(since + days * DAY_MS);
  const daysSince = (asOf.getTime() - since) / DAY_MS;
  const attemptsSince = events.filter((e) => e.event_type === "attempt" && Date.parse(e.created_at) > since).length;
  const snapshot = events.find((e) => e.event_type === "language_profile_recorded" && e.payload.assessment_id === last.assessment_id);
  const before = snapshot?.payload.overall?.theta;
  const shift = Number.isFinite(before) && Number.isFinite(overall.theta) && overall.confidence !== "low"
    ? Math.round((overall.theta - before) * 100) / 100 : null;
  const triggers = [];
  if (dueAt <= asOf) triggers.push("time");
  if (daysSince >= R.reassess_min_days && attemptsSince >= R.reassess_attempts) triggers.push("new_events");
  if (daysSince >= R.reassess_min_days && shift !== null && Math.abs(shift) >= R.reassess_shift) triggers.push("competence_shift");
  const reasons = {
    time: `Sicherheit ${overall.confidence}: nach ${days} Tagen neu einstufen`,
    new_events: `${attemptsSince} neue Antworten seit der letzten Einstufung`,
    competence_shift: `Gesamtschätzung hat sich um ${shift} verändert`,
  };
  return {
    due_at: dueAt.toISOString(),
    reason: triggers.length ? triggers.map((t) => reasons[t]).join("; ") : reasons.time,
    due: triggers.length > 0,
    triggers,
    attempts_since: attemptsSince,
    shift,
    unmeasured: DIMENSIONS.filter((d) => dimensions[d].status === "unknown" && !gaps.some((g) => g.dimension === d)),
  };
}

/** Bereiche, für die das Inhaltspaket (noch) keine Einstufungsaufgaben hat. */
export function contentGaps(library) {
  return DIMENSIONS.filter((d) => !library.assessmentItems({ dimension: d }).length)
    .map((d) => ({ dimension: d, reason: "keine Einstufungsaufgaben in diesem Inhaltspaket" }));
}

export { CEFR_LEVELS, levelValue };

function byTime(a, b) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

const OVERALL_WEIGHT = Object.freeze({ low: 0.5, medium: 1, high: 1.5 });

function weightedMedian(pairs) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const half = sorted.reduce((sum, [, w]) => sum + w, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i][1];
    if (Math.abs(cumulative - half) < 1e-9) return (sorted[i][0] + sorted[i + 1][0]) / 2;
    if (cumulative > half) return sorted[i][0];
  }
  return sorted.at(-1)[0];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
