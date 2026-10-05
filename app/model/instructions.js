/**
 * Aufgabenanweisungen in der Erklärungssprache (P25.4a). Die Anweisungen der Übungen (prompt_de) sind zum größten
 * Teil feste Bausteine ("Hör zu und beantworte die Frage."); sie gehören eher zur Oberfläche als zum Lerninhalt.
 * Übersetzt werden nur
 *   - allgemeine Anweisungen ohne eigenen Inhalt (FIXED) und
 *   - Muster, deren einziger Inhalt ein Wort der Lernsprache in Anführungszeichen ist (PATTERNS); das Wort bleibt.
 * Was eigenen Inhalt trägt (Situationen, "Wie sagst du: …", deutsche Bedeutungsangaben wie "(die Fahrkarte)"),
 * bleibt Deutsch: Eine Übersetzung würde dort oft die Lösung verraten und wäre Lerninhalt, keine Oberfläche.
 */

const FIXED_ES = Object.freeze({
  "Hör zu und schreib, was du hörst.": "Escucha y escribe lo que oyes.",
  "Hör zu und beantworte die Frage.": "Escucha y responde a la pregunta.",
  "Hör zu und wähle den Satz, den du hörst.": "Escucha y elige la frase que oyes.",
  "Hör zu und antworte auf Spanisch.": "Escucha y responde en español.",
  "Lies den Text und beantworte die Frage.": "Lee el texto y responde a la pregunta.",
  "Lies die Nachricht und beantworte die Frage.": "Lee el mensaje y responde a la pregunta.",
  "Lies die Mitteilung und beantworte die Frage.": "Lee el aviso y responde a la pregunta.",
  "Der Satz enthält einen typischen Fehler. Schreib ihn richtig.": "La frase contiene un error típico. Escríbela correctamente.",
  "Was bedeutet der Satz?": "¿Qué significa la frase?",
  "Was meint die Sprecherin wahrscheinlich?": "¿Qué quiere decir probablemente la hablante?",
  // Auswahl
  "Wähle die passende Form.": "Elige la forma adecuada.",
  "Wähle die richtige Form.": "Elige la forma correcta.",
  "Wähle das passende Wort.": "Elige la palabra adecuada.",
  "Wähle das passende Verb.": "Elige el verbo adecuado.",
  "Wähle das passende Verb (gehoben).": "Elige el verbo adecuado (registro culto).",
  "Wähle das präziseste Verb.": "Elige el verbo más preciso.",
  "Wähle den passenden Konnektor.": "Elige el conector adecuado.",
  "Wähle den passenden Artikel.": "Elige el artículo adecuado.",
  "Wähle den passenden Ausdruck.": "Elige la expresión adecuada.",
  "Wähle die passende Präposition.": "Elige la preposición adecuada.",
  "Wähle die richtige Präposition.": "Elige la preposición correcta.",
  "Wähle die passende Präposition (bzw. Form).": "Elige la preposición (o la forma) adecuada.",
  "Wähle das passende Relativpronomen.": "Elige el pronombre relativo adecuado.",
  "Wähle das Relativpronomen.": "Elige el pronombre relativo.",
  "Wähle die richtige Wortstellung.": "Elige el orden de palabras correcto.",
  "Wähle das richtige Hilfsverb.": "Elige el verbo auxiliar correcto.",
  "Wähle das passende Hilfsverb.": "Elige el verbo auxiliar adecuado.",
  "Wähle die richtige Verneinung.": "Elige la negación correcta.",
  "Wähle die passende Zeit.": "Elige el tiempo verbal adecuado.",
  "Wähle die passende Zeit (Erzählung).": "Elige el tiempo verbal adecuado (narración).",
  "Wähle den passenden Modus.": "Elige el modo adecuado.",
  "Wähle das richtige Partizip.": "Elige el participio correcto.",
  "Wähle die passende Konjunktion.": "Elige la conjunción adecuada.",
  "Wähle die höfliche Form.": "Elige la forma cortés.",
  "Wähle die richtige Endung.": "Elige la terminación correcta.",
  "Wähle den passenden Possessivartikel.": "Elige el posesivo adecuado.",
  "Wähle den richtigen Satzteil.": "Elige la parte de la frase correcta.",
  "Wähle die richtige Frageform.": "Elige la forma interrogativa correcta.",
  "Wähle die Form für die nahe Zukunft.": "Elige la forma del futuro próximo.",
  "Wähle die richtige Form im passé composé.": "Elige la forma correcta en passé composé.",
  "Wähle die Form der formellen Standardsprache.": "Elige la forma de la lengua estándar formal.",
  "Wähle die stilistisch passende Form (gehobene Sprache).": "Elige la forma estilísticamente adecuada (registro culto).",
  "Wohin oder wo? Wähle den Artikel.": "¿Dirección o lugar? Elige el artículo.",
  "Hintergrund oder Ereignis? Wähle die passende Form.": "¿Contexto o acontecimiento? Elige la forma adecuada.",
  "Im Restaurant: Wähle das passende Wort.": "En el restaurante: elige la palabra adecuada.",
  "Welches Wort passt?": "¿Qué palabra encaja?",
  "Welches Verb passt?": "¿Qué verbo encaja?",
  "Welches Verb passt (gehoben)?": "¿Qué verbo encaja (registro culto)?",
  "Welches Verb ist am präzisesten?": "¿Qué verbo es el más preciso?",
  "Welcher Konnektor passt?": "¿Qué conector encaja?",
  "Welche Präposition passt?": "¿Qué preposición encaja?",
  "Welche Wendung passt?": "¿Qué expresión encaja?",
  "Welche Bitte ist am höflichsten?": "¿Qué petición es la más cortés?",
  "Welche Form ist in gepflegter Sprache üblich?": "¿Qué forma es la habitual en un registro cuidado?",
  "Welche Formulierung passt in eine formelle E-Mail an eine Behörde?": "¿Qué formulación encaja en un correo formal a una administración?",
  // Ergänzen
  "Ergänze die Präposition.": "Completa con la preposición.",
  "Ergänze die fehlende Präposition.": "Completa con la preposición que falta.",
  "Ergänze die Präposition (mit Artikel).": "Completa con la preposición (con artículo).",
  "Ergänze die Redewendung.": "Completa la expresión.",
  "Ergänze die feste Wendung.": "Completa la expresión fija.",
  "Ergänze die gehobene Wendung.": "Completa la expresión de registro culto.",
  "Ergänze die Schlussformel.": "Completa la fórmula de despedida.",
  "Ergänze das Reflexivpronomen.": "Completa con el pronombre reflexivo.",
  "Ergänze das Relativpronomen.": "Completa con el pronombre relativo.",
  "Ergänze das indirekte Objektpronomen.": "Completa con el pronombre de objeto indirecto.",
  "Ergänze das unpersönliche Pronomen.": "Completa con el pronombre impersonal.",
  "Ergänze das fehlende Wort.": "Completa con la palabra que falta.",
  "Ergänze das passende Wort.": "Completa con la palabra adecuada.",
  "Ergänze das fehlende Nomen.": "Completa con el sustantivo que falta.",
  "Ergänze das Verb.": "Completa con el verbo.",
  "Ergänze das passende Verb.": "Completa con el verbo adecuado.",
  "Ergänze das Verb der festen Wendung.": "Completa con el verbo de la expresión fija.",
  "Ergänze das Verb der festen Verbindung.": "Completa con el verbo de la combinación fija.",
  "Ergänze das Verb am Ende des Nebensatzes.": "Completa con el verbo al final de la oración subordinada.",
  "Ergänze das Partizip.": "Completa con el participio.",
  "Ergänze das Partizip des passenden Verbs.": "Completa con el participio del verbo adecuado.",
  "Ergänze den bestimmten Artikel.": "Completa con el artículo determinado.",
  "Ergänze den Artikel.": "Completa con el artículo.",
  "Ergänze den Artikel im Genitiv.": "Completa con el artículo en genitivo.",
  "Ergänze den Artikel nach der Verneinung.": "Completa con el artículo después de la negación.",
  "Wohin oder wo? Ergänze den Artikel.": "¿Dirección o lugar? Completa con el artículo.",
  "Ergänze das Vergleichswort.": "Completa con la palabra de comparación.",
  "Ergänze die Verneinung.": "Completa la negación.",
  "Ergänze den Infinitiv.": "Completa con el infinitivo.",
  // Umformen und frei antworten
  "Forme den Satz ins Passiv um.": "Pasa la frase a pasiva.",
  "Formuliere im Nominalstil (akademisch).": "Reformula en estilo nominal (académico).",
  "Formuliere im Nominalstil (formell).": "Reformula en estilo nominal (formal).",
  "Formuliere den Satz im Nominalstil (formell).": "Reformula la frase en estilo nominal (formal).",
  "Formuliere den Satz gehobener und präziser, ohne die Bedeutung zu verändern.": "Reformula la frase en un registro más culto y preciso, sin cambiar el significado.",
  "Reagiere spontan auf diese Aussage deines Gesprächspartners.": "Reacciona de forma espontánea a esta afirmación de tu interlocutor.",
  "Dein Gesprächspartner behauptet Folgendes. Widersprich ihm und begründe deine Position mit konkreten Argumenten.":
    "Tu interlocutor afirma lo siguiente. Llévale la contraria y justifica tu postura con argumentos concretos.",
  "Antworte deiner Kollegin, am besten gesprochen.": "Responde a tu compañera, mejor hablando.",
  "Antworte deinem Kollegen, am besten gesprochen.": "Responde a tu compañero, mejor hablando.",
  "Antworte der Mitarbeiterin im Kundendienst, am besten gesprochen.": "Responde a la empleada de atención al cliente, mejor hablando.",
  "Reagiere auf den Verkäufer, am besten gesprochen.": "Responde al vendedor, mejor hablando.",
  "Reagiere auf deinen Vorgesetzten, am besten gesprochen.": "Responde a tu jefe, mejor hablando.",
  "Reagiere auf die Mitarbeiterin im Geschäft, am besten gesprochen.": "Responde a la dependienta, mejor hablando.",
});

// Wort der Lernsprache in Anführungszeichen ('ser', „avoir“); es bleibt unverändert.
const Q = "('[^']+'|„[^“]+“)";
const PERSON = "(yo|tú|él|ella|usted|nosotros|vosotros|ellos|ellas|ustedes)";
const TENSE_ES = Object.freeze({
  Indefinido: "indefinido", imparfait: "imparfait", "futur simple": "futur simple", subjonctif: "subjonctif",
  "Konjunktiv II": "Konjunktiv II", "passé composé": "passé composé",
});
const TENSES = `(${Object.keys(TENSE_ES).join("|")})`;

/** [Muster, Ersetzung] je Anweisung mit einem Wort der Lernsprache. */
const PATTERNS_ES = Object.freeze([
  [new RegExp(`^Ergänze ${Q}\\.$`), (q) => `Completa con ${q}.`],
  [new RegExp(`^Ergänze ${Q} \\(${PERSON}\\)\\.$`), (q, p) => `Completa con ${q} (${p}).`],
  [new RegExp(`^Ergänze (?:mit )?${Q} oder ${Q}\\.$`), (a, b) => `Completa con ${a} o ${b}.`],
  [new RegExp(`^Ergänze ${Q}, ${Q} oder ${Q}\\.$`), (a, b, c) => `Completa con ${a}, ${b} o ${c}.`],
  [new RegExp(`^Ergänze die Form von ${Q}\\.$`), (q) => `Completa con la forma de ${q}.`],
  [new RegExp(`^Ergänze (?:die richtige Form von ${Q}|${Q} in der (?:richtigen|passenden) Form)\\.$`),
    (a, b) => `Completa con la forma correcta de ${a ?? b}.`],
  [new RegExp(`^Ergänze ${Q} in der richtigen Form \\(${PERSON}\\)\\.$`), (q, p) => `Completa con la forma correcta de ${q} (${p}).`],
  [new RegExp(`^Ergänze mit der richtigen Form von ${Q} \\(${PERSON}\\)\\.$`), (q, p) => `Completa con la forma correcta de ${q} (${p}).`],
  [new RegExp(`^Ergänze ${Q} im ${TENSES}\\.$`), (q, tense) => `Completa con ${q} en ${TENSE_ES[tense]}.`],
  [new RegExp(`^Ergänze ${Q} \\(${PERSON}\\) im ${TENSES}\\.$`), (q, p, tense) => `Completa con ${q} (${p}) en ${TENSE_ES[tense]}.`],
  [new RegExp(`^Ergänze das Partizip von ${Q}\\.$`), (q) => `Completa con el participio de ${q}.`],
  [new RegExp(`^Wähle die richtige Form von ${Q}\\.$`), (q) => `Elige la forma correcta de ${q}.`],
  [new RegExp(`^Wähle die richtige Form von ${Q} \\(${PERSON}\\)\\.$`), (q, p) => `Elige la forma correcta de ${q} (${p}).`],
  [new RegExp(`^Wähle ${Q} oder ${Q}\\.$`), (a, b) => `Elige ${a} o ${b}.`],
  [new RegExp(`^Ersetze ${Q} durch ein Pronomen\\.$`), (q) => `Sustituye ${q} por un pronombre.`],
  [new RegExp(`^Setze ${Q} in den Plural\\.$`), (q) => `Pon ${q} en plural.`],
  [new RegExp(`^Beginne den Satz mit ${Q}\\.$`), (q) => `Empieza la frase con ${q}.`],
  [new RegExp(`^Verbinde (?:die beiden Sätze|die Sätze) mit ${Q}\\.$`), (q) => `Une las frases con ${q}.`],
]);

/** Anweisung einer Übung in der Erklärungssprache; ohne Übersetzung unverändert (Deutsch). */
export function localizedInstruction(text, language) {
  if (!text || language !== "es") return text;
  const fixed = FIXED_ES[text];
  if (fixed) return fixed;
  for (const [pattern, build] of PATTERNS_ES) {
    const m = text.match(pattern);
    if (m) return build(...m.slice(1));
  }
  return text;
}

/** Für Tests: gibt es eine spanische Fassung dieser Anweisung? */
export function hasLocalizedInstruction(text) {
  return localizedInstruction(text, "es") !== text;
}
