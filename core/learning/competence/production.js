/**
 * Produktionsprofil eines Skills (P13): Erkennen ist nicht Können.
 *
 *   Dimension                Nachweisstufe   typische Aufgabe
 *   recognition              recognized      Auswahl, Erkennen
 *   controlled_production    controlled      Lücke, Umformung, Fehlerkorrektur
 *   guided_production        guided          Satz/Text mit genannter Struktur (Training)
 *   free_production          free            offene Aufgabe, Ziel verdeckt (Challenge)
 *   spontaneous_production   spontaneous     Gespräch (getippt oder gesprochen)
 *
 * Status je Dimension (aus den gewichteten Erfolgen/Fehlern der Stufe, dieselben Zahlen wie snapshot.evidence):
 *   not_observed   keine Antwort auf dieser Stufe
 *   insufficient   zu wenig Antworten für ein Urteil (< PRODUCTION_RULES.minAttempts)
 *   weak           Quote < weakRate
 *   developing     dazwischen
 *   secure         ≥ sureMin Erfolge und Quote ≥ sureRate
 *
 * Produktionslücke (gap): eine Stufe sicher, die nächste darüber schwach. Geprüft von unten nach oben, die
 * unterste Lücke zählt (erst das Fundament):
 *   recognized sicher               → controlled+guided schwach       ("erkennt es, bildet es nicht")
 *   controlled+guided sicher        → free+spontaneous schwach        ("unter Kontrolle ja, frei nein")
 *   free sicher                     → spontaneous schwach             ("schriftlich ja, im Gespräch nein")
 * Dieselben Schwellen wie weakStep in planning/needs.js (sicher ≥ 3 Erfolge und ≥ 80 %, schwach ≥ 2 Versuche
 * und < 60 %), damit Bedarf und Profil dasselbe sagen.
 *
 * missing_evidence: Welche Art Nachweis fehlt als Nächstes? Die schwache Stufe einer Lücke; sonst die unterste
 * Produktionsstufe (controlled, free, spontaneous), die noch nicht sicher belegt ist; sonst null. Erkennen allein führt
 * nie über "controlled" hinaus: Ohne Produktion fehlt immer Produktion.
 *
 * Rein und deterministisch; arbeitet für alle Skill-Arten (bei typischen Fehlern heißt Erfolg: vermieden).
 */

export const PRODUCTION_DIMENSIONS = Object.freeze({
  recognition: "recognized",
  controlled_production: "controlled",
  guided_production: "guided",
  free_production: "free",
  spontaneous_production: "spontaneous",
});

export const PRODUCTION_RULES = Object.freeze({
  minAttempts: 2,
  sureMin: 3,
  sureRate: 0.8,
  weakRate: 0.6,
});

const STEPS = Object.freeze([
  { from: "recognized", strong: ["recognized"], to: "controlled", weak: ["controlled", "guided"] },
  { from: "controlled", strong: ["controlled", "guided"], to: "free", weak: ["free", "spontaneous"] },
  { from: "free", strong: ["free"], to: "spontaneous", weak: ["spontaneous"] },
]);
const NEXT_PRODUCTION = Object.freeze([
  ["controlled", ["controlled", "guided"]],
  ["free", ["free", "spontaneous"]],
  ["spontaneous", ["spontaneous"]],
]);

/**
 * @param {object} skill  Eintrag aus snapshot.skills (evidence je Stufe, last_evidence_at je Stufe)
 * @returns {{dimensions: Record<string, {evidence: string, successes: number, attempts: number, rate: number|null,
 *   status: string, last_at: string|null}>, gap: null|{from: string, to: string, strong_rate: number, weak_rate: number,
 *   label: string}, missing_evidence: string|null, basis: string}}
 */
export function productionProfile(skill) {
  const dimensions = {};
  for (const [name, level] of Object.entries(PRODUCTION_DIMENSIONS)) {
    const s = pooled(skill, [level]);
    dimensions[name] = { evidence: level, ...s, status: statusOf(s), last_at: skill.last_evidence_at?.[level] ?? null };
  }
  const gap = productionGap(skill);
  let missing = gap?.to ?? null;
  let basis = gap ? gap.label : null;
  if (!missing) {
    const next = NEXT_PRODUCTION.find(([, levels]) => !isSure(pooled(skill, levels)));
    if (next) {
      missing = next[0];
      basis = `auf Stufe '${next[0]}' noch nicht sicher belegt`;
    }
  }
  return { dimensions, gap, missing_evidence: missing, basis: basis ?? "alle Stufen belegt" };
}

/**
 * Höchste sicher belegte Stufe (P14A, für die Lernzone): recognized, controlled (kontrolliert + gelenkt), free,
 * spontaneous; null, wenn keine Stufe sicher ist.
 */
export function secureLevel(skill) {
  const groups = [["recognized", ["recognized"]], ["controlled", ["controlled", "guided"]], ["free", ["free"]], ["spontaneous", ["spontaneous"]]];
  let secure = null;
  for (const [level, levels] of groups) if (isSure(pooled(skill, levels))) secure = level;
  return secure;
}

/** Zählende Antworten über alle Stufen. */
export function evidenceAttempts(skill) {
  return pooled(skill, ["recognized", "controlled", "guided", "free", "spontaneous"]).attempts;
}

/** Unterste Produktionslücke (eine Stufe sicher, die nächste schwach) oder null. */
export function productionGap(skill) {
  for (const step of STEPS) {
    const strong = pooled(skill, step.strong);
    const weak = pooled(skill, step.weak);
    if (isSure(strong) && isWeak(weak)) {
      return {
        from: step.from,
        to: step.to,
        strong_rate: strong.rate,
        weak_rate: weak.rate,
        label: `'${step.from}' sicher (${percent(strong.rate)}), '${step.to}' schwach (${percent(weak.rate)})`,
      };
    }
  }
  return null;
}

function pooled(skill, levels) {
  let successes = 0;
  let failures = 0;
  for (const level of levels) {
    successes += skill.evidence?.[level]?.successes ?? 0;
    failures += skill.evidence?.[level]?.failures ?? 0;
  }
  const attempts = round(successes + failures);
  return { successes: round(successes), attempts, rate: attempts > 0 ? round(successes / attempts) : null };
}

function isSure(s) {
  return s.successes >= PRODUCTION_RULES.sureMin && s.rate >= PRODUCTION_RULES.sureRate;
}

function isWeak(s) {
  return s.attempts >= PRODUCTION_RULES.minAttempts && s.rate < PRODUCTION_RULES.weakRate;
}

function statusOf(s) {
  if (s.attempts === 0) return "not_observed";
  if (isSure(s)) return "secure";
  if (s.attempts < PRODUCTION_RULES.minAttempts) return "insufficient";
  return s.rate < PRODUCTION_RULES.weakRate ? "weak" : "developing";
}

function percent(rate) {
  return `${Math.round((rate ?? 0) * 100)} %`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
