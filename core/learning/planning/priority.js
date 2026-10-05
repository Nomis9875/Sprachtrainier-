/**
 * Priorität eines Skills für die nächste Session: Kompetenz ("wie sicher?") + Wiederholung ("wann?").
 *
 *   Kompetenzbedarf (needs.js)      Bedarfsart mit Grundwert, Fehlerhäufigkeit, Rückfall, Niveau,
 *                                   fortgeschrittenes Thema, Sättigung heute
 *   Wiederholung (ReviewSnapshot)   Fälligkeit, Vergessensrisiko, Lapses, Relearning, gerade geübt
 *
 * Jeder Baustein ist ein Faktor {key, value, label}; die Priorität ist ihre Summe. Nichts ist geraten,
 * nichts zufällig. Die Faktoren der Wiederholung:
 *
 *   review_due       +8   fällig oder überfällig (nicht für neue Skills)
 *   review_soon      +3   bald fällig (innerhalb eines Tages)
 *   retrieval_risk   bis +20   round(40 · (0.9 − R)), wenn R < 0.9 (R = aktuelle Abrufwahrscheinlichkeit)
 *   relearning       +5   nach einem Lapse aus der Wiederholungsphase gefallen
 *   lapses           +3 je Lapse, höchstens +9 (wiederholt vergessen)
 *   just_practiced   −10  zuletzt erfolgreich und gerade erst abgerufen (R ≥ 0.95, nicht fällig)
 *
 * Warum Überfälligkeit nicht alles verdrängt: Sie wirkt nur über das tatsächliche Vergessensrisiko.
 * Ein sehr stabiler Skill, der zwei Tage überfällig ist, hat noch R ≈ 0.85 (+2 plus +8 fällig), ein
 * Skill mit drei frischen Fehlern bekommt aus dem Kompetenzbedarf 55–85. Fällige Wiederholung ist ein
 * Signal unter mehreren, nicht der Sortierschlüssel.
 *
 * Zweck (purpose) für die Mischung der Session:
 *   error_focus  aktiver Fehler, instabil, frei schwach     production  nie frei/spontan produziert
 *   review       fällige Wiederholung oder Relearning        new         noch nie beobachtet
 *   challenge    stabil/beherrscht: anspruchsvoll anwenden   consolidate festigen, nicht fällig
 */

import { assessSkill, factorText } from "./needs.js";

export const PURPOSES = Object.freeze(["error_focus", "review", "production", "consolidate", "new", "challenge"]);

export const PRIORITY_RULES = Object.freeze({
  dueBonus: 8,
  soonBonus: 3,
  riskScale: 40,
  riskCap: 20,
  relearningBonus: 5,
  lapseBonus: 3,
  lapseCap: 9,
  justPracticedPenalty: -10,
  justPracticedRetrievability: 0.95,
});

const PURPOSE_OF_NEED = Object.freeze({
  active_error: "error_focus",
  unstable: "error_focus",
  production_weak: "error_focus",
  production_gap: "production",
  declining_error: "review",
  consolidate: "consolidate",
  new: "new",
  stable: "challenge",
  maintenance: "challenge",
});

/**
 * @param {{skill: object, meta: object, review?: object|null, now: Date}} input
 *   skill: Eintrag aus dem CompetenceSnapshot, review: Eintrag aus dem ReviewSnapshot
 * @returns {null | {need: string, purpose: string, score: number, target_evidence: string, reason: string,
 *   factors: {key: string, value: number, label: string}[], priority_factors: string[], reasons: string[]}}
 *   null: kein Bedarf (beherrscht und nicht fällig)
 */
export function scoreSkillForSession({ skill, meta, review = null, now }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("now: gültiges Datum erwartet");
  const assessment = assessSkill(skill, meta, now, review);
  if (!assessment) return null;
  const factors = [...assessment.factors];
  const reasons = [assessment.reason];
  const add = (key, value, label, reason = label) => {
    if (!value) return;
    factors.push({ key, value, label });
    reasons.push(reason);
  };

  const reviewed = review && review.phase !== "new";
  const due = reviewed && (review.due_status === "due" || review.due_status === "overdue");
  if (reviewed) {
    const rules = PRIORITY_RULES;
    if (due) {
      add("review_due", rules.dueBonus, review.due_status === "overdue" ? "Wiederholung überfällig" : "Wiederholung fällig",
        `Wiederholung ${review.due_status === "overdue" ? `seit ${review.overdue_days} Tagen überfällig` : "fällig"}`);
    } else if (review.due_status === "soon") {
      add("review_soon", rules.soonBonus, "Wiederholung bald fällig");
    }
    if (review.retrievability < 0.9) {
      const risk = Math.min(rules.riskCap, Math.round(rules.riskScale * (0.9 - review.retrievability)));
      add("retrieval_risk", risk, `Vergessensrisiko (Abruf ${Math.round(review.retrievability * 100)} %)`);
    }
    if (review.phase === "relearning") add("relearning", rules.relearningBonus, "nach Lapse neu festigen");
    add("lapses", Math.min(rules.lapseCap, rules.lapseBonus * review.lapses), `${review.lapses}× wieder vergessen`);
    if (!due && review.last_outcome === "success" && review.retrievability >= rules.justPracticedRetrievability) {
      add("just_practiced", rules.justPracticedPenalty, "gerade erst erfolgreich geübt");
    }
  }

  let purpose = PURPOSE_OF_NEED[assessment.need] ?? "consolidate";
  // Festigen, das fällig ist, ist Wiederholung. Eine Produktionslücke behält ihren Zweck (höhere Stufe).
  if ((due || review?.phase === "relearning") && purpose === "consolidate") purpose = "review";

  return {
    need: assessment.need,
    purpose,
    score: factors.reduce((sum, f) => sum + f.value, 0),
    target_evidence: assessment.target_evidence,
    reason: assessment.reason,
    factors,
    priority_factors: factors.map(factorText),
    reasons,
  };
}
