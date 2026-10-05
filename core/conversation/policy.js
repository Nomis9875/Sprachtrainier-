/**
 * Conversation Engine · Gesprächspolitik: Was sagt der Gesprächspartner als Nächstes? Deterministisch.
 *
 * Eingaben: Szenario und Gesprächsziel (Inhalt), kurzfristiger Gesprächszustand (was schon gesagt,
 * gefragt, eingebracht wurde), Analyse der letzten Antwort, zwei Kennzahlen der Regelbewertung und die
 * verbrauchte Zeit. Ausgabe: eine Entscheidung mit benannter Regel, Reaktion und Frage, dazu Alternativen
 * (Kandidaten), aus denen eine optionale KI wählen darf. Die Policy weiß nichts über Kompetenz, Gedächtnis
 * oder Lernbedarf: Das entscheidet das Learning Brain, nicht das Gespräch.
 *
 * Regeln (erste passende gewinnt):
 *   end            der Abschlussschritt ist beantwortet → Gespräch endet (goal_reached | time_budget | max_turns)
 *   wrap_up        Zeit oder Rundenzahl fast erreicht → Abschlussfrage (abrunden, nicht abbrechen)
 *   short_answer   sehr knapp → konkretere Frage zum selben Schritt (nur einmal, dann simplify: weiter, konkret)
 *   unsure         Unsicherheit → konkretere Frage (wie short_answer)
 *   off_topic      nichts Erkennbares zum Thema → freundlich zurück zum Schritt (einmal)
 *   disagreement   Widerspruch → Partner bringt ein Gegenargument der anderen Seite
 *   pros_and_cons  Vor- und Nachteile genannt → Position/Entscheidung verlangen
 *   argument       neues Argument genannt (Antwort nicht ausführlich) → dieses Argument vertiefen
 *   introduce_missing  nächster offener Schritt reagiert auf ein Argument → Partner bringt einen noch nicht
 *                  genannten Aspekt ein (fehlender Teil des Gesprächsziels)
 *   next_step      nächster offener Schritt des Ziels (ausführliche Antworten decken Schritte mit ab:
 *                  keine redundanten Nachfragen)
 *   explore        alle Schritte erledigt, Zeit übrig → noch nicht behandelten Aspekt einbringen
 *   conclude       alle Schritte erledigt → Abschlussfrage
 *
 * Schwierigkeit (je Antwort): struggling (blockierender Befund, knapp oder unsicher) → konkrete Frage;
 * confident (fehlerfrei, ≥ 25 Wörter, mindestens eine gezeigte Struktur) → anspruchsvolle Frage; sonst normal.
 */

import { withAnswer } from "./dialogue.js";

export const POLICY_RULES = Object.freeze({
  seconds_per_turn: 75, // Planung: so viele Sekunden je Runde (Antwort + Lesen)
  min_turns: 3,
  max_turns: 24,
  wrap_up_margin_seconds: 30,
  confident_words: 25,
  explore_min_turns_left: 2,
});
export const BUDGET_MINUTES = Object.freeze([5, 10, 15, 20, 30]);

const REACTION_OF_RULE = Object.freeze({
  short_answer: "short", unsure: "unsure", simplify: "acknowledge", off_topic: "off_topic", disagreement: "disagreement",
  pros_and_cons: "pros_and_cons", argument: "argument", introduce_missing: "acknowledge", next_step: "acknowledge",
  explore: "acknowledge", conclude: "acknowledge", wrap_up: "wrap_up",
});

/** Höchste Rundenzahl für ein Zeitbudget. */
export function maxTurnsFor(budgetMinutes) {
  const turns = Math.floor((budgetMinutes * 60) / POLICY_RULES.seconds_per_turn);
  return Math.min(POLICY_RULES.max_turns, Math.max(POLICY_RULES.min_turns + 1, turns));
}

/** Eröffnung: erster Schritt des Ziels, normale Schwierigkeit, ohne Reaktion. */
export function openingDecision({ library, scenario }) {
  const goal = library.conversationGoal(scenario.goal);
  const move = scenarioMove(scenario, goal.moves[0].id);
  return decision({ rule: "opening", move, variant: "standard", reaction: "", question: move.prompt_es, difficulty: "standard" });
}

/**
 * @param {{library: object, scenario: object, dialogue: object, answered: object, analysis: object,
 *   signal: {blocking: number, demonstrated: number}, elapsedSeconds: number, budgetMinutes: number, turnIndex: number}} input
 *   dialogue: kurzfristiger Zustand VOR dieser Antwort (state.dialogue)
 *   answered: die Entscheidung, auf die gerade geantwortet wurde (state.current)
 * @returns {{end: null|"goal_reached"|"time_budget"|"max_turns", decision: object|null, candidates: object[]}}
 */
export function decideNext({ library, scenario, dialogue, answered, analysis, signal, elapsedSeconds, budgetMinutes, turnIndex }) {
  const goal = library.conversationGoal(scenario.goal);
  const finalMove = goal.moves.at(-1);
  const nonFinal = goal.moves.slice(0, -1);
  const after = withAnswer(dialogue, answered, analysis);
  const answeredCount = after.turns_answered;
  const maxTurns = maxTurnsFor(budgetMinutes);
  const remaining = budgetMinutes * 60 - elapsedSeconds;

  // Gesprächsstand NACH dieser Antwort
  const covered = new Set(after.covered_moves);
  const mentioned = new Set(after.aspects_mentioned);
  const raised = new Set(dialogue.aspects_raised);
  const deepened = new Set(dialogue.aspects_deepened);
  const asked = new Set(dialogue.asked_questions.map(norm));
  const uncovered = nonFinal.filter((m) => !covered.has(m.id));
  const difficulty = signal.blocking > 0 || analysis.short || analysis.uncertain ? "struggling"
    : analysis.words >= POLICY_RULES.confident_words && signal.demonstrated >= 1 ? "confident" : "standard";
  const variant = { struggling: "concrete", confident: "challenge", standard: "standard" }[difficulty];

  if (answered.move_id === finalMove.id) {
    const end = remaining <= 0 ? "time_budget" : answeredCount >= maxTurns ? "max_turns" : "goal_reached";
    return { end, decision: null, candidates: [] };
  }

  const make = (rule, moveId, { aspect = null, question = null, v = variant } = {}) => {
    const move = scenarioMove(scenario, moveId);
    const text = question ?? variantText(move, v);
    return decision({ rule, move, aspect, variant: v, question: text, difficulty,
      reaction: reactionText(library, REACTION_OF_RULE[rule], turnIndex) });
  };
  const firstOpen = () => uncovered[0]?.id ?? nonFinal.at(-1).id;
  const userSide = sideOf(scenario, [...mentioned]);
  const freshAspect = (preferOpposite) => pickAspect(scenario, { exclude: new Set([...mentioned, ...raised]), side: preferOpposite ? opposite(userSide) : null });

  const candidates = [];
  const push = (d) => {
    if (d && !asked.has(norm(d.question_es)) && !candidates.some((c) => norm(c.question_es) === norm(d.question_es))) candidates.push(d);
  };
  const final = (rule) => {
    const move = finalMove;
    for (const v of [variant, "standard", "concrete", "challenge"]) {
      const d = make(rule, move.id, { v });
      if (!asked.has(norm(d.question_es))) return d;
    }
    return make(rule, move.id, { question: scenario.decide_es });
  };
  // Erste noch nicht gestellte Variante eines Schritts (keine Frage zweimal)
  const unasked = (rule, moveId, order = [variant, "standard", "concrete", "challenge"]) => {
    for (const v of order) {
      const d = make(rule, moveId, { v });
      if (!asked.has(norm(d.question_es))) return d;
    }
    return null;
  };
  const mayClose = answeredCount >= POLICY_RULES.min_turns - 1; // mindestens drei Runden

  // 1. Zeit/Runden fast verbraucht → abrunden
  if ((remaining < scenarioMove(scenario, finalMove.id).estimated_seconds + POLICY_RULES.wrap_up_margin_seconds
    || answeredCount + 1 >= maxTurns) && answeredCount >= 2) {
    return { end: null, decision: final("wrap_up"), candidates: [final("wrap_up")] };
  }

  // 2. knapp oder unsicher → konkreter (einmal je Schritt), danach weiter mit konkreter Frage
  if (analysis.short || analysis.uncertain) {
    const rule = analysis.uncertain ? "unsure" : "short_answer";
    // Schon einmal konkreter nachgefragt? Dann nicht nochmal bohren, sondern konkret weitergehen.
    const alreadyHelped = ["short_answer", "unsure"].includes(answered.rule);
    if (!alreadyHelped) push(make(rule, answered.move_id, { v: "concrete" }));
    push(make("simplify", uncovered.find((m) => m.id !== answered.move_id)?.id ?? finalMove.id, { v: "concrete" }));
  }

  // 3. am Thema vorbei → zurück zum Schritt (einmal)
  if (analysis.off_topic && answered.rule !== "off_topic") push(unasked("off_topic", answered.move_id, ["concrete", "standard", "challenge"]));

  // 4. Widerspruch → Gegenargument der anderen Seite
  if (analysis.disagree) {
    const aspect = freshAspect(true);
    if (aspect) push(make("disagreement", uncovered.find((m) => raisesAspect(goal, m.id))?.id ?? firstOpen(), { aspect, question: fill(aspect.counter_es, aspect, library) }));
  }

  // 5. Vor- und Nachteile → Position/Entscheidung
  if (analysis.pros_cons && !dialogue.decide_asked) {
    push(make("pros_and_cons", goal.moves.find((m) => m.decides).id, { question: scenario.decide_es }));
  }

  // 6. neues Argument → vertiefen (nicht bei ausführlichen Antworten, die schon genug sagen)
  const fresh = analysis.aspects.filter((id) => !deepened.has(id) && !dialogue.aspects_mentioned.includes(id));
  if (fresh.length && !analysis.long) {
    for (const id of fresh.slice(0, 2)) {
      const aspect = scenario.aspects.find((a) => a.id === id);
      push(make("argument", firstOpen(), { aspect, question: fill(aspect.deepen_es, aspect, library) }));
    }
  }

  // 7. nächster offener Schritt des Ziels (ausführliche Antworten haben Schritte schon abgedeckt)
  if (uncovered.length) {
    const next = uncovered[0];
    const aspect = raisesAspect(goal, next.id) ? freshAspect(true) : null;
    if (aspect) push(make("introduce_missing", next.id, { aspect, question: fill(aspect.counter_es, aspect, library) }));
    push(unasked("next_step", next.id));
  }

  // 8. alles abgedeckt → Aspekt einbringen, solange Zeit ist; sonst abschließen
  const turnsLeft = Math.min(maxTurns - answeredCount, Math.floor(remaining / POLICY_RULES.seconds_per_turn));
  if ((!uncovered.length && turnsLeft > POLICY_RULES.explore_min_turns_left) || (!candidates.length && !mayClose)) {
    const aspect = freshAspect(true);
    if (aspect) push(make("explore", firstOpen(), { aspect, question: fill(aspect.counter_es, aspect, library) }));
  }
  if (!uncovered.length && mayClose) push(final("conclude"));

  const chosen = candidates[0] ?? final("conclude");
  return { end: null, decision: chosen, candidates: candidates.length ? candidates.slice(0, 4) : [chosen] };
}

// ---------------------------------------------------------------- Hilfen

function decision({ rule, move, aspect = null, variant, reaction, question, difficulty }) {
  return {
    rule,
    move_id: move.id,
    exercise_id: move.exercise.id,
    aspect_id: aspect?.id ?? null,
    variant,
    difficulty,
    reaction_es: reaction,
    question_es: question,
  };
}

function scenarioMove(scenario, moveId) {
  const move = scenario.moves.find((m) => m.id === moveId);
  if (!move) throw new TypeError(`Schritt '${moveId}' fehlt im Szenario '${scenario.id}'`);
  return move;
}

function variantText(move, variant) {
  return variant === "concrete" ? move.concrete_es : variant === "challenge" ? move.challenge_es : move.prompt_es;
}

function raisesAspect(goal, moveId) {
  return goal.moves.find((m) => m.id === moveId)?.raises_aspect === true;
}

function reactionText(library, id, turnIndex) {
  const texts = library.conversationReaction(id)?.texts_es ?? [];
  return texts.length ? texts[turnIndex % texts.length] : "";
}

function fill(template, aspect, library) {
  // Zusammenziehungen der Sprache (language.contractions, P20), z. B. Spanisch "de el …" → "del …";
  // Großschreibung des ersten Buchstabens bleibt erhalten ("De el" → "Del")
  let text = template.replaceAll("{label}", aspect.label_es);
  for (const [from, to] of library.language?.contractions ?? []) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    text = text.replace(pattern, (found) => (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()
      ? to.charAt(0).toUpperCase() + to.slice(1) : to));
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Seite des Lerners: Mehrheit der Seiten seiner genannten Aspekte (pro/contra), sonst null. */
function sideOf(scenario, aspectIds) {
  let score = 0;
  for (const id of aspectIds) {
    const side = scenario.aspects.find((a) => a.id === id)?.side;
    score += side === "pro" ? 1 : side === "contra" ? -1 : 0;
  }
  return score > 0 ? "pro" : score < 0 ? "contra" : null;
}

function opposite(side) {
  return side === "pro" ? "contra" : side === "contra" ? "pro" : null;
}

/** Erster noch nicht genannter/eingebrachter Aspekt (Inhaltsreihenfolge), bevorzugt die gewünschte Seite. */
function pickAspect(scenario, { exclude, side }) {
  const open = scenario.aspects.filter((a) => !exclude.has(a.id));
  return (side && open.find((a) => a.side === side)) || open.find((a) => a.side !== "neutral") || open[0] || null;
}

function norm(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}
