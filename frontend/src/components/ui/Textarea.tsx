import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './Field';
import { CONTROL_SURFACE } from './Input';

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  const props = useFieldControl(rest);
  return (
    <textarea
      rows={rows}
      className={cn(
        CONTROL_SURFACE,
        'block min-h-28 w-full resize-y px-4 py-3 leading-relaxed',
        'outline-none focus-visible:outline-none focus:border-ink focus:bg-paper focus:ring-1 focus:ring-ink/10',
        'aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:ring-danger/10',
        'disabled:cursor-not-allowed disabled:bg-parchment/70 disabled:text-muted',
        className,
      )}
      {...props}
    />
  );
}
