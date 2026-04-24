import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import { Button, Drawer, Field, SettingsShell } from "../components/ui";
import { Sliders, Plus, Trash2 } from "lucide-react";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

const FIELD_KINDS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

const ENTITY_LABELS: Record<string, string> = {
  members: "Members",
  directors: "Directors",
  volunteers: "Volunteers",
  employees: "Employees",
};

/**
 * Custom field definitions. The record table handles search / filter /
 * sort / column visibility; inline edits route to
 * `customFields.updateDefinition`. `entityType` and `key` are flagged
 * read-only in the seed so they can't be changed after creation
 * (matching the drawer's own `disabled` attribute on those inputs).
 */
export function CustomFieldsPage() {
  const society = useSociety();
  const definitions = useQuery(
    api.customFields.listDefinitions,
    society ? { societyId: society._id } : "skip",
  );
  const createDef = useMutation(api.customFields.createDefinition);
  const updateDef = useMutation(api.customFields.updateDefinition);
  const deleteDef = useMutation(api.customFields.deleteDefinition);
  const toast = useToast();
  const confirm = useConfirm();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "customFieldDefinition",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      entityType: "members",
      key: "",
      label: "",
      kind: "text",
      required: false,
      description: "",
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.label?.trim()) {
      toast.error("Label is required");
      return;
    }
    const key = (draft.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) {
      toast.error("Key is required (machine-readable identifier)");
      return;
    }
    try {
      if (draft._id) {
        await updateDef({
          id: draft._id,
          label: draft.label,
          kind: draft.kind,
          required: draft.required,
          description: draft.description,
          order: draft.order,
        });
      } else {
        await createDef({
          societyId: society._id,
          entityType: draft.entityType,
          key,
          label: draft.label,
          kind: draft.kind,
          required: draft.required,
          description: draft.description,
        });
      }
      toast.success("Saved");
      setDrawerOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
  };

  const doDelete = async (row: any) => {
    const ok = await confirm({
      title: `Delete "${row.label}"?`,
      message: "All stored values for this custom field will be removed across every person in this category.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await deleteDef({ id: row._id });
    toast.success("Deleted");
  };

  const records = (definitions ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page custom-fields-page">
      <SettingsShell
        title="Custom fields"
        description="Add extra fields to any person category (members, directors, volunteers, employees). Saved values appear on each person's detail and can be pulled into PDF mapping."
        tabs={[
          { id: "definitions", label: "Definitions", icon: <Sliders size={14} /> },
          { id: "mapping", label: "Mapping" },
        ]}
        activeTab="definitions"
        actions={
          <Button variant="accent" onClick={openNew}>
            <Plus size={12} /> New field
          </Button>
        }
      >

      <div className="custom-fields-mobile-list" aria-label="Custom field definitions">
        {definitions === undefined ? (
          <div className="record-table__loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="record-table__loading-row" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="record-table__empty">
            <div className="record-table__empty-title">No custom fields</div>
            <div className="record-table__empty-desc">
              Add fields for members, directors, volunteers, or employees.
            </div>
          </div>
        ) : (
          records.map((row: any) => (
            <article
              key={row._id}
              className="custom-field-card"
              onClick={() => {
                setDraft({ ...row });
                setDrawerOpen(true);
              }}
            >
              <div className="custom-field-card__main">
                <div className="custom-field-card__title">{row.label}</div>
                <div className="custom-field-card__meta">
                  {ENTITY_LABELS[row.entityType] ?? row.entityType} · {fieldKindLabel(row.kind)}
                  {row.required ? " · Required" : ""}
                </div>
                {row.description && (
                  <div className="custom-field-card__description">{row.description}</div>
                )}
                <div className="custom-field-card__key">{row.key}</div>
              </div>
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete(row);
                }}
              >
                <Trash2 size={12} />
              </button>
            </article>
          ))
        )}
      </div>

      <div className="custom-fields-record-table">
      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            custom-field-definition object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="custom-fields"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, record) => {
            setDraft({ ...record });
            setDrawerOpen(true);
          }}
          onUpdate={async ({ recordId, fieldName, value }) => {
            // `entityType` and `key` are immutable after create — the
            // seed marks `key` read-only; entityType is filterable but
            // not meant to be edited inline (ignore if it slips through).
            if (fieldName === "entityType" || fieldName === "key") return;
            const patch: any = { id: recordId };
            if (fieldName === "label") patch.label = value;
            else if (fieldName === "kind") patch.kind = value;
            else if (fieldName === "required") patch.required = value;
            else if (fieldName === "description") patch.description = value;
            else if (fieldName === "order") patch.order = value;
            else return;
            await updateDef(patch);
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Sliders size={14} />}
            label="Definitions"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || definitions === undefined}
            renderRowActions={(row) => (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete(row);
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={draft?._id ? "Edit custom field" : "New custom field"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {draft && (
          <div>
            <Field label="Category">
              <select
                className="input"
                value={draft.entityType}
                disabled={Boolean(draft._id)}
                onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
              >
                {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Label">
              <input
                className="input"
                value={draft.label ?? ""}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
            <Field label="Key">
              <input
                className="input mono"
                value={draft.key ?? ""}
                disabled={Boolean(draft._id)}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                placeholder="unbc_affiliate_role"
              />
              <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                Lowercase with underscores. Used as the stable reference from mapping wizards.
              </div>
            </Field>
            <Field label="Kind">
              <select
                className="input"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                {FIELD_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                rows={2}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <label className="workflow-checkbox">
              <input
                type="checkbox"
                checked={Boolean(draft.required)}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
              />
              <span>Required</span>
            </label>
          </div>
        )}
      </Drawer>
      </SettingsShell>
    </div>
  );
}

function fieldKindLabel(kind: string) {
  return FIELD_KINDS.find((item) => item.value === kind)?.label ?? kind;
}
