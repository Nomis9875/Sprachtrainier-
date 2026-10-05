/**
 * Messmodell des Sprachprofils (P11B): Bayes-Schätzung einer Fähigkeit θ auf der GER-Skala.
 *
 * Je Dimension (Grammatik, Wortschatz, Lesen, …) eine Verteilung über θ auf einem festen Raster
 * (0,5 bis 7 in Schritten von 0,05). Eine Messung ist eine Aufgabe mit Schwierigkeit b und Ergebnis s:
 *
 *   P(richtig | θ) = c + (1 − c) · σ(a · (θ − b))        a = 1,7; c = Rateanteil (Auswahl: 1/Optionen)
 *   Likelihood      = (P^s · (1 − P)^(1 − s))^w           s ∈ [0, 1] (Teilleistung möglich), w = Gewicht
 *
 * Vor jeder Messung wächst die Unsicherheit mit der verstrichenen Zeit (Varianz + DRIFT je 30 Tage): Das
 * Niveau darf sich ändern (Lernen, Vergessen), und alte Nachweise zählen mit der Zeit weniger.
 * Deterministisch: gleiche Messungen → gleiche Verteilung. Kein Zufall, keine Uhr.
 */

import { THETA_MAX, THETA_MIN, levelOf, levelValue } from "./scale.js";

export const MEASUREMENT_RULES = Object.freeze({
  step: 0.05,
  discrimination: 1.7,
  prior_mean: 3.5, // Mitte B1/B2: bewusst schwach, deckt A1–C2 ab
  prior_sd: 1.6,
  drift_per_30_days: 0.05, // Varianzzuwachs ohne Nachweise
});

const GRID = (() => {
  const points = [];
  for (let t = THETA_MIN; t <= THETA_MAX + 1e-9; t += MEASUREMENT_RULES.step) points.push(Math.round(t * 100) / 100);
  return Object.freeze(points);
})();

export function createPosterior({ mean = MEASUREMENT_RULES.prior_mean, sd = MEASUREMENT_RULES.prior_sd } = {}) {
  return normalize(GRID.map((t) => Math.exp(-0.5 * ((t - mean) / sd) ** 2)));
}

/** P(richtig) einer Aufgabe mit Schwierigkeit b bei Fähigkeit θ. */
export function probabilityCorrect(theta, difficulty, guessing = 0) {
  return guessing + (1 - guessing) / (1 + Math.exp(-MEASUREMENT_RULES.discrimination * (theta - difficulty)));
}

/** Neue Verteilung nach einer Messung {difficulty, score, weight, guessing}. */
export function update(posterior, { difficulty, score, weight = 1, guessing = 0 }) {
  const s = Math.min(1, Math.max(0, score));
  return normalize(posterior.map((p, i) => {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, probabilityCorrect(GRID[i], difficulty, guessing)));
    return p * Math.exp(weight * (s * Math.log(q) + (1 - s) * Math.log(1 - q)));
  }));
}

/**
 * Gegenrichtung (P14B, Kalibrierung): Verteilung über die SCHWIERIGKEIT b einer Aufgabe, gegeben ein Lerner mit
 * bekannter Fähigkeit θ ({ability}). Dasselbe Modell wie update(), nur mit b statt θ auf dem Raster.
 */
export function updateDifficulty(posterior, { ability, score, weight = 1, guessing = 0 }) {
  const s = Math.min(1, Math.max(0, score));
  return normalize(posterior.map((p, i) => {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, probabilityCorrect(ability, GRID[i], guessing)));
    return p * Math.exp(weight * (s * Math.log(q) + (1 - s) * Math.log(1 - q)));
  }));
}

/**
 * Schwierigkeit aus vielen Antworten auf einmal (P14B, schnell): dasselbe Modell wie updateDifficulty, aber im
 * Log-Raum aufsummiert und mit Tabellen. Die Fähigkeiten liegen auf dem Raster (auf 0,05 gerundet), deshalb ist
 * θ − b immer ein Vielfaches der Schrittweite und P(richtig) eine Tabellenzeile. Ein exp je Rasterpunkt am Ende.
 * @param {{mean: number, sd: number}} prior
 * @param {{ability: number, score: number, weight: number, guessing?: number}[]} observations
 */
export function difficultyPosterior(prior, observations) {
  const log = GRID.map((t) => -0.5 * ((t - prior.mean) / prior.sd) ** 2);
  const step = MEASUREMENT_RULES.step;
  for (const o of observations) {
    const table = logTable(o.guessing ?? 0);
    const s = Math.min(1, Math.max(0, o.score));
    const base = Math.round((o.ability - GRID[0]) / step); // Index der Fähigkeit auf dem Raster
    for (let i = 0; i < GRID.length; i += 1) {
      const k = base - i + OFFSET; // (θ − b) / step, verschoben auf einen Tabellenindex
      const j = Math.min(table.q.length - 1, Math.max(0, k));
      log[i] += o.weight * (s * table.q[j] + (1 - s) * table.notQ[j]);
    }
  }
  const max = Math.max(...log);
  return normalize(log.map((v) => Math.exp(v - max)));
}

const OFFSET = 2 * 140; // Tabellen decken θ − b von −14 bis +14 ab
const TABLES = new Map();
function logTable(guessing) {
  if (!TABLES.has(guessing)) {
    const q = [];
    const notQ = [];
    for (let k = -OFFSET; k <= OFFSET; k += 1) {
      const p = Math.min(1 - 1e-9, Math.max(1e-9, probabilityCorrect(k * MEASUREMENT_RULES.step, 0, guessing)));
      q.push(Math.log(p));
      notQ.push(Math.log(1 - p));
    }
    TABLES.set(guessing, { q, notQ });
  }
  return TABLES.get(guessing);
}

/**
 * Wiederholung (P14A, auch P14B): Die n-te Antwort auf dieselbe Aufgabe (desselben Lerners) zählt mit 1/n.
 * Dieselbe Regel für das Sprachprofil und die Kalibrierung: ein Modell, nicht zwei.
 */
export function repetitionWeight(n) {
  return 1 / Math.max(1, n);
}

/** Mehr Unsicherheit nach `days` Tagen ohne Messung (Faltung mit einer Normalverteilung). */
export function inflate(posterior, days) {
  const variance = Math.max(0, days) / 30 * MEASUREMENT_RULES.drift_per_30_days;
  if (variance < 1e-6) return posterior;
  const sd = Math.sqrt(variance);
  const radius = Math.ceil((3 * sd) / MEASUREMENT_RULES.step);
  const kernel = [];
  for (let k = -radius; k <= radius; k += 1) kernel.push(Math.exp(-0.5 * ((k * MEASUREMENT_RULES.step) / sd) ** 2));
  return normalize(posterior.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = Math.min(GRID.length - 1, Math.max(0, i + k)); // Ränder gespiegelt statt abgeschnitten
      sum += posterior[j] * kernel[k + radius];
    }
    return sum;
  }));
}

/**
 * Obergrenze aus dem Belegten (P14A): Masse über `limit` entfällt. Wer nur B2-Aufgaben gelöst hat, ist nicht
 * "wahrscheinlich C2", so viele es auch waren.
 */
export function truncateAbove(posterior, limit) {
  if (!Number.isFinite(limit)) return posterior;
  const cut = posterior.map((p, i) => (GRID[i] <= limit ? p : 0));
  return cut.some((p) => p > 0) ? normalize(cut) : posterior;
}

/**
 * Schnelle Kurzfassung (P14B, Kalibrierung): Mittelwert und Wahrscheinlichkeit der Stufe, optional mit Obergrenze,
 * ohne Kopien und ohne Quantile. Dieselben Zahlen wie summarize(truncateAbove(posterior, limit)).
 */
export function quickSummary(posterior, limit = Infinity) {
  let mass = 0;
  let mean = 0;
  for (let i = 0; i < posterior.length; i += 1) {
    if (GRID[i] > limit) break;
    mass += posterior[i];
    mean += posterior[i] * GRID[i];
  }
  if (mass <= 0) return summarize(posterior);
  mean /= mass;
  const lower = levelValue(levelOf(mean));
  let band = 0;
  for (let i = 0; i < posterior.length && GRID[i] <= limit; i += 1) if (GRID[i] >= lower && GRID[i] < lower + 1) band += posterior[i];
  return { theta: round(mean), band_probability: round(band / mass) };
}

/** Kennzahlen: Mittelwert, Streuung, geschätzte Stufe und die Wahrscheinlichkeit, dass sie stimmt. */
export function summarize(posterior) {
  const mean = posterior.reduce((sum, p, i) => sum + p * GRID[i], 0);
  const sd = Math.sqrt(posterior.reduce((sum, p, i) => sum + p * (GRID[i] - mean) ** 2, 0));
  const level = levelOf(mean);
  const lower = levelValue(level);
  const bandMass = posterior.reduce((sum, p, i) => sum + (GRID[i] >= lower && GRID[i] < lower + 1 ? p : 0), 0);
  return {
    theta: round(mean), sd: round(sd), level, band_probability: round(bandMass),
    interval80: [round(quantile(posterior, 0.1)), round(quantile(posterior, 0.9))],
  };
}

function quantile(posterior, q) {
  let sum = 0;
  for (let i = 0; i < posterior.length; i += 1) {
    sum += posterior[i];
    if (sum >= q) return GRID[i];
  }
  return GRID.at(-1);
}

function normalize(values) {
  const total = values.reduce((a, b) => a + b, 0);
  return total > 0 ? values.map((v) => v / total) : values.map(() => 1 / values.length);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
