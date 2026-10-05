/**
 * Wie ein Gespräch dem Lerner gezeigt wird (DOM-frei, testbar).
 *
 * Quellen: Szenario und Gesprächsziel (Inhalt), ConversationState (Ereignisse), am Ende das
 * ConversationResult (Lernanalyse aus den vorhandenen Bewertungen). Während des Gesprächs gibt es
 * bewusst keine Fehlerliste: nur die Reaktion und die nächste Frage des Gesprächspartners.
 * Wie bei Challenges verrät nichts die verdeckten Lernziele.
 */

import { presentExercise } from "./exercise.js";
import { findingKindLabel } from "./labels.js";
import { t } from "./i18n.js";

// Zustandsmaschine einer Runde (Kern), für die Oberfläche hier bereitgestellt
export { canSubmit, initialPhase, transition } from "../../core/conversation/phases.js";

export const GOAL_LABELS = Object.freeze({
  opinion: "Meinung", discussion: "Diskussion", problem_solving: "Problemlösung",
  everyday: "Alltag", professional: "Beruf", spontaneous: "Spontan",
});
const COMPLETION_TEXT = Object.freeze({
  goal_reached: "Gesprächsziel erreicht",
  time_budget: "Zeit abgelaufen, Gespräch abgerundet",
  max_turns: "alle Runden geführt",
});

/** Karte in der Übersicht. */
export function scenarioCard(scenario, goal, conversations) {
  const own = conversations.filter((c) => c.scenario_id === scenario.id);
  const open = own.find((c) => c.status === "active" || c.status === "paused") ?? null;
  return {
    id: scenario.id,
    title: scenario.title_de,
    level: scenario.level,
    goal: scenario.goal,
    goal_label: GOAL_LABELS[scenario.goal] ? t(`conv.goal_${scenario.goal}`) : scenario.goal,
    goal_name: goal?.name_de ?? scenario.goal,
    goal_de: scenario.goal_de,
    situation_de: scenario.situation_de,
    partner_role_de: scenario.partner_role_de,
    open_conversation_id: open?.conversation_id ?? null,
    open_status: open?.status ?? null,
    completed_count: own.filter((c) => c.status === "completed").length,
  };
}

/**
 * @param {{state: object, scenario: object, goal: object, library: object, result?: object|null}} input
 */
export function presentConversation({ state, scenario, goal, library, result = null }) {
  const current = state.current;
  const exercise = current ? library.turnExercise(current.exercise_id) : null;
  const used = state.active_seconds;
  const budget = state.budget_minutes * 60;
  return {
    conversation_id: state.conversation_id,
    scenario_id: scenario.id,
    title: scenario.title_de,
    goal_name: goal?.name_de ?? scenario.goal,
    goal_de: scenario.goal_de,
    situation_de: scenario.situation_de,
    partner_role_de: scenario.partner_role_de,
    status: state.status,
    paused: state.status === "paused",
    finished: state.status === "completed" || state.status === "abandoned",
    transcript: state.transcript.map((entry) => ({
      role: entry.role, text: entry.text, reaction_es: entry.reaction_es ?? "", question_es: entry.question_es ?? "",
      input_mode: entry.input_mode ?? null,
    })),
    current: current && exercise ? {
      reaction_es: current.reaction_es,
      question_es: current.question_es,
      exercise: presentExercise(exercise),
    } : null,
    progress: {
      turn: state.turns.length + (current ? 1 : 0),
      answered: state.turns.length,
      budget_minutes: state.budget_minutes,
      used_seconds: used,
      remaining_minutes: Math.max(0, Math.ceil((budget - used) / 60)),
      ratio: Math.min(1, Math.round((used / budget) * 100) / 100),
    },
    result: result ? presentResult(result) : null,
  };
}

/** Lernanalyse nach dem Gespräch: kurz, verständlich, nur belegte Befunde. */
export function presentResult(result) {
  const summary = result.evaluation_summary;
  return {
    completion: result.status === "abandoned" ? t("conv.done_abandoned") : COMPLETION_TEXT[result.completion_reason] ? t(`conv.done_${result.completion_reason}`) : "",
    minutes: Math.max(1, Math.round(result.duration_seconds / 60)),
    turns: result.turn_count,
    spoken: summary.spoken,
    error_free: summary.error_free,
    went_well: [
      ...result.communication.covered.map((m) => `Du hast ${m.name_de}.`),
      ...result.learning_observations.demonstrated.map((d) => t("conv.well_done", d.label)),
    ].slice(0, 5),
    work_on: result.learning_observations.to_work_on.map((e) => ({
      label: e.label ?? findingKindLabel(e.kind), count: e.count, example: e.example,
    })),
    natural_sentence: result.natural_sentence,
    supplemental_hints: result.learning_observations.supplemental_hints,
  };
}
