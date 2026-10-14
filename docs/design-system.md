# Design system

The shared building blocks for Societyer's interface: tokens, money, stat tiles,
statements, charts and the feedback primitives. Use these before writing a local
copy; reviewers will ask for the shared one.

## Conventions

- **Tokens only.** In SCSS, every colour, radius, duration, easing, font size and
  shadow comes from `token('name')`, which is validated at compile time against
  `$known-tokens` in `src/styles/_tokens.scss`. New tokens go in both themes of
  `src/theme/tokens.css` (if they are colours) and in `$known-tokens`. No raw hex,
  no new literal px font sizes, radii or durations.
- **No undefined CSS variables.** `npm run test:css-vars` fails on any `var(--x)`
  that nothing defines; its allowlist must stay empty. Inline `style={{}}` is for
  layout numbers only (widths, grid spans), never for themeable values.
- **Light, dark and phone.** Every surface works in both themes and at 390px
  (still usable at 320px, no horizontal page scroll), plus tablet and desktop.
  Touch targets are at least 40px on coarse pointers; keyboard focus is visible;
  `prefers-reduced-motion` is respected (the global rule in `_foundations.scss`
  handles most of it).
- **New styles live in a new partial** (`src/styles/_<area>.scss`) registered in
  `src/styles/index.scss` just before the final `@use "foundations";`.

## Tokens

| Group | Tokens | Use |
| --- | --- | --- |
| Money | `money-neutral`, `money-in`, `money-out`, `money-pending`, `variance-favourable`, `variance-unfavourable` (+ `-soft`) | Amount colour by meaning, never by sign. Usually reached through `<Money tone>` rather than directly. |
| Elevation | `elevation-1` (cards), `elevation-2` (popovers, tooltips, toasts, hovered cards), `elevation-3` (dialogs) | Shadows. Cards use the `surface-card` mixin. |
| Radius | `r-card` (12px: cards, modals, popovers), `r-xs`…`r-xl`, `r-pill` | |
| Motion | `motion-fade-fast`, `motion-fade`, `motion-fade-slow`, `motion-move-fast`, `motion-move`, `motion-move-slow`, `motion-panel`; easings `ease-fade`, `ease-move`, `ease-appear`, `ease-disappear`, `ease-panel` | Fades for colour/opacity, moves for position, panel for drawers. |
| Surfaces | `bg-hover-alpha`, `bg-active-alpha`, `bg-selected-alpha`, `border-alpha`, `border-alpha-strong`, `bg-frosted` | Hover/selected washes that work on any background. |
| Focus | `focus-ring-color`, `focus-ring-width`, `focus-ring-offset` | The global focus ring. |
| Data viz | `--dv-cat-1`…`--dv-cat-8`, `--dv-in`, `--dv-out`, `--dv-net`, `--dv-previous`, `--dv-average`, `--dv-grid`, `--dv-axis`, `--dv-label`, `--dv-track`, `--dv-selection`… | Chart colours, read by the chart kit in both themes. |
| Density | `row-h-compact`, `row-h-comfortable`, `opacity-disabled` | |

The type scale is `fs-xs` 13px, `fs-sm` 14px, `fs-md` 15px, `fs-lg` 18px, `fs-xl`
24px, `fs-xxl` 28px.

## Money

`src/lib/money.ts` formats integer cents: `formatMoney(cents, { currency,
trimWholeCents, negativeStyle: "minus" | "parentheses", signDisplay })`,
`formatMoneyCompact`, `parseMoneyInput("1.5k" | "(300)" | "$1,250.50")` and
`budgetVariance(planned, actual, "expense" | "revenue")` (positive is always
favourable).

`<Money cents currency tone variant negativeStyle signDisplay trimWholeCents struck />`
(`src/components/Money.tsx`) renders every amount in tables, statements, totals
and stats: tabular digits, consistent sign and colour rules.

- `tone="auto"` (default) keeps amounts neutral; `in`/`out`/`pending` mark
  direction; `favourable`/`unfavourable` mark variances.
- `variant="hero"` de-emphasises cents for headline figures; add
  `trimWholeCents` to drop `.00` in stat tiles.
- Statements use `negativeStyle="parentheses"`.
- Right-align amount cells with `className="num"` on the `<td>`/`<th>`.

`money()` in `lib/format.ts` is the compact whole-dollar form for prose only.

## StatTile

`src/components/StatTile.tsx` is the one stat tile: an eyebrow `label`, a
ReactNode `value` (pass `<Money variant="hero" trimWholeCents />` for amounts),
optional `sub`, `tone` (colours the value), `icon`, `info` (an ⓘ popover),
`trend` (`{ value, direction, favourable, label }`, coloured by meaning) and
`href`/`onClick`/`pressed` to make the whole tile a link, button or toggle.
Render several inside `.stat-grid`. Do not hand-roll `.stat` markup.

## Tables

- **RecordTable** (`src/platform/record-engine/record-table/`) for record lists:
  views, filters, group by, export, range copy, preview panel. Currency and
  number fields right-align automatically.
- **ReportTable** (`src/components/ReportTable.tsx`) for financial statements:
  hierarchical rows (section → row → subtotal/total), several value columns,
  optional prior-period comparison with Δ and Δ%, collapsible sections and
  drilldown on any amount.
- **Small summary tables** (`table.table.finance-table`) sort client-side with
  `useSortableRows(rows, accessors)` and `<SortableTh column sort onSort>`
  headers, which set `aria-sort`. Text sorts ascending first, amounts largest
  first, blanks last; a third click restores the original order.
- Dates in tables: `formatShortDate(value, organizationTodayISO(org))` gives
  "Mar 3" this year and "Mar 3, 2025" otherwise; put the full date in a `title`.

## Charts

`src/components/charts` (import from a lazily loaded module below the fold):
`TimeSeriesChart`, `FlowBarChart` (money in/out), `BudgetBars`, `Sparkline`,
wrapped in `ChartCard`, with `ChartLegend` and `ChartTooltip`. Charts are plain
SVG, colour themselves from the `--dv-*` tokens, offer a "View as table" twin,
support keyboard reading and skip the draw-in under reduced motion.

## Feedback and guidance

- **`useUndoableAction`** (`src/hooks/useUndoableAction.ts`): run a reversible
  action immediately and offer Undo in the toast, instead of asking "Are you
  sure?". Keep `useConfirm` for actions with no inverse (permanent deletes,
  sends, signatures, filings).
- **`EmptyState`** (`components/ui.tsx`): `variant="default"` for a first-run
  empty list with a next action, `"filtered"` when filters hide everything
  (pass `onClearFilters` for a Clear filters button), `"caught-up"` when the
  work is done.
- **Spotlight** (`src/components/Spotlight.tsx`): a one-time coachmark pointing
  at a feature (`anchor` CSS selector) or rendered inline. Dismissal is
  remembered per user; only one tip shows at a time; anchored tips never show
  on phones. Point at stable `data-*` hooks, not styling classes.
- **`PageSkeleton`** / `PageLoading` for page loads, shaped like the page.

## Navigation and hints

- **Tooltip** (`src/components/Tooltip.tsx`) for icon-only buttons and links.
  Keep an `aria-label` on the control (the tooltip is visual only), and prefer
  it to a native `title=`. Leave `title=` for truncated text and
  non-interactive cells.
- **ShortcutHint** (`src/components/ShortcutHint.tsx`): platform-aware key chips
  (⌘ on Apple, Ctrl elsewhere) from the shortcut registry
  (`src/lib/shortcutsRegistry.ts`). Put one in a tooltip when the control has a
  shortcut: `<Tooltip content={<>Search <ShortcutHint id="commandPalette" tone="inverse" /></>}>`.
- **Breadcrumbs** (`src/components/Breadcrumbs.tsx`): the full trail on desktop,
  "← Parent" on phones. Page headers render them from the route identity, so
  detail pages should not add their own "← Back" links.
