import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { statusLabelKey, statusTone, type StatusKind, type StatusValueMap } from './status';

type StatusPair = { [K in StatusKind]: { kind: K; value: StatusValueMap[K] } }[StatusKind];

export type StatusBadgeProps = StatusPair & {
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * A translated status chip for any MandiMate status enum, e.g.
 * `<StatusBadge kind="lot" value="open_for_offers" />` or `<StatusBadge kind="payment" value="overdue" />`.
 */
export function StatusBadge(props: StatusBadgeProps) {
  const { t } = useTranslation('domain');
  const { kind, value, size = 'md', className } = props;
  return (
    <Badge
      tone={statusTone<StatusKind>(kind, value)}
      size={size}
      dot
      className={cn(
        'rounded-sm bg-transparent font-semibold',
        size === 'sm' ? 'text-[10px]' : 'text-[10.5px]',
        className,
      )}
    >
      {t(statusLabelKey<StatusKind>(kind, value))}
    </Badge>
  );
}
