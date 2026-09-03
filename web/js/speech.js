// Voice input, via the browser's Web Speech API.
//
// This is the one piece of FinApp that has no offline equivalent on the web.
// Safari sends the audio to Apple's servers for transcription — the same
// pipeline Siri dictation uses — so unlike the native app, speaking a purchase
// does leave the device. Everything after transcription (parsing, storing,
// totalling) still happens here in the browser.
//
// Support is uneven, which is why the typed box next to the microphone is not
// a fallback bolted on: it is the same input path, and it is always there.

const Recognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
  : undefined;

export function isSupported() {
  return typeof Recognition === 'function';
}

/**
 * Browsers where the microphone will appear and then do nothing.
 *
 * Every browser on iOS is Safari underneath — Apple requires WebKit, and as of
 * 2026 nobody has shipped an alternative engine even where the EU permits one.
 * So Chrome, Firefox and Edge on an iPhone render this app identically. What
 * they do not get is dictation: in a non-Safari web view
 * `webkitSpeechRecognition` is still *exposed* but never delivers a result
 * (WebKit bug 239816). Feature detection therefore answers yes and the button
 * is dead, which is the worst of the three possible answers.
 *
 * Hence the one user-agent sniff in this codebase. It only warns — the button
 * stays live, because a sniff that is wrong should cost a sentence of text,
 * not a working feature.
 *
 * @returns {string|null} what to warn about, or null when there is nothing to say.
 */
export function dictationCaveat(userAgent = globalThis.navigator?.userAgent ?? '') {
  // These tokens exist only on iOS; the desktop builds of the same browsers
  // are real Chrome and real Firefox, where dictation works properly.
  const shell = /\b(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)\b/.exec(userAgent);
  if (!shell) return null;

  const name = {
    CriOS: 'Chrome', FxiOS: 'Firefox', EdgiOS: 'Edge',
    OPiOS: 'Opera', DuckDuckGo: 'DuckDuckGo'
  }[shell[1]];

  return `Dictation does not work in ${name} on iPhone — iOS only gives the microphone`
    + ' to Safari itself. Everything else here works the same; type the sentence below,'
    + ' or use a screenshot.';
}

/** Languages the recogniser is offered. Parsing is English-only — see docs. */
export const LANGUAGES = [
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'pt-PT', label: 'Português (Portugal)' },
  { tag: 'es-ES', label: 'Español' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'de-DE', label: 'Deutsch' },
  { tag: 'it-IT', label: 'Italiano' }
];

const MESSAGES = {
  'not-allowed': 'Microphone access was refused. Allow it in Settings → Safari → Microphone.',
  'service-not-allowed': 'This browser would not start dictation. Type the purchase instead.',
  'audio-capture': 'No microphone was found.',
  'no-speech': "I didn't hear anything.",
  network: 'Dictation needs a connection — it is transcribed on Apple’s servers, not on your phone.',
  'language-not-supported': 'That language is not available for dictation here.',
  aborted: null
};

/**
 * One dictation session.
 *
 * Deliberately single-shot rather than continuous: `continuous` is unreliable
 * on iOS and a purchase is one sentence anyway.
 */
export class Dictation {
  constructor() {
    this.recognition = null;
    this.listening = false;
  }

  /**
   * @param {object} handlers
   * @param {(text: string) => void} handlers.onPartial
   * @param {(text: string) => void} handlers.onFinal called once, with the
   *   best transcript, whether the engine ended it or the user tapped stop
   * @param {(message: string) => void} handlers.onError
   * @param {() => void} handlers.onEnd
   * @param {string} language BCP 47 tag
   */
  start(language, handlers) {
    if (!isSupported()) {
      handlers.onError?.('This browser cannot do voice input. Type the purchase instead.');
      return false;
    }
    this.stop();

    const recognition = new Recognition();
    recognition.lang = language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let best = '';
    let delivered = false;

    const deliver = () => {
      if (delivered) return;
      delivered = true;
      if (best.trim()) handlers.onFinal?.(best.trim());
    };

    recognition.onresult = (event) => {
      let text = '';
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }
      best = text;
      handlers.onPartial?.(text);
    };

    recognition.onerror = (event) => {
      const message = Object.hasOwn(MESSAGES, event.error)
        ? MESSAGES[event.error]
        : `Dictation failed (${event.error}).`;
      // A "no-speech" error after a good partial result still has a usable
      // transcript, so deliver before reporting.
      if (best.trim()) deliver();
      else if (message) handlers.onError?.(message);
    };

    recognition.onend = () => {
      this.listening = false;
      this.recognition = null;
      deliver();
      handlers.onEnd?.();
    };

    try {
      recognition.start();
    } catch {
      // Usually a second `start()` before the first session finished.
      handlers.onError?.('Dictation could not start. Try again.');
      return false;
    }

    this.recognition = recognition;
    this.listening = true;
    return true;
  }

  stop() {
    if (!this.recognition) return;
    try {
      // `stop` finalises what was heard; `abort` would throw it away.
      this.recognition.stop();
    } catch {
      /* already stopped */
    }
  }
}
