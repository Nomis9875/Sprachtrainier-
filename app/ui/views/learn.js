/** Lernen: Länge wählen, Vorschau der geplanten Session, starten oder fortsetzen. */

import { SESSION_MINUTES } from "../../services/app-service.js";
import { h } from "../dom.js";
import { t } from "../../model/i18n.js";
import { loading } from "../components.js";

export async function learnView(ctx) {
  ctx.setTitle(t("nav.learn"));
  const [open, profile] = await Promise.all([ctx.app.openSession(), ctx.app.profile()]);
  if (open) {
    return h("div", { class: "page" },
      h("header", { class: "page-head" }, h("h1", {}, t("nav.learn"))),
      h("section", { class: "card hero" },
        h("p", { class: "eyebrow" }, open.status === "paused" ? t("home.paused") : t("home.running")),
        h("h2", {}, t("learn.open")),
        h("p", {}, t("learn.open_text", open.completed, open.total)),
        h("a", { class: "btn btn-primary btn-block", href: "#/session" }, open.status === "paused" ? t("home.resume") : t("home.continue"))));
  }

  let minutes = profile.daily_minutes;
  const previewBox = h("div", { class: "preview", "aria-live": "polite" });
  const startButton = h("button", { type: "button", class: "btn btn-primary btn-block", "data-action": "start" }, t("learn.start"));
  startButton.addEventListener("click", () => startSessionAction(ctx, minutes, startButton));

  const showPreview = async () => {
    previewBox.replaceChildren(loading(t("learn.planning")));
    const requested = minutes;
    try {
      const preview = await ctx.app.planPreview(requested);
      if (requested !== minutes) return; // inzwischen andere Länge gewählt
      startButton.disabled = preview.empty;
      previewBox.replaceChildren(
        h("p", { class: "preview-title" }, h("strong", {}, preview.title), h("span", { class: "muted" }, ` · ${t("common.exercises", preview.exercise_count)} · ${t("c.about", `${preview.estimated_minutes} min`)}`)),
        preview.empty
          ? h("p", { class: "muted" }, t("learn.none"))
          : h("ul", { class: "composition" }, preview.composition.map((c) => h("li", {}, c.text))));
    } catch (error) {
      console.error(error);
      previewBox.replaceChildren(h("p", { class: "form-error" }, t("learn.preview_failed")));
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
    h("header", { class: "page-head" }, h("h1", {}, t("nav.learn")),
      h("p", { class: "muted" }, t("learn.lead"))),
    h("section", { class: "card", "aria-labelledby": "length-title" },
      h("h2", { id: "length-title" }, t("learn.time")),
      h("fieldset", { class: "choices" }, h("legend", { class: "sr-only" }, t("learn.length")), options),
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
    ctx.toast(error?.userMessage ?? t("learn.start_failed"));
    if (!error?.userMessage) console.error(error);
  }
}
