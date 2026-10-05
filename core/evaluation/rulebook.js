/**
 * Alle Regel-Detektoren der Inhalte, einmal kompiliert und bereit zur Anwendung.
 *
 * Gegenstück zu core/evaluation/rulebook.py (Python-Referenz). Gleiche Reihenfolge, gleiche
 * Rückmeldungstexte, gleiche Textstellen: geprüft über shared/fixtures/evaluation_parity.json.
 * Quelle ist allein das Inhaltspaket (ContentLibrary); kein Netzwerk, kein Dateisystem.
 */

import { Detector } from "./detector.js";
import { BOUNDARY, codePointLength } from "./text.js";

export const GERMAN_INTERFERENCE_TOPIC = "interference.german";
export const REPETITION_MIN_COUNT = 3;
export const REPETITION_MIN_WORD_LENGTH = 4;

/**
 * Ein Befund zu einer Antwort (Gegenstück: core/evaluation/findings.py).
 * @typedef {{kind: string, original: string, suggestion: string, explanation_de: string,
 *   topic_id: string|null, source: string, error_id: string|null, rule_id: string|null,
 *   item_id: string|null, span: [number, number]|null}} Finding
 */
export function finding(kind, { original, suggestion, explanation_de: explanation, topic_id: topic = null, source = "rule",
  error_id: errorId = null, rule_id: ruleId = null, item_id: itemId = null, span = null }) {
  return {
    kind, original, suggestion, explanation_de: explanation, topic_id: topic, source,
    error_id: errorId, rule_id: ruleId, item_id: itemId, span,
  };
}

export class Rulebook {
  /** @param {import("../content/library.js").ContentLibrary} library */
  constructor(library) {
    const lists = library.lists;
    this._rules = new Map(library.grammarRules().map((rule) => [rule.id, rule]));
    this._errors = new Map(library.commonErrors().map((error) => [error.id, error]));
    this._items = new Map(library.lexicalItems().map((item) => [item.id, item]));
    this._errorDetectors = library.commonErrors().map((error) => [error, new Detector(error.wrong, lists)]);
    this._correctDetectors = library.commonErrors().filter((e) => hasPatterns(e.correct)).map((e) => [e, new Detector(e.correct, lists)]);
    this._ruleDetectors = new Map(library.grammarRules().filter((r) => hasPatterns(r.detector)).map((r) => [r.id, new Detector(r.detector, lists)]));
    this._ruleContexts = new Map(library.grammarRules().filter((r) => hasPatterns(r.context)).map((r) => [r.id, new Detector(r.context, lists)]));
    this._itemDetectors = new Map(library.lexicalItems().map((item) => [item.id, new Detector(item.detector, lists)]));
    this._simplePhrases = groupSimplePhrases(library.lexicalItems(), lists);
    this._germanWords = new Set(lists.german_words ?? []);
    this._germanismTemplate = library.language?.germanism_explanation_de ?? "";
    this.accentMarks = library.language?.accent_marks ?? null; // P20: Akzenttoleranz der Sprache
    this._stopwords = new Set(lists.stopwords ?? []);
  }

  rule(ruleId) {
    return required(this._rules, ruleId, "Struktur");
  }

  error(errorId) {
    return required(this._errors, errorId, "typischer Fehler");
  }

  item(itemId) {
    return required(this._items, itemId, "Ausdruck");
  }

  /** Alle Strukturen (nach ID sortiert). */
  rules() {
    return [...this._rules.keys()].sort().map((id) => this._rules.get(id));
  }

  /** Alle Ausdrücke (nach ID sortiert). */
  itemIds() {
    return [...this._items.keys()].sort();
  }

  /** Alle bekannten typischen Fehler, unabhängig von der Übung. */
  findErrors(text) {
    return this._errorDetectors.flatMap(([error, detector]) =>
      detector.find(text).map((hit) => errorFinding(error, hit.excerpt, text.originalSpan(hit.start, hit.end))));
  }

  /** IDs typischer Fehler, deren richtige Form in der Antwort vorkommt. */
  correctUses(text) {
    return this._correctDetectors.filter(([, detector]) => detector.matches(text)).map(([error]) => error.id);
  }

  /**
   * Wurde die Struktur verwendet? true = sicher erkannt, false = sicher nicht verwendet,
   * null = per Regel nicht entscheidbar (kein Detektor, oder Kontext da, Form unbekannt).
   */
  ruleUsed(ruleId, text) {
    const detector = this._ruleDetectors.get(ruleId);
    if (!detector) return null;
    if (detector.matches(text)) return true;
    const context = this._ruleContexts.get(ruleId);
    if (context && context.matches(text)) return null;
    return false;
  }

  itemsUsed(text, itemIds) {
    return [...itemIds].filter((itemId) => required(this._itemDetectors, itemId, "Ausdruck").matches(text));
  }

  /**
   * Deutsche Wörter im Text. Großgeschrieben mitten im Satz ist es ein Name ("se llama Gut"),
   * am Anfang eines Satzes oder Satzteils ein Germanismus ("Die ganze Zeit …").
   */
  findGermanisms(text) {
    const spans = text.wordSpans().filter(([word, start]) => this._germanWords.has(word) && !isName(text, start));
    const found = [...new Set(spans.map(([word]) => word))];
    if (!found.length) return [];
    const quoted = found.map((word) => `„${word}“`).join(", ");
    return [finding("GERMANISM", {
      original: found[0],
      suggestion: "",
      explanation_de: this._germanismTemplate.replace("{words}", quoted),
      topic_id: GERMAN_INTERFERENCE_TOPIC,
      span: text.originalSpan(spans[0][1], spans[0][2]),
    })];
  }

  findRepetitions(text) {
    const counts = new Map();
    for (const word of text.words()) {
      if (codePointLength(word) >= REPETITION_MIN_WORD_LENGTH && !this._stopwords.has(word) && !/^\p{Nd}+$/u.test(word)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    const first = new Map();
    for (const [word, start, end] of text.wordSpans()) if (!first.has(word)) first.set(word, [start, end]);
    // wie Counter.most_common(): nach Anzahl absteigend, bei Gleichstand in Reihenfolge des ersten Auftretens
    return [...counts.entries()]
      .map(([word, count], index) => ({ word, count, index }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .filter(({ count }) => count >= REPETITION_MIN_COUNT)
      .map(({ word, count }) => finding("REPETITION", {
        original: word,
        suggestion: "",
        explanation_de: `„${word}“ kommt ${count}× vor. Variiere mit Synonymen, Pronomen oder einer Umformulierung.`,
        span: text.originalSpan(...first.get(word)),
      }));
  }

  findSimplePhrases(text) {
    return this.findSimplePhraseGroups(text).map((group) => group.finding);
  }

  /** Wie findSimplePhrases, zusätzlich mit ALLEN vorgeschlagenen Ausdrücken je Hinweis. */
  findSimplePhraseGroups(text) {
    const groups = [];
    for (const { items, detector } of this._simplePhrases) {
      const hits = detector.find(text);
      const threshold = Math.min(...items.map((item) => item.simpler_min_count ?? 1));
      if (!hits.length || hits.length < threshold) continue;
      const phrase = hits[0].excerpt;
      const intro = threshold > 1
        ? `Du verwendest „${phrase}“ ${hits.length}×. Für mehr Abwechslung:`
        : `„${phrase}“ ist korrekt, aber recht einfach. Präziser:`;
      const options = items.map((item) => `${item.text_es} (${item.meaning_de})`).join("; ");
      groups.push({
        items,
        finding: finding("CORRECT_BUT_SIMPLE", {
          original: phrase,
          suggestion: items.map((item) => item.text_es).join(" / "),
          explanation_de: `${intro} ${options}.`,
          topic_id: items[0].topic_id,
          item_id: items[0].id,
          span: text.originalSpan(hits[0].start, hits[0].end),
        }),
      });
    }
    return groups;
  }
}

export function errorFinding(error, excerpt, span = null) {
  return finding(error.kind, {
    original: excerpt,
    suggestion: error.suggestion_es,
    explanation_de: error.explanation_de,
    topic_id: error.topic_id,
    error_id: error.id,
    span,
  });
}

/** Ausdrücke mit denselben "einfacheren" Mustern werden zu einem Hinweis zusammengefasst. */
function groupSimplePhrases(items, lists) {
  const groups = new Map();
  for (const item of items) {
    if (!(item.simpler ?? []).length) continue;
    const key = JSON.stringify(item.simpler);
    if (!groups.has(key)) groups.set(key, { patterns: item.simpler, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map(({ patterns, items: group }) => ({ items: group, detector: new Detector({ patterns }, lists) }));
}

/** Großgeschriebenes Wort, das nicht am Anfang eines Satzes oder Satzteils steht. */
function isName(text, start) {
  const first = String.fromCodePoint(text.original.codePointAt(text.positions[start]));
  if (!(first === first.toUpperCase() && first !== first.toLowerCase())) return false;
  const before = text.value.slice(0, start).trimEnd();
  return before !== "" && !before.endsWith(BOUNDARY);
}

function hasPatterns(detector) {
  return Array.isArray(detector?.patterns) && detector.patterns.length > 0;
}

function required(map, id, label) {
  const value = map.get(id);
  if (value === undefined) throw new RangeError(`Unbekannte(r) ${label}: ${id}`);
  return value;
}
