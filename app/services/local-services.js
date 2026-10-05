/**
 * Optionale lokale Dienste des PCs (python main.py serve): Spracherkennung und KI-Zusatzanalyse.
 *
 * Nur hier spricht die App mit /api/. Oberfläche und Lernlogik kennen weder faster-whisper noch
 * Ollama: Sie bekommen einen Transcript-Text bzw. eine Zusatzanalyse, die der Kern prüft.
 * Alles bleibt auf diesem Gerät (gleicher Server, gleiche Herkunft). Ist ein Dienst nicht da
 * (offline, anderer Server, nicht eingerichtet), meldet available() false und die App lernt ohne ihn.
 */

export const TRANSCRIBE_TIMEOUT_MS = 60_000;
export const ANALYZE_TIMEOUT_MS = 90_000;
const CAPABILITIES_TIMEOUT_MS = 4_000;
const NONE = Object.freeze({ available: false, reason: "nicht erreichbar" });

export class ServiceError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "ServiceError";
    this.code = code; // offline | stt_unavailable | invalid_audio | stt_failed | llm_unavailable | llm_timeout | llm_invalid | aborted | timeout
  }
}

export class LocalServices {
  constructor({ baseUrl = "api/", fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.status = { stt: NONE, llm: NONE };
  }

  /** Fragt die Fähigkeiten ab (nie ein Fehler: im Zweifel "nicht verfügbar"). */
  async refresh() {
    try {
      const body = await this._request("capabilities", { timeoutMs: CAPABILITIES_TIMEOUT_MS });
      this.status = { stt: body?.stt ?? NONE, llm: body?.llm ?? NONE };
    } catch {
      this.status = { stt: NONE, llm: NONE };
    }
    return this.status;
  }

  sttAvailable() {
    return this.status.stt?.available === true;
  }

  llmAvailable() {
    return this.status.llm?.available === true;
  }

  /** WAV-Aufnahme → {text, language, duration_seconds, confidence, provider, model, processing_seconds} */
  transcribe(wav, { signal, language } = {}) {
    // P20: Lernsprache ist Pflicht (Whisper würde sonst raten oder Spanisch annehmen)
    if (typeof language !== "string" || !language) return Promise.reject(new TypeError("transcribe: Lernsprache (language) fehlt"));
    return this._request(`stt?language=${encodeURIComponent(language)}`, { body: wav, contentType: "audio/wav", signal, timeoutMs: TRANSCRIBE_TIMEOUT_MS });
  }

  /** Zusatzanalyse (Qwen) → {model, findings, discarded, processing_seconds}; Prüfung danach im Kern. */
  analyze(request, { signal } = {}) {
    return this._request("analyze", {
      body: JSON.stringify(request), contentType: "application/json", signal, timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  }

  /** Gesprächshilfe (Qwen) → {model, choice, processing_seconds}; wählt nur unter den Kandidaten der Engine. */
  converse(request, { signal } = {}) {
    return this._request("converse", {
      body: JSON.stringify(request), contentType: "application/json", signal, timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  }

  async _request(path, { body, contentType, signal, timeoutMs }) {
    if (!this.fetch) throw new ServiceError("offline", "Keine Verbindung zum lokalen Server.");
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: contentType ? { "Content-Type": contentType } : undefined,
        body,
        signal: combined,
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw new ServiceError("aborted", "Abgebrochen.", { cause: error });
      if (timeout.aborted) throw new ServiceError("timeout", "Der lokale Dienst hat zu lange gebraucht.", { cause: error });
      throw new ServiceError("offline", "Der lokale Server ist nicht erreichbar.", { cause: error });
    }
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      throw new ServiceError("offline", "Der lokale Server hat keine gültige Antwort geliefert.", { cause: error });
    }
    if (!response.ok) throw new ServiceError(data?.error ?? "offline", data?.message ?? `Fehler ${response.status}`);
    return data;
  }
}
