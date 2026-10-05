/**
 * Zeitangaben: gespeichert wird immer UTC im ISO-8601-Format mit "Z".
 * Für Streaks und Tagesziele zählt zusätzlich der Kalendertag auf dem Gerät.
 */

export const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Date} date */
export function toUtcIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError("Ungültiges Datum");
  return date.toISOString(); // immer UTC, z. B. 2026-09-24T08:15:00.000Z
}

export function isUtcIso(value) {
  return typeof value === "string" && UTC_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/** Kalendertag (YYYY-MM-DD) in der Zeitzone des Geräts. */
export function localDateOf(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLocalDate(value) {
  return typeof value === "string" && LOCAL_DATE.test(value);
}
