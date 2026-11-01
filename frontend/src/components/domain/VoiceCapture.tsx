import { useId, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Mic, RotateCcw, Square } from 'lucide-react';
import { Button, Textarea } from '@/components/ui';
import { SPEECH_LANGS, useIsClient, useSpeechRecognition } from '@/lib/hooks';
import { LANGUAGES } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { Language } from '@/types/api';

/** Joins two pieces of dictated text with a single space. */
function joinText(base: string, addition: string): string {
  return [base.trim(), addition.trim()].filter(Boolean).join(' ');
}

export interface VoiceCaptureProps {
  /** Language the farmer speaks; picks the recogniser locale (en-IN / hi-IN / te-IN) and the example. */
  language: Language;
  /** Called with the edited transcript. */
  onSubmit: (transcript: string) => void;
  /** The submitted transcript is being processed (e.g. `POST /ai/voice-listing`). */
  submitting?: boolean;
  submitLabel?: ReactNode;
  defaultTranscript?: string;
  className?: string;
}

/**
 * Speak-to-list: a round green microphone with a thin green ring pulsing while listening, the live
 * transcript as it is recognised, and an editable final text. Browsers without the Web Speech API
 * (or with the microphone blocked) fall back to typing — nothing is lost.
 */
export function VoiceCapture({ language, onSubmit, submitting = false, submitLabel, defaultTranscript = '', className }: VoiceCaptureProps) {
  const { t, i18n } = useTranslation('domain');
  const isClient = useIsClient();
  const reduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const [text, setText] = useState(defaultTranscript);
  const [typing, setTyping] = useState(false);
  const speech = useSpeechRecognition({
    lang: SPEECH_LANGS[language],
    onFinal: (final) => setText((current) => joinText(current, final)),
  });

  const unsupported = isClient && (!speech.supported || speech.error === 'not-allowed' || speech.error === 'service-not-allowed');
  const typeOnly = typing || unsupported;
  const shown = speech.listening ? joinText(text, speech.transcript) : text;
  const languageName = LANGUAGES.find((option) => option.code === language)?.native ?? language;
  const example = i18n.getFixedT(language, 'domain')('voice.example');

  const status = speech.listening
    ? t('common:speech.listening')
    : speech.error
      ? t(`common:speech.errors.${speech.error}`)
      : t('common:speech.tapToSpeak');

  const switchToTyping = () => {
    if (speech.listening) speech.stop();
    setTyping(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {typeOnly ? (
        unsupported ? (
          <p role="status" className="rounded-sm border-s border-gold-500/70 bg-paper px-4 py-3 text-sm text-ink-2">
            {speech.error ? t(`common:speech.errors.${speech.error}`) : t('common:speech.notSupported')}
          </p>
        ) : null
      ) : (
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="eyebrow inline-flex items-center gap-2">
            {t('voice.speakIn', { language: languageName })}
          </p>
          <div className="relative grid size-40 place-items-center">
            {speech.listening
              ? [0, 1].map((ring) => (
                  <motion.span
                    key={ring}
                    aria-hidden="true"
                    className="absolute inset-6 rounded-sm border border-gold-500/70"
                    initial={{ scale: 1, opacity: 0.7 }}
                    animate={reduceMotion ? { scale: 1.2, opacity: 0.4 } : { scale: [1, 1.4], opacity: [0.7, 0] }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 2.4, ease: 'easeOut', repeat: Infinity, delay: ring * 1.2 }}
                  />
                ))
              : null}
            <button
              type="button"
              onClick={speech.listening ? speech.stop : speech.start}
              disabled={!isClient || submitting}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? t('common:actions.stopListening') : t('common:actions.startSpeaking')}
              className={cn(
                'relative grid size-28 place-items-center rounded-sm border border-gold-500/50 bg-forest-900 text-gold-400 transition-colors duration-300 ease-luxe hover:bg-forest-800 disabled:opacity-60',
                speech.listening && 'border-gold-400',
              )}
            >
              {speech.listening ? (
                <Square aria-hidden="true" strokeWidth={1.25} className="size-8" />
              ) : (
                <Mic aria-hidden="true" strokeWidth={1.25} className="size-11" />
              )}
            </button>
          </div>
          <p aria-live="polite" className={cn('min-h-6 text-[13px] font-semibold', speech.error ? 'text-danger-ink' : 'text-ink')}>
            {status}
          </p>
          {!speech.listening && !shown ? <p className="max-w-md font-display text-lg font-bold not-italic leading-relaxed text-ink-2">{example}</p> : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor={textareaId} className="text-[13px] font-semibold text-ink">
          {typeOnly ? t('voice.typeLabel') : t('voice.transcriptLabel')}
        </label>
        <Textarea
          ref={textareaRef}
          id={textareaId}
          value={shown}
          readOnly={speech.listening}
          onChange={(event) => setText(event.target.value)}
          placeholder={typeOnly ? example : t('voice.transcriptPlaceholder')}
          rows={4}
          lang={language}
          className={cn('text-base', speech.listening && 'border-gold-500/70')}
        />
        {speech.listening && speech.interim ? (
          <p aria-live="polite" className="text-sm not-italic text-muted">
            <span className="sr-only">{t('common:speech.heard')}: </span>
            {speech.interim}
          </p>
        ) : null}
        <p className="text-xs text-muted">{t('voice.reviewHint')}</p>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {!typeOnly ? (
            <Button variant="ghost" size="sm" onClick={switchToTyping} leadingIcon={<Keyboard aria-hidden="true" strokeWidth={1.25} />}>
              {t('common:actions.typeInstead')}
            </Button>
          ) : null}
          {shown ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                speech.abort();
                speech.reset();
                setText('');
              }}
              disabled={submitting}
              leadingIcon={<RotateCcw aria-hidden="true" strokeWidth={1.25} />}
            >
              {t('voice.clear')}
            </Button>
          ) : null}
        </div>
        <Button
          size="lg"
          onClick={() => onSubmit(shown.trim())}
          disabled={!shown.trim() || speech.listening}
          loading={submitting}
          fullWidth
          className="sm:w-auto"
        >
          {submitLabel ?? t('voice.submit')}
        </Button>
      </div>
    </div>
  );
}
