# Mobile Pickers — Design (Phase 2a of the mobile-responsive build)

## Goal

Every form in the app (Add Transaction, the drawer's edit mode, Bulk Edit, Split, Shared, Group, Group Transfer, Budgets) picks tags and participants through pickers built on a Radix `Popover` anchored to a trigger button. On a phone that popover is a 288px-wide floating panel positioned by Radix's popper next to a field inside a bottom sheet: it flips, clips against the sheet edge, lands under the keyboard, and its rows are desktop-sized. Phase 1 gave every *form* correct mobile housing; this slice does the same for the tap-to-open *pickers inside them*, so forms become genuinely usable on mobile before Phase 2b restyles their layouts.

## Decisions (autonomous; alternatives noted)

1. **A `ResponsivePopover` wrapper, not a re-anchored Popover.** Radix Popover positions a wrapper element (`[data-radix-popper-content-wrapper]`) with an inline `transform`; bottom-anchoring it would need `!important` CSS against inline styles — brittle and untestable without a browser. Instead, a drop-in wrapper with the same `Root/Trigger/Content` API renders Radix `Popover` on desktop and Radix `Dialog` on mobile. Phase 1 Task 4 already made `DialogContent` a bottom-anchored sheet at z-70, above every `Modal` (z-60) the pickers live in. Pickers change one import line each. Rejected: forking each picker into mobile/desktop variants (7× the surface, drift risk); a third-party drawer lib (new dependency).
2. **Typeahead autocompletes stay as popovers on mobile.** `field-autocomplete.tsx` and `category-autocomplete.tsx` open suggestions *while the user types* into an input (`PopoverAnchor`, no trigger). A modal `Dialog` would trap focus away from that input and dismiss the keyboard. Their suggestions render directly under the input, which is acceptable on mobile; they are out of scope here.
3. **Radix `Select` stays as is on mobile.** Its popper listbox is usable at 375px (sizes to the trigger, scrolls). Revisit in polish.
4. **Touch targets without touching picker markup.** On mobile the wrapper's content applies `[&_[role=option]]:min-h-11 [&_[cmdk-item]]:min-h-11 [&_[role=button]]:min-h-11` so cmdk rows, listbox rows and row-buttons reach 44px. Desktop untouched.
5. **Keyboard-aware height.** Mobile content is `max-h-[60dvh]`; `dvh` shrinks with the on-screen keyboard so a search input at the top stays visible. Content scrolls internally.
6. **Always modal on mobile.** Two participant pickers pass `modal={false}` (so the desktop popover can float over a modal without trapping). On mobile the sheet is modal regardless; their `onInteractOutside` prevent-close handlers are harmless there.
7. **Accessible title, no visual title.** Radix warns without a `DialogTitle`; the wrapper renders an `sr-only` title from a new optional `title` prop (default "Options").
8. **`container` support.** Two pickers render their popover into a supplied container (`container={container}`) so it sits inside the hosting modal's stacking context. `DialogContent` gains an optional `container` prop forwarded to `DialogPortal` so the same prop works on mobile.

## Current state (verified)

- `frontend/src/components/ui/popover.tsx`: `PopoverContent` is `z-[100] w-72 rounded-md border p-4`; accepts `align`, `sideOffset`, `container`.
- `frontend/src/components/ui/dialog.tsx` (after Phase 1 Task 4): `DialogContent` bottom-anchored full-width below `md`, centred at `md+`, `z-[70]`, `p-6`, optional `showCloseButton`; wraps its own `DialogPortal` (no `container` prop yet).
- Tap-to-open pickers on Popover: `multi-tag-selector.tsx` (`<PopoverContent className="w-full p-0" align="start">`), `tag-selector.tsx` (cmdk `Command` inside; same Content props), `participant-combobox.tsx` (`className="w-[300px] p-0" align="start" container={container} onInteractOutside=…`, Root `modal={false}`), `participant-multi-select.tsx` (`className="w-[var(--radix-popover-trigger-width)] p-0" align="start" container={container} onInteractOutside=…`, Root `modal={false}`).
- `category-selector.tsx` imports Popover but does not use it (pre-existing unused import); it uses Radix `Select`. Out of scope.
- `useIsMobile()` is SSR-safe (false first).

## Component: `ResponsivePopover`

**New file:** `frontend/src/components/ui/responsive-popover.tsx`

Exports `ResponsivePopover`, `ResponsivePopoverTrigger`, `ResponsivePopoverContent` mirroring `Popover`, `PopoverTrigger`, `PopoverContent` props; Content additionally accepts `title?: string`.

- Root: desktop → `Popover`; mobile → `Dialog` (with `modal` forced `true`). `open`/`onOpenChange`/`defaultOpen` pass through.
- Trigger: desktop → `PopoverTrigger`; mobile → `DialogTrigger`. `asChild` passes through.
- Content: desktop → `PopoverContent` with all props. Mobile → `DialogContent showCloseButton={false} container={container}` with popover-only props stripped (`align`, `alignOffset`, `side`, `sideOffset`, `avoidCollisions`, `collisionPadding`, `collisionBoundary`, `sticky`, `hideWhenDetached`, `arrowPadding`, `updatePositionStrategy`, `onMouseLeave` is fine to keep), an `sr-only` `DialogTitle`, and classes `bg-popover text-popover-foreground p-2 max-h-[60dvh] overflow-y-auto [&_[role=option]]:min-h-11 [&_[cmdk-item]]:min-h-11 [&_[role=button]]:min-h-11` merged *before* the consumer's `className` (so a consumer's `p-0` wins). `onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside` pass through to both.
- Each of the three reads `useIsMobile()` itself; they always agree.

## `DialogContent.container`

`frontend/src/components/ui/dialog.tsx`: `DialogContent` gains `container?: HTMLElement | null`, forwarded to `<DialogPortal container={container}>`. No other change.

## Picker migrations (one import line each + `title`)

`multi-tag-selector.tsx` (title "Select tags"), `tag-selector.tsx` ("Select tags"), `participant-combobox.tsx` ("Select participant"), `participant-multi-select.tsx` ("Select participants"): replace the `@/components/ui/popover` import with `ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger` aliased `as Popover` / `as PopoverContent` / `as PopoverTrigger` so the JSX is unchanged, and add the `title` prop on the Content. No other markup changes.

## Out of scope

Form layouts (Phase 2b); Radix `Select` presentation; the two typeahead autocompletes; inline table dropdowns; the create-tag inline forms' own layout.

## Verification (manual, once browser access is restored; no data may be created/edited/deleted)

375×812: Header `+` → Add Transaction → tap Tags → a bottom sheet above the form lists tags with 44px rows; select one → chip appears, outside-tap closes; Cancel the form. Drawer → Edit → Tags → same inside the drawer. Drawer → Shared → participant picker → bottom sheet above the Shared editor; Cancel everything. Selection mode → Edit (Bulk Edit) → Tags → same. No overlay leaks after closing (page scrolls; `scrollWidth === 375`).
1280×800: every picker is the original anchored popover (position, width, animation unchanged); the participant pickers still float over their host modal without trapping focus.
