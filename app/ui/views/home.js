/**
 * Startseite (P25.2/P25.3): eine klare Hauptaktion (nächste oder offene Session), darunter Rhythmus (Tagesziel, Serie,
 * Woche), Sprachstand mit nächstem Schritt und Schnellzugriffe. Füllkarten ohne Inhalt entfallen.
 */

import { languageName, t } from "../../model/i18n.js";
import { h, icon, meter } from "../dom.js";
import { learningOutlook } from "../../model/language.js";
import { startSessionAction } from "./learn.js";
import { tomorrowBlock } from "./session.js";

export async function homeView(ctx) {
  if (ctx.app.library.empty) return emptyLanguageHome(ctx);
  const [d, conversation, languageProfile] = await Promise.all([ctx.app.dashboard(), ctx.app.openConversation(), ctx.app.languageProfile()]);
  // P25.4: Tagesziel erreicht → was morgen wartet (konkret, aus Wiederholungsplanung und nächstem Plan)
  const tomorrow = d.today.reached && !d.open_session ? await ctx.app.tomorrow() : null;
  ctx.setTitle(t("nav.home"));
  return h("div", { class: "page home" },
    h("header", { class: "page-head" },
      h("p", { class: "eyebrow" }, `${ctx.languages.activeInfo().flag} ${languageName(ctx.app.languageId)}`),
      h("h1", {}, d.greeting),
      h("p", { class: "muted" }, d.has_history ? todayLine(d) : t("home.welcome"))),
    h("div", { class: "grid" },
      d.open_session ? openSessionCard(d.open_session) : nextSessionCard(ctx, d, languageProfile),
      conversation ? openConversationCard(conversation) : null,
      tomorrow ? h("section", { class: "card tomorrow-card", "data-card": "tomorrow" }, tomorrowBlock(tomorrow)) : null,
      d.has_history ? rhythmCard(d) : null,
      d.needs.length ? needsCard(d) : null,
      languageCard(ctx, languageProfile),
      quickActions(ctx),
      d.has_history ? null : howItWorksCard()));
}

/** Sprache ohne Inhaltspaket: ehrlich sagen, dass es noch nichts zu lernen gibt (nichts wird erfunden oder übersetzt). */
function emptyLanguageHome(ctx) {
  const language = ctx.languages.activeInfo();
  const name = languageName(language.id);
  ctx.setTitle(t("nav.home"));
  return h("div", { class: "page home", "data-language-empty": language.id },
    h("header", { class: "page-head" }, h("h1", {}, h("span", { "aria-hidden": "true" }, `${language.flag} `), name)),
    h("section", { class: "card hero", "aria-labelledby": "empty-lang-title" },
      h("p", { class: "eyebrow" }, t("home.soon")),
      h("h2", { id: "empty-lang-title" }, t("home.no_content", name)),
      h("p", {}, t("home.no_content_text")),
      h("p", { class: "muted small" }, t("home.no_content_other")),
      h("a", { class: "btn btn-primary btn-block", href: "#/sprachen", "data-action": "languages" }, t("home.to_languages"))));
}

/** Sprachstand: Stufe nur mit ihrer Sicherheit, was als Nächstes kommt, ggf. Einstufung. */
function languageCard(ctx, p) {
  const language = ctx.languages.activeInfo();
  const assessed = Boolean(p.last_assessment);
  const action = !p.has_assessment_content ? null
    : p.open_assessment_id ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "resume-assessment" }, t("home.assess_resume"))
      : !assessed ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "assess" }, t("home.assess_start"))
        : p.reassessment_due ? h("a", { class: "btn btn-secondary btn-block", href: "#/einstufung", "data-action": "reassess" }, t("home.assess_again")) : null;
  return h("section", { class: "card language-card", "aria-labelledby": "lang-title", "data-overall": p.overall.status },
    h("div", { class: "card-head" },
      h("h2", { id: "lang-title" }, h("span", { "aria-hidden": "true" }, `${language.flag} `), t("home.your_language", languageName(language.id))),
      h("a", { class: "btn btn-link", href: "#/sprachprofil" }, t("home.profile"))),
    h("div", { class: "level-display" },
      h("span", { class: "level-badge" }, p.overall.text),
      p.overall.status === "estimated" && p.overall.confidence === "low" ? h("span", { class: "muted small" }, t("claim.provisional")) : null),
    p.overall.status !== "estimated" ? h("p", { class: "muted small" }, t("home.not_enough")) : null,
    // P22/P25.4: Was folgt aus dem Profil? Nur die erste, wichtigste Aussage (Details im Sprachprofil)
    assessed ? learningOutlook(p, ctx.app.explanationLanguage).lines.slice(0, 1).map((line) => h("p", { class: "small outlook" }, line)) : null,
    action);
}

/** Schnellzugriffe (P12): Lernen, Sprechen (Gespräche), kurz wiederholen, Einstufung. */
function quickActions(ctx) {
  const tile = (attrs, iconName, label) => h(attrs.href ? "a" : "button", { class: "tile", ...attrs },
    h("span", { class: "tile-icon", "aria-hidden": "true" }, icon(iconName, { size: 20 })), h("span", {}, label));
  return h("nav", { class: "tiles quick-actions", "aria-label": t("home.quick") },
    tile({ href: "#/ueben", "data-action": "quick-speak" }, "chat", t("home.speak")),
    tile({ href: "#/ueben", "data-action": "quick-listen" }, "headphones", t("home.listen_read")),
    tile({ type: "button", "data-action": "quick-review", onclick: (e) => startSessionAction(ctx, 5, e.currentTarget) }, "repeat", t("home.review")),
    tile({ href: "#/einstufung", "data-action": "quick-assess" }, "target", t("home.assessment")));
}

function todayLine(d) {
  if (d.today.reached) return t("home.goal_reached", d.today.minutes, d.today.goal_minutes);
  if (d.today.attempts > 0) return t("home.today_of", d.today.minutes_text, d.today.goal_minutes);
  return t("home.goal", d.today.goal_minutes);
}

function openSessionCard(open) {
  const paused = open.status === "paused";
  return h("section", { class: "card hero", "aria-labelledby": "hero-title" },
    h("p", { class: "eyebrow" }, paused ? t("home.paused") : t("home.running")),
    h("h2", { id: "hero-title" }, t("home.your_session")),
    h("p", {}, t("home.done_of", open.completed, open.total)),
    meter(open.total ? open.completed / open.total : 0, t("home.session_progress")),
    h("a", { class: "btn btn-primary btn-block", href: "#/session", "data-action": "resume" }, paused ? t("home.resume") : t("home.continue")));
}

function openConversationCard(conversation) {
  return h("section", { class: "card", "aria-labelledby": "conv-open-title" },
    h("p", { class: "eyebrow" }, conversation.paused ? t("home.conv_paused") : t("home.conv_open")),
    h("h2", { id: "conv-open-title" }, conversation.title),
    h("p", { class: "muted" }, t("home.conv_progress", conversation.progress.answered, conversation.progress.remaining_minutes)),
    h("a", { class: "btn btn-secondary btn-block", href: `#/gespraech/${encodeURIComponent(conversation.scenario_id)}`, "data-action": "resume-conversation" },
      t("home.conv_resume")));
}

function nextSessionCard(ctx, d, profile = null) {
  const assessed = Boolean(profile?.last_assessment);
  const next = d.next_session;
  if (!next || next.empty) {
    return h("section", { class: "card hero" },
      h("h2", {}, t("home.no_session")),
      h("p", { class: "muted" }, t("home.no_session_text")),
      h("a", { class: "btn btn-secondary", href: "#/lernen" }, t("home.choose_length")));
  }
  return h("section", { class: "card hero", "aria-labelledby": "hero-title" },
    h("p", { class: "eyebrow" }, d.has_history ? t("home.learn_now") : assessed ? t("home.after_assessment") : t("home.no_history")),
    h("h2", { id: "hero-title" }, d.has_history ? t("home.next_session") : t("home.first_session")),
    h("p", { class: "hero-minutes" }, h("strong", {}, t("common.minutes", next.minutes)), h("span", { class: "muted" }, ` · ${t("common.exercises", next.exercise_count)}`)),
    h("ul", { class: "composition" }, next.composition.map((c) => h("li", {}, c.text))),
    !d.has_history ? h("p", { class: "muted small" }, assessed ? t("home.first_after") : t("home.first_before")) : null,
    h("div", { class: "hero-actions" },
      h("button", { type: "button", class: "btn btn-primary btn-block btn-lg", "data-action": "start", onclick: (e) => startSessionAction(ctx, next.minutes, e.currentTarget) },
        icon("play", { size: 18 }), t("home.start")),
      h("a", { class: "btn btn-link", href: "#/lernen", "data-action": "choose-length" }, t("home.other_length"))));
}

function howItWorksCard() {
  return h("section", { class: "card", "aria-labelledby": "how-title" },
    h("h2", { id: "how-title" }, t("home.how")),
    h("ul", { class: "plain how" },
      h("li", {}, h("strong", {}, t("home.how1")), t("home.how1_text")),
      h("li", {}, h("strong", {}, t("home.how2")), t("home.how2_text")),
      h("li", {}, h("strong", {}, t("home.how3")), t("home.how3_text"))));
}

/** Rhythmus: Tagesziel (Minuten), heutige Übungen, Serie und Woche in einer Karte. */
function rhythmCard(d) {
  const max = Math.max(1, d.week.max_attempts);
  const trend = d.week.previous_attempts
    ? t("home.week_trend", d.week.attempts, d.week.previous_attempts)
    : t("home.week_count", d.week.attempts);
  return h("section", { class: "card rhythm", "aria-labelledby": "today-title" },
    h("div", { class: "card-head" },
      h("h2", { id: "today-title" }, t("home.today")),
      h("span", { class: "streak", title: t("home.streak_title") }, icon("flame", { size: 18 }), t("home.streak", d.streak.current))),
    h("p", { class: "big" }, d.today.minutes_text, h("span", { class: "muted" }, ` / ${d.today.goal_minutes} min`)),
    meter(d.today.ratio, t("home.daily_goal")),
    h("p", { class: "muted small" }, d.today.attempts
      ? `${t("common.exercises", d.today.attempts)}, ${d.today.with_errors ? t("home.with_errors", d.today.with_errors) : t("home.all_correct")}`
      : t("home.none_today")),
    h("h3", { id: "week-title", class: "group-title" }, t("home.this_week")),
    h("div", { class: "bars", role: "img", "aria-label": trend },
      d.week.days.map((day) => h("div", { class: "bar-col" },
        h("div", { class: "bar", style: { height: `${Math.round((day.attempts / max) * 100)}%` }, "data-empty": day.attempts === 0 ? "true" : null }),
        h("span", { class: "bar-label" }, weekday(day.date))))),
    h("p", { class: "muted small" }, trend));
}

function needsCard(d) {
  return h("section", { class: "card", "aria-labelledby": "needs-title" },
    h("h2", { id: "needs-title" }, t("home.needs")),
    h("ul", { class: "needs" }, d.needs.map((n) => h("li", { "data-need": n.key }, n.text))));
}

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return t("home.weekdays")[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

