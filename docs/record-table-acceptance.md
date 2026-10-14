# Record table acceptance evidence

This is the evidence log for the Societyer record-table port. It separates
shared-component coverage from repository-wide verification so a green build
cannot be mistaken for a complete visual audit.

## Inventory

- 56 `RecordTable` render sites are locked in the acceptance manifest in
  `scripts/check-record-table-acceptance.ts`. One of them is the shared
  `ObjectRecordTable` (`platform/record-engine/record-table/components`), which
  wraps a RecordTable with its metadata load, view toolbar (search, filters,
  sort, group by, export, saved views), filter chips and preview sidebar.
- 15 `ObjectRecordTable` registers are locked in the same manifest: the asset
  register and its maintenance, custody and physical-inventory subgrids (4),
  the inventory items, balances, movements, locations, lots and counts (6),
  the communications delivery log and contact preferences (2), converted
  org-history motions (1), the grant source library (1) and the Wave cache
  explorer (1).
- The legacy `DataTable` (and `useDataTable`, `FilterBar`, `AdvancedFilter`,
  the local saved-views store and their styles) was removed. Each former
  DataTable register now has seeded object metadata
  (`convex/recordTableDomainObjects.ts`): typed fields (currency in cents,
  dates, selects with option colours, booleans, links), a default system view
  mirroring the old columns and default sort, and saved views such as asset
  "Needs attention" / "Disposed", delivery "Problems" / "Email" / "SMS",
  inventory "Low stock", and one Wave view per resource type. Rows are
  flattened by the page (joins, roll-ups, computed flags) so every column is
  sortable, filterable, groupable and exportable; composite cells stay as
  `renderCell` overrides. Pagination was dropped: RecordTable virtualizes
  above 40 rows. The check fails if a `DataTable` render or import returns.
- The demo-only `/demo/app/table-field-lab` route renders one editable column
  for each of the 15 canonical field types.

## Browser evidence

- Meetings desktop: `artifacts/table-acceptance/meetings-desktop.png`
- Meetings mobile (390 × 844):
  `artifacts/table-acceptance/meetings-mobile.png`
- Floating field editor, desktop:
  `artifacts/table-acceptance/field-editor-desktop.png`
- Floating field editor, mobile (390 × 844):
  `artifacts/table-acceptance/field-editor-mobile.png`
- Meeting title edited from the identifier-cell pencil:
  `artifacts/table-acceptance/meeting-title-editor-desktop.png`
- Researcher-style meeting preview sidebar, desktop:
  `artifacts/table-acceptance/meeting-record-preview-sidebar-desktop.png`
- Researcher-style meeting preview sidebar at 390 × 844:
  `artifacts/table-acceptance/meeting-record-preview-sidebar-mobile.png`
- Meeting opened as a full record page:
  `artifacts/table-acceptance/meeting-record-page-desktop.png`
- Meeting full record page at 390 × 844:
  `artifacts/table-acceptance/meeting-record-page-mobile.png`
- Desktop geometry observed at 1280 × 720: 32 px rows, grid width equal to its
  region width, and no unnecessary horizontal overflow.
- Mobile geometry observed at 390 × 844: no body overflow, 350 px table
  viewport, 914 px horizontally accessible table content, and a 179 px pinned
  identifier column.

The browser run exposed and led to a repair of an editor focus race: the
delayed cell-focus callback could blur and immediately close a newly opened
editor. Live checks now cover double-click editing, the identifier-cell pencil,
Enter-to-commit, desktop/mobile editor geometry, and both record-opening modes.
The run hit the browser safety policy when the email cell's `mailto:` link
intercepted an automated click. All 15 value round-trips are therefore covered
by the deterministic demo-fixture acceptance check; this document does not
claim that every link-like field was clicked by browser automation.

Normal identifier clicks, trailing preview buttons, keyboard opening, kanban
cards, and calendar items now open the shared Researcher-style record sidebar.
The sidebar is metadata-driven, provides Home, Timeline, and Notes tabs, and
keeps editing separate from record navigation. Its primary `Open` action (or
Cmd/Ctrl+Enter while the sidebar is focused) delegates to the owning page's
full record surface. Meetings therefore previews without changing the table
URL and only navigates to the meeting detail route when `Open` is selected.

## Automated acceptance

Run:

```sh
npm run test:record-table-acceptance
npm run test:record-table-utils
npm run test:mobile-table-layout
```

The acceptance check fails when a table instance is added or removed without
review, when the field-type registry changes without updating the lab, when a
lab field is not editable, or when an acceptance edit does not round-trip.

## Follow-up fixtures

- Add a dedicated selectable/bulk-action screenshot fixture.
- Add a large-data screenshot fixture that forces the virtualized path.
- If browser policy permits in a future environment, add direct live clicks
  for the email, phone, and URL editors; their value round-trips are already
  locked by the deterministic field-lab check.
