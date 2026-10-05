/**
 * CoverageReport v1: Wie gut decken die vorhandenen Inhalte die vorhandenen Skills ab?
 *
 * ─── Architekturregel ──────────────────────────────────────────────────────────
 *
 *   Coverage Reports sind Analysen, kein gespeicherter Zustand.
 *   Content Package → Analyse → CoverageReport. Keine Lerndaten, keine KI, kein Zufall:
 *   dasselbe Inhaltspaket ergibt denselben Bericht (generated_at kommt vom Aufrufer).
 *
 * ─── Format ────────────────────────────────────────────────────────────────────
 *
 *   format, version, generated_at, content_version
 *   summary                  Zählungen: Einstufung, Typ, Reife, Pfade, Übungen, Lücken, Kompatibilität,
 *                            content_priorities (Themenbereiche mit dem größten Nutzen)
 *   skills[]                 je Skill: Zählungen, Einstufung, Entwicklungspfad, Erkennung, C1/C2-Reife,
 *                            Unterstützung der Planner-Maßnahmen und Coaching-Muster, Übungen
 *   gaps[]                   kritische Lücken mit Schwere, Aussage und Belegen
 *   recommendations[]        Inhaltsempfehlungen je Skill, nach Nutzen sortiert (keine Übungen erzeugt)
 *   planner_compatibility    je Maßnahme: vollständig / teilweise / nicht unterstützbar
 *   coaching_compatibility   je Coaching-Muster: kann die App mit vorhandenen Übungen reagieren?
 *   metadata                 derivation "content_package", persisted false, Regeln
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { isGermanism } from "../planning/needs.js";
import { COVERAGE_CLASSES, COVERAGE_RULES, OBSERVATION_SCOPE, skillCoverage } from "./analysis.js";

export const COVERAGE_REPORT_FORMAT = "coverage_report";
export const COVERAGE_REPORT_VERSION = 1;

export const SUPPORT = Object.freeze(["full", "partial", "none"]);
export const READINESS_BANDS = Object.freeze(["A2/B1", "B1/B2", "B2/C1", "C1/C2"]);

/** Welche Planner-/Coaching-Maßnahmen für welchen Skill-Typ gelten. */
const ACTIONS_BY_TYPE = Object.freeze({
  [SKILL_TYPES.GRAMMAR_STRUCTURE]: ["move_to_spontaneous_production", "increase_production_difficulty", "continue_reinforcement"],
  [SKILL_TYPES.LEXICAL_ITEM]: ["move_to_spontaneous_production", "focus_lexical_activation", "continue_reinforcement"],
  [SKILL_TYPES.COMMON_ERROR]: ["focus_error_elimination", "continue_reinforcement"],
});
const PATTERNS_BY_TYPE = Object.freeze({
  [SKILL_TYPES.GRAMMAR_STRUCTURE]: ["false_confidence", "plateau", "transfer", "avoidance"],
  [SKILL_TYPES.LEXICAL_ITEM]: ["false_confidence", "plateau", "transfer"],
  [SKILL_TYPES.COMMON_ERROR]: ["persistent_error", "recurring_error", "error_improvement"],
});

/** Nutzen einer Inhaltslücke (Grundwerte), dazu Zuschläge siehe recommend(). */
export const GAP_VALUE = Object.freeze({
  no_exercises: 50,
  no_free_production: 35,
  no_detector: 30,
  avoidance_not_detectable: 25,
  no_spontaneous_production: 20,
  no_realistic_path: 0, // Folge der anderen Lücken, zählt nicht doppelt
  no_error_scenario: 10,
});
const GAP_SEVERITY = Object.freeze({
  no_exercises: "critical", no_free_production: "high", no_detector: "high", avoidance_not_detectable: "high",
  no_realistic_path: "high", no_spontaneous_production: "medium", no_error_scenario: "low",
});

/**
 * @param {{library: import("../../content/library.js").ContentLibrary, generatedAt: Date}} input
 */
export function buildCoverageReport({ library, generatedAt }) {
  const coverages = library.skills().map((s) => s.id).sort().map((id) => skillCoverage(library, id));
  const errorTopics = new Set(coverages.filter((c) => c.type === SKILL_TYPES.COMMON_ERROR).map((c) => c.topic_id));

  const skills = coverages.map((c) => {
    const readiness = readinessOf(c);
    const planner = Object.fromEntries(ACTIONS_BY_TYPE[c.type].map((action) => [action, plannerSupport(action, c)]));
    const coaching = Object.fromEntries(PATTERNS_BY_TYPE[c.type].map((pattern) => [pattern, coachingSupport(pattern, c)]));
    const { exercises, ...rest } = c;
    return {
      ...rest,
      readiness,
      planner_support: planner,
      coaching_support: coaching,
      exercises: exercises.map(({ status, ...e }) => e),
    };
  });

  const gaps = skills.flatMap((s) => gapsOf(s, errorTopics)).sort(bySeverity);
  const recommendations = recommend(skills, gaps);
  const plannerCompatibility = compatibility(skills, "planner_support");
  const coachingCompatibility = compatibility(skills, "coaching_support");

  return {
    format: COVERAGE_REPORT_FORMAT,
    version: COVERAGE_REPORT_VERSION,
    generated_at: generatedAt.toISOString(),
    content_version: library.contentVersion ?? null,
    summary: summarize(library, skills, gaps, recommendations, plannerCompatibility, coachingCompatibility),
    skills,
    gaps,
    recommendations,
    planner_compatibility: plannerCompatibility,
    coaching_compatibility: {
      ...coachingCompatibility,
      system_findings: systemFindings(skills),
    },
    metadata: {
      derivation: "content_package",
      persisted: false,
      rules: { coverage: COVERAGE_RULES, classes: COVERAGE_CLASSES, gap_value: GAP_VALUE, observation_scope: OBSERVATION_SCOPE },
    },
  };
}

// ---------------------------------------------------------------- C1/C2-Reife

/**
 * Reife = angegebenes Niveau des Skills (aus dem Inhalt) × höchste trainierbare Produktionsstufe.
 *
 *   angegeben C1/C2:  frei oder spontan trainierbar → "C1/C2", nur kontrolliert oder gar nicht → "B2/C1"
 *   angegeben B2:     frei oder spontan trainierbar → "B2/C1", nur kontrolliert oder gar nicht → "B1/B2"
 *   angegeben ≤ B1:   "A2/B1"
 *
 * supports_c1_goal: Band "B2/C1" oder "C1/C2" UND tatsächlich trainierbar (mindestens PARTIAL).
 */
export function readinessOf(c) {
  const ceiling = c.counts.spontaneous ? "spontaneous" : c.counts.free ? "free" : c.counts.controlled ? "controlled" : null;
  const productive = ceiling === "free" || ceiling === "spontaneous";
  let band;
  if (c.level === "C1" || c.level === "C2") band = productive ? "C1/C2" : "B2/C1";
  else if (c.level === "B2") band = productive ? "B2/C1" : "B1/B2";
  else band = "A2/B1";
  const trainable = ["PARTIAL", "GOOD", "STRONG"].includes(c.classification);
  return {
    declared_level: c.level,
    trainable_ceiling: ceiling,
    band,
    supports_c1_goal: trainable && (band === "B2/C1" || band === "C1/C2"),
    reason: `angegeben ${c.level}, höchste trainierbare Stufe '${ceiling ?? "keine"}', Einstufung ${c.classification}`,
  };
}

// ---------------------------------------------------------------- Planner

/**
 *   move_to_spontaneous_production   full: spontane Übung · partial: nur freie (Planner weicht aus) · none
 *   increase_production_difficulty   full: freie oder spontane Übung · partial: nur geführte · none
 *   focus_lexical_activation         full: freie UND spontane Übung · partial: eine davon · none
 *   focus_error_elimination          full: gezieltes Training + freie/spontane Provokation + "vermieden"
 *                                    beobachtbar · partial: irgendeine provozierende Übung · none
 *   continue_reinforcement           full: ≥ 2 Übungen · partial: 1 · none: 0
 */
export function plannerSupport(action, c) {
  const n = c.counts;
  const guided = c.by_evidence.guided;
  const shortest = (levels) => {
    const fitting = c.exercises.filter((e) => levels.includes(e.evidence)).map((e) => e.min_session_minutes).filter(Boolean);
    return fitting.length ? Math.min(...fitting) : null;
  };
  const make = (support, reason, extra = {}) => ({ support, reason, ...extra });
  switch (action) {
    case "move_to_spontaneous_production":
      if (n.spontaneous) return make("full", `${n.spontaneous} spontane Übung(en)`, { min_session_minutes: shortest(["spontaneous"]) });
      if (n.free) return make("partial", "keine spontane Übung, der Planner weicht auf freie Produktion aus");
      return make("none", "weder spontane noch freie Übung");
    case "increase_production_difficulty":
      if (n.free || n.spontaneous) return make("full", `${n.free + n.spontaneous} freie/spontane Übung(en)`);
      if (guided) return make("partial", "nur geführte Produktion über der kontrollierten Stufe");
      return make("none", "keine Übung über der kontrollierten Stufe");
    case "focus_lexical_activation":
      if (n.free && n.spontaneous) return make("full", "freie und spontane Übung vorhanden");
      if (n.free || n.spontaneous) return make("partial", n.free ? "nur freie, keine spontane Übung" : "nur spontane, keine freie Übung");
      return make("none", n.controlled ? "nur kontrollierte Übungen" : "keine Übung");
    case "focus_error_elimination": {
      const trained = n.controlled > 0;
      const provoked = n.free + n.spontaneous > 0;
      const avoidable = c.detection.avoidance_detectable;
      if (trained && provoked && avoidable) return make("full", "gezieltes Training, Provokation in freier Produktion, Vermeiden beobachtbar");
      if (n.exercises) {
        const missing = [!trained && "gezieltes Training", !provoked && "freie/spontane Provokation", !avoidable && "Beobachtung des Vermeidens"].filter(Boolean);
        return make("partial", `es fehlt: ${missing.join(", ")}`);
      }
      return make("none", "keine Übung provoziert diesen Fehler");
    }
    case "continue_reinforcement":
      if (n.exercises >= 2) return make("full", `${n.exercises} Übungen`);
      if (n.exercises === 1) return make("partial", "nur eine Übung: Wiederholung ohne Abwechslung");
      return make("none", "keine Übung");
    default:
      return make("none", "unbekannte Maßnahme");
  }
}

// ---------------------------------------------------------------- Coaching

/**
 * Kann die App auf ein Coaching-Muster mit vorhandenen Inhalten reagieren (bzw. es überhaupt erkennen)?
 *
 *   false_confidence   Antwort: freie/spontane Übung · full: beide Stufen · partial: eine · none
 *   plateau            Antwort: andere Übungsart · full: ≥ 2 Produktionsstufen inkl. frei/spontan ·
 *                      partial: ≥ 2 Übungen · none
 *   transfer           erkennbar, wenn der Skill einen verlässlichen Detektor hat (nicht "low") und
 *                      eine freie/spontane Übung ihn beiläufig beobachtet (nicht als Lernziel)
 *   avoidance          verpasste Gelegenheit gibt es nur, wo die Aufgabe den Skill ausdrücklich
 *                      verlangt: full: Trainingsübung mit dem Skill als Ziel · none
 *   persistent_error,
 *   recurring_error    Antwort: focus_error_elimination (siehe Planner)
 *   error_improvement  erkennbar, wenn "vermieden" beobachtbar ist · full: und eine Übung provoziert
 *                      den Fehler · partial: nur zufällig in anderen Antworten · none
 */
export function coachingSupport(pattern, c) {
  const n = c.counts;
  const make = (support, reason) => ({ support, reason });
  const productiveStages = (n.free ? 1 : 0) + (n.spontaneous ? 1 : 0);
  switch (pattern) {
    case "false_confidence":
      if (productiveStages === 2) return make("full", "freie und spontane Übung als Antwort vorhanden");
      if (productiveStages === 1) return make("partial", "nur eine produktive Stufe als Antwort vorhanden");
      return make("none", "keine freie/spontane Übung: auf falsche Sicherheit kann nicht reagiert werden");
    case "plateau": {
      const stages = (n.controlled ? 1 : 0) + productiveStages;
      if (stages >= 2 && productiveStages >= 1) return make("full", `${stages} Produktionsstufen zum Wechseln`);
      if (n.exercises >= 2) return make("partial", "mehrere Übungen, aber nur auf einer Stufe");
      return make("none", "keine andere Übungsart zum Wechseln");
    }
    case "transfer":
      if (c.transfer_observable) return make("full", "wird in freien/spontanen Antworten beiläufig beobachtet (alle Detektoren laufen)");
      if (c.detection.incidental_reliability === "low") return make("none", "Detektor zu unsicher für beiläufige Beobachtung (detect_reliability 'low')");
      return make("none", c.detection.detector ? "keine freie/spontane Übung, die ihn nicht trainiert" : "kein Detektor");
    case "avoidance":
      return c.exercises.some((e) => e.role === "target" && e.mode === "training")
        ? make("full", "Trainingsübung verlangt den Skill ausdrücklich: 'nicht verwendet' ist eine verpasste Gelegenheit")
        : make("none", "keine Aufgabe verlangt den Skill ausdrücklich (verdeckte Ziele sind keine Gelegenheit)");
    case "persistent_error":
    case "recurring_error": {
      const response = plannerSupport("focus_error_elimination", c);
      return make(response.support, `erkannt in jeder Antwort; Reaktion: ${response.reason}`);
    }
    case "error_improvement":
      if (!c.detection.avoidance_detectable) return make("none", "kein Muster für die richtige Form: 'vermieden' ist nie beobachtbar, der Fehlerpfad bleibt 'active'");
      return n.exercises
        ? make("full", "Vermeiden beobachtbar, Übungen provozieren den Fehler")
        : make("partial", "Vermeiden beobachtbar, aber nur zufällig in anderen Antworten");
    default:
      return make("none", "unbekanntes Muster");
  }
}

function compatibility(skills, key) {
  const result = {};
  for (const s of skills) {
    for (const [name, { support }] of Object.entries(s[key])) {
      result[name] ??= { full: [], partial: [], none: [] };
      result[name][support].push(s.skill_id);
    }
  }
  return Object.fromEntries(Object.entries(result).sort().map(([name, groups]) => [name, {
    full: groups.full.length, partial: groups.partial.length, none: groups.none.length,
    verdict: verdictOf(groups),
    skills: groups,
  }]));
}

/** full: für alle betroffenen Skills; none: für keinen; sonst partial. */
function verdictOf(groups) {
  if (!groups.partial.length && !groups.none.length) return "full";
  if (!groups.full.length && !groups.partial.length) return "none";
  return "partial";
}

/** Grenzen, die nicht an einzelnen Übungen liegen, sondern an der Art der Beobachtung. */
function systemFindings(skills) {
  const findings = [];
  const unreliable = skills.filter((s) => s.detection.incidental_reliability === "low");
  if (unreliable.length) {
    findings.push({
      kind: "incidental_detection_unreliable",
      statement: `${unreliable.length} Skill(s) mit unsicherem Detektor: Beiläufige Treffer werden festgehalten, zählen aber nicht; `
        + "Transfer ist für sie nicht erkennbar",
      evidence: { skills: unreliable.map((s) => s.skill_id), observation_scope: OBSERVATION_SCOPE },
    });
  }
  const noAvoidance = skills.filter((s) => s.type === SKILL_TYPES.COMMON_ERROR && !s.detection.avoidance_detectable);
  if (noAvoidance.length) {
    findings.push({
      kind: "error_avoidance_not_detectable",
      statement: `${noAvoidance.length} typische Fehler haben kein Muster für die richtige Form: Ihr Fehlerpfad kann nie 'declining' oder 'resolved' werden`,
      evidence: { skills: noAvoidance.map((s) => s.skill_id) },
    });
  }
  const noDetector = skills.filter((s) => s.type === SKILL_TYPES.GRAMMAR_STRUCTURE && !s.detection.detector);
  if (noDetector.length) {
    findings.push({
      kind: "grammar_not_detectable",
      statement: `${noDetector.length} Grammatikstruktur(en) ohne Detektor: Verwendung wird nie als richtig erkannt`,
      evidence: { skills: noDetector.map((s) => s.skill_id) },
    });
  }
  findings.push({
    kind: "flashcards_not_planned",
    statement: "Die Stufe 'erkannt' ist über Karteikarten aus dem Lexikon möglich, der Planner plant Karteikarten aber noch nicht",
    evidence: {
      lexical_items_with_flashcard_data: skills.filter((s) => s.type === SKILL_TYPES.LEXICAL_ITEM && s.detection.flashcard).length,
    },
  });
  return findings;
}

// ---------------------------------------------------------------- Lücken

function gapsOf(s, errorTopics) {
  const n = s.counts;
  const gaps = [];
  const add = (kind, statement, evidence = {}) => gaps.push({
    kind, severity: GAP_SEVERITY[kind], skill_id: s.skill_id, type: s.type, statement, evidence,
  });
  const isError = s.type === SKILL_TYPES.COMMON_ERROR;

  if (n.exercises === 0) {
    add("no_exercises", isError && s.detection.detector
      ? `${s.skill_id}: wird in jeder Antwort erkannt (Coaching), kann aber nicht gezielt trainiert werden: keine Übung provoziert ihn`
      : `${s.skill_id}: keine einzige Übung`, { detector: s.detection.detector });
  } else {
    if (n.free + n.spontaneous === 0) {
      add("no_free_production", `${s.skill_id}: nur kontrollierte/geführte Übungen (${n.controlled}), keine freie Produktion`, { counts: n });
    }
    if (n.spontaneous === 0) add("no_spontaneous_production", `${s.skill_id}: keine spontane Übung (Gespräch)`, { counts: n });
  }
  if (!s.path.realistic) {
    add("no_realistic_path", `${s.skill_id}: Entwicklungspfad endet ${s.path.ends_after ? `nach '${s.path.ends_after}'` : "vor dem ersten Schritt"}; fehlt: ${s.path.missing.join(", ")}`,
      { ends_after: s.path.ends_after, missing: s.path.missing });
  }
  if (s.type === SKILL_TYPES.GRAMMAR_STRUCTURE && !s.detection.detector) {
    add("no_detector", `${s.skill_id}: kein Detektor, richtige Verwendung wird nie erkannt`);
  }
  if (isError && !s.detection.avoidance_detectable) {
    add("avoidance_not_detectable", `${s.skill_id}: kein Muster für die richtige Form, 'vermieden' ist nie beobachtbar`);
  }
  if (s.type === SKILL_TYPES.GRAMMAR_STRUCTURE && !errorTopics.has(s.topic_id)) {
    add("no_error_scenario", `${s.skill_id}: kein typischer Fehler im selben Thema (${s.topic_id}), Fehler werden nicht gezielt erkannt`, { topic_id: s.topic_id });
  }
  return gaps;
}

// ---------------------------------------------------------------- Empfehlungen

const NEED_TEXT = Object.freeze({
  no_exercises: (s) => (s.type === SKILL_TYPES.COMMON_ERROR ? "mindestens eine Übung, die den Fehler provoziert" : "überhaupt eine Übung"),
  no_free_production: () => "mindestens eine freie Produktionsübung (Challenge)",
  no_spontaneous_production: () => "spontane Produktion (Gespräch oder gesprochene Challenge)",
  no_detector: () => "einen Detektor, damit richtige Verwendung erkannt wird",
  avoidance_not_detectable: () => "ein Muster für die richtige Form (damit 'vermieden' beobachtbar wird)",
  no_error_scenario: () => "einen typischen Fehler im selben Thema",
});

/**
 * Eine Empfehlung je Skill mit allen fehlenden Bausteinen. Nutzen:
 *   höchster Grundwert der Lücken (GAP_VALUE) + 5 je weitere Lücke
 *   + 10 Niveau C1/C2 + 5 fortgeschrittenes Thema + 5 Germanismus
 *   + 3 je Planner-Maßnahme, die heute gar nicht unterstützt wird
 */
function recommend(skills, gaps) {
  const bySkill = new Map();
  for (const gap of gaps) {
    if (!NEED_TEXT[gap.kind]) continue;
    bySkill.set(gap.skill_id, [...(bySkill.get(gap.skill_id) ?? []), gap]);
  }
  return [...bySkill].map(([skillId, list]) => {
    const s = skills.find((x) => x.skill_id === skillId);
    const kinds = list.map((g) => g.kind).sort((a, b) => GAP_VALUE[b] - GAP_VALUE[a]);
    const factors = [`+${GAP_VALUE[kinds[0]]} ${kinds[0]}`];
    if (kinds.length > 1) factors.push(`+${5 * (kinds.length - 1)} weitere Lücken (${kinds.length - 1})`);
    if (s.level === "C1" || s.level === "C2") factors.push(`+10 Niveau ${s.level}`);
    if (s.advanced_topic) factors.push("+5 fortgeschrittenes Thema");
    if (s.type === SKILL_TYPES.COMMON_ERROR && isGermanism({ topic_id: s.topic_id, error_kind: s.error_kind })) factors.push("+5 Germanismus");
    const blocked = Object.values(s.planner_support).filter((p) => p.support === "none").length;
    if (blocked) factors.push(`+${3 * blocked} Planner-Maßnahmen ohne Inhalt (${blocked})`);
    const priority = factors.reduce((sum, f) => sum + Number.parseInt(f, 10), 0);
    return {
      skill_id: skillId,
      type: s.type,
      priority,
      needs: kinds.map((k) => ({ gap: k, need: NEED_TEXT[k](s) })),
      statement: `${skillId} benötigt ${kinds.map((k) => NEED_TEXT[k](s)).join("; ")}.`,
      priority_factors: factors,
      classification: s.classification,
    };
  }).sort((a, b) => b.priority - a.priority || (a.skill_id < b.skill_id ? -1 : 1));
}

// ---------------------------------------------------------------- Zusammenfassung

function summarize(library, skills, gaps, recommendations, planner, coaching) {
  const countOf = (list, key) => list.reduce((acc, x) => ({ ...acc, [key(x)]: (acc[key(x)] ?? 0) + 1 }), {});
  const byClass = Object.fromEntries(COVERAGE_CLASSES.map((c) => [c, skills.filter((s) => s.classification === c).length]));
  const byType = Object.fromEntries(Object.values(SKILL_TYPES).map((type) => {
    const ofType = skills.filter((s) => s.type === type);
    return [type, { total: ofType.length, ...Object.fromEntries(COVERAGE_CLASSES.map((c) => [c, ofType.filter((s) => s.classification === c).length])) }];
  }));
  const exercises = library.exercises();
  const areas = new Map();
  for (const r of recommendations) {
    const area = (skills.find((s) => s.skill_id === r.skill_id).topic_id ?? "").split(".").slice(0, 2).join(".");
    const entry = areas.get(area) ?? { area, skills: 0, priority: 0 };
    entry.skills += 1;
    entry.priority += r.priority;
    areas.set(area, entry);
  }
  return {
    total_skills: skills.length,
    by_classification: byClass,
    by_type: byType,
    by_readiness: Object.fromEntries(READINESS_BANDS.map((b) => [b, skills.filter((s) => s.readiness.band === b).length])),
    supports_c1_goal: skills.filter((s) => s.readiness.supports_c1_goal).length,
    complete_paths: skills.filter((s) => s.path.complete).length,
    exercises: {
      total: exercises.length,
      by_evidence: countOf(exercises, (e) => evidenceForExercise(e)),
      by_status: countOf(exercises, (e) => e.status),
    },
    gaps: countOf(gaps, (g) => g.kind),
    planner: Object.fromEntries(Object.entries(planner).map(([k, v]) => [k, { full: v.full, partial: v.partial, none: v.none }])),
    coaching: Object.fromEntries(Object.entries(coaching).map(([k, v]) => [k, { full: v.full, partial: v.partial, none: v.none }])),
    content_priorities: [...areas.values()].sort((a, b) => b.priority - a.priority || (a.area < b.area ? -1 : 1)),
  };
}

function bySeverity(a, b) {
  const order = ["critical", "high", "medium", "low"];
  return order.indexOf(a.severity) - order.indexOf(b.severity) || (a.skill_id < b.skill_id ? -1 : a.skill_id > b.skill_id ? 1 : 0)
    || (a.kind < b.kind ? -1 : 1);
}
