/**
 * Regelbasierte Prüfung einer Antwort im Kontext ihrer Übung.
 *
 * Gegenstück zu core/evaluation/answer_check.py (Python-Referenz, dort ausführlich beschrieben):
 * - Training: Fehlt eine Zielstruktur, gibt es TARGET_NOT_USED und die Beobachtung
 *   "missed_opportunity" (die Aufgabe hat die Struktur ausdrücklich verlangt).
 * - Challenge: verdeckte Ziele; nicht verwendet heißt nur "target / not_demonstrated".
 * - Offene Aufgaben: ALLE Detektoren laufen (Treffer außerhalb der Lernziele: "incidental").
 * - Geschlossene/halboffene Aufgaben: nur die Skills der Übung.
 */

import { ObservationSet, errorSkill, grammarSkill, lexicalSkill, skillObservation, upgradeObservations } from "./observations.js";
import { finding } from "./rulebook.js";
import { SEVERITY_BY_KIND, isBlockingSeverity } from "./result.js";
import { prepare } from "./text.js";

/** Rohbefund je Struktur (noch ohne Art und Verlässlichkeit). */
export const STRUCTURE_OUTCOMES = Object.freeze(["correct", "error", "not_used", "unknown"]);

/**
 * @typedef {{findings: object[], structures: {rule_id: string, outcome: string}[], observations: object[],
 *   items_used: string[], correct_uses: string[], word_count: number}} RuleReport
 */

/**
 * @param {string} text
 * @param {object} exercise    Übung aus dem Inhaltspaket
 * @param {import("./rulebook.js").Rulebook} rulebook
 * @param {{observeAll?: boolean}} [options]  alle Detektoren prüfen (Standard: nur bei offenen Aufgaben)
 * @returns {RuleReport}
 */
export function checkAnswer(text, exercise, rulebook, { observeAll = exercise.evaluation_mode === "open" } = {}) {
  const prepared = prepare(text);
  const errors = rulebook.findErrors(prepared);
  const findings = [...errors];

  const checks = [];
  for (const ref of exercise.structures ?? []) {
    const rule = rulebook.rule(ref.rule_id);
    const outcome = observeStructure(rule, rulebook.ruleUsed(rule.id, prepared), errors, rulebook);
    checks.push({ rule_id: rule.id, outcome });
    if (outcome === "not_used" && ref.is_target && exercise.mode === "training") findings.push(targetNotUsed(rule));
  }

  const simpleGroups = rulebook.findSimplePhraseGroups(prepared);
  findings.push(...rulebook.findGermanisms(prepared));
  findings.push(...rulebook.findRepetitions(prepared));
  findings.push(...simpleGroups.map((group) => group.finding));

  const wordCount = prepared.words().length;
  const minWords = exercise.min_words ?? 0;
  if (wordCount < minWords) {
    findings.push(finding("GOAL_NOT_MET", {
      original: "",
      suggestion: "",
      explanation_de: `Deine Antwort hat ${wordCount} Wörter; für diese Aufgabe sind mindestens ${minWords} vorgesehen. `
        + "Entwickle deine Antwort weiter.",
    }));
  }

  const correctUses = rulebook.correctUses(prepared);
  const observations = new ObservationSet();
  observeStructures(observations, exercise, rulebook, prepared, errors, checks, observeAll);
  const usedItems = observeItems(observations, exercise, rulebook, prepared, observeAll);
  for (const observation of upgradeObservations(exercise, simpleGroups, usedItems, { observeAll })) observations.add(observation);
  observeErrors(observations, exercise, rulebook, errors, correctUses, observeAll);

  const usedSet = new Set(usedItems);
  return {
    findings,
    structures: checks,
    observations: observations.freeze(),
    items_used: (exercise.target_items ?? []).filter((item) => usedSet.has(item)),
    correct_uses: correctUses,
    word_count: wordCount,
  };
}

/** Befunde, die eine Antwort als Ganzes nicht korrekt machen (Schwere error oder goal). */
export function blockingFindings(report) {
  return report.findings.filter((f) => isBlockingSeverity(SEVERITY_BY_KIND[f.kind]));
}

// ---------------------------------------------------------------- Beobachtungen

function observeStructures(observations, exercise, rulebook, text, errors, checks, observeAll) {
  const listed = new Map((exercise.structures ?? []).map((ref) => [ref.rule_id, ref.is_target]));
  const outcomes = new Map(checks.map((check) => [check.rule_id, check.outcome]));
  const rules = observeAll ? rulebook.rules() : [...listed.keys()].map((id) => rulebook.rule(id));
  const training = exercise.mode === "training";
  for (const rule of rules) {
    const outcome = outcomes.get(rule.id) ?? observeStructure(rule, rulebook.ruleUsed(rule.id, text), errors, rulebook);
    const skill = grammarSkill(rule.id);
    const unknownBasis = hasPatterns(rule.detector) ? "context_only" : "no_detector";
    let observation;
    if (listed.get(rule.id) === true) { // Lernziel
      if (outcome === "correct") observation = skillObservation(skill, "target", "demonstrated", "high", "structure_detector");
      else if (outcome === "error") observation = skillObservation(skill, "target", "error", "high", "error_detector");
      else if (outcome === "not_used" && training) {
        observation = skillObservation(skill, "missed_opportunity", "not_demonstrated", "medium", "task_requirement");
      } else if (outcome === "not_used") observation = skillObservation(skill, "target", "not_demonstrated", "medium", "structure_detector");
      else observation = skillObservation(skill, "target", "not_observable", "low", unknownBasis);
    } else if (outcome === "correct") {
      observation = skillObservation(skill, "incidental", "demonstrated", rule.detector.reliability ?? "high", "structure_detector");
    } else if (outcome === "error") {
      observation = skillObservation(skill, "incidental", "error", "high", "error_detector");
    } else if (outcome === "unknown" && listed.has(rule.id)) {
      // Nur für Strukturen, die die Übung beobachtet: sonst meldete jedes "si" oder "cuando" etwas
      observation = skillObservation(skill, "incidental", "not_observable", "low", unknownBasis);
    } else {
      continue; // nicht verwendet und nicht Lernziel: keine Aussage
    }
    observations.add(observation);
  }
}

function observeItems(observations, exercise, rulebook, text, observeAll) {
  const targets = new Set(exercise.target_items ?? []);
  const candidates = observeAll ? rulebook.itemIds() : exercise.target_items ?? [];
  const used = rulebook.itemsUsed(text, candidates);
  for (const itemId of used) {
    if (targets.has(itemId)) {
      observations.add(skillObservation(lexicalSkill(itemId), "target", "demonstrated", "high", "lexical_detector"));
    } else {
      const reliability = rulebook.item(itemId).detector.reliability ?? "high";
      observations.add(skillObservation(lexicalSkill(itemId), "incidental", "demonstrated", reliability, "lexical_detector"));
    }
  }
  return used;
}

function observeErrors(observations, exercise, rulebook, errors, correctUses, observeAll) {
  const provoked = new Set(exercise.common_errors ?? []);
  const targets = new Set([
    ...(exercise.structures ?? []).filter((s) => s.is_target).map((s) => `grammar_structure:${s.rule_id}`),
    ...(exercise.target_items ?? []).map((item) => `lexical_item:${item}`),
  ]);
  for (const f of errors) {
    const kind = provoked.has(f.error_id) ? "target" : "incidental";
    observations.add(skillObservation(errorSkill(f.error_id), kind, "error", "high", "error_detector"));
    // P13: auch die verletzte Kompetenz ist nicht gelungen (depende en → depender de), nicht nur "ein Fehler"
    const competence = rulebook.error(f.error_id)?.competence;
    if (competence) {
      observations.add(skillObservation(competence, targets.has(competence) ? "target" : "incidental", "error", "high", "error_detector"));
    }
  }
  for (const errorId of correctUses) {
    let reliability;
    let kind;
    if (provoked.has(errorId)) [reliability, kind] = ["high", "target"];
    else if (observeAll) [reliability, kind] = [rulebook.error(errorId).correct.reliability ?? "high", "incidental"];
    else continue;
    observations.add(skillObservation(errorSkill(errorId), kind, "demonstrated", reliability, "correct_form_detector"));
  }
}

// ---------------------------------------------------------------- Rohbefund je Struktur

function observeStructure(rule, used, errors, rulebook) {
  if (errors.some((f) => violates(f, rule, rulebook))) return "error";
  if (used === null) return "unknown";
  return used ? "correct" : "not_used";
}

/**
 * Verletzt der Fehler diese Struktur? Nennt der typische Fehler seine Kompetenz (P12), dann nur genau diese
 * (P13: "Hay la cocina" ist ein Fehler bei hay, nicht bei estar + Gerundium im selben Thema). Ohne Angabe
 * bleibt die alte, gröbere Zuordnung über das Thema.
 */
function violates(finding, rule, rulebook) {
  const competence = finding.error_id ? rulebook.error(finding.error_id)?.competence : null;
  if (competence) return competence === grammarSkill(rule.id);
  return related(rule.topic_id, finding.topic_id);
}

/** Gleiches Thema oder Ober-/Unterthema (grammar.subjunctive ↔ grammar.subjunctive.influence). */
function related(topic, other) {
  if (other === null || other === undefined) return false;
  return topic === other || topic.startsWith(`${other}.`) || other.startsWith(`${topic}.`);
}

function targetNotUsed(rule) {
  return finding("TARGET_NOT_USED", {
    original: "",
    suggestion: "",
    explanation_de: `Ziel dieser Übung: ${rule.title_de}. ${rule.explanation_de}`,
    topic_id: rule.topic_id,
    rule_id: rule.id,
  });
}

function hasPatterns(detector) {
  return Array.isArray(detector?.patterns) && detector.patterns.length > 0;
}
