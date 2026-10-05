/**
 * Nachweisstufen (Evidence): unter welchen Bedingungen eine Struktur oder ein
 * Ausdruck verwendet wurde. Nicht jede richtige Antwort ist gleich viel wert.
 *
 *   recognized   erkannt (z. B. Karteikarte umgedreht, Auswahl)          Gewicht 0.25
 *   controlled   kontrolliert: Form/Ausdruck ist vorgegeben (Lückentext,
 *                Umformung, "Wie sagt man …?")                             Gewicht 0.5
 *   guided       geführte Produktion: freie Antwort, aber die Aufgabe
 *                nennt die Struktur (Training)                             Gewicht 1
 *   free         freie Produktion: situative/argumentative Aufgabe, die
 *                Struktur wurde selbst gewählt (Challenge, schriftlich)     Gewicht 2
 *   spontaneous  spontan: im Gespräch oder gesprochen, ohne Hinweis          Gewicht 3
 *
 * "Es importante que vengas." im Lückentext (controlled, 0.5) zählt also ein
 * Sechstel dessen, was derselbe Subjuntivo im Gespräch (spontaneous, 3) zählt.
 */

export const EVIDENCE_LEVELS = Object.freeze(["recognized", "controlled", "guided", "free", "spontaneous"]);

export const EVIDENCE_WEIGHT = Object.freeze({
  recognized: 0.25,
  controlled: 0.5,
  guided: 1,
  free: 2,
  spontaneous: 3,
});

/**
 * Wie verlässlich ist die Quelle eines Nachweises?
 * Regeln und Referenzlösungen sind sicher, Selbsteinschätzung (Karteikarten) zählt halb.
 * Qwen ("llm") entscheidet nur, welcher Nachweis eines Versuchs Vorrang hat (Regel vor
 * Qwen); in die Einstufung fließt es nicht ein (siehe projection.js).
 */
export const SOURCE_CONFIDENCE = Object.freeze({
  reference: 1,
  rule: 1,
  llm: 0.5,
  self: 0.5,
});

export function evidenceRank(level) {
  const rank = EVIDENCE_LEVELS.indexOf(level);
  if (rank < 0) throw new TypeError(`Unbekannte Nachweisstufe: ${level}`);
  return rank;
}

export function isAtLeast(level, minimum) {
  return evidenceRank(level) >= evidenceRank(minimum);
}

/**
 * Welche Nachweisstufe liefert eine Antwort auf diese Übung?
 *
 * @param {{type: string, mode: string, evaluation_mode?: string}} exercise
 * @param {{conversationId?: string|null, inputMode?: string}} [context]
 */
/** Auswahl aus Optionen (Lese-/Hörverstehen, multiple_choice): nur erkannt, nicht produziert. */
export const RECOGNITION_TYPES = Object.freeze(["reading_comprehension", "listening_comprehension", "multiple_choice"]);

export function evidenceForExercise(exercise, { conversationId = null, inputMode = "text" } = {}) {
  if (conversationId || exercise.type === "conversation") return "spontaneous";
  if (RECOGNITION_TYPES.includes(exercise.type)) return "recognized";
  if (exercise.mode === "challenge") return inputMode === "speech" ? "spontaneous" : "free";
  if (exercise.evaluation_mode === "open") return "guided"; // Training: Struktur wird genannt
  return "controlled"; // Lückentext, Umformung, Wortschatzabfrage, Umformulierung
}

/**
 * Nachweisstufe einer einzelnen Beobachtung: Eine beiläufige Verwendung (incidental) in einer
 * geführten Aufgabe ist selbst gewählt, denn die Aufgabe nennt eine ANDERE Struktur. Sie zählt
 * deshalb als "free". Gegenstück: core/evaluation/evidence.py, Prüffälle:
 * shared/fixtures/evidence_levels.json.
 *
 * @param {string} base  Nachweisstufe der Übung (evidenceForExercise)
 * @param {string} observationKind
 */
export function evidenceForObservation(base, observationKind) {
  return observationKind === "incidental" && base === "guided" ? "free" : base;
}
