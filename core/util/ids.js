/**
 * Geräteübergreifend eindeutige IDs: UUID Version 7 (RFC 9562).
 *
 * Aufbau: 48 Bit Zeitstempel (ms) + Version + 74 Bit Zufall. Dadurch sind IDs
 * zeitlich sortierbar und Laptop und iPhone können unabhängig voneinander IDs
 * erzeugen, ohne dass sie beim späteren Synchronisieren kollidieren.
 *
 * Nutzt crypto.getRandomValues (überall verfügbar); crypto.randomUUID steht auf
 * iOS nur in sicheren Kontexten (HTTPS) zur Verfügung.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function defaultRandomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

const MAX_COUNTER = 0xfff;

/**
 * Erzeugt einen ID-Generator. Innerhalb derselben Millisekunde zählt ein 12-Bit-
 * Zähler hoch (RFC 9562, Methode 1): IDs eines Generators sind streng aufsteigend,
 * auch wenn mehrere Ereignisse gleichzeitig entstehen.
 *
 * @param {{now?: () => number, randomBytes?: (n: number) => Uint8Array}} [options]
 * @returns {() => string}
 */
export function createUuidV7Generator({ now = Date.now, randomBytes = defaultRandomBytes } = {}) {
  let lastTime = -1;
  let counter = 0;
  return function nextId() {
    let time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw new RangeError(`Ungültiger Zeitstempel: ${time}`);
    const bytes = randomBytes(16);
    if (time <= lastTime) {
      time = lastTime;
      counter += 1;
      if (counter > MAX_COUNTER) {
        time = lastTime + 1; // Zähler erschöpft: in die nächste Millisekunde ausweichen
        counter = 0;
      }
    } else {
      counter = ((bytes[6] & 0x07) << 8) | bytes[7]; // zufälliger Start, lässt Platz nach oben
    }
    lastTime = time;

    let remaining = time; // Bytes 0–5: Zeitstempel in Millisekunden (Big Endian)
    for (let i = 5; i >= 0; i -= 1) {
      bytes[i] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
    bytes[6] = 0x70 | (counter >> 8); // Version 7 + obere 4 Bit des Zählers
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante RFC 9562
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

const sharedGenerator = createUuidV7Generator();

/**
 * Nächste ID des gemeinsamen Generators. Mit Optionen (nur für Tests) wird ein
 * eigener, frischer Generator verwendet.
 * @param {{now?: () => number, randomBytes?: (n: number) => Uint8Array}} [options]
 */
export function uuidv7(options) {
  return options ? createUuidV7Generator(options)() : sharedGenerator();
}

export function isUuidV7(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Zeitstempel (ms seit 1970) aus einer UUID v7. */
export function uuidv7Timestamp(id) {
  if (!isUuidV7(id)) throw new TypeError(`Keine UUID v7: ${id}`);
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
