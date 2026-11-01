import { Trans, useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { AudioLines, Calculator, Handshake } from 'lucide-react';
import { Reveal } from '@/components/motion';
import { CheckList, Em, Numeral, Section, SectionHeader } from '../primitives';

interface Pillar {
  id: 'understanding' | 'rules' | 'people';
  label: string;
  title: string;
  icon: LucideIcon;
  does: readonly string[];
  never: string;
}

const PILLARS: readonly Pillar[] = [
  {
    id: 'understanding',
    label: 'AI for understanding',
    title: 'Voice, languages, photos, messy details',
    icon: AudioLines,
    does: [
      '“I have 400 kilos of tomatoes ready tomorrow” becomes a draft listing',
      'Explains trade-offs between offers in plain words',
      'Asks for what is missing instead of guessing',
    ],
    never: 'Never sets a price, a cost or a grade.',
  },
  {
    id: 'rules',
    label: 'Rules for decisions',
    title: 'Compatibility, costs, net returns',
    icon: Calculator,
    does: [
      'Explicit rules decide which harvests can be pooled',
      'Transport priced from vehicle rates and real quotes',
      'One published formula for every net-earnings figure',
    ],
    never: 'Never a black box — every line can be checked.',
  },
  {
    id: 'people',
    label: 'People for trust',
    title: 'Verification, inspection, consent',
    icon: Handshake,
    does: [
      'Coordinators verify buyers, transporters and harvests',
      'Quality is accepted on inspection, not from a photo',
      'Each farmer accepts or declines; disputes have an owner',
    ],
    never: 'Never a sale without the farmer’s explicit yes.',
  },
];

/** The AI philosophy: AI for understanding, rules for decisions, people for trust. */
export function AiSection() {
  const { t } = useTranslation('marketingHome');
  return (
    <Section id="ai" tone="dark" labelledBy="ai-title" contours="basin">
      <SectionHeader
        id="ai-title"
        layout="split"
        eyebrow={t('ai.eyebrow', { defaultValue: 'How we use AI' })}
        title={
          <Trans
            t={t}
            i18nKey="ai.title"
            defaults="AI to understand. Rules to decide. People to <em>trust</em>."
            components={{ em: <Em>{null}</Em> }}
          />
        }
        lead={t('ai.lead', {
          defaultValue:
            'MandiMate is not “an AI platform for farmers”. AI listens and explains; arithmetic and explicit rules make the decisions; people verify, inspect and consent.',
        })}
      />
      <div className="mt-20 grid gap-px border-y border-white/10 bg-white/10 lg:grid-cols-3">
        {PILLARS.map((pillar, index) => {
          const Icon = pillar.icon;
          return (
            <Reveal
              as="article"
              key={pillar.label}
              delay={index * 0.08}
              className="flex flex-col bg-forest-900 px-1 py-10 sm:px-8"
            >
              <div className="flex items-center justify-between">
                <Numeral value={index + 1} className="text-[2rem] leading-none" />
                <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-ivory/45" />
              </div>
              <p className="eyebrow mt-8">{t(`ai.pillars.${pillar.id}.label`, { defaultValue: pillar.label })}</p>
              <h3 className="mt-3 font-display text-[1.6rem] font-bold leading-snug tracking-[-0.01em] text-ivory">
                {t(`ai.pillars.${pillar.id}.title`, { defaultValue: pillar.title })}
              </h3>
              <CheckList
                dense
                className="mb-8 mt-6 text-ivory/75"
                items={pillar.does.map((item, itemIndex) =>
                  t(`ai.pillars.${pillar.id}.does.${itemIndex}`, { defaultValue: item }),
                )}
              />
              <p className="mt-auto border-t border-white/10 pt-5 font-display text-[1.05rem] not-italic text-gold-400">
                {t(`ai.pillars.${pillar.id}.never`, { defaultValue: pillar.never })}
              </p>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
