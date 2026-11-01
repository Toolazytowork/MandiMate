import { useTranslation } from 'react-i18next';

import { Quantity } from '@/components/domain';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { DeliveryRecord } from '@/types/api';

export function DeliveryRecordView({ record }: { record: DeliveryRecord }) {
  const { t } = useTranslation('buyerOrders');
  return (
    <div className="space-y-5">
      <p className="text-small text-muted">
        {t('record.meta', {
          defaultValue: 'Recorded by {{by}} on {{at}}',
          by: record.recorded_by_name,
          at: formatDateTime(record.recorded_at),
        })}
        {record.inspector_name ? ` · ${t('record.inspector', { defaultValue: 'Inspector: {{name}}', name: record.inspector_name })}` : ''}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('record.farmer', { defaultValue: 'Farmer' })}</TableHead>
              <TableHead className="text-end">{t('record.dispatched', { defaultValue: 'Dispatched' })}</TableHead>
              <TableHead className="text-end">{t('record.delivered', { defaultValue: 'Delivered' })}</TableHead>
              <TableHead className="text-end">{t('record.accepted', { defaultValue: 'Accepted' })}</TableHead>
              <TableHead className="text-end">{t('record.rejected', { defaultValue: 'Rejected' })}</TableHead>
              <TableHead className="text-end">{t('record.shortage', { defaultValue: 'Shortage' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {record.items.map((item) => (
              <TableRow key={item.member_id}>
                <TableCell>
                  <span className="font-medium text-ink">{item.farmer_name}</span>
                  {item.rejection_reason ? <span className="mt-0.5 block text-micro text-danger-ink">{item.rejection_reason}</span> : null}
                </TableCell>
                <TableCell className="text-end tabular-nums"><Quantity kg={item.dispatched_kg} /></TableCell>
                <TableCell className="text-end tabular-nums"><Quantity kg={item.delivered_kg} /></TableCell>
                <TableCell className="text-end tabular-nums text-forest-800"><Quantity kg={item.accepted_kg} /></TableCell>
                <TableCell className="text-end tabular-nums">{item.rejected_kg > 0 ? <Quantity kg={item.rejected_kg} className="text-danger-ink" /> : '—'}</TableCell>
                <TableCell className="text-end tabular-nums">{item.shortage_kg > 0 ? <Quantity kg={item.shortage_kg} className="text-warning-ink" /> : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">{t('record.total', { defaultValue: 'Total' })}</TableCell>
              <TableCell className="text-end tabular-nums"><Quantity kg={record.total_dispatched_kg} /></TableCell>
              <TableCell className="text-end tabular-nums"><Quantity kg={record.total_delivered_kg} /></TableCell>
              <TableCell className="text-end tabular-nums font-medium text-forest-800"><Quantity kg={record.total_accepted_kg} /></TableCell>
              <TableCell className="text-end tabular-nums"><Quantity kg={record.total_rejected_kg} /></TableCell>
              <TableCell className="text-end tabular-nums"><Quantity kg={record.total_shortage_kg} /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {record.notes ? <p className="border-s border-gold-700/40 ps-5 font-display text-body not-italic text-ink-2">{record.notes}</p> : null}
    </div>
  );
}
