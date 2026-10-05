/**
 * Wiederholungsmodell (Spaced Repetition): WANN sollte ein Lernziel wieder abgerufen werden?
 *
 * Die Einheit ist ein SKILL (grammar_structure:…, lexical_item:…, common_error:…), nicht eine Übung:
 * Übungen sind austauschbar, die Fähigkeit bleibt. Das Modell ist an FSRS angelehnt, aber bewusst
 * klein, deterministisch und erklärbar (keine Abhängigkeit, keine Uhr, kein Zufall):
 *
 *   Stabilität S (Tage)    nach S Tagen ist die Abrufwahrscheinlichkeit auf 90 % gefallen.
 *                          Das Intervall bis zur nächsten Wiederholung ist deshalb S.
 *   Schwierigkeit D (1–10) wie schwer sich dieser Skill für diesen Lerner festigt.
 *   Abrufwahrscheinlichkeit R(t) = (1 + t / (9·S))⁻¹   (Vergessenskurve; t = Tage seit dem letzten Abruf)
 *
 * Ergebnis eines Abrufs (aus den Beobachtungen, siehe outcomes.js):
 *
 *   success  S wächst:  S' = S · (1 + A · (11 − D) · S^(−B) · (e^(C·(1−R)) − 1) · Gewicht)
 *            Das Wachstum ist umso größer, je mehr schon vergessen war (1 − R): Fünf Treffer an einem
 *            Abend (R ≈ 1) festigen kaum, ein Treffer nach einer Woche viel. Gewicht = Nachweisstufe
 *            (ein freier Satz zählt mehr als ein Lückentext) × Verlässlichkeit der Beobachtung.
 *   failure  Lapse: S fällt auf S_f = E · D^(−F) · ((S + 1)^G − 1) · e^(H·(1−R)) (höchstens S),
 *            D steigt, Lapse wird gezählt.
 *   miss     verpasste Gelegenheit (die Aufgabe verlangte den Skill, er kam nicht): kein Fehler und
 *            kein Lapse, aber auch kein Fortschritt; S sinkt leicht (× MISS_FACTOR), D steigt wenig.
 *
 * Phasen (was ist mit dem Skill los?) und Fälligkeit (wann?) sind getrennte Achsen:
 *
 *   phase       new         noch nie abgerufen
 *               learning    in Einführung: S < REVIEW_MIN_STABILITY, bisher ohne Lapse aus der Wiederholungsphase
 *               review      gefestigt: S ≥ REVIEW_MIN_STABILITY
 *               relearning  nach einem Lapse, der den Skill aus der Wiederholungsphase geworfen hat
 *               mastered    lange stabil: S ≥ MASTERED_MIN_STABILITY und zuletzt ≥ 3 Erfolge in Folge
 *   due_status  not_due     Intervall läuft noch
 *               soon        fällig innerhalb von SOON_WINDOW (höchstens 1 Tag)
 *               due         fällig (bis 10 % des Intervalls, mindestens 1 Tag darüber)
 *               overdue     länger überfällig
 *
 * Das Modell sagt NICHT, wie gut ein Skill beherrscht wird: Das beantwortet das Kompetenzmodell
 * (Stufen, Produktionsstufen, Fehlerpfad). Die Sessionplanung kombiniert beides.
 */

export const REVIEW_PHASES = Object.freeze(["new", "learning", "review", "relearning", "mastered"]);
export const DUE_STATUSES = Object.freeze(["not_due", "soon", "due", "overdue"]);
export const REVIEW_OUTCOMES = Object.freeze(["success", "failure", "miss"]);

export const DAY_MS = 86_400_000;

/** Alle Konstanten an einer Stelle; sie werden im ReviewSnapshot mitgeliefert. */
export const REVIEW_RULES = Object.freeze({
  targetRetention: 0.9,
  initialDifficulty: 5,
  minStability: 0.1, // Tage
  maxStability: 365, // Tage; längere Intervalle sind für aktive Sprachproduktion nicht sinnvoll
  initialStability: Object.freeze({ success: 1.5, failure: 0.3, miss: 0.5 }),
  growth: Object.freeze({ A: 4.5, B: 0.1, C: 1.0 }),
  lapse: Object.freeze({ E: 2.0, F: 0.1, G: 0.3, H: 2.0 }),
  missFactor: 0.7,
  difficultyDelta: Object.freeze({ failure: 1.0, miss: 0.4, weakSuccess: 0.2, success: -0.2, strongSuccess: -0.5 }),
  difficultyReversion: 0.05, // Rückkehr zur Anfangsschwierigkeit je Abruf
  reviewMinStability: 7,
  masteredMinStability: 60,
  masteredMinStreak: 3,
  soonWindowDays: 1,
  overdueToleranceShare: 0.1,
});

/**
 * Gewicht einer erfolgreichen Anwendung nach Nachweisstufe: Erkennen festigt weniger als
 * selbst produzieren (aktiver Abruf).
 */
export const EVIDENCE_GROWTH_WEIGHT = Object.freeze({
  recognized: 0.3, controlled: 0.6, guided: 0.8, free: 1.0, spontaneous: 1.2,
});

/** Abrufwahrscheinlichkeit nach `elapsedDays` bei Stabilität `stability` (0..1). */
export function retrievability(stability, elapsedDays) {
  if (!(stability > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  return 1 / (1 + t / (9 * stability));
}

/** Ein Skill ohne Abruf. */
export function newReviewState(skillId) {
  return {
    skill_id: skillId,
    reps: 0,
    successes: 0,
    failures: 0,
    misses: 0,
    lapses: 0,
    consecutive_successes: 0,
    consecutive_failures: 0,
    stability: null,
    difficulty: null,
    max_stability: 0,
    in_relearning: false,
    first_review_at: null,
    last_review_at: null,
    last_outcome: null,
    last_success_evidence: null,
  };
}

/**
 * Wendet einen Abruf an (rein; der alte Zustand bleibt unverändert).
 *
 * @param {ReturnType<typeof newReviewState>} state
 * @param {{outcome: "success"|"failure"|"miss", evidence: string, weight?: number}} review
 *   weight: Verlässlichkeit der Beobachtung (0..1; Qwen und "low" kommen gar nicht erst hier an)
 * @param {Date|string} now  Zeitpunkt des Abrufs (explizit, nie die Uhr)
 */
export function calculateReviewState(state, review, now) {
  const at = toMs(now, "now");
  if (!REVIEW_OUTCOMES.includes(review?.outcome)) throw new TypeError(`Unbekanntes Ergebnis: ${review?.outcome}`);
  const weight = clamp(review.weight ?? 1, 0, 1);
  const rules = REVIEW_RULES;
  const next = { ...state };
  const first = state.stability === null;
  const elapsed = first ? 0 : Math.max(0, (at - Date.parse(state.last_review_at)) / DAY_MS);
  const r = first ? 1 : retrievability(state.stability, elapsed);
  const d = first ? rules.initialDifficulty : state.difficulty;

  if (review.outcome === "success") {
    const evidenceWeight = (EVIDENCE_GROWTH_WEIGHT[review.evidence] ?? EVIDENCE_GROWTH_WEIGHT.controlled) * weight;
    if (first) {
      next.stability = rules.initialStability.success * Math.max(0.3, evidenceWeight);
    } else {
      const { A, B, C } = rules.growth;
      const growth = A * (11 - d) * state.stability ** -B * (Math.exp(C * (1 - r)) - 1) * evidenceWeight;
      next.stability = state.stability * (1 + growth);
    }
    next.difficulty = updateDifficulty(d, evidenceWeight >= 1 ? "strongSuccess" : evidenceWeight < 0.5 ? "weakSuccess" : "success");
    next.successes += 1;
    next.consecutive_successes += 1;
    next.consecutive_failures = 0;
    next.last_success_evidence = review.evidence;
    // Relearning endet erst durch einen Erfolg, der wieder in die Wiederholungsphase führt
    if (next.in_relearning && next.stability >= rules.reviewMinStability) next.in_relearning = false;
  } else if (review.outcome === "failure") {
    if (first) {
      next.stability = rules.initialStability.failure;
    } else {
      const { E, F, G, H } = rules.lapse;
      const lapsed = E * d ** -F * ((state.stability + 1) ** G - 1) * Math.exp(H * (1 - r));
      next.stability = Math.min(state.stability, lapsed);
      next.lapses += 1;
      if (state.max_stability >= rules.reviewMinStability) next.in_relearning = true;
    }
    next.difficulty = updateDifficulty(d, "failure");
    next.failures += 1;
    next.consecutive_failures += 1;
    next.consecutive_successes = 0;
  } else {
    next.stability = first ? rules.initialStability.miss : state.stability * rules.missFactor;
    next.difficulty = updateDifficulty(d, "miss");
    next.misses += 1;
    next.consecutive_successes = 0;
  }

  next.stability = round4(clamp(next.stability, rules.minStability, rules.maxStability));
  next.max_stability = Math.max(state.max_stability, next.stability);
  next.reps += 1;
  next.first_review_at = state.first_review_at ?? iso(at);
  next.last_review_at = iso(at);
  next.last_outcome = review.outcome;
  return next;
}

/**
 * Wie steht der Skill zum Zeitpunkt `now`? Phase, Fälligkeit, aktuelle Abrufwahrscheinlichkeit.
 * Vergessen ist hier eingebaut: Je länger der letzte Abruf zurückliegt, desto niedriger R; ein
 * stabiler Skill (großes S) vergisst langsamer als ein gerade erst gelernter.
 */
export function describeReviewState(state, now) {
  const at = toMs(now, "now");
  const rules = REVIEW_RULES;
  if (state.stability === null) {
    return { ...state, phase: "new", due_status: "due", due_at: null, interval_days: null, elapsed_days: null,
      overdue_days: 0, retrievability: null };
  }
  const last = Date.parse(state.last_review_at);
  const interval = state.stability; // Ziel 90 %: R(S) = 0.9
  const dueAt = last + interval * DAY_MS;
  const elapsed = Math.max(0, (at - last) / DAY_MS);
  const overdue = (at - dueAt) / DAY_MS;
  let dueStatus;
  if (overdue < -Math.min(rules.soonWindowDays, interval)) dueStatus = "not_due";
  else if (overdue < 0) dueStatus = "soon";
  else if (overdue <= Math.max(1, interval * rules.overdueToleranceShare)) dueStatus = "due";
  else dueStatus = "overdue";

  let phase;
  if (state.stability >= rules.masteredMinStability && state.consecutive_successes >= rules.masteredMinStreak) phase = "mastered";
  else if (state.in_relearning) phase = "relearning";
  else if (state.stability >= rules.reviewMinStability) phase = "review";
  else phase = "learning";

  return {
    ...state,
    phase,
    due_status: dueStatus,
    due_at: iso(dueAt),
    interval_days: round2(interval),
    elapsed_days: round2(elapsed),
    overdue_days: round2(Math.max(0, overdue)),
    retrievability: round4(retrievability(state.stability, elapsed)),
  };
}

function updateDifficulty(d, kind) {
  const moved = d + REVIEW_RULES.difficultyDelta[kind];
  const reverted = moved + REVIEW_RULES.difficultyReversion * (REVIEW_RULES.initialDifficulty - moved);
  return round4(clamp(reverted, 1, 10));
}

function toMs(value, label) {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new TypeError(`${label}: gültiger Zeitpunkt erwartet`);
  return ms;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}
