/**
 * Session (fokussiert, ohne Navigation):
 *   Aufgabe → Antwort → Bewertung → Rückmeldung → Weiter → … → Auswertung
 * Pause, Fortsetzen und Beenden laufen über die Session Runtime (Ereignisse). Nach einem Neustart
 * geht es bei der ersten offenen Übung weiter.
 */

import { h, icon, meter } from "../dom.js";
import { t } from "../../model/i18n.js";
import { explain } from "../../model/explain.js";
import { answerForm, confirmDialog, emptyState, feedbackPanel, listeningPlayer, masteryText, taskCard } from "../components.js";

export async function sessionView(ctx) {
  ctx.setTitle(t("session.title"));
  const open = await ctx.app.openSession();
  if (!open) {
    return h("div", { class: "page session" },
      emptyState({
        title: t("session.none"),
        text: t("session.none_text"),
        action: h("a", { class: "btn btn-primary", href: "#/lernen" }, "Zur Auswahl"),
      }));
  }
  const root = h("div", { class: "page session", "data-session-id": open.session_id });
  const render = (view, extra) => root.replaceChildren(...screen(ctx, view, extra, render));
  render(open);
  return root;
}

function screen(ctx, view, extra = {}, render) {
  if (view.status === "paused") return [header(ctx, view, render), pausedPanel(ctx, view, render)];
  if (view.finished) return [summaryLoader(ctx, view, render)];
  return [header(ctx, view, render), ...(extra.feedback ? feedbackStep(ctx, view, extra, render) : taskStep(ctx, view, render))];
}

function header(ctx, view, render) {
  const pause = h("button", { type: "button", class: "btn btn-ghost", "data-action": "pause", "aria-label": t("session.pause_label") },
    icon("pause"), h("span", { class: "hide-narrow" }, t("l.pause")));
  pause.addEventListener("click", async () => {
    pause.disabled = true;
    try {
      render(await ctx.app.pauseSession(view.session_id));
    } catch (error) {
      pause.disabled = false;
      ctx.toast(error?.userMessage ?? t("session.pause_failed"));
    }
  });
  const end = h("button", { type: "button", class: "btn btn-ghost", "data-action": "abandon", "aria-label": t("session.end_label") },
    icon("close"), h("span", { class: "hide-narrow" }, t("session.end")));
  end.addEventListener("click", () => abandon(ctx, view, render));
  return h("header", { class: "session-head" },
    view.status === "paused" ? h("span") : pause,
    h("div", { class: "session-progress" },
      h("span", { class: "session-count", "aria-live": "polite" }, `${view.position} / ${view.total}`),
      meter(view.ratio, t("home.session_progress"))),
    end);
}

function taskStep(ctx, view, render) {
  const exercise = view.exercise;
  // P15: Höraufgabe in der Session: Abspielen, Hilfen; "nichts verstanden" wird notiert (kein Fehler), Antworten bleibt möglich
  const player = exercise.listening ? listeningPlayer(exercise.listening, {
    onInteraction: (i) => ctx.app.recordListeningInteraction(exercise.id, { ...i, sessionId: view.session_id }).catch((err) => console.error(err)),
    onNoAnswer: async (reason, state) => {
      await ctx.app.skipListening(exercise.id, { reason, ...state, sessionId: view.session_id });
      ctx.toast(t("session.noted"));
    },
  }) : null;
  const form = answerForm(exercise, {
    speech: exercise.listening && exercise.type !== "listening_response" ? null : ctx.speech, // Whisper nur für die Antwort
    aiAnalysis: ctx.aiAnalysis,
    onSubmit: async (answerText, durationMs, { inputMode, signal }) => {
      player?.stop();
      const result = await ctx.app.submitAnswer(view.session_id, { answerText, durationMs, inputMode, signal, listening: player?.state() ?? null });
      render(view, { feedback: result.feedback, ai: result.ai, answerText, next: result.session });
    },
  });
  queueMicrotask(() => form.focusInput());
  return [h("div", { class: "session-body" }, taskCard(exercise), player?.element ?? null, form)];
}

function feedbackStep(ctx, view, { feedback, ai, answerText, next }, render) {
  const last = next.finished;
  const button = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "next" },
    last ? t("session.to_summary") : t("session.next"), icon("arrow", { size: 18 }));
  button.addEventListener("click", () => render(next));
  const panel = feedbackPanel(feedback, { answerText, ai });
  queueMicrotask(() => panel.querySelector("#feedback-title")?.focus());
  return [h("div", { class: "session-body" }, taskCard(view.exercise, { headingLevel: 2 }), panel, h("div", { class: "sticky-actions" }, button))];
}

function pausedPanel(ctx, view, render) {
  const resume = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "resume" }, t("home.resume"));
  resume.addEventListener("click", async () => {
    resume.disabled = true;
    try {
      render(await ctx.app.resumeSession(view.session_id));
    } catch (error) {
      resume.disabled = false;
      ctx.toast(error?.userMessage ?? t("session.resume_failed"));
    }
  });
  const end = h("button", { type: "button", class: "btn btn-secondary btn-block", "data-action": "abandon" }, t("session.end_label"));
  end.addEventListener("click", () => abandon(ctx, view, render));
  queueMicrotask(() => resume.focus());
  return h("section", { class: "card paused", "aria-labelledby": "paused-title" },
    h("h2", { id: "paused-title" }, t("home.paused")),
    h("p", {}, t("session.paused_text", view.completed, view.total)),
    h("div", { class: "stack" }, resume, end, h("a", { class: "btn btn-link", href: "#/" }, t("common.back_home"))));
}

async function abandon(ctx, view, render) {
  const ok = await confirmDialog({
    title: t("session.end_q"),
    text: t("session.end_text"),
    confirmLabel: t("session.end"),
    cancelLabel: t("session.keep"),
    danger: true,
  });
  if (!ok) return;
  try {
    render(await ctx.app.abandonSession(view.session_id));
  } catch (error) {
    ctx.toast(error?.userMessage ?? t("session.end_failed"));
  }
}

/** Auswertung wird nachgeladen (Kompetenz vorher/nachher braucht einen Moment). */
function summaryLoader(ctx, view) {
  const box = h("div", { class: "session-body", "aria-live": "polite" });
  ctx.app.sessionSummary(view.session_id)
    .then((summary) => box.replaceChildren(summaryCard(summary, null, ctx.app.explanationLanguage)))
    .catch((error) => {
      console.error(error);
      box.replaceChildren(summaryCard(null, view));
    });
  return box;
}

function summaryCard(summary, view = null, language = "de") {
  const abandoned = (summary?.status ?? view?.status) === "abandoned";
  const completed = summary?.completed ?? view?.completed ?? 0;
  return h("section", { class: "card summary", "aria-labelledby": "summary-title", "data-status": abandoned ? "abandoned" : "completed" },
    h("h1", { id: "summary-title", tabindex: "-1" }, abandoned ? t("session.ended") : t("session.completed")),
    h("p", {}, abandoned
      ? t("session.saved")
      : `${summary && summary.answers.with_errors > summary.answers.correct ? t("session.kept_going") : t("session.strong")} ${t("session.saved_next")}`),
    summary ? h("dl", { class: "stats" },
      stat(t("session.exercises"), `${completed}${abandoned ? t("session.of", summary.planned) : ""}`),
      stat(t("session.correct"), String(summary.answers.correct)),
      stat(t("session.with_errors"), String(summary.answers.with_errors)),
      summary.answers.open ? stat(t("session.open"), String(summary.answers.open)) : null,
      stat(t("session.time"), `${summary.minutes} min`)) : null,
    summary?.answers.open ? h("p", { class: "muted small" },
      explain(language, "open_note")) : null,
    summary?.improved.length ? h("div", {},
      h("h2", { class: "h3" }, t("nav.progress")),
      // höchstens drei Zeilen, der Rest als Zahl (die vollständige Übersicht steht unter Fortschritt)
      h("ul", { class: "plain progress-list" }, summary.improved.slice(0, 3).map((s) => h("li", {}, h("strong", {}, s.title),
        h("span", { class: "muted" }, ` ${masteryText(s.before)} → ${masteryText(s.after)}`)))),
      summary.improved.length > 3 ? h("p", { class: "muted small" }, t("session.more", summary.improved.length - 3)) : null) : null,
    summary?.weaknesses.length ? h("div", {},
      h("h2", { class: "h3" }, t("session.work_on")),
      h("ul", { class: "plain" }, summary.weaknesses.slice(0, 3).map((s) => h("li", {}, h("strong", {}, s.title),
        h("span", { class: "muted" }, t("session.failures", s.failures, s.successes)))))) : null,
    h("div", { class: "stack" },
      h("a", { class: "btn btn-primary btn-block", href: "#/", "data-action": "home" }, t("common.back_home")),
      h("a", { class: "btn btn-secondary btn-block", href: "#/fortschritt" }, t("session.see_progress"))));
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value));
}
