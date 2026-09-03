# Mobile Polish — Design (Phase 4, cross-cutting)

## Goal

Phases 1–3 made every page and overlay structurally correct on a phone. This final slice adds the cross-cutting finish that the UX rulebook (ui-ux-pro-max §2 Touch & Interaction, §7 Animation, §8 Forms & Feedback) still calls for, and closes the small items the per-task reviews parked. Everything here is app-wide or a one-line follow-up; nothing changes behaviour.

## Decisions (autonomous)

1. **Tactile press feedback at the primitive.** `Button` gets `active:scale-[0.98] transition-transform` (transform-only, GPU-friendly, 150ms) so every button in the app responds to touch without per-consumer edits. Ghost/link variants included — the effect is subtle. Rejected: per-button `whileTap` with framer-motion (needs `motion.button` everywhere).
2. **`touch-manipulation` on interactive primitives** (`Button`, `TabsTrigger`, `SelectTrigger`, `Checkbox`, `Switch`, ledger rows): removes the 300ms tap delay/double-tap-zoom heuristics on mobile browsers; no desktop effect.
3. **`select-none` on the long-press rows** so a held press never starts a text selection/callout on iOS.
4. **Reduced motion respected app-wide**: `globals.css` gets a `@media (prefers-reduced-motion: reduce)` block that shortens `tw-animate-css` durations to near-zero (`--tw-animate-duration: 1ms` equivalents via `.animate-in, .animate-out { animation-duration: 1ms !important }`) — covers Sheet/Dialog/Popover/Select animations without touching each consumer. `Modal` already honours `useReducedMotion()`.
5. **Parked review items closed**: email-card header buttons unified to 44px on mobile (`h-11 w-11 md:h-6 md:w-6`, the row has the height); settlement-filter chip `X` gets an invisible 44px hit area via `before:absolute before:-inset-2.5` on a `relative` button (visible chip unchanged); group-expense stat grid `divide-x` → `md:divide-x` with `gap-3 md:gap-0` and a top border on the wrapped cell (`[&>*:nth-child(3)]:col-span-2 [&>*:nth-child(3)]:border-t md:[&>*:nth-child(3)]:border-t-0 md:[&>*:nth-child(3)]:col-span-1`).
6. **Empty/loading/error states audit, not redesign.** Each page's list already renders a loading skeleton and an empty message; this slice only ensures the empty message is a full-width, centred block with ≥44px CTA where one exists, by inspection — code changes only where a CTA is under 44px.
7. **Login page**: confirmed mobile-correct at the start of the project; no change.

## Out of scope

PWA/installability, offline, swipe gestures, haptics (web can't), new visual themes.

## Verification (code-level; browser list appended to the consolidated pending file)

Every change must be class/attribute-level or a CSS media block; desktop identical except the intentional press-scale (which also applies on desktop clicks and is acceptable). `npm run type-check`/`lint` clean.
