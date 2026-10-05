/**
 * Kurzes Tutorial im Kontext (P25.5): drei Hinweise an echten Momenten der ersten Session statt Folien. Jeder erscheint
 * je Lerner genau einmal (beim Anzeigen gemerkt, nicht erst beim Wegklicken). Gespeichert wird nur als Geräteeinstellung
 * (Speicher-Meta, im Einstieg main.js), nie im Lernverlauf.
 *
 *   first_task     erste Aufgabe: selbst schreiben, Fehler sind Messpunkte
 *   first_error    erste Rückmeldung mit Fehler: der Fehler kommt gezielt wieder
 *   first_summary  erstes Session-Ende: wie Fortschritt gemessen wird
 */

export const TIPS = Object.freeze(["first_task", "first_error", "first_summary"]);
export const TIPS_META_KEY = "tips_seen";

/**
 * Soll der Hinweis jetzt erscheinen? Rein: liefert zusätzlich den neuen Stand (Lerner-ID → gezeigte Hinweise).
 * @param {Record<string, string[]>} seen
 * @returns {{show: boolean, seen: Record<string, string[]>}}
 */
export function takeTip(seen, learnerId, id) {
  const own = Array.isArray(seen?.[learnerId]) ? seen[learnerId] : [];
  if (!learnerId || !TIPS.includes(id) || own.includes(id)) return { show: false, seen: seen ?? {} };
  return { show: true, seen: { ...(seen ?? {}), [learnerId]: [...own, id] } };
}
