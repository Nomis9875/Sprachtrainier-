/**
 * Gemeinsame Bausteine: Aufgabe, Antwortfeld, Rückmeldung, Leer- und Fehlerzustände, Dialog.
 * Sie zeigen nur, was die Anzeige-Modelle (model/*.js) liefern.
 */

import { countWords } from "../model/exercise.js";
import { MASTERY_LABELS, minutesText } from "../model/labels.js";
import { h, icon, targetLang } from "./dom.js";
import { MAX_SECONDS, recordingSupported, startRecording } from "./recorder.js";
import { strongerSupport } from "../model/listening.js";

// ---------------------------------------------------------------- Aufgabe

export function taskCard(exercise, { headingLevel = 2 } = {}) {
  const heading = `h${headingLevel}`;
  return h("section", { class: "card task", "aria-labelledby": "task-title", "data-exercise-id": exercise.id, "data-mode": exercise.mode },
    h("div", { class: "task-meta" },
      h("span", { class: `badge ${exercise.challenge ? "badge-accent" : ""}` }, exercise.challenge ? "Challenge" : exercise.type_label),
      exercise.challenge ? h("span", { class: "badge" }, exercise.type_label) : null,
      h("span", { class: "muted small" }, `ca. ${minutesText(exercise.estimated_seconds)}`)),
    exercise.why ? h("p", { class: "task-why" }, exercise.why) : null,
    exercise.focus ? h("p", { class: "task-focus" }, h("span", { class: "muted" }, "Schwerpunkt: "), exercise.focus) : null,
    exercise.why_text ? h("p", { class: "task-why-text muted small", "data-why": "" }, h("strong", {}, exercise.why_label ?? "Warum? "), exercise.why_text) : null,
    h(heading, { id: "task-title", class: "task-prompt" }, exercise.prompt_de || "Aufgabe"),
    exercise.conversation ? conversationBlock(exercise.conversation) : null,
    // Lesetext (P12): erst der Text, dann die Frage (natürliche Lesereihenfolge)
    exercise.source.passage ? sourceBlock(exercise.source) : null,
    exercise.prompt_es && !exercise.conversation ? h("blockquote", { class: "task-es", lang: targetLang() }, exercise.prompt_es) : null,
    exercise.source.text && !exercise.source.passage ? sourceBlock(exercise.source) : null,
    exercise.instruction_de ? h("p", { class: "task-hint" }, exercise.instruction_de) : null,
    exercise.communication_goal_de && exercise.challenge
      ? h("p", { class: "task-hint" }, h("span", { class: "muted" }, "Ziel: "), exercise.communication_goal_de) : null,
    exercise.min_words ? h("p", { class: "muted small" }, `Mindestens ${exercise.min_words} Wörter.`) : null);
}

function sourceBlock(source) {
  if (source.passage) return h("blockquote", { class: "task-es passage", lang: targetLang() }, source.text);
  if (!source.has_gap) return h("p", { class: "task-source", lang: targetLang() }, source.text);
  const parts = [];
  source.parts.forEach((part, i) => {
    if (i > 0) parts.push(h("span", { class: "gap", "aria-label": "Lücke" }, "…"));
    parts.push(part);
  });
  return h("p", { class: "task-source", lang: targetLang() }, parts);
}

function conversationBlock(conversation) {
  return h("div", { class: "conversation" },
    h("p", { class: "muted small" }, conversation.partner_role_de),
    h("p", { class: "bubble", lang: targetLang() }, conversation.opening_es),
    h("p", { class: "muted small" }, "Antworte in einer Nachricht."));
}

// ---------------------------------------------------------------- Hören (P15)

/**
 * Abspielen einer Höraufgabe mit Hilfe-Leiter. Zählt, wie oft von vorn gehört wurde (Fortsetzen nach Pause zählt
 * nicht), und meldet jede Aktion als Kontext (onInteraction), nie als Antwort. Das Transkript ist die letzte Hilfe.
 * onNoAnswer(reason, state): "dont_know" (nichts verstanden) und, mit allowSkip, "skip" (überspringen).
 * state(): {playCount, supportLevel} für die Antwort.
 * Hörkontext (P16): Titel, "Frage k von n" und Abschnitte zum gezielten Nachhören (zählt als erneutes Hören).
 */
export function listeningPlayer(listening, { onInteraction = () => {}, onNoAnswer = null, allowSkip = false } = {}) {
  let plays = 0;
  let support = listening.base_support;
  const audio = h("audio", { preload: "auto", src: listening.src, "data-audio": listening.audio_id });
  const status = h("span", { class: "muted small listening-status", "aria-live": "polite" }, "Noch nicht gehört");
  const playLabel = h("span", {}, "Anhören");
  const play = h("button", { type: "button", class: "btn btn-primary", "data-action": "listen", "aria-pressed": "false" }, icon("play", { size: 18 }), playLabel);
  const replay = h("button", { type: "button", class: "btn btn-secondary", "data-action": "replay", disabled: true }, "Noch einmal von vorn");
  const report = (action) => { try { onInteraction({ action, playCount: plays, supportLevel: support }); } catch (err) { console.error(err); } };
  const start = () => {
    plays += 1;
    report(plays === 1 ? "play" : "replay");
    replay.disabled = false;
  };
  play.addEventListener("click", () => {
    if (audio.paused) {
      const fromStart = plays === 0 || audio.ended; // Fortsetzen nach einer Pause ist kein neues Hören
      if (audio.ended) audio.currentTime = 0;
      if (fromStart) start();
      audio.play().catch(() => { status.textContent = "Die Aufnahme lässt sich gerade nicht abspielen."; });
    } else {
      audio.pause();
      report("pause");
    }
  });
  let stopAt = null;
  replay.addEventListener("click", () => {
    stopAt = null;
    audio.currentTime = 0;
    start();
    audio.play().catch(() => {});
  });
  // P16: nur einen Abschnitt nachhören (von seinem Anfang bis zu seinem Ende)
  const segmentButtons = (listening.segments ?? []).map((segment) => {
    const button = h("button", { type: "button", class: "btn btn-secondary", "data-segment": segment.id }, `${segment.label} anhören`);
    button.addEventListener("click", () => {
      stopAt = segment.end_s;
      audio.currentTime = segment.start_s;
      start();
      audio.play().catch(() => {});
    });
    return button;
  });
  audio.addEventListener("timeupdate", () => {
    if (stopAt !== null && audio.currentTime >= stopAt) {
      stopAt = null;
      audio.pause();
    }
  });
  const heard = () => (plays === 0 ? "Noch nicht gehört" : `${plays}× gehört`);
  audio.addEventListener("play", () => { playLabel.textContent = "Pause"; play.setAttribute("aria-pressed", "true"); status.textContent = `${heard()} · läuft`; });
  audio.addEventListener("pause", () => { playLabel.textContent = audio.ended ? "Anhören" : "Weiter anhören"; play.setAttribute("aria-pressed", "false"); status.textContent = heard(); });
  audio.addEventListener("ended", () => { playLabel.textContent = "Anhören"; status.textContent = heard(); });

  const revealed = h("div", { class: "listening-support", "aria-live": "polite" });
  const supportNote = h("p", { class: "muted small", hidden: true }, "Mit Hilfe zählt deine Antwort weniger als Hörverstehen ohne Hilfe.");
  const supportButtons = listening.supports.map((s) => {
    const button = h("button", { type: "button", class: "btn btn-link", "data-support": s.level }, s.label);
    button.addEventListener("click", () => {
      support = strongerSupport(support, s.level);
      button.disabled = true;
      revealed.append(h("p", { class: `support-${s.level}`, lang: targetLang() }, s.content));
      supportNote.hidden = false;
      report("support");
    });
    return button;
  });
  const noAnswer = onNoAnswer ? [
    h("button", { type: "button", class: "btn btn-ghost", "data-action": "dont-know" }, "Nichts verstanden"),
    allowSkip ? h("button", { type: "button", class: "btn btn-ghost", "data-action": "skip-listening" }, "Überspringen") : null,
  ].filter(Boolean) : [];
  for (const button of noAnswer) {
    button.addEventListener("click", () => {
      audio.pause();
      onNoAnswer(button.dataset.action === "skip-listening" ? "skip" : "dont_know", { playCount: plays, supportLevel: support });
    });
  }
  const context = listening.context;
  const element = h("section", { class: "card listening", "aria-label": "Aufnahme", "data-listening": listening.audio_id },
    context ? h("div", { class: "listening-context", "data-context": "" },
      context.title ? h("h3", { class: "group-title", lang: targetLang() }, "🎧 ", context.title) : null,
      h("p", { class: "muted small" }, [listening.mode_label, context.length_label, context.speaker_count > 1 ? `${context.speaker_count} Sprecher` : "",
        context.progress].filter(Boolean).join(" · "))) : null,
    h("div", { class: "listening-controls" }, play, replay, status),
    segmentButtons.length ? h("div", { class: "listening-segments" }, h("span", { class: "muted small" }, "Bezieht sich auf: "), segmentButtons) : null,
    audio,
    supportButtons.length ? h("div", { class: "listening-help" }, h("span", { class: "muted small" }, "Hilfe: "), supportButtons) : null,
    supportNote,
    revealed,
    noAnswer.length ? h("div", { class: "listening-noanswer" }, noAnswer) : null,
    h("p", { class: "muted small listening-source" }, `${listening.source.type_label} · `,
      h("a", { href: listening.source.source_url, target: "_blank", rel: "noopener" }, "Quelle"), ` · ${listening.source.license}`,
      listening.source.development_only ? h("span", { class: "badge", "data-development-only": "" }, " nur Entwicklung") : null));
  return {
    element,
    state: () => ({ playCount: plays, supportLevel: support }),
    stop: () => audio.pause(),
  };
}

// ---------------------------------------------------------------- Antwort

/**
 * Antwortfeld mit Absenden. onSubmit(answerText, durationMs, {inputMode, signal}) → Promise; Fehler mit
 * userMessage werden unter dem Feld angezeigt, alles andere als allgemeiner Fehler.
 *
 * speech: lokale Spracherkennung ({transcribe(wav, {signal})}) oder null → Knopf "Sprechen". Der erkannte
 *   Text landet im Antwortfeld und kann korrigiert werden; unverändert abgeschickt gilt er als
 *   gesprochen (inputMode "speech"), sonst als getippt. Bewertet wird er wie jede andere Antwort.
 * aiAnalysis: true, wenn die KI-Zusatzanalyse läuft → während der Prüfung "KI überspringen".
 * busyLabel: Text des Knopfs während der Prüfung (ein zweites Absenden ist dann gesperrt).
 * onEvent: optional, meldet RECORD, STOP, TRANSCRIBED, STT_FAILED (für die Zustandsmaschine eines Gesprächs).
 */
export function answerForm(exercise, { onSubmit, submitLabel = "Prüfen", busyLabel = "Wird geprüft …", speech = null, aiAnalysis = false,
  onEvent = () => {} }) {
  if (exercise.answer_kind === "choice") return choiceForm(exercise, { onSubmit });
  const started = performance.now();
  const id = `answer-${exercise.id}`;
  const long = exercise.answer_kind !== "short";
  const input = long
    ? h("textarea", {
      id, class: "answer-input", rows: exercise.answer_kind === "long" ? 6 : 3, lang: targetLang(), spellcheck: "false",
      autocapitalize: "sentences", autocomplete: "off", "aria-describedby": `${id}-help`,
    })
    : h("input", {
      id, class: "answer-input", type: "text", lang: targetLang(), spellcheck: "false", autocapitalize: "off",
      autocomplete: "off", enterkeyhint: "done", "aria-describedby": `${id}-help`,
    });
  const counter = h("span", { class: "muted small", "aria-live": "off" });
  const help = h("span", { id: `${id}-help`, class: "muted small kbd-hint" },
    long ? "Strg/⌘ + Enter zum Prüfen" : "Enter zum Prüfen");
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const button = h("button", { type: "submit", class: "btn btn-primary btn-block" }, submitLabel);
  const skipAi = h("button", { type: "button", class: "btn btn-link", "data-action": "skip-ai", hidden: true }, "KI-Hinweise überspringen");
  let controller = null;
  skipAi.addEventListener("click", () => controller?.abort());
  let spoken = null; // zuletzt erkannter Text (für inputMode)
  const voice = speech && recordingSupported() ? speechControl(speech, {
    onText: (text) => {
      input.value = text;
      spoken = text;
      input.dispatchEvent(new Event("input"));
      input.focus();
    },
    onBusy: (busyNow) => { button.disabled = busyNow; },
    onEvent,
  }) : null;

  const updateCount = () => {
    if (!exercise.min_words) return;
    const words = countWords(input.value);
    counter.textContent = `${words} / ${exercise.min_words} Wörter`;
    counter.classList.toggle("ok", words >= exercise.min_words);
  };
  input.addEventListener("input", () => {
    updateCount();
    error.hidden = true;
  });
  updateCount();

  const form = h("form", { class: "answer-form", novalidate: true },
    h("label", { for: id, class: "label" }, "Deine Antwort"),
    input,
    h("div", { class: "answer-row" }, help, counter),
    voice ? voice.element : null,
    error,
    button,
    skipAi);

  let busy = false;
  const submit = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = busyLabel;
    form.setAttribute("aria-busy", "true");
    controller = new AbortController();
    const showSkip = aiAnalysis ? setTimeout(() => { skipAi.hidden = false; }, 800) : null;
    const inputMode = spoken !== null && input.value.trim() === spoken.trim() ? "speech" : "text";
    try {
      await onSubmit(input.value, Math.round(performance.now() - started), { inputMode, signal: controller.signal });
    } catch (err) {
      error.textContent = err?.userMessage ?? "Die Antwort konnte gerade nicht gespeichert werden. Bitte versuche es noch einmal.";
      error.hidden = false;
      if (!err?.userMessage) console.error(err);
      input.focus();
    } finally {
      busy = false;
      clearTimeout(showSkip);
      controller = null;
      form.removeAttribute("aria-busy");
      if (form.isConnected) {
        skipAi.hidden = true;
        button.disabled = false;
        button.textContent = submitLabel;
      }
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && long && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
  form.focusInput = () => input.focus({ preventScroll: false });
  return form;
}

/**
 * Auswahl (P12: multiple_choice, Lese- und Hörverstehen): ein Klick auf eine Option ist die Antwort.
 * Bewertet wird sie wie jede Antwort (geschlossen); ein zweites Absenden ist gesperrt.
 */
function choiceForm(exercise, { onSubmit }) {
  const started = performance.now();
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const buttons = exercise.options.map((option) => h("button", {
    type: "button", class: "btn btn-secondary btn-block choice", "data-option": option, lang: targetLang(),
  }, option));
  const form = h("form", { class: "answer-form choice-form", novalidate: true },
    h("p", { class: "label", id: `choices-${exercise.id}` }, "Wähle eine Antwort"),
    h("div", { class: "choice-list", role: "group", "aria-labelledby": `choices-${exercise.id}` }, buttons),
    error);
  let busy = false;
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      for (const b of buttons) b.disabled = true;
      button.setAttribute("aria-pressed", "true");
      form.setAttribute("aria-busy", "true");
      try {
        await onSubmit(button.dataset.option, Math.round(performance.now() - started), { inputMode: "text", signal: null });
      } catch (err) {
        error.textContent = err?.userMessage ?? "Die Antwort konnte gerade nicht gespeichert werden. Bitte versuche es noch einmal.";
        error.hidden = false;
        if (!err?.userMessage) console.error(err);
      } finally {
        busy = false;
        form.removeAttribute("aria-busy");
        if (form.isConnected) {
          for (const b of buttons) b.disabled = false;
          button.removeAttribute("aria-pressed");
        }
      }
    });
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  form.focusInput = () => buttons[0]?.focus({ preventScroll: false });
  return form;
}

/** Knopf "Sprechen": aufnehmen → lokal erkennen → Text zurückgeben. Fehler nur als Hinweis, nie als Absturz. */
function speechControl(speech, { onText, onBusy, onEvent = () => {} }) {
  const label = h("span", {}, "Sprechen");
  const button = h("button", { type: "button", class: "btn btn-secondary mic", "data-action": "record", "aria-pressed": "false" },
    icon("mic", { size: 18 }), label);
  const status = h("p", { class: "muted small speech-status", role: "status", "aria-live": "polite" });
  let recording = null;
  let timer = null;
  const reset = () => {
    clearInterval(timer);
    recording = null;
    button.disabled = false;
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("recording");
    label.textContent = "Sprechen";
    onBusy(false);
  };
  const finish = async () => {
    const current = recording;
    if (!current) return;
    clearInterval(timer);
    button.disabled = true;
    label.textContent = "Wird erkannt …";
    status.textContent = "Wird lokal erkannt …";
    onEvent("STOP");
    try {
      const wav = await current.stop();
      const result = await speech.transcribe(wav);
      if (!result.text) {
        status.textContent = "Nichts verstanden. Versuche es noch einmal oder tippe.";
        onEvent("STT_FAILED");
      } else {
        onText(result.text);
        onEvent("TRANSCRIBED");
        status.textContent = result.confidence < 0.5
          ? "Unsicher erkannt – bitte prüfe den Text, bevor du ihn abschickst."
          : "Erkannt. Du kannst den Text noch korrigieren.";
      }
    } catch (error) {
      onEvent("STT_FAILED");
      status.textContent = error?.code === "invalid_audio"
        ? `Die Aufnahme war nicht verwendbar (${error.message}).`
        : "Spracherkennung gerade nicht möglich. Bitte tippe deine Antwort.";
    } finally {
      reset();
    }
  };
  button.addEventListener("click", async () => {
    if (recording) {
      finish();
      return;
    }
    try {
      recording = await startRecording({ onLimit: finish });
    } catch (error) {
      recording = null;
      status.textContent = error?.name === "NotAllowedError"
        ? "Das Mikrofon ist nicht erlaubt. Du kannst deine Antwort tippen."
        : "Kein Mikrofon verfügbar. Du kannst deine Antwort tippen.";
      return;
    }
    onBusy(true);
    onEvent("RECORD");
    button.setAttribute("aria-pressed", "true");
    button.classList.add("recording");
    label.textContent = "Stopp";
    status.textContent = `Aufnahme läuft (höchstens ${MAX_SECONDS} s). Die Aufnahme bleibt auf diesem Gerät.`;
    timer = setInterval(() => { label.textContent = `Stopp (${Math.floor(recording?.seconds() ?? 0)} s)`; }, 500);
  });
  return { element: h("div", { class: "speech" }, button, status) };
}

// ---------------------------------------------------------------- Rückmeldung

const TONE_ICON = Object.freeze({ success: "check", error: "alert", info: "info", neutral: "info", warning: "alert" });

const AI_NOTES = Object.freeze({
  unavailable: "KI-Zusatzanalyse gerade nicht erreichbar – bewertet wurde mit den Regeln.",
  timeout: "KI-Zusatzanalyse hat zu lange gebraucht – bewertet wurde mit den Regeln.",
  invalid: "KI-Zusatzanalyse lieferte nichts Verwertbares – bewertet wurde mit den Regeln.",
  skipped: "KI-Zusatzhinweise übersprungen.",
});

export function feedbackPanel(feedback, { answerText, ai = null }) {
  const findings = (items) => h("ul", { class: "findings" }, items.map((item) => findingItem(item, feedback.labels)));
  const aiNote = ai ? AI_NOTES[ai.status] : null;
  return h("section", { class: `card feedback tone-${feedback.tone}`, "aria-labelledby": "feedback-title", "data-verdict": feedback.verdict },
    h("h2", { id: "feedback-title", class: "feedback-title", tabindex: "-1" }, icon(TONE_ICON[feedback.tone]), feedback.title),
    h("div", { class: "your-answer" }, h("span", { class: "label" }, feedback.input_mode === "speech" ? feedback.labels.you_said : feedback.labels.you_wrote),
      h("p", { lang: targetLang() }, answerText)),
    feedback.listening ? listeningFeedbackBlock(feedback.listening, feedback.labels) : null,
    feedback.message ? h("p", { class: "feedback-message" }, feedback.message) : null,
    feedback.primary.length ? findings(feedback.primary) : null,
    feedback.shown.length ? h("p", { class: "shown" }, icon("check", { size: 18 }), h("span", {}, feedback.labels.well_done, feedback.shown.join(" · "))) : null,
    feedback.secondary.length ? h("details", { class: "more" },
      h("summary", {}, `${feedback.labels.more_hints} (${feedback.secondary.reduce((s, g) => s + g.items.length, 0)})`),
      feedback.secondary.map((group) => h("div", { class: "group" }, h("h3", { class: "group-title" }, group.label), findings(group.items)))) : null,
    feedback.ai_hints?.length ? h("details", { class: "more ai-hints", "data-ai-hints": "" },
      h("summary", {}, `KI-Hinweise, unbestätigt (${feedback.ai_hints.length})`),
      h("p", { class: "muted small" }, "Lokales Sprachmodell. Ergänzung ohne Einfluss auf Bewertung und Lernstand."),
      findings(feedback.ai_hints)) : null,
    aiNote ? h("p", { class: "muted small ai-note", "data-ai-status": ai.status }, aiNote) : null,
    feedback.model_answer ? h("div", { class: "model" },
      h("span", { class: "label" }, feedback.verdict === "correct" ? feedback.labels.model_answer : feedback.labels.could_sound),
      h("p", { lang: targetLang() }, feedback.model_answer.text),
      feedback.model_answer.note_de ? h("p", { class: "muted small" }, feedback.model_answer.note_de) : null) : null,
    feedback.alternatives.length ? h("details", { class: "more" },
      h("summary", {}, feedback.labels.alternatives),
      h("ul", { class: "plain" }, feedback.alternatives.map((a) => h("li", {}, h("span", { lang: targetLang() }, a.text), a.note_de ? h("span", { class: "muted" }, ` – ${a.note_de}`) : null)))) : null,
    feedback.good_phrases.length ? h("details", { class: "more" },
      h("summary", {}, feedback.labels.phrases),
      h("ul", { class: "plain" }, feedback.good_phrases.map((p) => h("li", { lang: targetLang() }, p)))) : null,
    feedback.explanation_de ? h("p", { class: "muted" }, feedback.explanation_de) : null);
}

/** P15: Hör-Rückmeldung (verstanden?), getrennt von der Sprachrichtigkeit, danach das Transkript. */
function listeningFeedbackBlock(listening, labels) {
  return h("div", { class: `listening-feedback ${listening.understood ? "ok" : "open"}`, "data-understood": String(listening.understood) },
    h("h3", { class: "group-title" }, "🎧 ", listening.headline),
    h("p", {}, listening.text),
    listening.notes.map((note) => h("p", { class: "muted small" }, note)),
    listening.transcript ? h("details", { class: "more", open: true },
      h("summary", {}, labels.transcript),
      h("p", { lang: targetLang(), class: "transcript" }, listening.transcript),
      listening.source ? h("p", { class: "muted small" }, listening.source) : null) : null);
}

function findingItem(item, labels) {
  return h("li", { class: `finding sev-${item.severity}` },
    h("div", { class: "finding-head" },
      h("span", { class: `badge sev-badge sev-${item.severity}` }, item.severity_label),
      item.recurring ? h("span", { class: "badge badge-warning" }, icon("alert", { size: 14 }), labels.recurring) : null,
      item.supplemental ? h("span", { class: "badge" }, "KI") : null,
      item.title ? h("strong", {}, item.title) : null),
    item.original || item.suggestion ? h("p", { class: "finding-fix", lang: targetLang() },
      item.original ? h("del", {}, item.original) : null,
      item.original && item.suggestion ? h("span", { "aria-hidden": "true" }, " → ") : null,
      item.suggestion ? h("ins", {}, item.suggestion) : null) : null,
    item.explanation ? h("p", { class: "finding-why" }, item.explanation) : null);
}

// ---------------------------------------------------------------- Zustände

export function emptyState({ title, text, action = null }) {
  return h("div", { class: "empty" }, h("h2", {}, title), text ? h("p", { class: "muted" }, text) : null, action);
}

export function errorState({ title = "Das hat gerade nicht geklappt.", text, onRetry }) {
  return h("div", { class: "card error-state", role: "alert" },
    h("h2", {}, icon("alert"), title),
    text ? h("p", {}, text) : null,
    onRetry ? h("button", { type: "button", class: "btn btn-primary", onclick: onRetry }, "Erneut versuchen") : null);
}

export function loading(text = "Wird geladen …") {
  return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);
}

export function masteryText(level) {
  return MASTERY_LABELS[level] ?? level;
}

/**
 * Auswahldialog mit mehreren Möglichkeiten (natives <dialog>). Promise<value | null> (null = geschlossen).
 * @param {{title: string, text?: string, choices: {value: string, label: string, variant?: string}[]}} options
 */
export function choiceDialog({ title, text, choices }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "dialog-title", "data-dialog": "choice" },
      h("form", { method: "dialog" },
        h("h2", { id: "dialog-title" }, title),
        text ? h("p", {}, text) : null,
        h("div", { class: "dialog-actions dialog-choices" }, choices.map((c) =>
          h("button", { value: c.value, class: `btn btn-${c.variant ?? "secondary"}`, "data-choice": c.value }, c.label)))));
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue || null);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Bestätigungsdialog (natives <dialog>, per Tastatur bedienbar). Promise<boolean>. */
export function confirmDialog({ title, text, confirmLabel, cancelLabel = "Abbrechen", danger = false }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "dialog-title" },
      h("form", { method: "dialog" },
        h("h2", { id: "dialog-title" }, title),
        text ? h("p", {}, text) : null,
        h("div", { class: "dialog-actions" },
          h("button", { value: "cancel", class: "btn btn-secondary" }, cancelLabel),
          h("button", { value: "ok", class: `btn ${danger ? "btn-danger" : "btn-primary"}` }, confirmLabel))));
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok");
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
