/** Fortschritt: Bereiche, Produktionsstufen, Fehlerprofil, Stärken, Schwerpunkte, Wiederholung. */

import { h, meter } from "../dom.js";
import { emptyState } from "../components.js";

export async function progressView(ctx) {
  ctx.setTitle("Fortschritt");
  const p = await ctx.app.progress();
  if (!p.has_history) {
    return h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", {}, "Fortschritt")),
      emptyState({
        title: "Noch keine Lernhistorie",
        text: "Sobald du Übungen machst, siehst du hier, was sitzt, wo es hakt und welche Muster sich zeigen.",
        action: h("a", { class: "btn btn-primary", href: "#/lernen" }, "Erste Session starten"),
      }));
  }
  const lp = await ctx.app.languageProfile();
  const listening = await ctx.app.listeningOverview();
  const dateOf = (iso) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, "Fortschritt"), h("p", { class: "muted" }, p.headline)),
    h("div", { class: "grid" },
      // P12: Niveau je Kompetenzbereich (mit Sicherheit, nie genauer als die Daten) und Entwicklung über die Zeit
      h("section", { class: "card", "aria-labelledby": "levels-title", "data-card": "levels" },
        h("h2", { id: "levels-title" }, "Niveau je Bereich"),
        h("dl", { class: "dimension-list" }, lp.dimensions.map((d) => h("div", { class: `dimension ${d.status}`, "data-dimension": d.id },
          h("dt", {}, d.name_de), h("dd", {}, h("strong", {}, d.text), h("span", { class: "muted small" }, ` ${d.detail}`))))),
        lp.history.length
          ? h("div", {}, h("h3", { class: "h3" }, "Entwicklung"),
            h("ol", { class: "plain profile-history" }, lp.history.map((e) => h("li", {}, h("span", { class: "muted" }, `${dateOf(e.at)}: `), h("strong", {}, e.text)))))
          : h("p", { class: "muted small" }, "Die Entwicklung erscheint nach der ersten Einstufung."),
        h("a", { class: "btn btn-link", href: "#/sprachprofil" }, "Zum Sprachprofil")),
      // P15: Hören als eigene Evidenz, in Worten (nie als Punktzahl oder GER-Stufe)
      h("section", { class: "card", "aria-labelledby": "listening-title", "data-card": "listening", "data-state": listening.state },
        h("h2", { id: "listening-title" }, "🎧 Hören"),
        h("p", {}, h("strong", {}, listening.text)),
        listening.measures.length ? h("ul", { class: "plain" }, listening.measures.map((m) => h("li", { "data-measure": m.measure },
          h("span", {}, `${m.label}: `), h("span", { class: "muted" }, m.text)))) : null,
        listening.weak.length ? h("ul", { class: "plain" }, listening.weak.map((w) => h("li", {}, h("strong", {}, w.title), h("span", { class: "muted small" }, ` – ${w.text}`)))) : null,
        listening.known_not_verified.length ? h("p", { class: "muted small", "data-known-not-verified": String(listening.known_not_verified.length) },
          `Schriftlich sicher, beim Hören noch nicht geprüft: ${listening.known_not_verified.slice(0, 4).join(" · ")}${listening.known_not_verified.length > 4 ? " …" : ""}`) : null,
        listening.avoidance ? h("p", { class: "muted small" }, listening.avoidance) : null,
        h("p", { class: "muted small" }, listening.note)),
      h("section", { class: "card", "aria-labelledby": "areas-title" },
        h("h2", { id: "areas-title" }, "Kompetenz"),
        h("ul", { class: "meters" }, [...p.areas, ...p.production].map((a) => h("li", { "data-area": a.key },
          h("div", { class: "meter-head" }, h("span", {}, a.label), h("span", { class: "muted small" }, `${Math.round(a.value * 100)} %`)),
          meter(a.value, a.label),
          h("p", { class: "muted small" }, a.detail)))),
        p.production.length ? null : h("p", { class: "muted small" }, "Freie und spontane Produktion erscheinen, sobald du Strukturen oder Ausdrücke geübt hast.")),
      h("section", { class: "card", "aria-labelledby": "patterns-title" },
        h("h2", { id: "patterns-title" }, "Deine häufigsten Muster"),
        p.patterns.length
          ? h("ol", { class: "patterns" }, p.patterns.map((m) => h("li", { "data-kind": m.kind },
            h("strong", {}, m.title),
            h("span", { class: `badge kind-${m.kind}` }, m.kind_label),
            m.status !== "active" ? h("span", { class: "muted small" }, ` · ${m.status_label}`) : null,
            h("p", { class: "muted small" }, m.text))))
          : h("p", { class: "muted" }, p.patterns_note ?? "Noch nicht genügend Daten."),
        p.overcome.length ? h("div", { class: "overcome" }, h("h3", { class: "h3" }, "Das sitzt inzwischen gut"),
          h("ul", { class: "plain" }, p.overcome.map((t) => h("li", {}, t)))) : null),
      h("section", { class: "card", "aria-labelledby": "focus-title" },
        h("h2", { id: "focus-title" }, "Daran arbeiten wir gerade"),
        p.focus.length
          ? h("ul", { class: "plain focus" }, p.focus.map((f) => h("li", {}, h("strong", {}, f.title),
            f.skills.length ? h("p", { class: "muted small" }, f.skills.join(" · "), f.more ? ` und ${f.more} weitere` : "") : null)))
          : h("p", { class: "muted" }, "Gerade kein besonderer Schwerpunkt.")),
      h("section", { class: "card", "aria-labelledby": "strengths-title" },
        h("h2", { id: "strengths-title" }, "Stärken"),
        p.strengths.length
          ? h("ul", { class: "plain" }, p.strengths.map((s) => h("li", {}, h("strong", {}, s.title), h("span", { class: "muted" }, ` – ${s.text}`))))
          : h("p", { class: "muted" }, p.strengths_note ?? "Noch nicht genügend Daten. Stärken zeigen sich nach mehreren sicheren Anwendungen.")),
      h("section", { class: "card", "aria-labelledby": "stats-title" },
        h("h2", { id: "stats-title" }, "Überblick"),
        h("dl", { class: "stats" },
          stat("Lerntage", p.activity.learning_days),
          stat("Übungen", p.activity.attempts),
          stat("Sessions", p.activity.sessions_completed),
          stat("Serie", `${p.activity.streak} (Rekord ${p.activity.longest_streak})`),
          stat("Wiederholung fällig", p.reviews.due),
          stat("Beherrscht", p.reviews.mastered)),
        h("ul", { class: "levels" }, p.mastery.map((m) => h("li", {}, h("span", {}, m.label), h("strong", {}, String(m.count))))))));
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, String(value)));
}
