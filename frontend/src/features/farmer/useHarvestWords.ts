import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiLanguage } from '@/components/domain';
import { formatKg } from '@/lib/format';
import type { Harvest, ISODate, QualityStatus } from '@/types/api';

import { useCropName } from './hooks';
import { daysFromToday } from './lib';

/** Plain-words labels for a harvest: "400 kg Tomatoes", "Ready tomorrow", "Quality pending inspection". */
export function useHarvestWords() {
  const { t } = useTranslation('farmer');
  const lang = useUiLanguage();
  const cropName = useCropName(lang);

  const crop = useCallback((harvest: Pick<Harvest, 'crop_id' | 'crop_name'>) => cropName(harvest.crop_id, harvest.crop_name), [cropName]);

  const title = useCallback(
    (harvest: Pick<Harvest, 'crop_id' | 'crop_name' | 'quantity_kg'>) => `${formatKg(harvest.quantity_kg)} ${crop(harvest)}`,
    [crop],
  );

  const ready = useCallback(
    (date: ISODate) => {
      const days = daysFromToday(date);
      if (days < 0) return t('words.readyNow', { defaultValue: 'Ready now' });
      if (days === 0) return t('words.readyToday', { defaultValue: 'Ready today' });
      if (days === 1) return t('words.readyTomorrow', { defaultValue: 'Ready tomorrow' });
      return t('words.readyIn', { defaultValue: 'Ready in {{count}} days', count: days });
    },
    [t],
  );

  const sellBy = useCallback(
    (date: ISODate) => {
      const days = daysFromToday(date);
      if (days < 0) return t('words.sellByPassed', { defaultValue: 'Sell-by date passed' });
      if (days === 0) return t('words.sellToday', { defaultValue: 'Sell by today' });
      if (days === 1) return t('words.sellTomorrow', { defaultValue: 'Sell by tomorrow' });
      return t('words.sellIn', { defaultValue: 'Sell within {{count}} days', count: days });
    },
    [t],
  );

  const quality = useCallback(
    (status: QualityStatus) =>
      ({
        self_reported: t('words.qualitySelf', { defaultValue: 'Quality as you described' }),
        pending_inspection: t('words.qualityPending', { defaultValue: 'Quality pending inspection' }),
        inspected: t('words.qualityInspected', { defaultValue: 'Quality checked' }),
      })[status],
    [t],
  );

  return { lang, crop, title, ready, sellBy, quality };
}
