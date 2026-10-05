/**
 * Lernzone (P12): Passt eine Übung oder ein neuer Skill zum aktuellen Können?
 *
 *   Können θ      aus dem Sprachprofil (Stufe je Kompetenzbereich, GER-Skala 1.0–6.99), nur mit mindestens
 *                 mittlerer Sicherheit. Ohne verlässliche Schätzung: keine Zone (neutral, nichts wird
 *                 ausgeschlossen); so erzeugt eine unsichere Einstufung keine Scheingenauigkeit.
 *   Schwierigkeit d  der Übung aus dem Inhaltspaket (taxonomy.py: Niveau + Stufe oder ausdrücklich, z. B.
 *                 B2.2 = 4.35); eines neuen Skills: Mitte seines Niveaus.
 *
 *   Abstand d − θ     Zone            Planer-Faktor (Übung)
 *   < −1.2            too_easy        −10 (nicht bei Fehlerfokus/Wiederholung: Reparatur darf leichter sein)
 *   −1.2 … < −0.4     known            −4
 *   −0.4 … ≤ +0.7     learning_zone    +8
 *   +0.7 … ≤ +1.3     challenging      +2
 *   > +1.3            too_difficult   −25
 *
 * Neue Skills (noch nie beobachtet) werden nur in der Lernzone oder knapp darüber eingeführt; zu leichte
 * (vermutlich beherrscht) und zu schwere (später) werden nicht als neu geplant und im Plan benannt.
 * Welcher Bereich zählt, hängt von der Übung ab (Gespräch → conversation, freie Antwort → production,
 * Lesen/Hören, sonst Grammatik/Wortschatz); ohne Schätzung dafür gilt das Gesamtniveau.
 */

import { evidenceForExercise } from "../competence/evidence.js";
import { evidenceAttempts, productionProfile, secureLevel } from "../competence/production.js";
import { levelValue } from "../profile/scale.js";
import { exerciseDimensions } from "../profile/needs.js";

export const ZONES = Object.freeze(["too_easy", "known", "learning_zone", "challenging", "too_difficult"]);
export const ZONE_RULES = Object.freeze({ tooEasyBelow: -1.2, knownBelow: -0.4, learningUpTo: 0.7, challengingUpTo: 1.3 });
export const ZONE_FACTORS = Object.freeze({ too_easy: -10, known: -4, learning_zone: 8, challenging: 2, too_difficult: -25 });
const RELIABLE = new Set(["medium", "high"]);
const DIMENSION_ORDER = ["conversation", "production", "reading", "listening", "grammar", "vocabulary"];

/**
 * Können je Bereich aus dem Sprachprofil (nur geschätzte Bereiche mit mindestens mittlerer Sicherheit).
 * @returns {{overall: number|null, by_dimension: Record<string, number>, basis: string}|null}
 */
export function abilityFromProfile(languageProfile) {
  if (!languageProfile) return null;
  const reliable = (x) => x?.status === "estimated" && RELIABLE.has(x.confidence) && Number.isFinite(x.theta);
  const byDimension = {};
  for (const [dimension, x] of Object.entries(languageProfile.dimensions ?? {})) {
    if (reliable(x)) byDimension[dimension] = round(x.theta);
  }
  const overall = reliable(languageProfile.overall) ? round(languageProfile.overall.theta) : null;
  if (overall === null && !Object.keys(byDimension).length) return null;
  return { overall, by_dimension: byDimension, basis: "language_profile (Sicherheit mindestens mittel)" };
}

export function exerciseDifficulty(exercise) {
  if (Number.isFinite(exercise.difficulty)) return exercise.difficulty;
  return exercise.level ? round(levelValue(exercise.level) + 0.5) : null;
}

/** Können, das für diese Übung zählt (Bereich der Übung, sonst Gesamtniveau). */
export function relevantAbility(exercise, ability) {
  if (!ability) return null;
  const dims = exerciseDimensions(exercise);
  for (const d of DIMENSION_ORDER) {
    if (dims.has(d) && Number.isFinite(ability.by_dimension[d])) return { theta: ability.by_dimension[d], dimension: d };
  }
  return ability.overall === null ? null : { theta: ability.overall, dimension: "overall" };
}

export function zoneOf(difficulty, theta) {
  if (!Number.isFinite(difficulty) || !Number.isFinite(theta)) return null;
  const delta = difficulty - theta;
  if (delta < ZONE_RULES.tooEasyBelow) return "too_easy";
  if (delta < ZONE_RULES.knownBelow) return "known";
  if (delta <= ZONE_RULES.learningUpTo) return "learning_zone";
  if (delta <= ZONE_RULES.challengingUpTo) return "challenging";
  return "too_difficult";
}

/** Zone einer Übung für diesen Lerner (null ohne verlässliche Schätzung); difficulty: z. B. kalibriert (P14B). */
export function exerciseZone(exercise, ability, difficulty = exerciseDifficulty(exercise)) {
  const relevant = relevantAbility(exercise, ability);
  const zone = relevant ? zoneOf(difficulty, relevant.theta) : null;
  return zone ? { zone, difficulty, theta: relevant.theta, dimension: relevant.dimension, delta: round(difficulty - relevant.theta) } : null;
}

/** Zone eines neuen Skills (Mitte seines Niveaus gegen das Gesamtniveau). */
export function skillZone(level, ability) {
  if (!level || !ability || ability.overall === null) return null;
  const difficulty = levelValue(level) + 0.5;
  return { zone: zoneOf(difficulty, ability.overall), difficulty, theta: ability.overall };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------- P14A: Lernzone je Aufgabe und Skill

/**
 * Zonenklassen (P14A). Die Lernzone ist nicht "Niveau ± fester Abstand": Zuerst zählt, was der Lerner mit genau
 * diesem Skill gezeigt hat (Produktionsprofil), erst ohne solche Evidenz der Bereich im Sprachprofil, und ohne
 * verlässliche Schätzung gar nichts.
 *
 *   mastery_zone   Stufe schon sicher belegt: Abruf, Festigen, Transfer (keine Lernaufgabe im engeren Sinn)
 *   learning_zone  knapp über dem Sicheren: die fehlende Stufe oder bis zur schon einmal gelungenen
 *   stretch        eine Stufe darüber (bzw. im Bereich "challenging"): bewusst gestreckt, begrenzt je Session
 *   below_zone     deutlich über dem belegten Bereich (der Lerner liegt darunter): nicht als Lernaufgabe
 *   evidence_gap   zu wenig Evidenz, um einzuordnen: KEIN Ausschluss, neutral (Unbekannt ist nicht schwach)
 *
 * Grundlage (basis):
 *   skill      ≥ 2 zählende Antworten zum Skill: Stufe der Aufgabe (Erkennen … spontan) gegen die höchste sichere
 *              Stufe S, die fehlende Stufe M, die höchste je gelungene H und die höchste je versuchte V (wer dort
 *              Fehler macht, lernt dort). Stufe ≤ S → mastery_zone; ≤ max(M, H, V, S + 1) → learning_zone; eine
 *              darüber → stretch; sonst below_zone.
 *   dimension  sonst die P12-Zone aus dem Sprachprofil (Sicherheit mindestens mittel, jetzt mit Breite):
 *              too_easy/known → mastery_zone, learning_zone, challenging → stretch, too_difficult → below_zone,
 *              außer bis STRETCH_UP_TO (2.0) über dem Können: stretch (eine GER-Stufe höher ist erlaubt, nicht
 *              zwei). Neue Skills führt der Planer weiter nur bis "challenging" (1.3) ein.
 *   none       sonst evidence_gap
 *
 * Beides zusammen: Die Skill-Grundlage entscheidet, aber bei Texten und Gesprächen kann eine verlässliche
 * Bereichs-Schätzung die Klasse höchstens bis "stretch" anheben (dieselbe Nachweisstufe ist in einem C1-Text
 * schwerer als in einem B1-Text, der Rest des Textes gehört zur Aufgabe). Im einzelnen Satz zählt nur der Skill.
 * Ausschließen (below_zone) kann nur die Skill-Evidenz selbst, nie eine Bereichs-Schätzung gegen belegtes Können.
 *
 * Kalibrierung (P14B, calibration/calibration.js): Ist die Aufgabe empirisch kalibriert, gilt ihre gemessene
 * Schwierigkeit statt des Handwerts ("effective"); sonst der Handwert (nicht kalibriert = normal planbar). Ist der
 * Skill sicher (Abruf), die Aufgabe aber kalibriert deutlich schwerer als das Können (> learningUpTo), wird sie
 * Stretch, auch im einzelnen Satz: Die Evidenz betrifft genau diese Aufgabe, nicht einen ganzen Bereich.
 *
 * Hören (P16): Zum Handwert kommt der Audio-Zuschlag (listening/model.js audioDifficulty: Tempo, Kontextlänge,
 * Sprecherzahl, bekannte Störgeräusche, für diesen Lerner schwacher Akzent; unbekannt = 0, höchstens 0,75). Ist die
 * Aufgabe kalibriert, gilt nur die gemessene Schwierigkeit (sie enthält das Audio schon). Das Können des Lerners
 * ändert der Zuschlag nie. Ein zusammenhängender Hörtext ist Kontext ("listening_context"), kein einzelner Satz.
 * Zonen in Worten: mastery_zone = Abruf (retrieval), learning_zone = Lernen, stretch, below_zone = zu weit (too_far),
 * evidence_gap = Evidenzlücke.
 */

export const ZONE_CLASSES = Object.freeze(["mastery_zone", "learning_zone", "stretch", "below_zone", "evidence_gap"]);
export const ZONE_CLASS_FACTORS = Object.freeze({ mastery_zone: -6, learning_zone: 8, stretch: 2, below_zone: -25, evidence_gap: 0 });
const DIMENSION_CLASS = Object.freeze({
  too_easy: "mastery_zone", known: "mastery_zone", learning_zone: "learning_zone", challenging: "stretch", too_difficult: "below_zone",
});
const LADDER = ["recognized", "controlled", "guided", "free", "spontaneous"];
const RETRIEVAL_PURPOSES = new Set(["review", "challenge"]);
const REPAIR_PURPOSES = new Set(["error_focus", "review", "consolidate"]);
const MIN_SKILL_ATTEMPTS = 2;
export const STRETCH_UP_TO = 2.0;

function dimensionClass(dimension) {
  if (dimension.zone === "too_difficult" && dimension.delta <= STRETCH_UP_TO) return "stretch";
  return DIMENSION_CLASS[dimension.zone];
}

/** Was ein Skill belegt hat (null: zu wenig, dann entscheidet der Bereich). */
export function skillLadder(skill) {
  if (!skill?.evidence || evidenceAttempts(skill) < MIN_SKILL_ATTEMPTS) return null;
  return {
    secure: secureLevel(skill),
    next: productionProfile(skill).missing_evidence,
    highest: skill.highest_success_evidence ?? null,
    attempted: [...LADDER].reverse().find((l) => (skill.evidence[l]?.successes ?? 0) + (skill.evidence[l]?.failures ?? 0) > 0) ?? null,
  };
}

/**
 * Schwierigkeit in vier Teilen: Inhalt (Niveau des Stoffs), Aufgabe (Niveau + Aufgabenstufe, taxonomy.py),
 * Produktion (Nachweisstufe: erkennen … spontan) und Kontext (Satz, Text, langer Text, Gespräch). Dieselbe
 * Kollokation ist im Lückensatz leichter als in einer freien Argumentation und dort leichter als im Gespräch.
 */
export function difficultyProfile(exercise, audio = null) {
  const evidence = evidenceForExercise(exercise);
  const context = evidence === "spontaneous" ? "conversation"
    : audio?.features?.scope === "context" ? "listening_context"
      : exercise.evaluation_mode !== "open" ? "sentence" : (exercise.min_words ?? 0) >= 100 ? "long_text" : "text";
  return {
    content: exercise.level ? round(levelValue(exercise.level) + 0.5) : null,
    task: exerciseDifficulty(exercise),
    production: evidence,
    context,
    audio: audio ? { offset: audio.offset, parts: audio.parts, unknown: audio.unknown, accent_status: audio.accent_status } : null,
  };
}

/**
 * Zone einer Aufgabe für einen Bedarf.
 * @param {object} exercise
 * @param {{ladder?: object|null, ability?: object|null, purpose?: string}} context
 */
export function taskZone(exercise, { ladder = null, ability = null, purpose = null, item = null, audio = null } = {}) {
  const calibrated = item?.calibration_status === "calibrated";
  const prior = exerciseDifficulty(exercise);
  const withAudio = Number.isFinite(prior) && audio?.offset ? round(prior + audio.offset) : prior;
  const dimension = exerciseZone(exercise, ability, calibrated ? item.effective : withAudio);
  const difficulty = difficultyProfile(exercise, audio);
  let zoneClass;
  let basis;
  let factor;
  let reason;
  if (ladder) {
    const rank = LADDER.indexOf(difficulty.production);
    const secure = ladder.secure ? LADDER.indexOf(ladder.secure) : -1;
    const at = (level) => (level ? LADDER.indexOf(level) : -1);
    const reach = Math.max(ladder.next ? at(ladder.next) : LADDER.length - 1, at(ladder.highest), at(ladder.attempted), secure + 1);
    zoneClass = rank <= secure ? "mastery_zone" : rank <= reach ? "learning_zone" : rank === reach + 1 ? "stretch" : "below_zone";
    basis = "skill";
    const content = dimension && difficulty.context !== "sentence" ? dimensionClass(dimension) : null;
    const order = ["mastery_zone", "learning_zone", "stretch", "below_zone"];
    if (content && order.indexOf(content) > order.indexOf(zoneClass)) {
      const raised = order[Math.min(order.indexOf(content), order.indexOf("stretch"))];
      if (order.indexOf(raised) > order.indexOf(zoneClass)) {
        zoneClass = raised;
        basis = "skill+dimension";
      }
    }
    if (calibrated && zoneClass === "mastery_zone" && dimension && dimension.delta > ZONE_RULES.learningUpTo) {
      zoneClass = "stretch";
      basis = "skill+calibration";
    }
    factor = zoneClass === "mastery_zone" && RETRIEVAL_PURPOSES.has(purpose) ? 0 : ZONE_CLASS_FACTORS[zoneClass];
    reason = `Skill sicher bis '${ladder.secure ?? "–"}', fehlt '${ladder.next ?? "–"}', Aufgabe '${difficulty.production}'`
      + (basis === "skill+dimension" ? `; Inhalt ${dimension.difficulty} über Können ${dimension.theta} (${dimension.dimension})` : "")
      + (basis === "skill+calibration" ? `; Aufgabe kalibriert ${dimension.difficulty} über Können ${dimension.theta}` : "");
  } else if (dimension) {
    zoneClass = dimensionClass(dimension);
    basis = "dimension";
    factor = dimension.zone === "too_easy" && REPAIR_PURPOSES.has(purpose) ? 0
      : zoneClass === "stretch" ? ZONE_CLASS_FACTORS.stretch : ZONE_FACTORS[dimension.zone];
    reason = `Schwierigkeit ${dimension.difficulty}, Können ${dimension.theta} in ${dimension.dimension}`
      + (!calibrated && audio?.offset ? ` (davon Audio +${audio.offset}: ${audio.parts.map((p) => `${p.dimension} ${p.band}`).join(", ")})` : "");
  } else {
    zoneClass = "evidence_gap";
    basis = "none";
    factor = 0;
    reason = "keine verlässliche Schätzung: neutral";
  }
  if (audio?.accent_status === "unfamiliar") reason += "; Akzent für diesen Lerner neu: Evidenzlücke, nicht schwerer";
  return {
    difficulty_source: calibrated ? "calibrated" : audio?.offset ? "prior+audio" : "prior",
    zone: dimension?.zone ?? null, // P12-Zone (Bereich), zur Information
    zone_class: zoneClass,
    basis,
    factor,
    reason,
    difficulty,
    dimension: dimension?.dimension ?? null,
    theta: dimension?.theta ?? null,
    delta: dimension?.delta ?? null,
  };
}
