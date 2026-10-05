/** Fortschritt: Bereiche, Produktionsstufen, Fehlerprofil, Stärken, Schwerpunkte, Wiederholung. */

import { h, meter } from "../dom.js";
import { t } from "../../model/i18n.js";
import { emptyState } from "../components.js";

export async function progressView(ctx) {
  ctx.setTitle(t("nav.progress"));
  const p = await ctx.app.progress();
  if (!p.has_history) {
    return h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", {}, t("nav.progress"))),
      emptyState({
        title: t("home.no_history"),
        text: t("progress.empty_text"),
        action: h("a", { class: "btn btn-primary", href: "#/lernen" }, t("progress.first")),
      }));
  }
  const lp = await ctx.app.languageProfile();
  const listening = await ctx.app.listeningOverview();
  const dateOf = (iso) => new Date(iso).toLocaleDateString(t("locale"), { day: "numeric", month: "short", year: "numeric" });
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, t("nav.progress")), h("p", { class: "muted" }, p.headline)),
    h("div", { class: "grid" },
      // P12: Niveau je Kompetenzbereich (mit Sicherheit, nie genauer als die Daten) und Entwicklung über die Zeit
      h("section", { class: "card", "aria-labelledby": "levels-title", "data-card": "levels" },
        h("h2", { id: "levels-title" }, t("progress.levels")),
        h("dl", { class: "dimension-list" }, lp.dimensions.map((d) => h("div", { class: `dimension ${d.status}`, "data-dimension": d.id },
          h("dt", {}, d.name_de), h("dd", {}, h("span", { class: "level-badge level-sm" }, d.text), d.short ? h("span", { class: "muted small" }, ` ${d.short}`) : null)))),
        lp.history.length
          ? h("div", {}, h("h3", { class: "h3" }, t("progress.history")),
            h("ol", { class: "plain profile-history" }, lp.history.map((e) => h("li", {}, h("span", { class: "muted" }, `${dateOf(e.at)}: `), h("strong", {}, e.text)))))
          : h("p", { class: "muted small" }, t("progress.history_empty")),
        h("a", { class: "btn btn-link", href: "#/sprachprofil" }, t("progress.to_profile"))),
      // P15: Hören als eigene Evidenz, in Worten (nie als Punktzahl oder GER-Stufe)
      h("section", { class: "card", "aria-labelledby": "listening-title", "data-card": "listening", "data-state": listening.state },
        h("h2", { id: "listening-title" }, t("progress.listening")),
        h("p", {}, h("strong", {}, listening.text)),
        listening.measures.length ? h("ul", { class: "plain" }, listening.measures.map((m) => h("li", { "data-measure": m.measure },
          h("span", {}, `${m.label}: `), h("span", { class: "muted" }, m.text)))) : null,
        listening.weak.length ? h("ul", { class: "plain" }, listening.weak.map((w) => h("li", {}, h("strong", {}, w.title), h("span", { class: "muted small" }, ` – ${w.text}`)))) : null,
        listening.known_not_verified.length ? h("p", { class: "muted small", "data-known-not-verified": String(listening.known_not_verified.length) },
          `${t("progress.not_heard")}${listening.known_not_verified.slice(0, 4).join(" · ")}${listening.known_not_verified.length > 4 ? " …" : ""}`) : null,
        listening.avoidance ? h("p", { class: "muted small" }, listening.avoidance) : null,
        h("p", { class: "muted small" }, listening.note)),
      levelCard(p),
      h("section", { class: "card", "aria-labelledby": "patterns-title" },
        h("h2", { id: "patterns-title" }, t("progress.patterns")),
        p.patterns.length
          ? h("ol", { class: "patterns" }, p.patterns.map((m) => h("li", { "data-kind": m.kind },
            h("strong", {}, m.title),
            h("span", { class: `badge kind-${m.kind}` }, m.kind_label),
            m.status !== "active" ? h("span", { class: "muted small" }, ` · ${m.status_label}`) : null,
            h("p", { class: "muted small" }, m.text))))
          : h("p", { class: "muted" }, p.patterns_note ?? t("progress.not_enough")),
        p.overcome.length ? h("div", { class: "overcome" }, h("h3", { class: "h3" }, t("progress.overcome")),
          h("ul", { class: "plain" }, p.overcome.map((item) => h("li", {}, item)))) : null),
      h("section", { class: "card", "aria-labelledby": "focus-title" },
        h("h2", { id: "focus-title" }, t("progress.focus")),
        p.focus.length
          ? h("ul", { class: "plain focus" }, p.focus.map((f) => h("li", {}, h("strong", {}, f.title),
            f.skills.length ? h("p", { class: "muted small" }, f.skills.join(" · "), f.more ? t("progress.more", f.more) : "") : null)))
          : h("p", { class: "muted" }, t("progress.no_focus"))),
      h("section", { class: "card", "aria-labelledby": "strengths-title" },
        h("h2", { id: "strengths-title" }, t("progress.strengths")),
        p.strengths.length
          ? h("ul", { class: "plain" }, p.strengths.map((s) => h("li", {}, h("strong", {}, s.title), h("span", { class: "muted" }, ` – ${s.text}`))))
          : h("p", { class: "muted" }, p.strengths_note ?? t("progress.strengths_empty"))),
      h("section", { class: "card", "aria-labelledby": "stats-title" },
        h("h2", { id: "stats-title" }, t("progress.overview")),
        h("dl", { class: "stats" },
          stat(t("progress.days"), p.activity.learning_days),
          stat(t("session.exercises"), p.activity.attempts),
          stat(t("progress.sessions"), p.activity.sessions_completed),
          stat(t("progress.streak"), t("progress.streak_value", p.activity.streak, p.activity.longest_streak)),
          stat(t("progress.due"), p.reviews.due),
          stat(t("progress.mastered"), p.reviews.mastered)))));
}

/**
 * P25.4: Stufe und Weg zur nächsten: je Bereich, was von der aktuellen Stufe schon sicher sitzt (nie Prozent über
 * den ganzen Katalog); darunter freies und spontanes Anwenden. Ohne Gesamtschätzung: sicher/insgesamt je Bereich.
 */
function levelCard(p) {
  const lv = p.level;
  const rows = lv ? lv.areas : p.areas.filter((a) => a.total).map((a) => ({ ...a, value: a.total ? a.secure / a.total : 0,
    text: t("lvl.secure", a.secure, a.total), detail: t("lvl.detail", a.secure, a.started) }));
  const production = p.production.map((a) => ({ ...a, text: a.detail, detail: null }));
  return h("section", { class: "card level-card", "aria-labelledby": "areas-title", "data-card": "level-progress" },
    h("div", { class: "card-head" },
      h("h2", { id: "areas-title" }, lv ? t("lvl.title", lv.label) : t("progress.competence"))),
    lv ? h("p", { class: "level-next" }, lv.next
      ? [h("strong", {}, t("lvl.next", lv.label, lv.next)), lv.next_total ? h("span", { class: "muted small" }, ` · ${t("lvl.next_areas", lv.next_reached, lv.next_total, lv.next)}`) : null]
      : h("strong", {}, t("lvl.top"))) : null,
    lv && rows.length ? h("p", { class: "muted small" }, t("lvl.intro", lv.level)) : null,
    h("ul", { class: "meters" }, rows.map((a) => h("li", { "data-area": a.key },
      h("div", { class: "meter-head" }, h("span", {}, lv ? `${a.label} ${lv.level}` : a.label), h("strong", { class: "small" }, a.text)),
      meter(a.value, a.label),
      h("p", { class: "muted small" }, a.detail)))),
    production.length ? h("div", {}, h("h3", { class: "h3" }, t("lvl.use")),
      h("ul", { class: "meters" }, production.map((a) => h("li", { "data-area": a.key },
        h("div", { class: "meter-head" }, h("span", {}, a.label)),
        meter(a.value, a.label),
        h("p", { class: "muted small" }, a.text))))) : h("p", { class: "muted small" }, t("progress.production_empty")));
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, String(value)));
}
