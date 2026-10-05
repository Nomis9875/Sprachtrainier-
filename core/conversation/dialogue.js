/**
 * Conversation Engine · kurzfristiger Gesprächszustand (Conversation Context, KEIN Langzeit-Gedächtnis).
 *
 *   turns_answered     beantwortete Runden
 *   covered_moves      erledigte Gesprächsschritte (erkannt oder ausführlich beantwortet)
 *   aspects_mentioned  Argumente, die der Lerner genannt hat
 *   aspects_raised     Argumente, die der Gesprächspartner eingebracht hat
 *   aspects_deepened   Argumente, die schon vertieft wurden
 *   asked_questions    gestellte Fragen (keine Frage zweimal)
 *   decide_asked       nach Position/Entscheidung gefragt
 *
 * Er wird beim Replay aus den gespeicherten Entscheidungen und Analysen neu aufgebaut und endet mit dem
 * Gespräch. Langfristige Lernerkenntnisse bleiben allein im Lerngedächtnis (core/memory).
 */

const RAISING_RULES = new Set(["disagreement", "introduce_missing", "explore"]);

export function emptyDialogue() {
  return {
    turns_answered: 0, covered_moves: [], aspects_mentioned: [], aspects_raised: [], aspects_deepened: [],
    asked_questions: [], decide_asked: false,
  };
}

/** Hat die Antwort den gefragten Schritt inhaltlich erledigt (nicht knapp, unsicher oder am Thema vorbei)? */
export function isSubstantial(analysis) {
  return !analysis.short && !analysis.uncertain && !analysis.off_topic;
}

/** Zustand nach einer Frage des Gesprächspartners. */
export function withQuestion(dialogue, decision) {
  const next = structuredClone(dialogue);
  next.asked_questions.push(decision.question_es);
  if (decision.aspect_id && decision.rule === "argument") add(next.aspects_deepened, decision.aspect_id);
  if (decision.aspect_id && RAISING_RULES.has(decision.rule)) add(next.aspects_raised, decision.aspect_id);
  if (decision.rule === "pros_and_cons") next.decide_asked = true;
  return next;
}

/** Zustand nach einer Antwort auf die Frage `answered`. */
export function withAnswer(dialogue, answered, analysis) {
  const next = structuredClone(dialogue);
  next.turns_answered += 1;
  for (const move of analysis.moves) add(next.covered_moves, move);
  if (isSubstantial(analysis)) add(next.covered_moves, answered.move_id);
  for (const aspect of analysis.aspects) add(next.aspects_mentioned, aspect);
  return next;
}

function add(list, value) {
  if (!list.includes(value)) list.push(value);
}
