/** Wer lernt? Erster Start (Name eingeben) oder Auswahl, wenn kein Nutzer aktiv ist. */

import { h } from "../dom.js";

/**
 * @param {{users: object[], onCreate: (name: string) => Promise<void>, onChoose: (id: string) => Promise<void>}} options
 */
export function welcomeView({ users, onCreate, onChoose }) {
  const input = h("input", { id: "welcome-name", type: "text", maxlength: 40, autocomplete: "given-name", required: true });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const form = h("form", { class: "form", "data-form": "create-user" },
    h("div", { class: "field" }, h("label", { for: "welcome-name", class: "label" }, users.length ? "Neuer Nutzer" : "Wie heißt du?"), input),
    error,
    h("button", { type: "submit", class: "btn btn-primary btn-block" }, users.length ? "Nutzer anlegen" : "Los geht's"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await onCreate(input.value);
    } catch (err) {
      error.textContent = err?.message ?? "Das hat nicht geklappt.";
      error.hidden = false;
    }
  });
  queueMicrotask(() => input.focus());
  return h("div", { class: "page welcome" },
    h("header", { class: "page-head" }, h("h1", {}, "Willkommen!"),
      h("p", { class: "muted" }, users.length
        ? "Wer lernt gerade? Jeder Nutzer hat seinen eigenen Lernstand."
        : "Leg deinen Nutzer an. Auf diesem Gerät können mehrere Personen lernen, jede mit ihrem eigenen Lernstand.")),
    users.length ? h("section", { class: "card" }, h("h2", {}, "Nutzer wählen"),
      h("ul", { class: "list" }, users.map((u) => h("li", {},
        h("button", { type: "button", class: "list-item user-choice", "data-user-id": u.id, onclick: () => onChoose(u.id) },
          h("strong", {}, u.display_name)))))) : null,
    h("section", { class: "card" }, form));
}
