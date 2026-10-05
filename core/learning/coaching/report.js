/**
 * CoachingReport v1: Was ist passiert, warum, welche Muster, welcher Fortschritt,
 * was als Nächstes?
 *
 * ─── Architekturregel ──────────────────────────────────────────────────────────
 *
 *   Coaching Reports sind Projektionen, kein gespeicherter Zustand.
 *   Ereignisse → CompetenceSnapshots (heute und 4 frühere Stichtage) → Analyse → Bericht.
 *   Die Wahrheit bleiben die Ereignisse; der Bericht ist jederzeit neu berechenbar und
 *   ergibt für dieselben Eingaben immer dasselbe Ergebnis.
 *
 * Keine KI: Alle Aussagen entstehen aus festen Regeln (analysis.js, planning/needs.js)
 * und tragen die Zahlen, auf denen sie beruhen (evidence), plus einen Verweis auf das
 * Datenblatt des Skills (evidence_ref → supporting_evidence).
 *
 * ─── Format ────────────────────────────────────────────────────────────────────
 *
 *   format, version, generated_at, user_id
 *   overall_assessment   Kopfzeile, Anzahl je Stufe/Entwicklung/Fehlerlage/Trend
 *   strengths[]          höchstens eine Stärke je Skill (die stärkste)
 *   weaknesses[]         höchstens eine Schwäche je Skill (die gravierendste)
 *   patterns[]           alle erkannten Muster, auch skillübergreifend (error_cluster)
 *   recommendations[]    Handlungen, nach Priorität; je Handlung die betroffenen Skills
 *   supporting_evidence[] Datenblätter der erwähnten Skills (Zahlen, Verlauf, Kontexte)
 *   metadata             Stichtage, Ereignisbasis, Regeln, persisted: false
 */

import { SKILL_TYPES } from "../../content/skills.js";
import { MASTERY_RULES, TREND_RULES } from "../competence/mastery.js";
import { buildCompetenceSnapshot } from "../competence/snapshot.js";
import { assessSkill, skillMeta } from "../planning/needs.js";
import {
  developmentProfile, ERROR_PATTERN_RULES, errorPatterns, FALSE_CONFIDENCE_RULES, falseConfidence,
  plateau, PLATEAU_RULES, progression, transfer,
} from "./analysis.js";

export const COACHING_REPORT_FORMAT = "coaching_report";
export const COACHING_REPORT_VERSION = 1;

/** Stichtage für den Verlauf: heute und je 7 Tage zurück. */
export const CHECKPOINT_DAYS = Object.freeze([28, 21, 14, 7, 0]);

export const RECOMMENDATIONS = Object.freeze({
  start_diagnostic: "Standortbestimmung starten",
  focus_error_elimination: "Fehler gezielt abbauen",
  increase_production_difficulty: "Schwierigkeit der Produktion steigern",
  focus_lexical_activation: "Wortschatz aktivieren",
  move_to_spontaneous_production: "Zur spontanen Produktion übergehen",
  continue_reinforcement: "Weiter festigen",
});

const STRENGTH_ORDER = ["transfer", "spontaneous_production", "error_improvement", "rapid_progress", "stable_skill", "free_production", "improving"];
const WEAKNESS_ORDER = ["persistent_error", "recurring_error", "false_confidence", "plateau", "declining", "unstable"];
const PATTERN_ORDER = ["persistent_error", "recurring_error", "error_cluster", "false_confidence", "plateau", "avoidance",
  "declining", "transfer", "error_improvement", "improving"];
const DAY_MS = 86_400_000;
const MAX_RECOMMENDATIONS = 5;

/**
 * @param {{events: object[], userId: string, asOf: Date, library: import("../../content/library.js").ContentLibrary}} input
 */
export function buildCoachingReport({ events, userId, asOf, library }) {
  const skillIds = library.skills().map((s) => s.id);
  const checkpoints = CHECKPOINT_DAYS.map((days) => new Date(asOf.getTime() - days * DAY_MS));
  const snapshots = checkpoints.map((at) => buildCompetenceSnapshot({
    events, userId, asOf: at, skillIds, contentVersion: library.contentVersion ?? null,
  }));
  const now = snapshots.at(-1);
  const timelines = new Map();
  for (const snapshot of snapshots) {
    for (const s of snapshot.skills) {
      const list = timelines.get(s.skill_id) ?? [];
      list.push({ at: snapshot.generated_at, mastery: s.mastery, highest_success_evidence: s.highest_success_evidence });
      timelines.set(s.skill_id, list);
    }
  }

  const analyses = now.skills
    .filter((s) => s.mastery !== "unknown" || s.missed_opportunities > 0)
    .map((skill) => analyze(skill, skillMeta(library, skill.skill_id), timelines.get(skill.skill_id), library, asOf));

  const patterns = [...analyses.flatMap(patternsOf), ...errorClusters(analyses)].sort(byOrder(PATTERN_ORDER));
  const strengths = analyses.map(bestStrength).filter(Boolean).sort(byOrder(STRENGTH_ORDER));
  const weaknesses = analyses.map(worstWeakness).filter(Boolean).sort(byOrder(WEAKNESS_ORDER));
  const recommendations = recommend(analyses);

  const referenced = new Set([...patterns, ...strengths, ...weaknesses].flatMap((x) => x.skill_ids ?? [x.skill_id])
    .concat(recommendations.flatMap((r) => r.skill_ids)));
  const supporting = analyses.filter((a) => referenced.has(a.skill.skill_id)).map(dataSheet);

  return {
    format: COACHING_REPORT_FORMAT,
    version: COACHING_REPORT_VERSION,
    generated_at: now.generated_at,
    user_id: userId,
    overall_assessment: overall(now, analyses),
    strengths,
    weaknesses,
    patterns,
    recommendations,
    supporting_evidence: supporting,
    metadata: {
      content_version: library.contentVersion ?? null,
      event_count: now.metadata.event_count,
      last_event_at: now.metadata.last_event_at,
      checkpoints: checkpoints.map((c) => c.toISOString()),
      derivation: "event_replay",
      persisted: false,
      rules: {
        mastery: MASTERY_RULES, trend: TREND_RULES, plateau: PLATEAU_RULES,
        false_confidence: FALSE_CONFIDENCE_RULES, error_patterns: ERROR_PATTERN_RULES,
      },
    },
  };
}

// ---------------------------------------------------------------- Analyse je Skill

function analyze(skill, meta, timeline, library, asOf) {
  const plateauFinding = plateau(skill, timeline);
  return {
    skill,
    meta,
    ref: `skill:${skill.skill_id}`,
    timeline,
    development: developmentProfile(skill),
    progression: progression(timeline),
    falseConfidence: falseConfidence(skill),
    plateau: plateauFinding,
    transfer: transfer(skill),
    errors: errorPatterns(skill, asOf),
    trend: plateauFinding ? "plateau" : skill.trend,
    need: assessSkill(skill, meta, asOf),
  };
}

function patternsOf(a) {
  const { skill, meta, ref } = a;
  const label = meta.label;
  const list = [];
  const add = (kind, statement, evidence) => list.push({ kind, skill_ids: [skill.skill_id], statement, evidence, evidence_ref: ref });

  if (a.errors.persistent) {
    const e = a.errors.persistent;
    add("persistent_error", `${label}: hartnäckiger Fehler (persistent_error), an ${e.occurrence_days} Tagen über ${e.span_days} Tage, `
      + `seit dem letzten Mal ${e.avoided_since_last}× vermieden`, e);
  }
  if (a.errors.recurring) {
    const e = a.errors.recurring;
    add("recurring_error", `${label}: ${e.failures} Fehler an ${e.days} Tagen in den letzten ${e.window_days} Tagen, `
      + "ein wiederkehrendes Muster, kein Ausrutscher", e);
  }
  if (a.falseConfidence) add("false_confidence", falseConfidenceText(label, a.falseConfidence), { kind: a.falseConfidence.kind, ...a.falseConfidence.evidence });
  if (a.plateau) {
    const p = a.plateau.evidence;
    add("plateau", `${label}: seit ${p.window_days} Tagen unverändert '${a.plateau.level}', obwohl an ${p.practice_days_in_window} Tagen `
      + `geübt wurde (${p.signals_in_window} Nachweise)`, p);
  }
  if (skill.missed_opportunities >= 3) {
    add("avoidance", `${label}: ${skill.missed_opportunities}× hätte die Struktur gepasst, wurde aber vermieden`,
      { missed_opportunities: skill.missed_opportunities, successes: skill.successes });
  }
  if (a.trend === "declining" || a.trend === "improving") {
    const b = skill.trend_basis;
    add(a.trend, `${label}: Quote richtig von ${pct(b.previous)} auf ${pct(b.recent)} (je ${b.window_days} Tage)`, b);
  }
  if (a.transfer?.detected) add("transfer", transferText(label, a.transfer), a.transfer);
  if (a.errors.improvement) {
    const e = a.errors.improvement;
    add("error_improvement", `${label}: Fehler wird seltener, seit dem letzten Auftreten ${e.avoided_since_last}× vermieden `
      + `(Fehlerpfad '${e.path_stage}')`, e);
  }
  return list;
}

/** Mehrere aktive Fehler im selben Themenbereich (erste zwei Ebenen, z. B. grammar.prepositions). */
function errorClusters(analyses) {
  const groups = new Map();
  for (const a of analyses) {
    const active = a.errors.recurring || a.errors.persistent || a.skill.path.stage === "active";
    if (!active || !a.meta.topic_id || !a.skill.failures) continue;
    const area = a.meta.topic_id.split(".").slice(0, 2).join(".");
    groups.set(area, [...(groups.get(area) ?? []), a]);
  }
  return [...groups].filter(([, list]) => list.length >= 2).map(([area, list]) => ({
    kind: "error_cluster",
    skill_ids: list.map((a) => a.skill.skill_id).sort(),
    statement: `Fehler häufen sich im Bereich ${area}: ${list.length} Skills mit aktuellen Fehlern`,
    evidence: { area, skills: list.map((a) => ({ skill_id: a.skill.skill_id, failures: a.skill.failures, last_failure_at: a.skill.last_failure_at })) },
    evidence_ref: null,
  }));
}

function bestStrength(a) {
  const { skill, meta, ref } = a;
  const label = meta.label;
  const stages = a.development?.stages ?? {};
  const spontaneous = stages.spontaneous ?? stages.used_spontaneously;
  const free = stages.free ?? stages.used_freely;
  const candidates = [];
  const add = (kind, statement, evidence) => candidates.push({ kind, skill_id: skill.skill_id, statement, evidence, evidence_ref: ref });

  if (a.transfer?.detected) add("transfer", transferText(label, a.transfer), a.transfer);
  if (spontaneous && spontaneous.successes >= 2) {
    add("spontaneous_production", `${label}: ${spontaneous.successes}× spontan richtig verwendet`, { spontaneous_successes: spontaneous.successes, spontaneous_failures: spontaneous.failures });
  }
  if (a.errors.improvement) {
    const e = a.errors.improvement;
    add("error_improvement", `${label}: Fehler wird seltener (Fehlerpfad '${e.path_stage}', ${e.avoided_since_last}× vermieden)`, e);
  }
  if (a.progression.steps >= 2) {
    const p = a.progression;
    add("rapid_progress", `${label}: in ${p.window_days} Tagen von '${p.from}' auf '${p.to}'`, p);
  }
  if (["stable", "mastered"].includes(skill.mastery)) {
    const collocation = skill.type === SKILL_TYPES.LEXICAL_ITEM && ["C1", "C2"].includes(meta.level) ? ` (${meta.level}-Ausdruck)` : "";
    add("stable_skill", `${label}: Stufe '${skill.mastery}'${collocation}`, { mastery: skill.mastery, evidence_score: skill.evidence_score, success_days: skill.success_days, level: meta.level });
  }
  if (free && free.successes >= 2) add("free_production", `${label}: ${free.successes}× in freier Produktion richtig`, { free_successes: free.successes, free_failures: free.failures });
  if (a.trend === "improving") add("improving", `${label}: Quote richtig steigt`, skill.trend_basis);
  const best = candidates.sort(byOrder(STRENGTH_ORDER))[0] ?? null;
  // Bei falscher Sicherheit ist "stabil" oder "frei richtig" keine echte Stärke
  if (best && a.falseConfidence && ["stable_skill", "free_production"].includes(best.kind)) return null;
  return best;
}

function worstWeakness(a) {
  const { skill, meta, ref } = a;
  const found = patternsOf(a).filter((p) => WEAKNESS_ORDER.includes(p.kind));
  if (!found.length && (a.need?.need === "unstable" || a.need?.need === "active_error")) {
    found.push({ kind: "unstable", skill_ids: [skill.skill_id], statement: `${meta.label}: ${a.need.reason}`,
      evidence: { recent_accuracy: skill.recent_accuracy, failures: skill.failures, successes: skill.successes, errors: skill.errors }, evidence_ref: ref });
  }
  const worst = found.sort(byOrder(WEAKNESS_ORDER))[0];
  if (!worst) return null;
  const { skill_ids: ids, ...rest } = worst;
  return { ...rest, skill_id: ids[0] };
}

// ---------------------------------------------------------------- Empfehlungen

function recommend(analyses) {
  if (!analyses.some((a) => a.skill.mastery !== "unknown")) {
    return [{
      action: "start_diagnostic", title_de: RECOMMENDATIONS.start_diagnostic, priority: 100, skill_ids: [],
      statement: "Noch keine Nachweise: eine erste Session mit freier Produktion zeigt, wo du stehst",
      evidence: [{ observed_skills: 0 }], evidence_refs: [],
    }];
  }
  const groups = new Map();
  for (const a of analyses) {
    const decision = actionFor(a);
    if (!decision) continue;
    const entry = groups.get(decision.action) ?? [];
    entry.push({ a, ...decision });
    groups.set(decision.action, entry);
  }
  return [...groups].map(([action, list]) => {
    list.sort((x, y) => y.priority - x.priority || (x.a.skill.skill_id < y.a.skill.skill_id ? -1 : 1));
    return {
      action,
      title_de: RECOMMENDATIONS[action],
      priority: list[0].priority,
      skill_ids: list.map((x) => x.a.skill.skill_id),
      statement: `${RECOMMENDATIONS[action]}: ${list.map((x) => `${x.a.meta.label} (${x.because})`).join("; ")}`,
      evidence: list.map((x) => ({
        skill_id: x.a.skill.skill_id, priority: x.priority, because: x.because,
        need: x.a.need?.need ?? null, priority_factors: x.factors,
      })),
      evidence_refs: list.map((x) => x.a.ref),
    };
  }).sort((x, y) => y.priority - x.priority || (x.action < y.action ? -1 : 1)).slice(0, MAX_RECOMMENDATIONS);
}

/**
 * Handlung je Skill (erste passende Regel):
 *   hartnäckiger/wiederkehrender/aktiver Fehler           → focus_error_elimination
 *   falsche Sicherheit (nur kontrolliert / frei schwach),
 *   Plateau unterhalb freier Produktion, Lücke "nie frei" → increase_production_difficulty
 *                                                           (Wortschatz: focus_lexical_activation)
 *   fast nur kontrolliert belegt (Grammatik),
 *   Lücke "nie spontan", stabil ohne spontane Nutzung     → move_to_spontaneous_production
 *   (nur solange es noch keine spontane Nutzung gibt)
 *   instabil, festigen, Plateau                           → continue_reinforcement
 * Priorität = Priorität des Bedarfs (planning/needs.js) + 10 hartnäckig + 10 wiederkehrend
 *             + 10 Plateau + 5 falsche Sicherheit.
 */
function actionFor(a) {
  const need = a.need?.need ?? null;
  const factors = [...(a.need?.priority_factors ?? [])];
  let priority = a.need?.priority ?? 20;
  const bump = (value, label) => {
    priority += value;
    factors.push(`+${value} ${label}`);
  };
  if (a.errors.persistent) bump(10, "hartnäckiger Fehler");
  if (a.errors.recurring) bump(10, "wiederkehrender Fehler");
  if (a.plateau) bump(10, "Plateau");
  if (a.falseConfidence) bump(5, "falsche Sicherheit");

  const lexical = a.skill.type === SKILL_TYPES.LEXICAL_ITEM;
  const harder = lexical ? "focus_lexical_activation" : "increase_production_difficulty";
  const belowFree = !["free", "used_freely", "spontaneous", "used_spontaneously"].includes(a.development?.reached);
  const spontaneousUsed = ["spontaneous", "used_spontaneously"].includes(a.development?.reached);
  const result = (action, because) => ({ action, because, priority, factors });

  if (a.errors.persistent) return result("focus_error_elimination", "hartnäckiger Fehler");
  if (a.errors.recurring) return result("focus_error_elimination", "wiederkehrender Fehler");
  if (need === "active_error" || need === "declining_error") return result("focus_error_elimination", a.need.reason);
  if (a.falseConfidence?.kind === "controlled_only") return result(harder, "nur in kontrollierten Übungen sicher");
  if (a.falseConfidence?.kind === "weak_when_free") return result(harder, "unter Kontrolle sicher, frei schwach");
  if (a.falseConfidence?.kind === "mostly_controlled") {
    return result(lexical ? "focus_lexical_activation" : "move_to_spontaneous_production", "fast nur unter Kontrolle belegt");
  }
  if (a.plateau && belowFree) return result(harder, `Plateau auf '${a.plateau.level}' ohne freie Produktion`);
  if (need === "production_gap" && a.need.target_evidence === "free") return result(harder, a.need.reason);
  if (!spontaneousUsed && (need === "production_gap" || need === "stable" || a.falseConfidence?.kind === "not_spontaneous")) {
    return result("move_to_spontaneous_production", a.need?.reason ?? "nie spontan verwendet");
  }
  if (need === "unstable" || need === "consolidate" || a.plateau) {
    return result("continue_reinforcement", a.plateau ? `Plateau auf '${a.plateau.level}'` : a.need.reason);
  }
  return null;
}

// ---------------------------------------------------------------- Gesamtbild und Datenblätter

function overall(snapshot, analyses) {
  const observed = analyses.filter((a) => a.skill.mastery !== "unknown");
  const reached = (names) => observed.filter((a) => names.includes(a.development?.reached)).length;
  const development = {
    spontaneous: reached(["spontaneous", "used_spontaneously"]),
    free: reached(["free", "used_freely"]),
    controlled_only: reached(["controlled", "reproduced"]),
    recognized_only: reached(["recognized"]),
  };
  const errors = {
    active: observed.filter((a) => a.skill.type === SKILL_TYPES.COMMON_ERROR && a.skill.path.stage === "active").length,
    recurring: analyses.filter((a) => a.errors.recurring).length,
    persistent: analyses.filter((a) => a.errors.persistent).length,
    improving: analyses.filter((a) => a.errors.improvement).length,
  };
  const trends = { improving: 0, stable: 0, declining: 0, plateau: 0, insufficient_data: 0 };
  for (const a of observed) trends[a.trend] += 1;
  const s = snapshot.summary;
  const headline = observed.length === 0
    ? "Noch keine Lerndaten: Standortbestimmung empfohlen."
    : `${observed.length} Skills beobachtet: ${development.spontaneous} spontan, ${development.free} frei, `
      + `${development.controlled_only} nur unter Kontrolle produziert; ${errors.active} aktive Fehler`
      + `${errors.persistent ? `, davon ${errors.persistent} hartnäckig` : ""}.`;
  return {
    headline,
    observed_skills: observed.length,
    by_mastery: {
      unknown: s.unknown_skills, introduced: s.introduced_skills, practicing: s.practicing_skills,
      stable: s.stable_skills, mastered: s.mastered_skills,
    },
    development,
    errors,
    trends,
  };
}

function dataSheet(a) {
  const { skill, meta } = a;
  return {
    id: a.ref,
    skill_id: skill.skill_id,
    label: meta.label,
    type: skill.type,
    level: meta.level,
    topic_id: meta.topic_id,
    mastery: skill.mastery,
    mastery_timeline: a.timeline.map((t) => ({ at: t.at, mastery: t.mastery, highest_success_evidence: t.highest_success_evidence })),
    path_stage: skill.path.stage,
    trend: a.trend,
    trend_basis: skill.trend_basis,
    recent_accuracy: skill.recent_accuracy,
    successes: skill.successes,
    failures: skill.failures,
    missed_opportunities: skill.missed_opportunities,
    development: a.development,
    errors: skill.errors,
    failure_days: skill.history_by_day.filter((d) => d.failures > 0),
    exercise_contexts: skill.exercise_contexts,
    transfer: a.transfer,
  };
}

// ---------------------------------------------------------------- Texte und Hilfen

function falseConfidenceText(label, finding) {
  const e = finding.evidence;
  if (finding.kind === "controlled_only") {
    return `${label}: ${e.controlled_successes}× richtig in kontrollierten Übungen, aber nie frei oder spontan verwendet: `
      + "das ist noch keine volle Beherrschung";
  }
  if (finding.kind === "mostly_controlled") {
    return `${label}: stabil unter Kontrolle (${e.controlled_successes}× richtig), frei und spontan aber kaum belegt `
      + `(${e.free_successes}× frei, ${e.spontaneous_successes}× spontan)`;
  }
  if (finding.kind === "weak_when_free") {
    return `${label}: unter Kontrolle sicher (${e.controlled_successes}× richtig), frei aber schwach `
      + `(${e.free_successes + e.spontaneous_successes} richtig, ${e.free_failures + e.spontaneous_failures} falsch)`;
  }
  return `${label}: Stufe '${e.mastery}', aber nie spontan verwendet`;
}

function transferText(label, t) {
  const where = t.transferred_to.map((x) => `${x.exercise_id} (${x.highest_success_evidence})`).join(", ");
  return `${label}: außerhalb der Trainingsübungen richtig verwendet, in ${where}`;
}

function pct(span) {
  const total = span.successes + span.failures;
  return total ? `${Math.round((span.successes / total) * 100)} %` : "–";
}

function byOrder(order) {
  const id = (x) => x.skill_id ?? x.skill_ids?.[0] ?? "";
  return (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
}
