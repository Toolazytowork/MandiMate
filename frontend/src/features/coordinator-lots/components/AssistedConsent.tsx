import { PhoneCall } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog, Quantity, type ConsentEntry } from '@/components/domain';
import { Button, Field, Textarea } from '@/components/ui';
import type { ConsentRequest } from '@/types/api';

export interface AssistedConsentProps {
  entry: ConsentEntry;
  /** What the farmer is agreeing to, e.g. "join LOT-123" or "₹28/kg from FreshMart". */
  subject: string;
  onRecord: (req: ConsentRequest) => Promise<unknown>;
  busy?: boolean;
}

/**
 * Coordinator records a farmer's yes/no on their behalf (farmer confirmed by phone or in person).
 * The API audit-logs every assisted consent; we ask for how it was confirmed.
 */
export function AssistedConsent({ entry, subject, onRecord, busy }: AssistedConsentProps) {
  const { t } = useTranslation('coordinatorLots');
  const [decision, setDecision] = useState<ConsentRequest['decision'] | null>(null);
  const [note, setNote] = useState('');

  if (entry.decision !== 'pending') return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDecision('accepted')}>
        {t('consent.recordYes', { defaultValue: 'Record yes' })}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDecision('declined')}>
        {t('consent.recordNo', { defaultValue: 'Record no' })}
      </Button>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNote('');
          }
        }}
        tone={decision === 'declined' ? 'danger' : 'primary'}
        title={
          decision === 'accepted'
            ? t('consent.yesTitle', { defaultValue: '{{name}} agrees', name: entry.farmerName })
            : t('consent.noTitle', { defaultValue: '{{name}} declines', name: entry.farmerName })
        }
        description={
          <span className="flex items-start gap-2">
            <PhoneCall strokeWidth={1.25} aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
            <span>
              {t('consent.assistedBody', {
                defaultValue: 'Assisted consent for {{subject}}. Recorded in the audit log under your name — only do this when the farmer has told you directly.',
                subject,
              })}{' '}
              (<Quantity kg={entry.quantityKg} size="sm" />)
            </span>
          </span>
        }
        confirmLabel={
          decision === 'accepted'
            ? t('consent.confirmYes', { defaultValue: 'Record agreement' })
            : t('consent.confirmNo', { defaultValue: 'Record decline' })
        }
        onConfirm={() => (decision ? onRecord({ decision, note: note.trim() || null }) : undefined)}
      >
        <Field
          label={t('consent.note', { defaultValue: 'How did the farmer confirm?' })}
          hint={t('consent.noteHint', { defaultValue: 'e.g. “Phone call, 10:40, spoke to Lakshmi”' })}
          optional
        >
          <Textarea rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
