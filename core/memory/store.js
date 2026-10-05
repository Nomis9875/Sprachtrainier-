/**
 * MemoryStore: Ablage für Erinnerungen (MemoryRecord v1, model.js).
 *
 * Vertrag MEMORY_STORE_METHODS (alle asynchron, damit später IndexedDB oder ein Dienst dahinter stehen kann;
 * assertMemoryStore prüft ihn):
 *   add(record)                 neu anlegen (Fehler, wenn die ID schon existiert)
 *   update(id, changes)         ändern; updated_at muss mitgegeben werden (keine Uhr im Speicher)
 *   get(id)                     eine Erinnerung oder undefined
 *   search(query)               Filter + Textsuche, deterministisch sortiert
 *   delete(id)                  entfernen (die Lernhistorie bleibt unberührt)
 *   supersede(oldId, record, {at})  ersetzen: neue Erinnerung anlegen, alte als superseded markieren
 *   listBySkill(skillId), listByType(type)
 *   reconcile(derivation)       abgeleitete Erinnerungen übernehmen (derive.js)
 *
 * Suche: Der Speicher fragt einen Index (MEMORY_INDEX_METHODS: upsert, remove, query). Standard ist ein
 * einfacher lexikalischer Index. Ein späterer semantischer Index (lokale Embeddings) erfüllt
 * dieselbe Schnittstelle und wird nur im Konstruktor ausgetauscht; alles andere bleibt gleich.
 *
 * Die Ereignisse bleiben die Wahrheit: Abgeleitete Erinnerungen lassen sich jederzeit mit
 * deriveMemories() neu berechnen, der Speicher ist nur ein Zwischenstand für schnellen Zugriff.
 */

import { MEMORY_STATUSES, MEMORY_TYPES, OPEN_MEMORY_STATUSES, validateMemoryRecord } from "./model.js";

export class MemoryStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryStoreError";
  }
}

const IMMUTABLE = Object.freeze(["memory_id", "memory_type", "created_at", "schema_version"]);

/** Die Schnittstelle eines MemoryStore (Vertrag oben im Dateikopf). */
export const MEMORY_STORE_METHODS = Object.freeze([
  "add", "update", "get", "search", "delete", "supersede", "listBySkill", "listByType", "reconcile",
]);
/** Die Schnittstelle eines Suchindex (lexikalisch heute, semantisch später). */
export const MEMORY_INDEX_METHODS = Object.freeze(["upsert", "remove", "query"]);

/** Prüft, dass ein Objekt die MemoryStore-Schnittstelle erfüllt (wie assertStorage für Ereignisse). */
export function assertMemoryStore(store) {
  return assertMethods(store, MEMORY_STORE_METHODS, "MemoryStore");
}

export function assertMemoryIndex(index) {
  return assertMethods(index, MEMORY_INDEX_METHODS, "Suchindex");
}

function assertMethods(object, methods, label) {
  const missing = methods.filter((name) => typeof object?.[name] !== "function");
  if (missing.length) throw new TypeError(`${label} unvollständig, es fehlt: ${missing.join(", ")}`);
  return object;
}

/**
 * Lexikalischer Index: Wörter aus Text, Skill-ID und Art, ohne Groß-/Kleinschreibung und Akzente.
 * Treffer = Anteil der Suchwörter, die vorkommen (0..1). Sprachneutral, deterministisch.
 */
export class LexicalMemoryIndex {
  constructor() {
    this._tokens = new Map();
  }

  async upsert(record) {
    this._tokens.set(record.memory_id, new Set(tokenize(`${record.content.text} ${record.skill_id ?? ""} ${record.memory_type}`)));
  }

  async remove(memoryId) {
    this._tokens.delete(memoryId);
  }

  /** @returns {Promise<{memory_id: string, score: number}[]>} nur Treffer mit score > 0 */
  async query(text) {
    const wanted = [...new Set(tokenize(text))];
    if (!wanted.length) return [];
    const hits = [];
    for (const [memoryId, tokens] of this._tokens) {
      const found = wanted.filter((w) => tokens.has(w)).length;
      if (found) hits.push({ memory_id: memoryId, score: Math.round((found / wanted.length) * 10_000) / 10_000 });
    }
    return hits;
  }
}

export function tokenize(text) {
  return String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Lokaler Speicher im Arbeitsspeicher (Tests, Rückfallebene); Kopien schützen vor Veränderung von außen. */
export class LocalMemoryStore {
  /** @param {{index?: {upsert: Function, remove: Function, query: Function}}} [options] */
  constructor({ index = new LexicalMemoryIndex() } = {}) {
    this._records = new Map();
    this._index = assertMemoryIndex(index);
  }

  /** Speicher aus einer Liste (z. B. aus einer späteren Ablage geladen). */
  static async from(records, options) {
    const store = new LocalMemoryStore(options);
    for (const record of records) await store.add(record);
    return store;
  }

  async add(record) {
    validateMemoryRecord(record);
    if (this._records.has(record.memory_id)) throw new MemoryStoreError(`Erinnerung existiert schon: ${record.memory_id}`);
    await this._put(record);
    return structuredClone(record);
  }

  async update(memoryId, changes) {
    const current = this._require(memoryId);
    for (const key of IMMUTABLE) {
      if (key in changes && changes[key] !== current[key]) throw new MemoryStoreError(`${key} ist unveränderlich`);
    }
    if (!("updated_at" in changes)) throw new MemoryStoreError("update: updated_at fehlt (keine implizite Uhr)");
    if (changes.updated_at < current.updated_at) throw new MemoryStoreError("update: updated_at liegt vor dem bisherigen Stand");
    const next = { ...structuredClone(current), ...structuredClone(changes) };
    validateMemoryRecord(next);
    await this._put(next);
    return structuredClone(next);
  }

  async get(memoryId) {
    const record = this._records.get(memoryId);
    return record ? structuredClone(record) : undefined;
  }

  async delete(memoryId) {
    if (!this._records.has(memoryId)) return false;
    this._records.delete(memoryId);
    await this._index.remove(memoryId);
    return true;
  }

  async supersede(oldId, record, { at }) {
    const old = this._require(oldId);
    if (old.status === "superseded") throw new MemoryStoreError(`${oldId} ist schon ersetzt`);
    if (record.memory_id === oldId) throw new MemoryStoreError("eine Erinnerung kann sich nicht selbst ersetzen");
    validateMemoryRecord(record);
    const replaced = { ...structuredClone(old), status: "superseded", superseded_by: record.memory_id, updated_at: at };
    validateMemoryRecord(replaced);
    if (replaced.updated_at < old.updated_at) throw new MemoryStoreError("supersede: at liegt vor dem bisherigen Stand");
    if (this._records.has(record.memory_id)) await this.update(record.memory_id, record);
    else await this.add(record);
    await this._put(replaced);
    return structuredClone(replaced);
  }

  async listBySkill(skillId, { statuses = OPEN_MEMORY_STATUSES } = {}) {
    return this._list((r) => r.skill_id === skillId && statuses.includes(r.status));
  }

  async listByType(type, { statuses = OPEN_MEMORY_STATUSES } = {}) {
    if (!MEMORY_TYPES.includes(type)) throw new MemoryStoreError(`unbekannte Art: ${type}`);
    return this._list((r) => r.memory_type === type && statuses.includes(r.status));
  }

  /**
   * @param {{text?: string, type?: string, skillId?: string, statuses?: string[], minImportance?: number, limit?: number}} [query]
   * @returns {Promise<{record: object, score: number}[]>} mit Text: nur Treffer, beste zuerst;
   *   sonst score 1. Gleichstand: Wichtigkeit, zuletzt geändert, ID.
   */
  async search({ text, type, skillId, statuses = OPEN_MEMORY_STATUSES, minImportance = 0, limit = 10 } = {}) {
    if (!statuses.every((s) => MEMORY_STATUSES.includes(s))) throw new MemoryStoreError("unbekannter Status in der Suche");
    if (!(Number.isInteger(limit) && limit > 0)) throw new MemoryStoreError("limit: positive ganze Zahl erwartet");
    const scores = text === undefined ? null : new Map((await this._index.query(text)).map((h) => [h.memory_id, h.score]));
    const hits = [];
    for (const record of this._records.values()) {
      if (type !== undefined && record.memory_type !== type) continue;
      if (skillId !== undefined && record.skill_id !== skillId) continue;
      if (!statuses.includes(record.status) || record.importance < minImportance) continue;
      const score = scores ? scores.get(record.memory_id) ?? 0 : 1;
      if (score > 0) hits.push({ record, score });
    }
    return hits.sort((a, b) => b.score - a.score || compareRecords(a.record, b.record))
      .slice(0, limit)
      .map((h) => ({ record: structuredClone(h.record), score: h.score }));
  }

  /**
   * Übernimmt das Ergebnis von deriveMemories(): neue anlegen, geänderte ersetzen, gleiche lassen.
   * Manuelle Erinnerungen werden nie überschrieben. Abgeleitete Erinnerungen, die die Ableitung
   * nicht mehr liefert (z. B. Ereignisse fehlen), bleiben unverändert und werden als "orphaned" gemeldet.
   */
  async reconcile(derivation) {
    if (derivation?.format !== "memory_derivation") throw new MemoryStoreError("reconcile: Ergebnis von deriveMemories() erwartet");
    const report = { added: [], updated: [], unchanged: [], skipped_manual: [], orphaned: [] };
    const seen = new Set();
    for (const record of derivation.records) {
      seen.add(record.memory_id);
      const current = this._records.get(record.memory_id);
      if (!current) {
        await this.add(record);
        report.added.push(record.memory_id);
      } else if (current.metadata.origin !== "derived") {
        report.skipped_manual.push(record.memory_id);
      } else if (JSON.stringify(current) === JSON.stringify(record)) {
        report.unchanged.push(record.memory_id);
      } else {
        validateMemoryRecord(record);
        await this._put(record);
        report.updated.push(record.memory_id);
      }
    }
    for (const record of this._records.values()) {
      if (record.metadata.origin === "derived" && !seen.has(record.memory_id)) report.orphaned.push(record.memory_id);
    }
    for (const list of Object.values(report)) list.sort();
    return report;
  }

  /** Alle Erinnerungen (Kopien), nach ID sortiert, z. B. zum Speichern. */
  async all() {
    return [...this._records.values()].sort((a, b) => (a.memory_id < b.memory_id ? -1 : 1)).map((r) => structuredClone(r));
  }

  async _put(record) {
    const copy = structuredClone(record);
    this._records.set(copy.memory_id, copy);
    await this._index.upsert(copy);
  }

  _require(memoryId) {
    const record = this._records.get(memoryId);
    if (!record) throw new MemoryStoreError(`unbekannte Erinnerung: ${memoryId}`);
    return record;
  }

  _list(predicate) {
    return [...this._records.values()].filter(predicate).sort(compareRecords).map((r) => structuredClone(r));
  }
}

function compareRecords(a, b) {
  return b.importance - a.importance
    || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)
    || (a.memory_id < b.memory_id ? -1 : 1);
}
