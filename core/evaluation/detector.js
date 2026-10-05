/**
 * Regel-Detektor: wendet die Muster einer Regel auf einen aufbereiteten Text an.
 *
 * Gegenstück zu core/evaluation/detectors.py (Python-Referenz):
 * - Treffer, die sich mit einem `unless`-Treffer überschneiden, werden verworfen.
 * - Überlappende Treffer zählen nur einmal (der früheste gewinnt).
 * - Grundsatz: lieber etwas übersehen als falsch anschlagen.
 */

import { compilePattern } from "./patterns.js";

/**
 * @typedef {{patterns: string[], unless?: string[]}} DetectorSpec
 * @typedef {{start: number, end: number, excerpt: string}} Hit
 */

export class Detector {
  /**
   * @param {DetectorSpec} spec
   * @param {Record<string, string[]>} lists
   */
  constructor(spec, lists) {
    this.patterns = spec.patterns.map((pattern) => compilePattern(pattern, lists));
    this.unless = (spec.unless ?? []).map((pattern) => compilePattern(pattern, lists));
  }

  /**
   * @param {ReturnType<import("./text.js").prepare>} text
   * @returns {Hit[]}
   */
  find(text) {
    const blocked = this.unless.flatMap((regex) => spans(regex, text.value));
    const unique = new Map();
    for (const regex of this.patterns) {
      for (const span of spans(regex, text.value)) {
        if (span[1] > span[0] && !blocked.some((b) => overlaps(span, b))) {
          unique.set(`${span[0]}:${span[1]}`, span);
        }
      }
    }
    const sorted = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hits = [];
    let lastEnd = -1;
    for (const [start, end] of sorted) {
      if (start >= lastEnd) {
        hits.push({ start, end, excerpt: text.excerpt(start, end) });
        lastEnd = end;
      }
    }
    return hits;
  }

  matches(text) {
    return this.find(text).length > 0;
  }
}

function spans(regex, value) {
  return [...value.matchAll(regex)].map((match) => [match.index, match.index + match[0].length]);
}

function overlaps(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}
