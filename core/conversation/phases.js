/**
 * Conversation Engine · Ablauf einer Runde in der Oberfläche (deterministische Zustandsmaschine).
 *
 *   intro ─START─▶ waiting_for_user ─RECORD─▶ recording ─STOP─▶ transcribing ─TRANSCRIBED─▶ waiting_for_user
 *                        │                                          └─STT_FAILED─▶ stt_error ─(RECORD|SUBMIT)─▶ …
 *                        ├─SUBMIT (leer)─▶ empty_response ─(RECORD|SUBMIT)─▶ …
 *                        └─SUBMIT─▶ evaluating ─RESPONDED─▶ responding ─SHOWN─▶ waiting_for_user
 *                                       │         └─COMPLETED─▶ complete
 *                                       └─FAILED─▶ waiting_for_user (Antwort bleibt im Feld)
 *   waiting_for_user/stt_error/empty_response ─PAUSE─▶ paused ─RESUME─▶ waiting_for_user
 *   jede Phase außer complete/abandoned ─ABANDON─▶ abandoned
 *
 * Hinweise (notice) ändern die Phase nicht: assistant_unavailable (lokale KI aus; Gespräch läuft mit der Regel-Policy
 * weiter), time_up (Zeitbudget fast verbraucht: Abschlussfrage), timeout (lokaler Dienst zu langsam).
 * Der dauerhafte Zustand (active/paused/completed/abandoned) liegt in den Ereignissen (state.js);
 * diese Maschine beschreibt nur, was die Oberfläche gerade zeigt und erlaubt.
 */

export const PHASES = Object.freeze([
  "intro", "waiting_for_user", "recording", "transcribing", "evaluating", "responding", "paused",
  "stt_error", "empty_response", "complete", "abandoned",
]);
export const NOTICES = Object.freeze(["assistant_unavailable", "time_up", "timeout"]);
const FINAL = new Set(["complete", "abandoned"]);
const READY = ["waiting_for_user", "stt_error", "empty_response"];

const TRANSITIONS = Object.freeze({
  START: { intro: "waiting_for_user", paused: "waiting_for_user" },
  RECORD: Object.fromEntries(READY.map((p) => [p, "recording"])),
  STOP: { recording: "transcribing" },
  TRANSCRIBED: { transcribing: "waiting_for_user" },
  STT_FAILED: { transcribing: "stt_error", recording: "stt_error" },
  SUBMIT: Object.fromEntries(READY.map((p) => [p, "evaluating"])),
  SUBMIT_EMPTY: Object.fromEntries(READY.map((p) => [p, "empty_response"])),
  RESPONDED: { evaluating: "responding" },
  SHOWN: { responding: "waiting_for_user" },
  COMPLETED: { evaluating: "complete", responding: "complete" },
  FAILED: { evaluating: "waiting_for_user" },
  PAUSE: Object.fromEntries(READY.map((p) => [p, "paused"])),
  RESUME: { paused: "waiting_for_user" },
});

/** Anfangszustand der Oberfläche (für ein laufendes Gespräch direkt waiting_for_user). */
export function initialPhase(status = null) {
  const phase = status === "active" ? "waiting_for_user" : status === "paused" ? "paused"
    : status === "completed" ? "complete" : status === "abandoned" ? "abandoned" : "intro";
  return { phase, notice: null, rejected: null };
}

/**
 * @param {{phase: string, notice: string|null}} state
 * @param {{type: string, notice?: string}} action
 * @returns {{phase: string, notice: string|null, rejected: string|null}}  rejected: nicht erlaubter Übergang
 */
export function transition(state, action) {
  if (action.type === "NOTICE") {
    if (!NOTICES.includes(action.notice)) throw new TypeError(`Unbekannter Hinweis: ${action.notice}`);
    return { ...state, notice: action.notice, rejected: null };
  }
  if (action.type === "ABANDON") {
    return FINAL.has(state.phase) ? { ...state, rejected: action.type } : { phase: "abandoned", notice: null, rejected: null };
  }
  const table = TRANSITIONS[action.type];
  if (!table) throw new TypeError(`Unbekannte Aktion: ${action.type}`);
  const next = table[state.phase];
  if (!next) return { ...state, rejected: action.type };
  // Neue Nutzereingabe beendet frühere Hinweise; Hinweise zur Zeit bleiben bis zum Abschluss sichtbar
  const keep = state.notice === "time_up" || ["RESPONDED", "COMPLETED", "SHOWN"].includes(action.type);
  return { phase: next, notice: keep ? state.notice : null, rejected: null };
}

/** Darf die Oberfläche jetzt eine Antwort annehmen (verhindert doppeltes Absenden)? */
export function canSubmit(state) {
  return READY.includes(state.phase);
}
