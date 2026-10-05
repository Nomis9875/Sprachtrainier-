/** Startseite: Heute, nächste Session, Lernbedarf, Sprachprofil, Streak und Woche (je aktiver Lernsprache). */

import { plural } from "../../model/labels.js";
import { h, icon, meter } from "../dom.js";
import { learningOutlook } from "../../model/language.js";
import { startSessionAction } from "./learn.js";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export async function homeView(ctx) {
  if (ctx.app.library.empty) return emptyLanguageHome(ctx);
  const [d, conversation, languageProfile] = await Promise.all([ctx.app.dashboard(), ctx.app.openConversation(), ctx.app.languageProfile()]);
  ctx.setTitle("Start");
  return h("div", { class: "page home" },
    h("header", { class: "page-head" },
      h("h1", {}, d.greeting, " ", h("span", { "aria-hidden": "true" }, "👋")),
      h("p", { class: "muted" }, d.has_history ? todayLine(d) : "Schön, dass du da bist.")),
    h("div", { class: "grid" },
      d.open_session ? openSessionCard(ctx, d.open_session) : nextSessionCard(ctx, d, languageProfile),
      conversation ? openConversationCard(conversation) : null,
      d.has_history ? todayCard(d) : null,
      d.has_history ? needsCard(d) : null,
      languageCard(ctx, languageProfile),
      d.has_history ? weekCard(d) : howItWorksCard()));
}

/** Sprache ohne Inhaltspaket: ehrlich sagen, dass es noch nichts zu lernen gibt (nichts wird erfunden oder übersetzt). */
function emptyLanguageHome(ctx) {
  const language = ctx.languages.activeInfo();
  ctx.setTitle("Start");
  return h("div", { class: "page home", "data-language-empty": language.id },
    h("header", { class: "page-head" }, h("h1", {}, h("span", { "aria-hidden": "true" }, `${language.flag} `), language.name_de)),
    h("section", { class: "card hero", "aria-labelledby": "empty-lang-title" },
      h("p", { class: "eyebrow" }, "Inhalte in Vorbereitung"),
      h("h2", { id: "empty-lang-title" }, `Für ${language.name_de} gibt es noch keine Übungen`),
      h("p", {}, "Die Sprache ist vorgemerkt und hat ein eigenes, leeres Lernprofil. Übungen, Gespräche und die Einstufung kommen mit dem Inhaltspaket dieser Sprache."),
      h("p", { class: "muted small" }, "Deine anderen Sprachen sind davon nicht betroffen: Fortschritt und Fehler bleiben getrennt."),
      h("a", { class: "btn btn-primary btn-block", href: "#/sprachen", "data-action": "languages" }, "Zu meinen Sprachen")));
}

/** Sprachprofil kurz: Stufe nur mit ihrer Sicherheit; ohne Einstufung die Einladung dazu. */
function languageCard(ctx, p) {
  const language = ctx.languages.activeInfo();
  const assessed = Boolean(p.last_assessment);
  const action = !p.has_assessment_content ? null
    : p.open_assessment_id ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "resume-assessment" }, "Einstufung fortsetzen")
      : !assessed ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "assess" }, "Einstufung machen")
        : p.reassessment_due ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "reassess" }, "Neu einstufen (empfohlen)") : null;
  return h("section", { class: "card language-card", "aria-labelledby": "lang-title", "data-overall": p.overall.status },
    h("div", { class: "card-head" },
      h("h2", { id: "lang-title" }, h("span", { "aria-hidden": "true" }, `${language.flag} `), `Dein ${language.name_de}`),
      h("a", { class: "btn btn-link", href: "#/sprachprofil" }, "Profil")),
    h("p", { class: "overall-level" }, h("strong", {}, p.overall.text), h("span", { class: "muted small" }, ` ${p.overall.detail}`)),
    p.overall.status !== "estimated" ? h("p", { class: "muted small" }, "Noch nicht genügend Daten für eine verlässliche Einstufung.") : null,
    // P22: Was folgt aus dem Profil? (schwacher Bereich; ungemessen ist ausdrücklich keine Schwäche)
    assessed ? learningOutlook(p, ctx.app.explanationLanguage).lines.map((line) => h("p", { class: "muted small outlook" }, line)) : null,
    action,
    quickActions(ctx));
}

/** Schnellzugriffe (P12): Lernen, Sprechen (Gespräche), kurz wiederholen, Einstufung. */
function quickActions(ctx) {
  const review = h("button", { type: "button", class: "btn btn-secondary", "data-action": "quick-review",
    onclick: (e) => startSessionAction(ctx, 5, e.currentTarget) }, "Kurz wiederholen");
  return h("div", { class: "stack-row quick-actions", role: "group", "aria-label": "Schnellzugriff" },
    h("a", { class: "btn btn-secondary", href: "#/lernen", "data-action": "quick-learn" }, "Lernen"),
    h("a", { class: "btn btn-secondary", href: "#/ueben", "data-action": "quick-speak" }, "Sprechen"),
    review,
    h("a", { class: "btn btn-secondary", href: "#/einstufung", "data-action": "quick-assess" }, "Einstufung"));
}

function todayLine(d) {
  if (d.today.reached) return `Tagesziel erreicht: ${d.today.minutes} von ${d.today.goal_minutes} Minuten.`;
  if (d.today.attempts > 0) return `Heute ${d.today.minutes_text} von ${d.today.goal_minutes} Minuten.`;
  return `Dein Tagesziel: ${d.today.goal_minutes} Minuten.`;
}

function openSessionCard(ctx, open) {
  const paused = open.status === "paused";
  return h("section", { class: "card hero", "aria-labelledby": "hero-title" },
    h("p", { class: "eyebrow" }, paused ? "Pausiert" : "Läuft gerade"),
    h("h2", { id: "hero-title" }, "Deine Session"),
    h("p", {}, `${open.completed} von ${open.total} Übungen erledigt.`),
    meter(open.total ? open.completed / open.total : 0, "Fortschritt der Session"),
    h("a", { class: "btn btn-primary btn-block", href: "#/session", "data-action": "resume" }, paused ? "Fortsetzen" : "Weiter lernen"));
}

function openConversationCard(conversation) {
  return h("section", { class: "card", "aria-labelledby": "conv-open-title" },
    h("p", { class: "eyebrow" }, conversation.paused ? "Pausiertes Gespräch" : "Offenes Gespräch"),
    h("h2", { id: "conv-open-title" }, conversation.title),
    h("p", { class: "muted" }, `${conversation.progress.answered} Antworten, noch etwa ${conversation.progress.remaining_minutes} Min.`),
    h("a", { class: "btn btn-secondary btn-block", href: `#/gespraech/${encodeURIComponent(conversation.scenario_id)}`, "data-action": "resume-conversation" },
      "Gespräch fortsetzen"));
}

function nextSessionCard(ctx, d, profile = null) {
  const assessed = Boolean(profile?.last_assessment);
  const next = d.next_session;
  if (!next || next.empty) {
    return h("section", { class: "card hero" },
      h("h2", {}, "Gerade keine Session möglich"),
      h("p", { class: "muted" }, "Für diese Länge gibt es keine passenden Übungen. Wähle eine andere Länge."),
      h("a", { class: "btn btn-secondary", href: "#/lernen" }, "Länge wählen"));
  }
  return h("section", { class: "card hero", "aria-labelledby": "hero-title" },
    h("p", { class: "eyebrow" }, d.has_history ? "Jetzt lernen" : assessed ? "Nach deiner Einstufung" : "Noch keine Lernhistorie"),
    h("h2", { id: "hero-title" }, d.has_history ? "Deine nächste Session" : "Starte deine erste Session"),
    h("p", { class: "hero-minutes" }, h("strong", {}, `${next.minutes} Minuten`), h("span", { class: "muted" }, ` · ${plural(next.exercise_count, "Übung", "Übungen")}`)),
    h("ul", { class: "composition" }, next.composition.map((c) => h("li", {}, c.text))),
    !d.has_history ? h("p", { class: "muted small" }, assessed
      ? "Sie baut auf deiner Einstufung auf. Danach plant die App jede Session neu, nach deinen Antworten, Fehlern und Wiederholungen."
      : "Die erste Session zeigt, wo du stehst. Danach plant die App gezielt nach deinen Fehlern und Wiederholungen.") : null,
    h("div", { class: "hero-actions" },
      h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "start", onclick: (e) => startSessionAction(ctx, next.minutes, e.currentTarget) }, "Starten"),
      h("a", { class: "btn btn-link", href: "#/lernen" }, "Andere Länge wählen")));
}

function howItWorksCard() {
  return h("section", { class: "card", "aria-labelledby": "how-title" },
    h("h2", { id: "how-title" }, "So lernst du hier"),
    h("ul", { class: "plain how" },
      h("li", {}, h("strong", {}, "Jede Session wird neu geplant. "), "Aus deinen Fehlern, fälligen Wiederholungen und neuen Themen."),
      h("li", {}, h("strong", {}, "Du schreibst selbst. "), "Freie Antworten zählen mehr als Ankreuzen, denn so wird Wissen zu Können."),
      h("li", {}, h("strong", {}, "Alles bleibt auf diesem Gerät. "), "Die Bewertung läuft lokal, auch offline, ohne Cloud und ohne KI-Kosten.")));
}

function todayCard(d) {
  return h("section", { class: "card", "aria-labelledby": "today-title" },
    h("h2", { id: "today-title" }, "Heute"),
    h("p", { class: "big" }, d.today.minutes_text, h("span", { class: "muted" }, ` / ${d.today.goal_minutes} min`)),
    meter(d.today.ratio, "Tagesziel"),
    h("p", { class: "muted small" }, d.today.attempts
      ? `${plural(d.today.attempts, "Übung", "Übungen")}, ${d.today.with_errors ? `davon ${d.today.with_errors} mit Fehlern` : "alle ohne Fehler"}`
      : "Heute noch keine Übung."));
}

function needsCard(d) {
  return h("section", { class: "card", "aria-labelledby": "needs-title" },
    h("h2", { id: "needs-title" }, "Aktueller Lernbedarf"),
    d.needs.length
      ? h("ul", { class: "needs" }, d.needs.map((n) => h("li", { "data-need": n.key }, n.text)))
      : h("p", { class: "muted" }, "Gerade nichts Dringendes. Eine gute Gelegenheit für Neues."));
}

function weekCard(d) {
  const max = Math.max(1, d.week.max_attempts);
  const trend = d.week.previous_attempts
    ? `${d.week.attempts} Übungen in 7 Tagen (davor ${d.week.previous_attempts}).`
    : `${d.week.attempts} Übungen in den letzten 7 Tagen.`;
  return h("section", { class: "card", "aria-labelledby": "week-title" },
    h("div", { class: "card-head" },
      h("h2", { id: "week-title" }, "Diese Woche"),
      h("span", { class: "streak", title: "Lerntage in Folge" }, icon("flame", { size: 18 }),
        d.streak.current === 1 ? "1 Tag in Folge" : `${d.streak.current} Tage in Folge`)),
    h("div", { class: "bars", role: "img", "aria-label": trend },
      d.week.days.map((day) => h("div", { class: "bar-col" },
        h("div", { class: "bar", style: { height: `${Math.round((day.attempts / max) * 100)}%` }, "data-empty": day.attempts === 0 ? "true" : null }),
        h("span", { class: "bar-label" }, weekday(day.date))))),
    h("p", { class: "muted small" }, trend));
}

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
