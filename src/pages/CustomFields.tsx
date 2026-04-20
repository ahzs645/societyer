import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Sliders, Plus, Trash2, Tag } from "lucide-react";

type EntityType = "members" | "directors" | "volunteers" | "employees";

const ENTITY_LABELS: Record<EntityType, string> = {
  members: "Members",
  directors: "Directors",
  volunteers: "Volunteers",
  employees: "Employees",
};

const FIELD_KINDS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

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

  const openEdit = (row: any) => {
    setDraft({ ...row });
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

  const filterFields: FilterField<any>[] = [
    {
      id: "entityType",
      label: "Category",
      icon: <Tag size={14} />,
      options: Object.keys(ENTITY_LABELS),
      match: (row, q) => row.entityType === q,
    },
    {
      id: "kind",
      label: "Kind",
      icon: <Tag size={14} />,
      options: FIELD_KINDS.map((k) => k.value),
      match: (row, q) => row.kind === q,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Custom fields"
        icon={<Sliders size={16} />}
        iconColor="purple"
        subtitle="Add extra fields to any person category (members, directors, volunteers, employees). Saved values appear on each person's detail and can be pulled into PDF mapping."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New field
          </button>
        }
      />

      <DataTable
        label="Definitions"
        icon={<Sliders size={14} />}
        data={(definitions ?? []) as any[]}
        loading={definitions === undefined}
        rowKey={(r) => r._id}
        searchPlaceholder="Search label, key, category…"
        defaultSort={{ columnId: "entityType", dir: "asc" }}
        viewsKey="custom-fields"
        emptyMessage="No custom fields yet."
        filterFields={filterFields}
        onRowClick={openEdit}
        rowActionLabel={(r) => `Edit ${r.label}`}
        columns={[
          {
            id: "entityType",
            header: "Category",
            sortable: true,
            accessor: (r) => r.entityType,
            render: (r) => (
              <Badge tone="neutral">{ENTITY_LABELS[r.entityType as EntityType] ?? r.entityType}</Badge>
            ),
          },
          {
            id: "label",
            header: "Label",
            sortable: true,
            accessor: (r) => r.label,
            render: (r) => <strong>{r.label}</strong>,
          },
          {
            id: "key",
            header: "Key",
            sortable: true,
            accessor: (r) => r.key,
            render: (r) => <span className="mono">{r.key}</span>,
          },
          {
            id: "kind",
            header: "Kind",
            sortable: true,
            accessor: (r) => r.kind,
            render: (r) => <span className="cell-tag">{r.kind}</span>,
          },
          {
            id: "required",
            header: "Required",
            sortable: true,
            accessor: (r) => (r.required ? 1 : 0),
            render: (r) =>
              r.required ? <Badge tone="warn">Required</Badge> : <span className="muted">—</span>,
          },
        ]}
        renderRowActions={(row) => (
          <button
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={`Delete ${row.label}`}
            onClick={() => doDelete(row)}
          >
            <Trash2 size={12} />
          </button>
        )}
      />

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
    </div>
  );
}
