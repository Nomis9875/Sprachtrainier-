/**
 * Empirische Kalibrierung (P14B): Wie schwer sind Aufgaben und Skills TATSÄCHLICH, und liegt ein Problem beim
 * Lerner oder bei der Aufgabe? Eine Projektion aus den Lernereignissen, nie gespeichert, jederzeit neu berechenbar.
 * Deterministisch, reines JavaScript, browserfähig; keine KI (Qwen-Hinweise zählen nie: nur verbindliche
 * Beobachtungen und Befunde gehen ein).
 *
 * ─── Zwei Ebenen, nie vermischt ───────────────────────────────────────────────
 *
 *   Lerner-Evidenz  (Lerner × Sprache)            Sprachprofil, Kompetenz, Gedächtnis, Bedarfe (wie bisher)
 *   Item-Evidenz    (Sprache × Inhalt × Aufgabe)  HIER: alle Lerner dieser Sprache auf diesem Gerät zusammen
 *
 * Eine falsche Antwort sagt zuerst etwas über den Lerner. Über die Aufgabe sagt sie nur etwas im Vergleich zu dem,
 * was von DIESEM Lerner DAMALS zu erwarten war: Jede Antwort wird gegen die Fähigkeit des Lerners VOR der Antwort
 * gestellt (derselbe Schätzer wie das Sprachprofil, createDimensionTracker). Scheitert ein B1-Lerner an einer
 * B2-Aufgabe, war das erwartet (kaum Item-Evidenz); scheitern mehrere C1-Lerner, ist das starke Item-Evidenz.
 * Lerner ohne verlässliche Schätzung (Sicherheit < medium) liefern keine Item-Evidenz (nicht normalisierbar).
 *
 * ─── Schätzung ────────────────────────────────────────────────────────────────
 *
 *   Aufgabe  Verteilung über die Schwierigkeit b, Prior = Handwert (Aufgabenschwierigkeit, taxonomy.py) mit
 *            Streuung prior_sd; jede Antwort: P(richtig) = c + (1−c)·σ(1,7·(θ − b)), Gewicht =
 *            Lerner-Sicherheit (medium 0,5, high 1) × Wiederholung (1/n je Lerner und Aufgabe, wie P14A).
 *            Wenig Evidenz → der Prior dominiert (Schrumpfung); viel Evidenz → die Beobachtung.
 *   Skill    dasselbe je Nachweisstufe (erkannt … spontan), Prior = Stufe des Skills + Stufenversatz (wie im
 *            Sprachprofil); daraus die Grundschwierigkeit und je Stufe eine eigene Schätzung (Produktions-
 *            schwierigkeit) und je Kontext (Satz, Text, langer Text, Gespräch) die Erfolgsquote.
 *
 * GER bleibt Inhaltsmetadatum: content_level wird nie geändert; die empirische Schwierigkeit steht daneben.
 *
 * ─── Status und Sicherheit (dieselben Breiten wie P14A, hier: verschiedene LERNER) ─
 *
 *   prior                  keine normalisierbare Antwort: der Handwert gilt
 *   insufficient_evidence  gewichtet < 3
 *   emerging               < 3 verschiedene Lerner (Sicherheit low): Schätzung sichtbar, aber nicht verwendet
 *   calibrated             ≥ 3 Lerner (medium), ≥ 6 Lerner und gewichtet ≥ 6 (high)
 *   unstable               wie calibrated, aber erste und zweite Hälfte der Evidenz weichen ≥ unstable_delta ab
 *
 * Qualität (Diagnose, nie Löschen): healthy · too_easy / too_hard (kalibriert, ≥ flag_delta vom Handwert und das
 * 80-%-Intervall schließt ihn aus) · unstable · possible_mismatch (Metadaten widersprüchlich) · insufficient_evidence.
 */

import { readEvaluation } from "../../evaluation/result.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { PRODUCTION_RULES, productionGap } from "../competence/production.js";
import { audioFeatures, guessingOf, isListening, isListeningOnly, listeningScore, listeningWeight } from "../listening/model.js";
import { difficultyProfile, exerciseDifficulty, ZONE_RULES } from "../planning/zone.js";
import { DIMENSIONS, PROFILE_EVIDENCE_RULES, collectMeasurements, dimensionOfSkill, performanceScore } from "../profile/evidence.js";
import { PROFILE_RULES, createDimensionTracker } from "../profile/language-profile.js";
import { difficultyPosterior, repetitionWeight, summarize } from "../profile/measurement.js";
import { exerciseDimensions } from "../profile/needs.js";
import { levelOf, levelValue } from "../profile/scale.js";
import { eventLanguage } from "../../util/language.js";

export const CALIBRATION_VERSION = 1;
export const CALIBRATION_RULES = Object.freeze({
  prior_sd: 0.6, // Handwert ist informativ: eine Stufe Abweichung braucht deutliche Evidenz
  learner_weight: Object.freeze({ medium: 0.5, high: 1 }),
  min_weight: PROFILE_RULES.breadth_for_medium, // 3
  learners_for_medium: PROFILE_RULES.breadth_for_medium, // 3
  learners_for_high: PROFILE_RULES.breadth_for_high, // 6
  flag_delta: 1.0, // auffällig leicht/schwer: mindestens eine GER-Stufe vom Handwert
  unstable_delta: 0.75,
  level_spread: 2, // Inhalt, Skills und Aufgabe liegen ≥ 2 GER-Stufen auseinander
});
const DIMENSION_ORDER = ["conversation", "production", "reading", "listening", "grammar", "vocabulary"];
const RELIABLE = new Set(["medium", "high"]);

/** Welche Nachweisstufen eine Aufgabenkategorie messen soll (docs/exercise-taxonomy.md). */
export const CATEGORY_EVIDENCE = Object.freeze({
  recognition: ["recognized"], multiple_choice: ["recognized"], reading: ["recognized"],
  listening: ["recognized", "controlled", "guided"], // P15: Auswahl, Diktat, Antwort auf das Gehörte
  gap_fill: ["controlled"], cloze: ["controlled"], collocation: ["controlled"], vocabulary_recall: ["controlled"],
  transformation: ["controlled"], translation: ["controlled"], error_correction: ["controlled"],
  reformulation: ["controlled", "guided"], short_production: ["guided", "free"], open_production: ["guided", "free"],
  conversation: ["spontaneous"],
});

/**
 * @param {{events: object[], library: object, languageId: string, asOf: Date, learnerCache?: Map}} input
 *   events: Ereignisse ALLER Lerner dieser Sprache (storage.listEvents({language})); andere Sprachen werden verworfen
 *   learnerCache: optionaler Zwischenspeicher je Lerner (Map, vom Aufrufer gehalten). Ein Lerner wird nur neu
 *     durchgerechnet, wenn sich seine Ereignisse (Anzahl, letzte ID) oder die Inhaltsversion geändert haben.
 *     Das Ergebnis ist mit und ohne Zwischenspeicher identisch; er ist abgeleitet, nie eine zweite Wahrheit.
 */
export function buildCalibration({ events, library, languageId, asOf, learnerCache = null }) {
  if (!(asOf instanceof Date)) throw new TypeError("buildCalibration: asOf (Stichtag) ist Pflicht");
  const until = asOf.toISOString();
  const byLearner = new Map();
  for (const e of events) {
    if (eventLanguage(e) !== languageId || !(e.created_at <= until)) continue;
    const list = byLearner.get(e.user_id) ?? [];
    list.push(e);
    byLearner.set(e.user_id, list);
  }
  const items = new Map();
  const skills = new Map();
  let skipped = 0;
  for (const [learnerId, own] of [...byLearner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const key = `${library.contentVersion ?? ""}|${own.length}|${own.at(-1)?.id ?? ""}`;
    let evidence = learnerCache?.get(learnerId)?.key === key ? learnerCache.get(learnerId).value : null;
    if (!evidence) {
      evidence = { items: new Map(), skills: new Map(), skipped: 0 };
      evidence.skipped = learnerPass({ learnerId, own, library, items: evidence.items, skills: evidence.skills });
      learnerCache?.set(learnerId, { key, value: evidence });
    }
    merge(items, evidence.items, (entry, add) => {
      entry.observations.push(...add.observations);
      entry.attempts += add.attempts;
      for (const l of add.learners) entry.learners.add(l);
    }, () => ({ observations: [], learners: new Set(), attempts: 0 }));
    merge(skills, evidence.skills, (entry, add) => {
      entry.observations.push(...add.observations);
      for (const l of add.learners) entry.learners.add(l);
    }, () => ({ observations: [], learners: new Set() }));
    skipped += evidence.skipped;
  }
  const itemResults = {};
  // alle Übungen und Einstufungsaufgaben, dazu beantwortete Gesprächsschritte
  const catalog = [...library.exercises(), ...library.assessmentItems().map((i) => library.assessmentExercise(`assessment/${i.id}`))]
    .filter(Boolean).map((e) => e.id);
  for (const id of new Set([...catalog, ...[...items.keys()].sort()])) {
    itemResults[id] = itemCalibration(library.anyExercise(id), items.get(id), library);
  }
  const skillResults = {};
  for (const skill of library.skills()) skillResults[skill.id] = skillCalibration(skill, skills.get(skill.id));
  const list = Object.values(itemResults);
  return {
    format: "spanisch-ai.calibration",
    version: CALIBRATION_VERSION,
    scope: "language_content", // Sprache × Inhalt × Aufgabe; lernerspezifisches steht im Sprachprofil
    language_id: languageId,
    content_version: library.contentVersion ?? null,
    as_of: until,
    derived: true, // Projektion aus den Ereignissen, nie eine zweite Wahrheit
    learners: byLearner.size,
    items: itemResults,
    skills: skillResults,
    summary: {
      items: list.length,
      by_status: countBy(list.map((i) => i.calibration_status)),
      by_quality: countBy(list.map((i) => i.quality)),
      mismatches: list.filter((i) => i.mismatch.length).length,
      unnormalized_answers: skipped,
    },
    rules: CALIBRATION_RULES,
  };
}

// ---------------------------------------------------------------- ein Lerner (Fähigkeit vor jeder Antwort)

function learnerPass({ learnerId, own, library, items, skills }) {
  const measurements = collectMeasurements({ events: own, library });
  const byAttempt = new Map();
  for (const m of measurements) {
    const list = byAttempt.get(m.attempt_id) ?? [];
    list.push(m);
    byAttempt.set(m.attempt_id, list);
  }
  const trackers = Object.fromEntries(DIMENSIONS.map((d) => [d, createDimensionTracker()]));
  const cache = new Map(); // Dimension → Stand, gültig bis zur nächsten Messung dieses Bereichs
  const state = (d) => {
    if (!cache.has(d)) {
      const s = trackers[d].peek();
      cache.set(d, s && RELIABLE.has(s.confidence) ? s : null);
    }
    return cache.get(d);
  };
  const overall = () => {
    const known = DIMENSIONS.map(state).filter(Boolean);
    if (known.length < 2) return null;
    const thetas = known.map((s) => s.theta).sort((a, b) => a - b);
    const mid = thetas.length / 2;
    const theta = thetas.length % 2 ? thetas[Math.floor(mid)] : (thetas[mid - 1] + thetas[mid]) / 2;
    return { theta, confidence: known.every((s) => s.confidence === "high") ? "high" : "medium" };
  };
  const repeats = new Map();
  let skipped = 0;
  const attempts = own.filter((e) => e.event_type === "attempt").sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const seenAttempts = new Set();
  for (const attempt of attempts) {
    if (seenAttempts.has(attempt.id)) continue;
    seenAttempts.add(attempt.id);
    const exercise = library.anyExercise(attempt.payload.exercise_id);
    const view = safeView(attempt.payload.evaluation);
    if (exercise && view && view.overall.outcome !== "not_evaluated") {
      const assessment = (byAttempt.get(attempt.id) ?? []).find((m) => m.source === "assessment") ?? null;
      const ability = abilityFor(exercise, assessment, state, overall);
      const n = bump(repeats, `${exercise.id}`);
      if (ability) {
        // P15: Höraufgaben mit ihrer Hörleistung und dem Gewicht aus Hilfe und Hörwiederholungen (listening/model.js)
        const listening = isListening(exercise);
        const score = assessment ? assessment.score
          : listening ? listeningScore(exercise, { outcome: view.overall.outcome, answerText: attempt.payload.answer_text })
            : exercise.evaluation_mode === "open" ? performanceScore(exercise, view)
              : view.overall.outcome === "correct" ? 1 : 0;
        const guessing = assessment ? assessment.guessing : listening ? guessingOf(exercise)
          : exercise.type === "multiple_choice" ? 1 / Math.max(2, (exercise.options ?? []).length) : 0;
        const support = listening ? listeningWeight(attempt.payload.listening ?? {}) : 1;
        const entry = items.get(exercise.id) ?? { observations: [], learners: new Set(), attempts: 0 };
        entry.observations.push({ ability: ability.theta, score, guessing, at: attempt.created_at,
          weight: CALIBRATION_RULES.learner_weight[ability.confidence] * repetitionWeight(n) * support });
        entry.learners.add(learnerId);
        entry.attempts += 1;
        items.set(exercise.id, entry);
      } else {
        skipped += 1;
      }
      // reine Höraufgaben liefern keine schriftliche Skill-Evidenz (P15), auch nicht für die Skill-Kalibrierung
      if (!assessment && !isListeningOnly(exercise)) addSkillObservations({ view, exercise, attempt, learnerId, library, skills, state, repeats });
    }
    for (const m of byAttempt.get(attempt.id) ?? []) {
      trackers[m.dimension].add(m);
      cache.delete(m.dimension);
    }
  }
  return skipped;
}

function abilityFor(exercise, assessment, state, overall) {
  if (assessment) return state(assessment.dimension) ?? overall();
  const dims = exerciseDimensions(exercise);
  for (const d of DIMENSION_ORDER) if (dims.has(d) && state(d)) return state(d);
  return overall();
}

function addSkillObservations({ view, exercise, attempt, learnerId, library, skills, state, repeats }) {
  const context = difficultyProfile(exercise).context;
  for (const o of view.observations) {
    if (!o.authoritative || !(o.outcome === "demonstrated" || o.outcome === "error") || !PROFILE_EVIDENCE_RULES.reliability_weight[o.reliability]) continue;
    const skill = library.skill(o.skill_id);
    if (!skill?.level) continue;
    const ability = state(dimensionOfSkill(skill, library));
    if (!ability) continue;
    const n = bump(repeats, `${o.skill_id}|${exercise.id}`);
    const entry = skills.get(o.skill_id) ?? { observations: [], learners: new Set() };
    entry.observations.push({
      stage: o.evidence, context, learner: learnerId, ability: ability.theta, score: o.outcome === "demonstrated" ? 1 : 0,
      weight: CALIBRATION_RULES.learner_weight[ability.confidence] * repetitionWeight(n) * PROFILE_EVIDENCE_RULES.reliability_weight[o.reliability],
      at: attempt.created_at,
    });
    entry.learners.add(learnerId);
    skills.set(o.skill_id, entry);
  }
}

// ---------------------------------------------------------------- Aufgabe

function itemCalibration(exercise, entry, library) {
  const assessmentItem = String(exercise.id).startsWith("assessment/") ? library.assessmentItem(exercise.id.replace(/^assessment\//, "")) : null;
  const prior = assessmentItem ? round(levelValue(assessmentItem.level) + PROFILE_EVIDENCE_RULES.level_offset) : exerciseDifficulty(exercise);
  const profile = difficultyProfile(exercise);
  const observations = entry?.observations ?? [];
  const fit = estimateFrom(prior, observations);
  const learners = entry?.learners.size ?? 0;
  const status = statusOf(fit, learners);
  const mismatch = mismatchOf(exercise, library, prior);
  const quality = qualityOf(status, fit, prior, mismatch);
  return {
    item_id: exercise.id,
    content_level: exercise.level ?? assessmentItem?.level ?? null, // GER: Inhaltsmetadatum, nie überschrieben
    prior,
    estimate: fit.estimate,
    interval80: fit.interval80,
    confidence: confidenceOf(status, fit, learners),
    effective: status === "calibrated" ? fit.estimate : prior, // was der Planer verwendet
    observations: observations.length,
    weighted_observations: round(fit.weight),
    unique_learners: learners,
    unique_attempts: entry?.attempts ?? 0,
    production_component: profile.production,
    context_component: profile.context,
    content_component: profile.content,
    audio_difficulty: audioDifficulty(exercise, library),
    stability: fit.stability,
    calibration_status: status,
    quality,
    mismatch,
  };
}

/** Posterior über b; dazu erste und zweite Hälfte (nach Gewicht, zeitlich) für die Stabilität. */
function estimateFrom(prior, observations, shift = () => 0) {
  // Gleiche Likelihoods zusammenfassen (Fähigkeit auf das Raster gerundet, gleiches Ergebnis, gleiche Ratewahrscheinlichkeit):
  // das Produkt gleicher Faktoren ist ein Faktor mit summiertem Gewicht. Hält die Kosten je Aufgabe klein (linear).
  const fitOf = (list) => {
    const buckets = new Map();
    for (const o of list) {
      const ability = Math.round((o.ability - shift(o)) * 20) / 20;
      const key = `${ability}|${Math.round(o.score * 20)}|${o.guessing ?? 0}`;
      const b = buckets.get(key) ?? { ability, score: Math.round(o.score * 20) / 20, guessing: o.guessing ?? 0, weight: 0 };
      b.weight += o.weight;
      buckets.set(key, b);
    }
    const sorted = [...buckets.values()].sort((x, y) => x.ability - y.ability || x.score - y.score || x.guessing - y.guessing);
    return summarize(difficultyPosterior({ mean: prior, sd: CALIBRATION_RULES.prior_sd }, sorted));
  };
  const weight = observations.reduce((sum, o) => sum + o.weight, 0);
  const all = fitOf(observations);
  let stability = null;
  if (weight >= 2 * CALIBRATION_RULES.min_weight) {
    let acc = 0;
    const cut = observations.findIndex((o) => (acc += o.weight) >= weight / 2);
    const first = fitOf(observations.slice(0, cut + 1)).theta;
    const second = fitOf(observations.slice(cut + 1)).theta;
    stability = { first_half: first, second_half: second, delta: round(Math.abs(second - first)) };
  }
  return { estimate: all.theta, interval80: all.interval80, sd: all.sd, weight, stability };
}

function statusOf(fit, learners) {
  if (fit.weight === 0) return "prior";
  if (fit.weight < CALIBRATION_RULES.min_weight) return "insufficient_evidence";
  if (learners < CALIBRATION_RULES.learners_for_medium) return "emerging";
  if (fit.stability && fit.stability.delta >= CALIBRATION_RULES.unstable_delta) return "unstable";
  return "calibrated";
}

function confidenceOf(status, fit, learners) {
  if (status !== "calibrated") return status === "prior" ? "none" : "low";
  return learners >= CALIBRATION_RULES.learners_for_high && fit.weight >= CALIBRATION_RULES.learners_for_high ? "high" : "medium";
}

function qualityOf(status, fit, prior, mismatch) {
  if (status === "unstable") return "unstable";
  if (status === "calibrated") {
    const [lower, upper] = fit.interval80;
    if (fit.estimate - prior >= CALIBRATION_RULES.flag_delta && lower > prior) return "too_hard";
    if (prior - fit.estimate >= CALIBRATION_RULES.flag_delta && upper < prior) return "too_easy";
  }
  if (mismatch.length) return "possible_mismatch";
  return status === "calibrated" ? "healthy" : "insufficient_evidence";
}

/**
 * Widersprüchliche Metadaten (ohne Evidenz erkennbar):
 *   level_spread     Inhaltsniveau, Niveaus der Ziel-Skills und Aufgabenschwierigkeit liegen ≥ 2 Stufen auseinander
 *   production_form  die Aufgabe misst eine andere Nachweisstufe, als ihre Kategorie verspricht
 */
export function mismatchOf(exercise, library, prior = exerciseDifficulty(exercise)) {
  const out = [];
  const targetSkills = [
    ...(exercise.structures ?? []).filter((s) => s.is_target).map((s) => `grammar_structure:${s.rule_id}`),
    ...(exercise.target_items ?? []).map((i) => `lexical_item:${i}`),
  ];
  const levels = [
    exercise.level ? { what: "content", value: levelValue(exercise.level) } : null,
    ...targetSkills.map((id) => library.skill(id)?.level).filter(Boolean).map((l) => ({ what: "skill", value: levelValue(l) })),
    Number.isFinite(prior) ? { what: "task", value: levelValue(levelOf(prior)) } : null,
  ].filter(Boolean);
  if (levels.length >= 2) {
    const values = levels.map((l) => l.value);
    if (Math.max(...values) - Math.min(...values) >= CALIBRATION_RULES.level_spread) {
      out.push({ kind: "level_spread", detail: levels.map((l) => `${l.what} ${levelOf(l.value)}`).join(", ") });
    }
  }
  const expected = CATEGORY_EVIDENCE[exercise.category];
  const evidence = evidenceForExercise(exercise);
  if (expected && !expected.includes(evidence)) {
    out.push({ kind: "production_form", detail: `Kategorie ${exercise.category} misst ${expected.join("/")}, Aufgabe misst ${evidence}` });
  }
  return out;
}

/**
 * Hör-Merkmale einer Aufgabe (P15), getrennt von Inhalt, Aufgabe und empirischer Schwierigkeit. Was die Datei oder die
 * Quelle nicht hergibt, bleibt "unknown"; der Akzent ist Metadatum und macht eine Aufgabe nicht automatisch schwerer.
 */
/** Hör-Merkmale am Item (Information; der Handwert bleibt, P16-Zuschlag nur in der Lernzone, listening/model.js). */
function audioDifficulty(exercise, library) {
  const features = audioFeatures(exercise, exercise?.listening ? library.audio?.(exercise.listening.audio) : null);
  if (!features) return null;
  const { speech_rate, context_length, accent, speaker_count, noise, source_type, base_support, measure } = features;
  return { speech_rate, context_length, accent, speaker_count, noise, source_type, base_support, measure };
}

// ---------------------------------------------------------------- Skill

function skillCalibration(skill, entry) {
  const prior = skill.level ? round(levelValue(skill.level) + PROFILE_EVIDENCE_RULES.level_offset) : null;
  const observations = entry?.observations ?? [];
  const learners = entry?.learners.size ?? 0;
  const offset = (o) => PROFILE_EVIDENCE_RULES.evidence_offset[o.stage] ?? 0;
  const fit = prior === null ? null : estimateFrom(prior, observations, offset);
  const status = fit ? statusOf(fit, learners) : "prior";
  const split = {};
  const pseudo = { evidence: {} };
  for (const stage of ["recognized", "controlled", "guided", "free", "spontaneous"]) {
    const list = observations.filter((o) => o.stage === stage);
    const weighted = list.reduce((s, o) => s + o.weight, 0);
    const successes = list.reduce((s, o) => s + o.weight * o.score, 0);
    pseudo.evidence[stage] = { successes, failures: weighted - successes };
    const stageFit = prior === null || !list.length ? null : estimateFrom(prior + (PROFILE_EVIDENCE_RULES.evidence_offset[stage] ?? 0), list);
    split[stage] = {
      weighted: round(weighted),
      success_rate: weighted ? round(successes / weighted) : null,
      estimate: stageFit ? stageFit.estimate : null,
      status: stageFit ? statusOf(stageFit, new Set(list.map((o) => o.learner)).size || learners) : "prior",
    };
  }
  const contexts = {};
  for (const o of observations) {
    const c = contexts[o.context] ??= { weighted: 0, successes: 0 };
    c.weighted += o.weight;
    c.successes += o.weight * o.score;
  }
  return {
    skill_id: skill.id,
    content_level: skill.level ?? null,
    prior_difficulty: prior,
    estimated_difficulty: fit ? fit.estimate : null,
    confidence: fit ? confidenceOf(status, fit, learners) : "none",
    calibration_status: status,
    observation_count: observations.length,
    weighted_observations: round(fit?.weight ?? 0),
    unique_learners: learners,
    production_split: split,
    // Erkennen/kontrolliert sicher, frei/spontan schwach (Schwellen wie das Produktionsprofil, P13)
    production_gap: productionGap(pseudo) ?? populationGap(pseudo.evidence),
    context_split: Object.fromEntries(Object.entries(contexts).map(([k, v]) => [k, { weighted: round(v.weighted), success_rate: round(v.successes / v.weighted) }])),
  };
}

/**
 * Produktionslücke über die Lerner hinweg: Anders als beim einzelnen Lerner fehlen oft Zwischenstufen (viele
 * erkennen, einige schreiben frei, kaum jemand macht die Lückenübung). Daher: niedrigste schwache Stufe über einer
 * sicheren, nicht nur Nachbarstufen. Schwellen wie PRODUCTION_RULES (sicher ≥ 3 und ≥ 80 %, schwach ≥ 2 und < 60 %).
 */
function populationGap(evidence) {
  const stages = ["recognized", "controlled", "guided", "free", "spontaneous"];
  const rate = (s) => evidence[s].successes / (evidence[s].successes + evidence[s].failures);
  const sure = (s) => evidence[s].successes >= PRODUCTION_RULES.sureMin && rate(s) >= PRODUCTION_RULES.sureRate;
  const weak = (s) => evidence[s].successes + evidence[s].failures >= PRODUCTION_RULES.minAttempts && rate(s) < PRODUCTION_RULES.weakRate;
  for (const [i, to] of stages.entries()) {
    if (!weak(to)) continue;
    const from = stages.slice(0, i).reverse().find(sure);
    if (from) return { from, to, strong_rate: round(rate(from)), weak_rate: round(rate(to)), label: `'${from}' sicher, '${to}' schwach` };
  }
  return null;
}

// ---------------------------------------------------------------- Lerner- oder Item-Problem?

/**
 * Warum scheitert DIESER Lerner (snapshot-Skill) an DIESER Aufgabe? Deterministisch, erste passende Regel:
 *   item_problem          die Aufgabe ist kalibriert auffällig schwer (kompetente Lerner scheitern) und der Lerner
 *                         scheitert hier
 *   production_problem    Produktionslücke des Lerners (P13) und die Aufgabe liegt auf der schwachen Stufe
 *   context_problem       der Lerner zeigt den Skill in anderen Aufgaben auf mindestens dieser Stufe, scheitert
 *                         aber hier wiederholt
 *   learner_problem       Fehler in ≥ 3 verschiedenen Aufgaben des Skills, zusammen < 50 % richtig
 *   insufficient_evidence sonst
 */
export function diagnoseDifficulty({ item, exercise, skill }) {
  const ladder = ["recognized", "controlled", "guided", "free", "spontaneous"];
  const stage = evidenceForExercise(exercise);
  const contexts = skill?.exercise_contexts ?? [];
  const here = contexts.find((c) => c.exercise_id === exercise.id) ?? { successes: 0, failures: 0 };
  const elsewhere = contexts.filter((c) => c.exercise_id !== exercise.id);
  if (item?.quality === "too_hard" && here.failures > 0) {
    return { code: "item_problem", reason: `Aufgabe kalibriert schwerer als eingestuft (${item.prior} → ${item.estimate}, ${item.unique_learners} Lerner)` };
  }
  const gap = skill?.evidence ? productionGap(skill) : null;
  if (gap && ladder.indexOf(stage) >= ladder.indexOf(gap.to)) {
    return { code: "production_problem", reason: `Produktionslücke: ${gap.label}` };
  }
  const shownAtLevel = elsewhere.some((c) => c.successes > 0 && ladder.indexOf(c.highest_success_evidence) >= ladder.indexOf(stage));
  if (shownAtLevel && here.failures >= 2 && here.successes === 0) {
    return { code: "context_problem", reason: "in anderen Aufgaben auf dieser Stufe gezeigt, hier wiederholt nicht" };
  }
  const failedIn = contexts.filter((c) => c.failures > 0).length;
  const total = contexts.reduce((s, c) => s + c.successes + c.failures, 0);
  const ok = contexts.reduce((s, c) => s + c.successes, 0);
  if (failedIn >= 3 && total > 0 && ok / total < 0.5) {
    return { code: "learner_problem", reason: `Fehler in ${failedIn} verschiedenen Aufgaben (${Math.round((ok / total) * 100)} % richtig)` };
  }
  return { code: "insufficient_evidence", reason: "noch zu wenig Evidenz für eine Zuordnung" };
}

/** Grobe Einordnung für Menschen (keine falsche Präzision): relativ zum Können, sonst zum GER-Band. */
export function difficultyLabel(difficulty, theta = null) {
  if (!Number.isFinite(difficulty)) return "unbekannt";
  if (!Number.isFinite(theta)) return `etwa ${levelOf(difficulty)}`;
  const delta = difficulty - theta;
  if (delta < ZONE_RULES.knownBelow) return "leicht";
  if (delta <= ZONE_RULES.learningUpTo) return "mittel";
  if (delta <= ZONE_RULES.challengingUpTo) return "anspruchsvoll";
  return "sehr anspruchsvoll";
}

function merge(target, source, add, empty) {
  for (const [id, entry] of source) {
    if (!target.has(id)) target.set(id, empty());
    add(target.get(id), entry);
  }
}

function bump(map, key) {
  const n = (map.get(key) ?? 0) + 1;
  map.set(key, n);
  return n;
}

function safeView(evaluation) {
  try {
    return readEvaluation(evaluation);
  } catch {
    return null;
  }
}

function countBy(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
