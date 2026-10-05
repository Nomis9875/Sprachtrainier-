/**
 * Session-Zustand: vollständig aus Ereignissen rekonstruiert.
 *
 * ─── Architekturregel ──────────────────────────────────────────────────────────
 *
 *   Die Runtime speichert keinen Zustand. Die Wahrheit sind die Ereignisse
 *   (session_* und die attempt-Ereignisse mit dieser session_id). Jeder Zustand,
 *   auch nach Neustart der App oder auf einem anderen Gerät, entsteht durch
 *   replaySession(). Dieselben Ereignisse ergeben denselben Zustand.
 *
 * ─── Lebenszyklus ──────────────────────────────────────────────────────────────
 *
 *   planned ──start──▶ active ──pause──▶ paused ──resume──▶ active
 *                         │                 │
 *                         ├──complete──▶ completed   (nur wenn keine Übung mehr offen ist)
 *                         └──abandon───▶ abandoned  ◀──abandon── paused
 *
 *   planned     ein SessionPlan, der noch nicht gestartet wurde (kein Ereignis)
 *   active      läuft; nur jetzt zählen Versuche
 *   paused      unterbrochen; Versuche in dieser Phase werden als Unstimmigkeit gemeldet
 *   completed   alle Übungen erledigt (Endzustand)
 *   abandoned   vorzeitig beendet (Endzustand)
 *
 *   Ungültige Übergänge in den Ereignissen (z. B. von zwei Geräten) werden beim
 *   Replay übersprungen und unter anomalies gemeldet, statt den Zustand zu verfälschen.
 */

import { runFlow } from "./flow.js";

export const SESSION_STATUSES = Object.freeze(["planned", "active", "paused", "completed", "abandoned"]);
export const FINAL_STATUSES = Object.freeze(["completed", "abandoned"]);

/** Erlaubte Übergänge: Ereignistyp → {von: nach}. */
export const SESSION_TRANSITIONS = Object.freeze({
  session_started: Object.freeze({ planned: "active" }),
  session_paused: Object.freeze({ active: "paused" }),
  session_resumed: Object.freeze({ paused: "active" }),
  session_completed: Object.freeze({ active: "completed" }),
  session_abandoned: Object.freeze({ active: "abandoned", paused: "abandoned" }),
});

/**
 * @param {object[]} events   alle Ereignisse (beliebige Reihenfolge, Duplikate erlaubt)
 * @param {string} sessionId
 * @param {{asOf?: Date}} [options]  Stichtag für die aktive Zeit einer laufenden Session
 * @returns {object|null}  null, wenn es kein session_started gibt
 */
export function replaySession(events, sessionId, { asOf } = {}) {
  const own = dedupe(events).filter((e) => e.payload?.session_id === sessionId).sort(compareEvents);
  const started = own.find((e) => e.event_type === "session_started");
  if (!started) return null;

  const { plan, alternatives, content_version: contentVersion } = started.payload;
  let status = "planned";
  const transitions = [];
  const anomalies = [];
  const attempts = [];
  let activeSince = null;
  let activeMs = 0;
  let endedAt = null;
  let endReason = null;

  for (const event of own) {
    if (event.user_id !== started.user_id) {
      anomalies.push({ at: event.created_at, event_id: event.id, problem: "Ereignis eines anderen Nutzers" });
      continue;
    }
    if (event.event_type === "attempt") {
      if (status === "active") attempts.push(event);
      else anomalies.push({ at: event.created_at, event_id: event.id, problem: `Versuch im Zustand '${status}' wird nicht gezählt` });
      continue;
    }
    const next = SESSION_TRANSITIONS[event.event_type]?.[status];
    if (!next) {
      anomalies.push({ at: event.created_at, event_id: event.id, problem: `${event.event_type} ist im Zustand '${status}' nicht erlaubt` });
      continue;
    }
    if (status === "active") activeMs += Date.parse(event.created_at) - Date.parse(activeSince);
    if (next === "active") activeSince = event.created_at;
    if (FINAL_STATUSES.includes(next)) {
      endedAt = event.created_at;
      endReason = event.payload.reason;
    }
    transitions.push({ at: event.created_at, event_type: event.event_type, from: status, to: next, device_id: event.device_id });
    status = next;
  }

  const lastAt = own.at(-1).created_at;
  if (status === "active") {
    const until = asOf ? asOf.toISOString() : lastAt;
    activeMs += Math.max(0, Date.parse(until) - Date.parse(activeSince));
  }

  const flow = runFlow({ plan, alternatives, attempts });
  const current = ["active", "paused"].includes(status) ? flow.queue[0] ?? null : null;
  const secondsDone = flow.completed.reduce((sum, c) => sum + c.estimated_seconds, 0);
  const secondsLeft = flow.queue.reduce((sum, q) => sum + q.estimated_seconds, 0);

  return {
    session_id: sessionId,
    user_id: started.user_id,
    status,
    content_version: contentVersion,
    plan,
    started_at: started.created_at,
    ended_at: endedAt,
    end_reason: endReason,
    active_seconds: Math.round(activeMs / 1000),
    current,
    remaining: flow.queue,
    completed: flow.completed,
    progress: {
      completed: flow.completed.length,
      remaining: flow.queue.length,
      total: flow.completed.length + flow.queue.length,
      ratio: round(flow.completed.length / Math.max(1, flow.completed.length + flow.queue.length)),
      seconds_done: secondsDone,
      seconds_remaining: secondsLeft,
    },
    skills: flow.skills,
    adaptations: flow.adaptations,
    transitions,
    anomalies: [...anomalies, ...flow.anomalies].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
    explanation: explain(plan, flow),
  };
}

/** Zustand eines noch nicht gestarteten Plans (für eine einheitliche Sicht vor dem Start). */
export function plannedSession(plan) {
  return {
    session_id: null,
    user_id: plan.user_id,
    status: "planned",
    plan,
    current: plan.exercises[0] ?? null,
    remaining: plan.exercises,
    completed: [],
    progress: { completed: 0, remaining: plan.exercises.length, total: plan.exercises.length, ratio: 0, seconds_done: 0,
      seconds_remaining: plan.exercises.reduce((sum, e) => sum + e.estimated_seconds, 0) },
  };
}

/** Alle Sessions eines Nutzers mit Status, neueste zuletzt. */
export function listSessions(events, userId) {
  const ids = dedupe(events)
    .filter((e) => e.event_type === "session_started" && e.user_id === userId)
    .sort(compareEvents)
    .map((e) => e.payload.session_id);
  return ids.map((id) => {
    const state = replaySession(events, id);
    return { session_id: id, status: state.status, started_at: state.started_at, ended_at: state.ended_at };
  });
}

/** Warum gibt es diese Session, warum diese Übungen, warum wird ein Skill wiederholt? */
function explain(plan, flow) {
  return {
    why_created: `${plan.objective.title_de ?? plan.objective.id}: ${plan.objective.reason}`,
    why_exercises: plan.exercises.map((e) => ({ exercise_id: e.exercise_id, skill_id: e.skill_id, reason: e.reason })),
    why_focus: plan.focus_skills.map((f) => ({ skill_id: f.skill_id, reason: f.reason })),
    why_changed: flow.adaptations.map((a) => ({ type: a.type, skill_id: a.skill_id, exercise_id: a.exercise_id, reason: a.reason })),
  };
}

function dedupe(events) {
  return [...new Map(events.map((e) => [e.id, e])).values()];
}

function compareEvents(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
