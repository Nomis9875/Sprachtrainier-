/**
 * ConversationResult v1: Lernanalyse NACH dem Gespräch, allein aus vorhandenen Daten.
 *
 * Quellen: ConversationState (Verlauf, erledigte Gesprächsschritte) und die EvaluationResults der
 * gespeicherten Versuche. Es wird nichts neu bewertet und kein Fehler erfunden:
 * - "Was gut lief": erledigte Gesprächsschritte (kommunikativ) und verlässlich gezeigte Strukturen/Ausdrücke
 * - "Woran wir arbeiten": autoritative Befunde (Regeln/Referenz), nach Häufigkeit
 * - "Natürlicher gesagt": ein Satz des Lerners, in dem genau eine belegte Stelle ersetzt ist (Regelbefund
 *   mit Fundstelle und Korrektur; sonst ein geprüfter KI-Zusatzhinweis, deutlich als solcher markiert)
 */

import { BLOCKING_SEVERITIES, readEvaluation } from "../../evaluation/result.js";

export const CONVERSATION_RESULT_VERSION = 1;
const MAX_ITEMS = 4;

/**
 * @param {{state: object, attempts: Map<string, object>, library: object}} input  attempts: attempt-Ereignisse nach ID
 */
export function buildConversationResult({ state, attempts, library }) {
  const goal = library.conversationGoal(state.goal);
  const answers = state.turns.map((t) => ({ turn: t, attempt: attempts.get(t.attempt_id) })).filter((x) => x.attempt);
  const views = answers.map(({ turn, attempt }) => ({ turn, attempt, view: readEvaluation(attempt.payload.evaluation) }));

  const demonstrated = new Map();
  const errors = new Map();
  let supplemental = 0;
  for (const { view } of views) {
    for (const o of view.observations) {
      if (o.authoritative && o.outcome === "demonstrated" && o.reliability === "high" && !o.skill_id.startsWith("common_error:")) {
        demonstrated.set(o.skill_id, (demonstrated.get(o.skill_id) ?? 0) + 1);
      }
    }
    for (const f of view.findings) {
      if (!f.authoritative) {
        supplemental += 1;
        continue;
      }
      if (!BLOCKING_SEVERITIES.includes(f.severity)) continue;
      const key = f.skill_id ?? f.error_key ?? f.kind;
      const entry = errors.get(key) ?? { key, skill_id: f.skill_id, kind: f.kind, count: 0, example: null };
      entry.count += 1;
      entry.example ??= f.original && f.suggestion ? { original: f.original, suggestion: f.suggestion } : null;
      errors.set(key, entry);
    }
  }
  const label = (id) => library.skill(id)?.label ?? id;
  const covered = new Set(state.dialogue.covered_moves);

  return {
    format: "spanisch-ai.conversation-result",
    version: CONVERSATION_RESULT_VERSION,
    conversation_id: state.conversation_id,
    learner_id: state.learner_id,
    scenario_id: state.scenario_id,
    goal: state.goal,
    status: state.status,
    completion_reason: state.end_reason,
    duration_seconds: state.active_seconds,
    turn_count: state.turns.length,
    evaluation_summary: {
      answers: views.length,
      spoken: views.filter((v) => v.attempt.payload.input_mode === "speech").length,
      error_free: views.filter((v) => !v.view.findings.some((f) => f.authoritative && BLOCKING_SEVERITIES.includes(f.severity))).length,
      words: state.turns.reduce((sum, t) => sum + (t.analysis?.words ?? 0), 0),
    },
    communication: {
      covered: goal.moves.filter((m) => covered.has(m.id)).map((m) => ({ move_id: m.id, name_de: m.name_de })),
      missing: goal.moves.filter((m) => !covered.has(m.id)).map((m) => ({ move_id: m.id, name_de: m.name_de })),
    },
    learning_observations: {
      demonstrated: [...demonstrated].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_ITEMS)
        .map(([skillId, count]) => ({ skill_id: skillId, label: label(skillId), count })),
      to_work_on: [...errors.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)).slice(0, MAX_ITEMS)
        .map((e) => ({ skill_id: e.skill_id, kind: e.kind, label: e.skill_id ? label(e.skill_id) : null, count: e.count, example: e.example })),
      supplemental_hints: supplemental,
    },
    natural_sentence: naturalSentence(views),
  };
}

/** Ein eigener Satz mit genau einer belegten Verbesserung; null, wenn es keinen belegten Befund gibt. */
function naturalSentence(views) {
  const pick = (authoritative) => {
    for (const { attempt, view } of views) {
      const text = attempt.payload.answer_text;
      for (const f of view.findings) {
        if (f.authoritative !== authoritative || !f.original || !f.suggestion) continue;
        const start = authoritative && f.span ? f.span.start : text.indexOf(f.original);
        const end = authoritative && f.span ? f.span.end : start + f.original.length;
        if (start < 0 || text.slice(start, end).toLowerCase() !== f.original.toLowerCase()) continue;
        const sentence = sentenceAround(text, start, end);
        const improved = sentence.text.slice(0, start - sentence.offset) + f.suggestion + sentence.text.slice(end - sentence.offset);
        return { original: sentence.text, improved, explanation_de: f.explanation_de ?? "", source: authoritative ? "rule" : "llm" };
      }
    }
    return null;
  };
  return pick(true) ?? pick(false);
}

function sentenceAround(text, start, end) {
  const before = Math.max(text.lastIndexOf(".", start - 1), text.lastIndexOf("?", start - 1), text.lastIndexOf("!", start - 1));
  const offset = before < 0 ? 0 : before + 1;
  const stops = [".", "?", "!"].map((c) => text.indexOf(c, end)).filter((i) => i >= 0);
  const stop = stops.length ? Math.min(...stops) + 1 : text.length;
  const raw = text.slice(offset, stop);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), offset: offset + lead };
}
