import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { motion } from 'motion/react';

/** Form-level error, announced to screen readers as soon as it appears. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.7, 0.1, 1] }}
      className="flex items-start gap-3 rounded-sm border border-danger/30 border-s-2 border-s-danger bg-paper px-4 py-3 text-sm leading-relaxed text-danger-ink"
    >
      <CircleAlert aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </motion.div>
  );
}
