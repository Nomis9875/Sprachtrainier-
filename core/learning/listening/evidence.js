/**
 * Hörprofil (P15): Was zeigen die Höraufgaben über DIESEN Lerner in DIESER Sprache? Eine Projektion aus den
 * Ereignissen, nie gespeichert. Reines JavaScript, deterministisch, ohne KI (Whisper liefert höchstens den Text der
 * Antwort; ob verstanden wurde, entscheidet diese Auswertung).
 *
 *   attempt (Höraufgabe) ── Hörleistung (model.js) × Gewicht ──▶ je Skill und je Messgröße: gewichtete Erfolge
 *   listening_interaction ── überspringen / nichts verstanden / Transkript ──▶ Vermeiden (nie ein Fehler)
 *
 * Gewicht einer Antwort = Hilfe (ohne Hilfe 1 … volles Transkript 0,15) × 1/n Hörwiederholungen × 1/n Wiederholung
 * derselben Aufgabe × (1 − Ratewahrscheinlichkeit). Die erste Antwort ohne Hilfe ist die stärkste Evidenz.
 *
 * Zustand je Skill (und je Messgröße), gezählt nur aus Antworten OHNE Hilfe (Schwellen wie das Produktionsprofil):
 *   unverified             nie gehört (kein Mangel: nur nicht geprüft)
 *   supported              nur mit Hilfe beantwortet (Lernfortschritt möglich, Hörevidenz schwach)
 *   insufficient_evidence  zu wenig ohne Hilfe (gewichtet < 2 oder nur EINE Aufgabe: Breite wie P14A)
 *   verified               sicher (gewichtet ≥ 3 Erfolge und ≥ 80 %)
 *   weak                   schwach (gewichtet ≥ 2 Antworten und < 60 %)
 *   developing             dazwischen
 *
 * Unterschiede, die eine einzige Zahl verdecken würde:
 *   written_vs_listening   schriftlich sicher (Kompetenz) + Hören unverified/weak → "bekannt, aber nicht gehört"
 *   by_measure             Hauptaussage sicher, Details schwach (oder umgekehrt): keine pauschale Hörbeherrschung
 *   by_rate / by_accent    langsam/normal sicher, schnell schwach: Tempo-Signal; Akzent: Signal je Varietät, kein
 *                          Zusammenbruch des ganzen Spanisch (Akzent ist Metadatum, nie automatisch schwerer)
 *
 * Liegt die Schwäche nur in EINEM Tempo oder EINEM Akzent und wird ein anderes Tempo bzw. ein anderer Akzent verstanden,
 * ist der Gesamtzustand "developing" mit rate_gap / accent_gap: eine kontextabhängige Schwierigkeit, keine allgemeine.
 *
 * P16, Hörkontext:
 *   Gewicht × 1/k    k = wievielte verschiedene Aufgabe desselben Kontexts (contextKey): Vier Fragen zu EINER Aufnahme
 *                    sind keine vier unabhängigen Hörproben (1 + ½ + ⅓ + ¼ ≈ 2,08 statt 4)
 *   Breite           "sicher"/"schwach" erst aus ≥ 2 verschiedenen Aufgaben UND ≥ 2 verschiedenen Kontexten
 *   weitere Lücken   Kontextlänge (context_length_gap), ein/mehrere Sprecher (speaker_gap), Störgeräusche, nur wenn
 *                    bekannt (noise_gap), einzelner Satz/Kontext (scope_gap): wie rate_gap, eine Größe verändert
 *   Erinnerung       auditoryGapPattern: wiederholt nicht verstanden, obwohl schriftlich sicher (memory/derive.js macht
 *                    daraus die Erinnerung auditory_recognition_gap; hier steht dieselbe Regel als Vorschau)
 */

import { readEvaluation } from "../../evaluation/result.js";
import { DAY_MS } from "../repetition/model.js";
import { secureLevel } from "../competence/production.js";
import { PRODUCTION_RULES } from "../competence/production.js";
import { repetitionWeight } from "../profile/measurement.js";
import {
  AUDIO_BANDS, LISTENING_MEASURES, UNSUPPORTED, audioFeatures, contextKey, guessingOf, isListening, listeningScore,
  listeningWeight,
} from "./model.js";

export const LISTENING_PROFILE_VERSION = 1;
export const LISTENING_RULES = Object.freeze({
  sureMin: PRODUCTION_RULES.sureMin, // 3 gewichtete Erfolge
  sureRate: PRODUCTION_RULES.sureRate, // 0,8
  minWeight: PRODUCTION_RULES.minAttempts, // 2
  weakRate: PRODUCTION_RULES.weakRate, // 0,6
  avoidanceSkips: 3, // so viele Überspringen/"nichts verstanden" in avoidanceDays → Vermeiden
  avoidanceTranscriptShare: 0.6, // … oder so viele der letzten Antworten mit vollem Transkript (mindestens 3)
  avoidanceDays: 30,
  minItems: 2, // "sicher"/"schwach" erst aus mindestens 2 verschiedenen Aufgaben (eine wiederholte Aufgabe reicht nie)
  minContexts: 2, // P16: … und aus mindestens 2 verschiedenen Kontexten (Aufnahmen); ohne Kontext ist jede Aufgabe einer
  success: 0.75, // Hörleistung ab 0,75 zählt als Erfolg (Diktat: drei Viertel der Wörter; Antwort: fast alle Schlüssel)
});

/**
 * Hörerkennungs-Lücke (P16, auditory_recognition_gap): schriftlich sicher, im Gesprochenen wiederholt nicht erkannt.
 * Nur Antworten ohne Hilfe zählen. Ein einmaliges Nichtverstehen ist nie eine Erinnerung.
 *   candidate   ≥ 2 Fehler aus ≥ 2 verschiedenen Kontexten
 *   active      ≥ 3 Fehler an ≥ 2 Tagen aus ≥ 2 Kontexten
 *   weakening   seit dem letzten Fehler verstanden (counter_evidence) oder > 30 Tage nichts (quiet)
 *   resolved    seit dem letzten Fehler ≥ 2× verstanden in ≥ 2 verschiedenen Kontexten
 */
export const AUDITORY_GAP_RULES = Object.freeze({
  candidateFailures: 2, candidateContexts: 2, activeFailures: 3, activeDays: 2, activeContexts: 2,
  resolvedSuccesses: 2, resolvedContexts: 2, quietDays: 30,
});

/**
 * @param {{events: object[], library: object, userId: string, asOf: Date, snapshot?: object|null}} input
 *   events: Ereignisse dieses Lerners in dieser Sprache (engine.history()); snapshot: Kompetenz (schriftlich)
 */
/**
 * Hörantworten dieses Lerners als Datensätze mit Gewicht (zeitlich sortiert). Eine Quelle für Hörprofil und
 * Erinnerungen (memory/derive.js): dieselbe Gewichtung, dieselben Merkmale.
 * @returns {{records: object[], own: object[]}}  own: Ereignisse dieses Lerners bis asOf (sortiert)
 */
export function listeningRecords({ events, library, userId, asOf }) {
  const until = asOf.toISOString();
  const own = events.filter((e) => e.user_id === userId && e.created_at <= until).sort(byTime);
  const records = [];
  const repeats = new Map();
  const contextTasks = new Map(); // Kontext → Aufgabe → wievielte verschiedene Aufgabe (1, 2, …)
  const seen = new Set();
  for (const event of own) {
    if (event.event_type !== "attempt" || seen.has(event.id)) continue;
    seen.add(event.id);
    const exercise = library.anyExercise(event.payload.exercise_id);
    if (!exercise || !isListening(exercise)) continue;
    const view = safeView(event.payload.evaluation);
    if (!view || view.overall.outcome === "not_evaluated") continue;
    const context = event.payload.listening ?? { play_count: 1, support_level: exercise.listening?.base_support ?? "question" };
    const score = listeningScore(exercise, { outcome: view.overall.outcome, answerText: event.payload.answer_text });
    const n = (repeats.get(exercise.id) ?? 0) + 1;
    repeats.set(exercise.id, n);
    const key = contextKey(exercise);
    const tasks = contextTasks.get(key) ?? new Map();
    if (!tasks.has(exercise.id)) tasks.set(exercise.id, tasks.size + 1);
    contextTasks.set(key, tasks);
    const k = tasks.get(exercise.id);
    const weight = listeningWeight(context) * repetitionWeight(n) * repetitionWeight(k) * (1 - guessingOf(exercise));
    const audio = library.audio?.(exercise.listening?.audio) ?? null;
    const features = audioFeatures(exercise, audio);
    const band = (value, order) => (order.includes(value) ? value : "unknown");
    records.push({
      at: event.created_at, day: event.local_date ?? event.created_at.slice(0, 10), event_id: event.id,
      exercise_id: exercise.id, context: key, context_task: k, skills: skillsOf(exercise),
      score, success: score >= LISTENING_RULES.success, weight, unsupported: UNSUPPORTED.includes(context.support_level),
      support: context.support_level, plays: context.play_count, measure: exercise.listening?.measure ?? "detail",
      rate: audio?.speech_rate?.band ?? "unknown", accent: audio?.accent ?? "unknown",
      context_length: band(features?.context_length, AUDIO_BANDS.context_length),
      speakers: band(features?.speakers, AUDIO_BANDS.speakers),
      noise: band(features?.noise, AUDIO_BANDS.noise),
      scope: band(features?.scope, AUDIO_BANDS.scope),
    });
  }
  return { records, own };
}

export function buildListeningProfile({ events, library, userId, asOf, snapshot = null }) {
  const { records, own } = listeningRecords({ events, library, userId, asOf });
  const until = asOf.toISOString();
  const skills = new Map();
  const measures = new Map();
  const items = new Map();
  const recentSupport = records.map((r) => r.support);
  const answered = records.length;
  for (const record of records) {
    for (const skillId of record.skills) push(skills, skillId, record);
    push(measures, record.measure, record);
    push(items, record.exercise_id, record);
  }

  const snapshotOf = new Map((snapshot?.skills ?? []).map((s) => [s.skill_id, s]));
  const skillResults = [...skills.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([skillId, records]) => {
    const summary = summarize(records);
    const written = snapshotOf.get(skillId) ?? null;
    return {
      skill_id: skillId,
      ...contextual(summary, records),
      by_measure: splitBy(records, "measure"),
      by_rate: splitBy(records, "rate"),
      by_accent: splitBy(records, "accent"),
      ...contextSplits(records),
      written: writtenState(written),
      last_at: records.at(-1).at,
    };
  });
  const avoidance = avoidanceOf(own, recentSupport, asOf);
  const all = [...items.values()].flat();
  const overall = {
    ...contextual(summarize(all), all), by_rate: splitBy(all, "rate"), by_accent: splitBy(all, "accent"), ...contextSplits(all),
  };
  return {
    format: "spanisch-ai.listening-profile",
    version: LISTENING_PROFILE_VERSION,
    learner_id: userId,
    as_of: until,
    answered,
    overall,
    by_measure: Object.fromEntries(LISTENING_MEASURES.filter((m) => measures.has(m)).map((m) => [m, summarize(measures.get(m))])),
    skills: skillResults,
    avoidance,
    // Evidenzmatrix: schriftlich (Erkennen/Produktion/Gespräch aus der Kompetenz) gegen Hören, je Skill mit Hörinhalt
    matrix: evidenceMatrix({ library, snapshotOf, listened: new Map(skillResults.map((s) => [s.skill_id, s])) }),
    memories: memoryCandidates(skillResults, skills, asOf),
  };
}

/** Skills, deren gesprochene Form eine Höraufgabe prüft (Strukturen, Ausdrücke, typische Fehler). */
export function skillsOf(exercise) {
  return [
    ...(exercise.structures ?? []).map((s) => `grammar_structure:${s.rule_id}`),
    ...(exercise.target_items ?? []).map((i) => `lexical_item:${i}`),
    ...(exercise.common_errors ?? []).map((e) => `common_error:${e}`),
  ];
}

function summarize(records) {
  const free = records.filter((r) => r.unsupported);
  const weight = sum(free, (r) => r.weight);
  const successes = sum(free, (r) => r.weight * (r.success ? 1 : 0));
  const supportedWeight = sum(records.filter((r) => !r.unsupported), (r) => r.weight);
  const rate = weight > 0 ? successes / weight : null;
  let state;
  const breadth = new Set(free.map((r) => r.exercise_id)).size;
  const contexts = new Set(free.map((r) => r.context ?? r.exercise_id)).size;
  if (!records.length) state = "unverified";
  else if (!free.length) state = "supported";
  else if (breadth < LISTENING_RULES.minItems || contexts < LISTENING_RULES.minContexts) state = "insufficient_evidence";
  else if (successes >= LISTENING_RULES.sureMin && rate >= LISTENING_RULES.sureRate) state = "verified";
  else if (weight < LISTENING_RULES.minWeight) state = "insufficient_evidence";
  else if (rate < LISTENING_RULES.weakRate) state = "weak";
  else state = "developing";
  return {
    state,
    answers: records.length,
    items: breadth,
    contexts,
    unsupported_weight: round(weight),
    unsupported_successes: round(successes),
    success_rate: rate === null ? null : round(rate),
    supported_weight: round(supportedWeight),
  };
}

function splitBy(records, key) {
  const groups = new Map();
  for (const r of records) push(groups, r[key], r);
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, list]) => [k, summarize(list)]));
}

/**
 * Schwäche nur in einem Tempo, Akzent, einer Kontextlänge, bei mehreren Sprechern, bei (bekannten) Störgeräuschen
 * oder nur im zusammenhängenden Kontext → kontextabhängig ("developing" mit Lücke), nicht allgemein schwach.
 */
function contextual(summary, records) {
  const rate = rateGap(records);
  const accent = accentGap(records);
  const gaps = {
    // Satz → Kontext ist scope_gap; context_length_gap vergleicht nur Kontexte untereinander (kurz → mittel → lang)
    context_length_gap: bandGap(records, "context_length", (a, b) => `Kontext '${a}' verstanden, '${b}' noch nicht`,
      AUDIO_BANDS.context_length.slice(1)),
    speaker_gap: bandGap(records, "speakers", () => "ein Sprecher verstanden, mehrere Sprecher noch nicht"),
    noise_gap: bandGap(records, "noise", (a, b) => `Störgeräusche '${a}' verstanden, '${b}' noch nicht`),
    scope_gap: bandGap(records, "scope", () => "einzelne Sätze verstanden, zusammenhängende Kontexte noch nicht"),
  };
  const any = rate || accent || Object.values(gaps).some(Boolean);
  const state = summary.state === "weak" && any ? "developing" : summary.state;
  return { ...summary, state, rate_gap: rate, accent_gap: accent, ...gaps };
}

/** Aufteilung nach den P16-Merkmalen (unbekannte Werte bleiben eine eigene Gruppe "unknown", nie "schwer"). */
function contextSplits(records) {
  return {
    by_context_length: splitBy(records, "context_length"),
    by_speakers: splitBy(records, "speakers"),
    by_noise: splitBy(records, "noise"),
    by_scope: splitBy(records, "scope"),
  };
}

/** Lücke entlang geordneter Bänder (leicht → schwer): ein leichteres Band verstanden, ein schwereres schwach. */
function bandGap(records, key, label, order = AUDIO_BANDS[key]) {
  const split = splitBy(records.filter((r) => order.includes(r[key])), key);
  for (let i = order.length - 1; i > 0; i -= 1) {
    if (split[order[i]]?.state !== "weak") continue;
    const sure = order.slice(0, i).reverse().find((b) => split[b]?.state === "verified" || split[b]?.state === "developing");
    if (sure) return { from: sure, to: order[i], label: label(sure, order[i]) };
  }
  return null;
}

/** Akzent-Signal: ein Akzent verstanden (sicher oder im Aufbau), ein anderer schwach. "unknown" zählt nicht. */
function accentGap(records) {
  const split = splitBy(records.filter((r) => r.accent !== "unknown"), "accent");
  const weak = Object.entries(split).filter(([, s]) => s.state === "weak").map(([a]) => a);
  const fine = Object.entries(split).filter(([, s]) => s.state === "verified" || s.state === "developing").map(([a]) => a);
  return weak.length && fine.length ? { understood: fine, weak, label: `Akzent ${weak.join(", ")} noch nicht, ${fine.join(", ")} verstanden` } : null;
}

/** Tempo-Signal: langsam oder normal sicher, schneller schwach (nur eine Größe verändert). */
function rateGap(records) {
  const split = splitBy(records, "rate");
  const order = ["slow", "normal", "fast"];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const weak = split[order[i]];
    if (weak?.state !== "weak") continue;
    const sure = order.slice(0, i).reverse().find((band) => split[band]?.state === "verified" || split[band]?.state === "developing");
    if (sure) return { from: sure, to: order[i], label: `Tempo '${sure}' verstanden, '${order[i]}' noch nicht` };
  }
  return null;
}

/** Schriftlicher Stand eines Skills (aus der Kompetenz): sicher ab "controlled" oder mindestens "practicing". */
export function writtenState(skill) {
  if (!skill || skill.mastery === "unknown") return { state: "unknown", secure_level: null };
  const secure = secureLevel(skill);
  const known = Boolean(secure && secure !== "recognized") || ["stable", "mastered"].includes(skill.mastery);
  return { state: known ? "secure" : "learning", secure_level: secure, mastery: skill.mastery };
}

/**
 * Vermeiden: wiederholt übersprungen, "nichts verstanden" oder fast immer mit vollem Transkript. Eine einzelne
 * Nichtantwort ist kein Vermeiden; Schweigen ist nie negative Kompetenz-Evidenz.
 */
function avoidanceOf(events, recentSupport, asOf) {
  const since = asOf.getTime() - LISTENING_RULES.avoidanceDays * DAY_MS;
  const skips = events.filter((e) => e.event_type === "listening_interaction" && ["skip", "dont_know"].includes(e.payload.action)
    && Date.parse(e.created_at) >= since);
  const last = recentSupport.slice(-5);
  const transcriptShare = last.length >= 3 ? last.filter((s) => s === "full_transcript").length / last.length : 0;
  const bySkip = skips.length >= LISTENING_RULES.avoidanceSkips;
  const byTranscript = transcriptShare >= LISTENING_RULES.avoidanceTranscriptShare;
  return {
    detected: bySkip || byTranscript,
    skips: skips.filter((e) => e.payload.action === "skip").length,
    dont_know: skips.filter((e) => e.payload.action === "dont_know").length,
    transcript_share: round(transcriptShare),
    exercises: [...new Set(skips.map((e) => e.payload.exercise_id))].sort(),
    reason: bySkip ? `${skips.length}× übersprungen oder nicht verstanden (${LISTENING_RULES.avoidanceDays} Tage)`
      : byTranscript ? "meist mit vollem Transkript beantwortet" : null,
  };
}

function evidenceMatrix({ library, snapshotOf, listened }) {
  const withListening = new Set(library.exercises().filter(isListening).flatMap(skillsOf));
  return [...withListening].sort().map((skillId) => {
    const s = snapshotOf.get(skillId);
    const level = (l) => (s ? (s.evidence?.[l]?.successes ?? 0) + (s.evidence?.[l]?.failures ?? 0) : 0);
    const shown = (levels) => (levels.some((l) => level(l) > 0) ? "evidence" : "none");
    const listening = listened.get(skillId)?.state ?? "unverified";
    const written = writtenState(s).state;
    return {
      skill_id: skillId,
      recognition: shown(["recognized"]),
      production: shown(["controlled", "guided", "free"]),
      conversation: shown(["spontaneous"]),
      listening,
      // "bekannt, aber nicht gehört": schriftlich sicher, Hören nicht geprüft / nur mit Hilfe / schwach
      status: written === "secure" && ["unverified", "supported", "insufficient_evidence"].includes(listening)
        ? "known_not_listening_verified"
        : written === "secure" && listening === "weak" ? "known_listening_weak" : null,
    };
  });
}

/**
 * Vorschau der Erinnerungen (dieselbe Regel wie memory/derive.js): schriftlich sicher, beim Hören wiederholt nicht
 * erkannt → Hörerkennung, NICHT "Wort unbekannt". Gespeichert und weitergeführt werden sie im Lerngedächtnis.
 */
function memoryCandidates(skills, recordsBySkill, asOf) {
  return skills.filter((s) => s.written.state === "secure").flatMap((s) => {
    const pattern = auditoryGapPattern(recordsBySkill.get(s.skill_id) ?? [], asOf);
    return pattern ? [{
      memory_type: "auditory_recognition_gap",
      skill_id: s.skill_id,
      status: pattern.status,
      reason: "schriftlich sicher, im Gesprochenen noch nicht sicher erkannt (kein Wortschatz- oder Grammatikproblem)",
      facts: { ...pattern.facts, listening_rate: s.success_rate, written_secure_level: s.written.secure_level },
    }] : [];
  });
}

/**
 * Hörerkennungs-Lücke eines Skills (AUDITORY_GAP_RULES) aus seinen Hörantworten, oder null (kein Muster).
 * Die Bedingung "schriftlich sicher" prüft der Aufrufer (writtenState).
 * @returns {{status: string, failures: object[], after: object[], facts: object}|null}
 */
export function auditoryGapPattern(records, asOf) {
  const rules = AUDITORY_GAP_RULES;
  const free = records.filter((r) => r.unsupported && r.weight > 0);
  const failures = free.filter((r) => !r.success);
  const contextsOf = (list) => new Set(list.map((r) => r.context)).size;
  if (failures.length < rules.candidateFailures || contextsOf(failures) < rules.candidateContexts) return null;
  const last = failures.at(-1);
  const after = free.filter((r) => r.success && r.at > last.at);
  const quiet = (asOf.getTime() - Date.parse(last.at)) / DAY_MS;
  const days = new Set(failures.map((r) => r.day)).size;
  let status;
  if (after.length >= rules.resolvedSuccesses && contextsOf(after) >= rules.resolvedContexts) status = "resolved";
  else if (after.length > 0 || quiet > rules.quietDays) status = "weakening";
  else if (failures.length >= rules.activeFailures && days >= rules.activeDays && contextsOf(failures) >= rules.activeContexts) status = "active";
  else status = "candidate";
  return {
    status,
    failures,
    after,
    facts: {
      failures: failures.length,
      failure_days: days,
      failure_contexts: contextsOf(failures),
      understood_since_last_failure: after.length,
      last_failure_at: last.at,
      measures: [...new Set(failures.map((r) => r.measure))].sort(),
      weakening_reason: status !== "weakening" ? null : after.length > 0 ? "counter_evidence" : "quiet",
    },
  };
}

function push(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function sum(list, f) {
  return list.reduce((total, x) => total + f(x), 0);
}

function safeView(evaluation) {
  try {
    return readEvaluation(evaluation);
  } catch {
    return null;
  }
}

function byTime(a, b) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
