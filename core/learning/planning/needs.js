/**
 * Trainingsbedarf je Skill: Was fehlt, wie dringend ist es, und welche Nachweisstufe
 * soll die nächste Übung ansprechen?
 *
 * Eingabe ist ein Skill aus dem CompetenceSnapshot plus seine Inhaltsdaten
 * (Niveau, Thema, Fehlerart, fortgeschrittenes Thema) und, wenn vorhanden, sein Wiederholungsstand.
 * Alles ist deterministisch und begründet: Jede Priorität setzt sich aus benannten Bausteinen
 * zusammen (factors: {key, value, label}; priority_factors: dieselben als Text).
 *
 * Sprachneutral: Welche Themen "fortgeschritten" sind, steht im Inhalt (topics: advanced = true,
 * gilt für Unterthemen mit), nicht im Code.
 *
 * ─── Bedarfsarten (erste passende Regel gewinnt) ──────────────────────────────
 *
 *   Bedarf            Grundwert  Wann                                          Ziel-Nachweisstufe
 *   active_error        60       typischer Fehler, Fehlerpfad "active"         guided, nach erstem Vermeiden free
 *   production_weak     55       auf einer Stufe sicher (≥ 3 Erfolge, ≥ 80 %),  die schwache Stufe
 *                                auf der nächsten schwach (≥ 2 Versuche, < 60 %): (free bzw. spontaneous)
 *                                kontrolliert → frei/spontan, oder frei → spontan
 *   unstable            55       Grammatik/Wortschatz mit Fehlern und          eine Stufe unter dem bisher Besten
 *                                Quote < 75 % oder wiederholtem Fehler         (guided oder controlled)
 *   production_gap      45       sicher in kontrollierten Übungen (Erfolge an  free
 *                                ≥ 2 Tagen, Quote ≥ 75 %), nie frei produziert
 *   production_gap      40       frei produziert, "stable", nie spontan        spontaneous
 *   consolidate         35       "introduced"/"practicing" ohne Fehlerbild     nächste Stufe über dem bisher Besten
 *   declining_error     30       typischer Fehler, Fehlerpfad "declining"      free, dann spontaneous
 *   new                 20       noch nie beobachtet                           controlled (P14B: Kaltstart,
 *                                                                                  behutsam einführen, dann gelenkt/frei)
 *   stable              15       "stable" ohne Lücke                           spontaneous
 *   maintenance          5       "mastered" und laut Wiederholungsmodell fällig spontaneous
 *                                (ohne Wiederholungsstand: ≥ 21 Tage nicht gesehen)
 *   (keiner)             –       "mastered" und nicht fällig, Fehler "resolved" → wird nicht geplant
 *
 * ─── Zuschläge und Abschläge ──────────────────────────────────────────────────
 *
 *   +15 Fehler kürzlich erneut (recent_relapse)     +10 Fehler an ≥ 3 Tagen (repeated)
 *   +10 Germanismus (Fehlerart GERMANISM oder Thema interference.*)
 *   +10 Niveau C1/C2                                 +5 fortgeschrittenes Thema (Inhalt: advanced)
 *   −15 heute schon ≥ 3-mal geübt (Abwechslung über Sessions hinweg)
 */

import { SKILL_TYPES, parseSkillId } from "../../content/skills.js";

export const NEED_BASE = Object.freeze({
  active_error: 60,
  production_weak: 55,
  unstable: 55,
  production_gap: 45,
  production_gap_spontaneous: 40,
  consolidate: 35,
  declining_error: 30,
  new: 20,
  stable: 15,
  maintenance: 5,
});

export const NEED_RULES = Object.freeze({
  unstableAccuracy: 0.75,
  sureMinDays: 2,
  maintenanceAfterDays: 21, // nur ohne Wiederholungsstand
  saturatedPerDay: 3,
  weakControlledMin: 3,
  weakControlledRate: 0.8,
  weakFreeMin: 2,
  weakFreeRate: 0.6,
});

const ADVANCED_LEVELS = new Set(["C1", "C2"]);
const LADDER = ["recognized", "controlled", "guided", "free", "spontaneous"];
const DAY_MS = 86_400_000;

/**
 * @param {object} skill   Eintrag aus snapshot.skills
 * @param {{level?: string|null, topic_id?: string|null, label?: string, error_kind?: string|null, advanced?: boolean}} meta
 * @param {Date} asOf
 * @param {object|null} [review]  Eintrag aus dem ReviewSnapshot (für die Kontrolle beherrschter Skills)
 * @returns {null | {need: string, priority: number, target_evidence: string, reason: string,
 *   factors: {key: string, value: number, label: string}[], priority_factors: string[]}}
 */
export function assessSkill(skill, meta, asOf, review = null) {
  const base = baseNeed(skill, asOf, review);
  if (!base) return null;

  const factors = [{ key: "need", value: base.value, label: base.label }];
  const add = (key, value, label) => factors.push({ key, value, label });
  if (skill.errors.status === "recent_relapse") add("error_relapse", 15, "Fehler kürzlich erneut");
  else if (skill.errors.status === "repeated") add("error_repeated", 10, "Fehler an mehreren Tagen");
  if (isGermanism(meta)) add("interference", 10, "Germanismus");
  if (ADVANCED_LEVELS.has(meta.level)) add("level", 10, `Niveau ${meta.level}`);
  if (meta.advanced) add("advanced_topic", 5, "fortgeschrittenes Thema");
  if (signalsOn(skill, asOf) >= NEED_RULES.saturatedPerDay) add("saturation", -15, "heute schon mehrfach geübt");

  return {
    need: base.need,
    priority: factors.reduce((sum, f) => sum + f.value, 0),
    target_evidence: base.target,
    reason: base.reason,
    factors,
    priority_factors: factors.map(factorText),
  };
}

export function factorText(factor) {
  return `${factor.value > 0 ? "+" : ""}${factor.value} ${factor.label}`;
}

/** Inhaltsdaten eines Skills, die Bedarf und Priorität brauchen (Planner und Coaching). */
export function skillMeta(library, skillId) {
  const entry = library.skill(skillId);
  const { type, refId } = parseSkillId(skillId);
  const topicId = entry?.topic_id ?? null;
  return {
    label: entry?.label ?? skillId,
    level: entry?.level ?? null,
    topic_id: topicId,
    error_kind: type === SKILL_TYPES.COMMON_ERROR ? library.commonError(refId)?.kind ?? null : null,
    // P12: verletzte Kompetenz eines typischen Fehlers (z. B. lexical_item:depender_de), sonst null
    competence: type === SKILL_TYPES.COMMON_ERROR ? library.commonError(refId)?.competence || null : null,
    advanced: isAdvancedTopic(library, topicId),
  };
}

export function isGermanism(meta) {
  return meta.error_kind === "GERMANISM" || (meta.topic_id ?? "").startsWith("interference");
}

/** Ist das Thema (oder eines seiner Oberthemen) im Inhalt als fortgeschritten markiert? */
export function isAdvancedTopic(library, topicId) {
  let id = typeof topicId === "string" ? topicId : null;
  while (id) {
    const topic = library.topic(id);
    if (topic?.advanced) return true;
    id = topic?.parent_id ?? (id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null);
  }
  return false;
}

function baseNeed(skill, asOf, review) {
  const highest = skill.highest_success_evidence;
  const need = (key, target, reason, label = reason) => ({
    need: key.startsWith("production_gap") ? "production_gap" : key,
    value: NEED_BASE[key],
    target,
    reason,
    label,
  });

  if (skill.mastery === "unknown") {
    // P14B Kaltstart: unbekannt ist weder beherrscht noch zu schwer; erst kontrolliert einführen, dann die Leiter hinauf
    return need("new", "controlled", "noch nie beobachtet: behutsam kontrolliert einführen (Kaltstart)", "noch nie beobachtet");
  }

  if (skill.type === SKILL_TYPES.COMMON_ERROR) {
    const stage = skill.path.stage;
    if (stage === "active") {
      const avoided = skill.since_last_failure.successes;
      return need("active_error", avoided > 0 ? "free" : "guided",
        avoided > 0
          ? `aktiver Fehler (${skill.errors.occurrences}× aufgetreten), seitdem ${avoided}× vermieden: in freier Produktion prüfen`
          : `aktiver Fehler (${skill.errors.occurrences}× aufgetreten), seitdem nie vermieden: gezielt provozieren`,
        "aktiver Fehler");
    }
    if (stage === "declining") {
      return need("declining_error", nextAbove(highest, "free"),
        "Fehler wird seltener: in freier Kommunikation festigen", "Fehler wird seltener");
    }
    // none (nur vermieden) oder resolved: wie jeder andere Skill nach Stufe
  } else if (weakStep(skill)) {
    const step = weakStep(skill);
    return need("production_weak", step.target,
      `${step.strongLabel} sicher, ${step.weakLabel} schwach (${step.weak.successes} von ${step.weak.successes + step.weak.failures} richtig)`,
      `${step.weakLabel} schwach`);
  } else if (isUnstable(skill)) {
    const target = highest && LADDER.indexOf(highest) >= LADDER.indexOf("guided") ? "guided" : "controlled";
    return need("unstable", target,
      `instabil: zuletzt ${percent(skill.recent_accuracy)} richtig, Fehler ${skill.errors.occurrences}×`, "instabil");
  } else if (isSureControlled(skill) && rank(highest) < rank("free")) {
    return need("production_gap", "free",
      "in kontrollierten Übungen sicher, aber nie frei produziert", "Lücke: keine freie Produktion");
  } else if (skill.mastery === "stable" && highest === "free") {
    return need("production_gap_spontaneous", "spontaneous",
      "frei produziert, aber nie spontan", "Lücke: keine spontane Produktion");
  }

  if (skill.mastery === "introduced" || skill.mastery === "practicing") {
    return need("consolidate", nextAbove(highest, "controlled"),
      `${skill.mastery === "introduced" ? "eingeführt" : "wird geübt"}: festigen (${skill.next_level_missing[0] ?? "nächste Stufe"})`,
      "festigen");
  }
  if (skill.mastery === "stable") {
    return need("stable", nextAbove(highest, "spontaneous"), "stabil: gelegentlich anspruchsvoller anwenden", "stabil");
  }
  // mastered: Kontrolle, wenn das Wiederholungsmodell sie fällig sieht
  const daysAway = skill.last_seen_at ? Math.floor((asOf.getTime() - Date.parse(skill.last_seen_at)) / DAY_MS) : Infinity;
  if (review && review.phase !== "new") {
    if (review.due_status === "due" || review.due_status === "overdue") {
      return need("maintenance", "spontaneous",
        `beherrscht, Wiederholung fällig (seit ${daysAway} Tagen nicht gesehen, Abruf ${percent(review.retrievability)})`,
        "beherrscht, Kontrolle");
    }
    return null;
  }
  if (daysAway >= NEED_RULES.maintenanceAfterDays) {
    return need("maintenance", "spontaneous", `beherrscht, seit ${daysAway} Tagen nicht gesehen: kurz prüfen`, "beherrscht, Kontrolle");
  }
  return null;
}

/** Erfolge und Fehler über mehrere Nachweisstufen. */
function stats(skill, levels) {
  return levels.reduce((sum, level) => ({
    successes: sum.successes + skill.evidence[level].successes,
    failures: sum.failures + skill.evidence[level].failures,
  }), { successes: 0, failures: 0 });
}

/**
 * Auf einer Stufe sicher, auf der nächsten schwach: kontrolliert → frei/spontan (z. B. Lückentext 95 %,
 * frei 45 %) oder frei → spontan. Ziel ist die schwache Stufe, nicht ein Schritt zurück.
 */
export function weakStep(skill) {
  if (skill.type === SKILL_TYPES.COMMON_ERROR) return null;
  const rules = NEED_RULES;
  const sure = (s) => s.successes >= rules.weakControlledMin && s.successes / (s.successes + s.failures) >= rules.weakControlledRate;
  const weak = (s) => s.successes + s.failures >= rules.weakFreeMin && s.successes / (s.successes + s.failures) < rules.weakFreeRate;
  const controlled = stats(skill, ["controlled", "guided"]);
  const freeOrSpontaneous = stats(skill, ["free", "spontaneous"]);
  if (sure(controlled) && weak(freeOrSpontaneous)) {
    return { target: "free", strongLabel: "unter Kontrolle", weakLabel: "frei", weak: freeOrSpontaneous };
  }
  const free = stats(skill, ["free"]);
  const spontaneous = stats(skill, ["spontaneous"]);
  if (sure(free) && weak(spontaneous)) {
    return { target: "spontaneous", strongLabel: "frei", weakLabel: "spontan", weak: spontaneous };
  }
  return null;
}

/** "In kontrollierten Übungen sicher": wiederholt gelungen, zuletzt überwiegend richtig. */
function isSureControlled(skill) {
  return ["practicing", "stable"].includes(skill.mastery)
    && skill.success_days >= NEED_RULES.sureMinDays
    && (skill.recent_accuracy ?? 0) >= NEED_RULES.unstableAccuracy;
}

function isUnstable(skill) {
  if (skill.failures === 0) return false;
  return (skill.recent_accuracy ?? 0) < NEED_RULES.unstableAccuracy
    || skill.errors.status === "recent_relapse"
    || skill.errors.status === "repeated";
}

/** Die nächste Nachweisstufe über der bisher besten (mindestens `floor`). */
function nextAbove(highest, floor) {
  const next = Math.min(rank(highest) + 1, LADDER.length - 1);
  return LADDER[Math.max(next, LADDER.indexOf(floor))];
}

function rank(level) {
  return level ? LADDER.indexOf(level) : -1;
}

function signalsOn(skill, asOf) {
  const today = asOf.toISOString().slice(0, 10);
  const entry = skill.history_by_day.find((d) => d.day === today);
  return entry ? entry.successes + entry.failures : 0;
}

function percent(value) {
  return value === null ? "–" : `${Math.round(value * 100)} %`;
}
