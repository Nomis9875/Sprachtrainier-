/**
 * GER/CEFR-Skala für Schätzungen (P11B). Stetig: A1 = [1, 2), A2 = [2, 3), … C2 = [6, 7).
 *
 *   θ = 4,3  → "B2"      (untere Hälfte der Stufe)
 *   θ = 4,6  → "B2+"     (obere Hälfte)
 *
 * Aussagen sind Schätzungen mit Sicherheit, keine Messung nach einer normierten Prüfung: Die Aufgaben sind
 * von Hand einer Stufe zugeordnet, nicht empirisch kalibriert (siehe docs/sprachprofil.md).
 */

export const CEFR_LEVELS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const THETA_MIN = 0.5;
export const THETA_MAX = 7;

/** Untere Grenze der Stufe (A1 → 1, C2 → 6). */
export function levelValue(level) {
  const index = CEFR_LEVELS.indexOf(level);
  if (index < 0) throw new TypeError(`Unbekannte Stufe: ${level}`);
  return index + 1;
}

/** Stufe zu θ (unter A1 → "A1", ab C2 → "C2"). */
export function levelOf(theta) {
  const index = Math.min(CEFR_LEVELS.length - 1, Math.max(0, Math.floor(theta) - 1));
  return CEFR_LEVELS[index];
}

/** Anzeige mit "+" für die obere Hälfte einer Stufe (nicht bei C2). */
export function levelLabel(theta) {
  const level = levelOf(theta);
  const upper = theta - levelValue(level) >= 0.5 && level !== "C2" && theta >= 1;
  return upper ? `${level}+` : level;
}

/** Qualitative Sicherheit aus der Wahrscheinlichkeit, dass die Stufe stimmt. */
export function confidenceLabel(bandMass) {
  if (bandMass >= 0.7) return "high";
  if (bandMass >= 0.45) return "medium";
  return "low";
}

export const CONFIDENCE_ORDER = Object.freeze(["low", "medium", "high"]);
