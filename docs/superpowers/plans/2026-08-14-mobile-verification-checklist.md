# Mobile Verification Checklist — `feature/mobile-responsive`

Browser verification was blocked during the build (login wall; the local frontend talks to the **production** backend). Run this once logged in, in the in-app browser or Chrome devtools.

> **Hard rule:** open, inspect, cancel. Never Save/Create/Confirm/Delete, never run or cancel a workflow. No transaction, budget, category, tag, participant or settlement may be created, edited or deleted. Where a check says "read the payload", use the Network tab, not a real save.

Viewports: **mobile = 375×812**, **desktop = 1280×800** (the browser pane's "desktop" preset is ~657px — below the 768px `md:` breakpoint — so set the size explicitly). After every overlay closes on mobile run `document.documentElement.scrollWidth === 375` and confirm the page scrolls again.

## 0. Highest-risk first (whole-branch review)
- [ ] `+` → Add Transaction: scroll to and tap Create *(then Cancel)*. Same reachability for Budgets → Add Budget, Bulk Edit, drawer → Edit.
- [ ] Inside Add/Edit Transaction tap Category: the Select list renders above the sheet (not behind the scrim). Same in Settings → Categories → Add Category.
- [ ] Keyboard: Add Transaction → Tags picker → Escape once closes only the picker; same with the Category Select open.
- [ ] Drawer → Swap ± → Edit → Save: read the PATCH payload in devtools — direction must match the swapped value. **Do not send it on a real row; cancel before submit or use the Network preview.**
- [ ] Drawer → Split / Shared / Links: sub-modal appears cleanly above the closing drawer; Tab stays inside it after ~300ms.
- [ ] Drawer → Edit → Tags: bottom sheet, 44px rows, selecting updates the chip, outside-tap closes only the picker.
- [ ] Cold load, open a tagged row before the tags query settles: "will be kept" chips show; remove one + Cancel restores; (Save would preserve all — verify via payload only).
- [ ] After closing every overlay type (including a Modal opened over a Sheet): page scrolls; `scrollWidth === 375`.
- [ ] Long-press a row: scrim covers bottom nav and bulk bar; nav tap does nothing; Escape closes the panel.
- [ ] Delete from drawer: AlertDialog bottom-anchored above everything, full-width buttons, focus inside it. **Cancel.**

## 1. Transactions
- [ ] Dense rows with category-colour dots; date-group headers/daily totals unchanged; dividers touch (no gap).
- [ ] Header/stat row fits on one line; Import/Add icon buttons open their sheets.
- [ ] Filter row: icon+badge only with zero filters; with 1–2 active, chips scroll and a `Clear` chip is reachable at the end.
- [ ] Tap row → drawer (single grabber) in view mode → Edit → inline form, Advanced collapsed; Direction/Amount side by side; three Switch rows; Cancel.
- [ ] Long-press → panel anchored below that row, scrim, 8 tiles, Delete isolated; outside tap dismisses with no action.
- [ ] Panel → Select: selection mode, that row pre-checked; tapping other rows toggles; bulk bar sits above the bottom nav. Header "Select" still works independently.
- [ ] Selection → Edit (Bulk Edit): full-screen, segmented mode buttons tappable, list rows ≥44px; Tags picker is a bottom sheet; Cancel.
- [ ] From the drawer grid: Shared, Split, Group, Recurring, Links, Related, PDF each open above the nav with grabber/sticky header, scrollable body, full-width footer; scrim tap + X + Escape dismiss. Controls ≥44px, hover-only controls visible, no horizontal overflow.
- [ ] Add Transaction: amount field first and large, numeric keypad with decimal; Debit/Credit full-width 44px; focusing inputs does not zoom; Cancel.
- [ ] Group expense modal: stats grid 2-up with the third stat full-width below, no stray vertical divider.
- [ ] Email card: header buttons all 44px on mobile; Import sheet (workflow) opens from the bottom.

## 2. Analytics · Budgets · Review · Settlements · Settings
- [ ] Each of `/analytics`, `/budgets`, `/review`, `/settlements`, `/settings`: `document.querySelector('main').scrollWidth === 375`.
- [ ] Analytics: preset strip scrolls horizontally; group-by on its own row; charts fit without squashed labels (300/280px tall).
- [ ] Budgets: header stacks with a centred month navigator; list header wraps; sort select 44px; card icon buttons 36px; Add Budget sheet (Cancel).
- [ ] Review: Fetch Latest / Link / Reject ≥44px; header wraps. **Do not fetch or link.**
- [ ] Settlements: full-width 2-column tab strip; filter opens as a bottom sheet (`ResponsivePopover`); chip `X` removable with a thumb; stat grids 2-up.
- [ ] Settings: page tabs 44px; Categories filter tabs 3-up, labels not clipped at 375px; Transaction Type select 44px; Add Category / Add Tag dialogs bottom-anchored (Cancel).

## 3. Cross-cutting (Phase 4)
- [ ] Buttons visibly press (`scale 0.98`) on touch; no 300ms tap delay; a held press on a row never starts text selection.
- [ ] With "Reduce motion" enabled in the OS: sheets/dialogs/popovers appear without slide/fade; Modal too.
- [ ] Empty states are centred blocks with ≥44px CTAs.

## 4. Desktop 1280×800 (must be pixel-identical to `main`, except the press-scale on click)
- [ ] Transactions table, filters, drawer (right side), every modal centred as before; pickers are anchored popovers; participant pickers float without focus trap.
- [ ] Add Transaction row 1 is Date · Amount · Direction in one row, 14px inputs; Bulk Edit segmented buttons unchanged.
- [ ] Analytics/Budgets/Review/Settlements/Settings unchanged; nav is the sidebar; tab strips inline (`w-fit`, 36px); category selector 32px with the `+` button aligned.
- [ ] Compare against `git stash`/`main` if in doubt.
