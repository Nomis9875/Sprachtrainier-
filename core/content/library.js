/**
 * Inhaltsbibliothek: liest das JSON-Inhaltspaket EINER Lernsprache (web/content/<sprache>/content-package.json)
 * und stellt schnelle Nachschlage-Funktionen bereit.
 *
 * Reine Logik: kein DOM, kein fetch. Wie das Paket geladen wird (fetch, Cache,
 * Datei), entscheidet die aufrufende Schicht.
 */

import { PATTERN_SYNTAX_VERSION } from "../evaluation/patterns.js";
import { isSkillId } from "./skills.js";

export const PACKAGE_FORMAT = "spanisch-ai.content-package";
export const PACKAGE_FORMAT_VERSION = 1;

const REQUIRED_SECTIONS = ["topics", "grammar_rules", "common_errors", "lexical_items", "exercises", "skills"];

export class ContentPackageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentPackageError";
  }
}

/**
 * Leere Bibliothek für eine registrierte Sprache ohne Inhaltspaket (P11B): Die App läuft, bietet aber
 * nichts zum Üben an ("Inhalte in Vorbereitung"). Es werden keine Inhalte erfunden oder übersetzt.
 */
export function emptyContentLibrary(languageId) {
  return new ContentLibrary({
    format: PACKAGE_FORMAT, format_version: PACKAGE_FORMAT_VERSION, pattern_syntax: PATTERN_SYNTAX_VERSION,
    content_version: null, language: { ...LANGUAGE_DEFAULTS, id: languageId }, empty: true,
    topics: [], lists: {}, grammar_rules: [], common_errors: [], lexical_items: [], exercises: [], skills: [],
  });
}

/** @returns {ContentLibrary} */
export function loadContentPackage(pkg) {
  if (pkg?.format !== PACKAGE_FORMAT) throw new ContentPackageError(`Unbekanntes Paketformat: ${pkg?.format}`);
  if (pkg.format_version !== PACKAGE_FORMAT_VERSION) {
    throw new ContentPackageError(`Paketversion ${pkg.format_version} wird nicht unterstützt`);
  }
  if (pkg.pattern_syntax !== PATTERN_SYNTAX_VERSION) {
    throw new ContentPackageError(`Musterschreibweise ${pkg.pattern_syntax} wird nicht unterstützt`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!Array.isArray(pkg[section])) throw new ContentPackageError(`Abschnitt '${section}' fehlt`);
  }
  // P20: Die Sprache ist Pflicht (keine stille Standardsprache Spanisch)
  if (typeof pkg.language?.id !== "string" || !pkg.language.id) throw new ContentPackageError("Abschnitt 'language' fehlt");
  return new ContentLibrary(pkg);
}

/** Sprachangaben, die ältere Pakete (vor P20) noch nicht tragen: Werte wie bisher fest im Code (Spanisch). */
const LANGUAGE_DEFAULTS = Object.freeze({
  germanism_explanation_de: "", cefr_range: ["A1", "C2"], accent_marks: ["acute", "diaeresis"], vowels: "aeiouáéíóúüy",
  contractions: [],
});

export class ContentLibrary {
  constructor(pkg) {
    this.contentVersion = pkg.content_version;
    // Sprache des Pakets (P11B; P20 Pflicht, siehe loadContentPackage) mit dem, was die Sprache der Engine mitgibt
    this.language = { ...LANGUAGE_DEFAULTS, ...pkg.language };
    this.languageId = this.language.id;
    this.empty = pkg.empty === true;
    this.lists = pkg.lists ?? {};
    this._exercises = byId(pkg.exercises);
    // P24: Erklärungen in weiteren Erklärungssprachen ("<sprache>/<art>/<id>" → {title, explanation})
    this._localizations = new Map((pkg.localizations ?? []).map((x) => [x.id, { title: x.title, explanation: x.explanation }]));
    this._rules = byId(pkg.grammar_rules);
    this._errors = byId(pkg.common_errors);
    this._items = byId(pkg.lexical_items);
    this._topics = byId(pkg.topics);
    this._skills = byId(pkg.skills);
    for (const id of this._skills.keys()) {
      if (!isSkillId(id)) throw new ContentPackageError(`Ungültige Skill-ID im Paket: ${id}`);
    }
    this._bySkill = pkg.indexes?.exercises_by_skill ?? {};
    // Gespräche (P11A); ältere Pakete ohne diese Abschnitte haben keine
    this._conversations = byId(pkg.conversations ?? []);
    const engine = pkg.conversation_engine ?? {};
    this._goals = byId(engine.goals ?? []);
    this._signals = engine.signals ?? [];
    this._reactions = byId(engine.reactions ?? []);
    this._turnExercises = new Map();
    for (const scenario of this._conversations.values()) {
      for (const move of scenario.moves) this._turnExercises.set(move.exercise.id, move.exercise);
    }
    // Einstufung (P11B): Aufgaben je Kompetenzbereich; jede ist eine Übung "assessment/<id>"
    this._assessmentItems = byId(pkg.assessment?.items ?? []);
    this._assessmentExercises = new Map([...this._assessmentItems.values()].map((item) => [item.exercise.id, item.exercise]));
    this._byTopic = pkg.indexes?.exercises_by_topic ?? {};
    this._audio = byId(pkg.audio ?? []); // P15: Aufnahmen (Herkunft, Lizenz, Dauer, Tempo, src)
    this._texts = byId(pkg.texts ?? []); // P16: Lese-/Hörtexte (Titel, Fragen) für den Hörkontext
  }

  /** Alle Lese- und Hörtexte (P24: Einstieg „Hören und Lesen“ beim Üben). */
  texts() {
    return [...this._texts.values()];
  }

  /** Lese- oder Hörtext (P16: Hörkontext) nach ID. */
  text(textId) {
    return this._texts.get(textId);
  }

  /**
   * P24: Titel und Erklärung einer Struktur (kind "rule") oder eines typischen Fehlers ("error") in einer weiteren
   * Erklärungssprache; null, wenn es keine gibt (dann gilt die deutsche Erklärung).
   */
  localization(language, kind, refId) {
    return this._localizations.get(`${language}/${kind}/${refId}`) ?? null;
  }

  /** Aufnahme (P15) nach ID, mit Herkunft, Lizenz und den aus der Datei gelesenen Angaben. */
  audio(audioId) {
    return this._audio.get(audioId);
  }

  audioAssets() {
    return [...this._audio.values()];
  }

  exercise(id) {
    return this._exercises.get(id);
  }

  /** Alle verwendbaren Übungen (ohne 'retired'). */
  exercises({ includeRetired = false } = {}) {
    const all = [...this._exercises.values()];
    return includeRetired ? all : all.filter((ex) => ex.status !== "retired");
  }

  grammarRule(id) {
    return this._rules.get(id);
  }

  commonError(id) {
    return this._errors.get(id);
  }

  lexicalItem(id) {
    return this._items.get(id);
  }

  topic(id) {
    return this._topics.get(id);
  }

  /** Alle Themen in der Reihenfolge des Pakets (nach ID); Oberthemen haben parent_id null. */
  topics() {
    return [...this._topics.values()];
  }

  /** Alle Strukturen, typischen Fehler bzw. Ausdrücke in der Reihenfolge des Pakets (nach ID). */
  grammarRules() {
    return [...this._rules.values()];
  }

  commonErrors() {
    return [...this._errors.values()];
  }

  lexicalItems() {
    return [...this._items.values()];
  }

  skill(id) {
    return this._skills.get(id);
  }

  skills() {
    return [...this._skills.values()];
  }

  /** Übungen, die einen Skill trainieren oder beobachten (ohne 'retired'). */
  exercisesForSkill(skillId) {
    return this._resolve(this._bySkill[skillId]);
  }

  /** Übungen zu einem Thema, auf Wunsch einschließlich aller Unterthemen. */
  exercisesForTopic(topicId, { includeSubtopics = true } = {}) {
    const topics = includeSubtopics
      ? Object.keys(this._byTopic).filter((id) => id === topicId || id.startsWith(`${topicId}.`))
      : [topicId];
    const ids = new Set(topics.flatMap((id) => this._byTopic[id] ?? []));
    return this._resolve([...ids]);
  }

  /** Gesprächsszenarien (ohne 'retired'), nach ID. */
  conversations({ includeRetired = false } = {}) {
    const all = [...this._conversations.values()];
    return includeRetired ? all : all.filter((s) => s.status !== "retired");
  }

  conversation(id) {
    return this._conversations.get(id);
  }

  /** Ein Schritt eines Szenarios (Fragen, verdeckte Lernziele und die Übung, mit der die Antwort bewertet wird). */
  conversationMove(scenarioId, moveId) {
    return this._conversations.get(scenarioId)?.moves.find((m) => m.id === moveId);
  }

  /** Gesprächsziel (opinion, discussion, …) mit seinen Schritten. */
  conversationGoal(goalId) {
    return this._goals.get(goalId);
  }

  /** Gesprächssignale (Unsicherheit, Widerspruch, Abwägen) und Reaktionen des Gesprächspartners. */
  conversationSignals() {
    return this._signals;
  }

  conversationReaction(id) {
    return this._reactions.get(id);
  }

  /**
   * Die Übung eines Gesprächsschritts ("<szenario>/<schritt>"). Schritte stehen bewusst nicht unter
   * exercise(): Planer, Übersichten und Verzeichnisse sehen sie nicht als Einzelübung.
   */
  turnExercise(exerciseId) {
    return this._turnExercises.get(exerciseId);
  }

  /** Einstufungsaufgaben (optional nur eines Kompetenzbereichs), nach ID. */
  assessmentItems({ dimension = null } = {}) {
    const all = [...this._assessmentItems.values()];
    return dimension ? all.filter((item) => item.dimension === dimension) : all;
  }

  assessmentItem(id) {
    return this._assessmentItems.get(id);
  }

  /** Übung einer Einstufungsaufgabe ("assessment/<id>"); wie Gesprächsschritte nicht unter exercise(). */
  assessmentExercise(exerciseId) {
    return this._assessmentExercises.get(exerciseId);
  }

  /** Jede bewertbare Übung des Pakets: Einzelübung, Gesprächsschritt oder Einstufungsaufgabe. */
  anyExercise(exerciseId) {
    return this._exercises.get(exerciseId) ?? this._turnExercises.get(exerciseId) ?? this._assessmentExercises.get(exerciseId);
  }

  _resolve(ids = []) {
    return ids.map((id) => this._exercises.get(id)).filter((ex) => ex && ex.status !== "retired");
  }
}

function byId(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}
