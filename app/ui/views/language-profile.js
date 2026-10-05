/** Sprachprofil der aktiven Lernsprache (P11B): Bereiche mit Sicherheit, Stärken, Schwächen, Verlauf. */

import { h, icon } from "../dom.js";
import { languageName, t, uiLanguage } from "../../model/i18n.js";

export async function languageProfileView(ctx) {
  const p = await ctx.app.languageProfile();
  const language = ctx.languages.activeInfo();
  ctx.setTitle(t("lp.title", languageName(language.id)));
  const dateOf = (iso) => new Date(iso).toLocaleDateString(t("locale"), { day: "numeric", month: "long", year: "numeric" });
  return h("div", { class: "page language-profile" },
    h("header", { class: "page-head" },
      h("h1", {}, h("span", { "aria-hidden": "true" }, `${language.flag} `), t("lp.title", languageName(language.id))),
      h("p", { class: "muted" }, t("lp.lead"))),
    h("div", { class: "grid" },
      h("section", { class: "card hero", "aria-labelledby": "overall-title", "data-overall": p.overall.status },
        h("p", { class: "eyebrow" }, t("lp.overall")),
        h("h2", { id: "overall-title", class: "overall-level level-badge level-lg" }, p.overall.text),
        h("p", { class: "muted" }, p.overall.detail),
        p.overall.basis.length ? h("p", { class: "muted small" }, t("lp.basis", p.overall.basis.join(", "))) : null,
        p.self_assessment ? h("p", { class: "muted small" }, t("lp.self", p.self_assessment)) : null,
        p.has_assessment_content
          ? h("a", { class: `btn ${p.reassessment_due ? "btn-primary" : "btn-secondary"}`, href: "#/einstufung", "data-action": "reassess" },
            p.last_assessment ? (p.reassessment_due ? t("home.assess_again") : t("languages.reassess")) : t("languages.assess"))
          : null),
      h("section", { class: "card", "aria-labelledby": "dims-title" },
        h("h2", { id: "dims-title" }, t("lp.dimensions")),
        h("dl", { class: "dimension-list" }, p.dimensions.map((d) => h("div", { class: `dimension ${d.status}`, "data-dimension": d.id },
          h("dt", {}, d.name_de),
          h("dd", {}, h("span", { class: "level-badge level-sm" }, d.text), h("span", { class: "muted small" }, ` ${d.detail}`),
            d.measurements ? h("span", { class: "muted small evidence" }, t("lp.evidence", d.measurements, d.from_assessment, d.from_practice)) : null))))),
      p.strengths.length || p.weaknesses.length ? h("section", { class: "card", "aria-labelledby": "sw-title" },
        h("h2", { id: "sw-title" }, t("lp.sw")),
        p.strengths.length ? h("p", {}, icon("check", { size: 16 }), t("lp.stronger"), p.strengths.join(", ")) : null,
        p.weaknesses.length ? h("p", {}, icon("alert", { size: 16 }), t("lp.working"), p.weaknesses.join(", ")) : null) : null,
      h("section", { class: "card", "aria-labelledby": "vocab-title" },
        h("h2", { id: "vocab-title" }, t("lp.vocabulary")),
        h("p", {}, t("lp.vocab_active", p.vocabulary.active_items, p.vocabulary.stable_items)),
        h("p", { class: "muted small" }, t("lp.size_note"))),
      h("section", { class: "card", "aria-labelledby": "history-title" },
        h("h2", { id: "history-title" }, t("lp.history")),
        p.history.length
          ? h("ol", { class: "plain profile-history" }, p.history.map((e) => h("li", {}, h("span", { class: "muted" }, `${dateOf(e.at)}: `), h("strong", {}, e.text), ` (${e.detail})`)))
          : h("p", { class: "muted" }, t("lp.history_empty")),
        p.last_assessment ? h("p", { class: "muted small" }, t("lp.next", dateOf(p.next_reassessment.due_at), reassessReason(p.next_reassessment))) : null),
      p.content_gaps.length ? h("p", { class: "muted small" }, t("lp.gaps", p.content_gaps.join(", "))) : null));
}

/** Grund der nächsten Neubewertung: Deutsch wie vom Kern formuliert, Spanisch aus den Kennungen (triggers). */
function reassessReason(next) {
  if (uiLanguage() === "de") return next.reason;
  const days = next.reason.match(/nach (\d+) Tagen/)?.[1];
  const parts = (next.triggers.length ? next.triggers : ["time"]).map((trigger) => (trigger === "time" ? t("lp.trigger_time", days)
    : trigger === "new_events" ? t("lp.trigger_events", next.attempts_since)
      : trigger === "competence_shift" ? t("lp.trigger_shift", next.shift) : t("lp.trigger_none")));
  return parts.join("; ");
}
