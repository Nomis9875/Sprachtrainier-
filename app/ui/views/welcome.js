/** Wer lernt? Auswahl, wenn Nutzer da sind, aber keiner aktiv ist (der allererste Start ist das Onboarding, P25.1). */

import { t } from "../../model/i18n.js";
import { h } from "../dom.js";

/**
 * @param {{users: object[], onCreate: (name: string) => Promise<void>, onChoose: (id: string) => Promise<void>}} options
 */
export function welcomeView({ users, onCreate, onChoose }) {
  const input = h("input", { id: "welcome-name", type: "text", maxlength: 40, autocomplete: "given-name", required: true });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const form = h("form", { class: "form", "data-form": "create-user" },
    h("div", { class: "field" }, h("label", { for: "welcome-name", class: "label" }, t("new_user")), input),
    error,
    h("button", { type: "submit", class: "btn btn-primary btn-block" }, t("create_user")));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await onCreate(input.value);
    } catch (err) {
      error.textContent = err?.message ?? t("failed");
      error.hidden = false;
    }
  });
  return h("div", { class: "page welcome" },
    h("header", { class: "page-head" }, h("h1", {}, t("welcome_title")), h("p", { class: "muted" }, t("welcome_lead"))),
    h("section", { class: "card" }, h("h2", {}, t("choose_user")),
      h("ul", { class: "list" }, users.map((u) => h("li", {},
        h("button", { type: "button", class: "list-item user-choice", "data-user-id": u.id, onclick: () => onChoose(u.id) },
          h("strong", {}, u.display_name)))))),
    h("section", { class: "card" }, form));
}
