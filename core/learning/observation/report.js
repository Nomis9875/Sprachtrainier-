/**
 * ObservationReport v2: Was kann die App sicher, eingeschränkt oder gar nicht beobachten, und
 * was bedeutet das für Kompetenz, Coaching und Planner?
 *
 * Reine Analyse: Inhaltspaket + dokumentierter Stand der Bewertung (capabilities.js) → Bericht.
 * Keine Beobachtungslogik, keine Lerndaten, keine KI, nie gespeichert. Zählungen stammen aus dem
 * CoverageReport (keine zweite Inhaltsanalyse).
 *
 *   format, version, generated_at, content_version
 *   summary               Beobachtbarkeit auf einen Blick, Fähigkeitsmatrix, Zuverlässigkeit je
 *                         Muster/Maßnahme, offene Einschränkungen
 *   observability         je Skill und Beobachtungsweg: HIGH / MEDIUM / LOW / UNOBSERVABLE
 *   current_capabilities  je Beobachtungsart und Skill-Typ: Status, Wie, Fundstelle, Anzahl
 *   limitations           Einschränkungen nach Lernwert, mit Status (resolved / partial / open)
 *   proposed_extensions   Vorschläge mit Status (implemented / partial / open)
 *   compatibility         Zuverlässigkeit Coaching/Planner, Auswirkungen auf Komponenten
 *   metadata
 *
 * ─── Beobachtbarkeit je Skill (observability) ────────────────────────────────────
 *
 *   HIGH          sicher: zählt voll im Kompetenzmodell
 *   MEDIUM        eingeschränkt: zählt halb (Detektor mit Fehltreffern, Abwesenheit, Qwen nie)
 *   LOW           wird nur festgehalten, zählt nicht (keine starken Aussagen aus unsicheren Signalen)
 *   UNOBSERVABLE  kann heute nicht beobachtet werden
 *
 *   Die Kompetenz leitet aus LOW und UNOBSERVABLE nichts ab (competence/projection.js:
 *   RELIABILITY_WEIGHT low = 0, not_observable zählt nie).
 *
 * ─── Zuverlässigkeit von Coaching-Mustern und Planner-Maßnahmen ─────────────────
 *
 *   Je Muster/Maßnahme und Skill-Typ: benötigte (needs) und hilfreiche (helps) Fähigkeiten
 *   sowie verzerrende Einschränkungen (biases).
 *     eine benötigte Fähigkeit fehlt ("unavailable")        → UNOBSERVABLE
 *     alle benötigten "available"                            → HIGH, sonst MEDIUM
 *     je fehlender hilfreicher Fähigkeit                     → eine Stufe tiefer
 *     je OFFENER verzerrender Einschränkung mit severity high → eine Stufe tiefer (nie unter LOW)
 *   Gesamtstufe über die Typen: alle UNOBSERVABLE → UNOBSERVABLE; sonst die niedrigste
 *   beobachtbare, höchstens LOW, wenn ein Typ UNOBSERVABLE ist.
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { buildCoverageReport } from "../coverage/report.js";
import { isTargetOf } from "../planning/planner.js";
import { AUXILIARY_CAPABILITIES, CURRENT_CAPABILITIES, LIMITATIONS, OBSERVATION_KINDS } from "./capabilities.js";

export const OBSERVATION_REPORT_FORMAT = "observation_report";
export const OBSERVATION_REPORT_VERSION = 2;
export const RELIABILITY_LEVELS = Object.freeze(["UNOBSERVABLE", "LOW", "MEDIUM", "HIGH"]);
const LEVEL_OF_RELIABILITY = Object.freeze({ high: "HIGH", medium: "MEDIUM", low: "LOW" });

const G = SKILL_TYPES.GRAMMAR_STRUCTURE;
const L = SKILL_TYPES.LEXICAL_ITEM;
const E = SKILL_TYPES.COMMON_ERROR;
const req = (needs, { helps = [], biases = [] } = {}) => Object.freeze({ needs, helps, biases });

/** Coaching-Muster → Anforderungen an die Beobachtung. */
export const COACHING_REQUIREMENTS = Object.freeze({
  transfer: { [G]: req(["transfer"], { biases: ["L11", "L12"] }), [L]: req(["transfer"]) },
  plateau: { [G]: req(["target"], { biases: ["L1"] }), [L]: req(["target"], { biases: ["L1"] }) },
  false_confidence: {
    [G]: req(["target", "controlled_success"], { helps: ["incidental"], biases: ["L1", "L11"] }),
    [L]: req(["target", "controlled_success"], { helps: ["incidental"], biases: ["L1"] }),
  },
  persistent_error: { [E]: req(["incidental"]) },
  recurring_error: { [E]: req(["incidental"]) },
  error_improvement: { [E]: req(["transfer"], { biases: ["L8"] }) },
  avoidance: { [G]: req(["missed_opportunity"], { biases: ["L13"] }), [L]: req(["missed_opportunity"], { biases: ["L13"] }) },
});

/** Planner-Maßnahmen → Anforderungen an die Beobachtung (Zuverlässigkeit der ENTSCHEIDUNG). */
export const PLANNER_REQUIREMENTS = Object.freeze({
  move_to_spontaneous_production: {
    [G]: req(["target"], { helps: ["incidental"], biases: ["L3", "L11", "L10"] }),
    [L]: req(["target"], { helps: ["incidental"], biases: ["L2", "L10"] }),
  },
  focus_lexical_activation: { [L]: req(["target"], { helps: ["incidental"], biases: ["L1", "L2"] }) },
  increase_production_difficulty: { [G]: req(["target", "controlled_success"], { biases: ["L1"] }) },
  continue_reinforcement: {
    [G]: req(["target"], { biases: ["L1"] }),
    [L]: req(["target"], { biases: ["L1"] }),
    [E]: req(["incidental"]),
  },
  focus_error_elimination: { [E]: req(["incidental"]) },
});

/** Warum eine Entscheidung unter fehlender Beobachtung leidet (Klartext je Maßnahme/Muster). */
const EFFECTS = Object.freeze({
  transfer: "Transfer kommt aus echten Beobachtungen; bei Grammatik unterschätzt, weil seltene Verbformen nicht erkannt werden (L11).",
  plateau: "Kontrollierte Erfolge werden gezählt (P1): ein Plateau ist ein echtes Plateau.",
  false_confidence: "Kontrollierte Erfolge und freie Verwendung werden beide beobachtet; bei Grammatik wird freie Nutzung mit seltenen Verben unterschätzt (L11).",
  persistent_error: "Fehler werden in jeder Antwort erkannt: hartnäckige Fehler sind gut belegbar (Grenze: Trefferquote der Muster, siehe Audit).",
  recurring_error: "Wie persistent_error.",
  error_improvement: "'Vermieden' ist nur für Fehler mit Muster der richtigen Form beobachtbar.",
  avoidance: "Verpasste Gelegenheiten nur, wo das Training den Skill verlangt; in Challenges bewusst nie (L13).",
  move_to_spontaneous_production: "Spontane Nutzung wird überall beobachtet, ist aber nur über Gespräche messbar (L10) und bei Grammatik unterschätzt (L11).",
  focus_lexical_activation: "Freie Nutzung von Ausdrücken wird überall beobachtet: Entscheidung gut belegt.",
  increase_production_difficulty: "'In kontrollierten Übungen sicher' beruht auf gezählten Erfolgen (P1).",
  continue_reinforcement: "Erfolge und Fehler werden beide gezählt: Stabilität wird realistisch eingeschätzt.",
  focus_error_elimination: "Fehlerbeobachtung ist vollständig (jede Antwort): Entscheidung gut belegt.",
});

const IMPLEMENTED = "implemented";
export const PROPOSED_EXTENSIONS = Object.freeze([
  ext("P1", "closed_success_observations", ["L1"], IMPLEMENTED,
    "Musterlösungen melden die Lernziele als target 'demonstrated' (Quelle reference); hinterlegte falsche Antworten als 'error'.",
    { evaluation: "closed.py: _reference_observations, _known_wrong_observations", contract: "EvaluationResult v2", events: "skill_observation v2" }),
  ext("P2", "observe_all_detectors_in_free_answers", ["L2", "L3"], IMPLEMENTED,
    "In freien und spontanen Antworten laufen alle Detektoren; Treffer außerhalb der Lernziele werden 'incidental' mit der Verlässlichkeit des Detektors.",
    { evaluation: "answer_check.py: observe_all", contract: "observation_kind, reliability", events: "skill_observation v2" }, ["P3"]),
  ext("P3", "record_observation_kind", ["L4"], IMPLEMENTED,
    "Jede Beobachtung trägt Art, Ergebnis, Verlässlichkeit, Grundlage, Nachweisstufe und Bedingungen. Transfer wird aus den Ereignissen abgeleitet. v1 bleibt gültig ('unclassified').",
    { evaluation: "observations.py", contract: "EvaluationResult v2 + migrate_v1_to_v2", events: "skill_observation schema_version 2" }),
  ext("P4", "upgrade_and_missed_opportunity_signals", ["L7"], IMPLEMENTED,
    "'Korrekt, aber einfach' wird upgrade_opportunity; verlangte, aber fehlende Struktur im Training missed_opportunity. Kontext-Muster sind bewusst KEINE Gelegenheit (nur not_observable).",
    { evaluation: "observations.py: upgrade_observations", contract: "upgrade_opportunity / correct_but_simple", events: "wie P3" }, ["P3"]),
  ext("P5", "self_chosen_evidence", ["L5"], "partial",
    "Beiläufige Verwendung in geführten Aufgaben zählt als 'free'. Offen: spontane Nachweise je Gesprächszug und Spracheingabe.",
    { evaluation: "evidence.py", contract: "observation.evidence", events: "skill_observation.evidence" }, ["P3"]),
  ext("P6", "javascript_evaluator", ["L9"], IMPLEMENTED,
    "Die Regelbewertung (Rulebook, offene und geschlossene Prüfung, EvaluationResult v2) läuft in JavaScript; Parität mit Python über evaluation_parity.json.",
    { evaluation: "web/core/evaluation/: rulebook.js, check.js, closed.js, evaluate.js", contract: "unverändert", events: "unverändert" }),
  ext("P7", "avoidance_patterns_for_all_errors", ["L8"], "open",
    "Für jeden typischen Fehler ein Muster der richtigen Form hinterlegen (Inhaltsarbeit).",
    { evaluation: "keine", contract: "keine", events: "keine" }),
  ext("P8", "precise_error_attribution", ["L6"], "open",
    "Grammatikfehler der Struktur zuordnen, zu der der Fehler gehört (Verknüpfung Fehler → Regel im Inhalt), statt über das Thema.",
    { evaluation: "_observe nutzt die Verknüpfung", contract: "keine", events: "keine" }),
  ext("P9", "broader_verb_recognition", ["L11"], "partial",
    "Verbformen regelbasiert aus Stamm + Endung erkennen statt aus Listen (deterministisch, mit Audit-Sätzen gegen Fehltreffer abgesichert).",
    { evaluation: "neue Verb-Morphologie", contract: "keine", events: "keine" }),
  ext("P10", "specified_opportunities", ["L13", "L12", "L10"], "open",
    "Challenges legen im Inhalt fest, welche Struktur kommunikativ nahe liegt (z. B. 'Zweifel ausdrücken' → Subjuntivo). Erst dann gibt es dort verpasste Gelegenheiten.",
    { evaluation: "missed_opportunity auch in Challenges mit Angabe", contract: "keine", events: "keine" }),
]);

/** Was ist mit den bestehenden Komponenten passiert? */
export const COMPONENT_IMPACT = Object.freeze({
  competence_snapshot: impact("extended", true,
    ["liest observation_kind und reliability (low zählt nicht, medium halb)", "neue Felder: observation_kinds, trained_in, transfer, unused_targets, upgrade_opportunities, low_reliability_signals"],
    ["Format CompetenceSnapshot v1, Stufen, Pfade, Fehlertrend, Replay-Prinzip"]),
  session_planner: impact("unchanged", true,
    ["Entscheidungen beruhen auf vollständigeren Beobachtungen; Gewichte später an echten Daten prüfen"],
    ["SessionPlan v1, Bedarfsregeln, Übungswahl, Schnittstelle"]),
  session_runtime: impact("adapted", true,
    ["liest Bewertungen über readEvaluation (v1 und v2); unsichere Beobachtungen zählen nicht als Erfolg"],
    ["Lebenszyklus, Session-Ereignisse, ExerciseOutcome v1, SessionSummary v1"]),
  coaching: impact("adapted", true,
    ["transfer aus den Ereignissen (trained_in, transfer) statt aus dem aktuellen Inhalt", "avoidance nur aus ausdrücklich verlangten Gelegenheiten"],
    ["CoachingReport v1, übrige Muster, Empfehlungslogik"]),
  coverage_report: impact("adapted", true,
    ["OBSERVATION_SCOPE: alle freien Antworten; transfer_observable aus Detektor-Verlässlichkeit"],
    ["Einstufung, Pfade, Lücken, Empfehlungen"]),
  events: impact("extended", true,
    ["skill_observation Version 2 (Art, Verlässlichkeit, Grundlage, Bedingungen); Version 1 bleibt gültig und wird beim Replay gelesen"],
    ["alle bestehenden Ereignisse bleiben gültig und abspielbar"]),
  evaluation_result: impact("extended", true,
    ["EvaluationResult v2 (Übung samt Revision, Content-Version, Eingabe, Textstellen, Beobachtungen); v1 bleibt gültig, Umwandlung ausdrücklich"],
    ["overall, Befundarten, Schweregrade"]),
});

/**
 * @param {{library: import("../../content/library.js").ContentLibrary, generatedAt: Date}} input
 */
export function buildObservationReport({ library, generatedAt }) {
  const coverage = buildCoverageReport({ library, generatedAt });
  const facts = contentFacts(library, coverage);
  const capabilities = CURRENT_CAPABILITIES.map((c) => ({
    kind: c.kind, skill_type: c.skill_type, status: c.status, how: c.how, code_ref: c.code_ref,
    count: c.count_key ? facts[c.count_key] : null, count_of: c.count_key,
  }));
  const limitations = [...LIMITATIONS]
    .sort((a, b) => b.learning_value - a.learning_value || (a.id < b.id ? -1 : 1))
    .map((l, index) => ({ rank: index + 1, ...l, affected: l.count_key ? facts[l.count_key] : null }));
  const coachingReliability = reliabilityMatrix(COACHING_REQUIREMENTS);
  const plannerReliability = reliabilityMatrix(PLANNER_REQUIREMENTS);
  const valueOf = (ids) => Math.max(...ids.map((id) => LIMITATIONS.find((l) => l.id === id).learning_value));
  const proposals = PROPOSED_EXTENSIONS.map((p) => ({ ...p, learning_value: valueOf(p.addresses) }))
    .sort((a, b) => b.learning_value - a.learning_value || (a.id < b.id ? -1 : 1));
  const observability = skillObservability(library, coverage);
  const open = limitations.filter((l) => l.status !== "resolved");

  return {
    format: OBSERVATION_REPORT_FORMAT,
    version: OBSERVATION_REPORT_VERSION,
    generated_at: generatedAt.toISOString(),
    content_version: library.contentVersion ?? null,
    summary: {
      headline: headline(observability, open.length),
      observability: observability.summary,
      capability_matrix: matrix(capabilities),
      coaching_reliability: Object.fromEntries(Object.entries(coachingReliability).map(([k, v]) => [k, v.level])),
      planner_reliability: Object.fromEntries(Object.entries(plannerReliability).map(([k, v]) => [k, v.level])),
      open_limitations: open.map((l) => l.id),
      resolved_limitations: limitations.filter((l) => l.status === "resolved").map((l) => l.id),
      facts,
    },
    observability: observability.skills,
    current_capabilities: capabilities,
    limitations,
    proposed_extensions: proposals,
    compatibility: {
      coaching_reliability: coachingReliability,
      planner_reliability: plannerReliability,
      components: COMPONENT_IMPACT,
    },
    metadata: {
      derivation: "content_package + documented evaluator behavior",
      persisted: false,
      observation_kinds: OBSERVATION_KINDS,
      auxiliary_capabilities: AUXILIARY_CAPABILITIES,
      levels: RELIABILITY_LEVELS,
      competence_weight: { HIGH: 1, MEDIUM: 0.5, LOW: 0, UNOBSERVABLE: 0 },
      evidence_tests: ["tests/test_observation_model.py", "tests/test_audit_sentences.py", "web/tests/audit.test.js"],
    },
  };
}

function headline(observability, openCount) {
  const { summary, skills } = observability;
  const productive = skills.filter((s) => s.type !== E).length;
  const errors = skills.length - productive;
  return `${summary.target.HIGH} von ${productive} Strukturen und Ausdrücken sind als Lernziel sicher beobachtbar, `
    + `${summary.incidental.HIGH} auch beiläufig; ${summary.error.HIGH} von ${errors} typischen Fehlern werden in jeder `
    + `Antwort erkannt; ${openCount} Einschränkungen sind offen.`;
}

// ---------------------------------------------------------------- Beobachtbarkeit je Skill

/**
 * Je Skill und Beobachtungsweg eine Stufe (Regeln im Dateikopf):
 *   target              Detektor (oder Musterlösung in geschlossenen Übungen) → HIGH, sonst UNOBSERVABLE
 *   incidental          Verlässlichkeit des Detektors (high/medium/low) oder UNOBSERVABLE
 *   missed_opportunity  MEDIUM, wenn eine Trainingsübung den Skill verlangt (Wortschatz: und eine
 *                       einfache Form hinterlegt ist); sonst UNOBSERVABLE
 *   upgrade_opportunity nur Wortschatz: HIGH mit hinterlegter einfacher Form
 *   avoidance           nur Fehler: Verlässlichkeit des Musters der richtigen Form oder UNOBSERVABLE
 */
function skillObservability(library, coverage) {
  const exercises = library.exercises();
  const skills = coverage.skills.map((c) => {
    const trainingTarget = exercises.some((e) => e.mode === "training" && isTargetOf(e, c.skill_id));
    const closedTarget = exercises.some((e) => e.evaluation_mode !== "open" && isTargetOf(e, c.skill_id));
    const entry = { skill_id: c.skill_id, type: c.type };
    if (c.type === E) {
      entry.error = c.detection.detector ? "HIGH" : "UNOBSERVABLE";
      entry.avoidance = c.detection.avoidance_detectable ? LEVEL_OF_RELIABILITY[c.detection.avoidance_reliability] : "UNOBSERVABLE";
      return entry;
    }
    entry.target = c.detection.detector || closedTarget ? "HIGH" : "UNOBSERVABLE";
    entry.incidental = c.detection.detector ? LEVEL_OF_RELIABILITY[c.detection.incidental_reliability] : "UNOBSERVABLE";
    if (c.type === G) {
      entry.missed_opportunity = trainingTarget && c.detection.detector ? "MEDIUM" : "UNOBSERVABLE";
    } else {
      const simpler = (library.lexicalItem(c.skill_id.split(":")[1])?.simpler ?? []).length > 0;
      entry.missed_opportunity = trainingTarget && simpler ? "MEDIUM" : "UNOBSERVABLE";
      entry.upgrade_opportunity = simpler ? "HIGH" : "UNOBSERVABLE";
    }
    return entry;
  });
  const summary = {};
  for (const way of ["target", "incidental", "missed_opportunity", "upgrade_opportunity", "error", "avoidance"]) {
    const levels = skills.filter((s) => Object.hasOwn(s, way)).map((s) => s[way]);
    summary[way] = Object.fromEntries(RELIABILITY_LEVELS.slice().reverse().map((level) => [level, levels.filter((l) => l === level).length]));
  }
  summary.unobservable_skills = skills.filter((s) => (s.target ?? s.error) === "UNOBSERVABLE").map((s) => s.skill_id);
  summary.low_incidental_skills = skills.filter((s) => s.incidental === "LOW").map((s) => s.skill_id);
  return { skills, summary };
}

// ---------------------------------------------------------------- Zuverlässigkeit

export function statusOf(kind, type) {
  return CURRENT_CAPABILITIES.find((c) => c.kind === kind && c.skill_type === type)?.status ?? "unavailable";
}

/** Stufe für einen Skill-Typ (Regeln im Dateikopf). Behobene Einschränkungen verzerren nicht mehr. */
export function levelFor(requirement, type, status = statusOf, limitations = LIMITATIONS) {
  const needs = requirement.needs.map((kind) => [kind, status(kind, type)]);
  const notes = [];
  if (needs.some(([, s]) => s === "unavailable" || s === "not_applicable")) {
    const missing = needs.filter(([, s]) => s === "unavailable" || s === "not_applicable").map(([k]) => k);
    return { level: "UNOBSERVABLE", reason: `benötigt ${missing.join(", ")}: nicht beobachtbar` };
  }
  let index = needs.every(([, s]) => s === "available") ? 3 : 2;
  notes.push(`benötigt ${needs.map(([k, s]) => `${k} (${s})`).join(", ")}`);
  for (const kind of requirement.helps) {
    if (status(kind, type) === "unavailable") {
      index -= 1;
      notes.push(`ohne ${kind}`);
    }
  }
  for (const id of requirement.biases) {
    const limitation = limitations.find((l) => l.id === id);
    if (limitation.status === "resolved") {
      notes.push(`${id} behoben`);
    } else if (limitation.severity === "high") {
      index -= 1;
      notes.push(`verzerrt durch ${id} (${limitation.key})`);
    }
  }
  return { level: RELIABILITY_LEVELS[Math.max(1, index)], reason: notes.join("; ") };
}

export function combineLevels(levels) {
  const ranks = levels.map((l) => RELIABILITY_LEVELS.indexOf(l));
  const available = ranks.filter((r) => r > 0);
  if (!available.length) return "UNOBSERVABLE";
  const lowest = Math.min(...available);
  return RELIABILITY_LEVELS[available.length < ranks.length ? Math.min(lowest, 1) : lowest];
}

function reliabilityMatrix(requirements) {
  return Object.fromEntries(Object.entries(requirements).map(([name, byType]) => {
    const types = Object.fromEntries(Object.entries(byType).map(([type, requirement]) => [type, {
      ...levelFor(requirement, type), needs: requirement.needs, helps: requirement.helps, biases: requirement.biases,
    }]));
    const dependsOn = [...new Set(Object.values(byType).flatMap((r) => r.biases))].sort();
    return [name, { level: combineLevels(Object.values(types).map((t) => t.level)), by_type: types, depends_on: dependsOn, effect: EFFECTS[name] }];
  }));
}

// ---------------------------------------------------------------- Zahlen aus dem Inhalt

function contentFacts(library, coverage) {
  const exercises = library.exercises();
  const skillsOf = (type) => coverage.skills.filter((s) => s.type === type);
  const structures = exercises.flatMap((e) => e.structures ?? []);
  const errors = library.skills().filter((s) => s.type === E).map((s) => library.commonError(s.ref_id));
  const rules = library.skills().filter((s) => s.type === G).map((s) => library.grammarRule(s.ref_id));
  const training = exercises.filter((e) => e.mode === "training");
  const lexicalWithSimpler = new Set(library.skills().filter((s) => s.type === L && (library.lexicalItem(s.ref_id)?.simpler ?? []).length > 0).map((s) => s.ref_id));
  return {
    grammar_target_links: structures.filter((s) => s.is_target).length,
    grammar_observed_links: structures.filter((s) => !s.is_target).length,
    grammar_with_detector: skillsOf(G).filter((s) => s.detection.detector).length,
    grammar_with_context: rules.filter((r) => (r?.context?.patterns ?? []).length > 0).length,
    grammar_transfer_capable: skillsOf(G).filter((s) => s.transfer_observable).length,
    grammar_training_targets: new Set(training.flatMap((e) => (e.structures ?? []).filter((s) => s.is_target).map((s) => s.rule_id))).size,
    grammar_challenge_targets: new Set(exercises.filter((e) => e.mode === "challenge")
      .flatMap((e) => (e.structures ?? []).filter((s) => s.is_target).map((s) => s.rule_id))).size,
    lexical_target_links: exercises.reduce((sum, e) => sum + (e.target_items ?? []).length, 0),
    lexical_with_detector: skillsOf(L).filter((s) => s.detection.detector).length,
    lexical_transfer_capable: skillsOf(L).filter((s) => s.transfer_observable).length,
    lexical_with_simpler: lexicalWithSimpler.size,
    lexical_training_targets_with_simpler: new Set(training.flatMap((e) => (e.target_items ?? []).filter((id) => lexicalWithSimpler.has(id)))).size,
    detectors_low: coverage.skills.filter((s) => s.detection.incidental_reliability === "low").length,
    error_links: exercises.reduce((sum, e) => sum + (e.common_errors ?? []).length, 0),
    errors_with_detector: skillsOf(E).filter((s) => s.detection.detector).length,
    errors_with_avoidance: skillsOf(E).filter((s) => s.detection.avoidance_detectable).length,
    errors_without_avoidance: errors.filter((e) => !(e?.correct?.patterns ?? []).length).length,
    closed_with_accepted: exercises.filter((e) => e.evaluation_mode !== "open" && (e.accepted_answers ?? []).length > 0).length,
    conversation_exercises: exercises.filter((e) => evidenceForExercise(e) === "spontaneous").length,
  };
}

function matrix(capabilities) {
  const result = {};
  for (const c of capabilities) {
    result[c.kind] ??= {};
    result[c.kind][c.skill_type] = c.status;
  }
  return result;
}

/** requires: Vorschläge, ohne die dieser nicht sinnvoll umsetzbar ist (Reihenfolge der Umsetzung). */
function ext(id, key, addresses, status, description, changes, requires = []) {
  return Object.freeze({
    id, key, addresses, status, requires, description, changes,
    principles: {
      event_sourced: true,
      deterministic: true,
      replayable: true,
      device_independent: "ja (Bewertung in Python und JavaScript)",
      ai_free: true,
    },
  });
}

function impact(status, remainsValid, changes, unchanged) {
  return Object.freeze({ status, remains_valid: remainsValid, changes, unchanged });
}
