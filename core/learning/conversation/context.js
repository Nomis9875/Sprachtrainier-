/**
 * Gesprächskontext (vorbereitet für spätere Gespräche mit Qwen): immer genau EIN Lerner.
 *
 *   learnerId + conversationId ─▶ Züge (turn_id = Versuch) dieses Lerners in diesem Gespräch
 *
 * Der Kontext entsteht aus den Ereignissen (attempt mit payload.conversation_id), nie aus einem
 * gemeinsamen Zwischenspeicher. Ereignisse anderer Lerner werden ausgefiltert, auch wenn sie
 * versehentlich übergeben werden; assertContextOwner() prüft vor jeder Weitergabe (z. B. an Qwen),
 * dass Kontext und Lerner zusammenpassen. So gelangen Gesprächsinhalte von A nie in eine Anfrage für B.
 */

export const CONVERSATION_CONTEXT_VERSION = 1;
export const MAX_CONTEXT_TURNS = 6;

/**
 * @param {{events: object[], learnerId: string, conversationId: string|null, maxTurns?: number}} input
 * @returns {{version: number, learner_id: string, conversation_id: string|null, turns: {turn_id: string,
 *   learner_id: string, at: string, exercise_id: string, text: string, input_mode: string}[]}}
 */
export function buildConversationContext({ events, learnerId, conversationId, maxTurns = MAX_CONTEXT_TURNS }) {
  if (typeof learnerId !== "string" || !learnerId) throw new TypeError("Gesprächskontext: learnerId fehlt");
  if (!Array.isArray(events)) throw new TypeError("events: Liste erwartet");
  const turns = conversationId
    ? [...new Map(events
      .filter((e) => e?.event_type === "attempt" && e.user_id === learnerId && e.payload?.conversation_id === conversationId)
      .map((e) => [e.id, e])).values()]
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(-maxTurns)
      .map((e) => ({
        turn_id: e.id, learner_id: e.user_id, at: e.created_at, exercise_id: e.payload.exercise_id,
        text: e.payload.answer_text, input_mode: e.payload.input_mode,
      }))
    : [];
  return { version: CONVERSATION_CONTEXT_VERSION, learner_id: learnerId, conversation_id: conversationId ?? null, turns };
}

/** Wirft, wenn der Kontext nicht vollständig diesem Lerner gehört. */
export function assertContextOwner(context, learnerId) {
  if (!context || context.learner_id !== learnerId || context.turns.some((t) => t.learner_id !== learnerId)) {
    throw new Error("Gesprächskontext gehört nicht zu diesem Lerner");
  }
  return context;
}
