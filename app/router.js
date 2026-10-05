/**
 * Routen der App (Hash-Routing: funktioniert offline und ohne Server-Konfiguration). DOM-frei.
 *
 *   #/                 home         Heute: nächste Session (Hauptaktion), Rhythmus, Sprachstand
 *   #/lernen           learn        andere Länge wählen (von "Heute" aus, ohne eigenen Reiter)
 *   #/session          session      laufende Session (fokussiert, ohne Navigation)
 *   #/ueben            practice     Themen
 *   #/ueben/<thema>    topic        Übungen eines Themas
 *   #/aufgabe/<id>     exercise     eine einzelne Übung
 *   #/gespraech/<id>   conversation ein Gesprächsszenario (mehrere Runden)
 *   #/sprachen         languages    Meine Sprachen: wechseln, hinzufügen, einstufen (P11B)
 *   #/einstufung       assessment   Einstufung der aktiven Lernsprache
 *   #/sprachprofil     languageProfile  Sprachprofil der aktiven Lernsprache (mit Verlauf)
 *   #/fortschritt      progress     Fortschritt und Fehlerprofil
 *   #/profil           profile      Einstellungen und Daten
 *   #/debug            debug        nur mit ?debug=1: Planung, Ereignisse, Gedächtnis
 */

export const NAV_ITEMS = Object.freeze([
  { route: "home", href: "#/", label: "Heute", icon: "home" },
  { route: "practice", href: "#/ueben", label: "Üben", icon: "pencil" },
  { route: "progress", href: "#/fortschritt", label: "Fortschritt", icon: "chart" },
  { route: "profile", href: "#/profil", label: "Profil", icon: "user" },
]);

const NAV_OF = Object.freeze({
  // P25.7: Lernen gehört zu "Heute" (dort startet die Session); vier Reiter statt fünf
  topic: "practice", exercise: "practice", conversation: "practice", learn: "home", session: "home", debug: "profile",
  languages: "profile", assessment: "home", languageProfile: "progress",
});

/**
 * @param {string} hash     location.hash (mit oder ohne '#')
 * @param {{debug?: boolean}} [options]
 * @returns {{name: string, params: object, nav: string, focus: boolean}}
 *   focus: Ansicht ohne Navigation (Session)
 */
export function parseRoute(hash, { debug = false } = {}) {
  const path = String(hash ?? "").replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  const [head = "", ...rest] = path.split("/").map(safeDecode);
  let route;
  if (head === "") route = { name: "home", params: {} };
  else if (head === "lernen" && !rest.length) route = { name: "learn", params: {} };
  else if (head === "session" && !rest.length) route = { name: "session", params: {} };
  else if (head === "ueben" && !rest.length) route = { name: "practice", params: {} };
  else if (head === "ueben" && rest.length === 1 && rest[0]) route = { name: "topic", params: { topicId: rest[0] } };
  else if (head === "aufgabe" && rest.length === 1 && rest[0]) route = { name: "exercise", params: { exerciseId: rest[0] } };
  else if (head === "gespraech" && rest.length === 1 && rest[0]) route = { name: "conversation", params: { scenarioId: rest[0] } };
  else if (head === "fortschritt" && !rest.length) route = { name: "progress", params: {} };
  else if (head === "profil" && !rest.length) route = { name: "profile", params: {} };
  else if (head === "sprachen" && !rest.length) route = { name: "languages", params: {} };
  else if (head === "einstufung" && !rest.length) route = { name: "assessment", params: {} };
  else if (head === "sprachprofil" && !rest.length) route = { name: "languageProfile", params: {} };
  else if (head === "debug" && debug) route = { name: "debug", params: {} };
  else route = { name: "not_found", params: { path } };
  return { ...route, nav: NAV_OF[route.name] ?? route.name, focus: route.name === "session" };
}

export function hrefFor(name, params = {}) {
  switch (name) {
    case "home": return "#/";
    case "learn": return "#/lernen";
    case "session": return "#/session";
    case "practice": return "#/ueben";
    case "topic": return `#/ueben/${encodeURIComponent(params.topicId)}`;
    case "exercise": return `#/aufgabe/${encodeURIComponent(params.exerciseId)}`;
    case "conversation": return `#/gespraech/${encodeURIComponent(params.scenarioId)}`;
    case "progress": return "#/fortschritt";
    case "profile": return "#/profil";
    case "languages": return "#/sprachen";
    case "assessment": return "#/einstufung";
    case "languageProfile": return "#/sprachprofil";
    case "debug": return "#/debug";
    default: throw new TypeError(`Unbekannte Route: ${name}`);
  }
}

/** ?debug=1 in der Adresse schaltet die Entwicklersicht ein. */
export function isDebug(search) {
  return new URLSearchParams(search ?? "").get("debug") === "1";
}

function safeDecode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
