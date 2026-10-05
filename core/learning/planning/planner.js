/**
 * Session Planner: "Was soll der Nutzer als Nächstes trainieren, und wann was wiederholen?"
 *
 *   ContentLibrary ────────┐
 *   CompetenceSnapshot ────┼─▶ Priorität je Skill (priority.js) ─▶ Auswahl ─▶ SessionPlan v2
 *   ReviewSnapshot ────────┤   Kompetenzbedarf + Wiederholung        Mischung, Zeitbudget,
 *   Ereignisse (Versuche) ─┘   mit benannten Faktoren                  Reihenfolge, Gründe
 *
 * Der Plan ist eine reine Berechnung: deterministisch (kein Zufall, keine Uhr; Stichtag = Snapshot,
 * Gleichstände nach ID), nicht gespeichert, jederzeit neu erzeugbar. Er wählt nur vorhandene Übungen
 * und arbeitet sprachneutral mit Skill- und Übungsdaten (Typ, Nachweisstufe, Thema, Niveau).
 *
 * ─── Ablauf ────────────────────────────────────────────────────────────────────
 *
 * 1. Priorität je Skill aus dem Adaptive Learning Brain (brain/needs.js learningNeedFor):
 *    Bedarf aus der Kompetenz plus Wiederholungsstand (scoreSkillForSession) plus Lernprofil und
 *    Erinnerungen (wiederkehrend, hartnäckig, überwunden, umgangen, sicher in verschiedenen Übungen).
 *    Kein Bedarf (beherrscht, nicht fällig, überwunden) → nicht geplant. Bedarf ohne Übung → Inhaltslücke.
 * 2. Mischung: Je mehr akuter Bedarf (Fehler, Instabilität, fällige Wiederholung mit hoher
 *    Priorität), desto weniger neue Skills; ohne akuten Bedarf mindestens ein neuer Skill, wenn es
 *    einen gibt. Steht sonst nichts an, füllen neue Skills die Session (lieber Neues als eine halb
 *    leere Session). Höchstens 1 Kontrolle beherrschter Skills, höchstens 2 Fokus-Skills je Thema.
 *    Übungen je Skill nach Zweck (EXERCISES_PER_PURPOSE): Fehler bis zu 3, Neues 2 (Kaltstart), Kontrolle und
 *    einzelner Fehler (einmal prüfen) 1.
 * 3. Übungswahl je Skill (scoreExercise): passende Nachweisstufe (aktive Produktion vor Erkennen),
 *    andere Übung und Übungsform als zuletzt für diesen Skill, nicht kürzlich gemacht, Abwechslung in
 *    der Session, deckt weitere dringende Skills ab. Runde 2 gibt Fokus-Skills eine zweite, andere
 *    Übung (Variation oder Transfer), solange Zeit bleibt, bevorzugt eine Stufe höher als die vorige
 *    (Aktivierung → kontrolliert → frei: Transfer statt Drill).
 * 4. Zeitbudget: Die Summe der geschätzten Dauer bleibt unter dem Budget minus 10 % Reserve
 *    (Rückmeldung, Übergänge). Es wird nie überschritten.
 * 5. Reihenfolge: von kontrolliert zu spontan; derselbe Skill oder dieselbe Übungsform stehen nicht
 *    direkt hintereinander, wenn es sich vermeiden lässt.
 *
 * Zusammensetzung (P12, composition.js): Fehlerfokus, Wiederholung, Neues, schwächster Bereich und Messen
 * bekommen Anteile, die sich den Signalen anpassen; sie begrenzen den ersten Auswahldurchgang, danach füllt
 * die Priorität. Der Plan nennt Anteile, Anpassungen und die Kategorie jeder Übung.
 *
 * Lernzone (P12, zone.js): Mit einer verlässlichen Schätzung des Könnens (Sprachprofil) werden neue Skills
 * nur in der Lernzone eingeführt (zu leichte und zu schwere werden im Plan benannt, nicht geplant), und jede
 * Übung bekommt einen Faktor je nach Abstand ihrer Schwierigkeit zum Können. Ohne Schätzung: neutral.
 *
 * Lernzone v2 (P14A, zone.js taskZone): Je Übung zuerst, was der Lerner mit genau diesem Skill gezeigt hat
 * (Produktionsprofil), dann der Bereich im Sprachprofil, sonst "evidence_gap" (neutral). Klassen mastery_zone,
 * learning_zone, stretch, below_zone, evidence_gap. below_zone nur, wenn der Skill keine andere Übung hat (nie als
 * Folgeübung). Jede Übung ist core (Lernen/Abruf), stretch (bewusst gestreckt, höchstens maxStretch je Session)
 * oder diagnostic (Evidenzlücke, Messen) und trägt eine strukturierte Begründung (why).
 *
 * Kalibrierung und Erkundung (P14B): Mit einer Kalibrierung (calibration/calibration.js, alle Lerner dieser Sprache)
 * gilt für kalibrierte Aufgaben ihre gemessene Schwierigkeit; auffällige Aufgaben (too_hard, too_easy, unstable,
 * possible_mismatch) bekommen einen Abzug, werden also gemieden, wenn es Alternativen gibt, nie gelöscht. Ohne
 * Kalibrierung plant der Planer wie bisher. Neue Skills beginnen kontrolliert (Kaltstart); "zu leichte" neue Skills
 * verschwinden nicht mehr, sondern sind Erkundungskandidaten. Erkundung: höchstens explorationMax Übung in einem
 * reservierten Fokusplatz, aber nur, wenn der akute Bedarf ihn nicht braucht (nie gegen Kernarbeit), gezielt statt zufällig: lange nicht geprüft → fehlende
 * Produktionsevidenz → unbekannter Skill (Kaltstart).
 *
 * Hören (P15, listening/): Hörbedarfe (brain.listening_needs) werden eigene Kandidaten mit NUR Höraufgaben;
 * Skill-Bedarfe bekommen keine Höraufgaben (Hören ist eigene Evidenz). Höchstens maxListeningShare der Übungen sind
 * Höraufgaben (mindestens 1), je Hörbedarf eine Übung, nie zwei Höraufgaben direkt nacheinander. Unverifiziertes Hören
 * zählt zum Messen (Diagnose), schwaches zum schwächsten Bereich. Bei einer Tempo-Lücke wird die nächste Tempo-Stufe
 * gewählt (nur eine Größe ändert sich).
 *
 * Challenge-Übungen dürfen wegen eines Skills gewählt werden, verraten ihn aber nicht: Der Plan ist
 * intern (mit Skill und Gründen); was der Lerner sieht, liefert learnerView().
 */

import { beginnerExercises } from "./beginner.js";
import { SKILL_TYPES, parseSkillId } from "../../content/skills.js";
import { diagnoseDifficulty, difficultyLabel } from "../calibration/calibration.js";
import { audioDifficulty, audioFeatures, isListening } from "../listening/model.js";
import { deriveMemories } from "../../memory/derive.js";
import { LEARNING_NEED_VERSION, learningNeedFor } from "../brain/needs.js";
import { exerciseDimensions } from "../profile/needs.js";
import { LEARNER_PROFILE_VERSION, buildLearnerProfile } from "../brain/profile.js";
import { evidenceForExercise } from "../competence/evidence.js";
import { buildReviewSnapshot } from "../repetition/snapshot.js";
import { isGermanism, skillMeta } from "./needs.js";
import { ZONE_CLASS_FACTORS, ZONE_FACTORS, ZONE_RULES, exerciseDifficulty, exerciseZone, skillLadder, skillZone, taskZone } from "./zone.js";
import { CATEGORIES, categoryOf, compositionFor, focusCaps } from "./composition.js";

export const SESSION_PLAN_FORMAT = "session_plan";
export const SESSION_PLAN_VERSION = 2;

/**
 * Sessionlängen: höchstens so viele Fokus-Skills und Übungsplätze; das Zeitbudget begrenzt zusätzlich.
 * Eine kurze Übung (unter SHORT_EXERCISE_SECONDS, z. B. Auswahl oder Lücke) belegt einen halben Platz (P12):
 * Sonst bliebe eine 30-Minuten-Session mit kurzen Übungen halb leer.
 */
export const SESSION_LENGTHS = Object.freeze({
  5: Object.freeze({ focus: 2, maxExercises: 2 }),
  10: Object.freeze({ focus: 3, maxExercises: 4 }),
  15: Object.freeze({ focus: 3, maxExercises: 5 }),
  20: Object.freeze({ focus: 4, maxExercises: 6 }),
  30: Object.freeze({ focus: 5, maxExercises: 8 }),
});

export const PLANNER_RULES = Object.freeze({
  safetyMargin: 0.1, // 10 % des Budgets bleiben frei (Rückmeldung, Übergänge)
  maxFocusPerTopic: 2,
  maxMaintenance: 1,
  followUpMaxDistance: 1, // Folgeübung: höchstens so viele Nachweisstufen UNTER dem Ziel …
  followUpMaxAscent: 2, // … und höchstens so viele ÜBER dem Ziel (Leiter: kontrolliert aktivieren, dann frei anwenden)
  contentGapMinPriority: 40,
  coverageMinPriority: 40, // "weitere dringende Skills" für den Abdeckungsbonus
  acuteMinScore: 55, // akuter Bedarf: ab dieser Priorität bei Fehlern oder fälliger Wiederholung
  ladderStep: 6, // Folgeübung eine Stufe höher (+) bzw. niedriger (−) als die vorige zum selben Skill
  gapSecureLevel: 25, // P13: Produktionslücke, Übung auf der schon sicheren Stufe (oder darunter)
  recentHours: 48,
  weekHours: 168,
  zoneNewBonus: 10, // P12: neuer Skill genau in der Lernzone (zone.js)
  spareMinSeconds: 150, // P12: ab so viel freier Zeit (und spareMinShare des Budgets) ein zusätzlicher Fokus-Skill
  spareMinShare: 0.15,
  stretchPerExercises: 4, // P14A: höchstens 1 Stretch-Übung je 4 Übungen (mindestens 1)
  qualityPenalty: 8, // P14B: auffällige Aufgabe (Kalibrierung) → Alternative bevorzugen
  explorationMax: 1, // P14B: höchstens so viele Erkundungsübungen …
  explorationMinExercises: 5, // … und nur in Sessions mit mindestens so vielen Übungen (ab 15 Minuten)
  explorationStaleDays: 60, // "lange nicht geprüft"
  maxListeningShare: 1 / 3, // P15: höchstens ein Drittel der Übungen sind Höraufgaben (mindestens 1)
  listeningMeasureBonus: 6, // P15: Höraufgabe misst genau die schwache Messgröße
});
const SHORT_EXERCISE_SECONDS = 60;
const slotCost = (exercise) => (exercise.estimated_seconds < SHORT_EXERCISE_SECONDS ? 0.5 : 1);

/**
 * Höchstzahl Übungen je Fokus-Skill nach Zweck: Fehler brauchen mehrere Anläufe in wechselnder Form,
 * ein neuer Skill wird kontrolliert eingeführt und einmal eine Stufe höher geübt (P14B Kaltstart), eine Kontrolle
 * beherrschter Skills ist kurz.
 */
export const EXERCISES_PER_PURPOSE = Object.freeze({
  error_focus: Object.freeze({ short: 2, long: 3 }), // long: ab LONG_SESSION_MINUTES
  review: Object.freeze({ short: 2, long: 2 }),
  production: Object.freeze({ short: 2, long: 2 }),
  consolidate: Object.freeze({ short: 2, long: 2 }),
  new: Object.freeze({ short: 2, long: 2 }), // P14B Kaltstart: kontrolliert einführen, dann eine Stufe höher
  challenge: Object.freeze({ short: 1, long: 1 }),
});
const LONG_SESSION_MINUTES = 20;

const LADDER = ["recognized", "controlled", "guided", "free", "spontaneous"];
const PRODUCTION = new Set(["guided", "free", "spontaneous"]);
const HOUR_MS = 3_600_000;

export const OBJECTIVES = Object.freeze({
  diagnostic: "Standortbestimmung",
  error_reduction: "Typische Fehler abbauen",
  interference_reduction: "Einflüsse der Erstsprache abbauen",
  review: "Wiederholen, was fällig ist",
  spontaneous_production: "Spontane Produktion",
  free_production: "Freie Produktion",
  topic_focus: "Schwerpunkt",
  vocabulary_activation: "Wortschatz aktivieren",
  grammar_consolidation: "Grammatik festigen",
  nothing_to_plan: "Nichts zu planen",
});

/**
 * @param {{
 *   library: import("../../content/library.js").ContentLibrary,
 *   snapshot: object,          CompetenceSnapshot v1 (bestimmt Nutzer und Stichtag)
 *   reviews?: object|null,     ReviewSnapshot v1 zum selben Stichtag; ohne Angabe aus `events` berechnet
 *   events?: object[],         Ereignisverlauf (Wiederholung, "kürzlich gemacht", letzte Übungsform)
 *   memories?: object[]|null,  MemoryRecords zum selben Stichtag; ohne Angabe aus `events` abgeleitet
 *   minutes: 5|10|15|20|30,
 *   dimensionNeeds?: object[],  Bedarfe je Kompetenzbereich (profile/needs.js)
 *   ability?: object|null       Können je Bereich (zone.js abilityFromProfile); null = keine Lernzone
 * }} input
 */
export function planSession({ library, snapshot, reviews = null, events = [], memories = null, minutes, dimensionNeeds = [], ability = null,
  calibration = null, listeningNeeds = [], listening = null }) {
  const length = Number.isInteger(minutes) ? SESSION_LENGTHS[minutes] : undefined;
  if (!length) throw new RangeError(`Sessionlänge ${minutes}: erlaubt sind ${Object.keys(SESSION_LENGTHS).join(", ")} Minuten`);
  if (snapshot?.format !== "competence_snapshot" || snapshot.version !== 1) {
    throw new TypeError("snapshot: CompetenceSnapshot v1 erwartet");
  }
  if (!Array.isArray(events)) throw new TypeError("events: Liste erwartet");
  const asOf = new Date(snapshot.generated_at);
  const reviewSnapshot = reviews ?? buildReviewSnapshot({
    events, userId: snapshot.user_id, asOf, skillIds: snapshot.skills.map((s) => s.skill_id),
  });
  if (reviewSnapshot?.format !== "review_snapshot" || reviewSnapshot.generated_at !== snapshot.generated_at) {
    throw new TypeError("reviews: ReviewSnapshot v1 zum Stichtag des CompetenceSnapshot erwartet");
  }
  const reviewOf = new Map(reviewSnapshot.items.map((item) => [item.skill_id, item]));
  if (memories !== null && !Array.isArray(memories)) throw new TypeError("memories: Liste von MemoryRecords erwartet");
  const memoryRecords = memories ?? deriveMemories({ events, userId: snapshot.user_id, asOf, library }).records;
  const profile = buildLearnerProfile({ snapshot, reviews: reviewSnapshot, memories: memoryRecords, library });
  const profileOf = new Map(profile.skills.map((s) => [s.skill_id, s]));
  const budget = minutes * 60;
  const usable = Math.floor(budget * (1 - PLANNER_RULES.safetyMargin));
  const history = practiceHistory(events, snapshot.user_id, snapshot.generated_at, library);

  // 1. Priorität je Skill (Learning Brain)
  const candidates = [];
  const coldStart = []; // P14B: neue Skills unterhalb der Lernzone: nicht beherrscht, nur unbekannt → Erkundung
  const contentGaps = [];
  const outsideZone = [];
  for (const skill of snapshot.skills) {
    const meta = skillMeta(library, skill.skill_id);
    const review = reviewOf.get(skill.skill_id) ?? null;
    const scored = learningNeedFor({ skill, meta, review, profileSkill: profileOf.get(skill.skill_id), now: asOf });
    if (!scored) continue;
    // Lernzone: neue Skills nur einführen, wenn sie zum Können passen (zu leicht: vermutlich beherrscht) und
    // mindestens eine ihrer Übungen machbar ist (nicht alle "too_difficult")
    const zone = scored.purpose === "new" ? skillZone(meta.level, ability) : null;
    const doable = !zone || library.exercisesForSkill(skill.skill_id)
      .some((e) => exerciseZone(e, ability)?.zone !== "too_difficult");
    if (zone && (zone.zone === "too_easy" || zone.zone === "too_difficult" || !doable)) {
      outsideZone.push({ skill_id: skill.skill_id, level: meta.level, zone: doable ? zone.zone : "too_difficult" });
      const exercises = beginnerExercises(library.exercisesForSkill(skill.skill_id), { ability, purpose: scored.purpose });
      if (doable && zone.zone === "too_easy" && exercises.length) {
        coldStart.push({ skill, meta, review, ...scored, learning_need: scored, priority: scored.score, exercises, ladder: null });
      }
      continue;
    }
    // P15: Höraufgaben gehören zu den Hörbedarfen, nicht zu den schriftlichen Skill-Bedarfen
    const written = library.exercisesForSkill(skill.skill_id).filter((e) => !isListening(e));
    // P25.5: Anfänger nur in Reichweite (höchstens eine Stufe darüber), Neues zuerst über Wiedererkennen
    const exercises = beginnerExercises(written, { ability, purpose: scored.purpose });
    if (written.length && !exercises.length) {
      outsideZone.push({ skill_id: skill.skill_id, level: meta.level, zone: "beyond_beginner_reach" });
      continue;
    }
    if (exercises.length) {
      // neuer Skill genau in der Lernzone: vor gleich dringenden, die nur "herausfordernd" sind
      const zoneBonus = zone?.zone === "learning_zone" ? PLANNER_RULES.zoneNewBonus : 0;
      const reasons = zoneBonus ? [...scored.reasons, `+${zoneBonus} neuer Skill in der Lernzone (${meta.level})`] : scored.reasons;
      candidates.push({ skill, meta, review, ...scored, reasons, learning_need: scored, priority: scored.score + zoneBonus, exercises,
        ladder: skillLadder(skill) });
    } else if (scored.score >= PLANNER_RULES.contentGapMinPriority) {
      contentGaps.push({
        skill_id: skill.skill_id,
        need: scored.need,
        priority: scored.score,
        reason: skill.type === SKILL_TYPES.COMMON_ERROR
          ? "keine Übung vorhanden, die diesen Fehler provoziert"
          : "keine Übung vorhanden, die diesen Skill trainiert",
      });
    }
  }
  // P15: Hörbedarfe als eigene Kandidaten (nur Höraufgaben des Skills; ohne Aufgabe kein Kandidat)
  const skillOf = new Map(snapshot.skills.map((s) => [s.skill_id, s]));
  for (const need of listeningNeeds) {
    const skill = skillOf.get(need.skill_id);
    const exercises = beginnerExercises(library.exercisesForSkill(need.skill_id).filter(isListening), { ability, purpose: need.purpose });
    if (!skill || !exercises.length) continue;
    candidates.push({ skill, meta: skillMeta(library, need.skill_id), review: null, ...need, learning_need: need,
      priority: need.score, exercises, ladder: null });
  }
  candidates.sort((a, b) => b.priority - a.priority || (a.skill.skill_id < b.skill.skill_id ? -1 : 1)
    || (a.channel === "listening") - (b.channel === "listening"));
  const urgent = new Set(candidates.filter((c) => c.priority >= PLANNER_RULES.coverageMinPriority).map((c) => c.skill.skill_id));

  // 2. Mischung (alte Regel für Neues) und Zusammensetzung (P12)
  const mix = mixFor(candidates, length, minutes);
  const weakDimensions = new Set(dimensionNeeds.filter((n) => n.need !== "measure").map((n) => n.dimension));
  const unmeasured = new Set(DIMENSIONS_WITH_CONTENT(library).filter((d) => !Number.isFinite(ability?.by_dimension?.[d])));
  for (const candidate of candidates) {
    candidate.dimensions = new Set(candidate.exercises.flatMap((e) => [...exerciseDimensions(e)]));
    candidate.category = categoryOf(candidate, { weakDimensions, unmeasured });
  }
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, candidates.filter((x) => x.category === c).length]));
  const weaknessDeltas = dimensionNeeds.filter((n) => Number.isFinite(n.delta)).map((n) => n.delta);
  const composition = compositionFor({
    counts: categoryCounts,
    acuteErrors: candidates.filter((c) => c.purpose === "error_focus" && c.priority >= PLANNER_RULES.acuteMinScore).length,
    // nur echte Wiederholungen: ein nie abgerufener Skill (Phase "new") ist formal "due", aber keine Wiederholung
    due: candidates.filter((c) => c.review && c.review.phase !== "new" && ["due", "overdue"].includes(c.review.due_status)).length,
    strongestWeakness: weaknessDeltas.length ? Math.min(...weaknessDeltas) : null,
    abilityKnown: Boolean(ability) && !ability.provisional,
    unmeasured: unmeasured.size,
    productionGaps: candidates.filter((c) => c.reason_code === "production_gap").length,
    daysWithoutProduction: daysWithoutProduction(snapshot.skills, asOf),
  });
  const caps = focusCaps(composition.shares, length.focus);
  const categoryFocus = new Map();

  // 3. Auswahl
  const state = { chosen: [], used: new Set(), seconds: 0, slots: 0, covered: new Map(), primary: new Map(), stretch: 0, listening: 0 };
  const maxListening = Math.max(1, Math.floor(length.maxExercises * PLANNER_RULES.maxListeningShare));
  const maxStretch = Math.max(1, Math.floor(length.maxExercises / PLANNER_RULES.stretchPerExercises));
  const context = { usable, history, asOf, urgent, weakDimensions, ability, maxStretch, calibration, maxListening, library,
    byAccent: listening?.overall?.by_accent ?? null };
  const focus = [];
  const topicCount = new Map();
  let maintenance = 0;
  let newCount = 0;

  const tryAdd = (candidate, round, roleOverride = null) => {
    if (state.slots >= length.maxExercises) return false;
    const pick = bestExercise(candidate, state, { ...context, round });
    if (!pick || state.slots + slotCost(pick.exercise) > length.maxExercises) return false;
    const { exercise, evidence, factors, zone } = pick;
    const id = candidate.skill.skill_id;
    // Höraufgaben decken keine schriftlichen Skills mit ab; ein Hörbedarf hat einen eigenen Schlüssel (P15)
    const alsoCovers = isListening(exercise) ? [] : linkedSkills(exercise).filter((s) => s !== id && urgent.has(s)).sort();
    const role = roleOverride ?? (round === 1 ? "primary" : isTargetOf(exercise, id) ? "variation" : "transfer");
    const practiceType = practiceTypeOf(zone, candidate);
    if (practiceType === "stretch") state.stretch += 1;
    if (isListening(exercise)) state.listening += 1;
    state.chosen.push({ candidate, exercise, evidence, factors, alsoCovers, role, zone, practiceType });
    state.used.add(exercise.id);
    state.seconds += exercise.estimated_seconds;
    state.slots += slotCost(exercise);
    const key = coverageKey(candidate);
    state.primary.set(key, (state.primary.get(key) ?? 0) + 1);
    for (const skillId of [key, ...alsoCovers]) state.covered.set(skillId, (state.covered.get(skillId) ?? 0) + 1);
    return true;
  };
  const eligible = (candidate, { ignoreNewLimit = false, ignoreCaps = false, exploring = false } = {}) => {
    if (!ignoreCaps && (categoryFocus.get(candidate.category) ?? 0) >= caps[candidate.category]) return false;
    const topic = candidate.meta.topic_id ?? "";
    if ((topicCount.get(topic) ?? 0) >= PLANNER_RULES.maxFocusPerTopic) return false;
    if (candidate.need === "maintenance" && maintenance >= PLANNER_RULES.maxMaintenance && !ignoreNewLimit) return false;
    // Erkundung hat ihr eigenes Budget (ein Platz), nicht das Kontingent für Neues
    if (candidate.purpose === "new" && newCount >= mix.newMax && !ignoreNewLimit && !exploring) return false;
    return !state.covered.has(coverageKey(candidate)); // schon mit abgedeckt → Platz für andere Skills
  };
  const accept = (candidate, options) => {
    if (!eligible(candidate, options) || !tryAdd(candidate, 1)) return;
    focus.push(candidate);
    categoryFocus.set(candidate.category, (categoryFocus.get(candidate.category) ?? 0) + 1);
    const topic = candidate.meta.topic_id ?? "";
    topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
    if (candidate.need === "maintenance") maintenance += 1;
    if (candidate.purpose === "new") newCount += 1;
  };
  // Erkundung (P14B): ein Fokusplatz bleibt reserviert, wenn die Session groß genug ist und der akute Bedarf ihn
  // nicht braucht (akute Kernarbeit wird nie verdrängt). Findet die Erkundung nichts, füllt Pass 3 den Platz.
  const explorationReserve = length.maxExercises >= PLANNER_RULES.explorationMinExercises && mix.acute < length.focus
    && explorationCandidates({ candidates, coldStart, focus: [], asOf }).length > 0 ? PLANNER_RULES.explorationMax : 0;
  const coreFocus = length.focus - explorationReserve;
  // Pass 0 (P21): Liegt ein Bereich des Sprachprofils mindestens eine halbe Stufe unter dem Gesamtniveau, bekommt er
  // seine Plätze zuerst. Die Anteile begrenzen sonst nur; bei wenigen Fokusplätzen verdrängte höhere Priorität den schwachen Bereich
  // (Grammatik B2, Wortschatz B1 → ein einziger Wortschatz-Skill). Danach geht es wie bisher nach Priorität weiter.
  // nur der schwache Bereich des Sprachprofils (P21), nicht die Produktionslücken (P13: eigene, bewährte Regel)
  const weaknessFirst = composition.weak_dimension;
  if (weaknessFirst) {
    // akute Fehlerarbeit wird nie verdrängt (P14B): ihre Plätze bleiben frei
    const acute = Math.min(caps.error, candidates.filter((c) => c.purpose === "error_focus" && c.priority >= PLANNER_RULES.acuteMinScore).length);
    for (const candidate of candidates) {
      if (focus.length >= coreFocus - acute || (categoryFocus.get("weakest") ?? 0) >= caps.weakest) break;
      // P24: wie oben beschrieben nur Kandidaten, die den schwachen Bereich trainieren (vorher jeder "weakest", also auch
      // eine Produktionslücke mit höherer Priorität: ein schwacher Hörbereich bekam so nie eine Höraufgabe)
      // und unabhängig vom Kontingent für Neues (ungeprüftes Hören ist "neu"; bei vielen fälligen Wiederholungen war es 0)
      if (candidate.category === "weakest" && [...candidate.dimensions].some((d) => weakDimensions.has(d))) accept(candidate, { ignoreNewLimit: true });
    }
  }
  // Pass 1: nach Priorität, aber Platz für die Mindestzahl neuer Skills freihalten
  for (const candidate of candidates) {
    const reserved = Math.max(0, mix.newMin - newCount);
    if (focus.length >= coreFocus) break;
    if (candidate.purpose !== "new" && focus.length >= coreFocus - reserved) continue;
    accept(candidate);
  }
  // Pass 2: freie Plätze mit Nicht-Neuem auffüllen (jetzt ohne Anteilsgrenzen: keine halb leere Session)
  for (const candidate of candidates) {
    if (focus.length >= coreFocus) break;
    if (!focus.includes(candidate) && candidate.purpose !== "new") accept(candidate, { ignoreCaps: true });
  }
  // Weitere Übungen für die Fokus-Skills (Variation, Transfer), nach Zweck begrenzt
  // Ein einzelner Fehler wird einmal geprüft (ist es ein Muster?), nicht variiert (P13: Platz für Produktion)
  const cap = (candidate) => (candidate.reason_code === "single_error_check" || candidate.channel === "listening" ? 1
    : EXERCISES_PER_PURPOSE[candidate.purpose][minutes >= LONG_SESSION_MINUTES ? "long" : "short"]);
  const deepen = () => {
    for (let round = 2; round <= 3; round += 1) {
      for (const candidate of focus) {
        const count = state.primary.get(coverageKey(candidate)) ?? 0;
        if (count < round && round <= cap(candidate)) tryAdd(candidate, round);
      }
    }
  };
  deepen();
  // Erkundung (P14B): gezielt, höchstens explorationMax Übung, im reservierten (oder sonst freien) Fokusplatz
  const exploration = [];
  if (length.maxExercises >= PLANNER_RULES.explorationMinExercises) {
    for (const { candidate, kind, reason } of explorationCandidates({ candidates, coldStart, focus, asOf })) {
      if (exploration.length >= PLANNER_RULES.explorationMax || state.slots >= length.maxExercises || focus.length >= length.focus) break;
      if (!eligible(candidate, { ignoreCaps: true, exploring: true })) continue; // sonst gleiche Regeln (Kontrollen, Themen)
      const before = { category: candidate.category, exploration: candidate.exploration };
      Object.assign(candidate, { category: "measurement", exploration: { kind, reason } });
      if (!tryAdd(candidate, 1, "exploration")) {
        Object.assign(candidate, before);
        continue;
      }
      focus.push(candidate);
      if (candidate.need === "maintenance") maintenance += 1;
      if (candidate.purpose === "new") newCount += 1;
      exploration.push({ skill_id: candidate.skill.skill_id, kind, reason });
    }
  }
  // Pass 3: Steht sonst nichts an, füllen neue Skills (und weitere fällige Kontrollen) die restliche Zeit
  for (const candidate of candidates) {
    if (focus.length >= length.focus) break;
    if (!focus.includes(candidate)) accept(candidate, { ignoreNewLimit: true, ignoreCaps: true });
  }
  deepen();
  // Pass 4 (P12): Kurze Übungen lassen Zeit übrig. Bleibt genug Zeit frei (spareMinSeconds und spareMinShare),
  // darf der nächste (nicht neue) Bedarf in den Fokus, wenn eine seiner Übungen noch passt: freie Zeit nicht
  // verschenken, statt eine halb leere Session zu planen. Höchstens ein zusätzlicher Fokus-Skill.
  const spare = usable - state.seconds;
  if (spare >= PLANNER_RULES.spareMinSeconds && spare >= usable * PLANNER_RULES.spareMinShare) {
    for (const candidate of candidates) {
      if (focus.length >= length.focus + 1) break;
      if (!focus.includes(candidate) && candidate.purpose !== "new") accept(candidate, { ignoreCaps: true });
    }
    deepen();
  }

  // 5. Reihenfolge
  // P21: Pass 0 wählt den schwachen Bereich zuerst; Fokus und Ziel folgen trotzdem der Priorität (dringendster Skill zuerst)
  if (weaknessFirst) focus.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  const ordered = orderWithoutRepetition(state.chosen);
  const focusSkills = focus.map((c) => ({
    skill_id: c.skill.skill_id,
    channel: c.channel ?? "written", // P15: Hören ist eigene Evidenz desselben Skills
    label: c.meta.label,
    type: c.skill.type,
    level: c.meta.level,
    topic_id: c.meta.topic_id,
    error_kind: c.meta.error_kind,
    mastery: c.skill.mastery,
    path_stage: c.skill.path.stage,
    need: c.need,
    purpose: c.purpose,
    priority: c.priority,
    target_evidence: c.target_evidence,
    reason: c.reason,
    reasons: c.reasons,
    factors: c.factors,
    priority_factors: c.priority_factors,
    review: reviewSummary(c.review),
    learning_need: needSummary(c.learning_need),
  }));

  return {
    format: SESSION_PLAN_FORMAT,
    version: SESSION_PLAN_VERSION,
    generated_at: snapshot.generated_at,
    user_id: snapshot.user_id,
    minutes,
    objective: objectiveFor(focusSkills, snapshot, library),
    focus_skills: focusSkills,
    exercises: ordered.map((entry, position) => ({
      position: position + 1,
      exercise_id: entry.exercise.id,
      type: entry.exercise.type,
      mode: entry.exercise.mode,
      level: entry.exercise.level,
      stage: entry.exercise.stage,
      evidence: entry.evidence,
      estimated_seconds: entry.exercise.estimated_seconds,
      skill_id: entry.candidate.skill.skill_id,
      purpose: entry.candidate.purpose,
      role: entry.role,
      priority: entry.candidate.priority,
      also_covers: entry.alsoCovers,
      reason: exerciseReason(entry),
      reasons: [...entry.candidate.reasons, roleReason(entry)].filter(Boolean),
      score_factors: entry.factors,
      difficulty: exerciseDifficulty(entry.exercise),
      sublevel: entry.exercise.sublevel ?? null,
      zone: entry.zone?.zone ?? null,
      zone_class: entry.zone?.zone_class ?? "evidence_gap",
      practice_type: entry.practiceType,
      why: whyOf(entry, calibration),
      composition: entry.candidate.category,
      review: reviewSummary(entry.candidate.review),
    })),
    metadata: {
      content_version: library.contentVersion ?? null,
      snapshot: { version: snapshot.version, generated_at: snapshot.generated_at, event_count: snapshot.metadata.event_count },
      reviews: { version: reviewSnapshot.version, due: reviewSnapshot.summary.by_due_status.due,
        overdue: reviewSnapshot.summary.by_due_status.overdue },
      budget_seconds: budget,
      usable_seconds: usable,
      planned_seconds: state.seconds,
      mix: { ...mix, by_purpose: countBy(state.chosen.map((c) => c.candidate.purpose)) },
      composition: {
        target_shares: composition.shares,
        adjustments: composition.adjustments,
        first_pass_caps: caps,
        focus_by_category: countBy(focus.map((c) => c.category)),
        exercises_by_category: countBy(state.chosen.map((c) => c.candidate.category)),
      },
      skills_with_need: candidates.length + contentGaps.length + outsideZone.length,
      learning_zone: {
        ability,
        rules: ZONE_RULES,
        factors: ZONE_FACTORS,
        class_factors: ZONE_CLASS_FACTORS,
        max_stretch: maxStretch,
        by_class: countBy(state.chosen.map((c) => c.zone?.zone_class ?? "evidence_gap")),
        by_practice_type: countBy(state.chosen.map((c) => c.practiceType)),
        cold_start_available: coldStart.length,
        new_skills_outside_zone: {
          too_easy: outsideZone.filter((s) => s.zone === "too_easy").length,
          too_difficult: outsideZone.filter((s) => s.zone === "too_difficult").length,
          examples: outsideZone.slice(0, 10),
        },
      },
      exploration: { max: PLANNER_RULES.explorationMax, chosen: exploration },
      calibration: calibration ? {
        scope: calibration.scope, language_id: calibration.language_id, learners: calibration.learners,
        by_status: calibration.summary.by_status,
      } : null,
      content_gaps: contentGaps.sort((a, b) => b.priority - a.priority || (a.skill_id < b.skill_id ? -1 : 1)),
      derivation: "competence_snapshot + review_snapshot + memories → learner_profile → learning_needs",
      brain: {
        learner_profile_version: LEARNER_PROFILE_VERSION,
        learning_need_version: LEARNING_NEED_VERSION,
        memories: memoryRecords.length,
        learning_needs: candidates.length,
        top_needs: candidates.slice(0, 10).map((c) => needSummary(c.learning_need)),
      },
      persisted: false,
      rules: { lengths: SESSION_LENGTHS, planner: PLANNER_RULES },
    },
  };
}

/**
 * Was der Lerner vom Plan sieht: Übungen und Dauer, bei Trainingsübungen der Schwerpunkt, bei
 * Challenges NICHTS über das interne Lernziel (keine Skill-ID, kein Skill-Name, keine Gründe).
 */
export function learnerView(plan) {
  const labels = new Map(plan.focus_skills.map((f) => [f.skill_id, f.label]));
  return {
    minutes: plan.minutes,
    title: learnerTitle(plan),
    estimated_seconds: plan.exercises.reduce((sum, e) => sum + e.estimated_seconds, 0),
    exercises: plan.exercises.map((e) => learnerItem(e, labels.get(e.skill_id))),
  };
}

/**
 * Titel der Session aus Lernersicht: Enthält sie Challenges (oder ein Themenziel, das eine Challenge
 * verraten könnte), heißt sie neutral "Training".
 * @param {{objective: {id: string, title_de?: string}, exercises: {mode: string}[]}} plan
 */
export function learnerTitle(plan) {
  return plan.objective.id === "topic_focus" || plan.exercises.some((e) => e.mode === "challenge")
    ? "Training"
    : plan.objective.title_de ?? OBJECTIVES[plan.objective.id] ?? "Training";
}

/**
 * Eine Übung aus Lernersicht (auch für Übungen, die erst während der Session hinzukommen):
 * Training nennt seinen Schwerpunkt, eine Challenge nie.
 * @param {{position?: number, exercise_id: string, type: string, mode: string, estimated_seconds: number}} entry
 * @param {string|null|undefined} focusLabel  Name des geplanten Skills
 */
export function learnerItem(entry, focusLabel) {
  return {
    position: entry.position ?? null,
    exercise_id: entry.exercise_id,
    type: entry.type,
    mode: entry.mode,
    estimated_seconds: entry.estimated_seconds,
    focus: entry.mode === "training" ? focusLabel ?? null : null,
  };
}

// ---------------------------------------------------------------- Mischung

/**
 *   akut        Kandidaten mit Priorität ≥ acuteMinScore aus Fehlern oder fälliger Wiederholung
 *   newMax      nur neue Skills (Standortbestimmung): alle Plätze; akuter Bedarf ≥ Fokusplätze oder
 *               akuter Bedarf in einer kurzen Session (≤ 2 Fokusplätze): 0; etwas akuter Bedarf: 1;
 *               sonst 1 (bis 15 Minuten) bzw. 2 (ab 20 Minuten). Gilt nur, solange Nicht-Neues ansteht.
 *   newMin      ohne akuten Bedarf mindestens 1 neuer Skill (wenn es einen gibt und ≥ 2 Fokusplätze)
 */
function mixFor(candidates, length, minutes) {
  const acute = candidates.filter((c) => c.priority >= PLANNER_RULES.acuteMinScore
    && (c.purpose === "error_focus" || c.purpose === "review")).length;
  const hasNew = candidates.some((c) => c.purpose === "new");
  const onlyNew = candidates.length > 0 && candidates.every((c) => c.purpose === "new");
  let newMax;
  if (onlyNew) newMax = length.focus;
  else if (acute >= length.focus || (acute > 0 && length.focus <= 2)) newMax = 0;
  else if (acute > 0) newMax = 1;
  else newMax = minutes >= 20 ? 2 : 1;
  const newMin = !onlyNew && acute === 0 && hasNew && length.focus >= 2 ? 1 : 0;
  return { acute, newMax, newMin: Math.min(newMin, newMax) };
}

// ---------------------------------------------------------------- Übungswahl

function bestExercise(candidate, state, context) {
  const remaining = context.usable - state.seconds;
  // Lernzone: Übungen deutlich über dem Belegten (below_zone) nur, wenn der Skill keine andere hat (und nie als
  // Folgeübung); Stretch höchstens maxStretch je Session (schwere Aufgaben dominieren nie)
  const zoneOfExercise = (e) => taskZone(e, { ladder: candidate.ladder, ability: context.ability, purpose: candidate.purpose,
    item: context.calibration?.items?.[e.id] ?? null, audio: audioOf(e, context) });
  const tooDifficult = (e) => zoneOfExercise(e).zone_class === "below_zone";
  const allTooDifficult = candidate.exercises.every(tooDifficult);
  let best = null;
  for (const exercise of candidate.exercises) {
    if (state.used.has(exercise.id) || !(exercise.estimated_seconds <= remaining)) continue;
    if (tooDifficult(exercise) && (context.round > 1 || !allTooDifficult)) continue;
    if (isListening(exercise) && state.listening >= (context.maxListening ?? Infinity)) continue; // Hören dominiert nie
    const stretchFull = state.stretch >= (context.maxStretch ?? Infinity);
    if (stretchFull && practiceTypeOf(zoneOfExercise(exercise), candidate) === "stretch") continue;
    // Folgeübungen (Variation, Transfer) nie mit einer Aufgabe, die in den letzten 48 h gemacht wurde:
    // das wäre dieselbe Übung noch einmal, keine Variation (Real-User-Validation P10A)
    if (context.round > 1 && isRecent(context.history.lastAttempt.get(exercise.id), context.asOf)) continue;
    const scored = scoreExercise(exercise, candidate, state, context);
    if (context.round > 1 && (scored.distance < -PLANNER_RULES.followUpMaxDistance || scored.distance > PLANNER_RULES.followUpMaxAscent)) continue;
    if (!best || scored.score > best.score || (scored.score === best.score && tieBreak(exercise, best.exercise) < 0)) {
      best = { exercise, ...scored };
    }
  }
  return best;
}

/** Punkte für eine Übung als Antwort auf einen Bedarf. Jeder Baustein wird mitgeliefert. */
export function scoreExercise(exercise, candidate, state, { history, asOf, urgent, round = 1, weakDimensions = new Set(), ability = null,
  calibration = null, library = null, byAccent = null }) {
  const evidence = evidenceForExercise(exercise);
  const distance = LADDER.indexOf(evidence) - LADDER.indexOf(candidate.target_evidence);
  const skillId = candidate.skill.skill_id;
  const factors = [];
  let score = 100;
  const add = (value, label) => {
    if (!value) return;
    score += value;
    factors.push(`${value > 0 ? "+" : ""}${value} ${label}`);
  };
  add(-20 * Math.abs(distance), `Nachweisstufe '${evidence}' statt '${candidate.target_evidence}'`);
  if (distance < 0) add(-10, "leichter als nötig");
  if (PRODUCTION.has(evidence)) add(4, "aktive Produktion");
  // P13: Bei einer Produktionslücke ist die sichere Stufe kein Übungsziel mehr (kein Drill, wo es schon sitzt)
  const gap = candidate.production?.gap;
  if (gap && LADDER.indexOf(evidence) <= LADDER.indexOf(gap.from)) add(-PLANNER_RULES.gapSecureLevel, `Produktionslücke: '${evidence}' sitzt schon`);
  if (isTargetOf(exercise, skillId)) add(5, "Skill ist Lernziel der Übung");
  // P15: Hörbedarf → die schwache Messgröße und bei einer Tempo-/Akzent-Lücke genau dieser Kontext (eine Größe ändern)
  const context = { library };
  if (candidate.channel === "listening" && exercise.listening) {
    if (candidate.target_measure && exercise.listening.measure === candidate.target_measure) {
      add(PLANNER_RULES.listeningMeasureBonus, `Hören: misst ${candidate.target_measure_label}`);
    }
    const audio = context.library?.audio?.(exercise.listening.audio);
    if (candidate.target_rate && audio?.speech_rate?.band === candidate.target_rate) {
      add(PLANNER_RULES.listeningMeasureBonus, `Hören: Tempo '${candidate.target_rate}' (nur das Tempo ändert sich)`);
    }
    if (candidate.target_accent && audio?.accent === candidate.target_accent) {
      add(PLANNER_RULES.listeningMeasureBonus, `Hören: Akzent '${candidate.target_accent}' (nur der Akzent ändert sich)`);
    }
    // P16: dieselbe Regel für Kontextlänge, Sprecherzahl, Störgeräusche und Kontext statt Satz
    const features = audioFeatures(exercise, audio);
    const targets = [["target_context_length", "context_length", "Kontextlänge"], ["target_speakers", "speakers", "Sprecher"],
      ["target_noise", "noise", "Störgeräusche"], ["target_scope", "scope", "Kontext"]];
    for (const [key, feature, label] of targets) {
      if (candidate[key] && features?.[feature] === candidate[key]) {
        add(PLANNER_RULES.listeningMeasureBonus, `Hören: ${label} '${candidate[key]}' (nur diese Größe ändert sich)`);
      }
    }
  }
  const extra = linkedSkills(exercise).filter((s) => s !== skillId && urgent.has(s) && !state.covered.has(s));
  add(8 * Math.min(2, extra.length), `deckt ${extra.length} weitere dringende Skill(s) ab`);
  if (exercise.level === "C1" || exercise.level === "C2") add(5, `Niveau ${exercise.level}`);
  // Sprachprofil (P11B): Übungen, die einen schwachen Kompetenzbereich trainieren, bekommen einen Zuschlag
  const weakTrained = [...exerciseDimensions(exercise)].filter((d) => weakDimensions.has(d));
  if (weakTrained.length) add(6, `Profil: ${weakTrained.join(", ")} ist gerade schwächer`);
  // Lernzone (P12, P14A): zuerst das Belegte zum Skill, dann der Bereich; eine Reparatur darf leichter sein
  const item = calibration?.items?.[exercise.id] ?? null;
  const zone = taskZone(exercise, { ladder: candidate.ladder ?? null, ability, purpose: candidate.purpose, item,
    audio: audioOf(exercise, { library, byAccent }) });
  add(zone.factor, `Lernzone: ${zone.zone_class} (${zone.basis}: ${zone.reason})`);
  // Kalibrierung (P14B): auffällige Aufgaben meiden, wenn es Alternativen gibt (Diagnose, kein Löschen)
  if (item && ["too_hard", "too_easy", "unstable", "possible_mismatch"].includes(item.quality)) {
    add(-PLANNER_RULES.qualityPenalty, `Kalibrierung: Aufgabe auffällig (${item.quality})`);
  }
  if (state.chosen.some((c) => c.exercise.type === exercise.type)) add(-15, `Typ '${exercise.type}' schon in der Session`);
  const last = history.lastAttempt.get(exercise.id);
  if (last !== undefined) {
    const hours = (asOf.getTime() - Date.parse(last)) / HOUR_MS;
    if (hours < PLANNER_RULES.recentHours) add(-40, "in den letzten 48 h gemacht");
    else if (hours < PLANNER_RULES.weekHours) add(-15, "in den letzten 7 Tagen gemacht");
  }
  if (round > 1) {
    // Folgeübung zum selben Skill: Stufe für Stufe hinauf (Transfer), nicht zurück (kein Drill)
    const before = state.chosen.filter((c) => c.candidate.skill.skill_id === skillId).map((c) => LADDER.indexOf(c.evidence));
    const highest = Math.max(-1, ...before);
    const rank = LADDER.indexOf(evidence);
    if (rank > highest) add(PLANNER_RULES.ladderStep, "Steigerung: nächste Stufe");
    else if (rank < highest) add(-PLANNER_RULES.ladderStep, "leichter als die vorige Übung");
  }
  const previous = history.lastForSkill.get(skillId);
  if (previous?.exercise_id === exercise.id) add(-10, "zuletzt mit genau dieser Übung geübt");
  else if (previous?.type === exercise.type) add(-5, "gleiche Übungsform wie beim letzten Mal");
  return { score, evidence, distance, factors, zone };
}

/** core: Lernen oder Abruf; stretch: bewusst gestreckt; diagnostic: Evidenzlücke oder Messen (P14A). */
function practiceTypeOf(zone, candidate) {
  if (candidate.exploration) return "diagnostic";
  if (zone?.zone_class === "stretch" || zone?.zone_class === "below_zone") return "stretch";
  if (!zone || zone.zone_class === "evidence_gap" || candidate.category === "measurement") return "diagnostic";
  return "core";
}

/** Warum genau diese Übung jetzt? Strukturiert, für Entwicklersicht und Tests (nicht für den Lerner). */
function whyOf(entry, calibration = null) {
  const c = entry.candidate;
  const need = c.learning_need ?? {};
  const item = calibration?.items?.[entry.exercise.id] ?? null;
  return {
    target_skill: c.skill.skill_id,
    competence: { mastery: c.skill.mastery, secure_evidence: c.ladder?.secure ?? null, attempts: c.skill.successes + c.skill.failures },
    confidence: entry.zone?.basis?.startsWith("skill") ? "skill_evidence" : entry.zone?.basis === "dimension" ? "language_profile" : "none",
    difficulty: entry.zone?.difficulty ?? null,
    zone: entry.zone?.zone_class ?? "evidence_gap",
    zone_basis: entry.zone?.basis ?? "none",
    practice_type: entry.practiceType,
    reason_code: need.reason_code ?? null,
    production: need.production ? { missing_evidence: need.production.missing_evidence, gap: need.production.gap } : null,
    memory_urgency: need.repetition_urgency ?? 0,
    error_pressure: need.error_pressure ?? 0,
    // P14B: empirische Schwierigkeit (Sprache × Inhalt × Aufgabe), grob benannt; Rohwerte bleiben intern
    calibration: item ? {
      status: item.calibration_status,
      confidence: item.confidence,
      weighted_observations: item.weighted_observations,
      learners: item.unique_learners,
      quality: item.quality,
      difficulty_source: entry.zone?.difficulty_source ?? "prior",
      label: difficultyLabel(item.effective, entry.zone?.theta ?? null),
      note: item.calibration_status === "calibrated" ? "empirisch kalibriert"
        : "Schwierigkeit dieser Aufgabe noch nicht ausreichend kalibriert: Handwert",
    } : null,
    diagnosis: diagnoseDifficulty({ item, exercise: entry.exercise, skill: c.skill }),
    exploration: c.exploration ?? null,
    // P15: Hören (Zustand, Grund, Messgröße, Merkmale der Aufnahme)
    listening: c.channel === "listening" ? {
      state: c.listening_state, reason_code: c.reason_code, target_measure: c.target_measure,
      measure: entry.exercise.listening?.measure ?? null, audio: entry.exercise.listening?.audio ?? null,
    } : null,
  };
}

/**
 * Erkundung (P14B): Was wissen wir über diesen Lerner noch nicht? Gezielt, deterministisch, in dieser Reihenfolge:
 *   long_unchecked      geübt (mindestens "practicing"), seit explorationStaleDays nicht gesehen
 *   missing_production  es fehlt freie oder spontane Evidenz, und auf dieser Stufe wurde nie geantwortet
 *   missing_listening   (P15) schriftlich sicher, beim Hören nie ohne Hilfe geprüft
 *   unknown_skill       noch nie beobachtet, zuerst unterhalb der Lernzone (unbekannt ≠ beherrscht), Kaltstart
 * Nur Bedarfe, die noch nicht im Fokus sind; innerhalb einer Art nach Priorität, dann ID.
 */
function explorationCandidates({ candidates, coldStart, focus, asOf }) {
  const chosen = new Set(focus.map(coverageKey));
  const open = candidates.filter((c) => !chosen.has(coverageKey(c)));
  const ladder = ["recognized", "controlled", "guided", "free", "spontaneous"];
  const days = (at) => (at ? (asOf.getTime() - Date.parse(at)) / 86_400_000 : 0);
  const tag = (candidate, kind, reason) => ({ candidate, kind, reason });
  const byPriority = (a, b) => b.priority - a.priority || (a.skill.skill_id < b.skill.skill_id ? -1 : 1);
  const stale = open.filter((c) => ["practicing", "stable", "mastered"].includes(c.skill.mastery)
    && days(c.skill.last_seen_at) >= PLANNER_RULES.explorationStaleDays).sort(byPriority)
    .map((c) => tag(c, "long_unchecked", `seit ${Math.floor(days(c.skill.last_seen_at))} Tagen nicht geprüft`));
  // P15: Hören nie ohne Hilfe geprüft, schriftlich aber sicher → fehlende Hörevidenz (kontrolliert einführen)
  const listening = open.filter((c) => c.channel === "listening" && c.reason_code === "listening_evidence_gap").sort(byPriority)
    .map((c) => tag(c, "missing_listening", "schriftlich sicher, beim Hören noch nicht geprüft"));
  const missing = open.filter((c) => {
    const m = c.production?.missing_evidence;
    return ["free", "spontaneous"].includes(m) && ladder.indexOf(c.ladder?.attempted ?? null) < ladder.indexOf(m);
  }).sort(byPriority).map((c) => tag(c, "missing_production", `noch keine Antwort auf Stufe '${c.production.missing_evidence}'`));
  // zuerst die Kaltstart-Skills unterhalb der Lernzone: Sie haben sonst keinen Weg in den Plan (Neues in der Zone kommt
  // ohnehin über die normalen Durchgänge)
  const unknown = [...[...coldStart].sort(byPriority), ...open.filter((c) => c.purpose === "new").sort(byPriority)]
    .map((c) => tag(c, "unknown_skill", "noch nie beobachtet: kontrolliert einführen (Kaltstart)"));
  const seen = new Set();
  return [...stale, ...missing, ...listening, ...unknown].filter((e) => !seen.has(coverageKey(e.candidate)) && seen.add(coverageKey(e.candidate)));
}

/** Schlüssel für "schon abgedeckt": Hören ist eigene Evidenz desselben Skills (P15). */
function coverageKey(candidate) {
  return candidate.channel === "listening" ? `listening:${candidate.skill.skill_id}` : candidate.skill.skill_id;
}

function isRecent(lastAttempt, asOf) {
  return lastAttempt !== undefined && (asOf.getTime() - Date.parse(lastAttempt)) / HOUR_MS < PLANNER_RULES.recentHours;
}

function tieBreak(a, b) {
  if (a.estimated_seconds !== b.estimated_seconds) return a.estimated_seconds - b.estimated_seconds;
  return a.id < b.id ? -1 : 1;
}

/** Alle Skills, die eine Übung trainiert oder beobachtet (wie indexes.exercises_by_skill). */
function linkedSkills(exercise) {
  return [
    ...(exercise.structures ?? []).map((s) => `grammar_structure:${s.rule_id}`),
    ...(exercise.target_items ?? []).map((item) => `lexical_item:${item}`),
    ...(exercise.common_errors ?? []).map((error) => `common_error:${error}`),
  ];
}

/** Trainiert (bzw. provoziert) diese Übung den Skill gezielt? */
export function isTargetOf(exercise, skillId) {
  const { type, refId } = parseSkillId(skillId);
  if (type === SKILL_TYPES.GRAMMAR_STRUCTURE) return (exercise.structures ?? []).some((s) => s.rule_id === refId && s.is_target);
  if (type === SKILL_TYPES.LEXICAL_ITEM) return (exercise.target_items ?? []).includes(refId);
  return (exercise.common_errors ?? []).includes(refId); // die Übung ist darauf angelegt, den Fehler zu provozieren
}

// ---------------------------------------------------------------- Reihenfolge

/**
 * Von kontrolliert zu spontan (aufwärmen, dann frei); dabei nie derselbe Skill oder dieselbe
 * Übungsform direkt hintereinander, wenn eine andere Übung möglich ist. Gleichstand: Auswahlreihenfolge.
 */
function orderWithoutRepetition(chosen) {
  const pending = chosen
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => LADDER.indexOf(a.evidence) - LADDER.indexOf(b.evidence) || a.index - b.index);
  const ordered = [];
  while (pending.length) {
    const previous = ordered.at(-1);
    // Höraufgaben gelten als eine Form (P15): nie zwei Höraufgaben direkt nacheinander, wenn es sich vermeiden lässt
    const form = (e) => (isListening(e.exercise) ? "listening" : e.exercise.type);
    const differs = (e, checkType) => !previous
      || (e.candidate.skill.skill_id !== previous.candidate.skill.skill_id && (!checkType || form(e) !== form(previous)));
    // Vorausschau: Nur wählen, wenn der Rest danach noch ohne direkte Wiederholung anzuordnen ist
    const ok = (e, i) => arrangeable(pending.filter((_, j) => j !== i), e.candidate.skill.skill_id);
    const indices = [
      pending.findIndex((e, i) => differs(e, true) && ok(e, i)),
      pending.findIndex((e, i) => differs(e, false) && ok(e, i)),
      pending.findIndex((e) => differs(e, false)),
    ];
    ordered.push(pending.splice(Math.max(0, indices.find((i) => i >= 0) ?? 0), 1)[0]);
  }
  return ordered;
}

/** Lassen sich `rest` so anordnen, dass kein Skill doppelt folgt und der erste nicht `previousSkill` ist? */
function arrangeable(rest, previousSkill) {
  const counts = new Map();
  for (const e of rest) counts.set(e.candidate.skill.skill_id, (counts.get(e.candidate.skill.skill_id) ?? 0) + 1);
  for (const [skill, count] of counts) {
    const others = rest.length - count;
    if (count > (skill === previousSkill ? others : others + 1)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Texte und Ziel

function exerciseReason({ candidate, exercise, evidence, alsoCovers }) {
  const skill = candidate.skill.skill_id;
  const verb = candidate.skill.type === SKILL_TYPES.COMMON_ERROR ? "provoziert" : "trainiert";
  let text = `${verb} ${skill} auf Stufe '${evidence}' (${candidate.reason})`;
  if (evidence !== candidate.target_evidence) text += `; Ziel wäre '${candidate.target_evidence}', keine passendere Übung verfügbar`;
  if (alsoCovers.length) text += `; beobachtet außerdem ${alsoCovers.join(", ")}`;
  if (exercise.mode === "challenge") text += "; Challenge: das Lernziel bleibt für den Lerner verdeckt";
  return text;
}

function roleReason(entry) {
  if (entry.role === "variation") return "zweite Übung zum selben Skill in anderer Form";
  if (entry.role === "transfer") return "Transfer: der Skill ist hier nicht Lernziel der Übung";
  return null;
}

/** Kurzfassung eines LearningNeed für Plan und Debug (Warum? Mit welcher Evidenz?). */
function needSummary(need) {
  return {
    skill_id: need.skill_id,
    competence: need.competence ?? null,
    reason_code: need.reason_code,
    priority: need.priority,
    error_state: need.error_state,
    error_pressure: need.error_pressure,
    repetition_urgency: need.repetition_urgency,
    recommended_exercise: need.recommended_exercise,
    target_difficulty: need.target_difficulty,
    evidence: need.evidence,
  };
}

function reviewSummary(review) {
  if (!review) return null;
  return {
    phase: review.phase,
    due_status: review.due_status,
    due_at: review.due_at,
    retrievability: review.retrievability,
    stability_days: review.stability,
    lapses: review.lapses,
  };
}

/** Ziel der Session aus dem dringendsten Fokus-Skill; sprachneutral (Themenname aus dem Inhalt). */
function objectiveFor(focus, snapshot, library) {
  const make = (id, reason, title = OBJECTIVES[id]) => ({ id, title_de: title, reason });
  if (!focus.length) return make("nothing_to_plan", "kein Skill mit Trainingsbedarf und passender Übung");
  if (snapshot.summary.unknown_skills === snapshot.summary.total_skills) {
    return make("diagnostic", "noch keine Nachweise: verschiedene Skills verdeckt beobachten");
  }
  const top = focus[0];
  const because = `dringendster Skill ${top.skill_id}: ${top.reasons.join("; ")}`;
  if (top.need === "active_error" || top.need === "declining_error") {
    return make(isGermanism({ error_kind: top.error_kind, topic_id: top.topic_id }) ? "interference_reduction" : "error_reduction", because);
  }
  if (top.purpose === "review") return make("review", because);
  if (top.need === "production_gap" || top.need === "production_weak") {
    return make(top.target_evidence === "spontaneous" ? "spontaneous_production" : "free_production", because);
  }
  const topic = top.topic_id ? library.topic(top.topic_id) : null;
  if (topic?.name_de) return make("topic_focus", because, `${OBJECTIVES.topic_focus}: ${topic.name_de}`);
  if (top.type === SKILL_TYPES.LEXICAL_ITEM) return make("vocabulary_activation", because);
  return make("grammar_consolidation", because);
}

// ---------------------------------------------------------------- Verlauf

/**
 * Aus den Ereignissen (nur dieser Nutzer, nur bis zum Stichtag): letzter Versuch je Übung und die
 * zuletzt für einen Skill verwendete Übung (für Abwechslung: nicht wieder dieselbe Aufgabe).
 */
function practiceHistory(events, userId, cutoff, library) {
  const lastAttempt = new Map();
  const attemptExercise = new Map();
  const observations = [];
  for (const event of events) {
    if (event?.user_id !== userId || !(event.created_at <= cutoff)) continue;
    if (event.event_type === "attempt") {
      const id = event.payload.exercise_id;
      attemptExercise.set(event.id, id);
      if (!lastAttempt.has(id) || lastAttempt.get(id) < event.created_at) lastAttempt.set(id, event.created_at);
    } else if (event.event_type === "skill_observation") {
      observations.push(event);
    }
  }
  const lastForSkill = new Map();
  for (const event of observations.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))) {
    const exerciseId = attemptExercise.get(event.payload.attempt_id);
    if (!exerciseId) continue;
    lastForSkill.set(event.payload.skill_id, { exercise_id: exerciseId, type: library.exercise(exerciseId)?.type ?? null });
  }
  return { lastAttempt, lastForSkill };
}

/** Kompetenzbereiche, für die das Paket überhaupt Übungen hat (Messen ist nur dort möglich). */
/**
 * Tage seit der letzten freien oder spontanen Antwort, wenn es geübte Skills gibt (mindestens "practicing"),
 * die schon produziert werden könnten; sonst null (Anfänger ohne Produktionsgrundlage: kein Signal).
 */
function daysWithoutProduction(skills, asOf) {
  const practiced = skills.filter((s) => ["practicing", "stable", "mastered"].includes(s.mastery));
  if (!practiced.length) return null;
  // jede freie/spontane Antwort zählt, auch eine fehlerhafte (Produktion hat stattgefunden)
  const last = skills.flatMap((s) => [s.last_evidence_at?.free, s.last_evidence_at?.spontaneous]).filter(Boolean).sort().at(-1);
  const since = last ?? practiced.map((s) => s.first_seen_at).filter(Boolean).sort()[0];
  return since ? Math.floor((asOf.getTime() - Date.parse(since)) / 86_400_000) : null;
}

function DIMENSIONS_WITH_CONTENT(library) {
  const dims = new Set();
  for (const exercise of library.exercises()) for (const d of exerciseDimensions(exercise)) dims.add(d);
  return [...dims].sort();
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Audio-Schwierigkeit einer Höraufgabe für diesen Lerner (P16, listening/model.js); null bei anderen Aufgaben. */
function audioOf(exercise, { library = null, byAccent = null } = {}) {
  if (!exercise.listening || !library?.audio) return null;
  return audioDifficulty(audioFeatures(exercise, library.audio(exercise.listening.audio)), { byAccent });
}
