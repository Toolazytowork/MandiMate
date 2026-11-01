import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Placeholder block with a slow, quiet pulse. Purely decorative (aria-hidden). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-sm bg-parchment',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** Paragraph placeholder; the last line is shorter so it reads as text. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
