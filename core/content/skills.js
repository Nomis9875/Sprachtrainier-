/**
 * Skills: Einheiten, deren Beherrschung das Lernsystem verfolgt.
 * Form der ID: "<typ>:<inhalts-id>", z. B. "lexical_item:tener_en_cuenta".
 * Themen sind keine Skills.
 *
 * Gegenstück: core/content/skills.py. Prüffälle: shared/fixtures/skill_ids.json.
 */

export const SKILL_TYPES = Object.freeze({
  GRAMMAR_STRUCTURE: "grammar_structure",
  LEXICAL_ITEM: "lexical_item",
  COMMON_ERROR: "common_error",
});

const TYPE_VALUES = new Set(Object.values(SKILL_TYPES));
const REF_ID = /^[a-z0-9][a-z0-9_]*$/;
const SKILL_ID = /^(grammar_structure|lexical_item|common_error):([a-z0-9][a-z0-9_]*)$/;

export function skillId(type, refId) {
  if (!TYPE_VALUES.has(type)) throw new TypeError(`Unbekannter Skill-Typ: ${type}`);
  if (!REF_ID.test(refId)) throw new TypeError(`Ungültige Inhalts-ID für einen Skill: ${refId}`);
  return `${type}:${refId}`;
}

/** @returns {{type: string, refId: string}} */
export function parseSkillId(value) {
  const match = typeof value === "string" ? SKILL_ID.exec(value) : null;
  if (!match) throw new TypeError(`Ungültige Skill-ID: ${value}`);
  return { type: match[1], refId: match[2] };
}

export function isSkillId(value) {
  return typeof value === "string" && SKILL_ID.test(value);
}
