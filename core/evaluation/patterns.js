/**
 * Musterschreibweise (Pattern-Syntax v1) → Unicode-sichere JavaScript-RegExp.
 *
 * Gegenstück zu core/evaluation/patterns.py (Python-Referenz). Die Bedeutung ist
 * dort ausführlich beschrieben. Kurz:
 *   \b  Wortgrenze für Unicode-Buchstaben/-Ziffern (á é í ó ú ü ñ …)
 *   \w  ein Unicode-Buchstabe oder eine Ziffer
 *   \d  eine Ziffer 0–9
 *   %name%  eine Wortliste
 *
 * Gemeinsame Prüffälle: shared/fixtures/patterns.json.
 */

export const PATTERN_SYNTAX_VERSION = 1;

const LETTER_OR_DIGIT = "[\\p{L}\\p{N}]";
const WORD = LETTER_OR_DIGIT;
const BOUNDARY =
  `(?:(?<!${LETTER_OR_DIGIT})(?=${LETTER_OR_DIGIT})|(?<=${LETTER_OR_DIGIT})(?!${LETTER_OR_DIGIT}))`;
const DIGIT = "[0-9]";

const PLACEHOLDER = /%([a-z0-9_]+)%/g;
const SYNTAX_CHARS = new Set([..."^$\\.*+?()[]{}|/"]);
const QUANTIFIER = /^\{\d+(?:,\d*)?\}/;
const ALLOWED_GROUPS = ["(?:", "(?!", "(?=", "(?<!", "(?<="];

export class PatternError extends Error {
  constructor(message) {
    super(message);
    this.name = "PatternError";
  }
}

/**
 * @param {string} pattern
 * @param {Record<string, string[]>} lists
 * @returns {RegExp} mit den Flags g (alle Treffer) und u (Unicode)
 */
export function compilePattern(pattern, lists) {
  // Texte kommen NFC-normalisiert an (text.js: prepare); Muster und Wortlisten ebenso, sonst träfe ein
  // zerlegt geschriebenes "más" (a + Akzent) im Inhalt nie ein "más" im Text.
  const source = translate(expandPlaceholders(String(pattern).normalize("NFC"), lists));
  try {
    return new RegExp(source, "gu");
  } catch (error) {
    throw new PatternError(`ungültiges Muster ${JSON.stringify(pattern)}: ${error.message}`);
  }
}

export function expandPlaceholders(pattern, lists) {
  return pattern.replace(PLACEHOLDER, (_, name) => {
    if (!Object.hasOwn(lists, name)) {
      throw new PatternError(`unbekannte Wortliste %${name}% in Muster ${JSON.stringify(pattern)}`);
    }
    // Längere Formen zuerst; bei gleicher Länge bleibt die Reihenfolge erhalten (stabil wie in Python).
    const words = lists[name].map((word) => word.normalize("NFC")).sort((a, b) => b.length - a.length);
    return `(?:${words.map(escapeLiteral).join("|")})`;
  });
}

/** Maskiert nur Syntaxzeichen, damit das Ergebnis mit dem u-Flag gültig ist. */
export function escapeLiteral(word) {
  return [...word].map((char) => (SYNTAX_CHARS.has(char) ? `\\${char}` : char)).join("");
}

/** Übersetzt die Musterschreibweise in eine JavaScript-Quelle (prüft dabei die Regeln). */
export function translate(pattern) {
  const out = [];
  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "\\") {
      if (i + 1 >= pattern.length) throw new PatternError(`Muster ${JSON.stringify(pattern)} endet mit '\\'`);
      out.push(translateEscape(pattern[i + 1], inClass, pattern));
      i += 2;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "(" && pattern.startsWith("(?", i)) {
      if (!ALLOWED_GROUPS.some((group) => pattern.startsWith(group, i))) {
        throw new PatternError(
          `Muster ${JSON.stringify(pattern)}: nur (?:…), (?!…), (?=…), (?<!…), (?<=…) erlaubt`,
        );
      }
    } else if (char === "{" && !QUANTIFIER.test(pattern.slice(i))) {
      throw new PatternError(`Muster ${JSON.stringify(pattern)}: '{' nur als Quantor {m,n} erlaubt`);
    }
    out.push(char);
    i += 1;
  }
  if (inClass) throw new PatternError(`Muster ${JSON.stringify(pattern)}: Zeichenklasse wird nicht geschlossen`);
  return out.join("");
}

function translateEscape(escaped, inClass, pattern) {
  if ("wbd".includes(escaped)) {
    if (inClass) throw new PatternError(`Muster ${JSON.stringify(pattern)}: \\${escaped} ist innerhalb von […] nicht erlaubt`);
    return { w: WORD, b: BOUNDARY, d: DIGIT }[escaped];
  }
  if (SYNTAX_CHARS.has(escaped) || (inClass && escaped === "-")) return `\\${escaped}`;
  throw new PatternError(`Muster ${JSON.stringify(pattern)}: \\${escaped} ist in der Musterschreibweise nicht erlaubt`);
}
