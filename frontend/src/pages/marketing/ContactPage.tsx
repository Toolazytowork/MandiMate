import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Clock, Handshake, MapPin, Sprout, Truck, Warehouse } from 'lucide-react';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Section } from '@/components/marketing/primitives';
import { CONTACT_ROLES, ContactForm } from '@/components/marketing/info';
import { Reveal } from '@/components/motion';

const REASONS = [
  { key: 'farmers', icon: Sprout, title: 'Farmers and FPOs', body: 'Bring your village cluster into the pilot, or ask how pooling would work for your crop.' },
  { key: 'buyers', icon: Warehouse, title: 'Buyers', body: 'Source graded, consistent lots from the Madanapalle cluster with clear quality records.' },
  { key: 'transporters', icon: Truck, title: 'Transporters', body: 'Quote for planned multi-farm pickups with known loads and routes.' },
  { key: 'partners', icon: Handshake, title: 'Partners', body: 'Government, NGO and research teams interested in measured farmer income outcomes.' },
] as const;

const ROLE_VALUES = new Set<string>(CONTACT_ROLES.map((role) => role.value));

export default function ContactPage() {
  const { t } = useTranslation('marketingInfo');
  const [params] = useSearchParams();
  const requested = params.get('role') ?? '';
  const defaultRole = ROLE_VALUES.has(requested) ? requested : '';

  return (
    <>
      <PageSeo path="/contact" crumb="Contact" />
      <PageHero
        tone="light"
        size="md"
        crumb={t('contact.crumb', { defaultValue: 'Contact' })}
        eyebrow={t('contact.hero.eyebrow', { defaultValue: 'Contact' })}
        title={t('contact.hero.title', { defaultValue: 'Let\u2019s talk about your harvest, your lots or your route.' })}
        lead={t('contact.hero.lead', {
          defaultValue: 'Tell us who you are and what you need. A person on the MandiMate team reads every message.',
        })}
      />

      <Section spacing="compact">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-10 lg:col-span-5">
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {REASONS.map(({ key, icon: Icon, title, body }, index) => (
                <Reveal as="li" key={key} delay={index * 0.06} className="flex gap-4 py-5">
                  <Icon aria-hidden="true" strokeWidth={1.25} className="mt-1 size-[18px] shrink-0 text-muted" />
                  <div>
                    <h2 className="font-display text-xl leading-snug text-ink">{t(`contact.reasons.${key}.title`, { defaultValue: title })}</h2>
                    <p className="mt-1 text-[14.5px] font-normal leading-relaxed text-ink-2">
                      {t(`contact.reasons.${key}.body`, { defaultValue: body })}
                    </p>
                  </div>
                </Reveal>
              ))}
            </ul>
            <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex gap-3">
                <MapPin aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-gold-600" />
                <div>
                  <dt className="text-sm font-medium text-ink">{t('contact.details.clusterLabel', { defaultValue: 'Pilot cluster' })}</dt>
                  <dd className="mt-1 text-sm font-normal leading-relaxed text-ink-2">
                    {t('contact.details.cluster', { defaultValue: 'Madanapalle, Annamayya district, Andhra Pradesh' })}
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <Clock aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-gold-600" />
                <div>
                  <dt className="text-sm font-medium text-ink">{t('contact.details.responseLabel', { defaultValue: 'Response time' })}</dt>
                  <dd className="mt-1 text-sm font-normal leading-relaxed text-ink-2">
                    {t('contact.details.response', { defaultValue: 'Usually within two working days, in English, Telugu or Hindi' })}
                  </dd>
                </div>
              </div>
            </dl>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-card border border-line bg-paper p-6 sm:p-8 md:p-12">
              <h2 className="font-display font-bold text-[1.75rem] leading-tight tracking-[-0.015em] text-ink md:text-[2rem]">
                {t('contact.form.title', { defaultValue: 'Send us a message' })}
              </h2>
              <p className="mt-2 text-[15px] font-normal leading-relaxed text-ink-2">
                {t('contact.form.required', { defaultValue: 'Fields marked with an asterisk are required.' })}
              </p>
              <div className="mt-8">
                <ContactForm defaultRole={defaultRole} />
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
