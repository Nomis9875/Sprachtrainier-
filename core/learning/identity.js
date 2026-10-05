/**
 * Gerätekennung. Beim ersten Start erzeugt jedes Gerät eine eigene device_id (meta "device_id").
 *
 * Wer lernt, steht NICHT hier: Seit P10 (Mehrbenutzerbetrieb) bekommt die LearningEngine den Lerner
 * ausdrücklich übergeben (learnerId); die Nutzer eines Geräts verwaltet users.js (UserDirectory).
 * Der frühere Einzelnutzer (meta "user_id") wird dort als erster Nutzer übernommen.
 */

import { uuidv7 } from "../util/ids.js";

export const META_DEVICE_ID = "device_id";

/** @returns {Promise<string>} device_id */
export async function ensureDevice(storage, newId = uuidv7) {
  let deviceId = await storage.getMeta(META_DEVICE_ID);
  if (!deviceId) {
    deviceId = newId();
    await storage.setMeta(META_DEVICE_ID, deviceId);
  }
  return deviceId;
}
