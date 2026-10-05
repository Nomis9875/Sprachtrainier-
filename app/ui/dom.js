/**
 * Kleine DOM-Hilfen. Texte werden immer als Textknoten gesetzt (nie als HTML), damit Antworten
 * und Inhalte nichts einschleusen können.
 */

/**
 * h("button", {class: "btn", onclick: fn, disabled: true}, "Text", child, [more])
 * Attribute: class, text, dataset-Werte (data-*), aria-*, on<event>, boolesche Attribute.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** SVG-Symbole (einfarbig, currentColor), inline: funktionieren offline. */
// Aktive Lernsprache für lang-Attribute (Aussprache der Vorlesefunktion, Silbentrennung, Rechtschreibung)
let targetLanguage = "es";

export function setTargetLanguage(code) {
  targetLanguage = code;
}

export function targetLang() {
  return targetLanguage;
}

const ICONS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
  pencil: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  back: "M15 18l-6-6 6-6",
  close: "M6 6l12 12M18 6 6 18",
  pause: "M8 5v14M16 5v14",
  check: "M5 12.5l4.5 4.5L19 7",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.6 13.9 7 21l5-3 5 3-1.6-7.1",
  calendar: "M4 6.5h16V21H4zM4 10.5h16M8.5 3v4M15.5 3v4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  stop: "M7 7h10v10H7z",
  alert: "M12 8v5M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 11v6M12 7h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z",
  repeat: "M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z",
  flame: "M12 22c4 0 7-2.7 7-6.8 0-3.4-2.3-5.8-4-7.7-.4 1.8-1.4 3-2.6 3.5.4-3-1-6.3-3.9-8 .3 3.2-1.6 5.3-3 7.2A8.7 8.7 0 0 0 5 15.2C5 19.3 8 22 12 22z",
  offline: "M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.3-2.6M19 12.9a10 10 0 0 0-2.1-1.6M1.4 9a15 15 0 0 1 4.4-2.8M22.6 9A15 15 0 0 0 10.7 5.1M12 20h.01",
});

export function icon(name, { label = null, size = 22 } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "icon");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.info);
  svg.append(path);
  return svg;
}

/** Fortschrittsbalken mit Text für Screenreader (Wert 0..1). */
export function meter(value, label) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return h("div", { class: "meter", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, "aria-label": label },
    h("div", { class: "meter-fill", style: { width: `${percent}%` } }));
}
