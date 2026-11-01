import { useTranslation } from 'react-i18next';
import { ArrowRight, Camera, Clock3, HandCoins, Inbox, Mic, Plus, Sprout, TrendingUp, Wallet } from 'lucide-react';

import { LinkButton } from '@/components/ui';
import {
  ActionList,
  ActivityFeed,
  CertaintyBadge,
  CropGlyph,
  Delta,
  KpiStrip,
  Money,
  PageHeader,
  QueryState,
  SectionCard,
  SellingOptionsCompare,
  StatusBadge,
  type KpiItem,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { useAuth } from '@/lib/auth';
import { Seo } from '@/lib/seo';
import type { FarmerDashboard } from '@/types/api';

import { DealAdvicePanel } from '@/features/farmer/components/DealAdvicePanel';
import { OptionActions } from '@/features/farmer/components/OptionActions';
import { Dot, HeroSurface, SectionHeading } from '@/features/farmer/components/Surfaces';
import { useFarmerDashboard } from '@/features/farmer/hooks';
import { dayPeriod, firstName, longDate } from '@/features/farmer/lib';
import { useHarvestWords } from '@/features/farmer/useHarvestWords';

export default function FarmerHomePage() {
  const { t } = useTranslation('farmer');
  const { user } = useAuth();
  const words = useHarvestWords();
  const dashboard = useFarmerDashboard();
  const name = firstName(user?.full_name);
  const period = dayPeriod();
  const greetings = {
    morning: t('home.morning', { defaultValue: 'Good morning, {{name}}', name }),
    afternoon: t('home.afternoon', { defaultValue: 'Good afternoon, {{name}}', name }),
    evening: t('home.evening', { defaultValue: 'Good evening, {{name}}', name }),
  };

  return (
    <div className="flex flex-col gap-10 pb-24 md:gap-14 md:pb-0">
      <Seo
        title={t('home.seoTitle', { defaultValue: 'Your farm today' })}
        description={t('home.seoDescription', { defaultValue: 'Your current harvest, the best offer by net earnings and what needs your attention.' })}
        path="/app/farmer"
        noindex
      />
      <PageHeader
        eyebrow={longDate(new Date(), words.lang)}
        title={name ? greetings[period] : t('home.title', { defaultValue: 'Your farm today' })}
        description={t('home.lede', { defaultValue: 'What your harvest can earn today, counted as money that reaches your hand.' })}
        actions={
          <>
            <LinkButton to="/app/farmer/harvests/new?voice=1" variant="secondary" size="lg" leadingIcon={<Mic className="size-5" strokeWidth={1.25} />}>
              {t('home.speak', { defaultValue: 'Speak to list' })}
            </LinkButton>
            <LinkButton to="/app/farmer/harvests/new" size="lg" leadingIcon={<Plus className="size-5" strokeWidth={1.25} />}>
              {t('home.list', { defaultValue: 'List a harvest' })}
            </LinkButton>
          </>
        }
      />

      <QueryState query={dashboard} skeleton="detail" errorTitle={t('home.error', { defaultValue: 'Your farm could not load' })}>
        {(data) => <HomeBody data={data} />}
      </QueryState>
    </div>
  );
}

function HomeBody({ data }: { data: FarmerDashboard }) {
  const { t } = useTranslation('farmer');
  const words = useHarvestWords();
  const harvest = data.current_harvest;
  const options = data.selling_options;
  const best = options?.options.find((option) => option.option_id === options.best_option_id) ?? options?.options[0];

  const kpis: KpiItem[] = [
    {
      id: 'earned',
      label: t('home.kpiEarned', { defaultValue: 'Earned this season (net)' }),
      value: <Money value={data.stats.season_net_earnings} size="lg" />,
      icon: <Wallet strokeWidth={1.25} />,
    },
    {
      id: 'uplift',
      label: t('home.kpiUplift', { defaultValue: 'More than the mandi, per kg' }),
      value: data.stats.avg_uplift_per_kg !== null ? <Delta value={data.stats.avg_uplift_per_kg} perKg size="md" /> : '—',
      icon: <TrendingUp strokeWidth={1.25} />,
      hint: t('home.kpiUpliftHint', { defaultValue: 'Average, after all costs' }),
    },
    {
      id: 'offers',
      label: t('home.kpiOffers', { defaultValue: 'Open offers' }),
      value: data.stats.open_offers,
      icon: <Inbox strokeWidth={1.25} />,
      hint: data.stats.pending_consents
        ? t('home.kpiConsents', { defaultValue: '{{count}} need your yes or no', count: data.stats.pending_consents })
        : undefined,
    },
    {
      id: 'pending',
      label: t('home.kpiPending', { defaultValue: 'Money on the way' }),
      value: <Money value={data.stats.pending_payments} size="lg" />,
      icon: <HandCoins strokeWidth={1.25} />,
    },
  ];

  return (
    <>
      <Reveal>
        {harvest ? (
          <HeroSurface aria-labelledby="current-harvest" className="p-6 sm:p-10 md:p-12">
            <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                  <CropGlyph name={harvest.crop_name} size="lg" />
                  <div>
                    <p className="eyebrow eyebrow-rule">{t('home.currentHarvest', { defaultValue: 'Your current harvest' })}</p>
                    <StatusBadge kind="harvest" value={harvest.status} size="sm" className="mt-2" />
                  </div>
                </div>
                <h2 id="current-harvest" className="font-display text-display-sm font-bold leading-[1.05] text-ivory md:text-display-md">
                  {words.title(harvest)}
                </h2>
                <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-normal text-ivory/75">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 aria-hidden="true" strokeWidth={1.25} className="size-4 text-ivory/60" />
                    {words.ready(harvest.available_from)}
                  </span>
                  <Dot />
                  <span>{words.quality(harvest.quality_status)}</span>
                  <Dot />
                  <span>{words.sellBy(harvest.sell_by)}</span>
                </p>
              </div>

              {best ? (
                <div className="flex flex-col gap-3 border-t border-white/15 pt-6 md:border-s md:border-t-0 md:ps-10 md:pt-0">
                  <p className="text-[13px] font-semibold text-gold-400">{t('home.bestNet', { defaultValue: 'Best option — you take home' })}</p>
                  <Money value={best.net_amount} size="hero" className="font-display font-bold text-ivory" />
                  <p className="text-sm text-ivory/70">
                    <Money value={best.net_per_kg} perKg size="sm" className="text-ivory" /> {t('options.net', { defaultValue: 'net' })}
                    <span aria-hidden="true"> · </span>
                    <Money value={best.gross_price_per_kg} perKg size="sm" className="text-ivory/60" /> {t('options.gross', { defaultValue: 'gross' })}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <CertaintyBadge certainty={best.confidence} withTooltip />
                    {options?.uplift_vs_baseline_per_kg ? (
                      <span className="text-sm text-ivory/80">
                        <Delta value={options.uplift_vs_baseline_per_kg} perKg size="sm" />{' '}
                        {t('home.vsMandi', { defaultValue: 'vs selling alone at the mandi' })}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-[15px] font-normal leading-relaxed text-ivory/75">
                  {t('home.noOptions', { defaultValue: 'Offers will appear here as buyers respond. We compare each one with selling alone at the mandi.' })}
                </p>
              )}
            </div>
            <div className="mt-10 flex flex-wrap gap-3">
              <LinkButton to={`/app/farmer/harvests/${harvest.id}`} variant="inverse" size="lg" trailingIcon={<ArrowRight className="size-4" strokeWidth={1.25} />}>
                {t('home.openHarvest', { defaultValue: 'See this harvest' })}
              </LinkButton>
              {harvest.photos.length === 0 ? (
                <LinkButton to={`/app/farmer/harvests/${harvest.id}#photos`} variant="glass" size="lg" leadingIcon={<Camera className="size-4" strokeWidth={1.25} />}>
                  {t('home.addPhotos', { defaultValue: 'Add photos' })}
                </LinkButton>
              ) : null}
            </div>
          </HeroSurface>
        ) : (
          <HeroSurface aria-labelledby="no-harvest" className="p-6 sm:p-10 md:p-12">
            <div className="flex max-w-xl flex-col gap-5">
              <Sprout aria-hidden="true" strokeWidth={1.25} className="size-7 text-gold-400" />
              <h2 id="no-harvest" className="font-display text-display-sm font-bold text-ivory">
                {t('home.emptyTitle', { defaultValue: 'Nothing listed right now' })}
              </h2>
              <p className="text-[15px] font-normal leading-relaxed text-ivory/75">
                {t('home.emptyBody', { defaultValue: 'Tell us what you harvested. We find buyers, pool small lots together and show what you take home before you agree.' })}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <LinkButton to="/app/farmer/harvests/new?voice=1" variant="inverse" size="lg" leadingIcon={<Mic className="size-5" strokeWidth={1.25} />}>
                  {t('home.speak', { defaultValue: 'Speak to list' })}
                </LinkButton>
                <LinkButton to="/app/farmer/harvests/new" variant="glass" size="lg">
                  {t('home.useForm', { defaultValue: 'Fill a form instead' })}
                </LinkButton>
              </div>
            </div>
          </HeroSurface>
        )}
      </Reveal>

      {harvest && options && options.options.length > 0 ? (
        <section aria-labelledby="options-heading" className="flex flex-col gap-6">
          <SectionHeading
            id="options-heading"
            eyebrow={t('home.optionsEyebrow', { defaultValue: 'Selling options' })}
            title={t('home.optionsTitle', { defaultValue: 'Where your harvest earns the most' })}
            description={t('home.optionsBody', {
              defaultValue: 'Compared by what reaches your hand — after transport, loading, commission, rejection and the wait for payment.',
            })}
          />
          <SellingOptionsCompare data={options} renderActions={(option) => <OptionActions option={option} harvestId={harvest.id} />} />
          <DealAdvicePanel harvestId={harvest.id} />
        </section>
      ) : null}

      <section aria-label={t('home.seasonLabel', { defaultValue: 'Your season' })}>
        <KpiStrip items={kpis} columns={4} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <SectionCard
          eyebrow={t('home.todoEyebrow', { defaultValue: 'To do' })}
          title={t('home.todoTitle', { defaultValue: 'Needs your attention' })}
        >
          <ActionList
            items={data.action_items}
            limit={6}
            emptyTitle={t('home.todoEmpty', { defaultValue: 'All clear' })}
            emptyDescription={t('home.todoEmptyBody', { defaultValue: 'Nothing waits on you right now. We will tell you when an offer arrives.' })}
          />
        </SectionCard>
        <SectionCard
          eyebrow={t('home.activityEyebrow', { defaultValue: 'Recently' })}
          title={t('home.activityTitle', { defaultValue: 'What happened' })}
        >
          <ActivityFeed
            items={data.recent_activity}
            limit={6}
            emptyTitle={t('home.activityEmpty', { defaultValue: 'No activity yet' })}
          />
        </SectionCard>
      </div>
    </>
  );
}
