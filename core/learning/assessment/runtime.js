/**
 * Assessment Runtime (P11B): führt eine Einstufung für EINEN Lerner in EINER Sprache, ohne eigenen Zustand.
 *
 *   recordSelfAssessment(level)  ─▶ self_assessment_recorded (Startpunkt, keine Kompetenz)
 *   start({kind})                ─▶ assessment_started
 *   respond(antwort)             ─▶ attempt (+ Beobachtungen, Fehler) + assessment_response   (ein Schreibvorgang)
 *   skipItem() / skipModule()    ─▶ assessment_item_skipped / assessment_module_skipped
 *   pause() / resume() / abandon()
 *   (alle Module fertig)         ─▶ assessment_completed + language_profile_recorded (Profilverlauf)
 *
 * Keine eigene Bewertung: Jede Antwort wird vorher mit evaluateAnswer bewertet (wie jede Übung) und über
 * engine.recordAttempt gespeichert. So fließt die Einstufung in Kompetenz, Gedächtnis und Brain ein, wie
 * jede Übung. Das Profil entsteht danach als Projektion aller Ereignisse (language-profile.js).
 */

import { readEvaluation } from "../../evaluation/result.js";
import { DIMENSIONS, performanceScore } from "../profile/evidence.js";
import { buildLanguageProfile } from "../profile/language-profile.js";
import { CEFR_LEVELS } from "../profile/scale.js";
import { allModulesDone, listAssessments, nextItem, replayAssessment } from "./state.js";

export class AssessmentError extends Error {
  constructor(message, code = "assessment_error") {
    super(message);
    this.name = "AssessmentError";
    this.code = code;
  }
}

export class AssessmentRuntime {
  /** @param {{engine: import("../engine.js").LearningEngine, library: object}} options */
  constructor({ engine, library }) {
    if (library.languageId !== engine.languageId) throw new TypeError("AssessmentRuntime: Inhalt und Engine gehören zu verschiedenen Sprachen");
    this.engine = engine;
    this.library = library;
  }

  async recordSelfAssessment(level) {
    if (!CEFR_LEVELS.includes(level)) throw new AssessmentError("Bitte eine Stufe von A1 bis C2 wählen.", "invalid_level");
    await this.engine.recordAssessmentEvents([{ type: "self_assessment_recorded", payload: { level } }]);
    return level;
  }

  /** Module mit Aufgaben in diesem Inhaltspaket (andere sind Inhaltslücken). */
  availableModules() {
    return DIMENSIONS.filter((d) => this.library.assessmentItems({ dimension: d }).length);
  }

  async start({ kind = null } = {}) {
    const modules = this.availableModules();
    if (!modules.length) throw new AssessmentError("Für diese Sprache gibt es noch keine Einstufungsaufgaben.", "no_content");
    const all = await this.list();
    const open = all.find((a) => a.status === "in_progress" || a.status === "paused");
    if (open) throw new AssessmentError("Es läuft schon eine Einstufung.", "already_active");
    const events = await this.engine.history();
    const self = events.filter((e) => e.event_type === "self_assessment_recorded").sort(byTime).at(-1)?.payload.level ?? null;
    const assessmentId = this.engine.newId();
    await this.engine.recordAssessmentEvents([{
      type: "assessment_started",
      payload: {
        assessment_id: assessmentId,
        kind: kind ?? (all.some((a) => a.status === "completed") ? "reassessment" : "initial"),
        self_assessment: self,
        modules,
        content_version: this.library.contentVersion ?? null,
      },
    }]);
    return this.state(assessmentId);
  }

  async state(assessmentId) {
    const state = replayAssessment(await this.engine.history(), assessmentId, this.library);
    if (!state) throw new AssessmentError("Diese Einstufung gibt es (für diesen Lerner in dieser Sprache) nicht.", "unknown_assessment");
    return state;
  }

  async list() {
    return listAssessments(await this.engine.history(), this.library);
  }

  /** Laufende oder pausierte Einstufung oder null. */
  async open() {
    return (await this.list()).find((a) => a.status === "in_progress" || a.status === "paused") ?? null;
  }

  /** Die nächste Aufgabe (adaptiv) mit ihrer Übung, oder null. */
  current(state) {
    const item = nextItem(state, this.library);
    return item ? { item, exercise: this.library.assessmentExercise(`assessment/${item.id}`) } : null;
  }

  /**
   * Antwort auf die aktuelle Aufgabe speichern.
   * @param {string} assessmentId
   * @param {{itemId: string, answerText: string, evaluation: object, inputMode?: string, durationMs?: number|null}} answer
   */
  async respond(assessmentId, { itemId, answerText, evaluation, inputMode = "text", durationMs = null }) {
    const state = await this._active(assessmentId);
    const current = this.current(state);
    if (!current || current.item.id !== itemId) throw new AssessmentError("Diese Aufgabe ist gerade nicht dran.", "wrong_item");
    const view = readEvaluation(evaluation);
    if (view.exercise_id !== current.exercise.id) throw new AssessmentError("Die Bewertung gehört zu einer anderen Aufgabe.", "wrong_item");
    const score = current.item.format === "choice" ? (view.overall.outcome === "correct" ? 1 : 0) : round(performanceScore(current.exercise, view));
    await this.engine.recordAttempt({
      exercise: current.exercise,
      contentVersion: this.library.contentVersion,
      answerText,
      evaluation,
      inputMode,
      durationMs,
      followUp: (attempt) => [{
        type: "assessment_response",
        payload: { assessment_id: assessmentId, dimension: current.item.dimension, item_id: itemId, attempt_id: attempt.id, score },
      }],
    });
    return { score, state: await this._completeIfDone(assessmentId) };
  }

  /** "Weiß ich nicht": zählt als falsch (ohne Rateanteil), keine Antwort wird erfunden. */
  async skipItem(assessmentId, itemId) {
    const state = await this._active(assessmentId);
    const current = this.current(state);
    if (!current || current.item.id !== itemId) throw new AssessmentError("Diese Aufgabe ist gerade nicht dran.", "wrong_item");
    await this.engine.recordAssessmentEvents([{
      type: "assessment_item_skipped",
      payload: { assessment_id: assessmentId, dimension: current.item.dimension, item_id: itemId, reason: "dont_know" },
    }]);
    return this._completeIfDone(assessmentId);
  }

  /** Ganzes Modul auslassen (z. B. kein Mikrofon). Der Bereich bleibt dann ungemessen. */
  async skipModule(assessmentId, dimension, reason = "user") {
    const state = await this._active(assessmentId);
    const module = state.modules.find((m) => m.dimension === dimension);
    if (!module || !["pending", "in_progress"].includes(module.status)) throw new AssessmentError("Dieser Bereich ist nicht offen.", "wrong_module");
    await this.engine.recordAssessmentEvents([{ type: "assessment_module_skipped", payload: { assessment_id: assessmentId, dimension, reason } }]);
    return this._completeIfDone(assessmentId);
  }

  async pause(assessmentId, reason = "user") {
    const state = await this.state(assessmentId);
    if (state.status !== "in_progress") throw new AssessmentError(`Einstufung ist ${state.status}`, "not_active");
    await this.engine.recordAssessmentEvents([{ type: "assessment_paused", payload: { assessment_id: assessmentId, reason } }]);
    return this.state(assessmentId);
  }

  async resume(assessmentId) {
    const state = await this.state(assessmentId);
    if (state.status !== "paused") throw new AssessmentError(`Einstufung ist ${state.status}`, "not_paused");
    await this.engine.recordAssessmentEvents([{ type: "assessment_resumed", payload: { assessment_id: assessmentId } }]);
    return this.state(assessmentId);
  }

  async abandon(assessmentId, reason = "user") {
    const state = await this.state(assessmentId);
    if (state.status !== "in_progress" && state.status !== "paused") throw new AssessmentError(`Einstufung ist ${state.status}`, "not_active");
    await this.engine.recordAssessmentEvents([{ type: "assessment_abandoned", payload: { assessment_id: assessmentId, reason } }]);
    return this.state(assessmentId);
  }

  /** Aktuelles Sprachprofil (Projektion aller Ereignisse dieses Lerners in dieser Sprache). */
  async profile({ asOf = this.engine.now() } = {}) {
    const [events, competence] = await Promise.all([
      this.engine.history(), this.engine.competenceSnapshot({ library: this.library, asOf }),
    ]);
    return buildLanguageProfile({ events, library: this.library, learnerId: this.engine.learnerId,
      languageId: this.engine.languageId, asOf, competence });
  }

  /** Profilverlauf: gespeicherte Momentaufnahmen (nach jeder Einstufung), älteste zuerst. */
  async history() {
    return (await this.engine.history({ type: "language_profile_recorded" })).sort(byTime).map((e) => ({
      at: e.created_at, source: e.payload.source, assessment_id: e.payload.assessment_id, model: e.payload.model,
      overall: e.payload.overall, dimensions: e.payload.dimensions,
    }));
  }

  async _active(assessmentId) {
    const state = await this.state(assessmentId);
    if (state.status === "paused") throw new AssessmentError("Die Einstufung ist pausiert.", "paused");
    if (state.status !== "in_progress") throw new AssessmentError(`Einstufung ist ${state.status}`, "not_active");
    return state;
  }

  /** Alle Module fertig → abschließen und den Profilstand für den Verlauf festhalten. */
  async _completeIfDone(assessmentId) {
    const state = await this.state(assessmentId);
    if (state.status !== "in_progress" || !allModulesDone(state)) return state;
    await this.engine.recordAssessmentEvents([{ type: "assessment_completed", payload: { assessment_id: assessmentId, reason: "all_modules_done" } }]);
    const profile = await this.profile();
    await this.engine.recordAssessmentEvents([{
      type: "language_profile_recorded",
      payload: {
        source: state.kind === "reassessment" ? "reassessment" : "assessment",
        assessment_id: assessmentId,
        model: profile.model,
        overall: pick(profile.overall),
        dimensions: Object.fromEntries(Object.entries(profile.dimensions).map(([d, x]) => [d, pick(x)])),
      },
    }]);
    return this.state(assessmentId);
  }
}

function pick(x) {
  return { status: x.status, level_label: x.level_label ?? null, theta: x.theta ?? null, confidence: x.confidence,
    measurements: x.measurements ?? null };
}

function byTime(a, b) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
