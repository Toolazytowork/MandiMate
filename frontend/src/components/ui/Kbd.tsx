import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-paper px-1.5 font-mono text-[11px] font-medium text-muted',
        className,
      )}
      {...props}
    />
  );
}
