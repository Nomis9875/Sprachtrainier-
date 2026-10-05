/**
 * Einstufung (P11B): Selbsteinschätzung → adaptive Aufgaben je Kompetenzbereich → Sprachprofil.
 *
 * Während der Einstufung gibt es keine Rückmeldung zu richtig/falsch (das würde die Messung verfälschen).
 * "Weiß ich nicht" ist ausdrücklich erlaubt und besser als Raten. Pausieren geht jederzeit.
 */

import { append, h, icon, meter, targetLang } from "../dom.js";
import { answerForm, confirmDialog, listeningPlayer } from "../components.js";
import { languageName, t } from "../../model/i18n.js";
import { CEFR_CHOICES, learningOutlook } from "../../model/language.js";

export async function assessmentView(ctx) {
  const page = await ctx.app.assessmentPage();
  ctx.setTitle(t("home.assessment"));
  const root = h("div", { class: "page assessment-page" });
  const render = (assessment, profile = page.profile) => {
    root.dataset.status = assessment?.status ?? "intro";
    if (!assessment) root.replaceChildren(introCard(ctx, page, render));
    else if (assessment.finished) root.replaceChildren(resultCard(ctx, assessment));
    else root.replaceChildren(header(ctx, assessment, render), assessment.paused ? pausedCard(ctx, assessment, render) : itemCard(ctx, assessment, render));
    void profile;
  };
  render(page.assessment);
  return root;
}

function introCard(ctx, page, render) {
  const language = ctx.languages.activeInfo();
  if (!page.available_modules.length) {
    return h("section", { class: "card" }, h("h1", {}, t("as.title", languageName(language.id))),
      h("p", {}, t("as.none")));
  }
  const selected = { level: page.profile.self_assessment };
  const chips = CEFR_CHOICES.map((level) => {
    const b = h("button", { type: "button", class: `chip level-chip${selected.level === level ? " selected" : ""}`, "data-level": level,
      "aria-pressed": String(selected.level === level) }, level);
    b.addEventListener("click", () => {
      selected.level = level;
      for (const other of chips) {
        other.classList.toggle("selected", other === b);
        other.setAttribute("aria-pressed", String(other === b));
      }
    });
    return b;
  });
  const start = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "start-assessment" }, icon("play", { size: 18 }), t("languages.assess"));
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  start.addEventListener("click", async () => {
    start.disabled = true;
    try {
      if (selected.level) await ctx.app.recordSelfAssessment(selected.level);
      render(await ctx.app.startAssessment());
    } catch (err) {
      error.textContent = err?.userMessage ?? t("as.start_failed");
      error.hidden = false;
      start.disabled = false;
    }
  });
  const gaps = page.profile.content_gaps;
  return h("section", { class: "card assessment-intro", "aria-labelledby": "assess-title" },
    h("h1", { id: "assess-title" }, h("span", { "aria-hidden": "true" }, `${language.flag} `), t("as.title", languageName(language.id))),
    h("p", { class: "lead" }, t("as.reassure")),
    h("p", {}, t("as.self_q")),
    h("div", { class: "chips level-chips", role: "group", "aria-label": t("as.self") }, chips),
    h("p", { class: "muted small" }, t("as.intro", page.available_modules.map((m) => ctx.labels.dimension(m)).join(", "))),
    gaps.length ? h("p", { class: "muted small" }, t("as.gaps", gaps.join(", "))) : null,
    start, error);
}

function header(ctx, assessment, render) {
  const pause = h("button", { type: "button", class: "btn btn-ghost", "data-action": "pause-assessment" }, icon("pause"), h("span", { class: "hide-narrow" }, t("as.pause")));
  pause.addEventListener("click", async () => render(await ctx.app.pauseAssessment(assessment.assessment_id)));
  const end = h("button", { type: "button", class: "btn btn-ghost", "data-action": "abandon-assessment" }, icon("close"), h("span", { class: "hide-narrow" }, t("common.cancel")));
  end.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: t("as.abandon_q"), text: t("as.abandon_text"),
      confirmLabel: t("common.cancel"), cancelLabel: t("as.keep"), danger: true });
    if (ok) render(await ctx.app.abandonAssessment(assessment.assessment_id));
  });
  return h("header", { class: "conversation-head" },
    h("div", {}, h("h1", { class: "conversation-title" }, t("home.assessment")),
      h("span", { class: "muted small", "aria-live": "polite", "data-assessment-progress": "" },
        t("as.module_of", Math.min(assessment.progress.done + 1, assessment.progress.total), assessment.progress.total),
        assessment.current?.dimension_name ? ` · ${assessment.current.dimension_name}` : "")),
    h("div", { class: "conversation-actions" }, assessment.paused ? null : pause, end),
    meter(assessment.progress.total ? assessment.progress.done / assessment.progress.total : 0, t("as.progress")));
}

function itemCard(ctx, assessment, render) {
  const item = assessment.current;
  if (!item) return h("p", {}, t("as.evaluating"));
  const card = h("section", { class: "card assessment-item", "aria-labelledby": "item-title", "data-item": item.item_id, "data-dimension": item.dimension });
  let busy = false;
  const submit = async (answerText, extra = {}) => {
    if (busy) return;
    busy = true;
    card.setAttribute("aria-busy", "true");
    try {
      render(await ctx.app.respondAssessment(assessment.assessment_id, { itemId: item.item_id, answerText, ...extra }));
    } finally {
      busy = false;
    }
  };
  const skip = h("button", { type: "button", class: "btn btn-link", "data-action": "dont-know" }, t("as.dont_know"));
  skip.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    render(await ctx.app.skipAssessmentItem(assessment.assessment_id, item.item_id));
  });
  let body;
  if (item.format === "choice") {
    body = h("div", { class: "choice-list", role: "group", "aria-labelledby": "item-title" }, item.options.map((option) => {
      const b = h("button", { type: "button", class: "btn btn-secondary btn-block choice", "data-option": option, lang: targetLang() }, option);
      b.addEventListener("click", () => submit(option));
      return b;
    }));
  } else {
    body = answerForm(item.exercise, {
      speech: ctx.speech,
      submitLabel: t("as.continue"),
      busyLabel: t("as.evaluating"),
      onSubmit: async (answerText, durationMs, { inputMode }) => submit(answerText, { inputMode, durationMs }),
    });
    if (item.dimension === "conversation") {
      const skipModule = h("button", { type: "button", class: "btn btn-link", "data-action": "skip-module" }, t("as.skip_module"));
      skipModule.addEventListener("click", async () => render(await ctx.app.skipAssessmentModule(assessment.assessment_id, item.dimension, "no_microphone")));
      body = h("div", {}, body, skipModule);
    }
  }
  append(card, [
    h("p", { class: "eyebrow" }, item.dimension_name),
    h("h2", { id: "item-title", class: "task-prompt" }, item.prompt_de),
    item.passage_es ? h("blockquote", { class: "task-es passage", lang: targetLang() }, item.passage_es) : null,
    item.partner_role_de ? h("p", { class: "muted small" }, item.partner_role_de) : null,
    item.listening ? listeningPlayer(item.listening).element : null,
    h("p", { class: `task-source${item.format === "open" ? " bubble partner" : ""}`, lang: targetLang() }, item.stimulus_es),
    body,
    item.format === "choice" ? skip : null]);
  return card;
}

function pausedCard(ctx, assessment, render) {
  const resume = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "resume-assessment" }, t("home.resume"));
  resume.addEventListener("click", async () => render(await ctx.app.resumeAssessment(assessment.assessment_id)));
  return h("section", { class: "card paused", "aria-labelledby": "assess-paused" },
    h("h2", { id: "assess-paused" }, t("home.paused")),
    h("p", {}, t("as.paused_text")), resume);
}

function resultCard(ctx, assessment) {
  const r = assessment.result;
  // P22: Das Ergebnis zeigt das Sprachprofil (danach plant die App), damit Ergebnis und Profil nicht voneinander
  // abweichen; die eigenen Werte der Einstufung bleiben der Rückfall, falls das Profil nicht lädt.
  const body = h("div", { "aria-live": "polite" }, h("p", { class: "muted" }, t("as.evaluating")));
  ctx.app.languageProfile()
    .then((p) => body.replaceChildren(...placementOutcome(ctx, p).flat()))
    .catch((error) => {
      console.error(error);
      body.replaceChildren(
        h("p", { class: "result-level" }, h("strong", {}, r.estimated.text), h("span", { class: "muted" }, ` · ${r.estimated.detail}`)),
        h("ul", { class: "plain" }, r.modules.map((m) => h("li", {}, `${m.name_de}: `, h("strong", {}, m.text), h("span", { class: "muted small" }, ` (${m.detail})`)))));
    });
  return h("section", { class: "card assessment-result", "aria-labelledby": "assess-result" },
    h("h2", { id: "assess-result", tabindex: "-1" }, assessment.status === "abandoned" ? t("as.abandoned") : t("as.done")),
    body,
    h("p", { class: "muted small" }, t("as.disclaimer")),
    h("div", { class: "stack" },
      h("a", { class: "btn btn-primary btn-block", href: "#/", "data-action": "start-learning" }, t("home.start")),
      h("a", { class: "btn btn-secondary btn-block", href: "#/sprachprofil", "data-action": "open-profile" }, t("progress.to_profile"))));
}

/** Wo stehe ich? Was als Nächstes? (aus dem Sprachprofil) */
function placementOutcome(ctx, p) {
  const outlook = learningOutlook(p, ctx.app.explanationLanguage);
  return [
    h("p", { class: "eyebrow" }, t("as.where")),
    h("p", { class: "result-level" }, h("span", { class: "level-badge level-lg" }, p.overall.text),
      p.overall.status === "estimated" && p.overall.confidence === "low" ? h("span", { class: "muted" }, ` ${t("claim.provisional")}`) : null),
    p.overall.status === "estimated" ? h("p", { class: "lead" }, t("as.start_here", p.overall.text)) : null,
    h("ul", { class: "plain result-dimensions" }, p.dimensions.filter((d) => !d.content_gap).map((d) => h("li", { "data-dimension": d.id, "data-status": d.status },
      `${d.name_de}: `,
      d.status === "unknown" || d.status === "insufficient"
        ? h("span", { class: "muted" }, t("as.not_measured"))
        : [h("span", { class: "level-badge level-sm" }, d.text), d.short ? h("span", { class: "muted small" }, ` ${d.short}`) : null]))),
    h("p", { class: "eyebrow" }, t("as.next")),
    outlook.lines.map((line) => h("p", { class: "outlook" }, line))];
}
