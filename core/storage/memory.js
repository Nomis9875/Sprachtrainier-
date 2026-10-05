/**
 * Speicher im Arbeitsspeicher: für Tests und als Rückfallebene, wenn kein
 * IndexedDB verfügbar ist. Erfüllt denselben Vertrag wie IndexedDBStorage.
 */

import { assertEventShape, compareEvents, matchesQuery } from "./storage.js";

export class MemoryStorage {
  constructor() {
    this._events = new Map();
    this._meta = new Map();
  }

  async appendEvents(events) {
    events.forEach(assertEventShape); // erst alles prüfen, dann speichern (alles oder nichts)
    let added = 0;
    for (const event of events) {
      if (!this._events.has(event.id)) {
        this._events.set(event.id, structuredClone(event));
        added += 1;
      }
    }
    return added;
  }

  async getEvent(id) {
    const event = this._events.get(id);
    return event ? structuredClone(event) : undefined;
  }

  async listEvents({ userId, language, type, since, until, limit } = {}) {
    const events = [...this._events.values()]
      .filter((e) => matchesQuery(e, { userId, language, type, since, until }))
      .sort(compareEvents);
    return (limit === undefined ? events : events.slice(0, limit)).map((e) => structuredClone(e));
  }

  async deleteEvents({ userId }) {
    if (typeof userId !== "string" || !userId) throw new TypeError("deleteEvents: userId erforderlich");
    let deleted = 0;
    for (const [id, event] of this._events) {
      if (event.user_id === userId) {
        this._events.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async getMeta(key) {
    return this._meta.has(key) ? structuredClone(this._meta.get(key)) : undefined;
  }

  async setMeta(key, value) {
    this._meta.set(key, structuredClone(value));
  }

  async deleteMeta(key) {
    return this._meta.delete(key);
  }

  async close() {}
}
