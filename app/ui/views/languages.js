/**
 * Meine Sprachen (P11B): Lernsprachen wählen (erster Start), wechseln, hinzufügen, einstufen.
 *
 * Alle registrierten Sprachen erscheinen; Sprachen ohne Inhaltspaket sind als "Inhalte in Vorbereitung"
 * gekennzeichnet (man kann sie vormerken, aber noch nicht üben oder einstufen). Stufen erscheinen nur mit
 * ihrer Sicherheit (model/language.js).
 */

import { h, icon } from "../dom.js";

/** Zielbereich der Sprache im Produkt (P20, aus dem Inhaltspaket), z. B. "Ziel A1–B2". */
function rangeText(l) {
  return l.enabled && l.cefr_range ? ` · Ziel ${l.cefr_range[0]}–${l.cefr_range[1]}` : "";
}

/** Auswahl beim ersten Start (ohne App-Instanz). */
export function languageSetupView({ name, languages, onConfirm }) {
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const boxes = languages.map((l) => {
    const input = h("input", { type: "checkbox", value: l.id, id: `lang-${l.id}`, "data-language": l.id });
    return h("li", { class: "language-choice" },
      h("label", { for: `lang-${l.id}` }, input,
        h("span", { class: "flag", "aria-hidden": "true" }, l.flag),
        h("span", {}, h("strong", {}, l.name_de), h("span", { class: "muted small" }, ` · ${l.native_name}${rangeText(l)}`)),
        l.enabled ? null : h("span", { class: "badge" }, "Inhalte in Vorbereitung")));
  });
  const form = h("form", { class: "card form", "data-form": "language-setup" },
    h("h1", {}, `Hallo, ${name}!`),
    h("p", {}, "Welche Sprachen möchtest du lernen? Du kannst später weitere hinzufügen."),
    h("ul", { class: "plain language-choices" }, boxes),
    error,
    h("button", { type: "submit", class: "btn btn-primary btn-block" }, "Weiter"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const chosen = boxes.map((li) => li.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
    if (!chosen.length) {
      error.textContent = "Bitte wähle mindestens eine Sprache.";
      error.hidden = false;
      return;
    }
    await onConfirm(chosen);
  });
  return h("div", { class: "page welcome" }, form);
}

/** Meine Sprachen: aktive Sprache, Stufe mit Sicherheit, Lernen / Einstufung / Profil, Sprache hinzufügen. */
export async function languagesView(ctx) {
  ctx.setTitle("Meine Sprachen");
  const overview = await ctx.languages.overview();
  const row = (l) => {
    const active = l.id === overview.active;
    const learn = h("button", { type: "button", class: "btn btn-primary", "data-action": "switch-language", "data-language": l.id },
      active ? "Weiterlernen" : "Lernen");
    learn.addEventListener("click", () => (active ? ctx.navigate("#/") : ctx.languages.switchTo(l.id)));
    // Wechsel zuerst (offene Arbeit wird geklärt); bei "Abbrechen" bleibt alles, wie es ist
    const openIn = (hash) => async () => {
      if (!active && !(await ctx.languages.switchTo(l.id, { silent: true }))) return;
      ctx.navigate(hash);
    };
    const assess = h("button", { type: "button", class: "btn btn-secondary", "data-action": "assess-language", "data-language": l.id,
      disabled: !l.assessment }, l.assessed ? "Einstufung wiederholen" : "Einstufung starten");
    assess.addEventListener("click", openIn("#/einstufung"));
    const profile = h("button", { type: "button", class: "btn btn-ghost", "data-action": "language-profile", "data-language": l.id }, "Profil");
    profile.addEventListener("click", openIn("#/sprachprofil"));
    const open = h("button", { type: "button", class: "btn btn-secondary", "data-action": "switch-language", "data-language": l.id }, active ? "Aktiv" : "Öffnen");
    open.disabled = active;
    open.addEventListener("click", () => ctx.languages.switchTo(l.id));
    return h("li", { class: `language-row${active ? " active" : ""}`, "data-language": l.id },
      h("span", { class: "language-name" }, h("span", { class: "flag", "aria-hidden": "true" }, l.flag),
        h("strong", {}, l.native_name), h("span", { class: "muted small", "data-range": "" }, rangeText(l)),
        active ? h("span", { class: "active-mark" }, " · aktiv") : null),
      h("span", { class: "language-level", "data-level": "" },
        l.enabled ? h("span", {}, h("strong", {}, l.level.text), h("span", { class: "muted small" }, ` ${l.level.detail}`))
          : h("span", { class: "muted small" }, "Inhalte in Vorbereitung")),
      h("span", { class: "stack-row language-actions" }, ...(l.enabled ? [learn, assess, profile] : [open])));
  };
  const addable = overview.addable.map((l) => {
    const button = h("button", { type: "button", class: "btn btn-secondary", "data-action": "add-language", "data-language": l.id },
      h("span", { "aria-hidden": "true" }, l.flag), ` ${l.name_de}${l.enabled ? rangeText(l) : " (Inhalte in Vorbereitung)"}`);
    button.addEventListener("click", () => ctx.languages.add(l.id));
    return h("li", {}, button);
  });
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, "Meine Sprachen"),
      h("p", { class: "muted" }, "Jede Sprache hat ihren eigenen Lernstand. Nichts wird zwischen Sprachen vermischt.")),
    h("section", { class: "card", "aria-labelledby": "my-languages" },
      h("h2", { id: "my-languages" }, "Du lernst"),
      h("ul", { class: "plain language-list" }, overview.mine.map(row))),
    addable.length ? h("section", { class: "card", "aria-labelledby": "add-languages" },
      h("h2", { id: "add-languages" }, "Sprache hinzufügen"),
      h("ul", { class: "plain stack-row add-languages" }, addable)) : null,
    h("p", { class: "muted small" }, icon("info", { size: 16 }),
      " Inhalte werden je Sprache eigens erstellt und geprüft, nicht maschinell übersetzt. Deshalb kommen neue Sprachen nach und nach."));
}
