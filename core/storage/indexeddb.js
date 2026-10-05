/**
 * Speicher im Browser (IndexedDB): auf dem Laptop im Browser und auf dem iPhone.
 *
 * Objektspeicher:
 *   events  (Schlüssel: id)    Indizes: by_time [created_at, id],
 *                               by_type_time [event_type, created_at, id],
 *                               by_user_time [user_id, created_at, id]   (seit Version 2: Mehrbenutzer)
 *   meta    (Schlüssel: key)   z. B. device_id, Nutzerverzeichnis
 *
 * Versionen: 1 (P5–P9) → 2 (P10) legt nur den Index by_user_time an. Die gespeicherten Ereignisse bleiben
 * unverändert (sie tragen seit jeher user_id); IndexedDB baut den Index beim Upgrade aus den Daten auf.
 *
 * indexedDB und IDBKeyRange werden übergeben (Standard: die des Browsers),
 * damit die Klasse auch in Tests mit einer nachgebildeten IndexedDB läuft.
 */

import { assertEventShape, matchesQuery } from "./storage.js";

export const DB_NAME = "spanisch-ai";
export const DB_VERSION = 2;
const MAX_KEY = "￿";

export class IndexedDBStorage {
  /**
   * @param {{name?: string, indexedDB?: IDBFactory, IDBKeyRange?: typeof IDBKeyRange}} [options]
   */
  static async open({ name = DB_NAME, indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange } = {}) {
    if (!indexedDB) throw new Error("IndexedDB ist in dieser Umgebung nicht verfügbar");
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("by_time", ["created_at", "id"]);
        events.createIndex("by_type_time", ["event_type", "created_at", "id"]);
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (event.oldVersion < 2) {
        request.transaction.objectStore("events").createIndex("by_user_time", ["user_id", "created_at", "id"]);
      }
    };
    const db = await promisify(request);
    return new IndexedDBStorage(db, IDBKeyRange);
  }

  constructor(db, keyRange) {
    this._db = db;
    this._keyRange = keyRange;
  }

  async appendEvents(events) {
    events.forEach(assertEventShape);
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      let added = 0;
      for (const event of events) {
        const request = store.add(event);
        request.onsuccess = () => {
          added += 1;
        };
        request.onerror = (error) => {
          // Bereits vorhandene ID: kein Fehler, sondern "schon gespeichert" (idempotent).
          if (request.error?.name === "ConstraintError") {
            error.preventDefault();
            error.stopPropagation();
          }
        };
      }
      tx.oncomplete = () => resolve(added);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaktion abgebrochen"));
    });
  }

  async getEvent(id) {
    return promisify(this._db.transaction("events").objectStore("events").get(id));
  }

  async listEvents({ userId, language, type, since, until, limit } = {}) {
    const store = this._db.transaction("events").objectStore("events");
    const lower = since ?? "";
    const upper = until ?? MAX_KEY;
    // Obere Grenze [.., until] ohne id: jeder Eintrag mit created_at = until liegt darüber (exklusiv).
    if (userId !== undefined) {
      const unfiltered = type === undefined && language === undefined;
      const own = await promisify(store.index("by_user_time")
        .getAll(this._keyRange.bound([userId, lower], [userId, upper], false, true), unfiltered ? limit : undefined));
      // Sprache und Typ im Speicher filtern: Ereignisse von vor P11B haben kein Sprachfeld (gelten als "es")
      const filtered = unfiltered ? own : own.filter((e) => matchesQuery(e, { language, type }));
      return limit === undefined ? filtered : filtered.slice(0, limit);
    }
    if (language !== undefined) {
      const all = await promisify(store.index("by_time").getAll(this._keyRange.bound([lower], [upper], false, true)));
      const filtered = all.filter((e) => matchesQuery(e, { language, type }));
      return limit === undefined ? filtered : filtered.slice(0, limit);
    }
    const query = type === undefined
      ? store.index("by_time").getAll(this._keyRange.bound([lower], [upper], false, true), limit)
      : store.index("by_type_time").getAll(this._keyRange.bound([type, lower], [type, upper], false, true), limit);
    return promisify(query);
  }

  async deleteEvents({ userId }) {
    if (typeof userId !== "string" || !userId) throw new TypeError("deleteEvents: userId erforderlich");
    const keys = await promisify(this._db.transaction("events").objectStore("events").index("by_user_time")
      .getAllKeys(this._keyRange.bound([userId, ""], [userId, MAX_KEY])));
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return keys.length;
  }

  async getMeta(key) {
    const entry = await promisify(this._db.transaction("meta").objectStore("meta").get(key));
    return entry?.value;
  }

  setMeta(key, value) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteMeta(key) {
    const existed = (await promisify(this._db.transaction("meta").objectStore("meta").count(key))) > 0;
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction("meta", "readwrite");
      tx.objectStore("meta").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return existed;
  }

  async close() {
    this._db.close();
  }

  /**
   * Löscht die ganze Datenbank (alle Ereignisse und Metadaten), z. B. "Alle Lerndaten löschen".
   * Vorher close() aufrufen; offene Verbindungen blockieren das Löschen.
   */
  static async destroy({ name = DB_NAME, indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) throw new Error("IndexedDB ist in dieser Umgebung nicht verfügbar");
    const request = indexedDB.deleteDatabase(name);
    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Die Datenbank ist noch in einem anderen Tab geöffnet"));
    });
  }
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
