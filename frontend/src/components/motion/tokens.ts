/** Motion tokens (docs/DESIGN_SYSTEM.md §4): subtle fades only. Mirrors `--ease-luxe` in theme.css. */
export const EASE_LUXE = [0.2, 0.7, 0.1, 1] as const;

export const DURATION = {
  /** Controls, menus, tooltips. */
  ui: 0.22,
  /** Dialogs and sheets. */
  overlay: 0.32,
  /** Marketing reveals. */
  reveal: 0.6,
} as const;

/** Delay between siblings in a stagger group, in seconds. */
export const STAGGER = 0.06;
