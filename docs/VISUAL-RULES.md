# VISUAL-RULES.md — Transcriber (local)

Self-refining design rules for the local Next.js + Tailwind transcription app.
Read this **before** generating components, pages, or CSS. Correct in-place when output disappoints.

## How to use this file

1. Claude/Cursor reads this before generating UI.
2. When output looks cheap, tell the AI exactly what was wrong and what to do instead.
3. End the correction with: **"update docs/VISUAL-RULES.md so this never happens again."**
4. The file grows by reaction, not upfront planning.

## Token source of truth

All design values live in `app/globals.css`. Tokens are stored as raw HSL components (Shadcn-style) and wrapped at use site: `hsl(var(--accent))` or `hsl(var(--accent) / 0.5)`.

Edge tokens are raw `box-shadow` strings — use directly with `shadow-[var(--edge)]`.

## Hard rules (do not violate)

### Edges, not borders
- **Never** use `border` Tailwind classes (`border`, `border-white/10`, `border-[hsl(var(--border))]`) on cards, inputs, buttons, panels, modals, popovers, tags.
- Use `shadow-[var(--edge)]`, `shadow-[var(--edge-strong)]`, `shadow-[var(--edge-accent)]`, `shadow-[var(--edge-danger)]`.
- Composing with elevation: `shadow-[var(--edge),_var(--shadow)]`.
- Exception: data tables where a hairline grid aids scanning. Use `border-[hsl(var(--border))]` there only.

### Dark-only design
- This app is dark-only. No light theme mode.
- Use `bg-[hsl(var(--bg))]`, `bg-[hsl(var(--panel))]`, `bg-[hsl(var(--panel-2))]`.
- Hover overlay: `hover:bg-white/[0.04]`.

### Hover via overlay, not color swap
- Don't swap to a hardcoded hover color. Layer a translucent white overlay.
- For accent CTAs, brighten by raising HSL lightness (e.g. `hsl(var(--accent) / 1)` → use a tone-shifted accent-hover token if needed).

### Transparency over opacity
- Never set `opacity` on a parent for "muted" looks — kills text legibility.
- Use the alpha-baked text tokens: `text-[hsl(var(--muted))]`, `text-[hsl(var(--muted-2))]`.

### Spacing
- Stick to Tailwind's spacing scale (`p-2`, `p-4`, `p-6`). No arbitrary `[13px]`.
- Inputs and buttons: vertical padding ≥ `py-3`.

### Radii
- Buttons/inputs/tags: `rounded-md`.
- Cards/panels: `rounded-lg` or `rounded-xl`.
- Modals: `rounded-2xl`.
- Never mix two radii in a nested component.

### Motion
- Use the existing keyframes in `globals.css` (`anim-fade-up`, `anim-fade-in`, `shimmer`, `pulseRing`) for shared entrances.
- Default transition: `transition-[box-shadow,background,color] duration-150`.
- Buttons must not change size on hover, click, press, focus, or active states. Never use `scale`, `active:scale-*`, `hover:scale-*`, or transform scaling on buttons/button-like CTAs.
- Every button/button-like CTA must define default, hover, focus-visible, active/pressed, disabled, loading, offline/no-internet, and skeleton/loading-placeholder states.
- Respect `prefers-reduced-motion` (already wired globally).

## State patterns

| State | Treatment |
|-------|-----------|
| Default | `shadow-[var(--edge)]`, panel bg |
| Hover | `hover:bg-white/[0.04]` |
| Focus-visible | `shadow-[var(--edge-accent)]` + `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]` |
| Active | Increase overlay/color/shadow only; no scale/size change |
| Disabled | `text-[hsl(var(--muted-2))]`, no hover overlay, correct disabled semantics |
| Loading | Same footprint, clear loading copy, `aria-busy` where appropriate |
| Offline/no-internet | Disabled with clear copy, or skeleton while connectivity/status is unknown |
| Skeleton/loading-placeholder | Non-interactive placeholder matching the button footprint |
| Error | `shadow-[var(--edge-danger)]` |

## Anti-patterns Claude tends to ship (reject on sight)

- `border border-white/10` or `border-zinc-800` — replace with `shadow-[var(--edge)]`
- `shadow-md` / `shadow-lg` — Tailwind defaults. Use `shadow-[var(--shadow)]`.
- Purple/indigo accents — clashes with the warm `--accent` tone (HSL 38°)
- `backdrop-blur-xl` without an edge ring — looks like a floating ghost
- Generic AI landing: centered hero + 3 feature cards
- Emoji as icons in product chrome
- `font-bold` for body — `font-semibold` max
- `cursor-pointer` on non-button `<div>` without `role="button"` + keyboard handler
- Hardcoded HSL values outside of `globals.css` — always use tokens
- `active:scale-*`, `hover:scale-*`, or transform scaling on buttons — buttons must not change size

## Glass card

The existing `.glass-card` class (`globals.css`) has `border: none; box-shadow: none;` — when promoting a glass surface to a card, swap to `shadow-[var(--edge-strong)]` to give it a visible ring without breaking the glassmorphism.

## Reference north stars

- **Linear** — input chrome, focus states, density
- **Vercel dashboard** — surface elevation
- **Granola** — warm dark, restrained typography (closest spiritual match for the accent tone here)

## Corrections log (append, don't rewrite)

<!-- Each entry: date, what was wrong, rule added. Keep terse. -->

- 2026-05-19 — Initial seed adapted from Cartewei VISUAL-RULES.md. Translated to HSL Shadcn token format; dark-only.
- 2026-05-25 — Button press/hover scaling is banned globally. Buttons should not change size; use color/shadow/overlay feedback instead.
- 2026-05-25 — Button state coverage is mandatory: default, hover, focus-visible, active, disabled, loading, offline/no-internet, and skeleton/loading-placeholder.
