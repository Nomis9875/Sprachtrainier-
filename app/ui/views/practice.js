/** Üben: Gespräche und Themen → Übungen → eine Übung (außerhalb einer Session, als Versuch gespeichert). */

import { minutesText, plural } from "../../model/labels.js";
import { h, icon } from "../dom.js";
import { answerForm, emptyState, feedbackPanel, listeningPlayer, taskCard } from "../components.js";

export async function practiceView(ctx) {
  ctx.setTitle("Üben");
  const topics = ctx.app.practiceTopics();
  const conversations = await ctx.app.conversationList();
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, "Üben"),
      h("p", { class: "muted" }, "Einzelne Übungen nach Thema. Für den besten Lerneffekt plant „Lernen“ die Mischung für dich.")),
    conversations.length ? conversationsSection(conversations) : null,
    textsSection(ctx),
    topics.length
      ? h("div", { class: "grid" }, topics.map((topic) => h("section", { class: "card topic", "aria-labelledby": `t-${topic.id}` },
        h("h2", { id: `t-${topic.id}` }, h("a", { href: `#/ueben/${encodeURIComponent(topic.id)}` }, topic.name)),
        h("p", { class: "muted small" }, plural(topic.count, "Übung", "Übungen")),
        topic.subtopics.length ? h("ul", { class: "chips" }, topic.subtopics.map((s) =>
          h("li", {}, h("a", { class: "chip", href: `#/ueben/${encodeURIComponent(s.id)}` }, s.name, h("span", { class: "chip-count" }, String(s.count)))))) : null)))
      : emptyState({ title: "Noch keine Übungen", text: "Das Inhaltspaket enthält keine Übungen." }));
}

/** P24: Hören und Lesen: der nächste passende, noch nicht geübte Text mit einem Tipp (statt langer Listen). */
function textsSection(ctx) {
  const counts = ctx.app.practiceTextCounts();
  const entries = [["listening", "Hörtext üben", "Hörtexte", counts.listening], ["reading", "Lesetext üben", "Lesetexte", counts.reading]]
    .filter(([, , , count]) => count > 0);
  if (!entries.length) return null;
  return h("section", { class: "card texts", "aria-labelledby": "texts-title" },
    h("h2", { id: "texts-title" }, "Hören und Lesen"),
    h("p", { class: "muted small" }, "Der nächste Text auf deinem Niveau, den du noch nicht geübt hast. Hören kommt in den Sessions nur dosiert vor; hier übst du es gezielt."),
    h("div", { class: "stack-row" }, entries.map(([kind, label, plural, count]) => {
      const button = h("button", { type: "button", class: "btn btn-secondary", "data-action": `practice-${kind}` }, label,
        h("span", { class: "muted small" }, ` (${count} ${plural})`));
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
    h("h2", { id: "conv-list-title" }, "Gespräche"),
    h("p", { class: "muted small" }, "Ein echtes Gespräch über mehrere Runden, das auf deine Antworten eingeht – am besten gesprochen."),
    h("ul", { class: "list" }, conversations.map((c) => h("li", {},
      h("a", { class: "list-item", href: `#/gespraech/${encodeURIComponent(c.id)}`, "data-scenario": c.id },
        h("span", { class: "list-main" }, h("strong", {}, c.title),
          h("span", { class: "muted small" }, `${c.goal_label} · ${c.level}${c.completed_count ? ` · ${c.completed_count}× geführt` : ""}`)),
        c.open_status ? h("span", { class: "badge badge-accent" }, c.open_status === "paused" ? "pausiert" : "läuft") : null,
        icon("arrow", { size: 18 }))))));
}

export async function topicView(ctx, { topicId }) {
  const { topic, exercises } = ctx.app.practiceList(topicId);
  ctx.setTitle(topic.name);
  return h("div", { class: "page" },
    h("a", { class: "back", href: "#/ueben" }, icon("back", { size: 18 }), "Alle Themen"),
    h("header", { class: "page-head" }, h("h1", {}, topic.name), h("p", { class: "muted" }, plural(exercises.length, "Übung", "Übungen"))),
    h("ul", { class: "list" }, exercises.map((ex) => h("li", {},
      h("a", { class: "list-item", href: `#/aufgabe/${encodeURIComponent(ex.id)}` },
        h("span", { class: "list-main" }, h("strong", {}, ex.title),
          h("span", { class: "muted small" }, `${ex.type_label} · ${ex.level} · ca. ${minutesText(ex.estimated_seconds)}`)),
        ex.mode === "challenge" ? h("span", { class: "badge badge-accent" }, "Challenge") : null,
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
        const again = h("button", { type: "button", class: "btn btn-secondary btn-block" }, "Noch einmal versuchen");
        again.addEventListener("click", show);
        root.replaceChildren(back(), taskCard(exercise, { headingLevel: 1 }),
          h("section", { class: "card", "data-no-answer": reason }, h("p", {}, reason === "skip"
            ? "Übersprungen. Das zählt nicht als Fehler."
            : "Notiert: Das war heute noch schwer zu verstehen. Das zählt nicht als Fehler; wir üben es behutsamer."), again));
      },
    }) : null;
    const form = answerForm(exercise, {
      speech: exercise.listening && exercise.type !== "listening_response" ? null : ctx.speech, // Whisper nur für die Antwort
      aiAnalysis: ctx.aiAnalysis,
      onSubmit: async (answerText, durationMs, { inputMode, signal }) => {
        player?.stop();
        const { feedback, ai } = await ctx.app.submitPractice(exerciseId, { answerText, durationMs, inputMode, signal, listening: player?.state() ?? null });
        const again = h("button", { type: "button", class: "btn btn-secondary btn-block" }, "Noch einmal");
        again.addEventListener("click", show);
        const panel = feedbackPanel(feedback, { answerText, ai });
        root.replaceChildren(back(), taskCard(exercise, { headingLevel: 1 }), panel,
          h("div", { class: "stack" }, again, h("a", { class: "btn btn-link", href: "#/lernen" }, "Zur geplanten Session")));
        panel.querySelector("#feedback-title")?.focus();
      },
    });
    root.replaceChildren(...[back(), taskCard(exercise, { headingLevel: 1 }), player?.element, form].filter(Boolean));
  };
  const topic = exercise.topic_id;
  const back = () => h("a", { class: "back", href: topic ? `#/ueben/${encodeURIComponent(topic)}` : "#/ueben" },
    icon("back", { size: 18 }), "Zur Übersicht");
  show();
  return root;
}
