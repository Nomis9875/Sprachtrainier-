/**
 * Einstieg der App (Composition Root): Speicher wählen, Inhalt laden, App-Service starten,
 * Navigation und Routing, Service Worker, Offline-Anzeige, Fehlerzustände.
 *
 * Nur hier wird entschieden, WELCHER Speicher benutzt wird (IndexedDB, sonst Arbeitsspeicher).
 * Die Lernlogik kennt nur die Speicher-Schnittstelle.
 * Ebenso werden nur hier die optionalen lokalen Dienste (Spracherkennung, KI-Zusatzanalyse des
 * lokalen Servers) angebunden; fehlen sie, läuft die App ohne sie.
 *
 * Lernsprachen (P11B): Das Sprachverzeichnis (content/languages.json) nennt alle Sprachen; je Sprache
 * gibt es ein eigenes Inhaltspaket (content/<sprache>/content-package.json), das bei Bedarf geladen wird.
 * Die App-Instanz gilt für genau einen Lerner in genau einer Sprache; ein Sprachwechsel startet sie neu.
 */

import { emptyContentLibrary, loadContentPackage } from "../core/content/library.js";
import { IndexedDBStorage } from "../core/storage/indexeddb.js";
import { MemoryStorage } from "../core/storage/memory.js";
import { UserDirectory } from "../core/learning/users.js";
import { LearnerApp } from "./services/app-service.js";
import { LocalServices } from "./services/local-services.js";
import { NAV_ITEMS, isDebug, parseRoute } from "./router.js";
import { h, icon, setTargetLanguage } from "./ui/dom.js";
import { dimensionName, levelClaim } from "./model/language.js";
import { choiceDialog, errorState, loading } from "./ui/components.js";
import { debugView } from "./ui/views/debug.js";
import { homeView } from "./ui/views/home.js";
import { learnView } from "./ui/views/learn.js";
import { conversationView } from "./ui/views/conversation.js";
import { exerciseView, practiceView, topicView } from "./ui/views/practice.js";
import { profileView } from "./ui/views/profile.js";
import { progressView } from "./ui/views/progress.js";
import { sessionView } from "./ui/views/session.js";
import { welcomeView } from "./ui/views/welcome.js";
import { assessmentView } from "./ui/views/assessment.js";
import { languageProfileView } from "./ui/views/language-profile.js";
import { languagesView } from "./ui/views/languages.js";
import { onboardingView } from "./ui/views/onboarding.js";
import { defaultName, detectUiLanguage, languageName, onboardingOutcome, setUiLanguage, t, uiLanguage, uiLanguageOf } from "./model/i18n.js";

const LANGUAGES_URL = "content/languages.json";
// Seiten, die auch ohne Inhaltspaket der aktiven Sprache sinnvoll sind
const CONTENTLESS_ROUTES = new Set(["home", "profile", "languages", "languageProfile", "assessment", "debug"]);
const APP_NAME = "Sprachtrainer";

const VIEWS = Object.freeze({
  home: homeView,
  learn: learnView,
  session: sessionView,
  practice: practiceView,
  topic: topicView,
  exercise: exerciseView,
  conversation: conversationView,
  progress: progressView,
  profile: profileView,
  debug: debugView,
  languages: languagesView,
  assessment: assessmentView,
  languageProfile: languageProfileView,
});

const debug = isDebug(location.search);
// Steuerte schon ein Service Worker die Seite? Dann ist ein neuer Worker ein Update.
const hadController = Boolean(navigator.serviceWorker?.controller);
let app = null; // App-Service des AKTIVEN Lerners; bei einem Wechsel neu erzeugt
let storage = null;
let users = null; // Nutzerverzeichnis des Geräts
let registry = null; // Sprachverzeichnis
const libraries = new Map(); // geladene Inhaltspakete je Sprache
let persistent = true;
let renderToken = 0;
const services = new LocalServices();
let aiOn = false; // KI-Zusatzanalyse für den aktiven Lerner eingeschaltet und erreichbar

const main = document.getElementById("main");
const nav = document.getElementById("nav");
const toastBox = document.getElementById("toast");
const offlineBadge = document.getElementById("offline-badge");

boot();

async function boot() {
  main.replaceChildren(loading(t("app.starting")));
  registerServiceWorker();
  watchConnection();
  const capabilities = services.refresh(); // parallel; die App wartet nicht auf lokale Dienste
  let active;
  try {
    registry = await loadRegistry();
    const opened = await openStorage();
    storage = opened.storage;
    persistent = opened.persistent;
    users = new UserDirectory({ storage });
    active = await users.init(); // übernimmt einmalig den bisherigen Einzelnutzer
    // P25.1: Sprache der Oberfläche: des aktiven Nutzers, sonst die des Geräts, sonst aus der Gerätesprache
    applyUiLanguage(active?.preferences?.ui_language ?? (await storage.getMeta(UI_LANGUAGE_META_KEY))
      ?? detectUiLanguage(navigator.languages ?? [navigator.language]));
    if (!persistent) toast(t("app.no_storage"), { timeout: 8000 });
  } catch (error) {
    console.error(error);
    main.replaceChildren(errorState({
      title: t("app.start_failed"),
      text: navigator.onLine
        ? t("app.content_failed")
        : t("app.offline_first"),
      onRetry: () => location.reload(),
    }));
    document.documentElement.dataset.ready = "error";
    return;
  }
  buildNav();
  window.addEventListener("hashchange", render);
  await Promise.race([capabilities, new Promise((resolve) => setTimeout(resolve, 1500))]);
  capabilities.then(() => app && refreshLearner()); // kommt die Antwort später, gilt sie ab der nächsten Ansicht
  if (active) await startLearner(active.id);
  else await showWelcome();
}

/** Die App für genau einen Lerner in seiner aktiven Lernsprache starten (erster Start, Wechsel, Neuanlage). */
async function startLearner(learnerId, { beforeRender = null } = {}) {
  const user = await users.get(learnerId);
  if (user.preferences?.ui_language) applyUiLanguage(user.preferences.ui_language);
  if (!user.languages.length || !user.active_language) {
    await showLanguageSetup(user);
    return;
  }
  const language = user.active_language;
  const library = await libraryFor(language);
  setTargetLanguage(language);
  app = await new LearnerApp({ storage, library, users, learnerId, persistent, assistant: services }).init();
  document.documentElement.dataset.learner = learnerId;
  document.documentElement.dataset.language = language;
  await refreshLearner();
  if (beforeRender) await beforeRender(app);
  await render();
}

/** Neuer Nutzer ohne Lernsprache (im Profil angelegt): Onboarding ab der Lernsprache. */
async function showLanguageSetup(user) {
  showOnboarding({ user });
}

/**
 * P25.1: Onboarding. Erster Start (ohne Nutzer): Sprache der App, Lernsprache, Selbsteinschätzung, Tagesziel (Name
 * optional); für einen schon angelegten Nutzer ab der Lernsprache. Gespeichert wird erst am Ende.
 */
function showOnboarding({ user = null } = {}) {
  app = null;
  updateLearnerBadge();
  document.body.classList.add("focus-mode");
  main.dataset.route = "language-setup";
  main.replaceChildren(onboardingView({
    languages: registry.languages,
    uiLanguage: uiLanguage(),
    askUiLanguage: !user,
    askName: !user,
    onUiLanguage: (id) => {
      applyUiLanguage(id);
      storage.setMeta(UI_LANGUAGE_META_KEY, id).catch((error) => console.error(error));
    },
    onFinish: async ({ ui, learn, level, goal, name }) => {
      let learner = user;
      if (!learner) {
        const existing = (await users.list()).map((u) => u.display_name);
        learner = await users.create(name || defaultName(existing, ui));
        await users.setActive(learner.id);
      }
      await users.updatePreferences(learner.id, {
        daily_minutes: goal, ui_language: ui, explanation_language: ui, ...(user ? {} : { named: Boolean(name) }),
      });
      await users.addLanguage(learner.id, learn);
      await users.setActiveLanguage(learner.id, learn);
      const outcome = onboardingOutcome({ level, hasAssessment: Boolean(languageInfo(learn).assessment) });
      history.replaceState(null, "", outcome.route); // kein hashchange: startLearner zeigt die Seite
      await startLearner(learner.id, {
        beforeRender: outcome.selfAssessment ? (started) => started.recordSelfAssessment(outcome.selfAssessment) : null,
      });
    },
  }));
  document.documentElement.dataset.ready = "true";
}

const UI_LANGUAGE_META_KEY = "ui_language";

function applyUiLanguage(language) {
  setUiLanguage(uiLanguageOf(language));
  document.documentElement.lang = uiLanguage();
  // statische Texte der Hülle (index.html) und die Navigation in der Sprache der App
  offlineBadge.textContent = t("app.offline_badge");
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("app.skip");
  if (nav.childElementCount) buildNav();
}

/**
 * Lernsprache wechseln. Offene Session, laufendes Gespräch oder laufende Einstufung gehören zur bisherigen
 * Sprache: Sie werden auf Wunsch pausiert oder beendet, nie in der anderen Sprache fortgesetzt.
 */
async function switchLanguage(languageId, { silent = false } = {}) {
  if (!app || languageId === app.languageId) return true;
  if (!(await settleOpenWork(app, "language_switch"))) return false;
  const learnerId = app.learnerId;
  await users.setActiveLanguage(learnerId, languageId);
  if (!silent && location.hash !== "#/") history.replaceState(null, "", "#/");
  await startLearner(learnerId);
  if (!silent) toast(t("app.now_learning", languageName(languageId, { capital: uiLanguage() === "de" })));
  return true;
}

async function addLanguage(languageId) {
  await users.addLanguage(app.learnerId, languageId);
  const switched = await switchLanguage(languageId, { silent: true });
  if (switched) location.hash = languageInfo(languageId).assessment ? "#/einstufung" : "#/sprachen";
}

function languageInfo(id) {
  return registry.languages.find((l) => l.id === id) ?? { id, name_de: id, native_name: id, flag: "", enabled: false, assessment: false, stt: id };
}

/** Übersicht "Meine Sprachen": Stufe je Sprache aus dem jeweiligen Sprachprofil (je eine kurze App-Instanz). */
async function languagesOverview() {
  const user = await users.get(app.learnerId);
  const mine = [];
  for (const id of user.languages) {
    const info = languageInfo(id);
    let level = { text: "–", detail: t("app.no_data") };
    let assessed = false;
    if (info.enabled) {
      const other = id === app.languageId ? app : await new LearnerApp({ storage, library: await libraryFor(id), users, learnerId: app.learnerId, persistent }).init();
      const profile = await other.languageProfile();
      level = { text: profile.overall.text, detail: profile.overall.detail };
      assessed = Boolean(profile.last_assessment);
    }
    mine.push({ ...info, level, assessed });
  }
  return { active: app.languageId, mine, addable: registry.languages.filter((l) => !user.languages.includes(l.id)) };
}

async function showWelcome() {
  const all = await users.list();
  if (!all.length) {
    showOnboarding(); // P25.1: erster Start
    return;
  }
  app = null;
  document.body.classList.add("focus-mode");
  main.dataset.route = "welcome";
  main.replaceChildren(welcomeView({
    users: all,
    onCreate: async (name) => {
      const user = await users.create(name);
      await users.setActive(user.id);
      history.replaceState(null, "", "#/");
      await startLearner(user.id);
    },
    onChoose: async (id) => {
      await users.setActive(id);
      history.replaceState(null, "", "#/");
      await startLearner(id);
    },
  }));
  document.documentElement.dataset.ready = "true";
}

/** Nach Start oder Profiländerung: Anzeige des aktiven Lerners und seine KI-Einstellung. */
async function refreshLearner() {
  await updateLearnerBadge();
  aiOn = Boolean(app) && services.llmAvailable() && (await app.aiEnabled());
  document.documentElement.dataset.speech = services.sttAvailable() ? "on" : "off";
}

async function updateLearnerBadge() {
  const badge = nav.querySelector(".learner-badge");
  const learner = app ? await app.learner() : null;
  if (badge) {
    badge.hidden = !learner;
    badge.querySelector(".learner-name").textContent = learner?.display_name ?? "";
    const language = app ? languageInfo(app.languageId) : null;
    const tag = badge.querySelector(".learner-language");
    tag.textContent = language ? language.id.toUpperCase() : "";
    tag.title = language ? `Lernsprache: ${language.name_de}` : "";
  }
}

/**
 * Offene Arbeit vor einem Nutzer- oder Sprachwechsel klären: Session, laufendes Gespräch und laufende
 * Einstufung gehören dem bisherigen Lerner in der bisherigen Sprache. Auf Wunsch pausiert oder beendet,
 * nie mit einem anderen Lerner oder in einer anderen Sprache fortgesetzt; "Abbrechen" lässt alles, wie es ist.
 * @returns {Promise<boolean>} false: Wechsel abgebrochen
 */
async function settleOpenWork(current, reason) {
  const [open, conversation, assessment] = await Promise.all([
    current.openSession(), current.openConversation(), current.assessments.open(),
  ]);
  const running = conversation && conversation.status === "active" ? conversation : null;
  const assessing = assessment && assessment.status === "in_progress" ? assessment : null;
  const parts = [open && t("work.session"), running && t("work.conversation"), assessing && t("work.assessment")].filter(Boolean);
  if (!parts.length) return true;
  const learner = await current.learner();
  const choice = await choiceDialog({
    title: t("work.title", learner.display_name, parts.join(t("work.and"))),
    text: reason === "language_switch"
      ? t("work.language")
      : t("work.learner"),
    choices: [
      { value: "pause", label: t("work.pause"), variant: "primary" },
      { value: "abandon", label: t("work.abandon"), variant: "secondary" },
      { value: "cancel", label: t("common.cancel"), variant: "link" },
    ],
  });
  if (!choice || choice === "cancel") return false;
  if (open && choice === "pause" && open.status === "active") await current.pauseSession(open.session_id);
  if (open && choice === "abandon") await current.abandonSession(open.session_id);
  if (running && choice === "pause") await current.pauseConversation(running.conversation_id, reason);
  if (running && choice === "abandon") await current.abandonConversation(running.conversation_id);
  if (assessing && choice === "pause") await current.pauseAssessment(assessing.assessment_id, reason);
  if (assessing && choice === "abandon") await current.abandonAssessment(assessing.assessment_id);
  return true;
}

/** Nutzer wechseln (offene Arbeit siehe settleOpenWork). */
async function switchLearner(userId) {
  if (app && userId === app.learnerId) return true;
  if (app && !(await settleOpenWork(app, "learner_switch"))) return false;
  await users.setActive(userId);
  if (location.hash !== "#/") history.replaceState(null, "", "#/");
  await startLearner(userId);
  if (app) toast(t("app.now_learner", (await app.learner()).display_name));
  return true;
}

async function loadRegistry() {
  const response = await fetch(LANGUAGES_URL);
  if (!response.ok) throw new Error(`Sprachverzeichnis: HTTP ${response.status}`);
  return response.json();
}

/** Inhaltspaket einer Sprache (einmal geladen); ohne Paket eine leere Bibliothek ("Inhalte in Vorbereitung"). */
async function libraryFor(languageId) {
  if (!libraries.has(languageId)) {
    const info = languageInfo(languageId);
    if (!info.enabled || !info.package) {
      libraries.set(languageId, emptyContentLibrary(languageId));
    } else {
      const response = await fetch(info.package);
      if (!response.ok) throw new Error(`Inhaltspaket ${languageId}: HTTP ${response.status}`);
      libraries.set(languageId, loadContentPackage(await response.json()));
    }
  }
  return libraries.get(languageId);
}

async function openStorage() {
  try {
    return { storage: await IndexedDBStorage.open(), persistent: true };
  } catch (error) {
    console.warn("IndexedDB nicht verfügbar, Speicher nur im Arbeitsspeicher", error);
    return { storage: new MemoryStorage(), persistent: false };
  }
}

// ---------------------------------------------------------------- Navigation und Routing

function buildNav() {
  nav.replaceChildren(
    h("a", { class: "brand", href: "#/", "aria-label": t("app.home_label", APP_NAME) },
      h("img", { src: "icons/icon.svg", alt: "", width: 32, height: 32 }), h("span", {}, APP_NAME)),
    h("a", { class: "learner-badge", href: "#/profil", hidden: true, title: t("app.active_user") },
      icon("user", { size: 18 }), h("span", { class: "sr-only" }, t("app.active_user_sr")), h("span", { class: "learner-name" }),
      h("span", { class: "learner-language", "aria-label": t("app.learning_language") })),
    h("ul", { class: "nav-list" }, NAV_ITEMS.map((item) => h("li", {},
      h("a", { class: "nav-link", href: item.href, "data-route": item.route }, icon(item.icon), h("span", { class: "nav-label" }, t(`nav.${item.route}`)))))));
}

async function render() {
  if (!app) return main.dataset.route === "language-setup" ? undefined : showWelcome();
  const token = ++renderToken;
  const route = parseRoute(location.hash, { debug });
  document.body.classList.toggle("focus-mode", route.focus);
  for (const link of nav.querySelectorAll(".nav-link")) {
    if (link.dataset.route === route.nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (route.name === "not_found" || (app.library.empty && !CONTENTLESS_ROUTES.has(route.name))) {
    history.replaceState(null, "", "#/");
    return render();
  }
  main.dataset.route = route.name;
  main.setAttribute("aria-busy", "true");
  const slow = setTimeout(() => token === renderToken && main.replaceChildren(loading()), 150);
  let view;
  try {
    view = await VIEWS[route.name](context(), route.params);
  } catch (error) {
    console.error(error);
    view = errorState({
      title: route.name === "session" ? t("app.session_failed") : t("app.page_failed"),
      text: error?.userMessage ?? null,
      onRetry: render,
    });
  } finally {
    clearTimeout(slow);
  }
  if (token !== renderToken) return; // inzwischen weiter navigiert
  main.replaceChildren(view);
  main.removeAttribute("aria-busy");
  window.scrollTo(0, 0);
  if (!main.contains(document.activeElement) || document.activeElement === document.body) {
    const heading = main.querySelector("h1");
    if (heading && route.name !== "session") {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
  document.documentElement.dataset.ready = "true";
}

function context() {
  return {
    app,
    debug,
    navigate: (hash) => {
      if (location.hash === hash) render();
      else location.hash = hash;
    },
    setTitle: (title) => { document.title = `${title} · ${APP_NAME}`; },
    toast,
    offlineStatus,
    resetAll,
    users: {
      list: () => users.list(),
      active: () => app.learner(),
      switchTo: switchLearner,
      create: async (name) => users.create(name),
      remove: async (id) => users.delete(id),
    },
    refreshLearner,
    // P25.2: Sprache der App ändern (Profil): gespeichert am Nutzer und am Gerät, Ansicht neu
    setUiLanguage: (id) => {
      applyUiLanguage(id);
      storage.setMeta(UI_LANGUAGE_META_KEY, id).catch((error) => console.error(error));
      render();
    },
    services,
    languages: {
      registry: () => registry.languages,
      activeInfo: () => languageInfo(app.languageId),
      overview: languagesOverview,
      switchTo: switchLanguage,
      add: addLanguage,
    },
    labels: { dimension: dimensionName, level: levelClaim },
    // Spracherkennung in der aktiven Lernsprache (Whisper-Sprachcode aus dem Sprachverzeichnis)
    speech: services.sttAvailable() && app
      ? { transcribe: (wav, options = {}) => services.transcribe(wav, { ...options, language: languageInfo(app.languageId).stt }) }
      : null,
    aiAnalysis: aiOn,
  };
}

// ---------------------------------------------------------------- Daten löschen

async function resetAll() {
  try {
    await storage.close();
    if (storage instanceof IndexedDBStorage) await IndexedDBStorage.destroy();
    location.hash = "#/";
    location.reload();
  } catch (error) {
    console.error(error);
    toast(error?.message?.includes("anderen Tab")
      ? t("app.other_tab")
      : t("app.delete_failed"));
  }
}

// ---------------------------------------------------------------- Hinweise

let toastTimer = null;
function toast(text, { timeout = 5000, action = null } = {}) {
  clearTimeout(toastTimer);
  toastBox.replaceChildren(h("div", { class: "toast" }, h("span", {}, text),
    action ? h("button", { type: "button", class: "btn btn-link", onclick: action.run }, action.label) : null));
  toastBox.hidden = false;
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, timeout);
}

function watchConnection() {
  const update = () => { offlineBadge.hidden = navigator.onLine; };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function offlineStatus() {
  if (!("serviceWorker" in navigator)) return t("app.sw_unsupported");
  return navigator.serviceWorker.controller ? t("app.sw_ready") : t("app.sw_setup");
}

// ---------------------------------------------------------------- Service Worker

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Lernstand nicht automatisch vom Browser räumen lassen, wenn der Speicher knapp wird (wo unterstützt)
  navigator.storage?.persist?.().catch(() => {});
  navigator.serviceWorker.register("service-worker.js").then((registration) => {
    // Beim Start ausdrücklich nach einer neuen Version fragen: Die automatische Prüfung des Browsers
    // kommt nicht verlässlich zeitnah (in der Abnahme blieb eine ganze Sitzung lang die alte Version).
    registration.update().catch(() => { /* offline: keine Prüfung möglich, die App läuft aus dem Cache */ });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        // Nur ein UPDATE melden: Beim ersten Einrichten gibt es noch keinen steuernden Worker
        if (worker.state === "activated" && hadController) {
          toast(t("app.new_version"), { timeout: 15000, action: { label: t("app.reload"), run: () => location.reload() } });
        } else if (worker.state === "activated") {
          // erstes Einrichten fertig: Ab jetzt läuft die App ohne Verbindung (wichtig auf dem iPhone nach der Installation)
          toast(t("app.offline_ready"), { timeout: 8000 });
        }
      });
    });
  }).catch((error) => console.warn("Service Worker nicht registriert", error));
}
