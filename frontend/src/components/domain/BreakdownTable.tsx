import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui';
import { DURATION, EASE_LUXE } from '@/components/motion';
import { cn } from '@/lib/cn';
import type { NetProceeds } from '@/types/api';
import { CertaintyBadge, CertaintyLegend } from './Certainty';
import { Money } from './Money';

export interface BreakdownTableProps {
  data: NetProceeds;
  /** Show the certainty legend as the caption (default true). */
  showLegend?: boolean;
  className?: string;
}

/**
 * Every line from gross to net — amount, ₹/kg, how sure it is and the engine's note — ending in
 * the total deductions and the net the farmer takes home.
 */
export function BreakdownTable({ data, showLegend = true, className }: BreakdownTableProps) {
  const { t } = useTranslation('domain');
  const deductionsPerKg = data.quantity_kg > 0 ? data.total_deductions / data.quantity_kg : 0;
  const netPositive = data.net_amount >= 0;

  return (
    <Table framed={false} containerClassName={cn('-mx-1', className)} className="min-w-[30rem] sm:min-w-0">
      {showLegend ? (
        <TableCaption className="px-1 pt-4">
          <CertaintyLegend compact />
        </TableCaption>
      ) : null}
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="bg-transparent">{t('breakdown.item')}</TableHead>
          <TableHead className="hidden bg-transparent sm:table-cell">{t('breakdown.certainty')}</TableHead>
          <TableHead align="right" className="bg-transparent">
            {t('breakdown.perKg')}
          </TableHead>
          <TableHead align="right" className="bg-transparent">
            {t('breakdown.amount')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.lines.map((line) => (
          <TableRow key={line.key}>
            <TableCell className="py-3">
              <div className="flex flex-col gap-1">
                <span className="text-ink">
                  {t(`common:enums.breakdownKey.${line.key}`, { defaultValue: line.label })}
                </span>
                {line.note ? <span className="text-xs leading-snug text-muted">{line.note}</span> : null}
                <CertaintyBadge certainty={line.certainty} size="sm" withTooltip={false} className="mt-0.5 self-start sm:hidden" />
              </div>
            </TableCell>
            <TableCell className="hidden py-3 sm:table-cell">
              <CertaintyBadge certainty={line.certainty} size="sm" withTooltip={false} />
            </TableCell>
            <TableCell numeric className="py-3">
              <Money value={line.per_kg} perKg size="sm" tone={line.amount === 0 ? 'muted' : 'default'} className="font-normal" />
            </TableCell>
            <TableCell numeric className="py-3">
              <Money value={line.amount} size="sm" decimals={2} tone={line.amount === 0 ? 'muted' : 'default'} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className="bg-transparent">
        <TableRow className="hover:bg-transparent">
          <TableCell className="py-3 text-[13px] font-semibold text-muted">{t('common:money.totalDeductions')}</TableCell>
          <TableCell className="hidden sm:table-cell" />
          <TableCell numeric className="py-3">
            <Money value={-deductionsPerKg} perKg size="sm" className="font-normal" />
          </TableCell>
          <TableCell numeric className="py-3">
            <Money value={-data.total_deductions} size="sm" decimals={2} />
          </TableCell>
        </TableRow>
        <TableRow className="bg-transparent hover:bg-transparent [&>td]:border-t-ink/30">
          <TableCell className="py-5 font-display text-[19px] font-bold text-ink">{t('proceeds.netToYou')}</TableCell>
          <TableCell className="hidden sm:table-cell">
            <CertaintyBadge certainty={data.confidence} size="sm" withTooltip={false} />
          </TableCell>
          <TableCell numeric className="py-5">
            <Money value={data.net_per_kg} perKg size="sm" className={cn('font-medium', netPositive && 'text-forest-700')} />
          </TableCell>
          <TableCell numeric className="py-5">
            <Money value={data.net_amount} size="lg" decimals={2} className={cn(netPositive && 'text-ink')} />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export interface BreakdownDisclosureProps {
  data: NetProceeds;
  defaultExpanded?: boolean;
  showLegend?: boolean;
  className?: string;
}

/** "Show the full breakdown" toggle that slides the BreakdownTable open. */
export function BreakdownDisclosure({ data, defaultExpanded = false, showLegend = true, className }: BreakdownDisclosureProps) {
  const { t } = useTranslation('domain');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const regionId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((open) => !open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm text-[13px] font-semibold text-ink transition-colors hover:text-gold-700"
      >
        <span>{expanded ? t('proceeds.hideBreakdown') : t('proceeds.showBreakdown')}</span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.25}
          className={cn('size-4 transition-transform duration-300 ease-luxe', expanded && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="breakdown"
            id={regionId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.overlay, ease: EASE_LUXE }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <BreakdownTable data={data} showLegend={showLegend} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
