import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's default scale. The MandiMate theme (src/styles/theme.css) adds
 * named type sizes, shadows, radii and containers; without registering them `text-h1` would be read
 * as a colour and silently dropped by a later `text-ink`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display-2xl', 'display-xl', 'display-lg', 'display-md', 'display-sm', 'h1', 'h2', 'h3', 'body', 'small', 'micro'],
      shadow: ['luxe', 'luxe-lg', 'luxe-sm', 'button', 'gold'],
      radius: ['card', 'panel'],
      container: ['app', 'content', 'measure'],
      tracking: ['eyebrow'],
      ease: ['luxe', 'soft'],
      animate: [
        'shimmer',
        'fade-up',
        'fade-in',
        'float',
        'marquee',
        'pulse-ring',
        'dash',
        'draw',
        'converge',
        'breathe',
        'pop-in',
      ],
      font: ['display', 'sans', 'mono'],
    },
  },
});

/** Conditionally join class names and let later Tailwind utilities win over earlier ones. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
