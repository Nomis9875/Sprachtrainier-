/**
 * Wie eine Übung dem Lerner gezeigt wird (DOM-frei, testbar).
 *
 * Grundregel wie learnerView(): Eine Challenge verrät ihr Lernziel nicht. Vor der Antwort zeigt sie
 * nur die kommunikative Aufgabe: keinen Schwerpunkt, kein Lernziel, keine Anleitung, keine
 * Redemittel (die Redemittel verraten oft die gesuchte Struktur). Nach der Antwort zeigt das
 * Feedback Musterantwort und Redemittel (feedback.js).
 *
 * Die Übung kommt unverändert aus dem Inhaltspaket; hier wird nichts erfunden oder umgeschrieben.
 */

import { prepare } from "../../core/evaluation/text.js";
import { MODE_LABELS, purposeHint, reasonText, typeLabel } from "./labels.js";
import { explain } from "./explain.js";
import { presentListening } from "./listening.js";

const GAP = /_{3,}/;

/** Welche Eingabe passt: Auswahl (Optionen), kurz (ein Wort, eine Form), ein Satz, ein längerer Text. */
export function answerKind(exercise) {
  if (exercise.options?.length) return "choice";
  if (exercise.type === "dictation") return "sentence"; // P15: Gehörtes aufschreiben (ein Satz)
  if (exercise.evaluation_mode === "closed") return "short";
  if (exercise.evaluation_mode === "semi_open") return "sentence";
  return "long";
}

/**
 * @param {object} exercise    Übung aus dem Inhaltspaket
 * @param {{focus?: string|null, purpose?: string|null}} [options]
 *   focus: Schwerpunkt aus learnerItem() (bei Challenges immer null)
 *   purpose: Zweck im Sessionplan → kurzer Grund ("Das war zuletzt schwierig"), nur bei Training
 */
export function presentExercise(exercise, { focus = null, purpose = null, planned = null, audio = null, listeningContext = null, language = "de" } = {}) {
  const challenge = exercise.mode === "challenge";
  const conversation = exercise.conversation
    ? { partner_role_de: exercise.conversation.partner_role_de, opening_es: exercise.conversation.opening_es }
    : null;
  return {
    id: exercise.id,
    type: exercise.type,
    type_label: typeLabel(exercise.type),
    mode: exercise.mode,
    mode_label: MODE_LABELS[exercise.mode] ?? exercise.mode,
    challenge,
    level: exercise.level,
    topic_id: exercise.topics?.[0] ?? null, // nur für die Rück-Navigation beim Üben (wird nicht angezeigt)
    answer_kind: answerKind(exercise),
    prompt_de: exercise.prompt_de || "",
    prompt_es: exercise.prompt_es || "",
    source: { ...splitGap(exercise.source_text_es || ""), passage: exercise.type === "reading_comprehension" },
    // Auswahl (P12): feste, aber vom Inhalt unabhängige Reihenfolge (die richtige Option steht nicht immer vorn)
    options: exercise.options?.length ? shuffledOptions(exercise.options, exercise.id) : [],
    communication_goal_de: exercise.communication_goal_de || "",
    instruction_de: challenge ? "" : exercise.instruction_de || "",
    learning_goal_de: challenge ? "" : exercise.learning_goal_de || "",
    focus: challenge ? null : focus,
    why: challenge ? null : purposeHint(purpose, language),
    // P22: "Warum übe ich das?" in einem Satz (nur Training; Challenges verraten ihr Ziel nicht)
    why_text: challenge || !planned ? null : reasonText(planned, language),
    why_label: explain(language, "why"),
    min_words: exercise.min_words || 0,
    conversation,
    // P15: Höraufgabe (Aufnahme, Hilfen, Herkunft); das Transkript ist die letzte Hilfe, nie von Anfang an sichtbar
    listening: presentListening(exercise, audio, listeningContext),
    estimated_seconds: exercise.estimated_seconds,
  };
}

/** Kurzbeschreibung für Listen (Üben): Training mit Lernziel, Challenge nur mit der Aufgabe. */
export function exerciseCard(exercise) {
  const challenge = exercise.mode === "challenge";
  const title = challenge
    ? exercise.communication_goal_de || exercise.prompt_de
    : exercise.learning_goal_de || exercise.prompt_de;
  return {
    id: exercise.id,
    title,
    type_label: typeLabel(exercise.type),
    mode: exercise.mode,
    mode_label: MODE_LABELS[exercise.mode] ?? exercise.mode,
    level: exercise.level,
    estimated_seconds: exercise.estimated_seconds,
  };
}

/** Deterministisch gemischt (FNV-1a je Option und Übung). */
export function shuffledOptions(values, seed) {
  const key = (text) => {
    let hash = 2166136261;
    for (const ch of `${seed}|${text}`) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
    return hash;
  };
  return [...values].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1));
}

/** "Llámame cuando ___ a casa." → {text, parts: ["Llámame cuando ", " a casa."], has_gap: true} */
export function splitGap(text) {
  const parts = text.split(GAP);
  return { text, parts, has_gap: parts.length > 1 };
}

/** Wörter zählen genau wie die Bewertung (Mindestlänge offener Aufgaben): dieselbe Textaufbereitung. */
export function countWords(text) {
  return prepare(text).words().length;
}
