import type { TargetAndTransition } from 'motion/react';
import { cn } from '@/lib/cn';
import { ModalFrame, type ModalBaseProps } from './Modal';

type SheetSide = 'right' | 'left' | 'bottom';

const WIDTHS = {
  sm: 'sm:max-w-[360px]',
  md: 'sm:max-w-[440px]',
  lg: 'sm:max-w-[560px]',
} as const;

const SIDES: Record<SheetSide, { container: string; panel: string; from: TargetAndTransition }> = {
  right: {
    container: 'justify-end',
    panel: 'h-full w-full border-s sm:rounded-s-panel',
    from: { x: '100%' },
  },
  left: {
    container: 'justify-start',
    panel: 'h-full w-[min(88vw,340px)] border-e rounded-e-panel',
    from: { x: '-100%' },
  },
  bottom: {
    container: 'items-end',
    panel: 'max-h-[88dvh] w-full rounded-t-panel border-t pb-[env(safe-area-inset-bottom)]',
    from: { y: '100%' },
  },
};

export interface SheetProps extends ModalBaseProps {
  side?: SheetSide;
  /** Max width on ≥ sm screens for left/right sheets. */
  size?: keyof typeof WIDTHS;
  surface?: 'light' | 'dark';
}

/** Edge-anchored drawer with the same focus and dismissal behaviour as Dialog. */
export function Sheet({ side = 'right', size = 'md', surface = 'light', ...props }: SheetProps) {
  const config = SIDES[side];
  return (
    <ModalFrame
      {...props}
      surface={surface}
      containerClassName={config.container}
      panelClassName={cn(config.panel, side !== 'bottom' && WIDTHS[size], surface === 'dark' && 'border-ivory/10')}
      motionFrom={config.from}
      motionExit={config.from}
    />
  );
}
