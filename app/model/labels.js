import { explain, localizedSkillLabel } from "./explain.js";

/**
 * Anzeigetexte der App (Deutsch). Nur Beschriftungen, keine Lernlogik: Was eine Übungsart,
 * ein Zweck oder eine Stufe BEDEUTET, entscheidet der Kern (web/core).
 */

export const EXERCISE_TYPE_LABELS = Object.freeze({
  gap_fill: "Lückentext",
  vocab_active: "Wortschatz aktiv",
  transform: "Umformen",
  translation: "Übersetzen",
  rephrase: "Umformulieren",
  situational: "Situation",
  opinion: "Meinung",
  counterargument: "Widersprechen",
  hypothetical: "Hypothese",
  reaction: "Reagieren",
  storytelling: "Erzählen",
  explanation: "Erklären",
  persuasion: "Überzeugen",
  discussion: "Diskutieren",
  register_switch: "Register wechseln",
  conversation: "Gespräch",
  free_production: "Freies Schreiben",
  multiple_choice: "Auswahl",
  error_correction: "Fehler korrigieren",
  reading_comprehension: "Leseverstehen",
  listening_comprehension: "Hörverstehen",
  dictation: "Diktat",
  listening_response: "Hören und antworten",
});

export const MODE_LABELS = Object.freeze({ training: "Training", challenge: "Challenge" });

/** Zweck einer Übung im Sessionplan (planning/priority.js PURPOSES), aus Lernersicht: [Einzahl, Mehrzahl]. */
export const PURPOSE_LABELS = Object.freeze({
  error_focus: ["Fehlerübung", "Fehlerübungen"],
  review: ["Wiederholung", "Wiederholungen"],
  production: ["Produktionsaufgabe", "Produktionsaufgaben"],
  consolidate: ["Übung zum Festigen", "Übungen zum Festigen"],
  new: ["neue Aufgabe", "neue Aufgaben"],
  challenge: ["Anwendungsaufgabe", "Anwendungsaufgaben"],
});

export function purposeText(purpose, count) {
  const [one, many] = PURPOSE_LABELS[purpose] ?? ["Übung", "Übungen"];
  return plural(count, one, many);
}

/** Kurzer Grund für eine Trainingsübung ("Warum du das gerade übst"); Challenges bekommen keinen. */
export const PURPOSE_HINTS = Object.freeze({
  error_focus: "Das war zuletzt schwierig",
  review: "Heute zur Wiederholung",
  production: "Jetzt frei anwenden",
  consolidate: "Zum Festigen",
  new: "Neu für dich",
  challenge: "Anspruchsvoll anwenden",
});

/**
 * "Warum übe ich das?" (P22): ein Satz aus Lernersicht zu einer geplanten Trainingsübung. Er übersetzt nur, was der
 * Planer entschieden hat (Zweck, Kategorie der Zusammensetzung, Lernzone), ohne Fachbegriffe und ohne Zahlen.
 * P24: in der Erklärungssprache (Deutsch oder Spanisch).
 * @param {{purpose?: string|null, composition?: string|null, zone?: string|null}} planned
 */
export function reasonText({ purpose = null, composition = null, zone = null } = {}, language = "de") {
  const key = purpose === "error_focus" || composition === "error" ? "error"
    : purpose === "review" ? "review"
      : composition === "measurement" ? "measurement"
        : purpose === "production" ? "production"
          : composition === "weakest" ? "weakest"
            : zone === "stretch" ? "stretch"
              : purpose === "consolidate" ? "consolidate"
                : purpose === "new" ? "new" : null;
  return key ? explain(language, "reason")[key] : null;
}

/** Kurzer Grund (Zweck) in der Erklärungssprache. */
export function purposeHint(purpose, language = "de") {
  return explain(language, "hints")[purpose] ?? null;
}

/**
 * Name eines Skills in Listen und als Schwerpunkt; typische Fehler sind als solche erkennbar (P22), Strukturen und
 * Fehler in der Erklärungssprache (P24).
 */
export function skillTitle(skill, fallback = "", { language = "de", library = null } = {}) {
  if (!skill) return fallback;
  const name = localizedSkillLabel(skill, library, language);
  return skill.type === "common_error" ? explain(language, "error_title", name) : name;
}

export const MASTERY_LABELS = Object.freeze({
  unknown: "noch nicht geübt",
  introduced: "eingeführt",
  practicing: "in Übung",
  stable: "gefestigt",
  mastered: "beherrscht",
});
export const MASTERY_ORDER = Object.freeze(["unknown", "introduced", "practicing", "stable", "mastered"]);

/** Art einer Stärke aus dem CoachingReport (kind), als kurze Aussage. */
export const STRENGTH_LABELS = Object.freeze({
  transfer: "überträgst du auf neue Aufgaben",
  spontaneous_production: "sitzt auch spontan im Gespräch",
  error_improvement: "passiert dir seltener",
  rapid_progress: "macht schnelle Fortschritte",
  stable_skill: "sitzt sicher",
  free_production: "verwendest du frei und sicher",
  improving: "wird besser",
});

export const SEVERITY_LABELS = Object.freeze({
  error: "Fehler",
  goal: "Aufgabenziel",
  naturalness: "Natürlichkeit",
  upgrade: "C1-Ausdruck",
  hint: "Hinweis",
});
/** Befundarten ohne eigenen Skill (z. B. Aufgabenziel), verständlich benannt. */
export const FINDING_KIND_LABELS = Object.freeze({
  GRAMMATICAL_ERROR: "Grammatik",
  PREPOSITION_ERROR: "Präpositionen",
  WRONG_WORD: "Wortwahl",
  GERMANISM: "deutsche Wörter und Wendungen",
  TARGET_NOT_USED: "die verlangte Struktur verwenden",
  GOAL_NOT_MET: "ausführlicher antworten",
  UNNATURAL: "natürlicher formulieren",
  REGISTER_MISMATCH: "passendes Register (du/Sie)",
  REPETITION: "Wiederholungen vermeiden",
  CORRECT_BUT_SIMPLE: "anspruchsvollere Ausdrücke",
  IDIOMATIC_UPGRADE: "idiomatischer formulieren",
  ACCENT: "Akzente",
});

export const SEVERITY_ORDER = Object.freeze(["error", "goal", "naturalness", "upgrade", "hint"]);

export const MEMORY_TYPE_LABELS = Object.freeze({
  recurring_error: "wiederkehrender Fehler",
  production_gap: "frei noch unsicher",
  avoided_structure: "wird oft umgangen",
  stable_strength: "sitzt sicher",
  auditory_recognition_gap: "beim Hören noch nicht erkannt",
  note: "Notiz",
});

export const MEMORY_STATUS_LABELS = Object.freeze({
  candidate: "zeichnet sich ab",
  active: "aktuell",
  weakening: "lässt nach",
  resolved: "überwunden",
  superseded: "ersetzt",
});

export function typeLabel(type) {
  return EXERCISE_TYPE_LABELS[type] ?? "Übung";
}

/** "1 Übung" / "3 Übungen" */
export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Sekunden → "4 min" (mindestens 1 min, sobald es mehr als 0 s sind). */
export function minutesText(seconds) {
  if (!(seconds > 0)) return "0 min";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
