/**
 * Sprache der Oberfläche (P25.1): Deutsch oder Spanisch, gewählt beim ersten Start (Vorauswahl aus der Gerätesprache).
 * Kein Framework: ein Wörterbuch je Sprache, Schlüssel → Text oder Funktion. Fehlt ein Schlüssel, gilt Deutsch.
 * P25.1 deckt das Onboarding und die Nutzerwahl ab; die übrigen Ansichten folgen (P25.2).
 *
 * Unabhängig davon: die Lernsprache (was gelernt wird) und die Erklärungssprache (explain.js, P24). Beim Onboarding
 * wird die Erklärungssprache auf die gewählte Oberflächensprache gesetzt; im Profil bleibt sie getrennt änderbar.
 */

import { STRINGS } from "./strings.js";

export const UI_LANGUAGES = Object.freeze(["de", "es"]);
export const UI_LANGUAGE_NAMES = Object.freeze({ de: "Deutsch", es: "Español" });

/** Selbsteinschätzung im Onboarding: A0 (Neuanfang, ohne Einstufung) bis C1, oder "weiß ich nicht" (Einstufung). */
export const ONBOARDING_LEVELS = Object.freeze(["A0", "A1", "A2", "B1", "B2", "C1", "unknown"]);
export const ONBOARDING_GOALS = Object.freeze([5, 10, 20, 30]);

const DICTIONARY = Object.freeze({
  de: {
    step: (n, total) => `Schritt ${n} von ${total}`,
    next: "Weiter",
    back: "Zurück",
    start: "Los geht's",
    // P25.5: App-Sprache als beschriftete Einstellung auf dem ersten Screen (kein eigener Schritt mehr)
    app_intro: "Dein persönlicher Sprachtrainer. Erst finden wir heraus, was du schon kannst. Danach plant die App jede Session für dich.",
    ui_bar: "Sprache der App",
    ui_bar_hint: "für Menüs und Erklärungen",
    learn_title: "Welche Sprache möchtest du lernen?",
    learn_lead: "Das ist die Sprache, die du üben möchtest. Weitere kannst du später hinzufügen.",
    learn_range: (from, to) => `Niveau ${from}–${to}`,
    learn_soon: "Inhalte in Vorbereitung",
    learn_missing: "Bitte wähle eine Sprache.",
    level_title: (language) => `Wie gut kannst du ${language} schon?`,
    level_lead: "Eine grobe Einschätzung genügt. Die kurze Einstufung danach findet dein Niveau genauer heraus.",
    level_missing: "Bitte wähle eine Antwort.",
    levels: {
      A0: ["Neuanfang", "Ich fange bei null an."],
      A1: ["A1", "Erste Wörter und einfache Sätze"],
      A2: ["A2", "Einfache Gespräche im Alltag"],
      B1: ["B1", "Ich komme im Alltag gut zurecht."],
      B2: ["B2", "Ich spreche fließend über viele Themen."],
      C1: ["C1", "Ich drücke mich sicher und differenziert aus."],
      unknown: ["Ich weiß es nicht", "Die Einstufung findet es heraus."],
    },
    level_below_range: (language, from) => `${language} ist für die Stufen ab ${from} ausgelegt. Für niedrigere Stufen gibt es keine eigenen Übungen.`,
    level_few: (language, level, n) => `Für ${level} gibt es in ${language} derzeit erst ${n} Übungen. Das Angebot wird laufend ausgebaut.`,
    goal_title: "Dein tägliches Lernziel",
    goal_lead: "Regelmäßig zählt mehr als lang. Du kannst das Ziel später im Profil ändern.",
    goal_option: (minutes) => `${minutes} Min. täglich`,
    goal_hint: { 5: "Kurz und regelmäßig", 10: "Ausgewogen", 20: "Intensiv", 30: "Sehr intensiv" },
    name_label: "Wie sollen wir dich nennen? (optional)",
    default_name: "Ich",
    language_names: { de: "Deutsch", es: "Spanisch", en: "Englisch", fr: "Französisch" },
    welcome_title: "Willkommen zurück",
    welcome_lead: "Wer lernt gerade? Jeder Nutzer hat seinen eigenen Lernstand.",
    choose_user: "Nutzer wählen",
    new_user: "Neuer Nutzer",
    create_user: "Nutzer anlegen",
    failed: "Das hat nicht geklappt.",
  },
  es: {
    step: (n, total) => `Paso ${n} de ${total}`,
    next: "Continuar",
    back: "Atrás",
    start: "Empezar",
    app_intro: "Tu entrenador personal de idiomas. Primero vemos lo que ya sabes. Después, la app planifica cada sesión para ti.",
    ui_bar: "Idioma de la app",
    ui_bar_hint: "para menús y explicaciones",
    learn_title: "¿Qué idioma quieres aprender?",
    learn_lead: "Es el idioma que quieres practicar. Más adelante puedes añadir otros.",
    learn_range: (from, to) => `Nivel ${from}–${to}`,
    learn_soon: "Contenido en preparación",
    learn_missing: "Elige un idioma.",
    level_title: (language) => `¿Qué nivel de ${language} tienes?`,
    level_lead: "Basta con una idea aproximada. La breve prueba de nivel posterior lo precisa.",
    level_missing: "Elige una respuesta.",
    levels: {
      A0: ["Desde cero", "Empiezo sin conocimientos."],
      A1: ["A1", "Primeras palabras y frases sencillas"],
      A2: ["A2", "Conversaciones sencillas del día a día"],
      B1: ["B1", "Me desenvuelvo bien en el día a día."],
      B2: ["B2", "Hablo con fluidez sobre muchos temas."],
      C1: ["C1", "Me expreso con seguridad y matices."],
      unknown: ["No lo sé", "La prueba de nivel lo averigua."],
    },
    level_below_range: (language, from) => `El ${language} está pensado a partir del nivel ${from}. Para niveles más bajos no hay ejercicios propios.`,
    level_few: (language, level, n) => `Para ${level} en ${language} hay por ahora solo ${n} ejercicios. La oferta se amplía continuamente.`,
    goal_title: "Tu objetivo diario",
    goal_lead: "La constancia cuenta más que la duración. Puedes cambiarlo después en el perfil.",
    goal_option: (minutes) => `${minutes} min al día`,
    goal_hint: { 5: "Breve y constante", 10: "Equilibrado", 20: "Intensivo", 30: "Muy intensivo" },
    name_label: "¿Cómo te llamamos? (opcional)",
    default_name: "Yo",
    language_names: { de: "alemán", es: "español", en: "inglés", fr: "francés" },
    welcome_title: "Bienvenido de nuevo",
    welcome_lead: "¿Quién aprende ahora? Cada perfil tiene su propio progreso.",
    choose_user: "Elegir perfil",
    new_user: "Nuevo perfil",
    create_user: "Crear perfil",
    failed: "No ha funcionado.",
  },
});

let current = "de";

export function uiLanguageOf(value) {
  return UI_LANGUAGES.includes(value) ? value : "de";
}

/** Vorauswahl aus den Gerätesprachen (navigator.languages): Spanisch, sonst Deutsch. */
export function detectUiLanguage(languages = []) {
  const first = languages.map((l) => String(l).toLowerCase().slice(0, 2)).find((l) => UI_LANGUAGES.includes(l));
  return first ?? "de";
}

export function setUiLanguage(language) {
  current = uiLanguageOf(language);
}

export function uiLanguage() {
  return current;
}

/** Text der Oberfläche in der aktuellen (oder angegebenen) Sprache; Funktionen bekommen die Parameter. */
export function t(key, ...params) {
  return translate(current, key, ...params);
}

export function translate(language, key, ...params) {
  const lang = uiLanguageOf(language);
  const pair = STRINGS[key];
  const entry = DICTIONARY[lang][key] ?? DICTIONARY.de[key] ?? (pair ? pair[lang === "es" ? 1 : 0] ?? pair[0] : undefined);
  return typeof entry === "function" ? entry(...params) : entry;
}

/** Name einer Lernsprache in der Sprache der App ("Spanisch" / "español"); capital: am Satzanfang groß. */
export function languageName(id, { capital = true, language = current } = {}) {
  const name = translate(language, "language_names")[id] ?? id;
  return capital ? name[0].toLocaleUpperCase() + name.slice(1) : name;
}

/**
 * Was nach dem Onboarding passiert (DOM-frei, getestet):
 *   A0       ohne Einstufung zur Startseite (Neuanfang, die App beginnt bei den leichtesten Übungen)
 *   A1–C1    Selbsteinschätzung speichern (Startpunkt, keine Kompetenz) → Einstufung
 *   unknown  Einstufung ohne Selbsteinschätzung
 * Ohne Einstufungsinhalte der Sprache geht es immer zur Startseite.
 */
export function onboardingOutcome({ level, hasAssessment }) {
  const selfAssessment = ["A1", "A2", "B1", "B2", "C1"].includes(level) ? level : null;
  const route = level === "A0" || !hasAssessment ? "#/" : "#/einstufung";
  return { selfAssessment, route };
}

/** Liegt die Selbsteinschätzung unter dem Zielbereich der Sprache (z. B. A1 bei Englisch B1–C2)? A0 zählt als A1. */
export function belowRange(level, range) {
  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const own = level === "A0" ? "A1" : level;
  return Boolean(range?.[0]) && order.includes(own) && order.indexOf(own) < order.indexOf(range[0]);
}

/** Ab so wenigen Übungen auf einer Stufe sagt das Onboarding ehrlich, dass es dort derzeit noch wenig gibt. */
export const FEW_EXERCISES = 40;

/** Übungen auf der gewählten Stufe im aktuellen Inhalt (A0 zählt als A1); null, wenn unbekannt oder "weiß nicht". */
export function exercisesAtLevel(level, counts) {
  if (!counts || level === "unknown") return null;
  return counts[level === "A0" ? "A1" : level] ?? 0;
}

/** Name ohne Eingabe: "Ich" bzw. "Yo", bei Gleichnamigen mit Nummer ("Ich 2"). */
export function defaultName(existingNames, language) {
  const base = translate(language, "default_name");
  const taken = new Set(existingNames.map((n) => n.toLocaleLowerCase("de")));
  if (!taken.has(base.toLocaleLowerCase("de"))) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLocaleLowerCase("de"))) n += 1;
  return `${base} ${n}`;
}
