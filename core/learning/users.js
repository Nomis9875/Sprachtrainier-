/**
 * Lokale Benutzerverwaltung (Mehrbenutzerbetrieb auf einem Gerät).
 *
 *   Gerät ─ device_id (meta)
 *     └─ Nutzerverzeichnis (meta "users"): [{id, display_name, created_at, updated_at, preferences,
 *                                            languages, active_language}]
 *     └─ aktiver Nutzer   (meta "active_user_id")
 *
 * Lernsprachen (P11B): Jeder Nutzer lernt eine oder mehrere Sprachen ("languages", in gewählter
 * Reihenfolge) und hat eine aktive Lernsprache. Einträge von vor P11B haben diese Felder nicht; sie lernten
 * Spanisch und werden beim Lesen als languages ["es"], active_language "es" geführt (nichts wird umgeschrieben).
 *
 * Geteilt: Inhalt, Regeln, Code. Nutzerbezogen: alles Gelernte. Die Lernhistorie jedes Nutzers sind
 * die Ereignisse mit seiner user_id; daraus werden Kompetenz, Wiederholung, Gedächtnis, Lernbedarfe,
 * Sessions und Statistik berechnet, immer nur für diesen einen Nutzer.
 *
 * Die Lernlogik kennt KEINEN aktiven Nutzer: Sie bekommt den Lerner ausdrücklich übergeben
 * (LearningEngine({learnerId})). Nur die App fragt das Verzeichnis, wer gerade lernt.
 *
 * Migration (bis P9 genau ein Lerner je Gerät): Die bisherige Kennung meta "user_id" wird unverändert
 * der erste Nutzer. Seine Ereignisse tragen diese user_id bereits, es wird nichts umgeschrieben und
 * nichts gelöscht. Name und Tagesziel aus meta "profile" werden übernommen (der alte Eintrag bleibt).
 * Neue Installation: kein Nutzer, die App fragt nach dem ersten Namen.
 */

import { uuidv7 } from "../util/ids.js";

export const USERS_META_KEY = "users";
export const ACTIVE_USER_META_KEY = "active_user_id";
export const DEVICE_META_KEY = "device_id";
export const LEGACY_USER_META_KEY = "user_id";
export const LEGACY_PROFILE_META_KEY = "profile";
export const DEFAULT_PREFERENCES = Object.freeze({ daily_minutes: 10, ai_analysis: false, explanation_language: "de" });
// P24: Sprache der Erklärungen (unabhängig von der Lernsprache)
export const EXPLANATION_LANGUAGES = Object.freeze(["de", "es"]);
export const UI_LANGUAGES = Object.freeze(["de", "es"]);
export const NAME_MAX = 40;
// Lerner von vor P11B lernten Spanisch (dieselbe Eigenschaft alter Daten wie bei Ereignissen, util/language.js)
export { LEGACY_EVENT_LANGUAGE as LEGACY_LANGUAGE } from "../util/language.js";
import { LEGACY_EVENT_LANGUAGE as LEGACY_LANGUAGE } from "../util/language.js";
const LANGUAGE_ID = /^[a-z]{2}$/;
const SESSION_MINUTES = Object.freeze([5, 10, 15, 20, 30]);

export class UserError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "UserError";
    this.code = code;
  }
}

export class UserDirectory {
  /** @param {{storage: object, clock?: () => Date, newId?: () => string}} options */
  constructor({ storage, clock = () => new Date(), newId = uuidv7 }) {
    this.storage = storage;
    this._clock = clock;
    this._newId = newId;
  }

  /** Verzeichnis laden; einmalig den bisherigen Einzelnutzer übernehmen. Gibt den aktiven Nutzer zurück. */
  async init() {
    if (!(await this.storage.getMeta(DEVICE_META_KEY))) await this.storage.setMeta(DEVICE_META_KEY, this._newId());
    let users = await this.storage.getMeta(USERS_META_KEY);
    if (!Array.isArray(users)) {
      users = [];
      const legacyId = await this.storage.getMeta(LEGACY_USER_META_KEY);
      if (legacyId) users.push(await this._legacyUser(legacyId));
      await this._save(users);
      if (users.length) await this.storage.setMeta(ACTIVE_USER_META_KEY, users[0].id);
    }
    return this.active();
  }

  async deviceId() {
    return this.storage.getMeta(DEVICE_META_KEY);
  }

  async list() {
    return structuredClone((await this.storage.getMeta(USERS_META_KEY)) ?? []).map(normalizeLanguages);
  }

  async get(userId) {
    return (await this.list()).find((u) => u.id === userId) ?? null;
  }

  /** Der aktive Nutzer oder null (neue Installation). */
  async active() {
    const id = await this.storage.getMeta(ACTIVE_USER_META_KEY);
    return id ? this.get(id) : null;
  }

  async setActive(userId) {
    if (!(await this.get(userId))) throw new UserError("Diesen Nutzer gibt es nicht.", "unknown_user");
    await this.storage.setMeta(ACTIVE_USER_META_KEY, userId);
    return this.get(userId);
  }

  async create(displayName) {
    const users = await this.list();
    const name = cleanName(displayName);
    if (users.some((u) => u.display_name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"))) {
      throw new UserError(`Es gibt schon einen Nutzer „${name}“.`, "duplicate_name");
    }
    const now = this._clock().toISOString();
    const user = {
      id: this._newId(), display_name: name, created_at: now, updated_at: now, preferences: { ...DEFAULT_PREFERENCES },
      languages: [], active_language: null,
    };
    users.push(user);
    await this._save(users);
    if (!(await this.storage.getMeta(ACTIVE_USER_META_KEY))) await this.storage.setMeta(ACTIVE_USER_META_KEY, user.id);
    return structuredClone(user);
  }

  async rename(userId, displayName) {
    return this._update(userId, (user, users) => {
      const name = cleanName(displayName);
      if (users.some((u) => u.id !== userId && u.display_name.toLocaleLowerCase("de") === name.toLocaleLowerCase("de"))) {
        throw new UserError(`Es gibt schon einen Nutzer „${name}“.`, "duplicate_name");
      }
      user.display_name = name;
    });
  }

  /** Lernsprache hinzufügen (P11B). Die erste wird automatisch aktiv. Doppelt hinzufügen ändert nichts. */
  async addLanguage(userId, languageId) {
    checkLanguage(languageId);
    return this._update(userId, (user) => {
      normalizeLanguages(user);
      if (!user.languages.includes(languageId)) user.languages.push(languageId);
      user.active_language ??= languageId;
    });
  }

  /** Aktive Lernsprache wechseln; nur eine Sprache, die der Nutzer lernt. Die Daten anderer Sprachen bleiben. */
  async setActiveLanguage(userId, languageId) {
    checkLanguage(languageId);
    return this._update(userId, (user) => {
      normalizeLanguages(user);
      if (!user.languages.includes(languageId)) {
        throw new UserError("Diese Sprache lernst du noch nicht. Füge sie zuerst hinzu.", "unknown_language");
      }
      user.active_language = languageId;
    });
  }

  async updatePreferences(userId, changes) {
    return this._update(userId, (user) => {
      const next = { ...DEFAULT_PREFERENCES, ...user.preferences, ...changes };
      if (!SESSION_MINUTES.includes(next.daily_minutes)) {
        throw new UserError(`Tagesziel: bitte ${SESSION_MINUTES.join(", ")} Minuten wählen.`, "invalid_goal");
      }
      next.ai_analysis = Boolean(next.ai_analysis);
      // P25.1: Sprache der Oberfläche (optional; ohne Angabe gilt die des Geräts)
      if (next.ui_language !== undefined && !UI_LANGUAGES.includes(next.ui_language)) {
        throw new UserError(`Sprache der App: ${UI_LANGUAGES.join(" oder ")}.`, "invalid_ui_language");
      }
      if (!EXPLANATION_LANGUAGES.includes(next.explanation_language)) {
        throw new UserError(`Erklärungssprache: ${EXPLANATION_LANGUAGES.join(" oder ")}.`, "invalid_explanation_language");
      }
      user.preferences = next;
    });
  }

  /**
   * Nutzer und seine gesamte Lernhistorie löschen. Der aktive Nutzer kann nicht gelöscht werden
   * (erst wechseln), damit nie eine laufende App plötzlich ohne Lerner dasteht.
   */
  async delete(userId) {
    const users = await this.list();
    if (!users.some((u) => u.id === userId)) throw new UserError("Diesen Nutzer gibt es nicht.", "unknown_user");
    if ((await this.storage.getMeta(ACTIVE_USER_META_KEY)) === userId) {
      throw new UserError("Der aktive Nutzer kann nicht gelöscht werden. Wechsle zuerst zu einem anderen Nutzer.", "active_user");
    }
    const deletedEvents = await this.storage.deleteEvents({ userId });
    await this._save(users.filter((u) => u.id !== userId));
    return { deleted_events: deletedEvents };
  }

  async _update(userId, change) {
    const users = await this.list();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new UserError("Diesen Nutzer gibt es nicht.", "unknown_user");
    change(user, users);
    user.updated_at = this._clock().toISOString();
    await this._save(users);
    return structuredClone(user);
  }

  async _legacyUser(legacyId) {
    const profile = (await this.storage.getMeta(LEGACY_PROFILE_META_KEY)) ?? {};
    const [first] = await this.storage.listEvents({ userId: legacyId, limit: 1 });
    const now = this._clock().toISOString();
    const minutes = SESSION_MINUTES.includes(profile.daily_minutes) ? profile.daily_minutes : DEFAULT_PREFERENCES.daily_minutes;
    return {
      id: legacyId,
      display_name: profile.name?.trim() ? cleanName(profile.name) : "Ich",
      created_at: first?.created_at ?? now,
      updated_at: now,
      preferences: { ...DEFAULT_PREFERENCES, daily_minutes: minutes },
      migrated_from: "legacy_single_user",
    };
  }

  async _save(users) {
    await this.storage.setMeta(USERS_META_KEY, users);
  }
}

function cleanName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  if (!name) throw new UserError("Bitte gib einen Namen ein.", "empty_name");
  return name;
}

/** Einträge von vor P11B: Spanisch als einzige und aktive Lernsprache (nur in der gelesenen Kopie). */
function normalizeLanguages(user) {
  if (!Array.isArray(user.languages)) {
    user.languages = [LEGACY_LANGUAGE];
    user.active_language = LEGACY_LANGUAGE;
  }
  if (user.active_language !== null && !user.languages.includes(user.active_language)) user.active_language = user.languages[0] ?? null;
  return user;
}

function checkLanguage(languageId) {
  if (typeof languageId !== "string" || !LANGUAGE_ID.test(languageId)) {
    throw new UserError("Unbekannte Sprache.", "unknown_language");
  }
}
