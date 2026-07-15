# Record table acceptance evidence

This is the evidence log for the Societyer record-table port. It separates
shared-component coverage from repository-wide verification so a green build
cannot be mistaken for a complete visual audit.

## Inventory

- 49 `RecordTable` render sites across 39 source files are locked in the
  acceptance manifest in `scripts/check-record-table-acceptance.ts`.
- 13 `DataTable` render sites remain across six source files. They are domain
  tables rather than missed object-record views: Wave API result/detail data
  (1), grant-source reference search (1), asset audit/report subgrids (3),
  communications delivery logs (1), organization budget/history records (1),
  and inventory operational subgrids (6).
- Those domain tables intentionally keep `DataTable`, which now uses the same
  32 px compact grid, density/options controls, resizing, search/filter/sort,
  and mobile frozen-first-column pattern. The inventory check prevents new
  table render sites from appearing without review.
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
- Meeting opened in its side panel, desktop:
  `artifacts/table-acceptance/meeting-record-drawer-desktop.png`
- Meeting side panel at 390 × 844:
  `artifacts/table-acceptance/meeting-record-drawer-mobile.png`
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

The view's saved `openRecordIn` value is now passed through table identifier
clicks, trailing open buttons, keyboard opening, kanban cards, and calendar
items. Meetings is the first dual-mode adapter: `Side panel` opens the edit
drawer without changing the URL, while `Full page` navigates to the meeting
detail route. The row action label and icon reflect the selected mode.

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
