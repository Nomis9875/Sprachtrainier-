/**
 * Hören als eigene Evidenzquelle (P15): gemeinsame Regeln für Evidenz, Profil, Planer und App.
 *
 * Grundsätze:
 * - Hören ist nicht Lesen und nicht Spracherkennung. Das GEHÖRTE ist Eingabe; Evidenz entsteht erst mit einer
 *   Antwort (attempt). Abspielen, Pause, Wiederholen und Hilfen sind Kontext (listening_interaction), keine Evidenz.
 * - Höraufgaben (Auswahl, Diktat) erzeugen KEINE schriftliche Kompetenz-Evidenz und keine Fehlerereignisse: Wer
 *   eine Form falsch hört, hat keinen Grammatikfehler gemacht. Antwortaufgaben (Hören + Antworten) trennen: Verstehen
 *   aus den Schlüsselinhalten (hier), Sprache aus den Regeln (wie jede offene Antwort, Produktionsevidenz).
 * - Diktat misst Erkennen und Segmentieren, nicht automatisch Verstehen (eigene Messgröße "dictation").
 * - Gewicht einer Antwort = Unterstützung × Wiederholungen des Hörens (1/n, dieselbe Funktion wie P14A/B) ×
 *   Wiederholung derselben Aufgabe (1/n) × (1 − Ratewahrscheinlichkeit bei Auswahl).
 * - Keine Antwort ist keine falsche Antwort: Überspringen und "nichts verstanden" sind Interaktionen (Vermeiden,
 *   Schwierigkeit), keine Fehler.
 *
 * P16, Hörkontext: Mehrere Aufgaben zu EINER Aufnahme (listening.context = Text-ID) sind nicht unabhängig. Die k-te
 * verschiedene Aufgabe desselben Kontexts zählt 1/k (contextKey, dieselbe 1/n-Funktion). Audio-Schwierigkeit ist ein
 * Zuschlag auf den Handwert (audioDifficulty), nur aus BEKANNTEN Merkmalen: unbekannt ist nie schwer.
 */

import { normalize } from "../../evaluation/text.js";
import { repetitionWeight } from "../profile/measurement.js";

export const LISTENING_TYPES = Object.freeze(["listening_comprehension", "dictation", "listening_response"]);
/** Höraufgaben, deren Antwort nur Hörevidenz ist (keine schriftliche Kompetenz, keine Fehlerereignisse). */
export const LISTENING_ONLY_TYPES = Object.freeze(["listening_comprehension", "dictation"]);

/** Unterstützung, von der stärksten Evidenz zur schwächsten (Stufe 0–4 aus dem Auftrag). */
export const SUPPORT_LEVELS = Object.freeze(["audio_only", "question", "keywords", "partial_transcript", "full_transcript"]);
export const SUPPORT_WEIGHT = Object.freeze({
  audio_only: 1, question: 1, keywords: 0.6, partial_transcript: 0.35, full_transcript: 0.15,
});
/** Bis zu dieser Stufe gilt eine Antwort als "ohne Hilfe" (die Frage selbst ist keine Hilfe zum Gehörten). */
export const UNSUPPORTED = Object.freeze(["audio_only", "question"]);

export const LISTENING_MEASURES = Object.freeze([
  "global", "detail", "inference", "vocabulary", "attitude", "style",
  "lexical_recognition", "grammatical_recognition", "discrimination", "dictation", "sequence",
  "discourse", "speaker", // P16: Zusammenhang im Kontext, wer was sagt (nur mit mindestens zwei bekannten Sprechern)
]);
/** Anzeige und Auftrag: global = gist, attitude = speaker intent. */
export const MEASURE_LABELS = Object.freeze({
  global: "Hauptaussage", detail: "Details", inference: "Schlussfolgern", vocabulary: "Bedeutung im Kontext",
  attitude: "Absicht des Sprechers", style: "Ton und Register", lexical_recognition: "Wörter erkennen",
  grammatical_recognition: "Formen erkennen", discrimination: "ähnliche Formen unterscheiden",
  dictation: "Gehörtes aufschreiben", sequence: "Reihenfolge",
  discourse: "Zusammenhang verstehen", speaker: "Sprecher unterscheiden",
});

export const LISTENING_ACTIONS = Object.freeze(["play", "pause", "replay", "support", "skip", "dont_know"]);

export function isListening(exercise) {
  return LISTENING_TYPES.includes(exercise?.type);
}

export function isListeningOnly(exercise) {
  return LISTENING_ONLY_TYPES.includes(exercise?.type);
}

/**
 * Gewicht einer Antwort aus Unterstützung und Hörwiederholungen (ohne Aufgabenwiederholung). Nie gehört (0×): kein
 * Gewicht, denn eine Antwort ohne Hören ist geraten oder aus dem Kontext erschlossen, keine Hörevidenz.
 */
export function listeningWeight({ support_level: support = "question", play_count: plays = 1 } = {}) {
  if (plays === 0) return 0;
  return (SUPPORT_WEIGHT[support] ?? SUPPORT_WEIGHT.full_transcript) * repetitionWeight(Math.max(1, plays));
}

/** Ratewahrscheinlichkeit einer Auswahl (sonst 0). */
export function guessingOf(exercise) {
  return exercise.type === "listening_comprehension" ? 1 / Math.max(2, (exercise.options ?? []).length) : 0;
}

/**
 * Hörleistung 0–1, getrennt von der Sprachrichtigkeit:
 *   Auswahl    richtig/falsch (Bewertung)
 *   Diktat     Anteil der richtig geschriebenen Wörter (längste gemeinsame Wortfolge, ohne Groß/Klein, Satzzeichen)
 *   Antwort    Anteil der Schlüsselinhalte, die in der Antwort vorkommen (je Gruppe eine Form); Grammatik egal
 */
export function listeningScore(exercise, { outcome, answerText }) {
  if (exercise.type === "listening_comprehension") return outcome === "correct" ? 1 : 0;
  if (exercise.type === "dictation") {
    const expected = words(exercise.accepted_answers?.[0]?.text ?? "");
    return expected.length ? round(commonWords(expected, words(answerText)) / expected.length) : 0;
  }
  const groups = exercise.listening?.keys ?? [];
  if (!groups.length) return 0;
  const answer = ` ${normalize(answerText ?? "")} `;
  const hit = groups.filter((group) => group.some((key) => answer.includes(` ${normalize(key)} `))).length;
  return round(hit / groups.length);
}

/** Teiltranskript (Hilfe "partial_transcript"): jedes zweite Inhaltswort (≥ 4 Buchstaben) durch "…" ersetzt. */
export function partialTranscript(transcript) {
  let content = 0;
  return transcript.split(/\s+/).map((word) => {
    const letters = word.replace(/[^\p{L}]/gu, "");
    if (letters.length < 4) return word;
    content += 1;
    return content % 2 === 0 ? word.replace(letters, "…") : word;
  }).join(" ");
}

function words(text) {
  return normalize(text ?? "").split(/\s+/).filter(Boolean);
}

/** Länge der längsten gemeinsamen Teilfolge zweier Wortlisten (Diktat: Reihenfolge zählt). */
function commonWords(a, b) {
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

// ---------------------------------------------------------------- P16: Kontext und Audio-Schwierigkeit

/**
 * Kontext einer Aufgabe: die Text-ID, wenn mehrere Aufgaben dieselbe Aufnahme teilen (vom Build gesetzt), sonst die
 * Aufgabe selbst (jede einzelne Aufgabe ist ihr eigener Kontext, wie in P15).
 */
export function contextKey(exercise) {
  return exercise?.listening?.context || exercise?.id;
}

/** Bänder in Reihenfolge leicht → schwer. Die Grenzen selbst setzt der Build (core/content/audio.py), nur dort. */
export const AUDIO_BANDS = Object.freeze({
  rate: Object.freeze(["slow", "normal", "fast"]),
  context_length: Object.freeze(["sentence", "short", "medium", "long"]),
  speakers: Object.freeze(["single", "multi"]),
  noise: Object.freeze(["clean", "mild", "moderate", "high"]),
  scope: Object.freeze(["item", "context"]),
});

/**
 * Zuschlag auf die Schwierigkeit (GER-Skala, 1.0 = eine Stufe) aus bekannten Audio-Merkmalen. Unbekannt = 0
 * (nie "schwer"). Ein Akzent ist nie an sich schwerer; nur ein für DIESEN Lerner nachweislich schwacher Akzent zählt.
 * Höchstens `max`: Ein schnelles, langes Audio macht aus einer B2-Aufgabe keine C2-Aufgabe.
 */
export const AUDIO_DIFFICULTY = Object.freeze({
  rate: Object.freeze({ slow: -0.2, normal: 0, fast: 0.3 }),
  context_length: Object.freeze({ sentence: 0, short: 0.1, medium: 0.25, long: 0.4 }),
  speakers: Object.freeze({ single: 0, multi: 0.25 }),
  noise: Object.freeze({ clean: 0, mild: 0.1, moderate: 0.25, high: 0.4 }),
  accent_weak: 0.25,
  max: 0.75,
});

/** Audio-Merkmale einer Höraufgabe (alles, was nicht bekannt ist, heißt "unknown"). */
export function audioFeatures(exercise, audio) {
  if (!exercise?.listening || !audio) return null;
  const speakers = Number.isInteger(audio.speaker_count) ? (audio.speaker_count >= 2 ? "multi" : "single") : "unknown";
  const contextLength = audio.context_length ?? "unknown";
  return {
    speech_rate: audio.speech_rate?.band ?? "unknown",
    context_length: contextLength,
    accent: audio.accent ?? "unknown",
    speaker_count: audio.speaker_count ?? "unknown",
    speakers,
    noise: audio.noise_level ?? "unknown",
    source_type: audio.source_type,
    base_support: exercise.listening.base_support,
    measure: exercise.listening.measure,
    // Kontext = mehr als ein Satz (Kontextlänge aus dem Build); ein einzelner Satz ist ein "item"
    scope: contextLength === "unknown" ? "unknown" : contextLength === "sentence" ? "item" : "context",
    segments: exercise.listening.segments ?? [],
  };
}

/**
 * Akzent-Stand dieses Lerners für eine Aufnahme (aus dem Hörprofil, overall.by_accent):
 *   unknown     Akzent der Aufnahme unbekannt (keine Aussage)
 *   weak        dieser Akzent beim Hören nachweislich schwach → Zuschlag und gezielter Bedarf
 *   known       dieser Akzent verstanden (verified/developing) → normal
 *   unfamiliar  andere Akzente belegt, dieser noch nicht → Evidenzlücke (erkunden), nicht schwerer
 *   no_profile  noch keine Akzent-Evidenz überhaupt
 */
export function accentStatus(accent, byAccent = null) {
  if (!accent || accent === "unknown") return "unknown";
  const state = byAccent?.[accent]?.state;
  if (state === "weak") return "weak";
  if (state === "verified" || state === "developing") return "known";
  const others = Object.entries(byAccent ?? {}).filter(([a, s]) => a !== "unknown" && s && s.state !== "unverified");
  return others.length ? "unfamiliar" : "no_profile";
}

/**
 * Audio-Schwierigkeit: Zuschlag und seine Bausteine (lesbar), dazu die unbekannten Größen. Gilt nur für den Handwert;
 * ist eine Aufgabe empirisch kalibriert (P14B), enthält die gemessene Schwierigkeit das Audio schon.
 * @param {object|null} features  audioFeatures()
 * @param {{byAccent?: object|null}} [learner]  Hörprofil des Lerners (overall.by_accent), optional
 */
export function audioDifficulty(features, { byAccent = null } = {}) {
  if (!features) return { offset: 0, parts: [], unknown: [], accent_status: "unknown", features: null };
  const parts = [];
  const unknown = [];
  const add = (dimension, band, table) => {
    if (!(band in table)) {
      unknown.push(dimension);
      return;
    }
    if (table[band]) parts.push({ dimension, band, value: table[band] });
  };
  add("speech_rate", features.speech_rate, AUDIO_DIFFICULTY.rate);
  add("context_length", features.context_length, AUDIO_DIFFICULTY.context_length);
  add("speakers", features.speakers, AUDIO_DIFFICULTY.speakers);
  add("noise", features.noise, AUDIO_DIFFICULTY.noise);
  const accent = accentStatus(features.accent, byAccent);
  if (accent === "unknown") unknown.push("accent");
  if (accent === "weak") parts.push({ dimension: "accent", band: features.accent, value: AUDIO_DIFFICULTY.accent_weak });
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return { offset: round(Math.min(AUDIO_DIFFICULTY.max, total)), parts, unknown, accent_status: accent, features };
}

/** Hörform für Anzeige und Berichte (P16), aus Aufgabentyp, Messgröße und Kontext abgeleitet. */
export function listeningMode(exercise, audio) {
  const spec = exercise?.listening;
  if (!spec) return null;
  if (exercise.type === "dictation") return "dictation";
  if (spec.measure === "speaker") return "speaker_recognition";
  if (spec.measure === "sequence" || spec.measure === "discourse") return "discourse";
  const context = audioFeatures(exercise, audio)?.scope === "context";
  if (spec.measure === "inference") return context ? "contextual_inference" : "inference";
  if (exercise.type === "listening_response") return "response";
  return context ? "contextual_comprehension" : "sentence_comprehension";
}

function round(value) {
  return Math.round(value * 100) / 100;
}
