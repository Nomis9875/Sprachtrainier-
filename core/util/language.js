/**
 * Sprache eines Lernereignisses (P20: die einzige Stelle mit einer Standardsprache).
 *
 * Seit P11B trägt jedes neue Ereignis seine Sprache, und der Speicher lehnt Ereignisse ohne Sprache ab
 * (storage.js assertLearningEvent). Nur Ereignisse von vor P11B haben keine Angabe: Damals gab es ausschließlich
 * Spanisch, deshalb gelten sie beim Lesen als "es" (nie umgeschrieben). Das ist eine Eigenschaft alter Daten,
 * keine Standardsprache der Engine: Neue Ereignisse, Inhaltspakete und Lerner brauchen immer eine Sprache.
 */
export const LEGACY_EVENT_LANGUAGE = "es";

export function eventLanguage(event) {
  return event.language ?? LEGACY_EVENT_LANGUAGE;
}
