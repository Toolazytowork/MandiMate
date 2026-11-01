import { useRef, type ReactNode } from 'react';
import { motion, useInView, useReducedMotion, type Variants } from 'motion/react';
import { useIsClient } from '@/lib/hooks/useIsClient';
import { DURATION, EASE_LUXE, STAGGER } from './tokens';

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6, transition: { duration: 0 } },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.reveal - 0.1, ease: EASE_LUXE } },
};

const GROUP_TAGS = {
  div: motion.div,
  ul: motion.ul,
  ol: motion.ol,
  section: motion.section,
  dl: motion.dl,
} as const;

const ITEM_TAGS = {
  div: motion.div,
  li: motion.li,
  article: motion.article,
  figure: motion.figure,
} as const;

export interface StaggerGroupProps {
  as?: keyof typeof GROUP_TAGS;
  /** Seconds between children. */
  stagger?: number;
  /** Seconds before the first child. */
  delay?: number;
  className?: string;
  children: ReactNode;
  id?: string;
  'aria-label'?: string;
  role?: string;
}

/**
 * Reveals its `StaggerItem` children one after another when scrolled into view.
 * SSR-safe: the server renders no inline opacity (motion gets `animate` only after hydration);
 * with JS on, `[data-stagger] [data-stagger-item]` hides items in CSS until motion takes over.
 */
export function StaggerGroup({ as = 'div', stagger = STAGGER, delay = 0, className, children, ...rest }: StaggerGroupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  // All tags share the same motion props; narrow once for JSX.
  const MotionTag = GROUP_TAGS[as] as typeof motion.div;

  let state: 'hidden' | 'visible' | undefined;
  if (isClient) state = inView || reduceMotion ? 'visible' : 'hidden';

  return (
    <MotionTag
      ref={ref}
      data-stagger=""
      initial={false}
      animate={state}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
      className={className}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}

export interface StaggerItemProps {
  as?: keyof typeof ITEM_TAGS;
  className?: string;
  children: ReactNode;
}

export function StaggerItem({ as = 'div', className, children }: StaggerItemProps) {
  const MotionTag = ITEM_TAGS[as] as typeof motion.div;
  return (
    <MotionTag data-stagger-item="" variants={itemVariants} className={className}>
      {children}
    </MotionTag>
  );
}
