# RecordTable migration playbook

The legacy `DataTable` component renders hardcoded columns per page. The new
`RecordTable` (`src/modules/object-record`) is metadata-driven — columns, sorts,
filters, and saved views come from Convex tables (`objectMetadata`,
`fieldMetadata`, `views`, `viewFields`). Migrating a page is roughly five steps.

Reference migrations that exercise every feature:

- `src/pages/Members.tsx` — selection + bulk edit + merge
- `src/pages/Directors.tsx` — selection + bulk remove, surrounding stat cards/flags
- `src/pages/Filings.tsx` — per-row action buttons via `renderRowActions`

## Prerequisite: seed metadata

Once per deploy, seed the metadata tables:

```
npx convex run seedRecordTableMetadata:run
```

Add a new object to `convex/seedRecordTableMetadata.ts` before migrating its
page. The seeder is idempotent — re-running it upserts by `(societyId, nameSingular)`.

## Step 1 — add the object to the seeder

In `convex/seedRecordTableMetadata.ts`, append a new entry to `OBJECTS`:

```ts
{
  nameSingular: "contact",
  namePlural: "contacts",
  labelSingular: "Contact",
  labelPlural: "Contacts",
  icon: "Users",
  iconColor: "blue",
  routePath: "/app/contacts",
  labelIdentifierFieldName: "firstName",
  fields: [
    { name: "firstName", label: "First name", fieldType: FIELD_TYPES.TEXT, icon: "User" },
    { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, icon: "Mail" },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      configJson: JSON.stringify({
        options: [
          { value: "Active", label: "Active", color: "green" },
          { value: "Inactive", label: "Inactive", color: "gray" },
        ],
      }),
    },
  ],
  defaultView: {
    name: "All contacts",
    columns: [
      { fieldName: "firstName", size: 160 },
      { fieldName: "email", size: 220 },
      { fieldName: "status", size: 120 },
    ],
  },
},
```

Fifteen field types are supported: `TEXT`, `NUMBER`, `CURRENCY`, `BOOLEAN`,
`DATE`, `DATE_TIME`, `SELECT`, `MULTI_SELECT`, `EMAIL`, `PHONE`, `LINK`,
`RELATION`, `RATING`, `UUID`, `ARRAY`. For `SELECT` / `MULTI_SELECT`, put the
options (with optional `color` — blue/green/red/amber/purple/teal/gray/pink/violet)
in `configJson`.

## Step 2 — wire up the page

Replace the `<DataTable>` import + usage with:

```tsx
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableBulkBar,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

// inside the component ...
const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>();
const [filterOpen, setFilterOpen] = useState(false);

const tableData = useObjectRecordTableData({
  societyId: society?._id,
  nameSingular: "contact",
  viewId: currentViewId,
});

const records = (rows ?? []) as any[];
const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
```

Then render the table:

```tsx
{showMetadataWarning ? (
  <div className="record-table__empty">
    <div className="record-table__empty-title">Metadata not seeded</div>
    <div className="record-table__empty-desc">
      Run <code>npx convex run seedRecordTableMetadata:run</code> first.
    </div>
  </div>
) : tableData.objectMetadata ? (
  <RecordTableScope
    tableId="contacts"
    objectMetadata={tableData.objectMetadata}
    hydratedView={tableData.hydratedView}
    records={records}
    onRecordClick={(_, record) => openDrawer(record)}
    onUpdate={async ({ recordId, fieldName, value }) => {
      await update({ id: recordId as Id<"contacts">, patch: { [fieldName]: value } as any });
    }}
  >
    <RecordTableToolbar
      icon={<Users size={14} />}
      label="All contacts"
      views={tableData.views}
      currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
      onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
      onOpenFilter={() => setFilterOpen((x) => !x)}
    />
    <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
    <RecordTableFilterChips />
    <RecordTable selectable loading={tableData.loading || rows === undefined} />
    <RecordTableBulkBar actions={[/* … */]} />
  </RecordTableScope>
) : (
  <div className="record-table__loading">
    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}
  </div>
)}
```

## Step 3 — wire row clicks + inline edits

- `onRecordClick(id, record)` fires when a user clicks the record's *label
  identifier* column (the field named in `labelIdentifierFieldName`). Use it to
  open your existing edit drawer.
- `onUpdate({ recordId, fieldName, value })` fires when a cell is edited. Map
  it to your existing Convex `update` mutation:

  ```ts
  onUpdate={async ({ recordId, fieldName, value }) => {
    await update({ id: recordId as Id<"contacts">, patch: { [fieldName]: value } as any });
  }}
  ```

  All text / number / select / date / boolean fields become inline-editable
  automatically. No per-column config required.

## Step 4 — bulk actions

Use `<RecordTableBulkBar>` instead of the DataTable `bulkActions` prop. Actions
receive `(recordIds, records)`:

```tsx
<RecordTableBulkBar
  actions={[
    {
      id: "archive",
      label: "Archive",
      icon: <Trash2 size={12} />,
      tone: "danger",
      onRun: async (_ids, rows) => {
        for (const r of rows) await archive({ id: r._id });
      },
    },
  ]}
/>
```

Pass `keepSelection: true` when you open a modal that expects the IDs to stay
around (e.g. `BulkEditPanel`, `MergeRecordsModal`).

## Step 5 — per-row action buttons (optional)

For inline buttons (e.g. "Mark filed" on Filings) use `renderRowActions`:

```tsx
<RecordTable
  renderRowActions={(r) =>
    r.status !== "Filed" ? (
      <button className="btn btn--sm" onClick={() => markFiled(r)}>
        <Check size={12} /> Mark filed
      </button>
    ) : null
  }
/>
```

The actions column is sticky to the right side and fades in on row hover.

## What you can delete after migration

- `FilterField<any>[]` constants at the top of the file — filtering is now
  driven by field type + view filters.
- Hardcoded `columns={[...]}` arrays — columns live in Convex now.
- `filterFields` / `searchPlaceholder` / `defaultSort` / `viewsKey` props — all
  handled by the metadata/view.

## Saving views

`usePersistView({ societyId, objectMetadataId })` returns two callbacks:

- `saveCurrentView()` — overwrites the active view's column sizes, visibility,
  order, filters, sorts, and search term.
- `saveAsNewView(name)` — creates a new view with the current state.

Wire them up to save buttons in your toolbar `actions` slot when you need view
management surface area.

## Troubleshooting

- **"useRecordTableContext must be used inside a `<RecordTableScope>`"** — make
  sure every `<RecordTable*>` descendant lives inside `<RecordTableScope>`.
- **Columns don't show up** — the object exists but `fieldMetadata` / `views`
  are empty. Re-run `seedRecordTableMetadata:run`.
- **`Metadata not seeded` warning sticks around** — the seeder runs per-society;
  if you're on a new society, run `seedRecordTableMetadata:runForSociety` with
  its ID.
- **`onUpdate` doesn't fire** — the field's `fieldType` only supports inline
  editing for text/number/select/date/boolean. Other types display only.
