/**
 * Conversation Runtime: führt ein Gespräch über mehrere Runden, ohne eigenen Zustand.
 *
 *   start(szenario, {minutes})  ─▶ conversation_started (Eröffnungsfrage der Engine)
 *   respond(antwort)            ─▶ attempt (+ skill_observation, error_event) + conversation_turn
 *                                   [+ conversation_completed]            (EIN Schreibvorgang)
 *   pause() / resume()          ─▶ conversation_paused / conversation_resumed
 *   abandon()                   ─▶ conversation_abandoned
 *   state()                     ─▶ replayConversation (ConversationState v2)
 *
 * Aufgabenteilung:
 * - Bewertung: evaluateAnswer (vorher, wie jede Übung), gespeichert über engine.recordAttempt. Kompetenz,
 *   Gedächtnis und Brain sehen einen gewöhnlichen Versuch mit conversation_id ("spontaneous").
 * - Gesprächsführung: Conversation Engine (core/conversation: Analyse, Policy). Sie entscheidet nur, was
 *   als Nächstes gesagt wird, und schreibt keine Lernzustände.
 * - Optional darf ein Helfer (lokale KI) unter den Kandidaten der Policy wählen; alles andere wird verworfen.
 *
 * Lerner-Trennung: Die Engine liest nur die Ereignisse IHRES Lerners; fremde Gespräche sind unbekannt.
 */

import { analyzeAnswer, evaluationSignal } from "../../conversation/analysis.js";
import { BUDGET_MINUTES, decideNext, openingDecision } from "../../conversation/policy.js";
import { readEvaluation } from "../../evaluation/result.js";
import { EVENT_TYPES } from "../events.js";
import { listConversations, replayConversation } from "./state.js";

export const RULE_REASONS = Object.freeze({
  opening: "Eröffnung",
  wrap_up: "Zeit fast um: Gespräch abrunden",
  short_answer: "knappe Antwort: konkreter nachfragen",
  unsure: "Unsicherheit: konkreter nachfragen",
  simplify: "weiter mit einer konkreteren Frage",
  off_topic: "zurück zum Thema",
  disagreement: "Widerspruch: Gegenargument",
  pros_and_cons: "Vor- und Nachteile genannt: Position verlangen",
  argument: "Argument vertiefen",
  introduce_missing: "fehlenden Aspekt einbringen",
  next_step: "nächster Schritt des Gesprächsziels",
  explore: "weiteren Aspekt einbringen",
  conclude: "Ziel erreicht: Abschlussfrage",
});

export class ConversationError extends Error {
  constructor(message, code = "conversation_error") {
    super(message);
    this.name = "ConversationError";
    this.code = code;
  }
}

export class ConversationRuntime {
  /** @param {{engine: import("../engine.js").LearningEngine, library: import("../../content/library.js").ContentLibrary}} options */
  constructor({ engine, library }) {
    this.engine = engine;
    this.library = library;
  }

  /** Startet ein Gespräch. Pro Lerner ist höchstens eines offen (laufend oder pausiert). */
  async start(scenarioId, { minutes = 10 } = {}) {
    const scenario = this.library.conversation(scenarioId);
    if (!scenario || scenario.status === "retired") throw new ConversationError(`Unbekanntes Gespräch: ${scenarioId}`, "unknown_scenario");
    if (!BUDGET_MINUTES.includes(minutes)) throw new ConversationError(`Gesprächsdauer: erlaubt sind ${BUDGET_MINUTES.join(", ")} Minuten`, "invalid_budget");
    const open = await this.open();
    if (open) throw new ConversationError(`Es ist schon ein Gespräch offen (${open.scenario_id})`, "already_active");
    const conversationId = this.engine.newId();
    await this.engine.recordConversationEvents([{
      type: EVENT_TYPES.CONVERSATION_STARTED,
      payload: {
        conversation_id: conversationId,
        scenario_id: scenario.id,
        scenario_revision: scenario.revision,
        content_version: this.library.contentVersion ?? null,
        goal: scenario.goal,
        budget_minutes: minutes,
        opening: openingDecision({ library: this.library, scenario }),
      },
    }]);
    return this.state(conversationId);
  }

  async state(conversationId) {
    const state = replayConversation(await this.engine.history(), conversationId, { asOf: this.engine.now() });
    if (!state) throw new ConversationError("Dieses Gespräch gibt es (für diesen Lerner) nicht.", "unknown_conversation");
    return state;
  }

  async list() {
    return listConversations(await this.engine.history(), this.engine.learnerId, { asOf: this.engine.now() });
  }

  /** Das offene (laufende oder pausierte) Gespräch des Lerners oder null. */
  async open() {
    return (await this.list()).find((c) => c.status === "active" || c.status === "paused") ?? null;
  }

  /** Übung, mit der die Antwort auf die offene Frage bewertet wird. */
  currentExercise(state) {
    if (state.status !== "active" || !state.current) return null;
    return this.library.turnExercise(state.current.exercise_id) ?? null;
  }

  /**
   * Was würde die Engine nach dieser Antwort tun? (rein, speichert nichts; für den optionalen KI-Helfer)
   * @returns {Promise<{state: object, analysis: object, signal: object, end: string|null, candidates: object[], decision: object|null}>}
   */
  async plan(conversationId, { answerText, evaluation }) {
    const state = await this.state(conversationId);
    this._check(state, evaluation, conversationId);
    const scenario = this.library.conversation(state.scenario_id);
    const analysis = analyzeAnswer({ library: this.library, scenario, text: answerText });
    const signal = evaluationSignal(evaluation);
    const result = decideNext({
      library: this.library, scenario, dialogue: state.dialogue, answered: state.current, analysis, signal,
      elapsedSeconds: state.active_seconds, budgetMinutes: state.budget_minutes, turnIndex: state.turns.length + 1,
    });
    return { state, analysis, signal, ...result };
  }

  /**
   * Speichert die Antwort auf die offene Frage und die nächste Frage der Engine.
   * @param {string} conversationId
   * @param {{answerText: string, evaluation: object, inputMode?: string, durationMs?: number|null,
   *   choose?: (candidates: object[]) => Promise<object|null>|object|null}} answer
   *   choose: optionaler Helfer (lokale KI); nur ein unveränderter Kandidat der Policy wird übernommen
   */
  async respond(conversationId, { answerText, evaluation, inputMode = "text", durationMs = null, choose = null }) {
    const planned = await this.plan(conversationId, { answerText, evaluation });
    const { state, analysis, end, candidates } = planned;
    let next = planned.decision;
    let source = "policy";
    if (!end && choose && candidates.length > 1) {
      let picked = null;
      try {
        picked = await choose(candidates);
      } catch {
        picked = null; // Helfer ausgefallen: die Policy entscheidet
      }
      const valid = candidates.find((c) => picked && sameDecision(c, picked));
      if (valid) {
        next = valid;
        source = "assistant";
      }
    }
    const exercise = this.currentExercise(state);
    const { attempt } = await this.engine.recordAttempt({
      exercise,
      contentVersion: this.library.contentVersion,
      answerText,
      evaluation,
      inputMode,
      durationMs,
      conversationId,
      followUp: (saved) => [
        {
          type: EVENT_TYPES.CONVERSATION_TURN,
          payload: {
            conversation_id: conversationId,
            turn_index: state.turns.length,
            exercise_id: exercise.id,
            attempt_id: saved.id,
            analysis,
            next: end ? null : next,
            source,
            reason: end ? `Gespräch beendet (${end})` : RULE_REASONS[next.rule] ?? next.rule,
          },
        },
        ...(end ? [{ type: EVENT_TYPES.CONVERSATION_COMPLETED, payload: { conversation_id: conversationId, reason: end } }] : []),
      ],
    });
    return { attempt, analysis, end, next: end ? null : next, source, state: await this.state(conversationId) };
  }

  async pause(conversationId, reason = "user") {
    const state = await this.state(conversationId);
    if (state.status !== "active") throw new ConversationError(`Gespräch ist ${state.status}`, "not_active");
    await this.engine.recordConversationEvents([{ type: EVENT_TYPES.CONVERSATION_PAUSED, payload: { conversation_id: conversationId, reason } }]);
    return this.state(conversationId);
  }

  async resume(conversationId) {
    const state = await this.state(conversationId);
    if (state.status !== "paused") throw new ConversationError(`Gespräch ist ${state.status}`, "not_paused");
    await this.engine.recordConversationEvents([{ type: EVENT_TYPES.CONVERSATION_RESUMED, payload: { conversation_id: conversationId } }]);
    return this.state(conversationId);
  }

  async abandon(conversationId, reason = "user") {
    const state = await this.state(conversationId);
    if (state.status !== "active" && state.status !== "paused") throw new ConversationError(`Gespräch ist ${state.status}`, "not_active");
    await this.engine.recordConversationEvents([{ type: EVENT_TYPES.CONVERSATION_ABANDONED, payload: { conversation_id: conversationId, reason } }]);
    return this.state(conversationId);
  }

  _check(state, evaluation, conversationId) {
    if (state.status === "paused") throw new ConversationError("Das Gespräch ist pausiert.", "paused");
    if (state.status !== "active" || !state.current) throw new ConversationError(`Gespräch ist ${state.status}`, "not_active");
    const exercise = this.currentExercise(state);
    if (!exercise) throw new ConversationError(`Schritt '${state.current.exercise_id}' ist im Inhaltspaket nicht mehr vorhanden`, "unknown_turn");
    const view = readEvaluation(evaluation);
    if (view.exercise_id !== exercise.id) {
      throw new ConversationError(`Die Bewertung gehört zu '${view.exercise_id}', offen ist '${exercise.id}'`, "wrong_turn");
    }
    if (view.conversation_id !== conversationId) throw new ConversationError("Die Bewertung gehört zu einem anderen Gespräch", "wrong_turn");
  }
}

function sameDecision(a, b) {
  return ["rule", "move_id", "aspect_id", "question_es", "reaction_es", "variant"].every((key) => a[key] === b[key]);
}
