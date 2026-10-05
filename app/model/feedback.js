/**
 * Rückmeldung zu einer Antwort (DOM-frei, testbar).
 *
 * Quelle ist ausschließlich das EvaluationResult v2 der Bewertung (web/core/evaluation) und die
 * Übung aus dem Inhaltspaket. Die App erfindet keine Sprachregeln: Titel, Befunde, Erklärungen und
 * Vorschläge stammen aus der Bewertung; hier wird nur geordnet, gekürzt und beschriftet.
 *
 *   verdict     correct | incorrect | no_errors | not_evaluated   (aus overall.outcome)
 *   primary     die wichtigsten Befunde (Fehler, dann Aufgabenziel), höchstens MAX_PRIMARY
 *   secondary   der Rest (Natürlichkeit, C1-Ausdruck, Hinweise), gruppiert, eingeklappt anzeigbar
 *   ai_hints    KI-Zusatzhinweise (Qwen, "supplemental"): nie unter primary/secondary, eigene
 *               Gruppe "unbestätigt"; sie ändern weder Titel noch Urteil
 *   input_mode  text | speech (Anzeige "Du hast geschrieben/gesagt")
 *   recurring   ein Befund zu einem Muster, das das Lerngedächtnis als wiederkehrend kennt
 *   shown       was die Antwort gezeigt hat (verlässlich beobachtet), höchstens MAX_SHOWN
 *   model_answer, alternatives, good_phrases, explanation_de   aus der Übung
 */

import { readEvaluation } from "../../core/evaluation/result.js";
import { normalize } from "../../core/evaluation/text.js";
import { SEVERITY_LABELS, SEVERITY_ORDER } from "./labels.js";
import { explain, localizedFindingExplanation, localizedOverallMessage, localizedSkillLabel } from "./explain.js";

export const MAX_PRIMARY = 3;
export const MAX_SHOWN = 4;
const PRIMARY_SEVERITIES = new Set(["error", "goal"]);

const VERDICTS = Object.freeze({
  correct: { title: "Richtig", tone: "success" },
  incorrect: { title: "Nicht ganz", tone: "error" },
  no_errors: { title: "Keine Fehler gefunden", tone: "info" },
  not_evaluated: { title: "Nicht automatisch bewertet", tone: "neutral" },
});

/**
 * @param {{evaluation: object, exercise: object, library: object, recurringSkillIds?: Set<string>, answerText?: string}} input
 *   answerText: die eigene Antwort (die Musterantwort wird nicht wiederholt, wenn sie gleich ist)
 *   recurringSkillIds: Skills mit offener Erinnerung "recurring_error" (Lerngedächtnis)
 */
export function presentFeedback({ evaluation, exercise, library, recurringSkillIds = new Set(), answerText = "", inputMode = "text", language = "de" }) {
  const view = readEvaluation(evaluation);
  const verdict = verdictOf(view.overall.outcome);
  const all = view.findings
    .map((f) => ({
      severity: f.severity,
      severity_label: explain(language, "severity")[f.severity] ?? SEVERITY_LABELS[f.severity] ?? f.severity,
      title: findingTitle(f, library, language),
      original: f.original || "",
      suggestion: f.suggestion || "",
      explanation_de: f.explanation_de || "",
      // P24: Erklärung in der Erklärungssprache (fehlt sie, die deutsche)
      explanation: localizedFindingExplanation(f, library, language) ?? f.explanation_de ?? "",
      supplemental: f.authority === "supplemental",
      recurring: Boolean(f.skill_id && recurringSkillIds.has(f.skill_id)),
    }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
      || Number(b.recurring) - Number(a.recurring));
  const items = all.filter((i) => !i.supplemental);
  const aiHints = all.filter((i) => i.supplemental);

  const blocking = items.filter((i) => PRIMARY_SEVERITIES.has(i.severity));
  const primary = blocking.slice(0, MAX_PRIMARY);
  const rest = [...blocking.slice(MAX_PRIMARY), ...items.filter((i) => !PRIMARY_SEVERITIES.has(i.severity))];
  const secondary = SEVERITY_ORDER
    .map((severity) => ({ severity, label: explain(language, "severity")[severity], items: rest.filter((i) => i.severity === severity) }))
    .filter((group) => group.items.length);

  const model = (exercise.accepted_answers ?? []).find((a) => a.is_model_answer) ?? exercise.accepted_answers?.[0] ?? null;
  const alternatives = (exercise.accepted_answers ?? [])
    .filter((a) => a !== model)
    .map((a) => ({ text: a.text, note_de: a.note_de || "" }));
  // Die Gesamtmeldung entfällt, wenn sie nur die Erklärung eines angezeigten Befunds wiederholt
  const rawMessage = (view.overall.feedback_de || "").trim();
  let message = rawMessage && items.some((i) => i.explanation_de && i.explanation_de.includes(rawMessage)) ? "" : rawMessage;
  const showModel = Boolean(model && normalize(model.text) !== normalize(answerText));
  // P22: keine doppelte Bestätigung ("Richtig" + "Richtig!") und die Musterlösung nicht zweimal
  if (verdict.key === "correct" && /^richtig!?$/i.test(message)) message = "";
  if (showModel) message = message.replace(/\s*Musterlösung: .*$/s, "").trim();
  // P22: Keine Regel greift, aber die Antwort hat mit der erwarteten Lösung kaum etwas gemeinsam ("Ja, gut." auf
  // "Korrigiere den Satz"): nicht "Keine Fehler gefunden" zeigen. Die Bewertung selbst bleibt unverändert (offen).
  const far = verdict.key === "no_errors" && showModel && wordOverlap(answerText, model.text) < FAR_OVERLAP;
  if (far) message = explain(language, "far_message");
  // P24: feste Bausteine der Gesamtmeldung in der Erklärungssprache (Inhalte einzelner Übungen bleiben Deutsch)
  else if (language !== "de" && message) {
    const findingText = (text) => {
      const finding = all.find((i) => i.explanation_de === text);
      return finding && finding.explanation !== finding.explanation_de ? finding.explanation : localizedFindingExplanation({ kind: "", explanation_de: text }, library, language);
    };
    message = localizedOverallMessage(message, findingText);
  }

  return {
    verdict: verdict.key,
    title: far ? explain(language, "verdict_far") : explain(language, `verdict_${verdict.key}`),
    language,
    labels: {
      you_wrote: explain(language, "you_wrote"), you_said: explain(language, "you_said"), model_answer: explain(language, "model_answer"),
      could_sound: explain(language, "could_sound"), well_done: explain(language, "well_done"), more_hints: explain(language, "more_hints"),
      alternatives: explain(language, "alternatives"), phrases: explain(language, "phrases"), recurring: explain(language, "recurring"),
      transcript: explain(language, "transcript"),
    },
    tone: verdict.tone,
    far_from_model: far,
    message,
    primary,
    secondary,
    ai_hints: aiHints,
    input_mode: inputMode,
    counts: Object.fromEntries(SEVERITY_ORDER.map((s) => [s, items.filter((i) => i.severity === s).length])),
    recurring: items.some((i) => i.recurring),
    shown: shownSkills(view.observations, library, language),
    model_answer: showModel ? { text: model.text, note_de: model.note_de || "" } : null,
    alternatives: exercise.evaluation_mode === "closed" ? alternatives : [],
    good_phrases: exercise.good_phrases ?? [],
    // Erklärung der Übung nur, wenn sie nicht schon in der Rückmeldung steht (geschlossene Übungen)
    explanation_de: exercise.explanation_de && !message.includes(exercise.explanation_de) ? exercise.explanation_de : "",
  };
}

/** Anteil der Wörter der Musterlösung, die auch in der Antwort vorkommen (ohne Groß-/Kleinschreibung und Akzente). */
export function wordOverlap(answer, model) {
  const words = (text) => normalize(text).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  const target = new Set(words(model));
  if (!target.size) return 1;
  const own = new Set(words(answer));
  return [...target].filter((w) => own.has(w)).length / target.size;
}
const FAR_OVERLAP = 0.4;

function verdictOf(outcome) {
  const key = outcome === "correct" ? "correct"
    : outcome === "incorrect" ? "incorrect"
      : outcome === "needs_review" ? "no_errors"
        : "not_evaluated";
  return { key, ...VERDICTS[key] };
}

/** Name des betroffenen Skills; ohne Skill (z. B. Aufgabenziel) genügt die Art des Befunds. */
function findingTitle(finding, library, language = "de") {
  return finding.skill_id ? localizedSkillLabel(library.skill(finding.skill_id), library, language) ?? "" : "";
}

/** Verlässlich gezeigte Strukturen und Ausdrücke (keine typischen Fehler: "vermieden" ist kein Lob). */
function shownSkills(observations, library, language = "de") {
  const labels = observations
    .filter((o) => o.outcome === "demonstrated" && o.reliability === "high" && o.source !== "llm"
      && !o.skill_id.startsWith("common_error:"))
    .map((o) => localizedSkillLabel(library.skill(o.skill_id), library, language))
    .filter(Boolean);
  return [...new Set(labels)].slice(0, MAX_SHOWN);
}
