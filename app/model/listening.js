/**
 * Hören in der Oberfläche (P15, DOM-frei, testbar): Was der Lerner zu einer Höraufgabe sieht, welche Hilfen es gibt
 * und wie die Rückmeldung klingt. Keine Punktzahlen ("Listening Score 62,43"), sondern verständliche Sätze.
 *
 * Das Transkript steht nie von Anfang an da: Es ist die letzte Hilfe-Stufe (full_transcript) und kommt sonst erst
 * nach der Antwort. Jede Hilfe senkt das Gewicht der Antwort als Hörevidenz; das sagt die Oberfläche auch.
 */

import {
  MEASURE_LABELS, SUPPORT_LEVELS, UNSUPPORTED, listeningMode, listeningScore, partialTranscript,
} from "../../core/learning/listening/model.js";

export const SUPPORT_LABELS = Object.freeze({
  keywords: "Stichwörter zeigen",
  partial_transcript: "Teil des Textes zeigen",
  full_transcript: "Ganzen Text zeigen",
});
const SOURCE_LABELS = Object.freeze({ real: "echte Aufnahme", synthetic: "synthetische Aufnahme (Sprachausgabe)" });
/** Hörform (P16) in Worten. */
export const MODE_LABELS = Object.freeze({
  sentence_comprehension: "Satz verstehen", contextual_comprehension: "Hörtext verstehen",
  contextual_inference: "aus dem Hörtext schließen", inference: "schließen", discourse: "Zusammenhang verstehen",
  speaker_recognition: "Sprecher unterscheiden", dictation: "Diktat", response: "auf das Gehörte antworten",
});

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Anzeige einer Höraufgabe: Aufnahme, Herkunft, Hilfen (in Reihenfolge), Messgröße; im Hörkontext (P16) dazu Titel,
 * "Frage k von n" und die Abschnitte, auf die sich die Frage bezieht (zum gezielten Nachhören).
 * @param {{title?: string, task_index?: number, task_count?: number}|null} context  aus dem Inhalt (App-Service)
 */
export function presentListening(exercise, audio, context = null) {
  if (!exercise.listening || !audio) return null;
  const spec = exercise.listening;
  const supports = [];
  if (spec.keywords?.length) supports.push({ level: "keywords", label: SUPPORT_LABELS.keywords, content: spec.keywords.join(" · ") });
  if (spec.task !== "dictation") {
    supports.push({ level: "partial_transcript", label: SUPPORT_LABELS.partial_transcript, content: partialTranscript(audio.transcript) });
  }
  supports.push({ level: "full_transcript", label: SUPPORT_LABELS.full_transcript, content: audio.transcript });
  const segments = (spec.segments ?? []).map((id) => audio.segments?.find((s) => s.id === id)).filter(Boolean)
    .map((s, i, all) => ({ id: s.id, start_s: s.start_s, end_s: s.end_s,
      label: `${all.length > 1 ? `Abschnitt ${i + 1}` : "Abschnitt"} (${clock(s.start_s)}–${clock(s.end_s)})` }));
  const mode = listeningMode(exercise, audio);
  return {
    audio_id: audio.id,
    src: audio.src,
    duration_s: audio.duration_s,
    mode,
    mode_label: MODE_LABELS[mode] ?? mode,
    context: context && audio.segments?.length ? {
      title: context.title ?? "",
      task_index: context.task_index ?? null,
      task_count: context.task_count ?? null,
      progress: context.task_count > 1 ? `Frage ${context.task_index} von ${context.task_count} zu diesem Hörtext` : "",
      speaker_count: audio.speaker_count ?? 1,
      length_label: { short: "kurzer Hörtext", medium: "mittellanger Hörtext", long: "langer Hörtext" }[audio.context_length] ?? "",
    } : null,
    segments,
    base_support: spec.base_support,
    task: spec.task,
    measure: spec.measure,
    measure_label: MEASURE_LABELS[spec.measure] ?? spec.measure,
    supports,
    source: sourceOf(audio),
  };
}

/**
 * Höraufgabe der Einstufung (P22): nur Anhören und Wiederholen, ohne Text-Hilfen (die Einstufung misst Hören ohne
 * Mitlesen; ausgewertet wird wie bisher nur die Antwort).
 */
export function presentPlacementListening(audio) {
  if (!audio) return null;
  return {
    audio_id: audio.id, src: audio.src, duration_s: audio.duration_s, mode: null, mode_label: "", context: null,
    segments: [], base_support: "question", supports: [], source: sourceOf(audio),
  };
}

function sourceOf(audio) {
  return {
    type: audio.source_type,
    type_label: SOURCE_LABELS[audio.source_type] ?? audio.source_type,
    attribution: audio.attribution,
    license: audio.license,
    license_url: audio.license_url,
    source_url: audio.source_url,
    // P15: nicht kommerziell nutzbare Aufnahmen (Development-Pool) sichtbar kennzeichnen
    development_only: audio.development_only === true,
  };
}

/** Höhere Hilfe-Stufe von zwei (die Antwort zählt mit der höchsten genutzten Hilfe). */
export function strongerSupport(a, b) {
  return SUPPORT_LEVELS.indexOf(a) >= SUPPORT_LEVELS.indexOf(b) ? a : b;
}

/**
 * Rückmeldung zum Hören, getrennt von der Sprachrichtigkeit (die zeigt das normale Feedback).
 * @param {{exercise: object, audio: object, outcome: string, answerText: string,
 *   context: {play_count: number, support_level: string}, writtenSecure?: boolean}} input
 */
export function listeningFeedback({ exercise, audio, outcome, answerText, context, writtenSecure = false }) {
  const score = listeningScore(exercise, { outcome, answerText });
  const understood = score >= 0.75;
  const helped = !UNSUPPORTED.includes(context.support_level);
  const measure = MEASURE_LABELS[exercise.listening?.measure] ?? "Hörverstehen";
  let headline;
  let text;
  if (exercise.type === "dictation") {
    headline = understood ? "Gut herausgehört" : "Noch nicht alles herausgehört";
    text = `Du hast die gesprochenen Wörter zu ${Math.round(score * 100)} % richtig aufgeschrieben. Ein Diktat zeigt, dass du Wörter und Formen im Gesprochenen erkennst; ob du den Inhalt verstehst, prüfen andere Aufgaben.`;
  } else if (exercise.type === "listening_response") {
    headline = understood ? "Inhalt verstanden" : "Inhalt noch nicht ganz erfasst";
    text = understood
      ? "Du hast das Wesentliche gehört. Wie du es sprachlich formuliert hast, steht in der Rückmeldung darunter: Das ist Schreiben, nicht Hören."
      : "Wichtige Inhalte aus der Aufnahme fehlen in deiner Antwort. Hör noch einmal auf die Einzelheiten.";
  } else {
    headline = understood ? `${measure}: verstanden` : `${measure}: noch nicht sicher`;
    text = understood ? "Die Aussage hast du im Gesprochenen erkannt." : "Beim Hören war das heute noch nicht sicher.";
  }
  if (!understood && writtenSecure) {
    text += " Du kennst diese Struktur schriftlich bereits gut. Beim Verstehen im gesprochenen Kontext hast du sie heute noch nicht sicher erkannt.";
  }
  const notes = [];
  if (helped) notes.push("Mit Hilfe beantwortet: Das hilft beim Lernen, zählt aber weniger als Hören ohne Hilfe.");
  if (context.play_count > 1) notes.push(`${context.play_count}× gehört: Die erste Antwort nach einmal Hören zählt am meisten.`);
  return {
    headline,
    text,
    understood,
    notes,
    transcript: audio?.transcript ?? "",
    source: audio ? `${audio.attribution}` : "",
    source_type: audio?.source_type ?? null,
  };
}

export const LISTENING_STATE_TEXT = Object.freeze({
  unverified: "noch nicht geprüft",
  supported: "bisher nur mit Hilfe gehört",
  insufficient_evidence: "noch zu wenige Antworten",
  developing: "im Aufbau",
  verified: "sicher (in den geprüften Aufgaben)",
  weak: "noch nicht sicher verstanden",
});

/**
 * Übersicht "Hören" für den Fortschritt: Zustände in Worten, nie als Punktzahl oder GER-Stufe (dafür reicht ein
 * kleiner Pool kurzer Sätze nicht). Hinweis, was schriftlich sicher, aber beim Hören noch nicht geprüft ist.
 */
export function presentListeningOverview(profile, library) {
  const label = (id) => library.skill(id)?.label ?? id;
  return {
    answered: profile.answered,
    state: profile.answered ? profile.overall.state : "unverified",
    // P22: Aussage über die bisherigen Höraufgaben, nicht über das Hörverstehen insgesamt (das zeigt das Sprachprofil)
    text: profile.answered ? `In deinen bisherigen Höraufgaben: ${LISTENING_STATE_TEXT[profile.overall.state]}` : "Du hast noch keine Höraufgabe gemacht. Hören ist deshalb nicht gemessen, nicht schwach.",
    measures: Object.entries(profile.by_measure).map(([measure, s]) => ({
      measure, label: MEASURE_LABELS[measure] ?? measure, state: s.state, text: LISTENING_STATE_TEXT[s.state],
    })),
    known_not_verified: profile.matrix.filter((m) => m.status === "known_not_listening_verified").map((m) => label(m.skill_id)),
    weak: profile.skills.filter((s) => s.state === "weak").map((s) => ({
      title: label(s.skill_id),
      text: s.written.state === "secure"
        ? "Schriftlich sicher, im Gesprochenen noch nicht sicher erkannt."
        : "Beim Hören noch unsicher.",
    })),
    avoidance: profile.avoidance.detected ? "Höraufgaben wurden zuletzt oft übersprungen. Wir fangen mit kürzeren, langsameren Aufnahmen an." : null,
    note: "Gemessen wird bisher vor allem das Verstehen kurzer Sätze, noch kein natürliches Hörverstehen längerer Gespräche.",
  };
}
