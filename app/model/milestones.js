/**
 * Meilensteine (P25.4): echte Leistungen, abgeleitet aus vorhandenen Ereignissen und Erinnerungen. Nichts wird
 * gespeichert oder erfunden; jeder Meilenstein nennt den Zeitpunkt, an dem er erreicht wurde.
 *
 *   free_use            erste Struktur oder Wendung frei bzw. im Gespräch verlässlich richtig verwendet
 *                       (Beobachtung frei/spontan, nachgewiesen, nicht unsicher, nicht von der KI)
 *   conversation        erstes abgeschlossenes Gespräch
 *   errors_resolved     erster, fünfter, zehnter überwundene typische Fehler (Erinnerung "resolved")
 *   listening_unaided   erste Hörfrage richtig beantwortet, ohne Stichwörter oder Transkript
 *   learning_days       7, 30, 100 Lerntage (Tage mit Übungen oder Einstufung, wie in der Aktivität)
 *   level_up            ein Bereich erreicht eine höhere Stufe als bei der ersten Einstufung (vom Aufrufer
 *                       ermittelt, siehe AppService.milestones)
 */

import { t } from "./i18n.js";

export const MILESTONE_DAYS = Object.freeze([7, 30, 100]);
export const MILESTONE_RESOLVED = Object.freeze([1, 5, 10]);
const FREE = new Set(["free", "spontaneous"]);
const SHOWN = new Set(["demonstrated", "correct"]);
const UNAIDED = new Set(["audio_only", "question"]);

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);

/**
 * @param {{events: object[], memories: object[], levelUps?: {dimension: string, level: string, at: string, day: string}[]}} input
 * @returns {{id: string, kind: string, at: string, day: string, skill_id?: string, n?: number, dimension?: string, level?: string}[]}
 */
export function computeMilestones({ events, memories, levelUps = [] }) {
  const sorted = [...events].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const list = [];
  const add = (entry) => list.push(entry);

  const free = sorted.find((e) => e.event_type === "skill_observation" && FREE.has(e.payload.evidence) && SHOWN.has(e.payload.outcome)
    && e.payload.reliability !== "low" && e.payload.source !== "llm");
  if (free) add({ id: "free_use", kind: "free_use", at: free.created_at, day: free.local_date, skill_id: free.payload.skill_id });

  const conversation = sorted.find((e) => e.event_type === "conversation_completed");
  if (conversation) add({ id: "conversation", kind: "conversation", at: conversation.created_at, day: conversation.local_date });

  const listening = sorted.find((e) => e.event_type === "attempt" && e.payload.listening && UNAIDED.has(e.payload.listening.support_level)
    && e.payload.evaluation?.overall?.outcome === "correct");
  if (listening) add({ id: "listening_unaided", kind: "listening_unaided", at: listening.created_at, day: listening.local_date });

  const resolved = memories.filter((m) => m.memory_type === "recurring_error" && m.status === "resolved")
    .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0));
  for (const n of MILESTONE_RESOLVED) {
    const m = resolved[n - 1];
    if (m) add({ id: `errors_resolved:${n}`, kind: "errors_resolved", n, at: m.updated_at, day: localDay(m.updated_at), skill_id: m.skill_id });
  }

  const days = [];
  for (const e of sorted) {
    if ((e.event_type === "attempt" || e.event_type === "assessment_response") && e.local_date && !days.includes(e.local_date)) {
      days.push(e.local_date);
      if (MILESTONE_DAYS.includes(days.length)) {
        add({ id: `learning_days:${days.length}`, kind: "learning_days", n: days.length, at: e.created_at, day: e.local_date });
      }
    }
  }

  for (const up of levelUps) add({ id: `level_up:${up.dimension}:${up.level}`, kind: "level_up", ...up });
  return list.sort(byTime);
}

/** Meilensteine, die in einem Zeitraum erreicht wurden (z. B. in dieser Session). */
export function milestonesBetween(milestones, from, to) {
  return milestones.filter((m) => m.at >= from && m.at <= to);
}

/** Titel und Satz eines Meilensteins in der Sprache der App; label: Skill-ID → Name, dimension: ID → Name. */
export function describeMilestone(m, { label = (id) => id, dimension = (id) => id } = {}) {
  switch (m.kind) {
    case "free_use": return { title: t("ms.free_use"), text: t("ms.free_use_text", label(m.skill_id)) };
    case "conversation": return { title: t("ms.conversation"), text: t("ms.conversation_text") };
    case "listening_unaided": return { title: t("ms.listening"), text: t("ms.listening_text") };
    case "errors_resolved": return m.n === 1
      ? { title: t("ms.error_first"), text: t("ms.error_first_text", label(m.skill_id)) }
      : { title: t("ms.errors_n", m.n), text: t("ms.errors_n_text", m.n) };
    case "learning_days": return { title: t("ms.days", m.n), text: t("ms.days_text", m.n) };
    case "level_up": return { title: t("ms.level_up", dimension(m.dimension), m.level), text: t("ms.level_up_text") };
    default: return { title: m.kind, text: "" };
  }
}

/** Stufe ohne Zusatz ("B1+" → "B1"); null ohne Schätzung. */
export function baseLevel(label) {
  return typeof label === "string" ? label.match(/^[ABC][12]/)?.[0] ?? null : null;
}

function localDay(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
