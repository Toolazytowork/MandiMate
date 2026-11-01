import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Inbox, Lock, RotateCcw, SearchX, WifiOff } from 'lucide-react';
import { Button, EmptyState, Skeleton, SkeletonText } from '@/components/ui';
import { isApiError } from '@/lib/api';

/** The parts of a TanStack Query result this component reads (a `UseQueryResult` fits). */
export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
}

export type QuerySkeleton = 'cards' | 'list' | 'table' | 'detail';

export interface QueryEmpty {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export interface QueryStateProps<T> {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  /** Built-in skeleton shape while the first load runs (default `list`). */
  skeleton?: QuerySkeleton;
  /** Custom loading UI instead of a skeleton preset. */
  loading?: ReactNode;
  /** Decide emptiness; defaults to "an empty array". */
  isEmpty?: (data: T) => boolean;
  /** Empty-state copy, or a node to render instead. */
  empty?: QueryEmpty | ReactNode;
  /** Heading of the error state (the message comes from the API error). */
  errorTitle?: ReactNode;
  className?: string;
}

function isEmptyConfig(value: unknown): value is QueryEmpty {
  return typeof value === 'object' && value !== null && 'title' in value && !('$$typeof' in value);
}

/**
 * Wraps a query result: a skeleton on first load, a friendly API error with Retry, an empty state,
 * or `children(data)`. Background refetches keep showing the data.
 */
export function QueryState<T>({
  query,
  children,
  skeleton = 'list',
  loading,
  isEmpty = (data) => Array.isArray(data) && data.length === 0,
  empty,
  errorTitle,
  className,
}: QueryStateProps<T>) {
  const { t } = useTranslation('domain');

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('common:states.loading')} className={className}>
        {loading ?? <SkeletonPreset kind={skeleton} />}
      </div>
    );
  }

  if (query.isError || query.data === undefined) {
    const { icon, message } = describeError(query.error, t);
    return (
      <div role="alert" className={className}>
        <EmptyState
          size="sm"
          icon={icon}
          title={errorTitle ?? t('query.errorTitle')}
          description={message}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={Boolean(query.isFetching)}
              onClick={() => void query.refetch()}
              leadingIcon={<RotateCcw aria-hidden="true" strokeWidth={1.25} />}
            >
              {t('common:actions.tryAgain')}
            </Button>
          }
        />
      </div>
    );
  }

  if (isEmpty(query.data)) {
    if (empty !== undefined && !isEmptyConfig(empty)) return <div className={className}>{empty}</div>;
    const config = empty;
    return (
      <EmptyState
        size="sm"
        icon={config?.icon ?? <Inbox />}
        title={config?.title ?? t('common:states.empty.title')}
        description={config?.description ?? t('common:states.empty.body')}
        action={config?.action}
        className={className}
      />
    );
  }

  return <>{children(query.data)}</>;
}

function describeError(error: unknown, t: (key: string) => string): { icon: ReactNode; message: string } {
  if (isApiError(error)) {
    if (error.isNetworkError) return { icon: <WifiOff />, message: t('common:errors.network') };
    if (error.status === 404) return { icon: <SearchX />, message: t('common:errors.notFound') };
    if (error.status === 403) return { icon: <Lock />, message: t('common:errors.forbidden') };
    if (error.status >= 500) return { icon: <CircleAlert />, message: t('common:errors.server') };
    return { icon: <CircleAlert />, message: error.detail };
  }
  return { icon: <CircleAlert />, message: t('common:errors.generic') };
}

function SkeletonPreset({ kind }: { kind: QuerySkeleton }) {
  if (kind === 'cards') {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col gap-4 rounded-card border border-line bg-paper p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-sm" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-32" />
              </div>
            </div>
            <Skeleton className="h-9 w-36" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'table') {
    return (
      <div className="overflow-hidden rounded-card border border-line bg-paper">
        <Skeleton className="h-11 rounded-none opacity-60" />
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-t border-line px-5 py-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'detail') {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-72 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 py-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
