/** Lernen: Länge wählen, Vorschau der geplanten Session, starten oder fortsetzen. */

import { SESSION_MINUTES } from "../../services/app-service.js";
import { plural } from "../../model/labels.js";
import { h } from "../dom.js";
import { loading } from "../components.js";

export async function learnView(ctx) {
  ctx.setTitle("Lernen");
  const [open, profile] = await Promise.all([ctx.app.openSession(), ctx.app.profile()]);
  if (open) {
    return h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", {}, "Lernen")),
      h("section", { class: "card hero" },
        h("p", { class: "eyebrow" }, open.status === "paused" ? "Pausiert" : "Läuft gerade"),
        h("h2", {}, "Du hast eine offene Session"),
        h("p", {}, `${open.completed} von ${open.total} Übungen erledigt. Eine neue Session gibt es, wenn diese fertig oder beendet ist.`),
        h("a", { class: "btn btn-primary btn-block", href: "#/session" }, open.status === "paused" ? "Fortsetzen" : "Weiter lernen")));
  }

  let minutes = profile.daily_minutes;
  const previewBox = h("div", { class: "preview", "aria-live": "polite" });
  const startButton = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "start" }, "Session starten");
  startButton.addEventListener("click", () => startSessionAction(ctx, minutes, startButton));

  const showPreview = async () => {
    previewBox.replaceChildren(loading("Session wird geplant …"));
    const requested = minutes;
    try {
      const preview = await ctx.app.planPreview(requested);
      if (requested !== minutes) return; // inzwischen andere Länge gewählt
      startButton.disabled = preview.empty;
      previewBox.replaceChildren(
        h("p", { class: "preview-title" }, h("strong", {}, preview.title), h("span", { class: "muted" }, ` · ${plural(preview.exercise_count, "Übung", "Übungen")} · ca. ${preview.estimated_minutes} min`)),
        preview.empty
          ? h("p", { class: "muted" }, "Für diese Länge gibt es gerade keine passenden Übungen.")
          : h("ul", { class: "composition" }, preview.composition.map((c) => h("li", {}, c.text))));
    } catch (error) {
      console.error(error);
      previewBox.replaceChildren(h("p", { class: "form-error" }, "Die Vorschau konnte gerade nicht berechnet werden."));
    }
  };

  const options = SESSION_MINUTES.map((value) => {
    const input = h("input", { type: "radio", name: "minutes", value, id: `min-${value}`, checked: value === minutes });
    input.addEventListener("change", () => {
      minutes = value;
      showPreview();
    });
    return h("label", { class: "choice", for: `min-${value}` }, input, h("span", {}, h("strong", {}, String(value)), " min"));
  });

  showPreview();
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, "Lernen"),
      h("p", { class: "muted" }, "Die App plant jede Session neu aus deinen Fehlern, fälligen Wiederholungen und neuen Themen.")),
    h("section", { class: "card", "aria-labelledby": "length-title" },
      h("h2", { id: "length-title" }, "Wie viel Zeit hast du?"),
      h("fieldset", { class: "choices" }, h("legend", { class: "sr-only" }, "Länge der Session"), options),
      previewBox,
      startButton));
}

/** Startet eine Session und wechselt in die Session-Ansicht. */
export async function startSessionAction(ctx, minutes, button) {
  if (button) button.disabled = true;
  try {
    await ctx.app.startSession(minutes);
    ctx.navigate("#/session");
  } catch (error) {
    if (button) button.disabled = false;
    ctx.toast(error?.userMessage ?? "Die Lernsession konnte gerade nicht gestartet werden.");
    if (!error?.userMessage) console.error(error);
  }
}
