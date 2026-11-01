import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, CircleAlert, ImagePlus, Info, RotateCcw, Trash, X } from 'lucide-react';
import { Button, IconButton, Progress } from '@/components/ui';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import type { HarvestPhoto } from '@/types/api';

export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type PhotoProblem = 'type' | 'size';

/** Why a file cannot be uploaded (`null` when it is fine). Mirrors the API's limits. */
export function validatePhoto(file: Pick<File, 'type' | 'size'>, maxBytes = MAX_PHOTO_BYTES): PhotoProblem | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size > maxBytes) return 'size';
  return null;
}

interface PendingUpload {
  key: string;
  file: File;
  previewUrl: string;
  /** 0..100, or `null` while the uploader has not reported progress. */
  progress: number | null;
  error: string | null;
}

export interface PhotoUploaderProps {
  /** Photos already saved on the harvest (with their analysis). */
  photos?: readonly HarvestPhoto[];
  /**
   * Uploads one file. Report progress with `onProgress(0..100)` when the transport allows it;
   * resolve with the saved photo so it shows immediately, before the harvest is refetched.
   */
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<HarvestPhoto | void>;
  onRemove?: (photo: HarvestPhoto) => Promise<unknown> | void;
  maxFiles?: number;
  maxBytes?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Drag-and-drop or camera capture (on phones) for harvest photos, with previews and upload progress.
 * Saved photos show the preliminary analysis — visible characteristics only, always with the
 * disclaimer that grade, weight and freshness are decided at inspection.
 */
export function PhotoUploader({
  photos = [],
  onUpload,
  onRemove,
  maxFiles = 6,
  maxBytes = MAX_PHOTO_BYTES,
  disabled = false,
  className,
}: PhotoUploaderProps) {
  const { t } = useTranslation('domain');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [recent, setRecent] = useState<HarvestPhoto[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const saved = [...photos, ...recent.filter((photo) => !photos.some((existing) => existing.id === photo.id))];
  const remaining = Math.max(0, maxFiles - saved.length - pending.length);
  const blocked = disabled || remaining === 0;

  const dropPending = (key: string) => {
    setPending((items) => {
      const item = items.find((candidate) => candidate.key === key);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrls.current.delete(item.previewUrl);
      }
      return items.filter((candidate) => candidate.key !== key);
    });
  };

  const upload = async (item: PendingUpload) => {
    const update = (patch: Partial<PendingUpload>) =>
      setPending((items) => items.map((candidate) => (candidate.key === item.key ? { ...candidate, ...patch } : candidate)));
    update({ error: null, progress: null });
    try {
      const photo = await onUpload(item.file, (percent) => update({ progress: Math.min(100, Math.max(0, percent)) }));
      if (photo) setRecent((items) => [...items, photo]);
      dropPending(item.key);
    } catch (error) {
      update({ error: isApiError(error) ? error.detail : t('common:errors.generic'), progress: null });
    }
  };

  const addFiles = (files: readonly File[]) => {
    if (blocked) return;
    const messages: string[] = [];
    const accepted: PendingUpload[] = [];
    for (const file of files) {
      const problem = validatePhoto(file, maxBytes);
      if (problem) {
        messages.push(`${file.name}: ${problem === 'type' ? t('common:errors.unsupportedFile') : t('common:errors.fileTooLarge')}`);
        continue;
      }
      if (accepted.length >= remaining) {
        messages.push(t('photos.limit', { count: maxFiles }));
        break;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      accepted.push({ key: `${file.name}-${file.size}-${file.lastModified}-${previewUrl}`, file, previewUrl, progress: null, error: null });
    }
    setProblems(messages);
    if (accepted.length === 0) return;
    setPending((items) => [...items, ...accepted]);
    for (const item of accepted) void upload(item);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const remove = async (photo: HarvestPhoto) => {
    if (!onRemove) return;
    setRemoving(photo.id);
    try {
      await onRemove(photo);
      setRecent((items) => items.filter((item) => item.id !== photo.id));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col items-center gap-5 rounded-card border border-dashed px-6 py-12 text-center transition-colors duration-200',
          dragging ? 'border-gold-500 bg-gold-50/60' : 'border-ink/25 bg-paper',
          blocked && 'opacity-60',
        )}
      >
        <span aria-hidden="true" className="text-muted">
          <ImagePlus strokeWidth={1.25} className="size-7" />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-h3 font-bold text-ink">{t('photos.title')}</p>
          <p id={hintId} className="text-sm font-normal text-ink-2">
            {remaining === 0 ? t('photos.limit', { count: maxFiles }) : t('photos.hint', { count: maxFiles })}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {coarsePointer ? (
            <Button
              variant="primary"
              onClick={() => cameraInputRef.current?.click()}
              disabled={blocked}
              aria-describedby={hintId}
              leadingIcon={<Camera aria-hidden="true" strokeWidth={1.25} />}
            >
              {t('common:actions.takePhoto')}
            </Button>
          ) : null}
          <Button
            variant={coarsePointer ? 'secondary' : 'primary'}
            onClick={() => fileInputRef.current?.click()}
            disabled={blocked}
            aria-describedby={hintId}
            leadingIcon={<ImagePlus aria-hidden="true" strokeWidth={1.25} />}
          >
            {t('common:actions.uploadPhoto')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_PHOTO_TYPES.join(',')}
          multiple
          hidden
          onChange={onInputChange}
        />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onInputChange} />
      </div>

      {problems.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1 rounded-sm border-s border-danger/60 bg-paper px-4 py-3 text-sm text-danger-ink">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <CircleAlert aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0" />
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      {pending.length > 0 || saved.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((item) => (
            <li key={item.key} className="flex flex-col overflow-hidden rounded-card border border-line bg-paper">
              <div className="relative aspect-[4/3] bg-parchment">
                <img src={item.previewUrl} alt={t('photos.previewAlt', { name: item.file.name })} className="size-full object-cover opacity-80" />
                {item.error ? null : (
                  <span className="absolute inset-x-3 bottom-3">
                    <Progress
                      value={item.progress ?? undefined}
                      size="sm"
                      tone="gold"
                      label={t('photos.uploading', { name: item.file.name })}
                      valueText={item.progress === null ? undefined : `${Math.round(item.progress)}%`}
                    />
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                {item.error ? (
                  <>
                    <span className="flex min-w-0 items-start gap-1.5 text-danger-ink">
                      <CircleAlert aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0">{item.error}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <IconButton label={t('common:actions.retry')} icon={<RotateCcw strokeWidth={1.25} />} size="sm" onClick={() => void upload(item)} />
                      <IconButton label={t('common:actions.remove')} icon={<X strokeWidth={1.25} />} size="sm" onClick={() => dropPending(item.key)} />
                    </span>
                  </>
                ) : (
                  <span className="text-muted" aria-live="polite">
                    {t('common:states.sending')}
                  </span>
                )}
              </div>
            </li>
          ))}
          {saved.map((photo, index) => (
            <li key={photo.id} className="flex flex-col overflow-hidden rounded-card border border-line bg-paper">
              <div className="relative aspect-[4/3] bg-parchment">
                <img src={photo.url} alt={t('photos.savedAlt', { number: index + 1 })} loading="lazy" className="size-full object-cover" />
                {onRemove ? (
                  <IconButton
                    label={t('photos.remove', { number: index + 1 })}
                    icon={<Trash strokeWidth={1.25} />}
                    size="sm"
                    variant="secondary"
                    loading={removing === photo.id}
                    disabled={disabled || removing !== null}
                    onClick={() => void remove(photo)}
                    className="absolute end-3 top-3"
                  />
                ) : null}
              </div>
              {photo.analysis ? (
                <div className="flex flex-col gap-3 px-4 py-4">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full border border-ink/15"
                      style={{ backgroundColor: photo.analysis.dominant_color_hex }}
                    />
                    {t('photos.observations')}
                  </p>
                  <ul className="flex list-disc flex-col gap-1 ps-4 text-sm font-normal text-ink-2 marker:text-gold-600">
                    {photo.analysis.observations.map((observation) => (
                      <li key={observation}>{observation}</li>
                    ))}
                  </ul>
                  <p className="flex items-start gap-1.5 border-t border-line pt-3 text-xs leading-relaxed text-muted">
                    <Info aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-3.5 shrink-0" />
                    {photo.analysis.disclaimer}
                  </p>
                </div>
              ) : (
                <p className="px-4 py-3 text-xs text-muted">{t('photos.noAnalysis')}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
