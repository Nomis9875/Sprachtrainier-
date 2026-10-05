/**
 * App-Service: die einzige Stelle, an der die Oberfläche die Lernlogik anspricht (DOM-frei, testbar).
 *
 *   UI (ui/*.js)  ──▶  LearnerApp  ──▶  LearningEngine · SessionRuntime · evaluateAnswer · MemoryStore
 *                        │                         (web/core: Ereignisse, Kompetenz, Wiederholung,
 *                        ▼                          Planung, Gedächtnis)
 *                  model/*.js: Anzeige-Modelle      Speicher: die übergebene Storage-Implementierung
 *
 * Regeln:
 * - Keine eigene Lernlogik: Pläne, Bewertungen, Zustände und Muster kommen aus dem Kern.
 * - Ereignisse sind die Wahrheit. Eine Antwort wird bewertet und als Ereignis gespeichert
 *   (über die Session Runtime bzw. engine.recordAttempt); nichts anderes wird "hochgezählt".
 * - Abgeleitetes (Kompetenz, Wiederholung, Aktivität, Erinnerungen) wird bei Bedarf neu berechnet
 *   und nie gespeichert. Der MemoryStore ist ein Zwischenstand, jederzeit aus den Ereignissen neu.
 * - Metadaten enthalten nur Kennungen und Einstellungen (Profil), nie Lernstand.
 * - Der Speicher ist austauschbar (IndexedDB im Browser, Arbeitsspeicher in Tests).
 * - Sprache und KI (P10): Eine gesprochene Antwort kommt hier schon als Text an (inputMode "speech")
 *   und geht denselben Weg wie eine getippte. Die KI-Zusatzanalyse (assistant, nur mit Einstellung
 *   ai_analysis) ergänzt die Regelbewertung höchstens um geprüfte Zusatzhinweise
 *   (core/evaluation/supplemental.js); fällt sie aus, gilt die Regelbewertung allein.
 * - Gespräche (P11A): Jede Antwort wird wie eine Übung bewertet und gespeichert. Was der Gesprächspartner
 *   als Nächstes sagt, entscheidet die Conversation Engine (core/conversation), nicht das Brain.
 */

import { InvalidAnswerError } from "../../core/evaluation/closed.js";
import { evaluateAnswer } from "../../core/evaluation/evaluate.js";
import { INPUT_MODES } from "../../core/evaluation/result.js";
import { mergeSupplemental, supplementalRequest } from "../../core/evaluation/supplemental.js";
import { secureLevel } from "../../core/learning/competence/production.js";
import { levelValue } from "../../core/learning/profile/scale.js";
import { skillsOf } from "../../core/learning/listening/evidence.js";
import { SUPPORT_LEVELS } from "../../core/learning/listening/model.js";
import { readEvaluation } from "../../core/evaluation/result.js";
import { listeningFeedback, presentListeningOverview } from "../model/listening.js";
import { renderJourneyText, traceLearningJourney } from "../../core/learning/brain/validation.js";
import { assertContextOwner, buildConversationContext } from "../../core/learning/conversation/context.js";
import { BUDGET_MINUTES } from "../../core/conversation/policy.js";
import { buildConversationResult } from "../../core/learning/conversation/result.js";
import { ConversationError, ConversationRuntime, RULE_REASONS } from "../../core/learning/conversation/runtime.js";
import { AssessmentError, AssessmentRuntime } from "../../core/learning/assessment/runtime.js";
import { presentAssessment, presentLanguageProfile } from "../model/language.js";
import { LearningEngine } from "../../core/learning/engine.js";
import { SESSION_LENGTHS, learnerItem, learnerTitle, learnerView } from "../../core/learning/planning/planner.js";
import { SessionError, SessionRuntime } from "../../core/learning/session/runtime.js";
import { DEFAULT_PREFERENCES, UserError } from "../../core/learning/users.js";
import { LocalMemoryStore } from "../../core/memory/store.js";
import { presentConversation, scenarioCard } from "../model/conversation.js";
import { buildDashboard, describePreview } from "../model/dashboard.js";
import { exerciseCard, presentExercise } from "../model/exercise.js";
import { skillTitle } from "../model/labels.js";
import { t, uiLanguage } from "../model/i18n.js";
import { explanationLanguageOf, localizedListeningFeedback } from "../model/explain.js";
import { presentFeedback } from "../model/feedback.js";
import { buildProgress } from "../model/progress.js";

export const DEFAULT_PROFILE = Object.freeze({ daily_minutes: DEFAULT_PREFERENCES.daily_minutes, ai_analysis: DEFAULT_PREFERENCES.ai_analysis,
  explanation_language: DEFAULT_PREFERENCES.explanation_language });
export const SESSION_MINUTES = Object.freeze(Object.keys(SESSION_LENGTHS).map(Number));
const OPEN_MEMORY = new Set(["candidate", "active", "weakening"]);

/** Fehler mit einer Meldung, die der Lerner sehen darf (keine technischen Details). */
export class AppError extends Error {
  constructor(userMessage, { cause, code = "app_error" } = {}) {
    super(userMessage, { cause });
    this.name = "AppError";
    // P25.2: Meldung in der Sprache der App (nach Code); ohne Übersetzung die ursprüngliche (Deutsch)
    this.userMessage = uiLanguage() !== "de" ? t(`err.${code}`) ?? userMessage : userMessage;
    this.code = code;
  }
}

export class LearnerApp {
  /**
   * Die App für GENAU EINEN Lerner in GENAU EINER Lernsprache (P11B: die Sprache des Inhaltspakets).
   * Ein Nutzer- oder Sprachwechsel erzeugt eine neue Instanz (main.js); nichts aus dieser Instanz
   * (Gedächtnis-Zwischenstand, Session, Gespräch, Einstufung) geht auf den anderen Lerner oder die andere
   * Sprache über.
   *
   * @param {{storage: object, library: object, users: import("../../core/learning/users.js").UserDirectory,
   *   learnerId: string, clock?: () => Date, persistent?: boolean,
   *   assistant?: {analyze(request: object, options?: {signal?: AbortSignal}): Promise<object>} | null}} options
   *   persistent: false, wenn nur im Arbeitsspeicher gespeichert wird (Hinweis in der Oberfläche)
   *   assistant: optionale KI-Zusatzanalyse (lokaler Server); null = ohne KI
   */
  constructor({ storage, library, users, learnerId, clock = () => new Date(), persistent = true, assistant = null }) {
    if (!users) throw new TypeError("LearnerApp: Nutzerverzeichnis (users) fehlt");
    this.storage = storage;
    this.library = library;
    this.languageId = library.languageId;
    this.users = users;
    this.learnerId = learnerId;
    this.clock = clock;
    this.persistent = persistent;
    this.assistant = assistant;
    this.engine = new LearningEngine({ storage, learnerId, languageId: this.languageId, clock });
    this.runtime = new SessionRuntime({ engine: this.engine, library });
    this.conversations = new ConversationRuntime({ engine: this.engine, library });
    this.assessments = new AssessmentRuntime({ engine: this.engine, library });
    this.memoryStore = new LocalMemoryStore();
  }

  async init() {
    const user = await this.users.get(this.learnerId);
    if (!user) throw new AppError("Dieser Nutzer existiert nicht (mehr).", { code: "unknown_user" });
    this._language = explanationLanguageOf(user.preferences?.explanation_language);
    await this.engine.start();
    return this;
  }

  // ---------------------------------------------------------------- Profil (Nutzer und Einstellungen)

  /** P24: Sprache der Erklärungen ("de" oder "es"), unabhängig von der Lernsprache. */
  get explanationLanguage() {
    return this._language ?? "de";
  }

  /** Der Lerner dieser App-Instanz. */
  async learner() {
    const user = await this.users.get(this.learnerId);
    return { id: user.id, display_name: user.display_name, created_at: user.created_at };
  }

  async profile() {
    const user = await this.users.get(this.learnerId);
    return { name: user.display_name, ...DEFAULT_PROFILE, ...user.preferences };
  }

  async saveProfile({ name, daily_minutes: minutes, ai_analysis: ai, explanation_language: explanation, ui_language: ui }) {
    try {
      const current = await this.profile();
      if (name !== undefined && String(name).trim() !== current.name) await this.users.rename(this.learnerId, name);
      const changes = {};
      if (minutes !== undefined) changes.daily_minutes = Number(minutes);
      if (ai !== undefined) changes.ai_analysis = Boolean(ai);
      if (explanation !== undefined) changes.explanation_language = explanation;
      if (ui !== undefined) changes.ui_language = ui; // P25.2: Sprache der App
      await this.users.updatePreferences(this.learnerId, changes);
      const saved = await this.profile();
      this._language = explanationLanguageOf(saved.explanation_language);
      return saved;
    } catch (error) {
      if (error instanceof UserError) throw new AppError(error.message, { cause: error, code: error.code });
      throw error;
    }
  }

  /** Einstellungen auf den Standard (der Name bleibt). */
  async resetProfile() {
    await this.users.updatePreferences(this.learnerId, { ...DEFAULT_PREFERENCES });
    this._language = DEFAULT_PREFERENCES.explanation_language;
    return this.profile();
  }

  // ---------------------------------------------------------------- Übersicht

  async dashboard() {
    const [profile, activity, reviews, memories, openSession] = await Promise.all([
      this.profile(),
      this.engine.activitySummary({ days: 14 }),
      this.engine.reviewSnapshot({ library: this.library }),
      this.memories(),
      this.runtime.openSession(),
    ]);
    const preview = openSession ? null : await this.planPreview(profile.daily_minutes);
    return buildDashboard({ profile, activity, reviews, memories, openSession, preview, languageId: this.library.languageId });
  }

  /** Nächste Session in Lernersicht (ohne sie zu starten). */
  async planPreview(minutes) {
    const plan = await this._plan(minutes);
    return describePreview({
      minutes,
      view: learnerView(plan),
      byPurpose: plan.metadata.mix.by_purpose,
      challengeCount: plan.exercises.filter((e) => e.mode === "challenge").length,
    });
  }

  async progress() {
    const [snapshot, coaching, memories, reviews, activity] = await Promise.all([
      this.engine.competenceSnapshot({ library: this.library }),
      this.engine.coachingReport({ library: this.library }),
      this.memories(),
      this.engine.reviewSnapshot({ library: this.library }),
      this.engine.activitySummary({ days: 14 }),
    ]);
    return buildProgress({ snapshot, coaching, memories, reviews, activity, library: this.library, language: this.explanationLanguage });
  }

  /** Erinnerungen aus den Ereignissen ableiten und in den MemoryStore übernehmen (alle Status). */
  async memories() {
    await this.memoryStore.reconcile(await this.engine.memories({ library: this.library }));
    return this.memoryStore.all();
  }

  // ---------------------------------------------------------------- Session

  async openSession() {
    const state = await this.runtime.openSession();
    return state ? this.sessionView(state) : null;
  }

  async startSession(minutes) {
    if (await this.runtime.openSession()) {
      throw new AppError("Es läuft bereits eine Session. Setze sie fort oder beende sie zuerst.", { code: "session_open" });
    }
    const plan = await this._plan(minutes);
    if (!plan.exercises.length) {
      throw new AppError("Für diese Länge gibt es gerade keine passenden Übungen.", { code: "empty_plan" });
    }
    return this.sessionView(await this.runtime.start(plan));
  }

  async session(sessionId) {
    return this.sessionView(await this.runtime.state(sessionId, { asOf: this.clock() }));
  }

  /**
   * Antwort zur aktuellen Übung: bewerten (Regeln, lokal), optional KI-Zusatzhinweise, als Ereignisse
   * speichern, Feedback. Getippt und gesprochen (inputMode "speech") gehen denselben Weg.
   * @param {string} sessionId
   * @param {{answerText: string, durationMs?: number|null, inputMode?: "text"|"speech", signal?: AbortSignal}} answer
   *   signal: bricht nur die KI-Zusatzanalyse ab (die Antwort wird trotzdem gespeichert)
   */
  async submitAnswer(sessionId, { answerText, durationMs = null, inputMode = "text", signal = null, listening = null }) {
    const before = await this.runtime.state(sessionId);
    if (before.status !== "active" || !before.current) {
      throw new AppError("Diese Session ist gerade nicht aktiv.", { code: "session_not_active" });
    }
    const exercise = this._exercise(before.current.exercise_id);
    const mode = cleanInputMode(inputMode);
    const { evaluation, ai } = await this._supplement(this._evaluate(exercise, answerText, mode), exercise, signal);
    const after = await this.runtime.state(sessionId); // während der KI-Analyse pausiert oder gewechselt?
    if (after.status !== "active" || after.current?.exercise_id !== exercise.id) {
      throw new AppError("Diese Session ist gerade nicht aktiv.", { code: "session_not_active" });
    }
    const { outcome, state } = await this.runtime.submit(sessionId, {
      answerText, evaluation, inputMode: mode, durationMs: cleanDuration(durationMs), listening: cleanListening(listening),
    });
    return {
      outcome,
      ai,
      feedback: await this._feedback(evaluation, exercise, answerText, mode, listening),
      session: this.sessionView(state),
    };
  }

  async pauseSession(sessionId) {
    return this._sessionStep(() => this.runtime.pause(sessionId, "user"));
  }

  async resumeSession(sessionId) {
    return this._sessionStep(() => this.runtime.resume(sessionId));
  }

  async abandonSession(sessionId) {
    return this._sessionStep(() => this.runtime.abandon(sessionId, "user"));
  }

  /** Rückblick nach Ende (oder Abbruch) einer Session. */
  async sessionSummary(sessionId) {
    const summary = await this.runtime.summary(sessionId, { asOf: this.clock() });
    const label = (id) => skillTitle(this.library.skill(id), id, { language: this.explanationLanguage, library: this.library });
    // Ergebnis je Antwort wie im Feedback (overall.outcome der gespeicherten Bewertung)
    const verdicts = (await this.engine.history({ type: "attempt" }))
      .filter((e) => e.payload.session_id === sessionId)
      .map((e) => e.payload.evaluation?.overall?.outcome);
    const practiced = summary.skills_practiced;
    return {
      session_id: summary.session_id,
      status: summary.status,
      completed: summary.exercises_completed,
      planned: summary.exercises_planned + summary.exercises_added,
      remaining: summary.exercises_remaining,
      minutes: Math.max(summary.exercises_completed ? 1 : 0, Math.round(summary.duration_seconds / 60)),
      answers: {
        correct: verdicts.filter((v) => v === "correct").length,
        without_errors: verdicts.filter((v) => v === "correct" || v === "needs_review").length,
        open: verdicts.filter((v) => v === "needs_review").length,
        with_errors: verdicts.filter((v) => v === "incorrect").length,
      },
      // Nur Skills, die in dieser Session nicht gelangen: nicht erreichte Fokus-Skills könnten Challenge-Ziele verraten.
      // "nicht gelungen" statt "Fehler": dazu zählt auch ein verfehltes Aufgabenziel, nicht nur ein Sprachfehler.
      weaknesses: practiced.filter((s) => s.failures > 0)
        .sort((a, b) => b.failures - a.failures || (a.skill_id < b.skill_id ? -1 : 1))
        .map((s) => ({ title: label(s.skill_id), failures: s.failures, successes: s.successes })),
      // Fortschritt nur ohne Rückschlag in dieser Session (ein gerade gemachter Fehler ist kein Fortschritt)
      improved: practiced
        .filter((s) => s.failures === 0 && s.mastery_after !== s.mastery_before)
        .map((s) => ({ title: label(s.skill_id), before: s.mastery_before, after: s.mastery_after })),
    };
  }

  /**
   * Lernersicht des Session-Zustands. Challenges verraten ihr Lernziel nicht: Der Schwerpunkt
   * kommt aus learnerItem() (nur Training), Skill-IDs und Begründungen werden nicht weitergegeben.
   */
  sessionView(state) {
    const current = state.current;
    let exercise = null;
    if (current) {
      const content = this._exercise(current.exercise_id);
      const item = learnerItem({ ...current, mode: content.mode, type: content.type }, skillTitle(this.library.skill(current.skill_id), "", { language: this.explanationLanguage, library: this.library }) || null);
      const planned = state.plan.exercises.find((e) => e.exercise_id === current.exercise_id);
      exercise = presentExercise(content, { focus: item.focus, purpose: planned?.purpose ?? null,
        planned: planned ? { purpose: planned.purpose ?? null, composition: planned.composition ?? null, zone: planned.zone_class ?? null } : null,
        audio: this._audioOf(content), language: this.explanationLanguage,
        listeningContext: this._contextOf(content) });
    }
    return {
      session_id: state.session_id,
      status: state.status,
      minutes: state.plan.minutes,
      title: learnerTitle({
        objective: state.plan.objective,
        exercises: state.plan.exercises.map((e) => ({ mode: this.library.exercise(e.exercise_id)?.mode ?? "training" })),
      }),
      position: Math.min(state.progress.completed + 1, state.progress.total),
      total: state.progress.total,
      completed: state.progress.completed,
      ratio: state.progress.ratio,
      seconds_remaining: state.progress.seconds_remaining,
      exercise,
      finished: state.status === "completed" || state.status === "abandoned",
    };
  }

  // ---------------------------------------------------------------- Üben (einzelne Übungen)

  /** Oberthemen mit Unterthemen und Anzahl der Übungen (nur Themen mit Übungen). */
  /** P24: Anzahl übbarer Hör- und Lesetexte (Einstieg „Hören und Lesen“ beim Üben). */
  practiceTextCounts() {
    const usable = (kind) => this.library.texts().filter((t) => t.kind === kind && t.available && t.exercise_ids?.length).length;
    return { listening: usable("listening"), reading: usable("reading") };
  }

  /**
   * P24: nächster Hör- oder Lesetext zum Üben: noch nicht beantwortet, möglichst nah am eigenen Niveau in diesem Bereich
   * (Sprachprofil), sonst der am längsten nicht geübte. Nur eine Abkürzung zum Üben; die Bewertung ist die übliche.
   * @param {"listening"|"reading"} kind
   * @returns {Promise<{exercise_id: string, title: string, level: string, questions: number}|null>}
   */
  async nextPracticeText(kind) {
    const texts = this.library.texts().filter((t) => t.kind === kind && t.available && t.exercise_ids?.length);
    if (!texts.length) return null;
    const last = new Map();
    for (const e of await this.engine.history({ type: "attempt" })) last.set(e.payload.exercise_id, e.created_at);
    const profile = await this.assessments.profile({ asOf: this.clock() });
    const theta = profile.dimensions?.[kind]?.theta ?? profile.overall?.theta ?? levelValue("B1");
    const answeredAt = (t) => t.exercise_ids.map((id) => last.get(id) ?? "").sort().at(-1) ?? "";
    const distance = (t) => Math.abs(levelValue(t.level) + 0.5 - theta);
    const [best] = texts.sort((a, b) => (answeredAt(a) < answeredAt(b) ? -1 : answeredAt(a) > answeredAt(b) ? 1 : 0)
      || distance(a) - distance(b) || (a.id < b.id ? -1 : 1));
    const first = best.exercise_ids.find((id) => !last.has(id)) ?? best.exercise_ids[0];
    return { exercise_id: first, title: best.title_es ?? "", level: best.level, questions: best.exercise_ids.length };
  }

  practiceTopics() {
    const topics = this.library.topics();
    return topics
      .filter((t) => !t.parent_id)
      .map((root) => ({
        id: root.id,
        name: root.name_de,
        count: this.library.exercisesForTopic(root.id).length,
        subtopics: topics
          .filter((t) => t.parent_id === root.id)
          .map((t) => ({ id: t.id, name: t.name_de, count: this.library.exercisesForTopic(t.id).length }))
          .filter((t) => t.count > 0),
      }))
      .filter((root) => root.count > 0);
  }

  practiceList(topicId) {
    const topic = this.library.topic(topicId);
    if (!topic) throw new AppError("Dieses Thema gibt es nicht (mehr).", { code: "unknown_topic" });
    const cards = this.library.exercisesForTopic(topicId)
      .map(exerciseCard)
      .sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "training" ? -1 : 1) || a.estimated_seconds - b.estimated_seconds
        || (a.id < b.id ? -1 : 1));
    return { topic: { id: topic.id, name: topic.name_de }, exercises: cards };
  }

  practiceExercise(exerciseId) {
    const exercise = this._exercise(exerciseId);
    return presentExercise(exercise, { audio: this._audioOf(exercise), listeningContext: this._contextOf(exercise), language: this.explanationLanguage });
  }

  // ---------------------------------------------------------------- Hören (P15)

  /**
   * Kontext beim Hören speichern (abspielen, Pause, wiederholen, Hilfe). Keine Evidenz, kein Fehler.
   * @param {string} exerciseId
   * @param {{action: string, playCount?: number, supportLevel?: string, sessionId?: string|null}} interaction
   */
  async recordListeningInteraction(exerciseId, { action, playCount = 0, supportLevel = "question", sessionId = null }) {
    const exercise = this._exercise(exerciseId);
    if (!exercise.listening) throw new AppError("Das ist keine Höraufgabe.", { code: "not_listening" });
    return this.engine.recordListeningInteraction({ exerciseId, action, playCount, supportLevel, sessionId });
  }

  /** Höraufgabe ohne Antwort verlassen ("skip") oder "nichts verstanden" ("dont_know"): kein Versuch, kein Fehler. */
  async skipListening(exerciseId, { reason = "skip", playCount = 0, supportLevel = "question", sessionId = null } = {}) {
    if (!["skip", "dont_know"].includes(reason)) throw new AppError("Unbekannter Grund.", { code: "invalid_reason" });
    await this.recordListeningInteraction(exerciseId, { action: reason, playCount, supportLevel, sessionId });
    return { recorded: reason };
  }

  /** Übersicht "Hören" (P15) für den Fortschritt: Zustände in Worten. */
  async listeningOverview({ asOf } = {}) {
    const profile = await this.engine.listeningProfile({ library: this.library, asOf: asOf ?? this.clock() });
    return presentListeningOverview(profile, this.library);
  }

  /** Hörkontext (P16): Titel des Hörtexts und "Frage k von n" (Reihenfolge der Fragen im Text). */
  _contextOf(exercise) {
    const text = exercise?.listening && exercise.text_id ? this.library.text(exercise.text_id) : null;
    if (!text) return null;
    const ids = text.questions.map((q) => `text/${text.id}/${q.id}`).filter((id) => this.library.exercise(id));
    return { title: text.title_es, task_index: ids.indexOf(exercise.id) + 1, task_count: ids.length };
  }

  _audioOf(exercise) {
    return exercise?.listening ? this.library.audio(exercise.listening.audio) ?? null : null;
  }

  /** Rückmeldung zum Hören (getrennt von der Sprachrichtigkeit), mit "schriftlich bekannt"-Hinweis. */
  async _listeningFeedback(exercise, evaluation, answerText, listening) {
    if (!exercise.listening) return null;
    const context = {
      play_count: listening?.playCount ?? 1,
      support_level: listening?.supportLevel ?? exercise.listening.base_support,
    };
    // nur die schriftlichen Beobachtungen der wenigen Skills dieser Aufgabe (schnell auch bei langer Historie)
    const skills = new Set(skillsOf(exercise));
    const snapshot = await this.engine.competenceForSkills({ skillIds: [...skills], asOf: this.clock() });
    const writtenSecure = snapshot.skills.some((s) => skills.has(s.skill_id) && ["controlled", "free", "spontaneous"].includes(secureLevel(s)));
    return listeningFeedback({
      exercise, audio: this._audioOf(exercise), outcome: readEvaluation(evaluation).overall.outcome, answerText, context, writtenSecure,
    });
  }

  /** Einzelne Übung außerhalb einer Session: bewerten (wie submitAnswer) und als Versuch speichern. */
  async submitPractice(exerciseId, { answerText, durationMs = null, inputMode = "text", signal = null, listening = null }) {
    const exercise = this._exercise(exerciseId);
    const mode = cleanInputMode(inputMode);
    const { evaluation, ai } = await this._supplement(this._evaluate(exercise, answerText, mode), exercise, signal);
    await this.engine.recordAttempt({
      exercise, contentVersion: this.library.contentVersion, answerText, evaluation, inputMode: mode, durationMs: cleanDuration(durationMs),
      listening: cleanListening(listening),
    });
    return { ai, feedback: await this._feedback(evaluation, exercise, answerText, mode, listening) };
  }

  // ---------------------------------------------------------------- Gespräche (P11A)

  /** Alle Szenarien mit dem Stand dieses Lerners (offen, wie oft abgeschlossen). */
  async conversationList() {
    const own = await this.conversations.list();
    return this.library.conversations().map((scenario) => scenarioCard(scenario, this.library.conversationGoal(scenario.goal), own));
  }

  /** Das offene (laufende oder pausierte) Gespräch dieses Lerners (Anzeige) oder null. */
  async openConversation() {
    const state = await this.conversations.open();
    return state ? this._conversationView(state) : null;
  }

  /**
   * Seite eines Szenarios: offenes Gespräch dazu (sonst das zuletzt beendete mit Lernanalyse) und ein
   * anderes offenes Gespräch, falls eines existiert (höchstens eines gleichzeitig).
   */
  async conversationPage(scenarioId) {
    const scenario = this.library.conversation(scenarioId);
    if (!scenario) throw new AppError("Dieses Gespräch gibt es im aktuellen Inhalt nicht.", { code: "unknown_scenario" });
    const own = await this.conversations.list();
    const open = own.find((c) => c.status === "active" || c.status === "paused") ?? null;
    const mine = open?.scenario_id === scenarioId ? open : null;
    const last = own.filter((c) => c.scenario_id === scenarioId && (c.status === "completed" || c.status === "abandoned")).at(-1) ?? null;
    return {
      scenario: scenarioCard(scenario, this.library.conversationGoal(scenario.goal), own),
      budgets: [...BUDGET_MINUTES],
      default_minutes: nearestBudget((await this.profile()).daily_minutes),
      conversation: mine ? await this._conversationView(mine) : null,
      last_finished: last ? await this._conversationView(last) : null,
      other_open: open && !mine ? { conversation_id: open.conversation_id, scenario_id: open.scenario_id,
        title: this.library.conversation(open.scenario_id)?.title_de ?? open.scenario_id } : null,
    };
  }

  async startConversation(scenarioId, { minutes = 10 } = {}) {
    return this._conversationView(await this._conversationStep(() => this.conversations.start(scenarioId, { minutes })));
  }

  async pauseConversation(conversationId, reason = "user") {
    return this._conversationView(await this._conversationStep(() => this.conversations.pause(conversationId, reason)));
  }

  async resumeConversation(conversationId) {
    return this._conversationView(await this._conversationStep(() => this.conversations.resume(conversationId)));
  }

  async abandonConversation(conversationId) {
    return this._conversationView(await this._conversationStep(() => this.conversations.abandon(conversationId)));
  }

  /**
   * Antwort auf die offene Frage des Gesprächspartners:
   *   bewerten (evaluateAnswer, wie jede Übung, im Gespräch "spontaneous") → optional KI (Zusatzhinweise
   *   und Auswahl unter den Vorschlägen der Engine, beide parallel, beide dürfen ausfallen) → speichern
   *   (Versuch + Runde, ein Schreibvorgang) → nächste Frage der Conversation Engine.
   * Während des Gesprächs gibt es keine Fehlerliste; die Lernanalyse folgt am Ende (conversation.result).
   * @param {string} conversationId
   * @param {{answerText: string, durationMs?: number|null, inputMode?: "text"|"speech", signal?: AbortSignal}} answer
   */
  async respondConversation(conversationId, { answerText, durationMs = null, inputMode = "text", signal = null }) {
    const state = await this._conversationStep(() => this.conversations.state(conversationId));
    if (state.status === "paused") throw new AppError("Das Gespräch ist pausiert. Setze es zuerst fort.", { code: "conversation_paused" });
    const exercise = this.conversations.currentExercise(state);
    if (!exercise) throw new AppError("Dieses Gespräch ist bereits beendet.", { code: "conversation_not_active" });
    const mode = cleanInputMode(inputMode);
    const evaluated = this._evaluate(exercise, answerText, mode, conversationId);
    const planned = await this._conversationStep(() => this.conversations.plan(conversationId, { answerText, evaluation: evaluated }));

    let supplemented = { evaluation: evaluated, ai: { status: "off", added: 0, model: null } };
    let pick = null;
    let guided = "off";
    if (await this.aiEnabled()) {
      const context = assertContextOwner(
        buildConversationContext({ events: await this.engine.history(), learnerId: this.learnerId, conversationId }), this.learnerId);
      const [supp, chosen] = await Promise.all([
        this._supplement(evaluated, exercise, signal, context),
        !planned.end && planned.candidates.length > 1 ? this._chooseNext(state, planned.candidates, signal) : Promise.resolve({ status: "off", pick: null }),
      ]);
      supplemented = supp;
      pick = chosen.pick;
      guided = chosen.status;
    }
    const result = await this._conversationStep(() => this.conversations.respond(conversationId, {
      answerText, evaluation: supplemented.evaluation, inputMode: mode, durationMs: cleanDuration(durationMs),
      choose: pick ? () => pick : null,
    }));
    return {
      ai: { ...supplemented.ai, guidance: guided },
      turn: { rule: result.next?.rule ?? null, source: result.source, end: result.end },
      conversation: await this._conversationView(result.state),
    };
  }

  /** KI-Gesprächshilfe: wählt einen der Vorschläge der Engine; jeder Fehler → Policy entscheidet. */
  async _chooseNext(state, candidates, signal) {
    if (state.learner_id !== this.learnerId) throw new Error("Gespräch gehört nicht zu diesem Lerner");
    const scenario = this.library.conversation(state.scenario_id);
    const request = {
      learner_id: this.learnerId,
      language: this.languageId,
      scenario_title: scenario.title_de,
      goal_de: scenario.goal_de,
      transcript: state.transcript.map((t) => ({ role: t.role, text: t.text, learner_id: state.learner_id })),
      candidates: candidates.map((c, i) => ({ id: `c${i + 1}`, description: RULE_REASONS[c.rule] ?? c.rule, question_es: c.question_es })),
    };
    try {
      const answer = await this.assistant.converse(request, { signal });
      const index = request.candidates.findIndex((c) => c.id === answer?.choice);
      return index < 0 ? { status: "invalid", pick: null } : { status: "ok", pick: candidates[index] };
    } catch (error) {
      const code = error?.code;
      const status = code === "aborted" || signal?.aborted ? "skipped" : code === "timeout" || code === "llm_timeout" ? "timeout"
        : code === "llm_invalid" ? "invalid" : "unavailable";
      return { status, pick: null };
    }
  }

  async _conversationView(state) {
    const scenario = this.library.conversation(state.scenario_id);
    if (!scenario) throw new AppError("Dieses Gespräch gibt es im aktuellen Inhalt nicht mehr.", { code: "unknown_scenario" });
    const finished = state.status === "completed" || state.status === "abandoned";
    let result = null;
    if (finished) {
      const ids = new Set(state.turns.map((t) => t.attempt_id));
      const attempts = new Map((await this.engine.history({ type: "attempt" })).filter((e) => ids.has(e.id)).map((e) => [e.id, e]));
      result = buildConversationResult({ state, attempts, library: this.library });
    }
    return presentConversation({ state, scenario, goal: this.library.conversationGoal(scenario.goal), library: this.library, result });
  }

  async _conversationStep(step) {
    try {
      return await step();
    } catch (error) {
      if (error instanceof ConversationError) {
        const messages = {
          already_active: "Es ist schon ein anderes Gespräch offen. Setze es fort oder beende es zuerst.",
          unknown_conversation: "Dieses Gespräch gibt es nicht (mehr).",
          unknown_scenario: "Dieses Gespräch gibt es im aktuellen Inhalt nicht.",
          not_active: "Dieses Gespräch ist bereits beendet.",
          not_paused: "Dieses Gespräch ist nicht pausiert.",
          paused: "Das Gespräch ist pausiert. Setze es zuerst fort.",
          invalid_budget: "Diese Gesprächsdauer gibt es nicht.",
        };
        throw new AppError(messages[error.code] ?? "Das geht in diesem Gespräch gerade nicht.", { cause: error, code: `conversation_${error.code}` });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- Sprachprofil und Einstufung (P11B)

  /** Sprachprofil dieses Lerners in dieser Sprache (Projektion, mit Sicherheit und Evidenz). */
  async languageProfile() {
    const [profile, history, open] = await Promise.all([
      this.assessments.profile({ asOf: this.clock() }), this.assessments.history(), this.assessments.open(),
    ]);
    return presentLanguageProfile({ profile, history, openAssessment: open, library: this.library });
  }

  async recordSelfAssessment(level) {
    return this._assessmentStep(() => this.assessments.recordSelfAssessment(level));
  }

  /** Seite der Einstufung: laufende Einstufung (mit nächster Aufgabe) oder die Möglichkeit zu starten. */
  async assessmentPage() {
    const open = await this.assessments.open();
    return {
      available_modules: this.assessments.availableModules(),
      assessment: open ? this._assessmentView(open) : null,
      profile: await this.languageProfile(),
    };
  }

  async startAssessment() {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.start()));
  }

  /**
   * Antwort auf die aktuelle Einstufungsaufgabe: bewerten (evaluateAnswer, wie jede Übung), speichern,
   * nächste Aufgabe. Während der Einstufung gibt es keine Rückmeldung zu richtig/falsch.
   */
  async respondAssessment(assessmentId, { itemId, answerText, inputMode = "text", durationMs = null }) {
    const state = await this._assessmentStep(() => this.assessments.state(assessmentId));
    const current = this.assessments.current(state);
    if (!current || current.item.id !== itemId) throw new AppError("Diese Aufgabe ist gerade nicht dran.", { code: "assessment_wrong_item" });
    const evaluation = this._evaluate(current.exercise, answerText, cleanInputMode(inputMode));
    const result = await this._assessmentStep(() => this.assessments.respond(assessmentId, {
      itemId, answerText, evaluation, inputMode, durationMs: cleanDuration(durationMs),
    }));
    return this._assessmentView(result.state);
  }

  async skipAssessmentItem(assessmentId, itemId) {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.skipItem(assessmentId, itemId)));
  }

  async skipAssessmentModule(assessmentId, dimension, reason = "user") {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.skipModule(assessmentId, dimension, reason)));
  }

  async pauseAssessment(assessmentId, reason = "user") {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.pause(assessmentId, reason)));
  }

  async resumeAssessment(assessmentId) {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.resume(assessmentId)));
  }

  async abandonAssessment(assessmentId) {
    return this._assessmentView(await this._assessmentStep(() => this.assessments.abandon(assessmentId)));
  }

  _assessmentView(state) {
    return presentAssessment({ state, current: this.assessments.current(state), library: this.library });
  }

  async _assessmentStep(step) {
    try {
      return await step();
    } catch (error) {
      if (error instanceof AssessmentError) {
        const messages = {
          already_active: "Es läuft schon eine Einstufung. Setze sie fort oder brich sie ab.",
          no_content: "Für diese Sprache gibt es noch keine Einstufungsaufgaben.",
          unknown_assessment: "Diese Einstufung gibt es nicht (mehr).",
          not_active: "Diese Einstufung ist bereits beendet.",
          not_paused: "Diese Einstufung ist nicht pausiert.",
          paused: "Die Einstufung ist pausiert. Setze sie zuerst fort.",
          invalid_level: "Bitte eine Stufe von A1 bis C2 wählen.",
          wrong_item: "Diese Aufgabe ist gerade nicht dran.",
          wrong_module: "Dieser Bereich ist nicht offen.",
        };
        throw new AppError(messages[error.code] ?? "Das geht in der Einstufung gerade nicht.", { cause: error, code: `assessment_${error.code}` });
      }
      throw error;
    }
  }

  /** Ist die KI-Zusatzanalyse für diesen Lerner eingeschaltet und angebunden? */
  async aiEnabled() {
    return Boolean(this.assistant) && (await this.profile()).ai_analysis === true;
  }

  // ---------------------------------------------------------------- Daten

  async dataInfo() {
    const events = await this.engine.history();
    return {
      event_count: events.length,
      first_event_at: events[0]?.created_at ?? null,
      last_event_at: events.at(-1)?.created_at ?? null,
      user_id: this.engine.identity.userId,
      device_id: this.engine.identity.deviceId,
      learner_name: (await this.learner()).display_name,
      content_version: this.library.contentVersion,
      exercise_count: this.library.exercises().length,
      persistent: this.persistent,
    };
  }

  /** Sicherung: alle Ereignisse (die Lernhistorie) als JSON-Objekt. */
  async exportData() {
    return {
      format: "spanisch-ai.backup",
      version: 1,
      exported_at: this.clock().toISOString(),
      user_id: this.engine.identity.userId,
      device_id: this.engine.identity.deviceId,
      learner: await this.learner(),
      languages: (await this.users.get(this.learnerId))?.languages ?? [],
      content_version: this.library.contentVersion,
      profile: await this.profile(),
      // Sicherung des Lerners: alle seine Ereignisse in allen Sprachen (jedes trägt seine Sprache)
      events: await this.storage.listEvents({ userId: this.learnerId }),
    };
  }

  /** Entwicklersicht (?debug=1): interne Planung und abgeleitete Zustände. */
  async debugInfo(minutes = 10) {
    const [plan, brain, info] = await Promise.all([
      this._plan(minutes), this.engine.learnerBrain({ library: this.library, asOf: this.clock() }), this.dataInfo(),
    ]);
    return {
      info,
      plan: {
        objective: plan.objective,
        metadata: { mix: plan.metadata.mix, usable_seconds: plan.metadata.usable_seconds, planned_seconds: plan.metadata.planned_seconds },
        focus_skills: plan.focus_skills.map((f) => ({ skill_id: f.skill_id, purpose: f.purpose, priority: f.priority, factors: f.priority_factors })),
        exercises: plan.exercises.map((e) => ({
          exercise_id: e.exercise_id, skill_id: e.skill_id, purpose: e.purpose, role: e.role, evidence: e.evidence,
          seconds: e.estimated_seconds, reason: e.reason, score: e.score_factors,
        })),
      },
      needs: brain.needs.slice(0, 15).map((n) => ({
        skill_id: n.skill_id, label: n.label, priority: n.priority, reason_code: n.reason_code, purpose: n.purpose,
        error_state: n.error_state, stage: n.competence_stage, target: n.target_difficulty, recommended: n.recommended_exercise.label,
        factors: n.priority_factors, evidence: n.evidence,
      })),
      skills: brain.profile.skills.filter((s) => s.status !== "new").map((s) => ({
        skill_id: s.skill_id, label: s.label, status: s.status, error_state: s.error_state, mastery: s.competence.mastery,
        secure: s.competence.secure_evidence, highest: s.competence.highest_evidence, stats: s.stats,
        repetition: s.repetition, confidence: s.confidence,
      })),
      areas: brain.profile.areas.filter((a) => a.observed > 0),
      journey: await this._journeyText(),
      reviews: brain.reviews.summary,
      memories: brain.memories.map((m) => ({
        id: m.memory_id, status: m.status, importance: m.importance, confidence: m.confidence, text: m.content.text,
        sources: m.source_event_ids.length,
      })),
    };
  }

  // ---------------------------------------------------------------- intern

  /** Verlauf der letzten Lerntage (Stichtag: letzter Versuch des Tages), wie ihn das Learning Brain sieht. */
  async _journeyText(days = 5) {
    const events = await this.engine.history();
    const lastOfDay = new Map();
    for (const e of events) if (e.event_type === "attempt") lastOfDay.set(e.local_date, e.created_at);
    const checkpoints = [...lastOfDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-days)
      .map(([day, lastAt]) => ({ label: day, asOf: new Date(Date.parse(lastAt) + 1) }));
    if (!checkpoints.length) return "Noch keine Lerntage.";
    const trace = traceLearningJourney({ events, userId: this.engine.identity.userId, library: this.library, checkpoints });
    return renderJourneyText(trace, { title: "Verlauf der letzten Lerntage" });
  }

  async _plan(minutes) {
    if (!SESSION_MINUTES.includes(minutes)) throw new AppError(`Bitte ${SESSION_MINUTES.join(", ")} Minuten wählen.`, { code: "invalid_minutes" });
    return this.engine.planSession({ library: this.library, minutes, asOf: this.clock() });
  }

  _exercise(exerciseId) {
    const exercise = this.library.exercise(exerciseId);
    if (!exercise) throw new AppError("Diese Übung ist im aktuellen Inhalt nicht mehr vorhanden.", { code: "unknown_exercise" });
    return exercise;
  }

  _evaluate(exercise, answerText, inputMode = "text", conversationId = null) {
    if (!String(answerText ?? "").trim()) throw new AppError("Bitte gib zuerst eine Antwort ein.", { code: "empty_answer" });
    try {
      return evaluateAnswer({ library: this.library, exercise, answerText, inputMode, conversationId, now: this.clock() });
    } catch (error) {
      if (error instanceof InvalidAnswerError) throw new AppError("Bitte gib eine Antwort ein.", { cause: error, code: "empty_answer" });
      throw error;
    }
  }

  /**
   * Optionale KI-Zusatzhinweise. Nie ein Fehler: aus, nicht erreichbar, zu langsam, abgebrochen oder
   * ungültig → die Regelbewertung bleibt unverändert, ai.status sagt warum.
   * @returns {Promise<{evaluation: object, ai: {status: string, added: number, model: string|null}}>}
   */
  async _supplement(evaluation, exercise, signal, context = null) {
    if (!(await this.aiEnabled())) return { evaluation, ai: { status: "off", added: 0, model: null } };
    const request = supplementalRequest({ learnerId: this.learnerId, exercise, evaluation, context, language: this.languageId });
    let analysis;
    try {
      analysis = await this.assistant.analyze(request, { signal });
    } catch (error) {
      const code = error?.code;
      const status = code === "aborted" || signal?.aborted ? "skipped"
        : code === "timeout" || code === "llm_timeout" ? "timeout"
          : code === "llm_invalid" ? "invalid" : "unavailable";
      return { evaluation, ai: { status, added: 0, model: null } };
    }
    const merged = mergeSupplemental(evaluation, analysis, { references: request.reference_answers });
    return {
      evaluation: merged.evaluation,
      ai: { status: merged.status, added: merged.added, model: merged.status === "ok" ? analysis.model : null },
    };
  }

  async _feedback(evaluation, exercise, answerText, inputMode = "text", listening = null) {
    const memories = await this.memories();
    const recurring = new Set(memories
      .filter((m) => m.memory_type === "recurring_error" && OPEN_MEMORY.has(m.status))
      .map((m) => m.skill_id));
    const language = this.explanationLanguage;
    const feedback = presentFeedback({ evaluation, exercise, library: this.library, recurringSkillIds: recurring, answerText, inputMode, language });
    // P15: Höraufgaben bekommen zusätzlich eine Hör-Rückmeldung (verstanden?) und danach das Transkript
    const heard = await this._listeningFeedback(exercise, evaluation, answerText, listening);
    return { ...feedback, listening: heard && language === "es" ? localizedListeningFeedback(heard) : heard };
  }

  async _sessionStep(step) {
    try {
      return this.sessionView(await step());
    } catch (error) {
      if (error instanceof SessionError) {
        throw new AppError("Das geht in diesem Zustand der Session nicht.", { cause: error, code: "session_transition" });
      }
      throw error;
    }
  }
}

function nearestBudget(minutes) {
  return BUDGET_MINUTES.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best), BUDGET_MINUTES[1]);
}

/** Hör-Kontext aus der Oberfläche prüfen (P15): wie oft gehört, mit welcher Hilfe. */
function cleanListening(listening) {
  if (!listening) return null;
  const playCount = Number.isInteger(listening.playCount) && listening.playCount >= 0 ? listening.playCount : 1;
  const supportLevel = SUPPORT_LEVELS.includes(listening.supportLevel) ? listening.supportLevel : "question";
  return { playCount, supportLevel };
}

function cleanInputMode(mode) {
  if (!INPUT_MODES.includes(mode)) throw new AppError("Unbekannte Eingabeart.", { code: "invalid_input_mode" });
  return mode;
}

function cleanDuration(ms) {
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null;
}
