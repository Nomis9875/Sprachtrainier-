/**
 * CompetenceSnapshot v1: der Kompetenzstand eines Nutzers zu einem Stichtag.
 *
 * ─── Architekturregel ──────────────────────────────────────────────────────────
 *
 *   Snapshot = Projektion.   Snapshot ≠ gespeicherter Zustand.
 *
 *   Die Wahrheit sind allein die Ereignisse. Der Snapshot wird bei jedem Aufruf durch
 *   Event Replay neu berechnet und nie gespeichert: keine Tabelle, kein Cache, kein
 *   "letzter Stand". Wer ihn braucht, berechnet ihn. Dieselben Eingaben (Ereignisse,
 *   Nutzer, Skill-Katalog, Stichtag) ergeben immer denselben Snapshot, auch auf einem
 *   anderen Gerät und egal in welcher Reihenfolge die Ereignisse vorliegen.
 *   Ändern sich später die Regeln, gilt die neue Berechnung sofort für die ganze
 *   Geschichte, ohne Datenmigration.
 *
 *   Ereignisse ─collectEvidence─▶ Nachweise ─projectSkill─▶ Skill-Projektion
 *              ─classifyMastery / skillPath / errorTrend / trendBasis─▶ Snapshot
 *
 * ─── Format ────────────────────────────────────────────────────────────────────
 *
 *   format, version     "competence_snapshot", 1
 *   generated_at        Stichtag (asOf, UTC); spätere Ereignisse zählen nicht
 *   user_id
 *   summary             Anzahl Skills je Beherrschungsstufe, je Typ, je Fehlerpfad-Stufe;
 *                       Qwen-Fehler ohne Skill
 *   skills[]            je Skill (nach skill_id sortiert): Stufe, was fehlt, Pfad,
 *                       Fehlertrend, Trend-Grundlage und Trend, Zähler, Übungskontexte, Verlauf
 *   metadata            Inhaltsversion, Ereignisbasis, Geräte, Regelwerk
 */

import { SKILL_TYPES, isSkillId } from "../../content/skills.js";
import { toUtcIso } from "../../util/time.js";
import {
  classifyMastery, classifyTrend, errorTrend, masteryFacts, MASTERY_LEVELS, MASTERY_RULES,
  pathCeiling, SKILL_PATHS, skillPath, trendBasis,
} from "./mastery.js";
import { collectEvidence, projectSkill, round } from "./projection.js";

export const COMPETENCE_SNAPSHOT_FORMAT = "competence_snapshot";
export const COMPETENCE_SNAPSHOT_VERSION = 1;

/**
 * @param {{
 *   events: object[],            alle Ereignisse, beliebige Reihenfolge, von beliebigen Geräten
 *   userId: string,
 *   asOf: Date,                  Stichtag (bestimmt "kürzlich", Fehlerpfad und Trendfenster)
 *   skillIds?: string[],         Skill-Katalog; Skills ohne Nachweis erscheinen als "unknown"
 *   contentVersion?: string|null
 * }} input
 */
export function buildCompetenceSnapshot({ events, userId, asOf, skillIds = [], contentVersion = null }) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError("asOf: gültiges Datum erwartet");
  const cutoff = toUtcIso(asOf);
  const evidence = collectEvidence(events.filter((event) => event.created_at <= cutoff), { userId });

  const bySkill = new Map(skillIds.filter(isSkillId).map((id) => [id, []]));
  for (const record of evidence.records) {
    if (!bySkill.has(record.skill_id)) bySkill.set(record.skill_id, []);
    bySkill.get(record.skill_id).push(record);
  }
  const skills = [...bySkill.keys()].sort().map((id) => skillState(projectSkill(id, bySkill.get(id)), asOf));

  return {
    format: COMPETENCE_SNAPSHOT_FORMAT,
    version: COMPETENCE_SNAPSHOT_VERSION,
    generated_at: cutoff,
    user_id: userId,
    summary: summarize(skills, evidence.untrackedErrors),
    skills,
    metadata: {
      content_version: contentVersion,
      event_count: evidence.eventCount,
      first_event_at: evidence.firstEventAt,
      last_event_at: evidence.lastEventAt,
      device_count: evidence.deviceCount,
      derivation: "event_replay",
      persisted: false,
      mastery_rules: MASTERY_RULES,
    },
  };
}

function skillState(projected, asOf) {
  const path = skillPath(projected, asOf);
  const { level, missing } = classifyMastery(projected, { ceiling: pathCeiling(path) });
  const facts = masteryFacts(projected);
  const basis = trendBasis(projected, asOf);
  const { skill_id: skillId, type, ref_id: refId, recent, history_by_day: historyByDay, ...counters } = projected;
  return {
    skill_id: skillId,
    type,
    ref_id: refId,
    mastery: level,
    next_level_missing: missing,
    path,
    recent_accuracy: facts.signals ? round(facts.recentAccuracy) : null,
    errors: errorTrend(projected, asOf),
    trend_basis: basis,
    trend: classifyTrend(basis),
    ...counters,
    history_by_day: historyByDay,
    recent,
  };
}

function summarize(skills, untrackedErrors) {
  const count = (list) => Object.fromEntries(MASTERY_LEVELS.map((level) => [level, list.filter((s) => s.mastery === level).length]));
  const byMastery = count(skills);
  const errorSkills = skills.filter((s) => s.type === SKILL_TYPES.COMMON_ERROR);
  return {
    total_skills: skills.length,
    unknown_skills: byMastery.unknown,
    introduced_skills: byMastery.introduced,
    practicing_skills: byMastery.practicing,
    stable_skills: byMastery.stable,
    mastered_skills: byMastery.mastered,
    by_type: Object.fromEntries(Object.values(SKILL_TYPES).map((type) => {
      const ofType = skills.filter((s) => s.type === type);
      return [type, { total: ofType.length, ...count(ofType) }];
    })),
    error_paths: Object.fromEntries(
      ["none", ...SKILL_PATHS[SKILL_TYPES.COMMON_ERROR].stages].map((stage) => [stage, errorSkills.filter((s) => s.path.stage === stage).length]),
    ),
    untracked_errors: untrackedErrors,
  };
}
