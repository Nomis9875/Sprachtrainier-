/**
 * Lerngedächtnis: MemoryRecord v1.
 *
 * Eine Erinnerung ist eine VERDICHTETE, ERKLÄRBARE Aussage über den Lerner, z. B. "verwechselt
 * wiederholt por und para" oder "unter Kontrolle sicher, frei schwach". Sie ist kein Ersatz für die
 * Lernhistorie: Die Ereignisse bleiben die Wahrheit, jede Erinnerung nennt die Ereignisse, aus denen
 * sie stammt (source_event_ids), und lässt sich jederzeit aus ihnen neu ableiten (derive.js).
 * Später soll ein lokales Sprachmodell diese Erinnerungen lesen können (Coaching, Gespräche); dafür
 * gibt es content.text (einfacher Text, geeignet für einen semantischen Index).
 *
 *   memory_id         stabil und deterministisch: "<memory_type>:<Bezug>[:<Detail>]"
 *   memory_type       recurring_error | production_gap | avoided_structure | stable_strength | note
 *   skill_id          Bezug (Skill-ID) oder null (allgemeine Erinnerung, z. B. spätere Notizen)
 *   content           { text, facts }  text: kurze Aussage; facts: strukturierte Zahlen dazu
 *   metadata          { origin, rule_version, evidence_count, days, first_evidence_at, last_evidence_at, as_of, … }
 *   source_event_ids  Herkunft: IDs der Ereignisse (sortiert, eindeutig)
 *   created_at        seit wann das Muster besteht, aus den Ereignissen (nie die Uhr beim Ableiten):
 *                     Fehler: erster Fehler; Lücke und Stärke: Zeitpunkt, ab dem das Muster erkennbar war
 *   updated_at        letzte Änderung der Aussage (letzter relevanter Nachweis bzw. Zeitpunkt des Abgleichs)
 *   confidence        0..1 wie sicher ist das Muster belegt?
 *   importance        0..1 wie wichtig ist es JETZT für das Lernen? (Aktualität, Art)
 *   status            candidate   Muster zeichnet sich ab, noch schwach belegt
 *                     active      belegtes Muster
 *                     weakening   Muster lässt nach (erste Gegenbelege oder lange nicht mehr gesehen)
 *                     resolved    Muster ist überwunden
 *                     superseded  ersetzt durch eine neuere Erinnerung (superseded_by)
 *   superseded_by     memory_id der Nachfolgerin oder null
 *   schema_version    1
 */

import { isSkillId } from "../content/skills.js";
import { isUtcIso } from "../util/time.js";

export const MEMORY_SCHEMA_VERSION = 1;
export const MEMORY_TYPES = Object.freeze([
  "recurring_error", "production_gap", "avoided_structure", "stable_strength", "auditory_recognition_gap", "note",
]);
export const MEMORY_STATUSES = Object.freeze(["candidate", "active", "weakening", "resolved", "superseded"]);
/** Diese Status gelten als "noch relevant" (werden standardmäßig gesucht und gelistet). */
export const OPEN_MEMORY_STATUSES = Object.freeze(["candidate", "active", "weakening"]);
export const MEMORY_ORIGINS = Object.freeze(["derived", "manual"]);

const ID_PATTERN = /^[a-z_]+:[^\s]+$/;
const TEXT_LIMIT = 500;

export class MemoryValidationError extends Error {
  constructor(errors) {
    super(`Ungültige Erinnerung: ${errors.join("; ")}`);
    this.name = "MemoryValidationError";
    this.errors = errors;
  }
}

/**
 * Baut eine Erinnerung mit Standardwerten und prüft sie.
 * Zeitpunkte sind Pflicht (keine Uhr im Modell).
 */
export function createMemoryRecord({
  memoryId, memoryType, skillId = null, text, facts = {}, metadata = {}, sourceEventIds = [],
  createdAt, updatedAt = createdAt, confidence, importance, status = "candidate", supersededBy = null,
}) {
  const record = {
    memory_id: memoryId,
    memory_type: memoryType,
    skill_id: skillId,
    content: { text, facts },
    metadata: { origin: "manual", ...metadata },
    source_event_ids: [...new Set(sourceEventIds)].sort(),
    created_at: createdAt,
    updated_at: updatedAt,
    confidence,
    importance,
    status,
    superseded_by: supersededBy,
    schema_version: MEMORY_SCHEMA_VERSION,
  };
  validateMemoryRecord(record);
  return record;
}

/** Liefert eine Liste von Fehlern (leer = gültig). */
export function memoryRecordErrors(record) {
  const errors = [];
  if (record === null || typeof record !== "object") return ["kein Objekt"];
  if (record.schema_version !== MEMORY_SCHEMA_VERSION) errors.push(`schema_version ${record.schema_version} (erwartet ${MEMORY_SCHEMA_VERSION})`);
  if (typeof record.memory_id !== "string" || !ID_PATTERN.test(record.memory_id)) errors.push("memory_id: '<typ>:<bezug>' erwartet");
  if (!MEMORY_TYPES.includes(record.memory_type)) errors.push(`memory_type unbekannt: ${record.memory_type}`);
  else if (typeof record.memory_id === "string" && !record.memory_id.startsWith(`${record.memory_type}:`)) {
    errors.push("memory_id muss mit memory_type beginnen");
  }
  if (record.skill_id !== null && !isSkillId(record.skill_id)) errors.push(`skill_id ungültig: ${record.skill_id}`);
  if (record.memory_type !== "note" && record.skill_id === null) errors.push(`${record.memory_type} braucht eine skill_id`);
  const text = record.content?.text;
  if (typeof text !== "string" || !text.trim()) errors.push("content.text fehlt");
  else if (text.length > TEXT_LIMIT) errors.push(`content.text länger als ${TEXT_LIMIT} Zeichen`);
  if (!isPlainObject(record.content?.facts)) errors.push("content.facts: Objekt erwartet");
  if (!isPlainObject(record.metadata)) errors.push("metadata: Objekt erwartet");
  else if (!MEMORY_ORIGINS.includes(record.metadata.origin)) errors.push(`metadata.origin unbekannt: ${record.metadata.origin}`);
  if (!Array.isArray(record.source_event_ids) || !record.source_event_ids.every((id) => typeof id === "string" && id)) {
    errors.push("source_event_ids: Liste von IDs erwartet");
  } else if (record.metadata?.origin === "derived" && record.source_event_ids.length === 0) {
    errors.push("abgeleitete Erinnerung ohne Herkunft (source_event_ids leer)");
  }
  if (!isUtcIso(record.created_at)) errors.push("created_at: UTC-Zeitstempel erwartet");
  if (!isUtcIso(record.updated_at)) errors.push("updated_at: UTC-Zeitstempel erwartet");
  else if (isUtcIso(record.created_at) && record.updated_at < record.created_at) errors.push("updated_at liegt vor created_at");
  for (const key of ["confidence", "importance"]) {
    if (typeof record[key] !== "number" || !(record[key] >= 0 && record[key] <= 1)) errors.push(`${key}: Zahl 0..1 erwartet`);
  }
  if (!MEMORY_STATUSES.includes(record.status)) errors.push(`status unbekannt: ${record.status}`);
  if (record.status === "superseded") {
    if (typeof record.superseded_by !== "string" || !record.superseded_by) errors.push("superseded ohne superseded_by");
    else if (record.superseded_by === record.memory_id) errors.push("eine Erinnerung kann sich nicht selbst ersetzen");
  } else if (record.superseded_by !== null) {
    errors.push("superseded_by nur bei status superseded");
  }
  return errors;
}

export function validateMemoryRecord(record) {
  const errors = memoryRecordErrors(record);
  if (errors.length) throw new MemoryValidationError(errors);
  return record;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
