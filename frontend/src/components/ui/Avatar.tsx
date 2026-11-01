import { useState } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
} as const;

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

/** Initials (or photo) inside a thin green ring. Decorative: pair it with the visible name. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-full bg-gold-500/70 p-px',
        SIZES[size],
        className,
      )}
    >
      <span className="grid size-full place-items-center overflow-hidden rounded-full bg-forest-900 font-display font-medium tracking-[0.04em] text-gold-300">
        {showImage ? (
          <img src={src ?? undefined} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
        ) : (
          initials(name)
        )}
      </span>
    </span>
  );
}
