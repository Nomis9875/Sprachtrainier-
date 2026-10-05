/**
 * Lernbedarfe aus dem Sprachprofil (P11B): Welche Kompetenzbereiche sollen mehr Gewicht bekommen?
 *
 *   Schwäche (Bereich ≥ 0,5 Stufen unter dem Gesamtniveau, Sicherheit mindestens "medium")
 *     grammar → grammar_consolidation · vocabulary → vocabulary_expansion · production → production_practice
 *     conversation → conversation_practice · reading → reading_practice · listening → listening_practice
 *   Bereich noch ungemessen, obwohl es Einstufungsaufgaben gibt → measure (niedrige Priorität)
 *
 * Diese Bedarfe ergänzen die Skill-Bedarfe des Brain (brain/needs.js), sie ersetzen sie nicht: Einzelne
 * Fehler, Wiederholung und Gedächtnis bleiben die Grundlage der Planung. Der Planer gibt Übungen, die einen
 * schwachen Bereich trainieren, einen kleinen Zuschlag (planner.js, "Profil: …").
 */

export const DIMENSION_NEED_OF = Object.freeze({
  grammar: "grammar_consolidation",
  vocabulary: "vocabulary_expansion",
  production: "production_practice",
  conversation: "conversation_practice",
  reading: "reading_practice",
  listening: "listening_practice",
});
const LABELS = Object.freeze({
  grammar_consolidation: "Grammatik festigen",
  vocabulary_expansion: "Wortschatz erweitern",
  production_practice: "freies Schreiben üben",
  conversation_practice: "Sprechen und Gespräche üben",
  reading_practice: "Leseverstehen üben",
  listening_practice: "Hörverstehen üben",
  measure: "Bereich einstufen",
});

/** @returns {{dimension: string, need: string, label: string, priority: number, reason: string}[]} */
export function profileNeeds(profile) {
  const needs = profile.weaknesses.map((w) => ({
    dimension: w.dimension,
    need: DIMENSION_NEED_OF[w.dimension],
    label: LABELS[DIMENSION_NEED_OF[w.dimension]],
    priority: Math.min(1, Math.round((0.5 + Math.abs(w.delta) / 2) * 100) / 100),
    delta: w.delta, // Abstand zum Gesamtniveau (negativ = schwächer), für die Session-Zusammensetzung
    reason: `${w.dimension}: ${w.reason} (Sicherheit ${w.confidence})`,
  }));
  const gaps = new Set(profile.content_gaps.map((g) => g.dimension));
  for (const [dimension, x] of Object.entries(profile.dimensions)) {
    if ((x.status === "unknown" || x.status === "insufficient") && !gaps.has(dimension)) {
      needs.push({ dimension, need: "measure", label: LABELS.measure, priority: 0.2,
        reason: `${dimension}: noch zu wenig Evidenz für eine Einschätzung` });
    }
  }
  return needs.sort((a, b) => b.priority - a.priority || (a.dimension < b.dimension ? -1 : 1));
}

/** Welche Kompetenzbereiche trainiert eine Übung? (für den Zuschlag im Planer) */
export function exerciseDimensions(exercise) {
  const dims = new Set();
  // P15: Höraufgaben trainieren Hören (Antwortaufgaben zusätzlich Produktion), nie Grammatik/Wortschatz direkt
  if (["listening_comprehension", "dictation", "listening_response"].includes(exercise.type)) {
    dims.add("listening");
    if (exercise.type === "listening_response") dims.add("production");
    return dims;
  }
  if (exercise.type === "reading_comprehension") dims.add("reading");
  if (exercise.type === "listening_comprehension") dims.add("listening");
  if ((exercise.target_items ?? []).length) dims.add("vocabulary");
  if (exercise.evaluation_mode !== "open" && ((exercise.structures ?? []).length || (exercise.common_errors ?? []).length)) dims.add("grammar");
  if (exercise.evaluation_mode === "open") dims.add(exercise.type === "conversation" ? "conversation" : "production");
  return dims;
}
