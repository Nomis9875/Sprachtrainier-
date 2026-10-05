/**
 * Onboarding (P25.1, P25.5): 1 Lernsprache → 2 Selbsteinschätzung → 3 Tagesziel (und optional ein Name). Beim ersten
 * Start steht die Sprache der App als klar beschriftete Einstellung über der Frage nach der Lernsprache (vorher ein
 * eigener Schritt "Choose your language", der wie die Wahl der Lernsprache wirkte). Gespeichert wird erst am Ende.
 */

import { FEW_EXERCISES, ONBOARDING_GOALS, ONBOARDING_LEVELS, UI_LANGUAGES, UI_LANGUAGE_NAMES, belowRange, exercisesAtLevel, setUiLanguage, t } from "../../model/i18n.js";
import { h, icon } from "../dom.js";

/**
 * @param {{languages: object[], uiLanguage: string, askUiLanguage: boolean, askName: boolean,
 *   onUiLanguage: (id: string) => void, onFinish: (choice: object) => Promise<void>}} options
 */
export function onboardingView({ languages, uiLanguage, askUiLanguage, askName, onUiLanguage, onFinish }) {
  const steps = ["learn", "level", "goal"];
  const choice = { ui: uiLanguage, learn: null, level: null, goal: 10, name: "" };
  let index = 0;
  const root = h("div", { class: "page onboarding" });

  const render = ({ focus = false } = {}) => {
    const step = steps[index];
    root.dataset.onboardingStep = step;
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const fail = (text) => { error.textContent = text; error.hidden = false; };
    const content = { learn: learnStep, level: levelStep, goal: goalStep }[step]();
    const last = index === steps.length - 1;
    const next = h("button", { type: "submit", class: "btn btn-primary btn-block", "data-action": last ? "onboarding-finish" : "onboarding-next" },
      last ? t("start") : t("next"));
    const back = index > 0 ? h("button", { type: "button", class: "btn btn-link", "data-action": "onboarding-back" }, t("back")) : null;
    back?.addEventListener("click", () => { index -= 1; render({ focus: true }); });
    const form = h("form", { class: "onboarding-step", "data-form": "onboarding", novalidate: true },
      h("p", { class: "onboarding-progress muted small", "aria-live": "polite" }, t("step", index + 1, steps.length)),
      h("div", { class: "onboarding-dots", "aria-hidden": "true" }, steps.map((_, i) => h("span", { class: i <= index ? "on" : "" }))),
      content, error, h("div", { class: "onboarding-actions" }, next, back));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (step === "learn" && !choice.learn) return fail(t("learn_missing"));
      if (step === "level" && !choice.level) return fail(t("level_missing"));
      if (!last) {
        index += 1;
        render({ focus: true });
        return;
      }
      next.disabled = true;
      try {
        await onFinish({ ...choice, name: choice.name.trim() });
      } catch (err) {
        next.disabled = false;
        fail(err?.message ?? t("failed"));
      }
    });
    root.replaceChildren(form);
    if (focus) queueMicrotask(() => root.querySelector("h1")?.focus());
  };

  /** Auswahlkarten: eine Option wählbar (role radio), Tippen wählt. */
  const options = (name, items, selected, onSelect) => h("div", { class: "choice-cards", role: "radiogroup" },
    items.map((item) => {
      const button = h("button", {
        type: "button", class: `choice-card${item.id === selected ? " selected" : ""}`, role: "radio",
        "aria-checked": String(item.id === selected), [`data-${name}`]: item.id, disabled: item.disabled ?? false,
      },
      item.flag ? h("span", { class: "choice-flag", "aria-hidden": "true" }, item.flag) : null,
      h("span", { class: "choice-text" }, h("strong", {}, item.title), item.detail ? h("span", { class: "muted small" }, item.detail) : null),
      h("span", { class: "choice-check", "aria-hidden": "true" }, icon("check", { size: 18 })));
      button.addEventListener("click", () => { onSelect(item.id); render(); });
      return button;
    }));

  /** Sprache der App: kleine, beschriftete Umschaltung (Menüs und Erklärungen), deutlich getrennt von der Lernsprache. */
  function uiBar() {
    return h("div", { class: "app-language", role: "group", "aria-labelledby": "app-language-label" },
      h("span", { class: "app-language-icon", "aria-hidden": "true" }, icon("globe", { size: 18 })),
      h("span", { class: "app-language-text" }, h("strong", { id: "app-language-label" }, t("ui_bar")),
        h("span", { class: "muted small" }, t("ui_bar_hint"))),
      h("span", { class: "segmented" }, UI_LANGUAGES.map((id) => {
        const button = h("button", { type: "button", "data-ui-language": id, "aria-pressed": String(id === choice.ui), lang: id },
          UI_LANGUAGE_NAMES[id]);
        button.addEventListener("click", () => {
          choice.ui = id;
          setUiLanguage(id);
          onUiLanguage(id);
          render();
        });
        return button;
      })));
  }

  function learnStep() {
    const names = t("language_names");
    return [
      askUiLanguage ? uiBar() : null,
      // P25.7: beim ersten Start in einem Satz, was diese App ist und was als Nächstes passiert
      askUiLanguage ? h("p", { class: "onboarding-intro" }, t("app_intro")) : null,
      h("h1", { tabindex: "-1" }, t("learn_title")),
      h("p", { class: "muted" }, t("learn_lead")),
      options("learn-language", languages.map((l) => ({
        id: l.id, flag: l.flag, title: `${capitalize(names[l.id] ?? l.name_de)} · ${l.native_name}`,
        detail: l.enabled ? t("learn_range", ...(l.cefr_range ?? ["A1", "C2"])) : t("learn_soon"), disabled: !l.enabled,
      })), choice.learn, (id) => { choice.learn = id; }),
    ];
  }

  function levelStep() {
    const language = languages.find((l) => l.id === choice.learn);
    const name = t("language_names")[choice.learn] ?? language?.name_de ?? "";
    const labels = t("levels");
    const below = choice.level && belowRange(choice.level, language?.cefr_range);
    // P25: aktueller Inhalt ehrlich (nicht der Zielbereich): wenige Übungen auf der gewählten Stufe
    const available = below ? null : exercisesAtLevel(choice.level, language?.level_counts);
    const few = available !== null && available < FEW_EXERCISES;
    const shownLevel = choice.level === "A0" ? "A1" : choice.level;
    return [
      h("h1", { tabindex: "-1" }, t("level_title", name)),
      h("p", { class: "muted" }, t("level_lead")),
      // sichtbar über der Liste (darunter verdeckte ihn auf dem Handy der feste Weiter-Knopf)
      below ? h("p", { class: "notice", role: "status", "data-notice": "below-range" },
        t("level_below_range", name, language.cefr_range[0])) : null,
      few ? h("p", { class: "notice", role: "status", "data-notice": "few-exercises" }, t("level_few", name, shownLevel, available)) : null,
      options("level", ONBOARDING_LEVELS.map((id) => ({ id, title: labels[id][0], detail: labels[id][1] })),
        choice.level, (id) => { choice.level = id; }),
    ];
  }

  function goalStep() {
    const hints = t("goal_hint");
    const input = h("input", { id: "onboarding-name", type: "text", maxlength: 40, autocomplete: "given-name", value: choice.name });
    input.addEventListener("input", () => { choice.name = input.value; });
    return [
      h("h1", { tabindex: "-1" }, t("goal_title")),
      h("p", { class: "muted" }, t("goal_lead")),
      options("goal", ONBOARDING_GOALS.map((m) => ({ id: m, title: t("goal_option", m), detail: hints[m] })),
        choice.goal, (m) => { choice.goal = m; }),
      askName ? h("div", { class: "field" }, h("label", { for: "onboarding-name", class: "label" }, t("name_label")), input) : null,
    ];
  }

  render();
  return root;
}

function capitalize(text) {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}
