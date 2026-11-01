import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowRight, Minus, Plus } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { cn } from '@/lib/cn';
import { CheckList, Em, Numeral, Section, SectionHeader, type SectionTone } from '../primitives';

/** `<em>` slot for `<Trans components={{ em: <RoleEm /> }}>`: Trans fills in the translated children. */
export function RoleEm({ children }: { children?: ReactNode }) {
  return <Em>{children}</Em>;
}

/* ─────────────────────────────── Feature grid ─────────────────────────────── */

export interface RoleFeature {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
}

/** Editorial hairline grid: numeral, plain icon, bold title, quiet body. Works on light and dark sections. */
export function FeatureGrid({
  features,
  columns = 3,
  className,
}: {
  features: readonly RoleFeature[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-2 lg:grid-cols-3', 4: 'md:grid-cols-2 xl:grid-cols-4' } as const;
  return (
    <ul className={cn('grid gap-x-10 border-t border-(--hairline)', cols[columns], className)}>
      {features.map((feature, index) => {
        const Icon = feature.icon;
        return (
          <Reveal
            as="li"
            key={feature.title}
            delay={index * 0.06}
            className="group relative flex flex-col border-b border-(--hairline) py-9"
          >
            <div className="flex items-start justify-between gap-4">
              <Numeral value={index + 1} className="text-[1.75rem] leading-none" />
              <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-muted [.surface-dark_&]:text-ivory/45" />
            </div>
            <h3 className="mt-8 font-display text-[1.5rem] font-bold leading-[1.15] tracking-[-0.015em]">{feature.title}</h3>
            <p className="mt-3 text-[15px] font-normal leading-relaxed text-ink-2 [.surface-dark_&]:text-(--fg-muted)">{feature.body}</p>
          </Reveal>
        );
      })}
    </ul>
  );
}

/* ─────────────────────────────── Chapter ─────────────────────────────── */

export interface ChapterProps {
  id: string;
  tone?: SectionTone;
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  points?: readonly ReactNode[];
  /** The visual column (a card, a figure). */
  visual: ReactNode;
  /** Put the visual on the left on wide screens. */
  reverse?: boolean;
  rule?: boolean;
  footnote?: ReactNode;
}

/** A two-column editorial chapter: argument on one side, evidence on the other. */
export function Chapter({ id, tone = 'ivory', eyebrow, title, lead, points, visual, reverse = false, rule, footnote }: ChapterProps) {
  const headingId = `${id}-title`;
  return (
    <Section id={id} tone={tone} labelledBy={headingId} rule={rule}>
      <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className={cn('flex flex-col gap-8 lg:col-span-6', reverse && 'lg:order-2')}>
          <SectionHeader id={headingId} eyebrow={eyebrow} title={title} lead={lead} />
          {points?.length ? <CheckList items={points} /> : null}
          {footnote}
        </div>
        <Reveal className={cn('lg:col-span-6', reverse && 'lg:order-1')}>{visual}</Reveal>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Step rail ─────────────────────────────── */

export interface RoleStep {
  title: string;
  body: ReactNode;
}

/** Numbered steps divided by hairlines — reads as a quiet itinerary. */
export function StepRail({ steps, className }: { steps: readonly RoleStep[]; className?: string }) {
  return (
    <ol className={cn('grid gap-x-10 border-t border-(--hairline) md:grid-cols-2', className)}>
      {steps.map((step, index) => (
        <Reveal
          as="li"
          key={step.title}
          delay={(index % 2) * 0.06}
          className="grid grid-cols-[3.25rem_1fr] gap-4 border-b border-(--hairline) py-7 sm:grid-cols-[4rem_1fr] sm:py-8"
        >
          <Numeral value={index + 1} className="text-[2rem] leading-none" />
          <div className="min-w-0">
            <h3 className="font-display text-[1.4rem] font-bold leading-snug tracking-[-0.01em]">{step.title}</h3>
            <p className="mt-2 text-[15px] font-normal leading-relaxed text-ink-2 [.surface-dark_&]:text-(--fg-muted)">{step.body}</p>
          </div>
        </Reveal>
      ))}
    </ol>
  );
}

/* ─────────────────────────────── Ledger strip ─────────────────────────────── */

/** Short facts separated by hairlines, e.g. "₹0 · to list a harvest". */
export function FactStrip({ facts, className }: { facts: readonly { value: ReactNode; label: ReactNode }[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 border-y border-(--hairline) lg:grid-cols-4 [&>div]:border-(--hairline) [&>div:nth-child(odd)]:border-e lg:[&>div]:border-e lg:[&>div:last-child]:border-e-0 [&>div:nth-child(-n+2)]:border-b lg:[&>div:nth-child(-n+2)]:border-b-0',
        className,
      )}
    >
      {facts.map((fact, index) => (
        <div key={index} className="flex flex-col-reverse gap-2 px-4 py-7 first:ps-0 sm:px-6 lg:py-9">
          <dt className="text-[13px] font-medium leading-snug text-muted [.surface-dark_&]:text-(--fg-muted)">{fact.label}</dt>
          <dd className="font-display text-[2rem] font-bold leading-none tracking-[-0.02em] sm:text-[2.5rem]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─────────────────────────────── FAQ ─────────────────────────────── */

export interface RoleFaq {
  question: string;
  answer: string;
}

/** Native disclosure list — keyboard and screen-reader friendly with no script. */
export function FaqList({ items, className }: { items: readonly RoleFaq[]; className?: string }) {
  return (
    <div className={cn('border-t border-(--hairline)', className)}>
      {items.map((item) => (
        <details key={item.question} className="group border-b border-(--hairline)">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-7 text-start font-display text-xl font-bold leading-snug tracking-[-0.01em] transition-colors hover:text-gold-700 sm:text-[1.5rem] [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            <span aria-hidden="true" className="mt-1 shrink-0 text-gold-700 [.surface-dark_&]:text-gold-400">
              <Plus strokeWidth={1.25} className="size-5 group-open:hidden" />
              <Minus strokeWidth={1.25} className="hidden size-5 group-open:block" />
            </span>
          </summary>
          <p className="max-w-measure pb-8 pe-12 text-[15px] font-normal leading-relaxed text-ink-2 [.surface-dark_&]:text-(--fg-muted)">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** FAQ section with a split header. */
export function FaqSection({ id, title, items, tone = 'ivory' }: { id: string; title: ReactNode; items: readonly RoleFaq[]; tone?: SectionTone }) {
  const { t } = useTranslation('marketingRoles');
  const headingId = `${id}-title`;
  return (
    <Section id={id} tone={tone} labelledBy={headingId} rule>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionHeader id={headingId} eyebrow={t('sections.faq.eyebrow', { defaultValue: 'Questions' })} title={title} className="lg:sticky lg:top-28" />
        </div>
        <FaqList items={items} className="lg:col-span-8" />
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Closing CTA ─────────────────────────────── */

export interface ClosingCtaProps {
  role: 'farmer' | 'buyer' | 'transporter' | 'coordinator';
  eyebrow?: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  primaryLabel: string;
  secondary?: { label: string; to: string };
}

/** Dark closing panel with the role's sign-up action. */
export function ClosingCta({ role, eyebrow, title, lead, primaryLabel, secondary }: ClosingCtaProps) {
  const { t } = useTranslation('marketingRoles');
  const headingId = `cta-${role}-title`;
  return (
    <Section tone="dark" labelledBy={headingId} contours="valley">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <SectionHeader
          id={headingId}
          eyebrow={eyebrow ?? t('sections.cta.eyebrow', { defaultValue: 'Begin' })}
          title={title}
          lead={lead}
          layout="center"
        />
        <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <LinkButton
            to={`/signup?role=${role}`}
            variant="inverse"
            size="lg"
           
            trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}
          >
            {primaryLabel}
          </LinkButton>
          {secondary ? (
            <LinkButton
              to={secondary.to}
              variant="glass"
              size="lg"
             
            >
              {secondary.label}
            </LinkButton>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Visual frame ─────────────────────────────── */

/** Paper panel for product-like illustrations; fixed colours so it reads on any section tone. */
export function VisualFrame({
  label,
  tag,
  children,
  footer,
  className,
}: {
  label: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        'relative overflow-hidden rounded-panel border border-line bg-paper text-ink shadow-luxe-sm',
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-6 py-5 sm:px-8">
        <span className="text-[13px] font-semibold text-gold-700">{label}</span>
        {tag}
      </figcaption>
      <div className="px-6 py-6 sm:px-8 sm:py-7">{children}</div>
      {footer ? <div className="border-t border-line px-6 py-4 text-[12.5px] font-normal leading-snug text-muted sm:px-8">{footer}</div> : null}
    </figure>
  );
}

/* ─────────────────────────────── Role chooser CTA ─────────────────────────────── */

const ROLE_LINKS = [
  { role: 'farmer', label: 'I grow produce', note: 'Free, always' },
  { role: 'buyer', label: 'I buy produce', note: 'Fee per sourced lot' },
  { role: 'transporter', label: 'I move produce', note: 'Free to quote' },
  { role: 'coordinator', label: 'I run an FPO', note: 'Pilot plans' },
] as const;

/** Dark closing panel that lets each kind of visitor sign up with their role preset. */
export function RoleChooserCta({ id, eyebrow, title, lead }: { id: string; eyebrow?: ReactNode; title: ReactNode; lead: ReactNode }) {
  const { t } = useTranslation('marketingRoles');
  const headingId = `${id}-title`;
  return (
    <Section id={id} tone="dark" labelledBy={headingId} contours="valley">
      <SectionHeader
        id={headingId}
        eyebrow={eyebrow ?? t('sections.cta.eyebrow', { defaultValue: 'Begin' })}
        title={title}
        lead={lead}
        layout="split"
      />
      <ul className="mt-16 grid gap-px border-y border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {ROLE_LINKS.map((link) => (
          <li key={link.role}>
            <Link
              to={`/signup?role=${link.role}`}
              className="group flex h-full items-center justify-between gap-4 bg-forest-900 px-1 py-8 transition-colors duration-300 hover:bg-forest-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring) sm:px-6"
            >
              <span className="min-w-0">
                <span className="block font-display text-[1.5rem] font-bold leading-snug text-ivory">{t(`sections.roleChooser.${link.role}.label`, { defaultValue: link.label })}</span>
                <span className="mt-2 block text-[13px] font-semibold text-ivory/55">{t(`sections.roleChooser.${link.role}.note`, { defaultValue: link.note })}</span>
              </span>
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.25}
                className="size-5 shrink-0 text-gold-400 transition-transform duration-300 group-hover:translate-x-1"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
