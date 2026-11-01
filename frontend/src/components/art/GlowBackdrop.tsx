const POSITIONS = {
  'top-right': '62% 55% at 76% 0%',
  top: '58% 60% at 50% 0%',
  center: '50% 50% at 50% 50%',
  'bottom-left': '55% 55% at 12% 100%',
  'bottom-right': '55% 55% at 88% 100%',
} as const;

const INTENSITY = {
  soft: 0.1,
  medium: 0.16,
  strong: 0.24,
} as const;

export interface GlowBackdropProps {
  position?: keyof typeof POSITIONS;
  intensity?: keyof typeof INTENSITY;
  /** Adds a faint sage counter-glow in the opposite corner for depth. */
  counterGlow?: boolean;
  /** Slow breathing pulse (disabled under reduced motion). */
  animated?: boolean;
  className?: string;
}

/**
 * Retired: the editorial style uses flat deep-green surfaces, not glows. Kept as a no-op so existing
 * call sites keep compiling; it renders nothing.
 */
export function GlowBackdrop(_props: GlowBackdropProps) {
  return null;
}
