import { useTranslation } from 'react-i18next';
import { ScanEye } from 'lucide-react';

import type { HarvestPhoto } from '@/types/api';

/** What the photo check noticed, with its honest disclaimer — never presented as a grade. */
export function PhotoNotes({ photos }: { photos: readonly HarvestPhoto[] }) {
  const { t } = useTranslation('farmer');
  const analysed = photos.filter((photo) => photo.analysis);
  if (analysed.length === 0) return null;
  const disclaimer = analysed[0]?.analysis?.disclaimer;

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-5" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <ScanEye aria-hidden="true" strokeWidth={1.25} className="size-4 text-muted" />
        {t('photos.notesTitle', { defaultValue: 'What the photo check noticed' })}
      </p>
      <ul className="flex flex-col gap-3">
        {analysed.map((photo) => (
          <li key={photo.id} className="flex gap-3">
            <img src={photo.url} alt="" className="size-14 shrink-0 rounded-sm border border-line object-cover" loading="lazy" />
            <div className="min-w-0 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span
                  aria-hidden="true"
                  className="inline-block size-3 rounded-full border border-line"
                  style={{ backgroundColor: photo.analysis?.dominant_color_hex }}
                />
                {t('photos.uniformity', {
                  defaultValue: 'Evenness {{value}}%',
                  value: Math.round((photo.analysis?.uniformity ?? 0) * 100),
                })}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-ink">
                {(photo.analysis?.observations ?? []).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
      {disclaimer ? <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">{disclaimer}</p> : null}
    </div>
  );
}
