/**
 * Learning Engine: der Einstiegspunkt der Lernlogik.
 *
 * Reine JavaScript-Logik ohne DOM, ohne Python, ohne direkten IndexedDB-Zugriff.
 * Sie erzeugt geprüfte Ereignisse und legt sie über die Speicher-Schnittstelle ab.
 *
 * Kompetenzstand (competence/snapshot.js), Wiederholungsstand (repetition/snapshot.js),
 * Lernprofil und Lernbedarfe (brain/), Sessionplan (planning/planner.js), Lerngedächtnis (memory/derive.js),
 * Session-Zustand (session/state.js) und Coaching-Bericht (coaching/report.js) werden
 * aus den Ereignissen berechnet; die
 * Durchführung einer Session übernimmt session/runtime.js. Bewusst noch NICHT enthalten (folgt in späteren
 * Schritten, ebenfalls als Berechnung aus den Ereignissen): Fortschritt, Streak, Tagesziel.
 */

import { assertStorage } from "../storage/storage.js";
import { readEvaluation } from "../evaluation/result.js";
import { deriveMemories } from "../memory/derive.js";
import { uuidv7 } from "../util/ids.js";
import { evidenceForExercise } from "./competence/evidence.js";
import { buildCoachingReport } from "./coaching/report.js";
import { buildCompetenceSnapshot } from "./competence/snapshot.js";
import { ASSESSMENT_EVENT_TYPES, CONVERSATION_EVENT_TYPES, EVENT_TYPES, LANGUAGE_ID, SESSION_EVENT_TYPES, createEvent } from "./events.js";
import { ensureDevice } from "./identity.js";
import { buildLearnerBrain } from "./brain/brain.js";
import { buildCalibration } from "./calibration/calibration.js";
import { buildListeningProfile } from "./listening/evidence.js";
import { isListening, isListeningOnly } from "./listening/model.js";
import { abilityFromProfile } from "./planning/zone.js";
import { planSession } from "./planning/planner.js";
import { buildActivitySummary } from "./progress/activity.js";
import { buildReviewSnapshot } from "./repetition/snapshot.js";

export class LearningEngine {
  /**
   * @param {{storage: object, learnerId: string, languageId: string, clock?: () => Date, newId?: () => string}} options
   *   learnerId: der Lerner (Mehrbenutzerbetrieb). Pflicht: Es gibt keinen stillen Standard-Lerner.
   *   languageId: die Lernsprache (P11B, "es", "en", …). Pflicht: Es gibt keine stille Standardsprache.
   *   Eine Engine gilt für GENAU EIN Paar (Lerner, Sprache): Jedes erzeugte Ereignis trägt beide, jede
   *   Berechnung (Kompetenz, Gedächtnis, Brain, Plan, Sessions, Gespräche) sieht nur deren Ereignisse.
   *   Ein spanischer Fehler kann so nie eine englische Kompetenz verändern.
   */
  constructor({ storage, learnerId, languageId, clock = () => new Date(), newId = uuidv7 }) {
    if (typeof learnerId !== "string" || !learnerId) throw new TypeError("LearningEngine: learnerId (Lerner) fehlt");
    if (typeof languageId !== "string" || !LANGUAGE_ID.test(languageId)) throw new TypeError("LearningEngine: languageId (Lernsprache) fehlt");
    this.storage = assertStorage(storage);
    this.learnerId = learnerId;
    this.languageId = languageId;
    this._clock = clock;
    this._newId = newId;
    this.identity = null;
  }

  /** Lädt oder erzeugt die Gerätekennung. Vor allem anderen aufrufen. */
  async start() {
    this.identity = { userId: this.learnerId, deviceId: await ensureDevice(this.storage, this._newId) };
    return this.identity;
  }

  /**
   * Speichert einen Versuch samt Bewertung. Aus der Bewertung entstehen im selben
   * Speichervorgang: je eine Skill-Beobachtung und je ein Fehlerereignis für jeden
   * Befund mit Fehlerschlüssel.
   *
   * Beobachtungen (skill_observation Version 2) übernehmen aus dem EvaluationResult v2 Art,
   * Ergebnis, Verlässlichkeit, Grundlage und Nachweisstufe; dazu die Bedingungen des Versuchs
   * (Übungsart, Eingabe, Gespräch, Dauer). Ein v1-Ergebnis wird nicht umgedeutet: Seine
   * Beobachtungen bleiben "unclassified", die Nachweisstufe kommt wie bisher aus der Übung.
   *
   * @param {{
   *   exercise: {id: string, revision: number, mode: string, type: string, evaluation_mode: string},
   *   contentVersion: string,
   *   answerText: string,
   *   evaluation: object,            EvaluationResult v2 (v1 wird weiterhin angenommen)
   *   evidence?: string,             nur für v1: Nachweisstufe statt der aus der Übung abgeleiteten
   *   inputMode?: string, durationMs?: number|null,
   *   sessionId?: string|null, conversationId?: string|null,
   *   followUp?: (attempt) => {type: string, payload: object}[]   Gesprächs-Ereignisse zum Versuch,
   *                                  gespeichert im selben Schreibvorgang (nie ein Versuch ohne Runde)
   * }} input
   */
  /**
   * P15: Kontext beim Hören (abspielen, Pause, wiederholen, Hilfe, überspringen, "nichts verstanden"). Keine Evidenz:
   * Evidenz ist nur die Antwort (recordAttempt). Überspringen ist nie eine falsche Antwort.
   */
  async recordListeningInteraction({ exerciseId, action, playCount = 0, supportLevel = "question", sessionId = null }) {
    const event = this._event(EVENT_TYPES.LISTENING_INTERACTION, {
      exercise_id: exerciseId, action, play_count: playCount, support_level: supportLevel, session_id: sessionId,
    });
    await this.storage.appendEvents([event]);
    return event;
  }

  async recordAttempt({
    exercise, contentVersion, answerText, evaluation, evidence,
    inputMode = "text", durationMs = null, sessionId = null, conversationId = null, followUp = null, listening = null,
  }) {
    const view = readEvaluation(evaluation);
    const level = evidence ?? evidenceForExercise(exercise, { conversationId, inputMode });
    const conditions = {
      exercise_type: exercise.type,
      exercise_mode: exercise.mode,
      evaluation_mode: exercise.evaluation_mode,
      input_mode: inputMode,
      conversation_id: conversationId,
      duration_ms: durationMs,
    };
    const attempt = this._event(EVENT_TYPES.ATTEMPT, {
      exercise_id: exercise.id,
      exercise_revision: exercise.revision,
      content_version: contentVersion,
      answer_text: answerText,
      input_mode: inputMode,
      duration_ms: durationMs,
      session_id: sessionId,
      conversation_id: conversationId,
      evaluation,
      // P15: Höraufgabe → wie oft gehört, mit welcher Hilfe beantwortet (Standard: einmal, ohne Hilfe)
      ...(isListening(exercise) ? { listening: {
        play_count: listening?.playCount ?? 1,
        support_level: listening?.supportLevel ?? exercise.listening?.base_support ?? "question",
      } } : {}),
    });
    // P15: Reine Höraufgaben (Auswahl, Diktat) sind Hörevidenz, keine schriftliche Kompetenz und keine Fehler
    const writtenEvidence = !isListeningOnly(exercise);
    const evidenceOf = new Map(view.observations.map((o) => [o.skill_id, o.evidence ?? level]));
    const observations = (writtenEvidence ? view.observations : []).map((o) =>
      this._event(EVENT_TYPES.SKILL_OBSERVATION, {
        attempt_id: attempt.id,
        skill_id: o.skill_id,
        observation_kind: o.observation_kind,
        outcome: o.outcome,
        reliability: o.reliability,
        basis: o.basis,
        evidence: o.evidence ?? level,
        source: o.source,
        conditions,
      }));
    const errors = view.findings
      .filter((f) => writtenEvidence && f.error_key)
      .map((f) =>
        this._event(EVENT_TYPES.ERROR_EVENT, {
          attempt_id: attempt.id,
          error_key: f.error_key,
          source: f.source,
          evidence: evidenceOf.get(f.skill_id) ?? level,
          skill_id: f.skill_id,
          topic_id: f.topic_id,
          original: f.original,
          suggestion: f.suggestion,
        }));
    // followUp: Folgeereignisse, die zum Versuch gehören (z. B. conversation_turn); alles in EINEM Schreibvorgang
    const extra = (followUp ? followUp(attempt) : []).map(({ type, payload }) => {
      if (!CONVERSATION_EVENT_TYPES.includes(type) && !ASSESSMENT_EVENT_TYPES.includes(type)) {
        throw new TypeError(`Folgeereignis muss zu einem Gespräch oder einer Einstufung gehören: ${type}`);
      }
      return this._event(type, payload);
    });
    await this.storage.appendEvents([attempt, ...observations, ...errors, ...extra]);
    return { attempt, observations, errors, extra };
  }

  /** Speichert eine Wiederholung (Spaced Repetition) als Ereignis. */
  async recordReview({ skillId, grade, source = "review", attemptId = null }) {
    const event = this._event(EVENT_TYPES.REVIEW_EVENT, {
      skill_id: skillId,
      grade,
      source,
      attempt_id: attemptId,
    });
    await this.storage.appendEvents([event]);
    return event;
  }

  /**
   * Speichert ein Ereignis des Session-Lebenszyklus (session_started … session_abandoned).
   * Ob der Übergang erlaubt ist, prüft die Session Runtime vorher.
   */
  async recordSessionEvent(type, payload) {
    if (!SESSION_EVENT_TYPES.includes(type)) throw new TypeError(`Kein Session-Ereignis: ${type}`);
    const event = this._event(type, payload);
    await this.storage.appendEvents([event]);
    return event;
  }

  /**
   * Speichert Ereignisse des Gesprächs-Lebenszyklus (conversation_*), mehrere in einem Schreibvorgang.
   * Ob der Übergang erlaubt ist, prüft die Conversation Runtime vorher.
   */
  async recordConversationEvents(entries) {
    for (const { type } of entries) {
      if (!CONVERSATION_EVENT_TYPES.includes(type)) throw new TypeError(`Kein Gesprächs-Ereignis: ${type}`);
    }
    const events = entries.map(({ type, payload }) => this._event(type, payload));
    await this.storage.appendEvents(events);
    return events;
  }

  /** Speichert Ereignisse der Einstufung und des Profilverlaufs (P11B), mehrere in einem Schreibvorgang. */
  async recordAssessmentEvents(entries) {
    for (const { type } of entries) {
      if (!ASSESSMENT_EVENT_TYPES.includes(type)) throw new TypeError(`Kein Einstufungs-Ereignis: ${type}`);
    }
    const events = entries.map(({ type, payload }) => this._event(type, payload));
    await this.storage.appendEvents(events);
    return events;
  }

  /** Aktueller Zeitpunkt der Engine-Uhr (in Tests festlegbar). */
  now() {
    return this._clock();
  }

  /** Neue UUID v7 (z. B. für eine Session-ID). */
  newId() {
    return this._newId();
  }

  /**
   * Aktueller Kompetenzstand, jedes Mal neu aus allen Ereignissen berechnet (nie gespeichert).
   * @param {{library?: import("../content/library.js").ContentLibrary, asOf?: Date}} [options]
   */
  async competenceSnapshot({ library = null, asOf } = {}) {
    return this._snapshot(await this._allEvents(), { library, asOf });
  }

  /**
   * Kompetenzstand nur für wenige Skills (z. B. die einer Höraufgabe): nur die Ereignisse, die zu diesen Skills
   * beitragen (Beobachtungen, Fehler- und Wiederholungsereignisse dieser Skills und deren Versuche für den
   * Übungskontext), damit die Rückmeldung auch bei langer Historie schnell bleibt. Für die genannten Skills dasselbe
   * Ergebnis wie competenceSnapshot.
   * @param {{skillIds: string[], asOf?: Date}} options
   */
  async competenceForSkills({ skillIds, asOf }) {
    const skills = new Set(skillIds);
    const all = await this._allEvents();
    const skillOf = (e) => (e.event_type === EVENT_TYPES.ERROR_EVENT ? e.payload.error_key : e.payload?.skill_id);
    const own = all.filter((e) => e.event_type !== EVENT_TYPES.ATTEMPT && skills.has(skillOf(e)));
    const attemptIds = new Set(own.map((e) => e.payload.attempt_id).filter(Boolean));
    const events = [...own, ...all.filter((e) => e.event_type === EVENT_TYPES.ATTEMPT && attemptIds.has(e.id))];
    return buildCompetenceSnapshot({ events, userId: this.identity.userId, skillIds: [...skills], asOf: asOf ?? this._clock() });
  }

  /**
   * Wiederholungsstand aller Skills (wann wieder?), jedes Mal neu aus den Ereignissen berechnet.
   * @param {{library?: import("../content/library.js").ContentLibrary, asOf?: Date}} [options]
   */
  async reviewSnapshot({ library = null, asOf } = {}) {
    return this._reviews(await this._allEvents(), { library, asOf });
  }

  /**
   * Plan für die nächste Session, jedes Mal neu aus Kompetenzstand, Wiederholungsstand und Verlauf.
   * @param {{library: import("../content/library.js").ContentLibrary, minutes: 5|10|15|20|30, asOf?: Date}} options
   */
  async planSession({ library, minutes, asOf }) {
    const events = await this._allEvents();
    const at = asOf ?? this._clock();
    const brain = buildLearnerBrain({ events, userId: this.identity.userId, asOf: at, library });
    return planSession({
      library, snapshot: brain.snapshot, reviews: brain.reviews, memories: brain.memories, events, minutes,
      dimensionNeeds: brain.dimension_needs, ability: abilityFromProfile(brain.language_profile),
      calibration: await this.calibration({ library, asOf: at }),
      listeningNeeds: brain.listening_needs, listening: brain.listening,
    });
  }

  /**
   * Empirische Kalibrierung (P14B) aus den Ereignissen ALLER Lerner dieser Sprache auf diesem Gerät: ein Signal über
   * Inhalte (Sprache × Inhalt × Aufgabe), nie über einen anderen Lerner. Abgeleitet, nie gespeichert; ein kleiner
   * Zwischenspeicher gilt nur, solange sich Ereignisse, Inhaltsversion und Stichtag-Ausschnitt nicht ändern.
   * @param {{library: object, asOf?: Date}} options
   */
  async calibration({ library, asOf }) {
    const at = asOf ?? this._clock();
    const cutoff = at.toISOString();
    const events = (await this.storage.listEvents({ language: this.languageId })).filter((e) => e.created_at <= cutoff);
    const key = `${this.languageId}|${library.contentVersion ?? ""}|${events.length}|${events.at(-1)?.id ?? ""}`;
    if (this._calibrationCache?.key !== key) {
      this._learnerCalibrationCache ??= new Map(); // je Lerner: nur wer neue Ereignisse hat, wird neu gerechnet
      this._calibrationCache = { key, value: buildCalibration({ events, library, languageId: this.languageId, asOf: at,
        learnerCache: this._learnerCalibrationCache }) };
    }
    return this._calibrationCache.value;
  }

  /**
   * Adaptive Learning Brain: Kompetenz, Wiederholung, Erinnerungen, Lernprofil und Lernbedarfe in einem
   * Durchgang, jedes Mal neu aus den Ereignissen (nie gespeichert).
   * @param {{library: import("../content/library.js").ContentLibrary, asOf?: Date}} options
   */
  async learnerBrain({ library, asOf }) {
    return buildLearnerBrain({ events: await this._allEvents(), userId: this.identity.userId, asOf: asOf ?? this._clock(), library });
  }

  /**
   * Hörprofil (P15, eigene Evidenzquelle neben der schriftlichen Kompetenz), jedes Mal neu aus den Ereignissen.
   * @param {{library: import("../content/library.js").ContentLibrary, asOf?: Date}} options
   */
  async listeningProfile({ library, asOf }) {
    const events = await this._allEvents();
    const at = asOf ?? this._clock();
    const snapshot = this._snapshot(events, { library, asOf: at });
    return buildListeningProfile({ events, library, userId: this.identity.userId, asOf: at, snapshot });
  }

  _reviews(events, { library, asOf }) {
    return buildReviewSnapshot({
      events,
      userId: this.identity.userId,
      skillIds: library ? library.skills().map((skill) => skill.id) : [],
      asOf: asOf ?? this._clock(),
    });
  }

  /**
   * Aktivität (Lerntage, Streak, Lernzeit, letzte Tage), aus den Ereignissen berechnet.
   * @param {{asOf?: Date, days?: number}} [options]
   */
  async activitySummary({ asOf, days } = {}) {
    return buildActivitySummary({
      events: await this._allEvents(), userId: this.identity.userId, asOf: asOf ?? this._clock(), days,
    });
  }

  /**
   * Erinnerungen (wiederkehrende Fehler, Produktionslücken, Vermeiden, Stärken), aus den
   * Ereignissen abgeleitet (nie gespeichert; ein MemoryStore kann sie per reconcile übernehmen).
   * @param {{library?: import("../content/library.js").ContentLibrary, asOf?: Date}} [options]
   */
  async memories({ library = null, asOf } = {}) {
    return deriveMemories({
      events: await this._allEvents(), userId: this.identity.userId, asOf: asOf ?? this._clock(), library,
    });
  }

  /**
   * Coaching-Bericht (Stärken, Schwächen, Muster, Empfehlungen), jedes Mal neu aus den
   * Ereignissen berechnet (nie gespeichert).
   * @param {{library: import("../content/library.js").ContentLibrary, asOf?: Date}} options
   */
  async coachingReport({ library, asOf }) {
    return buildCoachingReport({
      events: await this._allEvents(), userId: this.identity.userId, asOf: asOf ?? this._clock(), library,
    });
  }

  _snapshot(events, { library, asOf }) {
    return buildCompetenceSnapshot({
      events,
      userId: this.identity.userId,
      skillIds: library ? library.skills().map((skill) => skill.id) : [],
      contentVersion: library?.contentVersion ?? null,
      asOf: asOf ?? this._clock(),
    });
  }

  async _allEvents() {
    if (!this.identity) throw new Error("LearningEngine.start() wurde noch nicht aufgerufen");
    return this.storage.listEvents({ userId: this.learnerId, language: this.languageId });
  }

  /** Verlauf DIESES Lerners aus dem Speicher (sortiert nach Zeit). Ereignisse anderer Nutzer nie. */
  history(query = {}) {
    return this.storage.listEvents({ ...query, userId: this.learnerId, language: this.languageId });
  }

  _event(type, payload) {
    if (!this.identity) throw new Error("LearningEngine.start() wurde noch nicht aufgerufen");
    return createEvent({
      type,
      payload,
      userId: this.identity.userId,
      deviceId: this.identity.deviceId,
      language: this.languageId,
      now: this._clock(),
      newId: this._newId,
    });
  }
}
