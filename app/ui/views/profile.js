/** Profil: Nutzer (wechseln, anlegen, löschen), Name und Tagesziel, Daten (Sicherung, Löschen), App-Status. */

import { SESSION_MINUTES } from "../../services/app-service.js";
import { h } from "../dom.js";
import { confirmDialog } from "../components.js";
import { EXPLANATION_LANGUAGES, EXPLANATION_LANGUAGE_NAMES } from "../../model/explain.js";

export async function profileView(ctx) {
  ctx.setTitle("Profil");
  const [profile, info, allUsers] = await Promise.all([ctx.app.profile(), ctx.app.dataInfo(), ctx.users.list()]);
  const usersCard = usersSection(ctx, allUsers, ctx.app.learnerId);

  const name = h("input", { id: "profile-name", type: "text", value: profile.name, maxlength: 40, autocomplete: "given-name" });
  const goal = h("select", { id: "profile-goal" }, SESSION_MINUTES.map((m) => h("option", { value: m, selected: m === profile.daily_minutes }, `${m} Minuten`)));
  // P24: Erklärungssprache, unabhängig von der Lernsprache
  const explanation = h("select", { id: "profile-explanation", "aria-describedby": "profile-explanation-help" },
    EXPLANATION_LANGUAGES.map((id) => h("option", { value: id, selected: id === profile.explanation_language }, EXPLANATION_LANGUAGE_NAMES[id])));
  const llm = ctx.services.llmAvailable();
  const ai = h("input", { id: "profile-ai", type: "checkbox", checked: profile.ai_analysis, disabled: !llm });
  const status = h("p", { class: "muted small", role: "status" });
  const form = h("form", { class: "form" },
    h("div", { class: "field" }, h("label", { for: "profile-name", class: "label" }, "Wie soll dich die App nennen?"), name),
    h("div", { class: "field" }, h("label", { for: "profile-goal", class: "label" }, "Tagesziel"), goal),
    h("div", { class: "field" }, h("label", { for: "profile-explanation", class: "label" }, "Erklärungen auf"), explanation,
      h("p", { id: "profile-explanation-help", class: "muted small" },
        "Gilt für alle Lernsprachen: Rückmeldungen, Grammatik- und Fehlererklärungen, „Warum?“ und „Was als Nächstes?“. Navigation und Aufgabenstellungen bleiben Deutsch.")),
    h("div", { class: "field check-field" },
      h("label", { for: "profile-ai" }, ai, " KI-Zusatzanalyse (lokal)"),
      h("p", { class: "muted small" }, llm
        ? "Ergänzt die Regelbewertung um unbestätigte Hinweise. Sie ändert weder Bewertung noch Lernstand und läuft nur auf diesem PC (einige Sekunden pro Antwort)."
        : "Nicht verfügbar: Dafür muss die App über „python main.py serve“ laufen und das lokale Sprachmodell bereitstehen (siehe docs/sprache.md).")),
    h("button", { type: "submit", class: "btn btn-primary" }, "Speichern"),
    status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await ctx.app.saveProfile({ name: name.value, daily_minutes: Number(goal.value), ai_analysis: ai.checked, explanation_language: explanation.value });
      status.textContent = "Gespeichert.";
      await ctx.refreshLearner();
    } catch (error) {
      status.textContent = error?.userMessage ?? "Konnte nicht gespeichert werden.";
    }
  });

  const exportButton = h("button", { type: "button", class: "btn btn-secondary" }, "Sicherung herunterladen");
  exportButton.addEventListener("click", async () => {
    const data = await ctx.app.exportData();
    const filename = `spanisch-ai-sicherung-${data.exported_at.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    // iPhone (installierte App): Herunterladen eines Blobs ist dort unzuverlässig; das Teilen-Menü bietet
    // „In Dateien sichern“. Sonst (Desktop) wie bisher als Download.
    const file = typeof File === "function" ? new File([blob], filename, { type: "application/json" }) : null;
    if (file && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      try {
        await navigator.share({ files: [file], title: "Sprachtrainer-Sicherung" });
      } catch (error) {
        if (error?.name !== "AbortError") ctx.toast("Die Sicherung konnte nicht geteilt werden.");
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

  const resetButton = h("button", { type: "button", class: "btn btn-danger" }, "Gerät zurücksetzen");
  resetButton.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Gerät zurücksetzen?",
      text: `Das löscht ALLE Nutzer auf diesem Gerät (${allUsers.length}) mit ihrer gesamten Lernhistorie und allen Einstellungen. Das lässt sich nicht rückgängig machen. Einzelne Nutzer löschst du oben unter „Nutzer auf diesem Gerät“.`,
      confirmLabel: "Alles löschen",
      danger: true,
    });
    if (ok) await ctx.resetAll();
  });

  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", {}, "Profil")),
    h("div", { class: "grid" },
      usersCard,
      languagesCard(ctx),
      h("section", { class: "card", "aria-labelledby": "settings-title" }, h("h2", { id: "settings-title" }, `Einstellungen für ${profile.name}`), form),
      h("section", { class: "card", "aria-labelledby": "data-title" },
        h("h2", { id: "data-title" }, "Deine Daten"),
        h("p", {}, info.persistent
          ? "Alles bleibt lokal auf diesem Gerät. Nichts wird in eine Cloud geschickt."
          : "Dieser Browser erlaubt kein dauerhaftes Speichern. Dein Fortschritt geht beim Schließen verloren."),
        h("dl", { class: "stats" },
          stat("Einträge von dir", info.event_count),
          stat("Seit", info.first_event_at ? new Date(info.first_event_at).toLocaleDateString("de-DE") : "–"),
          stat("Übungen im Inhalt", info.exercise_count)),
        h("div", { class: "stack-row" }, exportButton, resetButton)),
      h("section", { class: "card", "aria-labelledby": "app-title" },
        h("h2", { id: "app-title" }, "App"),
        h("ul", { class: "plain" },
          h("li", {}, "Offline: ", h("strong", { "data-offline-status": "" }, ctx.offlineStatus())),
          h("li", {}, "Bewertung: lokal, regelbasiert", profile.ai_analysis && llm ? " + KI-Zusatzhinweise (lokal)" : " (ohne KI)"),
          h("li", {}, "Spracheingabe: ", h("strong", { "data-speech-status": "" }, ctx.services.sttAvailable()
            ? `lokal (${ctx.services.status.stt.model})` : "nicht verfügbar")),
          h("li", {}, "Inhaltsversion: ", h("code", {}, info.content_version))),
        ctx.debug ? h("a", { class: "btn btn-link", href: "#/debug" }, "Entwicklersicht") : null)));
}

/** Nutzer auf diesem Gerät: aktiv, wechseln, löschen (nicht den aktiven), neu anlegen. */
function usersSection(ctx, allUsers, activeId) {
  const status = h("p", { class: "muted small", role: "status" });
  const input = h("input", { id: "new-user-name", type: "text", maxlength: 40, autocomplete: "off" });
  const form = h("form", { class: "form add-user", "data-form": "add-user" },
    h("div", { class: "field" }, h("label", { for: "new-user-name", class: "label" }, "Neuer Nutzer"), input),
    h("button", { type: "submit", class: "btn btn-secondary" }, "Hinzufügen"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const user = await ctx.users.create(input.value);
      status.textContent = `${user.display_name} wurde angelegt.`;
      ctx.navigate("#/profil");
    } catch (error) {
      status.textContent = error?.message ?? "Konnte nicht angelegt werden.";
    }
  });
  const row = (user) => {
    const active = user.id === activeId;
    return h("li", { class: "user-row", "data-user-id": user.id },
      h("span", { class: "user-name" }, h("strong", {}, user.display_name), active ? h("span", { class: "active-mark" }, " · aktiv") : null),
      active ? null : h("span", { class: "stack-row user-actions" },
        h("button", { type: "button", class: "btn btn-primary", "data-action": "switch-user", onclick: () => ctx.users.switchTo(user.id) }, "Wechseln"),
        h("button", {
          type: "button", class: "btn btn-ghost", "data-action": "delete-user",
          onclick: async () => {
            const ok = await confirmDialog({
              title: `${user.display_name} löschen?`,
              text: `Das löscht ${user.display_name} und die gesamte Lernhistorie dieses Nutzers. Andere Nutzer sind nicht betroffen.`,
              confirmLabel: "Löschen", danger: true,
            });
            if (!ok) return;
            await ctx.users.remove(user.id);
            ctx.navigate("#/profil");
          },
        }, "Löschen")));
  };
  return h("section", { class: "card", "aria-labelledby": "users-title" },
    h("h2", { id: "users-title" }, "Nutzer auf diesem Gerät"),
    h("p", { class: "muted small" }, "Jeder Nutzer hat seinen eigenen Lernstand. Nichts wird geteilt."),
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
    h("h2", { id: "languages-title" }, "Lernsprachen"),
    h("p", {}, "Du lernst gerade ", h("strong", {}, `${language.flag} ${language.name_de}`), ". Jede Sprache hat ihren eigenen Lernstand."),
    h("div", { class: "stack-row" },
      h("a", { class: "btn btn-secondary", href: "#/sprachen", "data-action": "languages" }, "Meine Sprachen"),
      ctx.app.library.empty ? null : h("a", { class: "btn btn-ghost", href: "#/sprachprofil" }, "Sprachprofil")));
}
