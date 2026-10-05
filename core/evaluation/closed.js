/**
 * Bewertung von Übungen mit bekannter Lösung (geschlossen und halboffen).
 *
 * Gegenstück zu core/evaluation/closed.py (Python-Referenz). Reihenfolge:
 * 1. Akzeptierte Antwort (genau bzw. bis auf Akzente)  → richtig
 * 2. Ausgangssatz unverändert übernommen               → falsch (keine Beobachtung)
 * 3. Bekannte falsche Antwort mit gezielter Rückmeldung → falsch (Zielstrukturen: error)
 * 4. Regelprüfung: Fehlerregeln, Zielstrukturen         → falsch, Erklärung aus dem Inhalt
 * 5. Wortschatz: Ziel-Ausdruck korrekt verwendet        → richtig
 * 6. Sonst: halboffen → später zusätzliche Prüfung; geschlossen → falsch
 *
 * Musterlösung: die Lernziele gelten als gezeigt ("target / demonstrated", Quelle reference),
 * provozierte Fehler als vermieden. Eine richtige Antwort wird nie zugleich als Fehler desselben
 * Lernziels beobachtet.
 */

import { blockingFindings, checkAnswer } from "./check.js";
import { ObservationSet, errorSkill, grammarSkill, lexicalSkill, skillObservation } from "./observations.js";
import { errorFinding, finding } from "./rulebook.js";
import { codePointLength, normalize, prepare, pythonStrip, stripAccents } from "./text.js";

export const GAP_MARKER = "___";
export const CLOSED_OUTCOMES = Object.freeze(["correct", "incorrect", "needs_review"]);

const SHOW_ALTERNATIVES = new Set(["vocab_active", "transform", "translation", "rephrase"]);
const HAS_SOURCE_TO_CHANGE = new Set(["transform", "rephrase", "error_correction"]);

export class InvalidAnswerError extends Error {
  constructor(message = "Bitte eine Antwort eingeben.") {
    super(message);
    this.name = "InvalidAnswerError";
  }
}

/**
 * @typedef {{outcome: string, feedback_de: string, findings: object[], matched_answer: object|null,
 *   report: import("./check.js").RuleReport|null, observations: object[]}} ClosedResult
 */

/**
 * @param {string} rawAnswer
 * @param {object} exercise   Übung aus dem Inhaltspaket (nicht "open")
 * @param {import("./rulebook.js").Rulebook} rulebook
 * @returns {ClosedResult}
 */
export function evaluateClosed(rawAnswer, exercise, rulebook) {
  if (exercise.evaluation_mode === "open") {
    throw new TypeError(`Übung '${exercise.id}' ist offen und wird nicht geschlossen bewertet.`);
  }
  const answer = pythonStrip(rawAnswer);
  if (!answer) throw new InvalidAnswerError();

  const normalized = normalize(answer);
  let matched = match(normalized, exercise.accepted_answers ?? []);
  if (matched) {
    return result("correct", correctFeedback(exercise, matched), [], {
      matched, observations: referenceObservations(exercise, rulebook, answer),
    });
  }
  matched = match(normalized, exercise.accepted_answers ?? [], { ignoreAccents: true, marks: rulebook.accentMarks });
  if (matched) {
    const accent = finding("ACCENT", {
      original: answer,
      suggestion: matched.text,
      explanation_de: `Achte auf die Akzente: ${matched.text}`,
      source: "reference",
      span: [0, codePointLength(answer.normalize("NFC"))],
    });
    return result("correct", correctFeedback(exercise, matched), [accent], {
      matched, observations: referenceObservations(exercise, rulebook, answer),
    });
  }

  if (HAS_SOURCE_TO_CHANGE.has(exercise.type) && normalized === normalize(exercise.source_text_es ?? "")) {
    if (exercise.type === "error_correction") {
      // Der fehlerhafte Satz unverändert: Das IST der provozierte Fehler (P12); er geht als Beobachtung ins Lernmodell ein
      const report = checkAnswer(answer, exercise, rulebook);
      const first = report.findings[0];
      return result("incorrect", `Du hast den fehlerhaften Satz unverändert übernommen. ${first ? first.explanation_de : ""}`.trim(),
        report.findings, { report, observations: knownWrongObservations(exercise, report, null) });
    }
    return result("incorrect", "Du hast den Ausgangssatz unverändert übernommen.", []);
  }

  const report = answerReport(checkAnswer(fullSentence(exercise, answer), exercise, rulebook), exercise, answer);
  const wrong = match(normalized, exercise.wrong_answers ?? [], { ignoreAccents: true, marks: rulebook.accentMarks });
  if (wrong) {
    let findings = report.findings;
    if (wrong.error_id && !findings.some((f) => f.error_id === wrong.error_id)) {
      const whole = [0, codePointLength(answer.normalize("NFC"))];
      findings = [errorFinding(rulebook.error(wrong.error_id), answer, whole), ...findings];
    }
    return result("incorrect", wrong.feedback_de, findings, {
      report, observations: knownWrongObservations(exercise, report, wrong.error_id),
    });
  }

  const blocking = blockingFindings(report);
  if (blocking.length) {
    return result("incorrect", blocking[0].explanation_de, report.findings, { report, observations: report.observations });
  }
  if (exercise.type === "vocab_active" && report.items_used.length) {
    return result("correct", correctFeedback(exercise, null), report.findings, { report, observations: report.observations });
  }
  if (exercise.evaluation_mode === "semi_open") {
    return result("needs_review",
      "Diese Formulierung ist nicht hinterlegt, und die Regeln haben keinen Fehler gefunden. "
        + `Sie wird später zusätzlich geprüft. Musterlösung: ${modelText(exercise)}`,
      report.findings, { report, observations: report.observations });
  }
  return result("incorrect", `Erwartet: ${modelText(exercise)}. ${exercise.explanation_de ?? ""}`.trim(), report.findings, {
    report, observations: report.observations,
  });
}

/** Satz mit Lücke: Lückentext immer, Auswahlaufgabe (P12), wenn ihr Satz eine Lücke hat. */
export function hasGap(exercise) {
  return exercise.type === "gap_fill" || (exercise.type === "multiple_choice" && (exercise.source_text_es ?? "").includes(GAP_MARKER));
}

/** Bei Sätzen mit Lücke der vollständige Satz mit der Antwort, sonst die Antwort selbst. */
export function fullSentence(exercise, answer) {
  // Funktion statt Text als Ersatz: "$&" o. ä. in der Antwort bleibt wörtlich
  if (hasGap(exercise)) return exercise.source_text_es.replace(GAP_MARKER, () => pythonStrip(answer));
  return answer;
}

function result(outcome, feedback, findings, { matched = null, report = null, observations = [] } = {}) {
  return { outcome, feedback_de: feedback, findings, matched_answer: matched, report, observations };
}

/**
 * Textstellen beziehen sich auf die Antwort des Lerners, nicht auf den Satz mit Lücke. Ein Befund,
 * der die Lücke berührt, wird auf die Antwort umgerechnet; einer nur im vorgegebenen Text hat keine Stelle.
 */
function answerReport(report, exercise, answer) {
  if (!hasGap(exercise)) return report;
  const gapStart = codePointLength(exercise.source_text_es.split(GAP_MARKER)[0].normalize("NFC"));
  const gapEnd = gapStart + codePointLength(answer.normalize("NFC"));
  const relocate = (f) => {
    if (f.span === null) return f;
    const [start, end] = f.span;
    if (end <= gapStart || start >= gapEnd) return { ...f, span: null };
    return { ...f, span: [Math.max(start, gapStart) - gapStart, Math.min(end, gapEnd) - gapStart] };
  };
  return { ...report, findings: report.findings.map(relocate) };
}

/**
 * Musterlösung: Lernziele gezeigt, provozierte Fehler vermieden. Ziel-Ausdrücke sind oft Alternativen:
 * gezeigt ist nur der Ausdruck, der in der Antwort steht.
 */
function referenceObservations(exercise, rulebook, answer) {
  const observations = new ObservationSet();
  for (const ref of exercise.structures ?? []) {
    if (ref.is_target) observations.add(reference(grammarSkill(ref.rule_id), "demonstrated"));
  }
  // Satz mit Lücke: der ganze Satz zählt ("consiste ___" + "en" zeigt consistir en), nicht nur das Wort
  for (const itemId of rulebook.itemsUsed(prepare(fullSentence(exercise, answer)), exercise.target_items ?? [])) {
    observations.add(reference(lexicalSkill(itemId), "demonstrated"));
  }
  for (const errorId of exercise.common_errors ?? []) observations.add(reference(errorSkill(errorId), "demonstrated"));
  return observations.freeze();
}

/**
 * Hinterlegte falsche Antwort: Die Zielstrukturen sind nicht gelungen, auch wenn die Regeln die Form nicht kennen.
 * Ein einzelner Ziel-Ausdruck ebenfalls ("consiste de" → consistir en); mehrere sind Alternativen (offen).
 */
function knownWrongObservations(exercise, report, errorId) {
  const observations = new ObservationSet(report.observations);
  for (const ref of exercise.structures ?? []) {
    const skill = grammarSkill(ref.rule_id);
    const current = observations.get(skill);
    if (ref.is_target && (current === null || current.result !== "error")) {
      observations.replace(reference(skill, "error", "known_wrong_answer"));
    }
  }
  const items = exercise.target_items ?? [];
  if (items.length === 1) {
    const skill = lexicalSkill(items[0]);
    const current = observations.get(skill);
    if (current === null || current.result !== "error") observations.replace(reference(skill, "error", "known_wrong_answer"));
  }
  if (errorId) observations.replace(reference(errorSkill(errorId), "error", "known_wrong_answer"));
  return observations.freeze();
}

function reference(skill, outcome, basis = "reference_answer") {
  return skillObservation(skill, "target", outcome, "high", basis);
}

function match(normalized, candidates, { ignoreAccents = false, marks = null } = {}) {
  const key = ignoreAccents ? stripAccents(normalized, marks) : normalized;
  return candidates.find((candidate) => {
    const other = normalize(candidate.text);
    return (ignoreAccents ? stripAccents(other, marks) : other) === key;
  }) ?? null;
}

function correctFeedback(exercise, matched) {
  const parts = ["Richtig!"];
  if (matched?.note_de) parts.push(matched.note_de);
  const others = (exercise.accepted_answers ?? []).filter((a) => a !== matched);
  if (others.length && SHOW_ALTERNATIVES.has(exercise.type)) {
    parts.push(`Weitere Möglichkeiten: ${others.map((a) => (a.note_de ? `${a.text} (${a.note_de})` : a.text)).join("; ")}`);
  }
  if (exercise.explanation_de) parts.push(exercise.explanation_de);
  return parts.join(" ");
}

function modelText(exercise) {
  const accepted = exercise.accepted_answers ?? [];
  const models = accepted.filter((a) => a.is_model_answer);
  const answers = models.length ? models : accepted;
  return answers.length ? answers[0].text : "";
}
