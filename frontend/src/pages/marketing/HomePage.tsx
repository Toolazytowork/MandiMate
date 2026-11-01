import { Trans, useTranslation } from 'react-i18next';
import { CtaBand } from '@/components/marketing/CtaBand';
import { PageSeo } from '@/components/marketing/PageSeo';
import {
  AiSection,
  DifferenceSection,
  HomeHero,
  JourneySection,
  NetNotGrossSection,
  PoolingSection,
  ProveSection,
  RolesSection,
} from '@/components/marketing/home';
import { Em } from '@/components/marketing/primitives';
import { organization, softwareApplication, website } from '@/lib/seo';

const JSON_LD = [organization(), website(), softwareApplication()];

export default function HomePage() {
  const { t } = useTranslation('marketingHome');
  return (
    <>
      <PageSeo path="/" jsonLd={JSON_LD} />
      <HomeHero />
      <PoolingSection />
      <JourneySection />
      <NetNotGrossSection />
      <RolesSection />
      <DifferenceSection />
      <AiSection />
      <ProveSection />
      <CtaBand
        title={
          <Trans
            t={t}
            i18nKey="cta.title"
            defaults="Small harvests deserve <em>stronger</em> deals."
            components={{ em: <Em>{null}</Em> }}
          />
        }
      />
    </>
  );
}
