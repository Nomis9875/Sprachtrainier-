/**
 * Erklärungssprache (P24): Deutsch oder Spanisch, unabhängig von der Lernsprache (Französisch lernen, Erklärung auf
 * Spanisch). Kein Übersetzungssystem: Deutsch bleibt die Quelle (Kern, Inhalt, App); für Spanisch gibt es
 *   - die Erklärungstexte der App (dieses Modul, EXPLAIN),
 *   - Titel und Erklärung jeder Struktur und jedes typischen Fehlers (Inhalt: content/<sprache>/l10n_es.toml),
 *   - die festen, vom Kern erzeugten Meldungen (Mindestwortzahl, Wiederholung, Akzente …), hier nachgebildet.
 * Feste Aufgabenanweisungen übersetzt instructions.js (P25.4a). Was es nur auf Deutsch gibt (Rückmeldungen einzelner
 * Übungen, Aufgaben mit eigenem Inhalt, Bedeutungsangaben), erscheint auf Deutsch. Die Oberfläche folgt der Sprache
 * der App (i18n.js, strings.js).
 */

import { STRINGS } from "./strings.js";

export const EXPLANATION_LANGUAGES = Object.freeze(["de", "es"]);
export const EXPLANATION_LANGUAGE_NAMES = Object.freeze({ de: "Deutsch", es: "Español" });

/** Erklärungstexte der App je Sprache (Schlüssel → Text oder Funktion). Deutsch ist Quelle und Rückfall. */
const EXPLAIN = Object.freeze({
  de: {
    verdict_correct: "Richtig",
    verdict_incorrect: "Nicht ganz",
    verdict_no_errors: "Keine Fehler gefunden",
    verdict_not_evaluated: "Nicht automatisch bewertet",
    verdict_far: "Mit der Lösung vergleichen",
    far_message: "Deine Antwort weicht deutlich von der erwarteten Lösung ab. Vergleiche sie mit der Lösung unten.",
    you_wrote: "Du hast geschrieben",
    you_said: "Du hast gesagt",
    model_answer: "Musterantwort",
    could_sound: "So könnte es klingen",
    well_done: "Gut umgesetzt: ",
    more_hints: "Weitere Hinweise",
    alternatives: "Weitere richtige Antworten",
    phrases: "Nützliche Redemittel",
    recurring: "wiederkehrend",
    transcript: "Das wurde gesagt",
    why: "Warum? ",
    open_note: "Offen: freie Antworten, bei denen die Regeln keinen Fehler gefunden haben, die aber nicht sicher als richtig gelten. Sie zählen nicht als Fehler.",
    severity: { error: "Fehler", goal: "Aufgabenziel", naturalness: "Natürlichkeit", upgrade: "C1-Ausdruck", hint: "Hinweis" },
    hints: {
      error_focus: "Das war zuletzt schwierig", review: "Heute zur Wiederholung", production: "Jetzt frei anwenden",
      consolidate: "Zum Festigen", new: "Neu für dich", challenge: "Anspruchsvoll anwenden",
    },
    reason: {
      error: "Das ist dir zuletzt nicht gelungen. Darum kommt es heute gezielt noch einmal dran.",
      review: "Fällig zur Wiederholung: kurz abrufen, damit es im Gedächtnis bleibt.",
      measurement: "Hier wissen wir noch wenig über dich. Die Aufgabe hilft, dein Niveau genauer einzuschätzen; ein Fehler ist dabei kein Problem.",
      production: "Du kennst das schon. Jetzt geht es darum, es frei zu verwenden.",
      weakest: "Dieser Bereich liegt bei dir gerade unter deinem übrigen Niveau. Darum üben wir ihn heute öfter.",
      stretch: "Etwas über deinem jetzigen Niveau, damit du weiterkommst.",
      consolidate: "Schon eingeführt. Jetzt festigen, damit es sicher wird.",
      new: "Neu für dich und passend zu deinem Niveau.",
    },
    error_title: (label) => `Typischer Fehler „${label}“`,
    outlook_weak: (list) => `Zuerst arbeiten wir gezielt an: ${list}. Dieser Bereich liegt unter deinem übrigen Niveau.`,
    outlook_reading: "Lesetexte gibt es wenige; sie kommen nicht in jede Session. Gezielt üben: Üben → Hören und Lesen.",
    outlook_even: "Kein Bereich liegt nachweislich unter deinem übrigen Niveau. Die Sessions üben auf deinem Niveau und festigen, was noch unsicher ist.",
    outlook_unmeasured: (list) => `Noch nicht gemessen: ${list}. Das ist keine Schwäche, es gibt nur noch zu wenige Antworten. Die nächsten Sessions enthalten passende Aufgaben.`,
    dimensions: {
      grammar: "Grammatik", vocabulary: "Wortschatz", reading: "Leseverstehen", listening: "Hörverstehen",
      production: "Schreiben", conversation: "Sprechen im Gespräch",
    },
  },
  es: {
    verdict_correct: "Correcto",
    verdict_incorrect: "Aún no es correcto",
    verdict_no_errors: "No se han encontrado errores",
    verdict_not_evaluated: "Sin evaluación automática",
    verdict_far: "Compárala con la solución",
    far_message: "Tu respuesta se aleja bastante de la solución esperada. Compárala con la solución de abajo.",
    you_wrote: "Has escrito",
    you_said: "Has dicho",
    model_answer: "Respuesta modelo",
    could_sound: "Así podría sonar",
    well_done: "Bien aplicado: ",
    more_hints: "Más indicaciones",
    alternatives: "Otras respuestas correctas",
    phrases: "Expresiones útiles",
    recurring: "recurrente",
    transcript: "Esto es lo que se dijo",
    why: "¿Por qué? ",
    open_note: "Abiertas: respuestas libres en las que las reglas no han encontrado errores, pero que no se pueden dar por correctas con seguridad. No cuentan como errores.",
    severity: { error: "Error", goal: "Objetivo", naturalness: "Naturalidad", upgrade: "Expresión C1", hint: "Indicación" },
    hints: {
      error_focus: "Te costó la última vez", review: "Repaso de hoy", production: "Ahora, uso libre",
      consolidate: "Para afianzar", new: "Nuevo para ti", challenge: "Aplicación exigente",
    },
    reason: {
      error: "La última vez no te salió. Por eso vuelve hoy de forma específica.",
      review: "Toca repasarlo: recordarlo un momento para que se quede en la memoria.",
      measurement: "Todavía sabemos poco de ti en este punto. La tarea ayuda a estimar mejor tu nivel; equivocarse aquí no es ningún problema.",
      production: "Ya lo conoces. Ahora se trata de usarlo con libertad.",
      weakest: "Esta área está ahora por debajo de tu nivel general. Por eso la practicamos más hoy.",
      stretch: "Un poco por encima de tu nivel actual, para que sigas avanzando.",
      consolidate: "Ya lo has visto. Ahora toca afianzarlo para que sea seguro.",
      new: "Nuevo para ti y adecuado a tu nivel.",
    },
    error_title: (label) => `Error típico «${label}»`,
    outlook_weak: (list) => `Primero trabajamos de forma específica: ${list}. Esta área está por debajo de tu nivel general.`,
    outlook_reading: "Hay pocos textos de lectura y no aparecen en todas las sesiones. Para practicarlos: Practicar → Escuchar y leer.",
    outlook_even: "Ninguna área está claramente por debajo de tu nivel general. Las sesiones practican a tu nivel y afianzan lo que aún no es seguro.",
    outlook_unmeasured: (list) => `Aún sin medir: ${list}. No es una debilidad: simplemente todavía hay pocas respuestas. Las próximas sesiones incluyen tareas para ello.`,
    dimensions: {
      grammar: "Gramática", vocabulary: "Vocabulario", reading: "Comprensión lectora", listening: "Comprensión auditiva",
      production: "Expresión escrita", conversation: "Conversación",
    },
  },
});

export function explanationLanguageOf(value) {
  return EXPLANATION_LANGUAGES.includes(value) ? value : "de";
}

/** Erklärungstext der App; Funktionen bekommen die Parameter. Fehlt der Schlüssel, gilt Deutsch. */
export function explain(language, key, ...params) {
  const entry = EXPLAIN[explanationLanguageOf(language)][key] ?? EXPLAIN.de[key];
  return typeof entry === "function" ? entry(...params) : entry;
}

/** Name eines Skills als Schwerpunkt oder in Listen; Strukturen und Fehler in der Erklärungssprache. */
export function localizedSkillLabel(skill, library, language) {
  if (!skill) return null;
  if (language !== "de" && library?.localization) {
    const kind = skill.type === "common_error" ? "error" : skill.type === "grammar_structure" ? "rule" : null;
    const localized = kind ? library.localization(language, kind, skill.ref_id) : null;
    if (localized) return localized.title;
  }
  return skill.label;
}

// ---------------------------------------------------------------- Meldungen des Kerns (P24, nur Spanisch)

const TARGET_LANGUAGE_ES = Object.freeze({ es: "español", fr: "francés", en: "inglés", de: "alemán" });
// alle Messgrößen der Oberfläche (strings.js, measure.*) plus der Oberbegriff
const MEASURE_ES = Object.freeze(Object.fromEntries([
  ...Object.entries(STRINGS).filter(([key]) => key.startsWith("measure.")).map(([, [de, es]]) => [de, es]),
  ["Hörverstehen", "Comprensión auditiva"],
]));

/**
 * Erklärung eines Befunds in der Erklärungssprache: typische Fehler und Aufgabenziele aus dem Inhalt, feste
 * Kernmeldungen nachgebildet; sonst null (dann bleibt die deutsche Erklärung).
 * @param {{kind: string, skill_id?: string|null, error_key?: string|null, explanation_de?: string}} finding
 */
export function localizedFindingExplanation(finding, library, language) {
  if (language === "de") return null;
  const text = finding.explanation_de ?? "";
  const errorId = finding.error_key?.startsWith("common_error:") ? finding.error_key.slice("common_error:".length) : null;
  if (errorId) return library.localization(language, "error", errorId)?.explanation ?? null;
  if (finding.kind === "TARGET_NOT_USED" && finding.skill_id?.startsWith("grammar_structure:")) {
    const rule = library.localization(language, "rule", finding.skill_id.slice("grammar_structure:".length));
    return rule ? `Objetivo de este ejercicio: ${rule.title}. ${rule.explanation}` : null;
  }
  return localizedCoreMessage(text, library) ?? null;
}

/** Feste Meldungen des Kerns (closed.js, check.js, rulebook.js) auf Spanisch; null, wenn der Text keine davon ist. */
export function localizedCoreMessage(text, library) {
  let m;
  if ((m = text.match(/^Deine Antwort hat (\d+) Wörter; für diese Aufgabe sind mindestens (\d+) vorgesehen\./))) {
    return `Tu respuesta tiene ${m[1]} palabras; esta tarea pide al menos ${m[2]}. Desarrolla más tu respuesta.`;
  }
  if ((m = text.match(/^„(.+)“ kommt (\d+)× vor\./))) {
    return `«${m[1]}» aparece ${m[2]} veces. Varía con sinónimos, pronombres o reformulando.`;
  }
  if ((m = text.match(/^Achte auf die Akzente: (.+)$/s))) return `Atención a los acentos: ${m[1]}`;
  // erzeugte Rückmeldungen der Hörkontext-Fragen (tools/generate_contexts.py): drei feste Muster
  if ((m = text.match(/^„(.+)“ kommt in diesem Hörtext nicht vor; zu hören ist „(.+)“\.$/s))) {
    return `«${m[1]}» no aparece en este audio; se oye «${m[2]}».`;
  }
  if ((m = text.match(/^„(.+)“ kommt in diesem Hörtext nicht vor\.$/s))) return `«${m[1]}» no aparece en este audio.`;
  if (text === "Diesen Satz hörst du erst später im Hörtext.") return "Esta frase se oye más adelante en el audio.";
  // P25.4a: erzeugte Rückmeldungen der Hörsätze (falsche Auswahl): zwei weitere feste Muster
  if ((m = text.match(/^„(.+)“ kommt in diesem Satz nicht vor\.$/s))) return `«${m[1]}» no aparece en esta frase.`;
  if ((m = text.match(/^Zu hören ist „(.+)“\.$/s))) return `Se oye «${m[1]}».`;
  if ((m = text.match(/^Deutsche Wörter im [a-zäöü]+ Text: (.+)\. Formuliere diese Stelle auf [A-Za-zäöü]+\.$/))) {
    return `Palabras alemanas en el texto: ${m[1]}. Formula esa parte en ${TARGET_LANGUAGE_ES[library?.languageId] ?? "la lengua que aprendes"}.`;
  }
  if ((m = text.match(/^Du verwendest „(.+)“ (\d+)×\. Für mehr Abwechslung: (.+)$/s))) {
    return `Usas «${m[1]}» ${m[2]} veces. Para variar: ${m[3]}`;
  }
  if ((m = text.match(/^„(.+)“ ist korrekt, aber recht einfach\. Präziser: (.+)$/s))) {
    return `«${m[1]}» es correcto, pero bastante sencillo. Más preciso: ${m[2]}`;
  }
  return null;
}

/**
 * Gesamtmeldung der Bewertung auf Spanisch: feste Bausteine übersetzt, Inhalte einzelner Übungen (nur Deutsch)
 * unverändert angehängt. findingText: Erklärung eines Befunds (für Meldungen, die eine Befunderklärung wiederholen).
 */
export function localizedOverallMessage(message, findingText) {
  let m;
  const fixed = [
    ["Diese Formulierung ist nicht hinterlegt, und die Regeln haben keinen Fehler gefunden. Sie wird später zusätzlich geprüft.",
      "Esta formulación no está registrada y las reglas no han encontrado errores. Se revisará más adelante."],
    ["Du hast den Ausgangssatz unverändert übernommen.", "Has copiado la frase de partida sin cambiarla."],
  ];
  for (const [de, es] of fixed) if (message.startsWith(de)) return `${es}${message.slice(de.length)}`;
  if ((m = message.match(/^Du hast den fehlerhaften Satz unverändert übernommen\.\s*(.*)$/s))) {
    return `Has copiado la frase con el error sin cambiarla.${m[1] ? ` ${findingText(m[1]) ?? m[1]}` : ""}`;
  }
  if ((m = message.match(/^Richtig!\s*(.*)$/s))) {
    const rest = m[1].replace(/^(.*?)Weitere Möglichkeiten: /s, "$1Otras posibilidades: ");
    return `¡Correcto!${rest ? ` ${rest}` : ""}`;
  }
  if ((m = message.match(/^Erwartet: (.*)$/s))) return `Se esperaba: ${m[1]}`;
  return findingText(message) ?? message;
}

/** Hörrückmeldung (listeningFeedback) auf Spanisch; Zahlen und Zustände bleiben, nur der Wortlaut wechselt. */
export function localizedListeningFeedback(listening) {
  const measure = (headline) => {
    const [name, state] = headline.split(": ");
    return `${MEASURE_ES[name] ?? name}: ${state === "verstanden" ? "entendido" : "aún no seguro"}`;
  };
  const HEADLINES = {
    "Gut herausgehört": "Bien captado", "Noch nicht alles herausgehört": "Todavía no se ha captado por completo",
    "Inhalt verstanden": "Contenido entendido", "Inhalt noch nicht ganz erfasst": "Contenido aún no captado por completo",
  };
  const percent = listening.text.match(/zu (\d+) %/)?.[1];
  const texts = [
    [/^Du hast die gesprochenen Wörter/, `Has escrito correctamente el ${percent} % de las palabras dichas. Un dictado muestra que reconoces palabras y formas al oírlas; si entiendes el contenido lo comprueban otras tareas.`],
    [/^Du hast das Wesentliche gehört/, "Has entendido lo esencial. Cómo lo has formulado aparece en la corrección de abajo: eso es expresión escrita, no comprensión."],
    [/^Wichtige Inhalte aus der Aufnahme fehlen/, "En tu respuesta faltan contenidos importantes de la grabación. Escucha otra vez los detalles."],
    [/^Die Aussage hast du im Gesprochenen erkannt/, "Has reconocido el mensaje al oírlo."],
    [/^Beim Hören war das heute noch nicht sicher/, "Al escuchar, hoy todavía no era seguro."],
  ];
  let text = texts.find(([pattern]) => pattern.test(listening.text))?.[1] ?? listening.text;
  if (listening.text.includes("Du kennst diese Struktur schriftlich bereits gut.")) {
    text += " Esta estructura ya la dominas por escrito. En el contexto oral todavía no la has reconocido con seguridad.";
  }
  const notes = listening.notes.map((note) => {
    const plays = note.match(/^(\d+)× gehört/)?.[1];
    if (plays) return `Escuchado ${plays} veces: la primera respuesta tras una sola escucha es la que más cuenta.`;
    if (note.startsWith("Mit Hilfe beantwortet")) return "Respondido con ayuda: sirve para aprender, pero cuenta menos que escuchar sin ayuda.";
    return note;
  });
  const headline = HEADLINES[listening.headline] ?? (listening.headline.includes(": ") ? measure(listening.headline) : listening.headline);
  return { ...listening, headline, text, notes };
}
