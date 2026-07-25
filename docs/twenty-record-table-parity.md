# Twenty record-table parity

This document defines the Societyer record table against the table in the
local `researcher` (Twenty) repository. The target is user-facing parity, not
source-code parity: Twenty's table is coupled to its Jotai, Linaria,
permissions, query, and drag-and-drop infrastructure, while Societyer keeps
its existing metadata, Zustand, Convex, and `react-virtuoso` boundaries.

The Meetings view is the acceptance page, but every implementation change
belongs in the shared `src/modules/object-record/record-table` module unless a
domain-specific renderer is required.

## Parity contract

### Table frame and layout

- [x] Fixed 32 px header and row rhythm in the default density.
- [x] Subtle primary-surface header and cell borders.
- [x] Sticky selection controls and label-identifier column.
- [x] A fill column consumes unused viewport width without creating a small,
  unnecessary horizontal scrollbar.
- [ ] Horizontal and vertical overflow shadows appear only when more content
  exists in that direction.
- [x] Compact mobile identifier column with horizontal access to all remaining
  fields.
- [ ] Non-virtualized and virtualized tables have identical geometry.

### Focus, hover, and editing

- [x] The table owns focus before table shortcuts can run.
- [x] One focused cell and one hovered cell are visually distinct.
- [x] Clicking cell chrome focuses it; clicking the identifier value opens the
  record.
- [x] Enter edits an editable focused cell; printable keys replace its value.
- [x] Escape closes editing first, then leaves table focus.
- [x] Arrow keys move between cells and keep the focused cell in view.
- [x] Read-only cells never present an edit affordance.
- [x] Editors stay anchored during scroll/resize and commit or cancel
  predictably.

### Row interaction and selection

- [x] Checkbox selection supports all, none, and indeterminate states.
- [x] Shift selection selects a contiguous range.
- [x] Focused/active rows receive a consistent row treatment.
- [x] Right-click and overflow actions use the same action definitions.
- [x] Bulk selection remains stable across virtualization.
- [ ] Drag selection and row reordering are enabled only when the object adapter
  declares support and can persist the result.

### Columns and views

- [x] Resize, sort, filter, hide, and reorder controls are available from the
  column header.
- [x] The label-identifier column remains first and visible.
- [x] Column widths, visibility, order, filters, sorts, and density persist in
  the current view.
- [ ] Add-field is shown only where field creation is supported.
- [x] Table, kanban, and calendar view switching preserves the same record/view
  adapter.
- [x] View title and record count are visually separate from table operations.

### Rows, groups, and creation

- [x] Add-new row is available when the object adapter supplies `onCreate`.
- [x] Empty states distinguish no records, no filter matches, loading, and
  read-only access.
- [ ] Table grouping renders collapsible sections and per-group add-new actions.
- [ ] Grouping, filtering, sorting, and search compose deterministically.

### Aggregates and scale

- [x] Aggregate operations are chosen per column instead of inferred visibly
  without user intent.
- [x] Aggregate choices respect field type and persist with the view.
- [ ] Large datasets virtualize without changing focus, selection, sticky
  columns, or footer behavior.
- [x] Loading uses geometry-matched skeleton rows.

### Accessibility and verification

- [x] The surface exposes grid, row, columnheader, and gridcell semantics.
- [x] Focus is represented in the DOM, not only in application state.
- [x] Header menus, resize handles, selection, and editors have stable labels.
- [ ] Keyboard behavior is covered by interaction tests.
- [ ] Meetings plus one bulk-action table and one large/virtualized table pass
  desktop and mobile visual checks.

## Adapter boundary

`RecordTableScope` is the object adapter. It owns immutable object metadata and
accepts capabilities for opening, updating, creating, deleting, and reordering
records. The table module must not import page-specific Convex mutations.

Unsupported capabilities are hidden rather than rendered as inert controls.
This preserves Twenty's interaction model without pretending that every legal
record type supports every mutation.

## Rollout

1. Foundation: focus ownership, 32 px geometry, sticky columns, fill column,
   and equivalent virtualized/non-virtualized layout.
2. Interaction: cell editing, row selection/ranges, actions, and scoped
   keyboard behavior.
3. Data operations: add-new, per-column aggregates, column/view persistence,
   and capability-gated reordering.
4. Structure: grouped sections, group creation, and large-table hardening.
5. Migration: replace the remaining legacy `DataTable` record views. Raw
   report/document tables remain separate unless they represent editable
   object records.
