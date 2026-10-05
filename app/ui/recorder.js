/**
 * Mikrofonaufnahme im Browser → WAV (PCM 16 bit, mono, 16 kHz), das Format der lokalen Spracherkennung.
 *
 * Die Aufnahme bleibt im Arbeitsspeicher und geht nur an den lokalen Server (/api/stt); sie wird
 * weder gespeichert noch hochgeladen. Nach dem Stoppen wird das Mikrofon sofort freigegeben.
 */

export const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 60;

export function recordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

/** Startet die Aufnahme. → {stop(): Promise<Blob>, cancel(): void, seconds(): number} */
export async function startRecording({ onLimit } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context({ sampleRate: SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor: einfach und überall vorhanden; die Datenmenge (16 kHz mono) ist klein
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let length = 0;
  let done = false;
  processor.onaudioprocess = (event) => {
    if (done) return;
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    length += data.length;
    if (length >= context.sampleRate * MAX_SECONDS) onLimit?.();
  };
  source.connect(processor);
  processor.connect(context.destination);

  const release = () => {
    done = true;
    processor.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    context.close().catch(() => {});
  };
  return {
    seconds: () => length / context.sampleRate,
    cancel: release,
    async stop() {
      const rate = context.sampleRate;
      release();
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      return encodeWav(rate === SAMPLE_RATE ? samples : resample(samples, rate, SAMPLE_RATE), SAMPLE_RATE);
    },
  };
}

/** Float32 [-1, 1] → WAV-Blob (PCM 16 bit, mono). */
export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Einfaches lineares Umrechnen, falls der Browser die gewünschte Abtastrate nicht liefert. */
function resample(samples, from, to) {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left] + (samples[right] - samples[left]) * (pos - left);
  }
  return out;
}
