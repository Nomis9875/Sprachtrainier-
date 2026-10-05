/** Profil: Nutzer (wechseln, anlegen, löschen), Name und Tagesziel, Daten (Sicherung, Löschen), App-Status. */

import { SESSION_MINUTES } from "../../services/app-service.js";
import { h } from "../dom.js";
import { confirmDialog } from "../components.js";
import { EXPLANATION_LANGUAGES, EXPLANATION_LANGUAGE_NAMES } from "../../model/explain.js";
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, languageName, t, uiLanguage } from "../../model/i18n.js";

export async function profileView(ctx) {
  ctx.setTitle(t("nav.profile"));
  const [profile, info, allUsers] = await Promise.all([ctx.app.profile(), ctx.app.dataInfo(), ctx.users.list()]);
  const usersCard = usersSection(ctx, allUsers, ctx.app.learnerId);

  const name = h("input", { id: "profile-name", type: "text", value: profile.name, maxlength: 40, autocomplete: "given-name" });
  const goal = h("select", { id: "profile-goal" }, SESSION_MINUTES.map((m) => h("option", { value: m, selected: m === profile.daily_minutes }, t("common.minutes", m))));
  // P25.2: Sprache der App; P24: Erklärungssprache, unabhängig von der Lernsprache
  const uiSelect = h("select", { id: "profile-ui-language" },
    UI_LANGUAGES.map((id) => h("option", { value: id, selected: id === uiLanguage() }, UI_LANGUAGE_NAMES[id])));
  const explanation = h("select", { id: "profile-explanation", "aria-describedby": "profile-explanation-help" },
    EXPLANATION_LANGUAGES.map((id) => h("option", { value: id, selected: id === profile.explanation_language }, EXPLANATION_LANGUAGE_NAMES[id])));
  const llm = ctx.services.llmAvailable();
  const ai = h("input", { id: "profile-ai", type: "checkbox", checked: profile.ai_analysis, disabled: !llm });
  const status = h("p", { class: "muted small", role: "status" });
  const form = h("form", { class: "form" },
    h("div", { class: "field" }, h("label", { for: "profile-name", class: "label" }, t("profile.name")), name),
    h("div", { class: "field" }, h("label", { for: "profile-goal", class: "label" }, t("home.daily_goal")), goal),
    h("div", { class: "field" }, h("label", { for: "profile-ui-language", class: "label" }, t("profile.ui_language")), uiSelect),
    h("div", { class: "field" }, h("label", { for: "profile-explanation", class: "label" }, t("profile.explanations")), explanation,
      h("p", { id: "profile-explanation-help", class: "muted small" },
        t("profile.explanations_help"))),
    h("div", { class: "field check-field" },
      h("label", { for: "profile-ai" }, ai, t("profile.ai")),
      h("p", { class: "muted small" }, llm
        ? t("profile.ai_on")
        : t("profile.ai_off"))),
    h("button", { type: "submit", class: "btn btn-primary" }, t("common.save")),
    status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const uiChanged = uiSelect.value !== uiLanguage();
      await ctx.app.saveProfile({ name: name.value, daily_minutes: Number(goal.value), ai_analysis: ai.checked, explanation_language: explanation.value,
        ui_language: uiSelect.value });
      await ctx.refreshLearner();
      if (uiChanged) {
        ctx.setUiLanguage(uiSelect.value); // Oberfläche sofort in der neuen Sprache
        return;
      }
      status.textContent = t("common.saved");
    } catch (error) {
      status.textContent = error?.userMessage ?? t("common.save_failed");
    }
  });

  const exportButton = h("button", { type: "button", class: "btn btn-secondary" }, t("profile.backup"));
  exportButton.addEventListener("click", async () => {
    const data = await ctx.app.exportData();
    const filename = `spanisch-ai-sicherung-${data.exported_at.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    // iPhone (installierte App): Herunterladen eines Blobs ist dort unzuverlässig; das Teilen-Menü bietet
    // „In Dateien sichern“. Sonst (Desktop) wie bisher als Download.
    const file = typeof File === "function" ? new File([blob], filename, { type: "application/json" }) : null;
    if (file && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      try {
        await navigator.share({ files: [file], title: t("profile.backup_title") });
      } catch (error) {
        if (error?.name !== "AbortError") ctx.toast(t("profile.backup_failed"));
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const resetButton = h("button", { type: "button", class: "btn btn-danger" }, t("profile.reset"));
  resetButton.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("profile.reset_q"),
      text: t("profile.reset_text", allUsers.length),
      confirmLabel: t("profile.reset_confirm"),
      danger: true,
    });
    if (ok) await ctx.resetAll();
  });

  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, t("nav.profile"))),
    h("div", { class: "grid" },
      usersCard,
      languagesCard(ctx),
      h("section", { class: "card", "aria-labelledby": "settings-title" }, h("h2", { id: "settings-title" }, t("profile.settings", profile.name)), form),
      h("section", { class: "card", "aria-labelledby": "data-title" },
        h("h2", { id: "data-title" }, t("profile.data")),
        h("p", {}, info.persistent
          ? t("profile.local")
          : t("app.no_storage")),
        h("dl", { class: "stats" },
          stat(t("profile.entries"), info.event_count),
          stat(t("profile.since"), info.first_event_at ? new Date(info.first_event_at).toLocaleDateString(t("locale")) : "–"),
          stat(t("profile.content_exercises"), info.exercise_count)),
        h("div", { class: "stack-row" }, exportButton, resetButton)),
      h("section", { class: "card", "aria-labelledby": "app-title" },
        h("h2", { id: "app-title" }, "App"),
        h("ul", { class: "plain" },
          h("li", {}, t("profile.offline"), h("strong", { "data-offline-status": "" }, ctx.offlineStatus())),
          h("li", {}, t("profile.evaluation"), profile.ai_analysis && llm ? t("profile.with_ai") : t("profile.without_ai")),
          h("li", {}, t("profile.speech"), h("strong", { "data-speech-status": "" }, ctx.services.sttAvailable()
            ? t("profile.speech_local", ctx.services.status.stt.model) : t("profile.unavailable"))),
          h("li", {}, t("profile.content_version"), h("code", {}, info.content_version))),
        ctx.debug ? h("a", { class: "btn btn-link", href: "#/debug" }, t("profile.debug")) : null)));
}

/** Nutzer auf diesem Gerät: aktiv, wechseln, löschen (nicht den aktiven), neu anlegen. */
function usersSection(ctx, allUsers, activeId) {
  const status = h("p", { class: "muted small", role: "status" });
  const input = h("input", { id: "new-user-name", type: "text", maxlength: 40, autocomplete: "off" });
  const form = h("form", { class: "form add-user", "data-form": "add-user" },
    h("div", { class: "field" }, h("label", { for: "new-user-name", class: "label" }, t("new_user")), input),
    h("button", { type: "submit", class: "btn btn-secondary" }, t("profile.add")));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const user = await ctx.users.create(input.value);
      status.textContent = t("profile.created", user.display_name);
      ctx.navigate("#/profil");
    } catch (error) {
      status.textContent = error?.message ?? t("profile.create_failed");
    }
  });
  const row = (user) => {
    const active = user.id === activeId;
    return h("li", { class: "user-row", "data-user-id": user.id },
      h("span", { class: "user-name" }, h("strong", {}, user.display_name), active ? h("span", { class: "active-mark" }, t("profile.active")) : null),
      active ? null : h("span", { class: "stack-row user-actions" },
        h("button", { type: "button", class: "btn btn-primary", "data-action": "switch-user", onclick: () => ctx.users.switchTo(user.id) }, t("profile.switch")),
        h("button", {
          type: "button", class: "btn btn-ghost", "data-action": "delete-user",
          onclick: async () => {
            const ok = await confirmDialog({
              title: t("profile.delete_q", user.display_name),
              text: t("profile.delete_text", user.display_name),
              confirmLabel: t("profile.delete"), danger: true,
            });
            if (!ok) return;
            await ctx.users.remove(user.id);
            ctx.navigate("#/profil");
          },
        }, t("profile.delete"))));
  };
  return h("section", { class: "card", "aria-labelledby": "users-title" },
    h("h2", { id: "users-title" }, t("profile.users")),
    h("p", { class: "muted small" }, t("profile.users_text")),
    h("ul", { class: "plain users-list" }, allUsers.map(row)),
    form,
    status);
}

function stat(label, value) {
  return h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, String(value)));
}

/** Lernsprachen: Verweis auf "Meine Sprachen" (Wechseln, Hinzufügen, Einstufen). */
function languagesCard(ctx) {
  const language = ctx.languages.activeInfo();
  return h("section", { class: "card", "aria-labelledby": "languages-title" },
    h("h2", { id: "languages-title" }, t("profile.languages")),
    h("p", {}, t("profile.learning_now"), h("strong", {}, `${language.flag} ${languageName(language.id)}`), t("profile.learning_now_end")),
    h("div", { class: "stack-row" },
      h("a", { class: "btn btn-secondary", href: "#/sprachen", "data-action": "languages" }, t("languages.title")),
      ctx.app.library.empty ? null : h("a", { class: "btn btn-ghost", href: "#/sprachprofil" }, t("profile.language_profile"))));
}
