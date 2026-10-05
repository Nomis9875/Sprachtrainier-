/**
 * LearningNeed v1: Was sollte der Lerner als Nächstes lernen, wiederholen oder festigen, und warum?
 * (Adaptive Learning Brain, Teil 2)
 *
 *   CompetenceSnapshot + ReviewSnapshot ─scoreSkillForSession()─▶ Grundpriorität (Bedarf + Wiederholung)
 *   Lernprofil + Erinnerungen            ─BRAIN_RULES────────────▶ weitere benannte Faktoren
 *                                                                  ─▶ LearningNeed (sortiert)
 *
 * Es gibt KEINE zweite Bedarfslogik: Die Grundpriorität kommt unverändert aus planning/priority.js
 * (Bedarf aus needs.js, Wiederholung aus dem ReviewSnapshot). Das Brain ergänzt nur, was dort fehlt,
 * jeweils als benannter Faktor {key, value, label} mit Begründung. Die Priorität ist die Summe.
 *
 * ─── Faktoren des Brain (BRAIN_RULES) ────────────────────────────────────────
 *
 *   one_off            −25   einzelner Fehler ohne Muster: einmal prüfen (Zweck "review"), nicht als festes
 *                            Problem behandeln und kein neues Material verdrängen (bleibt unter "akut" = 55)
 *   memory_persistent   +5   hartnäckiger Fehler (Erinnerung, Fehler über ≥ 21 Tage)
 *   memory_weakening   −10   Fehler lässt nach (seit dem letzten Fehler richtig): weniger drängen
 *   error_unverified     0   (P13) lange Ruhe ohne richtige Verwendung: kein Abzug, erneut prüfen
 *   error_avoided       +5   (P13) in freien Aufgaben umgangen: Ziel "guided" (die Aufgabe verlangt die Struktur)
 *   memory_resolved    −20   Fehler überwunden (auch auf der Stufe des Fehlers gezeigt): nicht weiter drillen
 *   memory_avoidance   +10   Struktur wird wiederholt umgangen (verpasste Gelegenheit, "richtig, aber einfach"):
 *                            kein Fehler, aber Bedarf an freier Anwendung → Zweck "production", Ziel ≥ free
 *   memory_gap          +5   bestätigte Produktionslücke (Erinnerung production_gap)
 *   proven_variety     −10   seit dem letzten Fehler ≥ 3× richtig, in ≥ 2 verschiedenen Übungen,
 *                            ≥ 3 Erfolge in Folge: sicher in verschiedenen Kontexten, keine sinnlose Wiederholung
 *
 * Überwunden, aber die Gesamtquote noch niedrig (Kompetenzbedarf "instabil"/"aktiver Fehler"): kein Fehlerfokus
 * mehr, sondern Festigen (Zweck "consolidate") auf mindestens der zuletzt erfolgreich gezeigten Stufe, nicht darunter.
 * (Gefunden in der Real-User-Validation P10A, Journey E.)
 *
 * Schwierigkeit (target_difficulty): Ziel ist die Stufe knapp über dem sicheren Niveau (so entscheidet
 * es schon der Bedarf). Ausnahme "backoff": zwei Fehler in Folge auf Stufe L → kurz eine Stufe darunter
 * (nie unter "controlled"). Wird eine Struktur umgangen, ist das Ziel mindestens "free".
 *
 * Ohne positive Priorität kein Bedarf (z. B. überwunden und nicht fällig): Der Skill wird nicht geplant.
 *
 * Produktionsprofil (P13, competence/production.js): Jeder Bedarf nennt, welche Art Nachweis fehlt
 * (production.missing_evidence) und ob eine Produktionslücke besteht (eine Stufe sicher, die nächste schwach).
 * Bei einer Lücke ist der Grund "production_gap", auch wenn die Fehler wiederkehren: Wer im Lückentext 7 von 8
 * richtig hat und frei 2 von 6, hat kein Regelproblem, sondern ein Übertragungsproblem. Nur ein hartnäckiger
 * Fehler (seit Wochen) oder ein umgangener bleibt als solcher benannt.
 */

import { evidenceRank } from "../competence/evidence.js";
import { productionProfile } from "../competence/production.js";
import { skillMeta } from "../planning/needs.js";
import { scoreSkillForSession } from "../planning/priority.js";
import { factorText } from "../planning/needs.js";

export const LEARNING_NEED_VERSION = 1;
const LADDER = Object.freeze(["recognized", "controlled", "guided", "free", "spontaneous"]);

export const BRAIN_RULES = Object.freeze({
  memory: Object.freeze({ persistent: 5, weakening: -10, resolved: -20, avoidance: 10, gap: 5, avoidedError: 5 }),
  oneOff: -25,
  provenVariety: Object.freeze({ minSuccesses: 3, minExercises: 2, minStreak: 3, value: -10 }),
  backoffAfterFailures: 2,
  /** Normierung der Priorität auf 0..1 (100 Punkte = 1.0). */
  priorityScale: 100,
});

/** Welche Übungsform passt zu welcher Nachweisstufe (Übungsart beeinflusst die Kompetenzbewertung). */
export const RECOMMENDED_EXERCISE = Object.freeze({
  recognized: { mode: "training", kind: "recognition", label: "Erkennen" },
  controlled: { mode: "training", kind: "controlled", label: "kontrollierte Übung (Lücke, Umformung)" },
  guided: { mode: "training", kind: "guided_production", label: "gelenkte Produktion (Training, Struktur genannt)" },
  free: { mode: "challenge", kind: "free_production", label: "freie Produktion (Challenge, Ziel verdeckt)" },
  spontaneous: { mode: "challenge", kind: "conversation", label: "spontane Kommunikation (Gespräch)" },
});

const ERROR_PRESSURE = Object.freeze({
  none: 0, overcome: 0.05, one_off: 0.25, weakening: 0.3, unverified: 0.6, avoided: 0.7, recurring: 0.7, persistent: 0.9,
});
const URGENCY_VALUE = Object.freeze({ none: 0, low: 0.3, medium: 0.6, high: 1 });

/**
 * Alle Lernbedarfe, dringendste zuerst (Gleichstand: Skill-ID).
 * @param {{profile: object, snapshot: object, reviews: object, library: object}} input
 */
export function deriveLearningNeeds({ profile, snapshot, reviews, library }) {
  const now = new Date(snapshot.generated_at);
  const profileOf = new Map(profile.skills.map((s) => [s.skill_id, s]));
  const reviewOf = new Map(reviews.items.map((i) => [i.skill_id, i]));
  return snapshot.skills
    .map((skill) => learningNeedFor({
      skill, meta: skillMeta(library, skill.skill_id), review: reviewOf.get(skill.skill_id) ?? null,
      profileSkill: profileOf.get(skill.skill_id), now,
    }))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (a.skill_id < b.skill_id ? -1 : 1));
}

/**
 * Lernbedarf eines Skills oder null (kein Bedarf).
 * @param {{skill: object, meta: object, review: object|null, profileSkill: object, now: Date}} input
 */
export function learningNeedFor({ skill, meta, review, profileSkill, now }) {
  const base = scoreSkillForSession({ skill, meta, review, now });
  if (!base) return null;
  const factors = [...base.factors];
  const reasons = [...base.reasons];
  const add = (key, value, label) => {
    factors.push({ key, value, label });
    reasons.push(label);
  };
  let purpose = base.purpose;
  let target = base.target_evidence;
  let difficultyBasis = "Bedarf: Stufe knapp über dem sicheren Niveau";

  const memories = profileSkill?.memories ?? [];
  const open = (type) => memories.find((m) => m.memory_type === type && ["candidate", "active"].includes(m.status));
  const rules = BRAIN_RULES.memory;
  if (profileSkill.error_state === "one_off" && (base.need === "active_error" || base.need === "unstable")) {
    add("one_off", BRAIN_RULES.oneOff, "einzelner Fehler: erst prüfen, ob es ein Muster ist");
    if (purpose === "error_focus") purpose = "review";
  }
  if (profileSkill.error_state === "persistent") add("memory_persistent", rules.persistent, "hartnäckiger Fehler (seit Wochen)");
  if (profileSkill.error_state === "weakening") add("memory_weakening", rules.weakening, "Fehler lässt nach (seitdem richtig)");
  if (profileSkill.error_state === "unverified") {
    reasons.push("lange nicht beobachtet, aber nie richtig gezeigt: erneut prüfen (Ruhe ist kein Beleg)");
  }
  if (profileSkill.error_state === "avoided") {
    add("error_avoided", rules.avoidedError, "in freien Aufgaben umgangen: gezielt verlangen");
    if (evidenceRank(target) > evidenceRank("guided")) {
      target = "guided";
      difficultyBasis = "umgangener Fehler: die Aufgabe verlangt die Struktur ausdrücklich";
    }
  }
  if (profileSkill.error_state === "overcome") {
    add("memory_resolved", rules.resolved, "Fehler überwunden");
    if (purpose === "error_focus") {
      purpose = "consolidate";
      const reached = skill.highest_success_evidence;
      if (reached && evidenceRank(target) < evidenceRank(reached)) {
        target = reached;
        difficultyBasis = "Fehler überwunden: auf der erreichten Stufe festigen";
      }
    }
  }
  if (open("avoided_structure")) {
    add("memory_avoidance", rules.avoidance, "wird oft umgangen: frei anwenden");
    if (["consolidate", "challenge", "new"].includes(purpose)) purpose = "production";
    if (evidenceRank(target) < evidenceRank("free")) {
      target = "free";
      difficultyBasis = "umgangene Struktur: freie Anwendung";
    }
  }
  if (open("production_gap")) add("memory_gap", rules.gap, "bestätigte Produktionslücke");

  const stats = profileSkill.stats;
  const variety = BRAIN_RULES.provenVariety;
  const safe = !["recurring", "persistent"].includes(profileSkill.error_state);
  // nicht bei neuen Skills und nicht bei der Kontrolle beherrschter Skills (die Kontrolle ist der Zweck)
  if (safe && !["new", "maintenance"].includes(base.need) && stats.successes_since_last_failure >= variety.minSuccesses
    && stats.exercises_succeeded >= variety.minExercises && stats.consecutive_successes >= variety.minStreak) {
    add("proven_variety", variety.value, "zuletzt sicher in verschiedenen Übungen");
  }

  const backoff = backoffLevel(skill);
  if (backoff && evidenceRank(target) >= evidenceRank(backoff.failed)) {
    target = backoff.target;
    difficultyBasis = `${BRAIN_RULES.backoffAfterFailures} Fehler in Folge auf '${backoff.failed}': kurz eine Stufe zurück`;
    reasons.push(difficultyBasis);
  }

  const score = factors.reduce((sum, f) => sum + f.value, 0);
  if (score <= 0) return null;
  const errorState = profileSkill.error_state;
  const production = productionProfile(skill);
  const reasonCode = reasonCodeOf(base.need, errorState, factors, purpose, production);
  return {
    version: LEARNING_NEED_VERSION,
    skill_id: skill.skill_id,
    label: profileSkill.label,
    // P12: bei typischen Fehlern die verletzte Kompetenz (z. B. lexical_item:depender_de), sonst null
    competence: meta.competence ?? null,
    need: base.need,
    reason_code: reasonCode,
    purpose,
    score,
    priority: round2(Math.min(1, score / BRAIN_RULES.priorityScale)),
    reason: base.reason,
    reasons,
    factors,
    priority_factors: factors.map(factorText),
    competence_stage: {
      mastery: skill.mastery,
      highest_evidence: skill.highest_success_evidence,
      secure_evidence: profileSkill.competence.secure_evidence,
      status: profileSkill.status,
    },
    error_state: errorState,
    error_pressure: round2(Math.min(1, ERROR_PRESSURE[errorState] + (skill.errors.status === "recent_relapse" ? 0.1 : 0))),
    repetition_urgency: URGENCY_VALUE[profileSkill.repetition?.urgency ?? "none"],
    recency_days: stats.last_seen_days,
    target_evidence: target,
    target_difficulty: { evidence: target, secure_evidence: profileSkill.competence.secure_evidence, basis: difficultyBasis },
    recommended_exercise: { evidence: target, ...RECOMMENDED_EXERCISE[target] },
    production,
    evidence: {
      attempts: stats.attempts,
      successes: stats.successes,
      failures: stats.failures,
      error_rate: stats.error_rate,
      consecutive_successes: stats.consecutive_successes,
      consecutive_failures: stats.consecutive_failures,
      successes_since_last_failure: stats.successes_since_last_failure,
      exercises_succeeded: stats.exercises_succeeded,
      last_seen_days: stats.last_seen_days,
      last_failure_at: stats.last_failure_at,
      review: profileSkill.repetition ? {
        phase: profileSkill.repetition.phase, due_status: profileSkill.repetition.due_status,
        retrievability: profileSkill.repetition.retrievability,
      } : null,
      memory_ids: memories.filter((m) => m.status !== "superseded").map((m) => m.memory_id),
    },
  };
}

/** Zwei (BRAIN_RULES.backoffAfterFailures) Fehler in Folge: auf welcher Stufe, und wohin zurück? */
function backoffLevel(skill) {
  const recent = skill.recent.filter((r) => r.outcome === "success" || r.outcome === "failure");
  const tail = recent.slice(-BRAIN_RULES.backoffAfterFailures);
  if (tail.length < BRAIN_RULES.backoffAfterFailures || !tail.every((r) => r.outcome === "failure")) return null;
  const failed = tail.at(-1).evidence;
  const rank = Math.max(LADDER.indexOf("controlled"), LADDER.indexOf(failed) - 1);
  return { failed, target: LADDER[rank] };
}

/** Hauptgrund in einem Wort (für Tests, Debug und kurze Hinweise). */
function reasonCodeOf(need, errorState, factors, purpose, production) {
  if (errorState === "persistent") return "persistent_error";
  if (errorState === "avoided") return "avoided_error";
  if (errorState === "unverified") return "unverified_error";
  if (production.gap && need !== "new" && errorState !== "overcome") return "production_gap";
  if (errorState === "overcome" && purpose === "consolidate") return "consolidate";
  if (errorState === "recurring") return "recurring_error";
  if (need === "active_error" || need === "unstable") {
    return errorState === "weakening" ? "error_fading" : errorState === "one_off" ? "single_error_check" : "recent_error";
  }
  if (factors.some((f) => f.key === "memory_avoidance")) return "avoidance";
  if (need === "production_weak" || need === "production_gap") return "production_gap";
  if (need === "maintenance") return "maintenance";
  if (purpose === "review" || factors.some((f) => f.key === "review_due")) return "review_due";
  if (need === "new") return "new_skill";
  return "consolidate";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
