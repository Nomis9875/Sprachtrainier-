/**
 * Gespräch (P11A): Szenario vorstellen → Gespräch führen (tippen oder sprechen) → Lernanalyse.
 *
 * Die Ansicht zeigt, was der App-Service liefert (model/conversation.js), und folgt der Zustandsmaschine
 * core/conversation/phases.js (warten, aufnehmen, erkennen, auswerten, antworten, pausiert, Fehler).
 * Während des Gesprächs erscheint keine Fehlerliste, nur die Reaktion und Frage des Gesprächspartners;
 * die Lernanalyse folgt am Ende. Neu laden, Neustart und Nutzerwechsel setzen das Gespräch fort.
 */

import { h, icon, meter, targetLang } from "../dom.js";
import { answerForm, confirmDialog } from "../components.js";
import { canSubmit, initialPhase, transition } from "../../model/conversation.js";

const PHASE_TEXT = Object.freeze({
  waiting_for_user: "Du bist dran: tippe oder sprich deine Antwort.",
  recording: "Aufnahme läuft …",
  transcribing: "Wird lokal erkannt …",
  evaluating: "Antwort wird ausgewertet …",
  responding: "",
  stt_error: "Die Spracherkennung hat nicht geklappt. Versuche es noch einmal oder tippe.",
  empty_response: "Sag oder schreib zuerst etwas.",
  paused: "Das Gespräch ist pausiert.",
});
const NOTICE_TEXT = Object.freeze({
  assistant_unavailable: "Die KI-Hilfe ist gerade nicht erreichbar. Das Gespräch läuft ohne sie weiter.",
  time_up: "Die Zeit ist fast um: letzte Frage.",
  timeout: "Die KI-Hilfe hat zu lange gebraucht. Das Gespräch läuft ohne sie weiter.",
});

export async function conversationView(ctx, { scenarioId }) {
  const page = await ctx.app.conversationPage(scenarioId);
  ctx.setTitle(page.scenario.title);
  const root = h("div", { class: "page conversation-page", "data-scenario": scenarioId });
  const back = () => h("a", { class: "back", href: "#/ueben" }, icon("back", { size: 18 }), "Alle Gespräche");

  const render = (conversation, { notice = null } = {}) => {
    root.dataset.status = conversation?.status ?? "intro";
    if (!conversation) {
      root.replaceChildren(back(), introCard(ctx, page, render));
    } else if (conversation.finished) {
      root.replaceChildren(...[back(), resultCard(ctx, conversation, render), transcriptDetails(conversation)].filter(Boolean));
    } else {
      const phase = { ...initialPhase(conversation.status), notice };
      root.replaceChildren(...[back(), header(ctx, conversation, render), transcript(conversation),
        conversation.paused ? pausedCard(ctx, conversation, render) : turnCard(ctx, conversation, render, phase)].filter(Boolean));
    }
    root.dataset.phase = root.querySelector("[data-phase]")?.dataset.phase ?? root.dataset.status;
  };
  render(page.conversation);
  return root;
}

// ---------------------------------------------------------------- vor dem Gespräch

function introCard(ctx, page, render) {
  const s = page.scenario;
  const minutes = h("select", { id: "conv-minutes" }, page.budgets.map((m) => h("option", { value: m, selected: m === page.default_minutes }, `${m} Minuten`)));
  const start = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "start-conversation" }, icon("play", { size: 18 }), "Gespräch beginnen");
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  start.addEventListener("click", async () => {
    start.disabled = true;
    try {
      render(await ctx.app.startConversation(s.id, { minutes: Number(minutes.value) }));
    } catch (err) {
      error.textContent = err?.userMessage ?? "Das Gespräch konnte nicht gestartet werden.";
      error.hidden = false;
      start.disabled = false;
    }
  });
  const other = page.other_open;
  return h("div", { class: "stack-page" },
    h("section", { class: "card conversation-intro", "aria-labelledby": "conv-title" },
      h("div", { class: "task-meta" }, h("span", { class: "badge badge-accent" }, s.goal_label), h("span", { class: "badge" }, s.level)),
      h("h1", { id: "conv-title" }, s.title),
      h("p", {}, s.situation_de),
      h("p", { class: "task-hint" }, h("span", { class: "muted" }, "Dein Ziel: "), s.goal_de),
      h("p", { class: "muted small" }, h("span", {}, "Gesprächspartner: "), s.partner_role_de),
      h("p", { class: "muted small" }, "Antworte schriftlich oder sprich. Während des Gesprächs gibt es keine Fehlerliste; die Auswertung kommt am Ende."),
      other
        ? h("div", { class: "notice" },
          h("p", {}, `Du hast noch ein offenes Gespräch: „${other.title}“. Es ist immer nur eines offen.`),
          h("a", { class: "btn btn-secondary", href: `#/gespraech/${encodeURIComponent(other.scenario_id)}`, "data-action": "open-other-conversation" }, "Dort weitermachen"))
        : h("div", { class: "form" },
          h("div", { class: "field" }, h("label", { for: "conv-minutes", class: "label" }, "Dauer"), minutes),
          start),
      error),
    page.last_finished?.result ? h("details", { class: "card more last-result" },
      h("summary", {}, "Letzte Auswertung"), resultBody(page.last_finished)) : null);
}

// ---------------------------------------------------------------- im Gespräch

function header(ctx, conversation, render) {
  const p = conversation.progress;
  const pause = h("button", { type: "button", class: "btn btn-ghost", "data-action": "pause-conversation" }, icon("pause"), h("span", { class: "hide-narrow" }, "Pausieren"));
  pause.addEventListener("click", async () => {
    pause.disabled = true;
    try {
      render(await ctx.app.pauseConversation(conversation.conversation_id));
    } catch (error) {
      pause.disabled = false;
      ctx.toast(error?.userMessage ?? "Das Gespräch konnte nicht pausiert werden.");
    }
  });
  const end = h("button", { type: "button", class: "btn btn-ghost", "data-action": "abandon-conversation" }, icon("close"), h("span", { class: "hide-narrow" }, "Beenden"));
  end.addEventListener("click", () => abandon(ctx, conversation, render));
  return h("header", { class: "conversation-head" },
    h("div", {},
      h("h1", { class: "conversation-title" }, conversation.title),
      h("span", { class: "muted small conversation-count", "aria-live": "polite" },
        `Runde ${p.turn} · noch etwa ${p.remaining_minutes} von ${p.budget_minutes} Min.`)),
    h("div", { class: "conversation-actions" }, conversation.paused ? null : pause, end),
    meter(p.ratio, "Verbrauchte Gesprächszeit"));
}

/** Verlauf: Gesprächspartner links, eigene Antworten rechts. Die offene Frage steht in der Antwortkarte. */
function transcript(conversation) {
  const entries = conversation.current ? conversation.transcript.slice(0, -1) : conversation.transcript;
  if (!entries.length) return null;
  return h("ol", { class: "plain transcript", "aria-label": "Gesprächsverlauf" }, entries.map((entry) => h("li", { class: `turn ${entry.role}` },
    h("p", { class: `bubble ${entry.role === "partner" ? "partner" : "own"}`, lang: targetLang() },
      entry.input_mode === "speech" ? h("span", { class: "sr-only" }, "Gesprochen: ") : null,
      entry.input_mode === "speech" ? icon("mic", { size: 16 }) : null,
      entry.text))));
}

function turnCard(ctx, conversation, render, initial) {
  const turn = conversation.current;
  let phase = initial;
  const status = h("p", { class: "muted small conversation-status", role: "status", "aria-live": "polite" });
  const card = h("section", { class: "card turn-now", "aria-labelledby": "turn-prompt", "data-phase": phase.phase, "data-exercise": turn.exercise.id });
  const show = () => {
    card.dataset.phase = phase.phase;
    status.textContent = [PHASE_TEXT[phase.phase], NOTICE_TEXT[phase.notice]].filter(Boolean).join(" ");
  };
  const dispatch = (type, extra = {}) => {
    phase = transition(phase, { type, ...extra });
    show();
    return !phase.rejected;
  };
  const form = answerForm(turn.exercise, {
    speech: ctx.speech,
    aiAnalysis: ctx.aiAnalysis,
    submitLabel: "Antworten",
    busyLabel: "Antwort wird ausgewertet …",
    onEvent: (type) => dispatch(type),
    onSubmit: async (answerText, durationMs, { inputMode, signal }) => {
      if (!canSubmit(phase)) return;
      if (!answerText.trim()) {
        dispatch("SUBMIT_EMPTY");
        throw Object.assign(new Error("leer"), { userMessage: "Sag oder schreib zuerst etwas." });
      }
      dispatch("SUBMIT");
      let result;
      try {
        result = await ctx.app.respondConversation(conversation.conversation_id, { answerText, durationMs, inputMode, signal });
      } catch (error) {
        dispatch("FAILED");
        throw error;
      }
      const notice = result.ai.guidance === "unavailable" || result.ai.status === "unavailable" ? "assistant_unavailable"
        : result.ai.guidance === "timeout" || result.ai.status === "timeout" ? "timeout"
          : result.turn.rule === "wrap_up" ? "time_up" : null;
      dispatch(result.conversation.finished ? "COMPLETED" : "RESPONDED");
      render(result.conversation, { notice });
      queueMicrotask(() => document.querySelector(".conversation-page #turn-prompt, .conversation-page .conversation-result h2")?.focus());
    },
  });
  queueMicrotask(() => form.focusInput());
  card.append(
    h("p", { id: "turn-prompt", class: "bubble partner", lang: targetLang(), tabindex: "-1" },
      turn.reaction_es ? h("span", { class: "reaction" }, `${turn.reaction_es} `) : null, turn.question_es),
    form,
    status);
  show();
  return card;
}

function pausedCard(ctx, conversation, render) {
  const resume = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "resume-conversation" }, "Fortsetzen");
  resume.addEventListener("click", async () => {
    resume.disabled = true;
    try {
      render(await ctx.app.resumeConversation(conversation.conversation_id));
    } catch (error) {
      resume.disabled = false;
      ctx.toast(error?.userMessage ?? "Das Gespräch konnte nicht fortgesetzt werden.");
    }
  });
  queueMicrotask(() => resume.focus());
  return h("section", { class: "card paused", "aria-labelledby": "conv-paused", "data-phase": "paused" },
    h("h2", { id: "conv-paused" }, "Pausiert"),
    h("p", {}, "Die Pausenzeit zählt nicht zur Gesprächszeit. Die letzte Frage wartet auf dich."),
    resume);
}

async function abandon(ctx, conversation, render) {
  const ok = await confirmDialog({
    title: "Gespräch beenden?",
    text: "Deine bisherigen Antworten bleiben gespeichert und fließen in die Auswertung ein.",
    confirmLabel: "Beenden",
    cancelLabel: "Weiterreden",
    danger: true,
  });
  if (!ok) return;
  try {
    render(await ctx.app.abandonConversation(conversation.conversation_id));
  } catch (error) {
    ctx.toast(error?.userMessage ?? "Das Gespräch konnte nicht beendet werden.");
  }
}

// ---------------------------------------------------------------- nach dem Gespräch

function resultCard(ctx, conversation, render) {
  const again = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "restart-conversation" }, "Noch einmal führen");
  again.addEventListener("click", async () => {
    again.disabled = true;
    try {
      render(await ctx.app.startConversation(conversation.scenario_id, { minutes: conversation.progress.budget_minutes }));
    } catch (error) {
      again.disabled = false;
      ctx.toast(error?.userMessage ?? "Das Gespräch konnte nicht gestartet werden.");
    }
  });
  return h("section", { class: "card conversation-result", "aria-labelledby": "result-title" },
    h("h2", { id: "result-title", tabindex: "-1" }, conversation.status === "abandoned" ? "Gespräch beendet" : "Gespräch abgeschlossen!"),
    resultBody(conversation),
    h("div", { class: "stack" }, again, h("a", { class: "btn btn-link", href: "#/ueben" }, "Zu den Gesprächen")));
}

function resultBody(conversation) {
  const r = conversation.result;
  if (!r) return null;
  return h("div", { class: "result-body" },
    r.completion ? h("p", { class: "muted" }, r.completion) : null,
    h("dl", { class: "stats" }, stat("Minuten", r.minutes), stat("Runden", r.turns), stat("gesprochen", r.spoken), stat("ohne Fehler", r.error_free)),
    r.went_well.length ? h("div", { class: "group" }, h("h3", { class: "group-title" }, "Was gut lief"),
      h("ul", { class: "plain went-well" }, r.went_well.map((text) => h("li", {}, icon("check", { size: 16 }), " ", text)))) : null,
    r.work_on.length ? h("div", { class: "group" }, h("h3", { class: "group-title" }, "Woran wir arbeiten"),
      h("ul", { class: "plain work-on" }, r.work_on.map((item) => h("li", {},
        h("strong", {}, item.label), item.count > 1 ? h("span", { class: "muted" }, ` (${item.count}×)`) : null,
        item.example ? h("span", { class: "finding-fix", lang: targetLang() }, " ", h("del", {}, item.example.original), " → ", h("ins", {}, item.example.suggestion)) : null)))) : null,
    r.natural_sentence ? h("div", { class: "group natural" }, h("h3", { class: "group-title" }, "Ein Satz, den du so sagen könntest"),
      h("p", { class: "muted small" }, "Original"), h("p", { lang: targetLang() }, r.natural_sentence.original),
      h("p", { class: "muted small" }, r.natural_sentence.source === "llm" ? "Vorschlag der lokalen KI (unbestätigt)" : "Besser"),
      h("p", { lang: targetLang() }, h("strong", {}, r.natural_sentence.improved)),
      r.natural_sentence.explanation_de ? h("p", { class: "muted small" }, r.natural_sentence.explanation_de) : null) : null);
}

function transcriptDetails(conversation) {
  const entries = transcript(conversation);
  return entries ? h("details", { class: "card more transcript-details" }, h("summary", {}, "Gesprächsverlauf"), entries) : null;
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, String(value)));
}
