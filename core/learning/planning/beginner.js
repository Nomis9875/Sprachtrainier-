/**
 * Anfängerschutz (P25.5): A0 bis frühes B1 sollen zugänglich sein, ohne höhere Stufen zu verändern.
 *
 *   Vorläufiges Können   Ohne verlässliche Schätzung (Sprachprofil mit mindestens mittlerer Sicherheit) plante der
 *                        Planer ohne Lernzone, also über alle Stufen bis C2. Jetzt gilt bis zur ersten verlässlichen
 *                        Messung ein vorläufiges Können: die Selbsteinschätzung bzw. A1 (A0 und "weiß nicht" ohne
 *                        Einstufung), angehoben durch Belegtes: Gelingen auf einer Stufe mindestens LIFT_SKILLS
 *                        Skills (Beherrschung ab "practicing", also mit Erfolg ab "controlled"), zählt diese Stufe.
 *                        So steigt das Niveau mit echten Erfolgen, ohne Einstufung und ohne Scheingenauigkeit.
 *   Obergrenze           Liegt das für eine Aufgabe maßgebliche Können bis B1-Mitte (MAX_THETA), ist eine Aufgabe
 *                        höchstens MAX_ABOVE über dem Können erlaubt (eine GER-Stufe). Das gilt für alle Zwecke,
 *                        auch Fehlerreparatur und Wiederholung: Ein Fehler bei einer viel zu schweren Aufgabe (z. B.
 *                        in der Einstufung) ist eine Messung, kein Übungsauftrag auf dieser Stufe.
 *   Wiedererkennen zuerst Ein neuer Skill beginnt für Anfänger mit einer Aufgabe zum Wiedererkennen (Auswahl), wenn
 *                        es eine gibt; freie Produktion ist für einen neuen Skill erst ab dem zweiten Kontakt dran.
 *
 * Darüber greift nichts davon: Fortgeschrittene planen unverändert (Lernzone, Stretch, Fehlerreparatur). Auch das
 * vorläufige Können gilt nur bis B1-Mitte; wer sich selbst höher einschätzt, wird ohne Einstufung wie bisher geplant.
 */

import { evidenceForExercise } from "../competence/evidence.js";
import { levelValue } from "../profile/scale.js";
import { exerciseDifficulty, relevantAbility } from "./zone.js";

export const BEGINNER_RULES = Object.freeze({
  maxTheta: 3.5, // B1-Mitte: bis hierhin gilt der Schutz
  maxAbove: 1.0, // höchstens eine GER-Stufe über dem Können
  defaultLevel: "A1", // ohne Selbsteinschätzung (A0, "weiß nicht" ohne Einstufung)
  liftSkills: 3, // so viele gelingende Skills einer Stufe heben das vorläufige Können auf diese Stufe
});
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const GOING = new Set(["practicing", "stable", "mastered"]);

/**
 * Vorläufiges Können ohne verlässliches Sprachprofil.
 * @param {{selfAssessment?: string|null, snapshot: object, library: object}} input
 * @returns {{overall: number, by_dimension: {}, basis: string, provisional: true, level: string}}
 */
export function provisionalAbility({ selfAssessment = null, snapshot, library }) {
  let level = CEFR.includes(selfAssessment) ? selfAssessment : BEGINNER_RULES.defaultLevel;
  const going = new Map();
  for (const skill of snapshot?.skills ?? []) {
    const skillLevel = library.skill(skill.skill_id)?.level;
    if (skillLevel && GOING.has(skill.mastery)) going.set(skillLevel, (going.get(skillLevel) ?? 0) + 1);
  }
  for (const candidate of CEFR) {
    if ((going.get(candidate) ?? 0) >= BEGINNER_RULES.liftSkills && CEFR.indexOf(candidate) > CEFR.indexOf(level)) level = candidate;
  }
  return {
    overall: levelValue(level) + 0.5,
    by_dimension: {},
    basis: `vorläufig: ${selfAssessment ? `Selbsteinschätzung ${selfAssessment}` : `ohne Einstufung ${BEGINNER_RULES.defaultLevel}`}`
      + `${level !== (selfAssessment ?? BEGINNER_RULES.defaultLevel) ? `, belegt bis ${level}` : ""}`,
    provisional: true,
    level,
  };
}

/** Für diese Übung maßgebliches Können, wenn es unter B1-Mitte liegt (sonst null: kein Schutz). */
export function beginnerTheta(exercise, ability) {
  // Anfänger ist, wessen Gesamtstufe bis B1-Mitte reicht (ein B2-Lerner mit schwächerem Schreiben ist keiner);
  // die Reichweite richtet sich dann nach dem Bereich der Übung, sonst nach der Gesamtstufe.
  if (!ability || !Number.isFinite(ability.overall) || ability.overall > BEGINNER_RULES.maxTheta) return null;
  const relevant = relevantAbility(exercise, ability);
  return relevant ? relevant.theta : ability.overall;
}

/** Ist die Übung für diesen Lerner erlaubt? (Anfänger: höchstens eine Stufe über dem Können; sonst immer.) */
export function withinBeginnerReach(exercise, ability) {
  const theta = beginnerTheta(exercise, ability);
  if (theta === null) return true;
  const difficulty = exerciseDifficulty(exercise);
  return !Number.isFinite(difficulty) || difficulty <= theta + BEGINNER_RULES.maxAbove + 1e-9;
}

/**
 * Übungen eines Bedarfs für Anfänger: nur in Reichweite; ein neuer Skill zuerst über Wiedererkennen, ohne freie
 * Produktion beim ersten Kontakt. Für Fortgeschrittene unverändert.
 */
export function beginnerExercises(exercises, { ability, purpose }) {
  if (!ability) return exercises;
  const reachable = exercises.filter((e) => withinBeginnerReach(e, ability));
  if (purpose !== "new") return reachable;
  const guarded = reachable.filter((e) => beginnerTheta(e, ability) !== null);
  if (!guarded.length) return reachable;
  const recognition = reachable.filter((e) => evidenceForExercise(e) === "recognized");
  if (recognition.length) return recognition;
  return reachable.filter((e) => e.evaluation_mode !== "open");
}
