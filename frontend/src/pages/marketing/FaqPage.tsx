import { useTranslation } from 'react-i18next';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Section } from '@/components/marketing/primitives';
import { FAQ_GROUPS, FAQ_ITEMS, FaqAccordion } from '@/components/marketing/info';
import { LinkButton } from '@/components/ui';
import { faqPage } from '@/lib/seo';

const FAQ_JSONLD = [faqPage(FAQ_ITEMS.map(({ question, answer }) => ({ question, answer })))];

export default function FaqPage() {
  const { t } = useTranslation('marketingInfo');

  return (
    <>
      <PageSeo path="/faq" crumb="FAQ" jsonLd={FAQ_JSONLD} />
      <PageHero
        tone="light"
        size="md"
        crumb={t('faq.crumb', { defaultValue: 'FAQ' })}
        eyebrow={t('faq.hero.eyebrow', { defaultValue: 'Frequently asked questions' })}
        title={t('faq.hero.title', { defaultValue: 'Straight answers, before you agree to anything.' })}
        lead={t('faq.hero.lead', {
          total: FAQ_ITEMS.length,
          defaultValue:
            '{{total}} questions farmers, buyers and coordinators ask us most — about net earnings, consent, transport, quality, payment and how we use AI.',
        })}
      />

      <Section spacing="compact">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <aside className="lg:col-span-4 xl:col-span-3">
            <nav aria-label={t('faq.topicsLabel', { defaultValue: 'FAQ topics' })} className="lg:sticky lg:top-28">
              <p className="eyebrow eyebrow-rule">{t('faq.topics', { defaultValue: 'Topics' })}</p>
              <ul className="mt-5 flex flex-wrap gap-2 lg:flex-col lg:gap-1 lg:border-s lg:border-line">
                {FAQ_GROUPS.map((group) => (
                  <li key={group.id}>
                    <a
                      href={`#${group.id}`}
                      className="inline-flex items-center gap-2 rounded-sm border border-line px-3 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:border-gold-500 hover:text-ink lg:-ms-px lg:rounded-none lg:border-0 lg:border-s lg:border-transparent lg:px-0 lg:py-2 lg:ps-4 lg:hover:border-gold-500"
                    >
                      {t(`faqs.${group.id}.title`, { defaultValue: group.title })}
                      <span className="font-display text-sm not-italic tabular-nums normal-case tracking-normal text-gold-700">{group.items.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-col gap-16 md:gap-20 lg:col-span-8 xl:col-span-8 xl:col-start-5">
            {FAQ_GROUPS.map((group, index) => (
              <section key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-28">
                <div className="mb-6 flex flex-col gap-2">
                  <p className="eyebrow">
                    {String(index + 1).padStart(2, '0')} &middot;{' '}
                    {t('faq.groupCount', { total: group.items.length, defaultValue: '{{total}} questions' })}
                  </p>
                  <h2
                    id={`${group.id}-title`}
                    className="font-display font-bold text-[1.875rem] leading-tight tracking-[-0.02em] text-ink md:text-[2.25rem]"
                  >
                    {t(`faqs.${group.id}.title`, { defaultValue: group.title })}
                  </h2>
                  <p className="text-[15px] font-normal leading-relaxed text-ink-2">
                    {t(`faqs.${group.id}.lead`, { defaultValue: group.lead })}
                  </p>
                </div>
                <FaqAccordion groupId={group.id} items={group.items} defaultOpen={index === 0 ? [group.items[0]?.id ?? ''] : []} />
              </section>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="dark" spacing="compact" labelledBy="faq-more">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-5">
            <MessageCircle aria-hidden="true" strokeWidth={1.25} className="mt-2 hidden size-6 shrink-0 text-gold-400 sm:block" />
            <div>
              <h2 id="faq-more" className="font-display font-bold text-[1.75rem] leading-tight tracking-[-0.015em] md:text-[2.25rem]">
                {t('faq.more.title', { defaultValue: 'Still have a question?' })}
              </h2>
              <p className="mt-2 max-w-lg text-[15px] font-normal leading-relaxed text-ivory/70">
                {t('faq.more.lead', {
                  defaultValue: 'Ask us directly, or work out your own numbers with the net earnings calculator.',
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <LinkButton to="/contact" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" className="size-4" />}>
              {t('faq.more.contact', { defaultValue: 'Contact us' })}
            </LinkButton>
            <LinkButton to="/calculator" variant="glass" size="lg">
              {t('faq.more.calculator', { defaultValue: 'Try the calculator' })}
            </LinkButton>
          </div>
        </div>
      </Section>
    </>
  );
}
