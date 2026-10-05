/** Üben: Gespräche und Themen → Übungen → eine Übung (außerhalb einer Session, als Versuch gespeichert). */

import { minutesText } from "../../model/labels.js";
import { h, icon } from "../dom.js";
import { t } from "../../model/i18n.js";
import { answerForm, emptyState, feedbackPanel, listeningPlayer, taskCard } from "../components.js";

/** Sichtbare Unterthemen je Thema; der Rest ist aufklappbar (lange Listen überfordern auf dem Handy). */
const VISIBLE_SUBTOPICS = 6;
/** So viele Gespräche stehen direkt da (die zur eigenen Stufe passendsten zuerst); der Rest ist aufklappbar. */
const VISIBLE_CONVERSATIONS = 4;
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * P25.7: Üben mit drei klaren Einstiegen (Hören und Lesen, Sprechen, nach Thema); oben die Sprungmarken, darunter die
 * Bereiche in dieser Reihenfolge. Nur Darstellung: Inhalt und Reihenfolge im Inhaltspaket bleiben unverändert.
 */
export async function practiceView(ctx) {
  ctx.setTitle(t("nav.practice"));
  const topics = ctx.app.practiceTopics();
  const [conversations, profile] = await Promise.all([ctx.app.conversationList(), ctx.app.languageProfile()]);
  const texts = textsSection(ctx);
  const jump = (target, iconName, label) => {
    const button = h("button", { type: "button", class: "tile", "data-jump": target },
      h("span", { class: "tile-icon", "aria-hidden": "true" }, icon(iconName, { size: 20 })), h("span", {}, label));
    button.addEventListener("click", () => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(target)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    return button;
  };
  return h("div", { class: "page practice" },
    h("header", { class: "page-head" }, h("h1", {}, t("nav.practice")),
      h("p", { class: "muted" }, t("practice.lead"))),
    h("nav", { class: "tiles practice-jump", "aria-label": t("nav.practice") },
      texts ? jump("texts-title", "headphones", t("practice.jump_texts")) : null,
      conversations.length ? jump("conv-list-title", "chat", t("practice.jump_speak")) : null,
      topics.length ? jump("topics-title", "pencil", t("practice.jump_topics")) : null),
    texts,
    conversations.length ? conversationsSection(sortByLevel(conversations, profile?.overall)) : null,
    topics.length
      ? h("section", { class: "topics", "aria-labelledby": "topics-title" },
        h("h2", { id: "topics-title" }, t("practice.topics")),
        h("div", { class: "grid" }, topics.map((topic) => topicCard(topic))))
      : emptyState({ title: t("practice.none"), text: t("practice.none_text") }));
}

function topicCard(topic) {
  const chip = (s) => h("li", {}, h("a", { class: "chip", href: `#/ueben/${encodeURIComponent(s.id)}` }, s.name, h("span", { class: "chip-count" }, String(s.count))));
  const shown = topic.subtopics.slice(0, VISIBLE_SUBTOPICS);
  const rest = topic.subtopics.slice(VISIBLE_SUBTOPICS);
  return h("section", { class: "card topic", "aria-labelledby": `t-${topic.id}` },
    h("h3", { id: `t-${topic.id}` }, h("a", { href: `#/ueben/${encodeURIComponent(topic.id)}` }, topic.name)),
    h("p", { class: "muted small" }, t("common.exercises", topic.count)),
    shown.length ? h("ul", { class: "chips" }, shown.map(chip)) : null,
    rest.length ? h("details", { class: "more" }, h("summary", {}, t("practice.more_topics", rest.length)), h("ul", { class: "chips" }, rest.map(chip))) : null);
}

/** Gespräche nach Nähe zur eigenen Gesamtstufe (ohne Schätzung: aufsteigend nach Stufe). Nur die Anzeige. */
function sortByLevel(conversations, overall) {
  const own = overall?.status === "estimated" ? CEFR.indexOf(String(overall.text ?? "").match(/[ABC][12]/)?.[0]) : -1;
  const distance = (c) => (own >= 0 ? Math.abs(CEFR.indexOf(c.level) - own) : CEFR.indexOf(c.level));
  return [...conversations].sort((a, b) => Number(Boolean(b.open_status)) - Number(Boolean(a.open_status)) || distance(a) - distance(b)
    || CEFR.indexOf(a.level) - CEFR.indexOf(b.level));
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
  const item = (c) => h("li", {},
    h("a", { class: "list-item", href: `#/gespraech/${encodeURIComponent(c.id)}`, "data-scenario": c.id },
      h("span", { class: "list-main" }, h("strong", {}, c.title),
        h("span", { class: "muted small" }, `${c.goal_label} · ${c.level}${c.completed_count ? ` · ${t("practice.done_n", c.completed_count)}` : ""}`)),
      c.open_status ? h("span", { class: "badge badge-accent" }, c.open_status === "paused" ? t("practice.paused") : t("practice.running")) : null,
      icon("arrow", { size: 18 })));
  const rest = conversations.slice(VISIBLE_CONVERSATIONS);
  return h("section", { class: "conversations", "aria-labelledby": "conv-list-title" },
    h("h2", { id: "conv-list-title" }, t("practice.conversations")),
    h("p", { class: "muted small" }, t("practice.conv_text")),
    h("ul", { class: "list" }, conversations.slice(0, VISIBLE_CONVERSATIONS).map(item)),
    rest.length ? h("details", { class: "more" }, h("summary", {}, t("practice.all_conversations", conversations.length)),
      h("ul", { class: "list" }, rest.map(item))) : null);
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
