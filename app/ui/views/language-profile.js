/** Sprachprofil der aktiven Lernsprache (P11B): Bereiche mit Sicherheit, Stärken, Schwächen, Verlauf. */

import { h, icon } from "../dom.js";

export async function languageProfileView(ctx) {
  const p = await ctx.app.languageProfile();
  const language = ctx.languages.activeInfo();
  ctx.setTitle(`Sprachprofil ${language.name_de}`);
  const dateOf = (iso) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  return h("div", { class: "page language-profile" },
    h("header", { class: "page-head" },
      h("h1", {}, h("span", { "aria-hidden": "true" }, `${language.flag} `), `Sprachprofil ${language.name_de}`),
      h("p", { class: "muted" }, "Geschätzt aus allen deinen Übungen, Gesprächen, Sprachaufnahmen und Einstufungen in dieser Sprache.")),
    h("div", { class: "grid" },
      h("section", { class: "card hero", "aria-labelledby": "overall-title", "data-overall": p.overall.status },
        h("p", { class: "eyebrow" }, "Gesamteinschätzung"),
        h("h2", { id: "overall-title", class: "overall-level" }, p.overall.text),
        h("p", { class: "muted" }, p.overall.detail),
        p.overall.basis.length ? h("p", { class: "muted small" }, `Grundlage: ${p.overall.basis.join(", ")}`) : null,
        p.self_assessment ? h("p", { class: "muted small" }, `Deine Selbsteinschätzung: ${p.self_assessment} (fließt nicht in die Schätzung ein)`) : null,
        p.has_assessment_content
          ? h("a", { class: `btn ${p.reassessment_due ? "btn-primary" : "btn-secondary"}`, href: "#/einstufung", "data-action": "reassess" },
            p.last_assessment ? (p.reassessment_due ? "Neu einstufen (empfohlen)" : "Einstufung wiederholen") : "Einstufung starten")
          : null),
      h("section", { class: "card", "aria-labelledby": "dims-title" },
        h("h2", { id: "dims-title" }, "Bereiche"),
        h("dl", { class: "dimension-list" }, p.dimensions.map((d) => h("div", { class: `dimension ${d.status}`, "data-dimension": d.id },
          h("dt", {}, d.name_de),
          h("dd", {}, h("strong", {}, d.text), h("span", { class: "muted small" }, ` ${d.detail}`),
            d.measurements ? h("span", { class: "muted small evidence" }, ` · ${d.measurements} Nachweise (${d.from_assessment} Einstufung, ${d.from_practice} Übung)`) : null))))),
      p.strengths.length || p.weaknesses.length ? h("section", { class: "card", "aria-labelledby": "sw-title" },
        h("h2", { id: "sw-title" }, "Stärken und Schwächen"),
        p.strengths.length ? h("p", {}, icon("check", { size: 16 }), " Stärker: ", p.strengths.join(", ")) : null,
        p.weaknesses.length ? h("p", {}, icon("alert", { size: 16 }), " Daran arbeitet deine Planung gezielt: ", p.weaknesses.join(", ")) : null) : null,
      h("section", { class: "card", "aria-labelledby": "vocab-title" },
        h("h2", { id: "vocab-title" }, "Wortschatz"),
        h("p", {}, `${p.vocabulary.active_items} Ausdrücke aktiv genutzt, davon ${p.vocabulary.stable_items} sicher.`),
        h("p", { class: "muted small" }, p.vocabulary.size_note)),
      h("section", { class: "card", "aria-labelledby": "history-title" },
        h("h2", { id: "history-title" }, "Verlauf"),
        p.history.length
          ? h("ol", { class: "plain profile-history" }, p.history.map((e) => h("li", {}, h("span", { class: "muted" }, `${dateOf(e.at)}: `), h("strong", {}, e.text), ` (${e.detail})`)))
          : h("p", { class: "muted" }, "Noch keine Einstufung. Nach jeder Einstufung wird hier der Stand festgehalten."),
        p.last_assessment ? h("p", { class: "muted small" }, `Nächste Neubewertung: ${dateOf(p.next_reassessment.due_at)} (${p.next_reassessment.reason})`) : null),
      p.content_gaps.length ? h("p", { class: "muted small" }, `Noch nicht messbar: ${p.content_gaps.join(", ")}. Dafür fehlen noch Aufgaben im Sprachpaket.`) : null));
}
