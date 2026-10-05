/**
 * Textaufbereitung für Vergleiche und Regel-Erkennung.
 *
 * Gegenstück zu core/text.py (Python-Referenz). Beide müssen exakt dieselben
 * Ergebnisse liefern; geprüft über shared/fixtures/text_normalization.json.
 *
 * - normalize(): für Vergleiche. Kleinbuchstaben, ohne Satzzeichen, einfache
 *   Leerzeichen. Akzente bleiben erhalten.
 * - prepare(): für Regel-Muster. Satzzeichen werden zur Grenze " | ", damit ein
 *   Muster nicht über Satzgrenzen hinweg greift. Merkt sich die Herkunft jedes
 *   Zeichens, um Fundstellen im Originaltext zu zitieren.
 *
 * Jeder Text wird zuerst in Unicode-NFC gebracht.
 */

export const BOUNDARY = "|";

const BOUNDARY_CHARS = new Set([...".,;:!?¿¡()[]{}\"«»“”…"]);
// Akzentzeichen (kombinierend) je Name; welche als "nur Akzent" gelten, bestimmt die Sprache (language.accent_marks,
// wie core/text.py). Standard wie bisher Spanisch: Akut und Trema; die Tilde des ñ bleibt.
export const ACCENT_MARK_NAMES = Object.freeze({
  acute: "́", grave: "̀", circumflex: "̂", diaeresis: "̈", cedilla: "̧", tilde: "̃",
});
const DEFAULT_ACCENT_MARKS = ["acute", "diaeresis"];
const markPattern = (marks) => new RegExp(`[${marks.map((m) => ACCENT_MARK_NAMES[m]).join("")}]`, "gu");
const ACCENT_MARKS = markPattern(DEFAULT_ACCENT_MARKS);
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/**
 * @typedef {object} PreparedText
 * @property {string} original   NFC-normalisierter Originaltext
 * @property {string} value      aufbereiteter Text
 * @property {number[]} positions value[i] stammt aus original an Position positions[i]
 */

/** @returns {PreparedText & {words(): string[], excerpt(start: number, end: number): string}} */
export function prepare(text) {
  const original = String(text).normalize("NFC");
  const chars = [];
  const positions = [];

  const push = (char, position) => {
    if (char === " " && (chars.length === 0 || chars[chars.length - 1] === " ")) return;
    if (char === BOUNDARY && chars.slice(-2).includes(BOUNDARY)) return;
    chars.push(char);
    positions.push(position);
  };

  let position = 0;
  for (const char of original) {
    const lower = char.toLowerCase();
    if ([...lower].length === 1 && LETTER_OR_DIGIT.test(lower)) {
      push(lower, position);
    } else if (BOUNDARY_CHARS.has(char)) {
      push(" ", position);
      push(BOUNDARY, position);
      push(" ", position);
    } else {
      push(" ", position);
    }
    position += char.length; // UTF-16-Länge, passend zu String-Indizes
  }

  let start = 0;
  let end = chars.length;
  while (start < end && (chars[start] === " " || chars[start] === BOUNDARY)) start += 1;
  while (end > start && (chars[end - 1] === " " || chars[end - 1] === BOUNDARY)) end -= 1;

  // Ein Buchstabe kann mehrere UTF-16-Einheiten belegen; value wird zeichenweise
  // aufgebaut, daher werden Positionen pro UTF-16-Einheit von value geführt.
  const valueChars = chars.slice(start, end);
  const valuePositions = [];
  const originalEnds = [];
  valueChars.forEach((char, i) => {
    const pos = positions[start + i];
    for (let unit = 0; unit < char.length; unit += 1) {
      valuePositions.push(pos);
      originalEnds.push(pos + (original.codePointAt(pos) > 0xffff ? 2 : 1));
    }
  });
  const value = valueChars.join("");

  return {
    original,
    value,
    positions: valuePositions,
    words() {
      return value.split(" ").filter((word) => word !== "" && word !== BOUNDARY);
    },
    excerpt(from, to) {
      if (to <= from) return "";
      return original.slice(valuePositions[from], originalEnds[to - 1]);
    },
    /**
     * Bereich in `original` zu einem Bereich in `value`, gezählt in Unicode-Zeichen (Codepoints)
     * wie in Python (core/text.py: original_span), nicht in UTF-16-Einheiten. null bei leerem Bereich.
     * @returns {[number, number] | null}
     */
    originalSpan(from, to) {
      if (to <= from) return null;
      return [codePoints(original, valuePositions[from]), codePoints(original, originalEnds[to - 1])];
    },
    /** Jedes Wort mit seinem Bereich in `value` (wie core/text.py: word_spans). */
    wordSpans() {
      const result = [];
      let start = null;
      const padded = `${value} `;
      for (let i = 0; i < padded.length; i += 1) {
        const separator = padded[i] === " " || padded[i] === BOUNDARY;
        if (!separator && start === null) start = i;
        else if (separator && start !== null) {
          result.push([value.slice(start, i), start, i]);
          start = null;
        }
      }
      return result;
    },
  };
}

/** Anzahl der Unicode-Zeichen in text[0, utf16Index). */
function codePoints(text, utf16Index) {
  let count = 0;
  for (let i = 0; i < utf16Index; i += 1) {
    const unit = text.charCodeAt(i);
    if (!(unit >= 0xdc00 && unit <= 0xdfff && i > 0 && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff)) count += 1;
  }
  return count;
}

/** Länge in Unicode-Zeichen (wie len() in Python). */
export function codePointLength(text) {
  return [...String(text)].length;
}

/** Kleinbuchstaben, ohne Satzzeichen, einfache Leerzeichen (Akzente bleiben erhalten). */
export function normalize(text) {
  return prepare(text).words().join(" ");
}

/** Entfernt Akzente (Standard: á → a, ü → u; ñ bleibt). marks: Namen aus ACCENT_MARK_NAMES (Sprache). */
export function stripAccents(text, marks = null) {
  const pattern = marks === null ? ACCENT_MARKS : marks.length ? markPattern(marks) : null;
  const decomposed = String(text).normalize("NFC").normalize("NFD");
  return (pattern ? decomposed.replace(pattern, "") : decomposed).normalize("NFC");
}

/** Leerraum wie Pythons str.isspace() (für strip-Parität mit der Python-Referenz). */
const PYTHON_STRIP = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;

/** Wie Pythons str.strip(): entfernt Leerraum am Anfang und Ende (nicht dasselbe wie String.trim()). */
export function pythonStrip(text) {
  return String(text).replace(PYTHON_STRIP, "");
}
