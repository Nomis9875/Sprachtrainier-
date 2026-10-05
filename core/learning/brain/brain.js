/**
 * Adaptive Learning Brain: der ganze Weg von den Ereignissen zu den Lernbedarfen in einem Aufruf.
 *
 *   Ereignisse ─▶ CompetenceSnapshot ─┐
 *              ─▶ ReviewSnapshot ─────┼─▶ LearnerProfile ─▶ LearningNeeds ─▶ (planSession)
 *              ─▶ Erinnerungen ───────┘
 *              ─▶ LanguageProfile (P11B, Stufe je Kompetenzbereich) ─▶ Bedarfe je Bereich ─▶ (planSession)
 *
 * Alles gilt für EINEN Lerner in EINER Sprache: Die Ereignisse kommen bereits so gefiltert an
 * (engine.history()), die Bibliothek ist das Inhaltspaket dieser Sprache.
 *
 * Rein und deterministisch: gleiche Ereignisse + gleicher Stichtag → gleiches Ergebnis. Kein Zufall,
 * keine Uhr (asOf ist Pflicht), kein Speicherzugriff, keine KI. Browserfähig.
 */

import { buildCompetenceSnapshot } from "../competence/snapshot.js";
import { deriveMemories } from "../../memory/derive.js";
import { buildReviewSnapshot } from "../repetition/snapshot.js";
import { deriveLearningNeeds } from "./needs.js";
import { buildLearnerProfile } from "./profile.js";
import { buildLanguageProfile } from "../profile/language-profile.js";
import { profileNeeds } from "../profile/needs.js";
import { buildListeningProfile } from "../listening/evidence.js";
import { deriveListeningNeeds } from "../listening/needs.js";
import { eventLanguage } from "../../util/language.js";

/**
 * @param {{events: object[], userId: string, asOf: Date, library: object}} input
 * @returns {{snapshot: object, reviews: object, memories: object[], profile: object, needs: object[],
 *   language_profile: object, dimension_needs: object[]}}
 */
export function buildLearnerBrain({ events: allEvents, userId, asOf, library }) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) throw new TypeError("asOf: gültiges Datum erwartet");
  if (!Array.isArray(allEvents)) throw new TypeError("events: Liste erwartet");
  if (typeof library.languageId !== "string" || !library.languageId) throw new TypeError("library: Inhaltspaket ohne Sprache");
  // P20: Sprachtrennung im Kern selbst, nicht nur beim Aufrufer: Ereignisse einer anderen Sprache erreichen weder
  // Kompetenz noch Gedächtnis, Hören oder Bedarfe (auch wenn ein Aufrufer ungefiltert übergibt)
  const events = allEvents.filter((e) => eventLanguage(e) === library.languageId);
  const skillIds = library.skills().map((s) => s.id);
  const snapshot = buildCompetenceSnapshot({ events, userId, asOf, skillIds, contentVersion: library.contentVersion });
  const reviews = buildReviewSnapshot({ events, userId, asOf, skillIds });
  const memories = deriveMemories({ events, userId, asOf, library, snapshot }).records;
  const profile = buildLearnerProfile({ snapshot, reviews, memories, library });
  const needs = deriveLearningNeeds({ profile, snapshot, reviews, library });
  const languageProfile = buildLanguageProfile({
    events, library, learnerId: userId, languageId: library.languageId, asOf, competence: snapshot,
  });
  // P15: Hören als eigene Evidenzquelle (Profil, Bedarfe, Erinnerungskandidaten), getrennt von der schriftlichen Kompetenz
  const listening = buildListeningProfile({ events, library, userId, asOf, snapshot });
  const dimensionNeeds = profileNeeds(languageProfile);
  return {
    snapshot, reviews, memories, profile, needs, language_profile: languageProfile, dimension_needs: dimensionNeeds,
    listening, listening_needs: deriveListeningNeeds({ listening, library, dimensionNeeds }),
  };
}
