/**
 * Speicher-Schnittstelle der Lernlogik.
 *
 * Die Lernlogik spricht nur diese Schnittstelle an, nie direkt IndexedDB.
 * Implementierungen: MemoryStorage (Tests), IndexedDBStorage (Browser/iPhone).
 * Später möglich: eine Variante, die mit der Laptop-API synchronisiert.
 *
 * Vertrag (von web/tests/storage_contract.js für jede Implementierung geprüft):
 *
 *   appendEvents(events) → Anzahl neu gespeicherter Ereignisse
 *       Speichert alle Ereignisse gemeinsam (alles oder nichts). Ein Ereignis mit
 *       bereits vorhandener ID wird ignoriert (idempotent, wichtig für Synchronisation).
 *   getEvent(id) → Ereignis oder undefined
 *   listEvents({userId, type, since, until, limit}) → Ereignisse, sortiert nach created_at, dann id
 *       userId: nur die Ereignisse dieses Lerners (Mehrbenutzerbetrieb: jede Lernlogik fragt so);
 *       since: inklusive, until: exklusive (UTC-ISO-Zeitstempel)
 *   deleteEvents({userId}) → Anzahl gelöschter Ereignisse
 *       Nur für "Nutzer löschen": entfernt die gesamte Lernhistorie genau eines Lerners.
 *       Einzelne Ereignisse werden nie geändert oder gelöscht.
 *   getMeta(key) → Wert oder undefined;  setMeta(key, value) (legt an oder ersetzt)
 *   deleteMeta(key) → true, wenn es den Eintrag gab
 *       Metadaten sind Geräte- und Einstellungsdaten (Gerätekennung, Nutzerverzeichnis), nie Lernstand.
 *       Ereignisse werden nie geändert oder einzeln gelöscht: Sie sind die Lernhistorie.
 *
 * Invariante (Mehrbenutzerbetrieb): Jedes gespeicherte Ereignis gehört genau einem Lerner (user_id).
 * Ein Ereignis ohne user_id wird abgelehnt.
 *   close()
 *
 * Gespeicherte Ereignisse sind Kopien: spätere Änderungen am übergebenen Objekt
 * wirken sich nicht aus.
 */

export const STORAGE_METHODS = Object.freeze([
  "appendEvents", "getEvent", "listEvents", "deleteEvents", "getMeta", "setMeta", "deleteMeta", "close",
]);

/** Prüft, dass ein Objekt die Speicher-Schnittstelle erfüllt. */
export function assertStorage(storage) {
  const missing = STORAGE_METHODS.filter((name) => typeof storage?.[name] !== "function");
  if (missing.length) throw new TypeError(`Speicher unvollständig, es fehlt: ${missing.join(", ")}`);
  return storage;
}

/** Gemeinsame Sortierung: nach Zeit, bei gleicher Zeit nach ID. */
export function compareEvents(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function assertEventShape(event) {
  if (!event || typeof event.id !== "string" || typeof event.created_at !== "string" || typeof event.event_type !== "string") {
    throw new TypeError("Ereignis braucht mindestens id, created_at und event_type");
  }
  if (typeof event.user_id !== "string" || !event.user_id) {
    throw new TypeError("Ereignis ohne Lerner (user_id): wird nicht als Lernereignis gespeichert");
  }
  if (typeof event.language !== "string" || !event.language) {
    throw new TypeError("Ereignis ohne Lernsprache (language): wird nicht als Lernereignis gespeichert");
  }
}

// Sprache eines Ereignisses (Ereignisse von vor P11B gelten als "es"): eine Definition für Speicher und Kern
export { LEGACY_EVENT_LANGUAGE, eventLanguage } from "../util/language.js";
import { eventLanguage } from "../util/language.js";

/** Filter für listEvents in Speichern ohne eigenen Index (MemoryStorage, Prüfungen). */
export function matchesQuery(event, { userId, language, type, since, until } = {}) {
  return (userId === undefined || event.user_id === userId)
    && (language === undefined || eventLanguage(event) === language)
    && (type === undefined || event.event_type === type)
    && (since === undefined || event.created_at >= since)
    && (until === undefined || event.created_at < until);
}
