/** Entwicklersicht (nur mit ?debug=1): Planung mit Prioritäten, Ereignisse, Gedächtnis. */

import { h } from "../dom.js";

export async function debugView(ctx) {
  ctx.setTitle("Entwicklersicht");
  const info = await ctx.app.debugInfo(10);
  const block = (title, value) => h("section", { class: "card" }, h("h2", {}, title), h("pre", { class: "code" }, JSON.stringify(value, null, 2)));
  const needs = h("section", { class: "card" }, h("h2", {}, `Lernbedarfe (${info.needs.length}, dringendste zuerst)`),
    h("ol", { class: "debug-needs" }, info.needs.map((n) => h("li", { "data-skill": n.skill_id },
      h("strong", {}, `${n.priority.toFixed(2)} · ${n.label}`),
      h("span", { class: "muted" }, ` – ${n.reason_code}, ${n.purpose}, Fehlerlage ${n.error_state}, Ziel ${n.target.evidence}`),
      h("p", { class: "muted small" }, n.factors.join(" · "), " | ", n.target.basis, " | ",
        `${n.evidence.failures} Fehler / ${n.evidence.attempts} Versuche`)))));
  return h("div", { class: "page debug" },
    h("header", { class: "page-head" }, h("h1", {}, "Entwicklersicht"),
      h("p", { class: "muted" }, "Learning Brain: Lernprofil, Lernbedarfe, Gedächtnis und die daraus geplante Session (10 Minuten). Nur für die Entwicklung.")),
    needs,
    block("SessionPlan (intern, mit Gründen)", info.plan),
    h("section", { class: "card" }, h("h2", {}, "Verlauf der letzten Lerntage"), h("pre", { class: "code" }, info.journey)),
    block(`Lernprofil: beobachtete Skills (${info.skills.length})`, info.skills),
    block("Bereiche", info.areas),
    block(`Lerngedächtnis (${info.memories.length})`, info.memories),
    block("Wiederholung", info.reviews),
    block("Daten", info.info));
}
