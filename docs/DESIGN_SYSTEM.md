# MandiMate Design System — Clean, with green and harvest amber

MandiMate should feel familiar to a farmer and trustworthy to a buyer: clean white cards on a warm off-white page,
charcoal dark sections, leaf green for actions and good news, warm harvest amber for highlights, bold readable
sans-serif type and friendly rounded shapes. Green is an accent, not the background. References: Arya.ag, FBN.

## 1. Tokens (in `frontend/src/styles/theme.css` — use them, never hard-code)
The class names kept their old scale names (`forest`, `gold`, `ivory`) so components did not need renaming.

| Role | Token | Value |
|---|---|---|
| Page background | `bg-ivory` | #f8f7f4 (warm off-white) |
| Cards / panels / sidebar | `bg-paper` | #ffffff |
| Alternate section / soft fill | `bg-parchment` · `bg-sand` | #f1efea · #e5e1d8 |
| Ink / secondary ink / muted | `text-ink` · `text-ink-2` · `text-muted` | #1c1f1d · #3d423f · #646863 |
| Hairline | `border-line` | #e5e2db |
| Charcoal (dark sections, hero panels) | `bg-forest-900` #191d1b, `forest-950`, `forest-800`, `forest-700` | |
| Leaf green (primary buttons, selected states, positive) | `forest-600` #1f7a46 … `forest-50` | |
| Harvest amber (eyebrows, headline emphasis, highlights) | `text-gold-700` #8a5a0e on light · `gold-400` #efb43c on dark | |
| Danger | `danger` #c03a2b | |
| Radius | buttons and badges `rounded-full`; inputs `rounded-sm` (8 px); cards `rounded-card` (16 px); panels `rounded-panel` (20 px) | |
| Shadow | cards `shadow-luxe-sm`, hover `shadow-luxe`, overlays `shadow-luxe-lg` | |

## 2. Typography
- **Everything**: Plus Jakarta Sans (`font-sans` and `font-display`), with Noto Sans Devanagari / Telugu / Kannada for Hindi,
  Telugu and Kannada, and Noto Naskh Arabic for Urdu. Urdu renders right-to-left (`<html dir="rtl">`), so layout
  uses logical utilities (`ms-`, `ps-`, `start-`, `text-start`, `border-s`) rather than left/right ones.
- **Headings and big numbers**: `font-display font-bold`, tight tracking from the tokens. Emphasis = one word in
  amber (`text-gold-700`, or `text-gold-400` on dark) — never italic.
- **Body**: 400 weight, 15–18 px, `text-ink-2`. Do not use light (300) weights; they are hard to read outdoors.
- **Labels, nav, table headers**: sentence case, 13 px, `font-semibold`. Only the small section eyebrow
  (`.eyebrow`) is upper case. Never smaller than 12 px.

## 3. Components
- **Buttons**: pill (`rounded-full`), 48 px tall (40 small, 52 large), 15–16 px semibold sentence-case label.
  Primary = leaf green + white; on dark = amber (`gold`) or white (`inverse`); secondary = white with a green outline.
- **Cards**: white, `border-line`, `rounded-card`, soft shadow; clickable cards turn their border green on hover.
  Selling options are separate cards; the best one has a 2 px green border and a green "Best net" pill.
- **Badges / status**: filled, tinted pills (`bg-forest-100 text-forest-700`, `bg-danger/10 text-danger-ink` …).
- **Selected states** (chips, segmented controls, checkboxes, switches, radios): leaf green fill, white text.
- **Hero panels**: charcoal with a soft lighter glow from the top corner and faint field contours.
- **App sidebar**: white with a hairline border; the active item is a soft green fill with a green rail.
- **Icons**: lucide, 16–20 px.
- **Logo**: green rounded tile with a white-and-amber sprout (`LogoMark`), bold "MandiMate" wordmark.

## 4. Layout & motion
- Content width 1240 px; alternate off-white and white sections, with the occasional charcoal section.
- Big touch targets (≥ 44 px), generous spacing, one main action per screen.
- Motion: short fades and slides (`ease-luxe`), 200–600 ms. Prerendered content is never hidden.

## 5. Voice
Plain, warm and factual — like a trusted local agent. No exclamation marks, no emoji, no "Hey/Let's", no hype
adjectives. Short sentences. Numbers before adjectives.

## 6. Accessibility & SEO (unchanged)
WCAG AA contrast, visible focus (2 px green outline), semantic landmarks, one h1 per page, prerendered public
pages with unique titles, descriptions and JSON-LD.
