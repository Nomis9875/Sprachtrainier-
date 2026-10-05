/**
 * Meine Sprachen (P11B): Lernsprachen wählen (erster Start), wechseln, hinzufügen, einstufen.
 *
 * Alle registrierten Sprachen erscheinen; Sprachen ohne Inhaltspaket sind als "Inhalte in Vorbereitung"
 * gekennzeichnet (man kann sie vormerken, aber noch nicht üben oder einstufen). Stufen erscheinen nur mit
 * ihrer Sicherheit (model/language.js).
 */

import { h, icon } from "../dom.js";
import { languageName, t } from "../../model/i18n.js";

/** Zielbereich der Sprache im Produkt (P20, aus dem Inhaltspaket), z. B. "Ziel A1–B2". */
function rangeText(l) {
  return l.enabled && l.cefr_range ? t("languages.range", l.cefr_range[0], l.cefr_range[1]) : "";
}

/** Meine Sprachen: aktive Sprache, Stufe mit Sicherheit, Lernen / Einstufung / Profil, Sprache hinzufügen. */
export async function languagesView(ctx) {
  ctx.setTitle(t("languages.title"));
  const overview = await ctx.languages.overview();
  const row = (l) => {
    const active = l.id === overview.active;
    const learn = h("button", { type: "button", class: "btn btn-primary", "data-action": "switch-language", "data-language": l.id },
      active ? t("session.keep") : t("nav.learn"));
    learn.addEventListener("click", () => (active ? ctx.navigate("#/") : ctx.languages.switchTo(l.id)));
    // Wechsel zuerst (offene Arbeit wird geklärt); bei "Abbrechen" bleibt alles, wie es ist
    const openIn = (hash) => async () => {
      if (!active && !(await ctx.languages.switchTo(l.id, { silent: true }))) return;
      ctx.navigate(hash);
    };
    const assess = h("button", { type: "button", class: "btn btn-secondary", "data-action": "assess-language", "data-language": l.id,
      disabled: !l.assessment }, l.assessed ? t("languages.reassess") : t("languages.assess"));
    assess.addEventListener("click", openIn("#/einstufung"));
    const profile = h("button", { type: "button", class: "btn btn-ghost", "data-action": "language-profile", "data-language": l.id }, t("home.profile"));
    profile.addEventListener("click", openIn("#/sprachprofil"));
    const open = h("button", { type: "button", class: "btn btn-secondary", "data-action": "switch-language", "data-language": l.id }, active ? t("languages.active") : t("languages.open"));
    open.disabled = active;
    open.addEventListener("click", () => ctx.languages.switchTo(l.id));
    return h("li", { class: `language-row${active ? " active" : ""}`, "data-language": l.id },
      h("span", { class: "language-name" }, h("span", { class: "flag", "aria-hidden": "true" }, l.flag),
        h("strong", {}, l.native_name), h("span", { class: "muted small", "data-range": "" }, rangeText(l)),
        active ? h("span", { class: "active-mark" }, t("profile.active")) : null),
      h("span", { class: "language-level", "data-level": "" },
        l.enabled ? h("span", {}, h("strong", {}, l.level.text), h("span", { class: "muted small" }, ` ${l.level.detail}`))
          : h("span", { class: "muted small" }, t("home.soon"))),
      h("span", { class: "stack-row language-actions" }, ...(l.enabled ? [learn, assess, profile] : [open])));
  };
  const addable = overview.addable.map((l) => {
    const button = h("button", { type: "button", class: "btn btn-secondary", "data-action": "add-language", "data-language": l.id },
      h("span", { "aria-hidden": "true" }, l.flag), ` ${languageName(l.id)}${l.enabled ? rangeText(l) : ` (${t("home.soon")})`}`);
    button.addEventListener("click", () => ctx.languages.add(l.id));
    return h("li", {}, button);
  });
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, t("languages.title")),
      h("p", { class: "muted" }, t("languages.lead"))),
    h("section", { class: "card", "aria-labelledby": "my-languages" },
      h("h2", { id: "my-languages" }, t("languages.mine")),
      h("ul", { class: "plain language-list" }, overview.mine.map(row))),
    addable.length ? h("section", { class: "card", "aria-labelledby": "add-languages" },
      h("h2", { id: "add-languages" }, t("languages.add")),
      h("ul", { class: "plain stack-row add-languages" }, addable)) : null,
    h("p", { class: "muted small" }, icon("info", { size: 16 }),
      t("languages.note")));
}
