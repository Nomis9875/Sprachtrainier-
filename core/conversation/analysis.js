/**
 * Conversation Engine · Analyse einer Antwort: WAS hat der Lerner gesagt (nicht: wie richtig)?
 *
 *   Antworttext ─▶ Gesprächsschritte (Diskursmarker des Ziels), Aspekte (Argumente des Szenarios),
 *                  Signale (unsicher, Widerspruch, Abwägen), Länge
 *
 * Die Richtigkeit bewertet allein evaluateAnswer (EvaluationResult v2). Diese Analyse erzeugt keine
 * Lernbeobachtungen, keine Fehler und keine Kompetenz: Sie ist kurzfristiger Gesprächszustand und
 * steuert nur, was der Gesprächspartner als Nächstes sagt. Sie nutzt dieselbe Musterschreibweise und
 * Textaufbereitung wie die Bewertung (prepare, Detector), die Muster stehen im Inhalt.
 *
 * evaluationSignal() liest aus dem vorhandenen EvaluationResult nur zwei Zahlen für die Gesprächs-
 * schwierigkeit (blockierende Befunde, gezeigte Strukturen); es bewertet nichts neu.
 */

import { Detector } from "../evaluation/detector.js";
import { BLOCKING_SEVERITIES, readEvaluation } from "../evaluation/result.js";
import { prepare } from "../evaluation/text.js";

export const ANALYSIS_RULES = Object.freeze({
  short_words: 8, // weniger Wörter: knappe Antwort
  long_words: 45, // ab so vielen Wörtern: ausführlich
  long_words_with_moves: 30, // … oder ab 30 Wörtern mit mindestens zwei Gesprächsschritten
});

const COMPILED = new WeakMap();

/** Kompilierte Detektoren eines Szenarios (einmal je Bibliothek und Szenario). */
function compiled(library, scenario) {
  let perLibrary = COMPILED.get(library);
  if (!perLibrary) {
    perLibrary = new Map();
    COMPILED.set(library, perLibrary);
  }
  let entry = perLibrary.get(scenario.id);
  if (!entry) {
    const goal = library.conversationGoal(scenario.goal);
    const make = (spec) => (spec ? new Detector(spec, library.lists) : null);
    entry = {
      moves: goal.moves.map((m) => ({ id: m.id, detector: make(m.detector) })),
      aspects: scenario.aspects.map((a) => ({ id: a.id, detector: make(a.detector) })),
      signals: Object.fromEntries(library.conversationSignals().map((s) => [s.id, make(s.detector)])),
    };
    perLibrary.set(scenario.id, entry);
  }
  return entry;
}

/**
 * @param {{library: object, scenario: object, text: string}} input
 * @returns {{words: number, moves: string[], aspects: string[], uncertain: boolean, disagree: boolean,
 *   weigh: boolean, pros_cons: boolean, short: boolean, long: boolean, off_topic: boolean, asks_question: boolean}}
 */
export function analyzeAnswer({ library, scenario, text }) {
  const detectors = compiled(library, scenario);
  const prepared = prepare(text);
  const words = prepared.words().length;
  const hit = (detector) => Boolean(detector?.matches(prepared));
  const moves = detectors.moves.filter((m) => hit(m.detector)).map((m) => m.id);
  const aspects = detectors.aspects.filter((a) => hit(a.detector)).map((a) => a.id);
  const uncertain = hit(detectors.signals.uncertain);
  const disagree = hit(detectors.signals.disagree);
  const weigh = hit(detectors.signals.weigh);
  const sides = new Set(aspects.map((id) => scenario.aspects.find((a) => a.id === id).side));
  return {
    words,
    moves,
    aspects,
    uncertain,
    disagree,
    weigh,
    pros_cons: weigh || (sides.has("pro") && sides.has("contra")),
    short: words < ANALYSIS_RULES.short_words,
    long: words >= ANALYSIS_RULES.long_words || (words >= ANALYSIS_RULES.long_words_with_moves && moves.length >= 2),
    off_topic: words >= ANALYSIS_RULES.short_words && !moves.length && !aspects.length && !uncertain,
    asks_question: String(text).includes("?"),
  };
}

/** Zwei Kennzahlen aus der vorhandenen Bewertung (autoritativ, ohne KI) für die Gesprächsschwierigkeit. */
export function evaluationSignal(evaluation) {
  const view = readEvaluation(evaluation);
  return {
    blocking: view.findings.filter((f) => f.authoritative && BLOCKING_SEVERITIES.includes(f.severity)).length,
    demonstrated: view.observations.filter((o) => o.authoritative && o.outcome === "demonstrated").length,
  };
}
