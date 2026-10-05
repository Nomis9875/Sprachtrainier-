/**
 * Session (fokussiert, ohne Navigation):
 *   Aufgabe → Antwort → Bewertung → Rückmeldung → Weiter → … → Auswertung
 * Pause, Fortsetzen und Beenden laufen über die Session Runtime (Ereignisse). Nach einem Neustart
 * geht es bei der ersten offenen Übung weiter.
 */

import { h, icon, meter } from "../dom.js";
import { t } from "../../model/i18n.js";
import { answerForm, coachTip, confirmDialog, emptyState, feedbackPanel, listeningPlayer, masteryText, taskCard } from "../components.js";
import { startSessionAction } from "./learn.js";

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
  // P25.5: erste Aufgabe: kurz erklären, warum selbst schreiben und warum Fehler zählen (einmal)
  const tip = view.completed === 0 && ctx.takeTip?.("first_task") ? coachTip("first_task", t("tip.first_task")) : null;
  return [h("div", { class: "session-body" }, tip, taskCard(exercise), player?.element ?? null, form)];
}

function feedbackStep(ctx, view, { feedback, ai, answerText, next }, render) {
  const last = next.finished;
  const button = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "next" },
    last ? t("session.to_summary") : t("session.next"), icon("arrow", { size: 18 }));
  button.addEventListener("click", () => render(next));
  const panel = feedbackPanel(feedback, { answerText, ai });
  queueMicrotask(() => panel.querySelector("#feedback-title")?.focus());
  // P25.5: erste Rückmeldung mit Fehler: der Fehler kommt gezielt wieder (einmal)
  const tip = feedback.verdict === "incorrect" && ctx.takeTip?.("first_error") ? coachTip("first_error", t("tip.first_error")) : null;
  return [h("div", { class: "session-body" }, taskCard(view.exercise, { headingLevel: 2 }), panel, tip, h("div", { class: "sticky-actions" }, button))];
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
    .then((summary) => box.replaceChildren(summaryCard(summary, null, ctx,
      // P25.5: erstes Session-Ende: wie Fortschritt gemessen wird (einmal)
      summary.status === "completed" && ctx.takeTip?.("first_summary") ? coachTip("first_summary", t("tip.first_summary")) : null)))
    .catch((error) => {
      console.error(error);
      box.replaceChildren(summaryCard(null, view, ctx));
    });
  return box;
}

/** Höchstens so viele Zeilen "Heute gelungen" und "Daran arbeiten wir weiter" (der Rest steht unter Fortschritt). */
export const MAX_WENT_WELL = 4;
export const MAX_WORK_ON = 2;

/**
 * P25.4: Das Gelungene zuerst (gemessen: ohne Fehler geübt, Stufenaufstiege, überwundene Fehler, Meilensteine),
 * dann was morgen wartet; was noch nicht sitzt, kurz und ruhig am Ende.
 */
function summaryCard(summary, view = null, ctx = null, tip = null) {
  const abandoned = (summary?.status ?? view?.status) === "abandoned";
  const completed = summary?.completed ?? view?.completed ?? 0;
  const s = summary;
  const well = s ? s.went_well.slice(0, MAX_WENT_WELL) : [];
  return h("section", { class: "card summary", "aria-labelledby": "summary-title", "data-status": abandoned ? "abandoned" : "completed" },
    h("div", { class: "summary-head" },
      h("span", { class: "summary-mark", "aria-hidden": "true" }, icon("check", { size: 30 })),
      h("h1", { id: "summary-title", tabindex: "-1" }, abandoned ? t("session.ended") : t("session.completed")),
      // P25.7: die Kernaussage zuerst (ehrlich: ohne Fehler = richtig oder offen), dann das Wichtigste der Session
      s && completed ? h("p", { class: "summary-score", "data-score": "" }, t("sum.score", s.answers.correct, completed),
        s.answers.open ? h("span", { class: "muted summary-open" }, t("sum.score_open", s.answers.open)) : null) : null,
      h("p", { class: "summary-lead" }, abandoned ? t("session.saved") : leadLine(s, completed))),
    s ? h("dl", { class: "stats stats-compact" },
      stat(t("session.exercises"), `${completed}${abandoned ? t("session.of", s.planned) : ""}`),
      stat(t("session.correct"), String(s.answers.correct)),
      stat(t("session.time"), `${s.minutes} min`)) : null,
    s?.milestones?.length ? h("div", { class: "summary-block milestones-new", "data-block": "milestones" },
      h("p", { class: "eyebrow" }, icon("award", { size: 16 }), t("sum.milestone")),
      h("ul", { class: "plain milestone-list" }, s.milestones.map((m) => h("li", { class: "milestone", "data-milestone": m.id },
        h("strong", {}, m.title), h("span", { class: "muted small" }, m.text))))) : null,
    s?.resolved?.length ? h("div", { class: "summary-block", "data-block": "resolved" },
      h("h2", { class: "h3" }, t("sum.resolved")),
      h("ul", { class: "plain check-list" }, s.resolved.map((title) => h("li", {}, icon("check", { size: 16 }), h("strong", {}, title))))) : null,
    well.length ? h("div", { class: "summary-block", "data-block": "went-well" },
      h("h2", { class: "h3" }, t("sum.today_well")),
      h("ul", { class: "plain check-list" }, well.map((w) => h("li", { "data-improved": String(w.improved) }, icon("check", { size: 16 }),
        h("span", {}, h("strong", {}, w.title), h("span", { class: "muted small" }, ` ${stepText(w)}`))))),
      s.went_well.length > MAX_WENT_WELL ? h("p", { class: "muted small" }, t("session.more", s.went_well.length - MAX_WENT_WELL)) : null) : null,
    tip,
    s?.tomorrow ? tomorrowBlock(s.tomorrow) : null,
    s?.weaknesses.length ? h("div", { class: "summary-block calm", "data-block": "work-on" },
      h("h2", { class: "h3" }, t("session.work_on")),
      h("p", { class: "muted small" }, `${s.weaknesses.slice(0, MAX_WORK_ON).map((w) => w.title).join(" · ")}. ${t("sum.calm")}`)) : null,
    h("div", { class: "stack summary-actions" },
      h("a", { class: "btn btn-primary btn-block", href: "#/", "data-action": "home" }, t("sum.done_today")),
      ctx ? keepLearningButton(ctx) : null,
      h("a", { class: "btn btn-link", href: "#/fortschritt" }, t("session.see_progress"))));
}

/** Weiterlernen: gleich die nächste Session (Länge aus dem Tagesziel), wie auf "Heute". */
function keepLearningButton(ctx) {
  const button = h("button", { type: "button", class: "btn btn-secondary btn-block", "data-action": "keep-learning" }, t("sum.keep_learning"));
  button.addEventListener("click", async () => {
    const profile = await ctx.app.profile();
    await startSessionAction(ctx, profile.daily_minutes, button);
  });
  return button;
}

/** Der stärkste echte Satz der Session: überwundener Fehler, dann Aufstiege, dann Übungen ohne Fehler. */
function leadLine(s, completed) {
  if (!s) return t("session.saved_next");
  const ups = s.went_well.filter((w) => w.improved).length;
  if (s.resolved?.length) return t("sum.hero_resolved", s.resolved.length);
  if (ups) return t("sum.hero_up", ups);
  // die Zahl steht schon darüber (summary-score): hier nur noch ein kurzer, ehrlicher Satz
  return s.answers.without_errors === completed && completed ? t("session.strong") : t("session.kept_going");
}

function stepText(w) {
  if (!w.improved) return t("sum.times_right", w.successes);
  return w.before === "unknown" ? t("sum.new_learned") : `${masteryText(w.before)} → ${masteryText(w.after)}`;
}

/** "Morgen wartet": konkrete Inhalte (fällige Wiederholungen, nächste neue Struktur, noch einmal das Schwierige). */
export function tomorrowBlock(tomorrow, again = null) {
  const items = [
    tomorrow.reviews ? ["repeat", t("sum.t_reviews", tomorrow.reviews, tomorrow.review_titles.join(", "))] : null,
    tomorrow.new_skill ? ["sparkle", t("sum.t_new", tomorrow.new_skill)] : null,
    again ? ["target", t("sum.t_again", again)] : null,
  ].filter(Boolean);
  return h("div", { class: "summary-block tomorrow", "data-block": "tomorrow" },
    h("h2", { class: "h3" }, icon("calendar", { size: 18 }), t("sum.tomorrow")),
    items.length
      ? h("ul", { class: "plain icon-list" }, items.map(([name, text]) => h("li", {}, icon(name, { size: 16 }), h("span", {}, text))))
      : h("p", { class: "muted small" }, t("sum.t_none")));
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value));
}
