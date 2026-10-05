/**
 * Session-Zusammensetzung (P12): Welcher Anteil der Fokus-Skills dient welchem Zweck?
 *
 *   Startwerte (werden empirisch kalibriert):
 *     error        30 %  Fehlerfokus (aktive, wiederkehrende Fehler)
 *     repetition   20 %  Gedächtnis/Wiederholung (fällig, Festigen)
 *     new_material 25 %  Neues in der Lernzone
 *     weakest      15 %  schwächster Bereich (Produktionslücke, schwacher Kompetenzbereich des Sprachprofils)
 *     measurement  10 %  Messen (Bereiche ohne verlässliche Schätzung)
 *
 * Die Anteile passen sich an, statt blind abgearbeitet zu werden (jede Anpassung wird benannt):
 *   keine Kandidaten einer Kategorie → 0 %   (z. B. keine relevanten Fehler → kein Fehlerfokus)
 *   ≥ 2 akute Fehler                 → Fehlerfokus 40 %
 *   ≥ 3 fällige Wiederholungen       → Wiederholung 30 %
 *   Bereich schwächer (≤ −0,5 Stufen)        → schwächster Bereich 30 %   (P21; vorher erst ab −1 Stufe)
 *   Bereich deutlich schwächer (≤ −1 Stufe)  → schwächster Bereich 40 %   (P21; vorher 25 %)
 *   keine verlässliche Schätzung     → Messen 20 %; alles verlässlich geschätzt → 0 %
 *   (P13) ≥ 2 Produktionslücken      → schwächster Bereich 35 % (kontrolliert deutlich besser als frei,
 *                                      wiederholte Fehler nur in freier Produktion, sicher, aber nie übertragen)
 *   (P13) ≥ 14 Tage keine freie/spontane Produktion bei geübten Skills → schwächster Bereich 25 %
 * Bedarfe mit dem Grund "production_gap" zählen zum schwächsten Bereich (Produktion), auch wenn ihr Zweck
 * Fehlerfokus ist: Sie brauchen Produktionsaufgaben, nicht mehr Drill.
 * Danach auf 100 % normiert. Keine Kategorie darf mehr als MAX_SHARE bekommen (keine Metrik dominiert).
 *
 * Umsetzung im Planer: Die Anteile begrenzen im ersten Durchgang, wie viele Fokus-Skills je Kategorie gewählt
 * werden (aufgerundet, mindestens 1 bei Anteil > 0). Freie Plätze füllt danach wieder die Priorität. So entsteht
 * keine halb leere Session, aber auch keine Session, die nur aus Fehlerdrill besteht.
 */

export const COMPOSITION_BASE = Object.freeze({ error: 0.3, repetition: 0.2, new_material: 0.25, weakest: 0.15, measurement: 0.1 });
export const CATEGORIES = Object.freeze(Object.keys(COMPOSITION_BASE));
export const COMPOSITION_RULES = Object.freeze({
  manyAcuteErrors: 2, errorShareMany: 0.4,
  manyDue: 3, repetitionShareMany: 0.3,
  // P21: abgestuft. Vorher erst ab −1 Stufe 25 %: Ein Lerner mit Grammatik B2, Wortschatz B1 bekam nur einen von fünf
  // Fokusplätzen für den schwachen Bereich. Obergrenze je Kategorie bleibt maxShare (keine Metrik dominiert).
  moderateWeakness: -0.5, weakestShareModerate: 0.3,
  strongWeakness: -1, weakestShareStrong: 0.4,
  weakestShareStale: 0.25,
  measurementShareUnknown: 0.2,
  manyProductionGaps: 2, weakestShareProduction: 0.35, productionStaleDays: 14,
  maxShare: 0.5,
});

const PURPOSE_CATEGORY = Object.freeze({
  error_focus: "error", review: "repetition", consolidate: "repetition", production: "weakest",
  new: "new_material", challenge: "new_material",
});

/**
 * Kategorie eines Kandidaten (Bedarf mit Übungen).
 * @param {{purpose: string, dimensions?: Set<string>}} candidate
 * @param {{weakDimensions: Set<string>, unmeasured: Set<string>}} context
 */
export function categoryOf(candidate, { weakDimensions, unmeasured }) {
  if (candidate.reason_code === "production_gap") return "weakest";
  // P15: nicht geprüftes Hören ist Messen (Diagnose); schwaches, umgangenes oder zu schnelles Hören ist der schwächste Bereich
  // P24: ist Hören ein schwacher Bereich des Sprachprofils, gehört auch ungeprüftes Hören zum schwachen Bereich (sonst
  // verliert es als Messung gegen schriftliche Kandidaten und kommt in kurzen Sessions nie vor)
  if (candidate.channel === "listening") {
    return candidate.reason_code === "listening_evidence_gap" && !weakDimensions.has("listening") ? "measurement" : "weakest";
  }
  const base = PURPOSE_CATEGORY[candidate.purpose] ?? "new_material";
  const dims = candidate.dimensions ?? new Set();
  if (base === "new_material" && [...dims].some((d) => unmeasured.has(d))) return "measurement";
  if (base === "new_material" && [...dims].some((d) => weakDimensions.has(d))) return "weakest";
  return base;
}

/**
 * Anteile für diese Session aus den Signalen.
 * @param {{counts: Record<string, number>, acuteErrors: number, due: number, strongestWeakness: number|null,
 *   abilityKnown: boolean, unmeasured: number, productionGaps?: number, daysWithoutProduction?: number|null}} signals
 */
export function compositionFor(signals) {
  const R = COMPOSITION_RULES;
  const shares = { ...COMPOSITION_BASE };
  const adjustments = [];
  let weakDimension = false; // P21: ein Bereich des Sprachprofils liegt deutlich unter dem Gesamtniveau
  const set = (category, value, reason) => {
    if (shares[category] === value) return;
    shares[category] = value;
    adjustments.push({ category, share: value, reason });
  };
  if (signals.acuteErrors >= R.manyAcuteErrors) set("error", R.errorShareMany, `${signals.acuteErrors} akute Fehler`);
  if (signals.due >= R.manyDue) set("repetition", R.repetitionShareMany, `${signals.due} fällige Wiederholungen`);
  if (signals.strongestWeakness !== null && signals.strongestWeakness <= R.strongWeakness) {
    set("weakest", R.weakestShareStrong, `ein Bereich liegt ${Math.abs(signals.strongestWeakness)} Stufen unter dem Gesamtniveau`);
    weakDimension = true;
  } else if (signals.strongestWeakness !== null && signals.strongestWeakness <= R.moderateWeakness) {
    set("weakest", R.weakestShareModerate, `ein Bereich liegt ${Math.abs(signals.strongestWeakness)} Stufen unter dem Gesamtniveau`);
    weakDimension = true;
  }
  if ((signals.productionGaps ?? 0) >= R.manyProductionGaps) {
    set("weakest", R.weakestShareProduction, `${signals.productionGaps} Produktionslücken (kontrolliert besser als frei)`);
  } else if ((signals.daysWithoutProduction ?? 0) >= R.productionStaleDays) {
    set("weakest", Math.max(shares.weakest, R.weakestShareStale), `seit ${signals.daysWithoutProduction} Tagen keine freie Produktion`);
  }
  if (!signals.abilityKnown) set("measurement", R.measurementShareUnknown, "noch keine verlässliche Einstufung");
  else if (signals.unmeasured === 0) set("measurement", 0, "alle Bereiche verlässlich geschätzt");
  for (const category of CATEGORIES) {
    if (!signals.counts[category]) set(category, 0, "keine passenden Lernbedarfe");
  }
  const total = CATEGORIES.reduce((sum, c) => sum + shares[c], 0);
  const normalized = {};
  for (const c of CATEGORIES) normalized[c] = total > 0 ? Math.min(R.maxShare, round(shares[c] / total)) : 0;
  return { shares: normalized, adjustments, weak_dimension: weakDimension && normalized.weakest > 0 };
}

/** Höchstzahl Fokus-Skills je Kategorie im ersten Durchgang (aufgerundet, mindestens 1 bei Anteil > 0). */
export function focusCaps(shares, focus) {
  return Object.fromEntries(CATEGORIES.map((c) => [c, shares[c] > 0 ? Math.max(1, Math.ceil(shares[c] * focus)) : 0]));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
