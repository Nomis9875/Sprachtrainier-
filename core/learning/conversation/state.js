/**
 * Gesprächszustand (ConversationState v2): vollständig aus Ereignissen rekonstruiert, wie Sessions.
 *
 *   conversation_started ─▶ active ─conversation_paused─▶ paused ─conversation_resumed─▶ active
 *                             │  ─conversation_turn─▶ active (nächste Frage; next = null: keine offene Frage)
 *                             ├─conversation_completed─▶ completed   (nur ohne offene Frage)
 *                             └─conversation_abandoned─▶ abandoned   (auch aus paused)
 *
 * Die Antworten sind attempt-Ereignisse (dieselbe Bewertung wie jede Übung) mit dieser conversation_id;
 * conversation_turn verweist mit attempt_id darauf und speichert die Analyse der Antwort und die
 * Entscheidung der Conversation Engine. So bleibt der Verlauf beim Replay gleich, auch wenn sich
 * Inhalte oder Regeln ändern. Ereignisse eines anderen Lerners, Runden außer der Reihe und alles nach
 * dem Ende werden übersprungen und unter anomalies gemeldet.
 *
 * Zeit: active_seconds zählt nur Zeit im Zustand active; eine Lücke zählt höchstens IDLE_CAP_SECONDS
 * (wer das Gespräch offen liegen lässt, verbraucht nicht sein Zeitbudget).
 */

import { emptyDialogue, withAnswer, withQuestion } from "../../conversation/dialogue.js";
import { EVENT_TYPES } from "../events.js";

export const CONVERSATION_STATE_VERSION = 2;
export const CONVERSATION_STATUSES = Object.freeze(["active", "paused", "completed", "abandoned"]);
export const IDLE_CAP_SECONDS = 300;

const T = EVENT_TYPES;
const FINAL = new Set(["completed", "abandoned"]);

/**
 * @param {object[]} events
 * @param {string} conversationId
 * @param {{asOf?: Date}} [options]  asOf: Stichtag für die aktive Zeit eines laufenden Gesprächs
 * @returns {object|null}
 */
export function replayConversation(events, conversationId, { asOf } = {}) {
  const all = dedupe(events).sort(compareEvents);
  const own = all.filter((e) => e.payload?.conversation_id === conversationId && e.event_type !== T.ATTEMPT);
  const started = own.find((e) => e.event_type === T.CONVERSATION_STARTED);
  if (!started) return null;
  const learnerId = started.user_id;
  const attempts = new Map(all
    .filter((e) => e.event_type === T.ATTEMPT && e.user_id === learnerId && e.payload.conversation_id === conversationId)
    .map((e) => [e.id, e]));
  const p0 = started.payload;

  let status = "active";
  let current = p0.opening;
  let dialogue = withQuestion(emptyDialogue(), p0.opening);
  let activeMs = 0;
  let lastAt = started.created_at;
  let endReason = null;
  let endedAt = null;
  const turns = [];
  const transcript = [partnerEntry(p0.opening, started.created_at)];
  const anomalies = [];
  const skip = (event, problem) => anomalies.push({ at: event.created_at, event_id: event.id, problem });
  const tick = (at) => {
    if (status === "active") activeMs += Math.min(Date.parse(at) - Date.parse(lastAt), IDLE_CAP_SECONDS * 1000);
    lastAt = at;
  };

  for (const event of own) {
    if (event === started) continue;
    if (event.user_id !== learnerId) {
      skip(event, "Ereignis eines anderen Lerners");
      continue;
    }
    if (FINAL.has(status)) {
      skip(event, `${event.event_type} nach dem Ende ('${status}')`);
      continue;
    }
    const p = event.payload;
    switch (event.event_type) {
      case T.CONVERSATION_TURN: {
        if (status !== "active" || !current || p.turn_index !== turns.length || p.exercise_id !== current.exercise_id) {
          skip(event, `Runde ${p.turn_index} passt nicht zum Zustand (offen: ${current?.exercise_id ?? "keine"}, Zustand ${status})`);
          continue;
        }
        tick(event.created_at);
        const attempt = attempts.get(p.attempt_id);
        if (!attempt) skip(event, `Antwort ${p.attempt_id} fehlt`);
        turns.push({
          index: p.turn_index, asked: current, attempt_id: p.attempt_id,
          answer_text: attempt?.payload.answer_text ?? null, input_mode: attempt?.payload.input_mode ?? null,
          analysis: p.analysis, next: p.next, source: p.source, reason: p.reason, at: event.created_at,
        });
        transcript.push({ role: "learner", text: attempt?.payload.answer_text ?? "", input_mode: attempt?.payload.input_mode ?? null,
          attempt_id: p.attempt_id, at: event.created_at });
        dialogue = withAnswer(dialogue, current, p.analysis);
        current = p.next;
        if (current) {
          dialogue = withQuestion(dialogue, current);
          transcript.push(partnerEntry(current, event.created_at));
        }
        break;
      }
      case T.CONVERSATION_PAUSED:
        if (status !== "active") { skip(event, `Pause im Zustand '${status}'`); continue; }
        tick(event.created_at);
        status = "paused";
        break;
      case T.CONVERSATION_RESUMED:
        if (status !== "paused") { skip(event, `Fortsetzen im Zustand '${status}'`); continue; }
        lastAt = event.created_at;
        status = "active";
        break;
      case T.CONVERSATION_COMPLETED:
        if (status !== "active" || current) { skip(event, "Abschluss, obwohl eine Frage offen ist"); continue; }
        tick(event.created_at);
        status = "completed";
        endReason = p.reason;
        endedAt = event.created_at;
        break;
      case T.CONVERSATION_ABANDONED:
        tick(event.created_at);
        status = "abandoned";
        endReason = p.reason;
        endedAt = event.created_at;
        break;
      default:
        skip(event, `unerwartetes Ereignis ${event.event_type}`);
    }
  }
  if (asOf && status === "active") tick(asOf.toISOString());
  const last = own.filter((e) => e.user_id === learnerId).at(-1);

  return {
    version: CONVERSATION_STATE_VERSION,
    conversation_id: conversationId,
    learner_id: learnerId,
    scenario_id: p0.scenario_id,
    scenario_revision: p0.scenario_revision,
    content_version: p0.content_version,
    goal: p0.goal,
    budget_minutes: p0.budget_minutes,
    status,
    current: FINAL.has(status) ? null : current,
    turns,
    transcript,
    dialogue,
    active_seconds: Math.round(activeMs / 1000),
    remaining_seconds: Math.max(0, p0.budget_minutes * 60 - Math.round(activeMs / 1000)),
    created_at: started.created_at,
    updated_at: last.created_at,
    ended_at: endedAt,
    end_reason: endReason,
    anomalies,
  };
}

/** Alle Gespräche eines Lerners, ältestes zuerst. */
export function listConversations(events, learnerId, options = {}) {
  return dedupe(events)
    .filter((e) => e.event_type === T.CONVERSATION_STARTED && e.user_id === learnerId)
    .sort(compareEvents)
    .map((e) => replayConversation(events, e.payload.conversation_id, options));
}

function partnerEntry(decision, at) {
  return { role: "partner", text: [decision.reaction_es, decision.question_es].filter(Boolean).join(" "),
    reaction_es: decision.reaction_es, question_es: decision.question_es, rule: decision.rule, at };
}

function dedupe(events) {
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

function compareEvents(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
