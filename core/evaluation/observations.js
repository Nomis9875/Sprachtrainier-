/**
 * Skill-Beobachtungen der Regelbewertung (Bausteine für EvaluationResult v2).
 *
 * Gegenstück zu core/evaluation/observations.py (Python-Referenz, dort ausführlich beschrieben).
 * Eine Beobachtung sagt, WIE der Skill mit der Aufgabe zusammenhängt (kind: target, incidental,
 * missed_opportunity, upgrade_opportunity), WAS die Antwort gezeigt hat (result) und WIE SICHER
 * die Aussage ist (reliability). Erlaubte Werte: shared/contracts/evaluation_result_v2.json.
 */

import { OUTCOMES_BY_KIND } from "./result.js";

export const REFERENCE_BASES = Object.freeze(["reference_answer", "known_wrong_answer"]);

/** Pro Skill genau eine Beobachtung; bei mehreren Hinweisen gewinnt der aussagekräftigste. */
const PRIORITY = Object.freeze({ error: 4, demonstrated: 3, correct_but_simple: 2, not_demonstrated: 1, not_observable: 0 });

/**
 * @typedef {{skill_id: string, kind: string, result: string, reliability: string, basis: string}} SkillObservation
 */

/** Erzeugt eine geprüfte Beobachtung (wie SkillObservation.__post_init__ in Python). */
export function skillObservation(skillId, kind, result, reliability, basis) {
  if (!OUTCOMES_BY_KIND[kind]?.includes(result)) throw new TypeError(`${skillId}: Ergebnis ${result} passt nicht zur Art ${kind}`);
  if (result === "not_observable" && reliability !== "low") {
    throw new TypeError(`${skillId}: 'not_observable' hat immer die Verlässlichkeit 'low'`);
  }
  return Object.freeze({ skill_id: skillId, kind, result, reliability, basis });
}

/** Quelle einer Beobachtung: hinterlegte Antworten sind "reference", sonst "rule". */
export function sourceOf(observation) {
  return REFERENCE_BASES.includes(observation.basis) ? "reference" : "rule";
}

/** Sammelt Beobachtungen; je Skill bleibt die aussagekräftigste (Fehler vor Erfolg vor …). */
export class ObservationSet {
  constructor(observations = []) {
    this._bySkill = new Map();
    for (const observation of observations) this.add(observation);
  }

  add(observation) {
    const current = this._bySkill.get(observation.skill_id);
    if (!current || PRIORITY[observation.result] > PRIORITY[current.result]) this._bySkill.set(observation.skill_id, observation);
  }

  replace(observation) {
    this._bySkill.set(observation.skill_id, observation);
  }

  get(skillId) {
    return this._bySkill.get(skillId) ?? null;
  }

  /** Nach Skill-ID sortiert (wie Python: sorted()). */
  freeze() {
    return Object.freeze([...this._bySkill.keys()].sort(compareCodeUnits).map((skill) => this._bySkill.get(skill)));
  }
}

export const grammarSkill = (ruleId) => `grammar_structure:${ruleId}`;
export const lexicalSkill = (itemId) => `lexical_item:${itemId}`;
export const errorSkill = (errorId) => `common_error:${errorId}`;

/**
 * Hinweise "korrekt, aber einfach" als Beobachtung für die vorgeschlagenen Ausdrücke. Verlangt eine
 * Trainingsaufgabe den Ausdruck ausdrücklich (Ziel-Ausdruck), ist die einfache Formulierung eine
 * verpasste Gelegenheit; sonst nur ein Hinweis auf eine mögliche Aufwertung.
 *
 * @param {object} exercise
 * @param {{items: object[], finding: object}[]} groups
 * @param {Iterable<string>} usedItems
 * @param {{observeAll: boolean}} options
 */
export function upgradeObservations(exercise, groups, usedItems, { observeAll }) {
  const targets = new Set(exercise.target_items ?? []);
  const used = new Set(usedItems);
  const training = exercise.mode === "training";
  const observations = [];
  for (const { items } of groups) {
    for (const item of items) {
      if (used.has(item.id)) continue;
      if (targets.has(item.id) && training) {
        observations.push(skillObservation(lexicalSkill(item.id), "missed_opportunity", "not_demonstrated", "medium", "simpler_phrase"));
      } else if (observeAll || targets.has(item.id)) {
        observations.push(skillObservation(lexicalSkill(item.id), "upgrade_opportunity", "correct_but_simple", "high", "simpler_phrase"));
      }
    }
  }
  return observations;
}

/** Sortierung wie Python-Strings (nach Codepoints); für ASCII-IDs identisch mit UTF-16. */
export function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
