/**
 * Session Runtime: führt einen SessionPlan aus.
 *
 *   SessionPlan ─start()─▶ session_started
 *               ─submit()─▶ attempt (+ skill_observation, error_event) ─▶ nächste Übung
 *               ─pause()/resume()─▶ session_paused / session_resumed
 *               ─(letzte Übung) / abandon()─▶ session_completed / session_abandoned
 *               ─summary()─▶ SessionSummary v1   (Competence Update: vorher/nachher)
 *
 * Die Runtime hält keinen Zustand: Jede Methode liest die Ereignisse, rekonstruiert die
 * Session (replaySession), prüft den gewünschten Übergang und hängt ein neues Ereignis an.
 * Ein Neustart der App oder ein anderes Gerät sieht deshalb denselben Stand.
 */

import { isListening } from "../listening/model.js";
import { readEvaluation } from "../../evaluation/result.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { EVENT_TYPES } from "../events.js";
import { buildSessionSummary } from "./summary.js";
import { FINAL_STATUSES, SESSION_TRANSITIONS, listSessions, replaySession } from "./state.js";

export class SessionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionError";
  }
}

export class SessionRuntime {
  /**
   * @param {{engine: import("../engine.js").LearningEngine, library: import("../../content/library.js").ContentLibrary}} options
   */
  constructor({ engine, library }) {
    this.engine = engine;
    this.library = library;
  }

  /** Startet einen Plan. Es darf keine andere Session laufen oder pausiert sein. */
  async start(plan) {
    if (plan?.format !== "session_plan" || ![1, 2].includes(plan.version)) throw new SessionError("SessionPlan v1 oder v2 erwartet");
    if (!plan.exercises.length) throw new SessionError("Der Plan enthält keine Übungen");
    const open = await this.openSession();
    if (open) throw new SessionError(`Session ${open.session_id} ist noch '${open.status}': erst beenden oder abbrechen`);

    const sessionId = this.engine.newId();
    await this.engine.recordSessionEvent(EVENT_TYPES.SESSION_STARTED, {
      session_id: sessionId,
      content_version: this.library.contentVersion ?? null,
      plan: compactPlan(plan),
      alternatives: this._alternatives(plan),
    });
    return this.state(sessionId);
  }

  /** Aktueller Zustand, jedes Mal aus den Ereignissen rekonstruiert. */
  async state(sessionId, { asOf } = {}) {
    const state = replaySession(await this.engine.history(), sessionId, { asOf });
    if (!state) throw new SessionError(`Keine Session ${sessionId}`);
    return state;
  }

  /** Die laufende oder pausierte Session (z. B. nach einem Neustart der App), sonst null. */
  async openSession() {
    const events = await this.engine.history();
    const open = listSessions(events, this.engine.identity.userId).filter((s) => !FINAL_STATUSES.includes(s.status));
    return open.length ? replaySession(events, open.at(-1).session_id) : null;
  }

  /**
   * Gibt die Antwort zur aktuellen Übung ab. Nach der letzten Übung wird die Session
   * automatisch abgeschlossen.
   * @param {string} sessionId
   * @param {{answerText: string, evaluation: object, inputMode?: string, durationMs?: number|null}} answer
   */
  async submit(sessionId, { answerText, evaluation, inputMode = "text", durationMs = null, listening = null }) {
    const before = await this.state(sessionId);
    if (before.status !== "active") throw new SessionError(`Antworten nur in einer aktiven Session (Zustand '${before.status}')`);
    const current = before.current;
    if (!current) throw new SessionError("Keine offene Übung");
    const evaluated = readEvaluation(evaluation).exercise_id;
    if (evaluated !== current.exercise_id) {
      throw new SessionError(`Die Bewertung gehört zu '${evaluated}', aktuell ist '${current.exercise_id}'`);
    }
    const exercise = this.library.exercise(current.exercise_id);
    if (!exercise) throw new SessionError(`Übung ${current.exercise_id} ist im Inhaltspaket nicht mehr vorhanden`);

    const { attempt } = await this.engine.recordAttempt({
      exercise,
      contentVersion: this.library.contentVersion,
      answerText,
      evaluation,
      inputMode,
      durationMs,
      sessionId,
      listening,
    });
    let state = await this.state(sessionId);
    if (state.status === "active" && state.remaining.length === 0) {
      await this._transition(sessionId, EVENT_TYPES.SESSION_COMPLETED, { reason: "all_exercises_done" });
      state = await this.state(sessionId);
    }
    const done = state.completed.find((c) => c.attempt_id === attempt.id);
    return { outcome: done.outcome, state };
  }

  pause(sessionId, reason = null) {
    return this._transition(sessionId, EVENT_TYPES.SESSION_PAUSED, { reason });
  }

  resume(sessionId) {
    return this._transition(sessionId, EVENT_TYPES.SESSION_RESUMED, {});
  }

  /** Abschließen geht nur, wenn keine Übung mehr offen ist; sonst abandon(). */
  async complete(sessionId) {
    const state = await this.state(sessionId);
    if (state.remaining.length) throw new SessionError(`Noch ${state.remaining.length} Übung(en) offen: abandon() verwenden`);
    return this._transition(sessionId, EVENT_TYPES.SESSION_COMPLETED, { reason: "all_exercises_done" });
  }

  abandon(sessionId, reason = "user") {
    return this._transition(sessionId, EVENT_TYPES.SESSION_ABANDONED, { reason });
  }

  async summary(sessionId, { asOf } = {}) {
    return buildSessionSummary({ events: await this.engine.history(), sessionId, asOf });
  }

  async _transition(sessionId, type, payload) {
    const state = await this.state(sessionId);
    if (!SESSION_TRANSITIONS[type][state.status]) {
      throw new SessionError(`${type} ist im Zustand '${state.status}' nicht erlaubt`);
    }
    await this.engine.recordSessionEvent(type, { session_id: sessionId, ...payload });
    return this.state(sessionId);
  }

  /**
   * Ersatzübungen je Fokus-Skill (für adaptive Wiederholung und Steigerung). P15: im selben Kanal wie der Bedarf:
   * ein schriftlicher Fehler wird nie mit einer Höraufgabe wiederholt, ein Hörbedarf nur mit Höraufgaben.
   * P16: Steht ein Skill schriftlich UND beim Hören im Fokus, enthält seine Liste beide Kanäle (ein Schlüssel je
   * Skill im Ereignis); den Kanal wählt der Ablauf nach der gescheiterten Übung (flow.js).
   */
  _alternatives(plan) {
    const planned = new Set(plan.exercises.map((e) => e.exercise_id));
    const channels = new Map();
    for (const f of plan.focus_skills) {
      const set = channels.get(f.skill_id) ?? new Set();
      set.add(f.channel === "listening");
      channels.set(f.skill_id, set);
    }
    return Object.fromEntries([...channels].map(([skillId, listening]) => [
      skillId,
      this.library.exercisesForSkill(skillId)
        .filter((e) => !planned.has(e.id) && listening.has(isListening(e)))
        .map((e) => ({ exercise_id: e.id, type: e.type, evidence: evidenceForExercise(e), estimated_seconds: e.estimated_seconds }))
        .sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1)),
    ]));
  }
}

/** Das, was vom Plan für die Durchführung und Erklärung nötig ist. */
export function compactPlan(plan) {
  return {
    format: plan.format,
    version: plan.version,
    generated_at: plan.generated_at,
    minutes: plan.minutes,
    objective: { ...plan.objective },
    focus_skills: plan.focus_skills.map((f) => ({
      skill_id: f.skill_id, need: f.need, priority: f.priority, target_evidence: f.target_evidence, reason: f.reason,
    })),
    exercises: plan.exercises.map((e) => ({
      exercise_id: e.exercise_id, skill_id: e.skill_id, type: e.type, evidence: e.evidence,
      estimated_seconds: e.estimated_seconds, reason: e.reason, purpose: e.purpose ?? null,
      // P22: für "Warum übe ich das?" (Kategorie der Zusammensetzung, Lernzone)
      composition: e.composition ?? null, zone_class: e.zone_class ?? null,
    })),
  };
}
