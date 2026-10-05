/** Üben: Gespräche und Themen → Übungen → eine Übung (außerhalb einer Session, als Versuch gespeichert). */

import { minutesText } from "../../model/labels.js";
import { h, icon } from "../dom.js";
import { t } from "../../model/i18n.js";
import { answerForm, emptyState, feedbackPanel, listeningPlayer, taskCard } from "../components.js";

export async function practiceView(ctx) {
  ctx.setTitle(t("nav.practice"));
  const topics = ctx.app.practiceTopics();
  const conversations = await ctx.app.conversationList();
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, t("nav.practice")),
      h("p", { class: "muted" }, t("practice.lead"))),
    conversations.length ? conversationsSection(conversations) : null,
    textsSection(ctx),
    topics.length
      ? h("div", { class: "grid" }, topics.map((topic) => h("section", { class: "card topic", "aria-labelledby": `t-${topic.id}` },
        h("h2", { id: `t-${topic.id}` }, h("a", { href: `#/ueben/${encodeURIComponent(topic.id)}` }, topic.name)),
        h("p", { class: "muted small" }, t("common.exercises", topic.count)),
        topic.subtopics.length ? h("ul", { class: "chips" }, topic.subtopics.map((s) =>
          h("li", {}, h("a", { class: "chip", href: `#/ueben/${encodeURIComponent(s.id)}` }, s.name, h("span", { class: "chip-count" }, String(s.count)))))) : null)))
      : emptyState({ title: t("practice.none"), text: t("practice.none_text") }));
}

/** P24: Hören und Lesen: der nächste passende, noch nicht geübte Text mit einem Tipp (statt langer Listen). */
function textsSection(ctx) {
  const counts = ctx.app.practiceTextCounts();
  const entries = [["listening", t("practice.listen"), t("practice.listen_n", counts.listening), counts.listening], ["reading", t("practice.read"), t("practice.read_n", counts.reading), counts.reading]]
    .filter(([, , , count]) => count > 0);
  if (!entries.length) return null;
  return h("section", { class: "card texts", "aria-labelledby": "texts-title" },
    h("h2", { id: "texts-title" }, t("practice.texts")),
    h("p", { class: "muted small" }, t("practice.texts_text")),
    h("div", { class: "stack-row" }, entries.map(([kind, label, plural, count]) => {
      const button = h("button", { type: "button", class: "btn btn-secondary", "data-action": `practice-${kind}` }, label,
        h("span", { class: "muted small" }, ` (${plural})`));
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const next = await ctx.app.nextPracticeText(kind);
          if (next) ctx.navigate(`#/aufgabe/${encodeURIComponent(next.exercise_id)}`);
        } finally {
          button.disabled = false;
        }
      });
      return button;
    })));
}

/** Gespräche über mehrere Runden (P11A). */
function conversationsSection(conversations) {
  return h("section", { class: "conversations", "aria-labelledby": "conv-list-title" },
    h("h2", { id: "conv-list-title" }, t("practice.conversations")),
    h("p", { class: "muted small" }, t("practice.conv_text")),
    h("ul", { class: "list" }, conversations.map((c) => h("li", {},
      h("a", { class: "list-item", href: `#/gespraech/${encodeURIComponent(c.id)}`, "data-scenario": c.id },
        h("span", { class: "list-main" }, h("strong", {}, c.title),
          h("span", { class: "muted small" }, `${c.goal_label} · ${c.level}${c.completed_count ? ` · ${t("practice.done_n", c.completed_count)}` : ""}`)),
        c.open_status ? h("span", { class: "badge badge-accent" }, c.open_status === "paused" ? t("practice.paused") : t("practice.running")) : null,
        icon("arrow", { size: 18 }))))));
}

export async function topicView(ctx, { topicId }) {
  const { topic, exercises } = ctx.app.practiceList(topicId);
  ctx.setTitle(topic.name);
  return h("div", { class: "page" },
    h("a", { class: "back", href: "#/ueben" }, icon("back", { size: 18 }), t("practice.all_topics")),
    h("header", { class: "page-head" }, h("h1", {}, topic.name), h("p", { class: "muted" }, t("common.exercises", exercises.length))),
    h("ul", { class: "list" }, exercises.map((ex) => h("li", {},
      h("a", { class: "list-item", href: `#/aufgabe/${encodeURIComponent(ex.id)}` },
        h("span", { class: "list-main" }, h("strong", {}, ex.title),
          h("span", { class: "muted small" }, `${ex.type_label} · ${ex.level} · ${t("c.about", minutesText(ex.estimated_seconds))}`)),
        ex.mode === "challenge" ? h("span", { class: "badge badge-accent" }, t("c.challenge")) : null,
        icon("arrow", { size: 18 }))))));
}

export async function exerciseView(ctx, { exerciseId }) {
  const exercise = ctx.app.practiceExercise(exerciseId);
  ctx.setTitle(exercise.type_label);
  const root = h("div", { class: "page practice-exercise" });
  const show = () => {
    // P15: Höraufgabe → Abspielen mit Hilfe-Leiter; überspringen/"nichts verstanden" ist keine falsche Antwort
    const player = exercise.listening ? listeningPlayer(exercise.listening, {
      allowSkip: true,
      onInteraction: (i) => ctx.app.recordListeningInteraction(exerciseId, i).catch((err) => console.error(err)),
      onNoAnswer: async (reason, state) => {
        await ctx.app.skipListening(exerciseId, { reason, ...state });
        const again = h("button", { type: "button", class: "btn btn-secondary btn-block" }, t("practice.try_again"));
        again.addEventListener("click", show);
        root.replaceChildren(back(), taskCard(exercise, { headingLevel: 1 }),
          h("section", { class: "card", "data-no-answer": reason }, h("p", {}, reason === "skip"
            ? t("practice.skipped")
            : t("practice.noted")), again));
      },
    }) : null;
    const form = answerForm(exercise, {
      speech: exercise.listening && exercise.type !== "listening_response" ? null : ctx.speech, // Whisper nur für die Antwort
      aiAnalysis: ctx.aiAnalysis,
      onSubmit: async (answerText, durationMs, { inputMode, signal }) => {
        player?.stop();
        const { feedback, ai } = await ctx.app.submitPractice(exerciseId, { answerText, durationMs, inputMode, signal, listening: player?.state() ?? null });
        const again = h("button", { type: "button", class: "btn btn-secondary btn-block" }, t("practice.again"));
        again.addEventListener("click", show);
        const panel = feedbackPanel(feedback, { answerText, ai });
        root.replaceChildren(back(), taskCard(exercise, { headingLevel: 1 }), panel,
          h("div", { class: "stack" }, again, h("a", { class: "btn btn-link", href: "#/lernen" }, t("practice.to_session"))));
        panel.querySelector("#feedback-title")?.focus();
      },
    });
    root.replaceChildren(...[back(), taskCard(exercise, { headingLevel: 1 }), player?.element, form].filter(Boolean));
  };
  const topic = exercise.topic_id;
  const back = () => h("a", { class: "back", href: topic ? `#/ueben/${encodeURIComponent(topic)}` : "#/ueben" },
    icon("back", { size: 18 }), t("practice.overview"));
  show();
  return root;
}
