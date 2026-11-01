import { ModalFrame, type ModalBaseProps } from './Modal';

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const;

export interface DialogProps extends ModalBaseProps {
  size?: keyof typeof SIZES;
}

/**
 * Centered modal dialog (bottom-anchored on phones). Focus is trapped,
 * Escape and backdrop presses close it, and focus returns to the trigger.
 */
export function Dialog({ size = 'md', ...props }: DialogProps) {
  return (
    <ModalFrame
      {...props}
      surface="light"
      containerClassName="items-end justify-center p-3 sm:items-center sm:p-6"
      panelClassName={`w-full max-h-[calc(100dvh-1.5rem)] rounded-panel border sm:max-h-[calc(100dvh-3rem)] ${SIZES[size]}`}
      motionFrom={{ opacity: 0, y: 8, scale: 1 }}
      motionExit={{ opacity: 0, y: 4, scale: 1 }}
    />
  );
}
