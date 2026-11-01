import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Language } from '@/types/api';

/* Minimal Web Speech API typings (not part of TypeScript's DOM lib). */

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type SpeechLang = 'en-IN' | 'hi-IN' | 'te-IN' | 'kn-IN' | 'ur-IN';

export const SPEECH_LANGS: Record<Language, SpeechLang> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ur: 'ur-IN' };

/** Browser error codes plus `unsupported` when the API is missing. */
export type SpeechErrorCode =
  | 'unsupported'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'language-not-supported'
  | 'bad-grammar';

const KNOWN_ERRORS = new Set<string>([
  'not-allowed',
  'service-not-allowed',
  'no-speech',
  'audio-capture',
  'network',
  'aborted',
  'language-not-supported',
  'bad-grammar',
]);

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export interface UseSpeechRecognitionOptions {
  lang?: SpeechLang;
  /** Keep listening across pauses until `stop()` (default true). */
  continuous?: boolean;
  /** Called once per session with the final transcript when listening ends. */
  onFinal?: (transcript: string) => void;
}

export interface SpeechRecognitionState {
  /** `false` during SSR/hydration and in browsers without the Web Speech API. */
  supported: boolean;
  listening: boolean;
  /** Finalised text of the current session. */
  transcript: string;
  /** Words still being recognised (not yet final). */
  interim: string;
  error: SpeechErrorCode | null;
  start: () => void;
  stop: () => void;
  /** Stops immediately, discarding pending audio. */
  abort: () => void;
  /** Clears transcript, interim text and error. */
  reset: () => void;
}

/** Web Speech API wrapper for voice listing in English, Hindi, Telugu, Kannada and Urdu (Indian locales). */
export function useSpeechRecognition({
  lang = 'en-IN',
  continuous = true,
  onFinal,
}: UseSpeechRecognitionOptions = {}): SpeechRecognitionState {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognitionConstructor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechErrorCode | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setError('unsupported');
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    finalRef.current = '';
    setTranscript('');
    setInterim('');
    setError(null);

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
          finalRef.current = `${finalRef.current} ${text}`.replace(/\s+/g, ' ').trim();
        } else {
          pending += text;
        }
      }
      setTranscript(finalRef.current);
      setInterim(pending.trim());
    };
    recognition.onerror = (event) => {
      setError(KNOWN_ERRORS.has(event.error) ? (event.error as SpeechErrorCode) : 'network');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
      if (finalRef.current) onFinalRef.current?.(finalRef.current);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setError('not-allowed');
    }
  }, [lang, continuous]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    recognitionRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    finalRef.current = '';
    setTranscript('');
    setInterim('');
    setError(null);
  }, []);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.abort();
        recognitionRef.current = null;
      }
    },
    [],
  );

  return { supported, listening, transcript, interim, error, start, stop, abort, reset };
}
