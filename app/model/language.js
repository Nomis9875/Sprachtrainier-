/**
 * Anzeige von Lernsprachen, Sprachprofil und Einstufung (P11B), DOM-frei und testbar.
 *
 * Grundregel: Die Oberfläche behauptet nie mehr, als die Daten tragen. Eine Stufe erscheint nur mit ihrer
 * Sicherheit; bei geringer Sicherheit als "etwa … (vorläufig)", bei zu wenig Daten gar nicht. Bereiche ohne
 * Einstufungsaufgaben heißen "noch nicht messbar", nicht "schwach".
 */

import { presentExercise } from "./exercise.js";
import { presentPlacementListening } from "./listening.js";
import { explain } from "./explain.js";
import { t } from "./i18n.js";

export const DIMENSION_NAMES = Object.freeze({
  grammar: "Grammatik",
  vocabulary: "Wortschatz",
  reading: "Leseverstehen",
  listening: "Hörverstehen",
  production: "Schreiben",
  conversation: "Sprechen im Gespräch",
});
export const DIMENSION_ORDER = Object.freeze(Object.keys(DIMENSION_NAMES));
export const CEFR_CHOICES = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"]);
const CONFIDENCE_TEXT = Object.freeze({
  high: "hohe Sicherheit",
  medium: "mittlere Sicherheit",
  low: "geringe Sicherheit, vorläufig",
  none: "noch nicht einschätzbar",
});
const MODULE_STATUS_TEXT = Object.freeze({
  pending: "offen", in_progress: "läuft", done: "erledigt", skipped: "ausgelassen", unavailable: "noch keine Aufgaben",
});

/** Wie eine Stufe angezeigt wird: nie genauer, als die Sicherheit erlaubt. */
export function levelClaim(entry) {
  if (!entry || entry.status === "unknown") return { text: "–", detail: t("app.no_data") };
  if (entry.status === "insufficient") return { text: "–", detail: t("claim.insufficient") };
  const label = entry.level_label;
  if (entry.confidence === "low") return { text: t("claim.about", label), detail: t("claim.low") };
  return { text: label, detail: CONFIDENCE_TEXT[entry.confidence] ? t(`claim.${entry.confidence}`) : "" };
}

/** Name eines Kompetenzbereichs in der Sprache der App. */
export function dimensionName(id) {
  return DIMENSION_NAMES[id] ? t(`dim.${id}`) : id;
}

/**
 * @param {{profile: object, history?: object[], openAssessment?: object|null, library: object}} input
 */
export function presentLanguageProfile({ profile, history = [], openAssessment = null, library }) {
  const gaps = new Set(profile.content_gaps.map((g) => g.dimension));
  const overall = levelClaim(profile.overall);
  return {
    language_id: profile.language_id,
    overall: { ...overall, status: profile.overall.status, confidence: profile.overall.confidence,
      basis: (profile.overall.basis ?? []).map((d) => dimensionName(d)) },
    dimensions: DIMENSION_ORDER.map((id) => {
      const x = profile.dimensions[id];
      const claim = levelClaim(x);
      return {
        id, name_de: dimensionName(id), status: x.status, confidence: x.confidence, text: claim.text,
        detail: gaps.has(id) && x.status === "unknown" ? t("claim.no_tasks") : claim.detail,
        measurements: x.measurements ?? 0,
        from_assessment: x.sources?.assessment ?? 0,
        from_practice: x.sources?.practice ?? 0,
        content_gap: gaps.has(id),
      };
    }),
    strengths: profile.strengths.map((s) => `${dimensionName(s.dimension)} (${s.level_label})`),
    weaknesses: profile.weaknesses.map((w) => `${dimensionName(w.dimension)} (${w.level_label})`),
    weak_dimensions: profile.weaknesses.map((w) => ({ id: w.dimension, level_label: w.level_label })),
    vocabulary: { active_items: profile.vocabulary_estimate.active_items, stable_items: profile.vocabulary_estimate.stable_items,
      size_note: profile.vocabulary_estimate.size_note },
    self_assessment: profile.self_assessment?.level ?? null,
    last_assessment: profile.last_assessment,
    next_reassessment: profile.next_reassessment,
    reassessment_due: Boolean(profile.next_reassessment?.due),
    has_assessment_content: DIMENSION_ORDER.some((d) => !gaps.has(d)),
    content_gaps: profile.content_gaps.map((g) => dimensionName(g.dimension)),
    open_assessment_id: openAssessment?.assessment_id ?? null,
    history: history.map((h) => ({ at: h.at, source: h.source, ...levelClaim(h.overall), confidence: h.overall.confidence })),
    content_version: library.contentVersion,
  };
}

/**
 * Was folgt aus dem Sprachprofil für das Lernen? (P22: Übergang Einstufung → Lernen, "Was als Nächstes?")
 * Schwach heißt: deutlich unter dem Gesamtniveau und belegt (profile.weaknesses). Ungemessen heißt: zu wenige
 * Antworten; das ist ausdrücklich keine Schwäche. Reine Darstellung der Profilwerte, keine eigene Logik.
 * @param {ReturnType<typeof presentLanguageProfile>} p
 */
export function learningOutlook(p, language = "de") {
  const names = explain(language, "dimensions");
  const weak = (p.weak_dimensions ?? []).map((w) => `${names[w.id] ?? w.id} (${w.level_label})`);
  const unmeasured = p.dimensions.filter((d) => (d.status === "unknown" || d.status === "insufficient") && !d.content_gap).map((d) => names[d.id] ?? d.name_de);
  const lines = [];
  if (weak.length) lines.push(explain(language, "outlook_weak", weak.join(", ")));
  else if (p.overall.status === "estimated") lines.push(explain(language, "outlook_even"));
  // P24: Lesen kommt mangels Texten nicht in jede Session; das wird nicht versprochen
  if ((p.weak_dimensions ?? []).some((w) => w.id === "reading")) lines.push(explain(language, "outlook_reading"));
  if (unmeasured.length) lines.push(explain(language, "outlook_unmeasured", unmeasured.join(", ")));
  return { weak, unmeasured, lines };
}

/** Einstufung: Module, aktuelle Aufgabe (ohne Lösung), am Ende das Ergebnis dieser Einstufung. */
export function presentAssessment({ state, current, library }) {
  const modules = state.modules.map((m) => ({
    id: m.dimension, name_de: dimensionName(m.dimension), status: m.status, status_text: t(`module.${m.status}`),
    answered: m.answered,
  }));
  const counted = modules.filter((m) => m.status !== "unavailable");
  const finished = state.status === "completed" || state.status === "abandoned";
  return {
    assessment_id: state.assessment_id,
    status: state.status,
    kind: state.kind,
    paused: state.status === "paused",
    finished,
    self_assessment: state.self_assessment,
    modules,
    progress: { done: counted.filter((m) => ["done", "skipped"].includes(m.status)).length, total: counted.length },
    current: !finished && current ? presentItem(current, library) : null,
    result: finished ? {
      estimated: levelClaim({ status: state.estimated_level ? "estimated" : "unknown", level_label: state.estimated_level, confidence: state.confidence }),
      modules: Object.entries(state.results).map(([id, r]) => ({ id, name_de: dimensionName(id), ...levelClaim({ status: "estimated", ...r }) })),
    } : null,
  };
}

function presentItem({ item, exercise }, library) {
  return {
    item_id: item.id,
    dimension: item.dimension,
    dimension_name: dimensionName(item.dimension),
    format: item.format,
    prompt_de: item.prompt_de,
    stimulus_es: item.stimulus_es,
    passage_es: item.passage_es,
    // Reihenfolge der Optionen: fest je Aufgabe, aber unabhängig von der Reihenfolge im Inhalt
    options: item.format === "choice" ? shuffled(item.options.map((o) => o.text), item.id) : [],
    partner_role_de: item.partner_role_de,
    listening: item.audio ? presentPlacementListening(library?.audio(item.audio)) : null,
    min_words: item.min_words,
    exercise: item.format === "open" ? presentExercise(exercise) : null,
  };
}

function shuffled(values, seed) {
  const key = (text) => {
    let h = 2166136261;
    for (const ch of `${seed}|${text}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
    return h;
  };
  return [...values].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1));
}
