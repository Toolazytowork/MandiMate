import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Building2, Sprout, Truck, Users } from 'lucide-react';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { CheckList, Em, Numeral, Section, SectionHeader } from '../primitives';

interface Role {
  id: 'farmers' | 'buyers' | 'transporters' | 'fpos';
  to: string;
  name: string;
  icon: LucideIcon;
  pitch: string;
  points: readonly string[];
}

const ROLES: readonly Role[] = [
  {
    id: 'farmers',
    to: '/farmers',
    name: 'Farmers',
    icon: Sprout,
    pitch: 'Sell a small harvest on the terms of a big one.',
    points: ['List by voice, photo or text', 'See net earnings before you agree', 'Free — and nothing sells without your yes'],
  },
  {
    id: 'buyers',
    to: '/buyers',
    name: 'Buyers',
    icon: Building2,
    pitch: 'Source consistent volume from verified farm groups.',
    points: ['Post a requirement once', 'Offer on graded, pooled lots', 'Record delivery and quality in one place'],
  },
  {
    id: 'transporters',
    to: '/transporters',
    name: 'Transporters',
    icon: Truck,
    pitch: 'Fuller trucks on planned routes.',
    points: ['Pickup requests with weights and stops', 'Quote on consolidated loads', 'Confirm pickup and delivery in the app'],
  },
  {
    id: 'fpos',
    to: '/fpos',
    name: 'FPOs & coordinators',
    icon: Users,
    pitch: 'Run aggregation with records farmers can trust.',
    points: ['Register and assist farmers', 'Verify harvests and organise collections', 'Track settlements and resolve disputes'],
  },
];

/** Who MandiMate serves: one card per role, each linking to its page. */
export function RolesSection() {
  const { t } = useTranslation('marketingHome');
  return (
    <Section id="roles" tone="parchment" labelledBy="roles-title" rule>
      <SectionHeader
        id="roles-title"
        layout="split"
        eyebrow={t('roles.eyebrow', { defaultValue: 'Built for everyone in the deal' })}
        title={
          <Trans
            t={t}
            i18nKey="roles.title"
            defaults="One workflow. <em>Four</em> people who need it to work."
            components={{ em: <Em>{null}</Em> }}
          />
        }
        lead={t('roles.lead', {
          defaultValue:
            'A pooled sale only works when farmers, buyers, transporters and coordinators see the same facts. MandiMate gives each of them the view they need — and the farmer the final say.',
        })}
      />
      <StaggerGroup as="ul" className="mt-20 grid gap-px border-y border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((role, index) => {
          const Icon = role.icon;
          const name = t(`roles.items.${role.id}.name`, { defaultValue: role.name });
          return (
            <StaggerItem as="li" key={role.to} className="h-full">
              <Link
                to={role.to}
                className="group flex h-full flex-col bg-parchment px-1 py-10 transition-colors duration-500 ease-luxe hover:bg-paper sm:px-7"
              >
                <div className="flex items-start justify-between">
                  <Numeral value={index + 1} className="text-[1.75rem] leading-none" />
                  <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-muted" />
                </div>
                <h3 className="mt-10 font-display text-[1.75rem] font-bold leading-tight tracking-[-0.01em] text-ink">{name}</h3>
                <p className="mt-3 text-[14.5px] font-normal leading-relaxed text-ink-2">{t(`roles.items.${role.id}.pitch`, { defaultValue: role.pitch })}</p>
                <span aria-hidden="true" className="hairline my-6 [--hairline:var(--color-line)]" />
                <CheckList
                  dense
                  items={role.points.map((point, pointIndex) =>
                    t(`roles.items.${role.id}.points.${pointIndex}`, { defaultValue: point }),
                  )}
                />
                <span className="mt-auto inline-flex items-center gap-2 self-start pt-8 text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-700">
                  <span className="border-b border-current pb-1">
                    {t(`roles.items.${role.id}.link`, { defaultValue: `MandiMate for ${role.name.toLowerCase()}` })}
                  </span>
                  <ArrowUpRight aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                </span>
              </Link>
            </StaggerItem>
          );
        })}
      </StaggerGroup>
    </Section>
  );
}
