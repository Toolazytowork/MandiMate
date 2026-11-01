import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { QualityStatus } from '@/types/api';

const QUALITY_TONE = {
  inspected: 'success',
  pending_inspection: 'warning',
  self_reported: 'neutral',
} as const satisfies Record<QualityStatus, 'success' | 'warning' | 'neutral'>;

export interface QualityBadgeProps {
  status: QualityStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/** Whether quality was inspected, is awaiting inspection or is only the farmer's own description. */
export function QualityBadge({ status, size = 'sm', className }: QualityBadgeProps) {
  const { t } = useTranslation('domain');
  return (
    <Badge
      tone={QUALITY_TONE[status]}
      size={size}
      dot
      className={cn(
        'rounded-sm bg-transparent font-semibold',
        size === 'sm' ? 'text-[10px]' : 'text-[10.5px]',
        className,
      )}
    >
      {t(`common:enums.qualityStatus.${status}`)}
    </Badge>
  );
}
