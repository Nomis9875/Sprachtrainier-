/**
 * Ist-Zustand der Skill-Beobachtung: was die Regelbewertung beobachten kann und wo sie endet.
 * Nur Fakten aus dem Code (mit Fundstelle), belegt durch tests/test_observation_model.py,
 * tests/test_audit_sentences.py und shared/fixtures/observation_cases.json. Die Regelbewertung gibt es
 * gleichwertig in Python (Referenz) und JavaScript (web/core/evaluation/evaluate.js, offline im Browser);
 * die Fundstellen nennen die Python-Referenz, das JavaScript-Gegenstück trägt denselben Namen.
 * Keine Beobachtungslogik: Diese Datei beschreibt, sie beobachtet nichts.
 */

import { SKILL_TYPES } from "../../content/skills.js";

/**
 * Beobachtungsarten (wie in EvaluationResult v2, siehe core/evaluation/observations.py):
 *
 *   target               Skill ist Lernziel der Übung (structures.is_target, target_items,
 *                        common_errors). Ergebnis: demonstrated / error / not_demonstrated / not_observable.
 *   incidental           in einer freien/spontanen Antwort erkannt, aber nicht Lernziel. Ergebnis nur
 *                        demonstrated / error / not_observable (nicht Verlangtes nicht zu verwenden
 *                        ist kein Versäumnis).
 *   transfer             ABGELEITET, nicht erfasst: incidental "demonstrated" frei/spontan, nachdem
 *                        der Skill vorher in einer ANDEREN Übung als Lernziel geübt wurde (aus den
 *                        Ereignissen, competence/projection.js).
 *   missed_opportunity   die Aufgabe VERLANGT den Skill ausdrücklich (Training), die Antwort zeigt
 *                        ihn nicht. Nie ein Fehler, nie in Challenges (dort sind Ziele verdeckt).
 *   upgrade_opportunity  korrekt, aber einfach ("muy importante" statt "fundamental"). Nie ein Fehler.
 */
export const OBSERVATION_KINDS = Object.freeze(["target", "incidental", "transfer", "missed_opportunity", "upgrade_opportunity"]);

/** Hilfsfähigkeit, die mehrere Muster brauchen: Erfolge in kontrollierten Übungen werden erfasst. */
export const AUXILIARY_CAPABILITIES = Object.freeze(["controlled_success"]);

export const STATUSES = Object.freeze(["available", "partial", "unavailable", "not_applicable"]);
export const LIMITATION_STATUSES = Object.freeze(["resolved", "partial", "open"]);

const G = SKILL_TYPES.GRAMMAR_STRUCTURE;
const L = SKILL_TYPES.LEXICAL_ITEM;
const E = SKILL_TYPES.COMMON_ERROR;

/**
 * Fähigkeiten je Beobachtungsart und Skill-Typ. `count` wird im Bericht aus dem Inhaltspaket
 * gefüllt (Schlüssel siehe observation/report.js → contentFacts).
 */
export const CURRENT_CAPABILITIES = Object.freeze([
  cap("target", G, "available", "Lernziele werden in jeder Antwort beobachtet; bei Musterlösungen aus der Referenz (demonstrated), bei hinterlegten falschen Antworten als error. Ohne Detektor oder bei unbekannter Verbform: not_observable.",
    "core/evaluation/answer_check.py: _observe_structures; core/evaluation/closed.py: _reference_observations", "grammar_target_links"),
  cap("target", L, "available", "Ziel-Ausdrücke werden erkannt, auch in Musterlösungen (nur der tatsächlich verwendete Ausdruck).",
    "core/evaluation/answer_check.py: _observe_items; core/evaluation/closed.py: _reference_observations", "lexical_target_links"),
  cap("target", E, "available", "Fehler, die eine Übung provoziert: Fehler in jeder Antwort; 'vermieden' auch bei Musterlösungen.",
    "core/evaluation/answer_check.py: _observe_errors", "error_links"),

  cap("incidental", G, "available", "In freien/spontanen Antworten laufen alle Struktur-Detektoren. Der Treffer zählt nach der Verlässlichkeit des Detektors (high voll, medium halb, low gar nicht).",
    "core/evaluation/answer_check.py: _observe_structures (observe_all)", "grammar_with_detector"),
  cap("incidental", L, "available", "In freien/spontanen Antworten laufen alle Wortschatz-Detektoren, mit Verlässlichkeit je Ausdruck.",
    "core/evaluation/answer_check.py: _observe_items (observe_all)", "lexical_with_detector"),
  cap("incidental", E, "available", "Alle Fehler-Detektoren laufen in jeder Antwort; die richtige Form ('vermieden') ebenfalls, sofern ein Muster existiert.",
    "core/evaluation/rulebook.py: find_errors, correct_uses", "errors_with_detector"),

  cap("transfer", G, "available", "Aus den Ereignissen abgeleitet: beiläufiger Erfolg frei/spontan nach Training in einer anderen Übung. Nur für Detektoren ≥ medium.",
    "web/core/learning/competence/projection.js: transferContexts", "grammar_transfer_capable"),
  cap("transfer", L, "available", "Wie Grammatik: Ausdrücke werden jetzt auch außerhalb ihrer Zielübung beobachtet.",
    "web/core/learning/competence/projection.js: transferContexts", "lexical_transfer_capable"),
  cap("transfer", E, "partial", "Vermeiden außerhalb der provozierenden Übungen ist beobachtbar, aber nur für Fehler mit Muster der richtigen Form.",
    "core/evaluation/rulebook.py: correct_uses", "errors_with_avoidance"),

  cap("missed_opportunity", G, "partial", "Nur wo eine Trainingsaufgabe die Struktur ausdrücklich verlangt. Challenges verraten ihre Ziele nicht: dort nur 'target / not_demonstrated' ohne Wertung. Kontext-Muster ('es importante que' ohne erkennbare Form) ergeben not_observable, keine Gelegenheit.",
    "core/evaluation/answer_check.py: _observe_structures (training)", "grammar_training_targets"),
  cap("missed_opportunity", L, "partial", "Nur wo eine Trainingsaufgabe den Ausdruck als Ziel führt und die Antwort die einfache Formulierung wählt (z. B. rephrase-importante).",
    "core/evaluation/observations.py: upgrade_observations", "lexical_training_targets_with_simpler"),
  cap("missed_opportunity", E, "not_applicable", "Einen Fehler 'nicht zu machen' ist keine verpasste Gelegenheit.", null, null),

  cap("upgrade_opportunity", G, "not_applicable", "Einfache Formulierungen sind Wortschatz-Hinweise, keine Grammatik.", null, null),
  cap("upgrade_opportunity", L, "partial", "'Korrekt, aber einfach' als Beobachtung für den besseren Ausdruck; nur für Ausdrücke mit hinterlegter einfacher Form.",
    "core/evaluation/rulebook.py: find_simple_phrase_groups; core/evaluation/observations.py", "lexical_with_simpler"),
  cap("upgrade_opportunity", E, "not_applicable", "Kein Fehler.", null, null),

  cap("controlled_success", G, "available", "Richtige Musterlösungen melden ihre Ziel-Strukturen als demonstrated (P1).",
    "core/evaluation/closed.py: _reference_observations", "closed_with_accepted"),
  cap("controlled_success", L, "available", "Richtige Musterlösungen melden den verwendeten Ziel-Ausdruck als demonstrated (P1).",
    "core/evaluation/closed.py: _reference_observations", "closed_with_accepted"),
  cap("controlled_success", E, "available", "Richtige Musterlösungen melden provozierte Fehler als vermieden (P1).",
    "core/evaluation/closed.py: _reference_observations", "closed_with_accepted"),
]);

/**
 * Einschränkungen mit Lernwert (B2 → C1/C2) und Status nach diesem Schritt. Nur offene und teilweise
 * behobene Einschränkungen mit severity "high" senken die Zuverlässigkeit abhängiger Muster.
 */
export const LIMITATIONS = Object.freeze([
  lim("L1", "closed_reference_success_unobserved", "high", 95, "resolved", "P1",
    "Richtig gelöste Lückentexte, Umformungen und Wortschatzabfragen (Musterlösung) erzeugten keine Skill-Beobachtung.",
    "core/evaluation/closed.py: _reference_observations",
    "Behoben: Musterlösungen melden Lernziele als demonstrated, hinterlegte falsche Antworten als error.",
    "closed_with_accepted"),
  lim("L2", "lexical_observed_only_as_target", "high", 90, "resolved", "P2",
    "Ausdrücke wurden nur in Übungen beobachtet, die sie als Ziel führen.",
    "core/evaluation/answer_check.py: _observe_items",
    "Behoben: In freien/spontanen Antworten laufen alle Wortschatz-Detektoren (incidental).",
    "lexical_with_detector"),
  lim("L3", "grammar_observed_only_where_listed", "high", 80, "resolved", "P2",
    "Strukturen wurden nur geprüft, wenn die Übung sie unter `structures` führt.",
    "core/evaluation/answer_check.py: _observe_structures",
    "Behoben: In freien/spontanen Antworten laufen alle Struktur-Detektoren (incidental).",
    "grammar_with_detector"),
  lim("L10", "spontaneous_only_via_conversation", "medium", 70, "open", null,
    "Die Nachweisstufe 'spontaneous' gibt es nur für Gespräche oder gesprochene Antworten; Spracheingabe existiert noch nicht.",
    "web/core/learning/competence/evidence.js: evidenceForExercise",
    "Der entscheidende Schritt zu C1, spontane Produktion, ist nur über wenige Gespräche messbar.",
    "conversation_exercises"),
  lim("L11", "finite_verb_lists", "high", 65, "partial", "P9",
    "Subjuntivo-Formen werden nur aus Wortlisten (~55 Verben) und Endungen des Imperfecto erkannt. Andere Verben ergeben not_observable.",
    "content/lists.toml: subj_present, ind_present",
    "Teilweise verbessert (häufige Verben, Auslöser mit Verstärker 'es muy importante que'); seltene Verben ('que te arregles') bleiben unsichtbar: spontane Nutzung wird unterschätzt, nie aber falsch gelobt.",
    "grammar_with_context"),
  lim("L7", "simple_phrase_signal_unused", "medium", 55, "resolved", "P4",
    "Der Hinweis 'korrekt, aber einfach' wurde weder Beobachtung noch Ereignis.",
    "core/evaluation/observations.py: upgrade_observations",
    "Behoben: upgrade_opportunity (nie ein Fehler); im Training mit verlangtem Ausdruck missed_opportunity.",
    "lexical_with_simpler"),
  lim("L4", "observation_kind_not_recorded", "medium", 50, "resolved", "P3",
    "Das Ereignis skill_observation hielt nicht fest, ob der Skill Ziel der Übung war.",
    "web/core/learning/events.js: skill_observation Version 2",
    "Behoben: Art, Verlässlichkeit, Grundlage und Bedingungen stehen im Ereignis; Transfer kommt aus den Ereignissen.",
    null),
  lim("L12", "unreliable_incidental_detectors", "medium", 48, "open", null,
    "Einige Detektoren schlagen außerhalb ihres Lernziels oft falsch an (polite_request: 'no sé si podría'; informal_address: 'tío', 'colega').",
    "content/grammar_rules.toml: detect_reliability",
    "Beiläufige Treffer dieser Skills werden nur festgehalten (low), zählen nicht und ergeben keinen Transfer.",
    "detectors_low"),
  lim("L9", "no_evaluator_in_javascript", "high", 45, "resolved", "P6",
    "Die Regelbewertung (answer_check, closed) existierte nur in Python.",
    "web/core/evaluation/evaluate.js: evaluateAnswer",
    "Behoben: Die Bewertung läuft auch in JavaScript (offline im Browser) und liefert für jeden geprüften Fall dasselbe EvaluationResult v2 wie Python (shared/fixtures/evaluation_parity.json).",
    null),
  lim("L13", "challenge_opportunities_not_specified", "medium", 42, "open", null,
    "Challenges legen nicht fest, welche Struktur kommunikativ nahe liegt; verpasste Gelegenheiten gibt es deshalb nur im Training.",
    "content/exercises/*.toml (kein Feld für Gelegenheiten)",
    "Vermeidung in freier Rede ('nie Subjuntivo beim Überzeugen') ist nicht erkennbar; bewusst lieber nichts als falsche Schwächen.",
    "grammar_challenge_targets"),
  lim("L8", "error_avoidance_patterns_missing", "medium", 40, "open", null,
    "Einige typische Fehler haben kein Muster für die richtige Form.",
    "content/common_errors.toml: correct",
    "Für sie kann 'vermieden' nie beobachtet werden; der Fehlerpfad bleibt 'active', Fortschritt ist unsichtbar.",
    "errors_without_avoidance"),
  lim("L5", "evidence_level_per_exercise", "medium", 35, "partial", "P5",
    "Die Nachweisstufe galt für alle Skills eines Versuchs gleich (aus der Übung).",
    "core/evaluation/evidence.py: evidence_for_observation",
    "Teilweise behoben: beiläufige Verwendung in geführten Aufgaben zählt als 'free'; sonst weiter je Übung.",
    null),
  lim("L6", "grammar_error_attributed_by_topic", "medium", 30, "open", null,
    "Ein Grammatikfehler wird jeder Struktur mit verwandtem Thema (Ober-/Unterthema) als 'error' zugeordnet.",
    "core/evaluation/answer_check.py: _observe, _related",
    "Fehler können der falschen Struktur angelastet werden; Stufen und Fehlerbilder werden ungenauer.",
    null),
]);

function cap(kind, type, status, how, codeRef, countKey) {
  return Object.freeze({ kind, skill_type: type, status, how, code_ref: codeRef, count_key: countKey });
}

function lim(id, key, severity, learningValue, status, resolvedBy, statement, codeRef, consequence, countKey) {
  return Object.freeze({
    id, key, severity, learning_value: learningValue, status, resolved_by: resolvedBy, statement, code_ref: codeRef,
    consequence, count_key: countKey,
  });
}
