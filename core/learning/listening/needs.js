/**
 * Lernbedarfe aus dem Hörprofil (P15). Eigene Liste (brain.listening_needs), gleiche Form wie die Skill-Bedarfe,
 * damit der Planer sie mit derselben Logik (Zusammensetzung, Lernzone, Zeitbudget) einplant, ohne dass Hören die
 * schriftliche Kompetenz desselben Skills überschreibt.
 *
 *   Grund                    Grundwert  Wann
 *   listening_weakness          50      Hören schwach (ohne Hilfe < 60 %), unabhängig vom schriftlichen Stand
 *   listening_rate_gap          45      langsam/normal verstanden, schneller nicht (Tempo-Signal)
 *   (listening_weakness)        50      auch: ein Akzent schwach, ein anderer verstanden (Ziel: dieser Akzent)
 *   listening_avoidance         35      Höraufgaben zu diesem Skill wiederholt übersprungen / nicht verstanden
 *   listening_evidence_gap      25      schriftlich sicher, beim Hören nie ohne Hilfe geprüft: KEIN Mangel,
 *                                       nur fehlende Evidenz (kontrolliert einführen)
 *   listening_profile_gap       30      (P24) das Sprachprofil zeigt Hören als schwachen Bereich (profile/needs.js
 *                                       listening_practice), aber kein Skill hat einen Hörbedarf (es wurde noch nicht
 *                                       genug gehört): höchstens PROFILE_GAP_SKILLS Skills mit Hörinhalt, die noch
 *                                       nicht sicher gehört wurden, schriftlich bekannte zuerst. Ohne diesen Bedarf
 *                                       käme Hören nie in eine Session, und das Profil bliebe beim Stand der Einstufung.
 *   (kein Bedarf)                –      verified, developing, schriftlich noch unbekannt (erst lernen, dann hören)
 *
 * P16 (Hörkontext), nur aus echter Evidenz (eine Lücke braucht ein verstandenes leichteres UND ein schwaches schwereres
 * Band, je mit ≥ 2 Aufgaben aus ≥ 2 Kontexten; unbekannte Merkmale erzeugen nie einen Bedarf):
 *   context_length_gap          45      kurze Kontexte verstanden, längere nicht (Ziel: die nächste Länge)
 *   contextual_comprehension_gap 45     einzelne Sätze verstanden, zusammenhängende Kontexte nicht
 *   audio_difficulty_gap        40      ein Sprecher verstanden, mehrere nicht; oder bekannte Störgeräusche
 *   inference_gap               40      Messgröße "inference" schwach (Gesamtzustand nicht schwach)
 *   discourse_gap               40      Messgröße "sequence"/"discourse" schwach
 *   speaker_gap                 40      Messgröße "speaker" schwach (nur Aufnahmen mit mehreren Sprechern)
 *
 * Die Werte liegen bewusst unter akuten Fehlern (60) und fälliger Kernarbeit: Hören ergänzt, dominiert nicht.
 */

import { skillsOf } from "./evidence.js";
import { MEASURE_LABELS } from "./model.js";

export const LISTENING_NEED_BASE = Object.freeze({
  listening_weakness: 50,
  listening_rate_gap: 45,
  listening_avoidance: 35,
  listening_evidence_gap: 25,
  listening_profile_gap: 30,
  context_length_gap: 45,
  contextual_comprehension_gap: 45,
  audio_difficulty_gap: 40,
  inference_gap: 40,
  discourse_gap: 40,
  speaker_gap: 40,
});
const NEED_LABELS = Object.freeze({
  listening_weakness: "Hören schwach", listening_rate_gap: "schnelleres Sprechen", listening_avoidance: "Hören wird umgangen",
  listening_evidence_gap: "Hören noch nicht geprüft", listening_profile_gap: "Hörverstehen im Profil schwächer", context_length_gap: "längere Hörtexte",
  contextual_comprehension_gap: "Hören im Zusammenhang", audio_difficulty_gap: "schwierigere Aufnahmen",
  inference_gap: "aus dem Gehörten schließen", discourse_gap: "Zusammenhang im Gehörten", speaker_gap: "Sprecher unterscheiden",
});
const MEASURE_GAPS = Object.freeze([["inference", "inference_gap"], ["discourse", "discourse_gap"], ["sequence", "discourse_gap"],
  ["speaker", "speaker_gap"]]);
const TARGET_OF_MEASURE = Object.freeze({ dictation: "controlled" });
export const PROFILE_GAP_SKILLS = 4;

/**
 * @param {{listening: object, library: object, dimensionNeeds?: object[]}} input  listening: buildListeningProfile();
 *   dimensionNeeds: Bereichsbedarfe des Sprachprofils (profile/needs.js), für listening_profile_gap
 * @returns {object[]} Bedarfe, dringendste zuerst (Gleichstand: Skill-ID)
 */
export function deriveListeningNeeds({ listening, library, dimensionNeeds = [] }) {
  const bySkill = new Map(listening.skills.map((s) => [s.skill_id, s]));
  const avoided = new Set((listening.avoidance.detected ? listening.avoidance.exercises : [])
    .flatMap((id) => { const e = library.anyExercise(id); return e ? skillsOf(e) : []; }));
  const needs = [];
  for (const entry of listening.matrix) {
    const skill = bySkill.get(entry.skill_id) ?? null;
    let reason = null;
    let detail = "";
    let measure = weakestMeasure(skill);
    const measureGap = MEASURE_GAPS.find(([m]) => skill?.by_measure?.[m]?.state === "weak");
    if (skill?.rate_gap) {
      reason = "listening_rate_gap";
      detail = skill.rate_gap.label;
    } else if (skill?.context_length_gap) {
      reason = "context_length_gap";
      detail = skill.context_length_gap.label;
    } else if (skill?.speaker_gap || skill?.noise_gap) {
      reason = "audio_difficulty_gap";
      detail = (skill.speaker_gap ?? skill.noise_gap).label;
    } else if (skill?.accent_gap) {
      reason = "listening_weakness"; // kein eigener Grund: Schwäche in EINEM Akzent (Ziel: dieser Akzent)
      detail = skill.accent_gap.label;
    } else if (skill?.scope_gap) {
      reason = "contextual_comprehension_gap";
      detail = skill.scope_gap.label;
    } else if (skill?.state === "weak") {
      reason = "listening_weakness";
      detail = `beim Hören ${Math.round((skill.success_rate ?? 0) * 100)} % ohne Hilfe`;
    } else if (measureGap) {
      reason = measureGap[1];
      measure = measureGap[0];
      detail = `${MEASURE_LABELS[measure]}: ${Math.round((skill.by_measure[measure].success_rate ?? 0) * 100)} % ohne Hilfe`;
    } else if (avoided.has(entry.skill_id)) {
      reason = "listening_avoidance";
      detail = listening.avoidance.reason;
    } else if (entry.status === "known_not_listening_verified") {
      reason = "listening_evidence_gap";
      detail = skill?.state === "supported" ? "bisher nur mit Hilfe gehört: ohne Transkript prüfen" : "schriftlich sicher, beim Hören noch nicht geprüft";
    }
    if (!reason) continue;
    needs.push(need({ entry, skill, reason, detail, measure, library }));
  }
  // P24: schwacher Hörbereich im Profil, aber noch kein Hörbedarf eines Skills
  if (!needs.length && dimensionNeeds.some((n) => n.dimension === "listening" && n.need === "listening_practice")) {
    const open = listening.matrix
      .filter((entry) => !["verified", "developing", "weak"].includes(bySkill.get(entry.skill_id)?.state ?? "unverified"))
      .map((entry) => ({ entry, skill: bySkill.get(entry.skill_id) ?? null, known: entry.production === "evidence" || entry.recognition === "evidence" }))
      .sort((a, b) => Number(b.known) - Number(a.known) || (a.entry.skill_id < b.entry.skill_id ? -1 : 1))
      .slice(0, PROFILE_GAP_SKILLS);
    for (const { entry, skill } of open) {
      needs.push(need({ entry, skill, reason: "listening_profile_gap", detail: "Hören ergänzen", measure: weakestMeasure(skill), library }));
    }
  }
  return needs.sort((a, b) => b.score - a.score || (a.skill_id < b.skill_id ? -1 : 1));
}

function need({ entry, skill, reason, detail, measure, library }) {
  {
    const value = LISTENING_NEED_BASE[reason];
    const label = NEED_LABELS[reason];
    const factors = [{ key: "need", value, label }];
    return {
      channel: "listening",
      skill_id: entry.skill_id,
      label: library.skill(entry.skill_id)?.label ?? entry.skill_id,
      need: reason,
      reason_code: reason,
      purpose: reason === "listening_evidence_gap" ? "new" : "production",
      score: value,
      priority: value / 100,
      reason: `${label}: ${detail}`,
      reasons: [`${label}: ${detail}`],
      factors,
      priority_factors: factors.map((f) => `+${f.value} ${f.label}`),
      target_evidence: TARGET_OF_MEASURE[measure] ?? "recognized",
      target_measure: measure,
      // nur EINE Größe verändern: bei Tempo-Lücke die nächste Tempo-Stufe, bei Akzent-Lücke dieser Akzent
      target_rate: skill?.rate_gap?.to ?? null,
      target_accent: skill?.accent_gap?.weak?.[0] ?? null,
      // P16: ebenso genau eine Größe: nächste Kontextlänge, mehrere Sprecher, Störgeräusche oder Kontext statt Satz
      target_context_length: reason === "context_length_gap" ? skill.context_length_gap.to : null,
      target_speakers: reason === "audio_difficulty_gap" && skill.speaker_gap ? skill.speaker_gap.to : null,
      target_noise: reason === "audio_difficulty_gap" && !skill.speaker_gap ? skill.noise_gap.to : null,
      target_scope: reason === "contextual_comprehension_gap" ? "context" : null,
      target_measure_label: measure ? MEASURE_LABELS[measure] ?? measure : null,
      listening_state: skill?.state ?? "unverified",
      written_state: skill?.written?.state ?? (entry.status ? "secure" : "unknown"),
      error_state: "none",
      error_pressure: 0,
      repetition_urgency: 0,
      production: null,
    };
  }
}

function weakestMeasure(skill) {
  if (!skill) return null;
  const weak = Object.entries(skill.by_measure).filter(([, s]) => s.state === "weak")
    .sort(([a, x], [b, y]) => (x.success_rate ?? 1) - (y.success_rate ?? 1) || (a < b ? -1 : 1));
  return weak[0]?.[0] ?? null;
}
