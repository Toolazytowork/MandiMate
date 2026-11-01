import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, MapPin, Mic, Package, ShieldCheck, Truck } from 'lucide-react';
import { CertaintyBadge } from '@/components/domain';
import type { Certainty } from '@/types/api';
import { cn } from '@/lib/cn';
import { Tag } from '../primitives';
import { VisualFrame } from './RoleSections';

/* All figures below are illustrations of the product, never results. */

function Row({ label, value, certainty, strong }: { label: ReactNode; value: ReactNode; certainty?: Certainty; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className={cn('flex min-w-0 items-center gap-2 text-[13px]', strong ? 'font-medium text-ink' : 'text-muted')}>
        <span className="truncate">{label}</span>
        {certainty ? <CertaintyBadge certainty={certainty} size="sm" withTooltip={false} /> : null}
      </dt>
      <dd className={cn('shrink-0 tabular-nums', strong ? 'font-display text-lg text-ink' : 'text-[13px] text-ink/80')}>{value}</dd>
    </div>
  );
}

/* ─────────────────────────────── Farmer: net deal ─────────────────────────────── */

interface DealOption {
  id: 'a' | 'b';
  name: string;
  buyer: string;
  gross: string;
  grossTotal: string;
  lines: { id: string; label: string; value: string; certainty: Certainty }[];
  net: string;
  netPerKg: string;
  payment: string;
  best?: boolean;
}

const DEAL_OPTIONS: readonly DealOption[] = [
  {
    id: 'a',
    name: 'Offer A',
    buyer: 'Local trader · sell alone',
    gross: '\u2066₹14.00/kg\u2069',
    grossTotal: '₹5,600',
    lines: [
      { id: 'ownTransport', label: 'Own transport to mandi', value: '− ₹840', certainty: 'estimated' },
      { id: 'commission', label: 'Commission 6%', value: '− ₹336', certainty: 'confirmed' },
    ],
    net: '₹4,424',
    netPerKg: '\u2066₹11.06/kg\u2069',
    payment: 'Cash, same day',
  },
  {
    id: 'b',
    name: 'Offer B',
    buyer: 'Pooled sale · Grade A lot',
    gross: '\u2066₹16.00/kg\u2069',
    grossTotal: '₹6,400',
    lines: [
      { id: 'sharedTransport', label: 'Shared transport', value: '− ₹480', certainty: 'estimated' },
      { id: 'handling', label: 'Handling', value: '− ₹120', certainty: 'confirmed' },
      { id: 'rejection', label: 'Expected rejection 3%', value: '− ₹192', certainty: 'unresolved' },
    ],
    net: '₹5,608',
    netPerKg: '\u2066₹14.02/kg\u2069',
    payment: 'Bank transfer in 3 days',
    best: true,
  },
];

/** "What you take home" — two offers compared by net, with certainty on every deduction. */
export function NetDealCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  return (
    <VisualFrame
      className={className}
      label={t('visuals.deal.label', { defaultValue: '400 kg tomatoes · ready tomorrow' })}
      tag={<Tag tone="gold">{t('visuals.illustrative', { defaultValue: 'Illustrative' })}</Tag>}
      footer={
        <span className="flex items-center gap-2">
          <Lock aria-hidden="true" strokeWidth={1.25} className="size-3.5 shrink-0 text-forest-700" />
          {t('visuals.deal.privateMinimum', {
            defaultValue: 'Your minimum of {{price}} net is private — buyers never see it.',
            price: '\u2066₹13.50/kg\u2069',
          })}
        </span>
      }
    >
      <p className="text-[13px] text-muted">
        {t('visuals.deal.context', { defaultValue: 'Quality pending inspection · Kothapalli cluster' })}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {DEAL_OPTIONS.map((option) => (
          <div
            key={option.name}
            className={cn(
              'flex flex-col rounded-card border p-5',
              option.best ? 'border-ink/30 bg-paper' : 'border-line bg-ivory',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-ink">
                {t(`visuals.deal.options.${option.id}.name`, { defaultValue: option.name })}
              </p>
              {option.best ? <Tag tone="forest">{t('visuals.deal.higherNet', { defaultValue: 'Higher net' })}</Tag> : null}
            </div>
            <p className="mt-1 text-[12px] font-normal text-muted">
              {t(`visuals.deal.options.${option.id}.buyer`, { defaultValue: option.buyer })}
            </p>
            <dl className="mt-3 divide-y divide-line/70">
              <Row label={t('visuals.deal.gross', { defaultValue: 'Gross · {{price}}', price: option.gross })} value={option.grossTotal} />
              {option.lines.map((line) => (
                <Row
                  key={line.id}
                  label={t(`visuals.deal.lines.${line.id}`, { defaultValue: line.label })}
                  value={line.value}
                  certainty={line.certainty}
                />
              ))}
            </dl>
            <div className="mt-2 border-t border-ink/10 pt-3">
              <p className="text-[13px] font-semibold text-muted">{t('visuals.deal.takeHome', { defaultValue: 'You take home' })}</p>
              <p className="mt-1 font-display text-[1.875rem] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">{option.net}</p>
              <p className="mt-1.5 text-[12px] text-muted tabular-nums">
                {t('visuals.deal.netLine', {
                  defaultValue: '{{perKg}} net · {{payment}}',
                  perKg: option.netPerKg,
                  payment: t(`visuals.deal.options.${option.id}.payment`, { defaultValue: option.payment }),
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 border-s border-gold-500 ps-4 font-display text-[1.05rem] not-italic leading-snug text-gold-700">
        {t('visuals.deal.tradeoff', {
          defaultValue: 'Offer B pays {{more}} more, costs {{moveCost}} more to move, and pays three days later. You decide.',
          more: '\u2066₹2/kg\u2069',
          moveCost: '\u2066₹0.36/kg\u2069',
        })}
      </p>
    </VisualFrame>
  );
}

/* ─────────────────────────────── Farmer: voice listing ─────────────────────────────── */

const UTTERANCES = [
  { lang: 'తెలుగు', label: 'Telugu', text: 'రేపు ఉదయం 400 కిలోల టమాటాలు సిద్ధంగా ఉన్నాయి' },
  { lang: 'हिन्दी', label: 'Hindi', text: 'कल सुबह 400 किलो टमाटर तैयार हैं' },
  { lang: 'English', label: 'English', text: 'I have 400 kilos of tomatoes ready tomorrow morning' },
] as const;

/** A spoken sentence in three languages becoming one draft listing. */
export function VoiceDraftCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  return (
    <VisualFrame
      className={className}
      label={t('visuals.voice.label', { defaultValue: 'Voice listing · draft' })}
      tag={<Tag tone="neutral">{t('visuals.voice.tag', { defaultValue: 'You confirm every field' })}</Tag>}
    >
      <ul className="flex flex-col">
        {UTTERANCES.map((utterance) => (
          <li key={utterance.label} className="flex items-start gap-4 border-b border-line py-4 first:pt-0">
            <Mic aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gold-700">
                <span lang={utterance.label === 'Telugu' ? 'te' : utterance.label === 'Hindi' ? 'hi' : 'en'}>{utterance.lang}</span>
              </p>
              <p
                lang={utterance.label === 'Telugu' ? 'te' : utterance.label === 'Hindi' ? 'hi' : 'en'}
                className="mt-1 font-display text-[1.125rem] leading-snug text-ink"
              >
                “{utterance.text}”
              </p>
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 pt-2 sm:grid-cols-4">
        {[
          [t('visuals.voice.fields.crop', { defaultValue: 'Crop' }), t('visuals.voice.fields.cropValue', { defaultValue: 'Tomato' })],
          [t('visuals.voice.fields.quantity', { defaultValue: 'Quantity' }), '400 kg'],
          [t('visuals.voice.fields.ready', { defaultValue: 'Ready' }), t('visuals.voice.fields.readyValue', { defaultValue: 'Tomorrow, 6 am' })],
          [t('visuals.voice.fields.grade', { defaultValue: 'Grade' }), t('visuals.voice.fields.gradeValue', { defaultValue: 'Asked, not guessed' })],
        ].map(([term, value]) => (
          <div key={term} className="py-2">
            <dt className="text-[13px] text-muted">{term}</dt>
            <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </VisualFrame>
  );
}

/* ─────────────────────────────── Farmer: settlement ─────────────────────────────── */

const SETTLEMENT = [
  { id: 'consent', label: 'Consent given', detail: 'Mon, 6:40 pm', done: true },
  { id: 'pickedUp', label: 'Picked up · 400 kg weighed', detail: 'Tue, 6:15 am', done: true },
  { id: 'delivered', label: 'Delivered · 388 kg accepted, 12 kg rejected', detail: 'Tue, 9:50 am', done: true },
  { id: 'buyerPaid', label: 'Buyer payment received', detail: 'Expected Fri', done: false },
  { id: 'paidToYou', label: 'Paid to your bank', detail: 'Expected Fri', done: false },
] as const;

export function SettlementCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  return (
    <VisualFrame
      className={className}
      label={t('visuals.settlement.label', { defaultValue: 'Sale {{code}} · settlement', code: 'L-0412' })}
      tag={<Tag tone="gold">{t('visuals.illustrative', { defaultValue: 'Illustrative' })}</Tag>}
      footer={t('visuals.settlement.footer', {
        defaultValue: 'Every deduction is itemised against what you agreed. Disputes open from the same screen.',
      })}
    >
      <ol className="relative flex flex-col gap-4 ps-1">
        {SETTLEMENT.map((step, index) => (
          <li key={step.id} className="relative flex items-start gap-3.5">
            {index < SETTLEMENT.length - 1 ? (
              <span aria-hidden="true" className={cn('absolute start-[3px] top-4 h-[calc(100%+4px)] w-px', step.done ? 'bg-ink/30' : 'bg-line')} />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-[7px] size-[7px] shrink-0 rounded-full border',
                step.done ? 'border-forest-600 bg-forest-600' : 'border-gold-500 bg-paper',
              )}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-ink">
                {t(`visuals.settlement.steps.${step.id}.label`, { defaultValue: step.label })}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                <span className="sr-only">
                  {step.done
                    ? t('visuals.settlement.doneSr', { defaultValue: 'Done: ' })
                    : t('visuals.settlement.pendingSr', { defaultValue: 'Pending: ' })}
                </span>
                {t(`visuals.settlement.steps.${step.id}.detail`, { defaultValue: step.detail })}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <dt className="text-[13px] text-muted">{t('visuals.settlement.gross', { defaultValue: 'Gross' })}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">₹6,208</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">{t('visuals.settlement.netToYou', { defaultValue: 'Net to you' })}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">₹5,608</dd>
        </div>
      </dl>
    </VisualFrame>
  );
}

/* ─────────────────────────────── Buyer: lot specification ─────────────────────────────── */

const MEMBERS = [
  { name: 'Farmer 1', kg: 200, tone: 'bg-forest-800' },
  { name: 'Farmer 2', kg: 350, tone: 'bg-gold-600' },
  { name: 'Farmer 3', kg: 310, tone: 'bg-gold-400' },
  { name: 'Farmer 4', kg: 180, tone: 'bg-sand' },
] as const;

export function LotSpecCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  const total = MEMBERS.reduce((sum, member) => sum + member.kg, 0);
  return (
    <VisualFrame
      className={className}
      label={t('visuals.lotSpec.label', { defaultValue: 'Lot {{code}} · Tomato · Grade A', code: 'L-0412' })}
      tag={<Tag tone="forest">{t('visuals.lotSpec.tag', { defaultValue: 'Verified supply' })}</Tag>}
      footer={t('visuals.lotSpec.footer', {
        defaultValue: 'Pooled only from produce that meets the agreed specification. Nothing is combined silently.',
      })}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-[2.5rem] font-bold leading-none tracking-[-0.02em] tabular-nums">1,040 kg</p>
          <p className="mt-1.5 text-[13px] text-muted">
            {t('visuals.lotSpec.origin', { defaultValue: 'from {{farmers}} farmers · one collection point', farmers: MEMBERS.length })}
          </p>
        </div>
        <Package aria-hidden="true" strokeWidth={1.25} className="size-7 text-muted" />
      </div>
      <div className="mt-5" role="img" aria-label={t('visuals.lotSpec.compositionLabel', {
          defaultValue: 'Lot made of {{parts}}',
          parts: MEMBERS.map((m) => `${m.kg} kg`).join(', '),
        })}>
        <div className="flex h-1.5 overflow-hidden bg-parchment">
          {MEMBERS.map((member) => (
            <span key={member.name} className={cn('h-full', member.tone)} style={{ width: `${(member.kg / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11.5px] text-muted tabular-nums">
          {MEMBERS.map((member) => (
            <span key={member.name}>{member.kg} kg</span>
          ))}
        </div>
      </div>
      <dl className="mt-5 divide-y divide-line/70 border-t border-line">
        <Row label={t('visuals.lotSpec.size', { defaultValue: 'Size' })} value="55–65 mm" />
        <Row
          label={t('visuals.lotSpec.colour', { defaultValue: 'Colour' })}
          value={t('visuals.lotSpec.colourValue', { defaultValue: '≥ 80% red' })}
        />
        <Row label={t('visuals.lotSpec.defects', { defaultValue: 'Defects' })} value="≤ 3%" />
        <Row
          label={t('visuals.lotSpec.window', { defaultValue: 'Delivery window' })}
          value={t('visuals.lotSpec.windowValue', { defaultValue: 'Tue, 8–10 am' })}
        />
        <Row
          label={t('visuals.lotSpec.terms', { defaultValue: 'Payment terms' })}
          value={t('visuals.lotSpec.termsValue', { defaultValue: 'Net 7 days' })}
        />
      </dl>
    </VisualFrame>
  );
}

/* ─────────────────────────────── Buyer: quality record ─────────────────────────────── */

export function QualityRecordCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  return (
    <VisualFrame
      className={className}
      label={t('visuals.quality.label', { defaultValue: 'Delivery & quality record' })}
      tag={<Tag tone="gold">{t('visuals.illustrative', { defaultValue: 'Illustrative' })}</Tag>}
    >
      <dl className="divide-y divide-line/70">
        <Row label={t('visuals.quality.dispatched', { defaultValue: 'Dispatched (weighed at pickup)' })} value="1,040 kg" />
        <Row label={t('visuals.quality.received', { defaultValue: 'Received at your dock' })} value="1,032 kg" />
        <Row label={t('visuals.quality.accepted', { defaultValue: 'Accepted after inspection' })} value="1,004 kg" strong />
        <Row label={t('visuals.quality.rejected', { defaultValue: 'Rejected · bruising' })} value="28 kg" />
        <Row label={t('visuals.quality.shortage', { defaultValue: 'Transit shortage' })} value="8 kg" />
      </dl>
      <div className="mt-5 flex items-start gap-3 border-t border-line pt-4">
        <ShieldCheck aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-forest-600" />
        <p className="text-[13px] font-normal leading-snug text-ink-2">
          {t('visuals.quality.note', {
            defaultValue:
              'Inspector, photos and timestamps attached. Each farmer’s share of any rejection is traced to their own produce.',
          })}
        </p>
      </div>
    </VisualFrame>
  );
}

/* ─────────────────────────────── Transporter: route sheet ─────────────────────────────── */

const STOPS = [
  { id: 'kothapalli', place: 'Kothapalli', load: '320 kg', time: '6:10 am' },
  { id: 'rayavaram', place: 'Rayavaram', load: '410 kg', time: '6:45 am' },
  { id: 'peddaCheruvu', place: 'Pedda Cheruvu', load: '310 kg', time: '7:20 am' },
] as const;

export function RouteSheetCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  const capacity = 1500;
  const load = 1040;
  return (
    <VisualFrame
      className={className}
      label={t('visuals.route.label', { defaultValue: 'Pickup run · Tue' })}
      tag={<Tag tone="forest">{t('visuals.route.tag', { defaultValue: 'Stops confirmed' })}</Tag>}
      footer={t('visuals.route.footer', {
        defaultValue: 'Quote {{quote}} for the run · {{perKg}} · paid on delivery confirmation',
        quote: '₹1,250',
        perKg: '\u2066₹1.20/kg\u2069',
      })}
    >
      <ol className="flex flex-col">
        {STOPS.map((stop, index) => (
          <li key={stop.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-line/70 py-3">
            <span className="font-display text-[1.25rem] not-italic leading-none text-gold-700 tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {t(`visuals.route.stops.${stop.id}.place`, { defaultValue: stop.place })}
              </p>
              <p className="text-[12.5px] text-muted">{t('visuals.route.crated', { defaultValue: '{{load}} · crated', load: stop.load })}</p>
            </div>
            <span className="text-[13px] tabular-nums text-ink/80">
              {t(`visuals.route.stops.${stop.id}.time`, { defaultValue: stop.time })}
            </span>
          </li>
        ))}
        <li className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 py-3">
          <MapPin aria-hidden="true" strokeWidth={1.25} className="size-4 text-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{t('visuals.route.dock', { defaultValue: 'Buyer dock · Vijayawada' })}</p>
            <p className="text-[12.5px] text-muted">{t('visuals.route.distance', { defaultValue: '{{km}} km total · one drop', km: 58 })}</p>
          </div>
          <span className="text-[13px] tabular-nums text-ink/80">{t('visuals.route.arrival', { defaultValue: '9:30 am' })}</span>
        </li>
      </ol>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[12.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <Truck aria-hidden="true" strokeWidth={1.25} className="size-3.5" />{' '}
            {t('visuals.route.vehicle', { defaultValue: '{{tonnes}} t pickup', tonnes: 1.5 })}
          </span>
          <span className="tabular-nums">
            {load.toLocaleString('en-IN')} / {capacity.toLocaleString('en-IN')} kg
          </span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-parchment"
          role="progressbar"
          aria-label={t('visuals.route.capacityLabel', { defaultValue: 'Vehicle capacity used' })}
          aria-valuemin={0}
          aria-valuemax={capacity}
          aria-valuenow={load}
        >
          <span className="block h-full rounded-full bg-ink/70" style={{ width: `${(load / capacity) * 100}%` }} />
        </div>
      </div>
    </VisualFrame>
  );
}

/* ─────────────────────────────── FPO: cluster ledger ─────────────────────────────── */

const LEDGER = [
  { id: 'paid', lot: 'L-0398', state: 'Paid to farmers', amount: '₹58,240', tone: 'text-forest-600' },
  { id: 'awaiting', lot: 'L-0405', state: 'Awaiting buyer · due 30 Oct', amount: '₹41,900', tone: 'text-gold-700' },
  { id: 'delivered', lot: 'L-0412', state: 'Delivered · quality recorded', amount: '₹16,064', tone: 'text-ink/70' },
] as const;

export function FpoLedgerCard({ className }: { className?: string }) {
  const { t } = useTranslation('marketingRoles');
  return (
    <VisualFrame
      className={className}
      label={t('visuals.ledger.label', { defaultValue: 'Cluster desk · this week' })}
      tag={<Tag tone="gold">{t('visuals.illustrative', { defaultValue: 'Illustrative' })}</Tag>}
    >
      <dl className="grid grid-cols-3 gap-3 border-b border-line pb-5">
        {[
          ['18', t('visuals.ledger.farmers', { defaultValue: 'farmers on board' })],
          ['6', t('visuals.ledger.assisted', { defaultValue: 'assisted listings' })],
          ['3', t('visuals.ledger.lots', { defaultValue: 'lots in progress' })],
        ].map(([value, label]) => (
          <div key={label} className="border-s border-line ps-3 first:border-s-0 first:ps-0">
            <dd className="font-display text-[2rem] font-bold leading-none tabular-nums text-ink">{value}</dd>
            <dt className="mt-2 text-[12px] font-medium leading-tight text-muted">{label}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-[13px] font-semibold text-muted">{t('visuals.ledger.settlements', { defaultValue: 'Settlements' })}</p>
      <ul className="mt-1 divide-y divide-line/70">
        {LEDGER.map((row) => (
          <li key={row.lot} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium tabular-nums text-ink">{row.lot}</p>
              <p className={cn('truncate text-[12.5px]', row.tone)}>
                {t(`visuals.ledger.states.${row.id}`, { defaultValue: row.state })}
              </p>
            </div>
            <span className="shrink-0 font-display text-xl font-bold tabular-nums text-ink">{row.amount}</span>
          </li>
        ))}
      </ul>
    </VisualFrame>
  );
}
