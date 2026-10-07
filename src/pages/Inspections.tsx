import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Plus, Eye, Trash2 } from "lucide-react";
import { dollarInputToCents, formatDate, money } from "../lib/format";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { useMemo } from "react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { todayDateOnly } from "../../shared/dateOnly";

export function InspectionsPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canWrite = permissions.loaded && permissions.can("documents:write");
  const items = useQuery(api.inspections.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = usePermissionedMutation(api.inspections.create, canWrite);
  const remove = usePermissionedMutation(api.inspections.remove, canWrite);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (!canWrite) setOpen(false);
  }, [canWrite]);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "inspection",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const records = useMemo(() => (items ?? []).map((r: any) => ({
    ...r,
    inspectorType: r.isMember ? "Member" : "Public",
    copies: r.copyPages ? `${r.copyPages} pg · ${money(r.copyFeeCents)}` : "—",
  })), [items]);

  const openNew = useCallback(() => {
    if (!canWrite) return;
    setForm({
      inspectorName: "",
      isMember: false,
      recordsRequested: "",
      inspectedAtISO: todayDateOnly(),
      deliveryMethod: "in-person",
      feeDollars: "",
      copyPages: 0,
      copyFeeDollars: "",
    });
    setOpen(true);
  }, [canWrite]);
  const save = async () => {
    if (!canWrite) return;
    const { feeDollars, copyFeeDollars, ...rest } = form;
    await create({
      societyId: society._id,
      ...rest,
      feeCents: dollarInputToCents(feeDollars) ?? 0,
      copyFeeCents: dollarInputToCents(copyFeeDollars) ?? 0,
    });
    setOpen(false);
  };

  useEffect(() => {
    if (!canWrite || !society || open) return;
    if (params.get("intent") !== "start-response") return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    openNew();
  }, [canWrite, open, openNew, params, setParams, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Records inspections"
        icon={<Eye size={16} />}
        iconColor="gray"
        subtitle="Log of who inspected official records and what fees were charged (s.24 — public may pay up to $10/day inspection + $0.50/page copies, $0.10 electronic)."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
            <Plus size={12} /> Log inspection
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="records inspection" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="inspections"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Eye size={14} />}
            label="All inspections"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "inspectedAtISO") return <span className="mono">{formatDate(record.inspectedAtISO)}</span>;
              if (field.name === "inspectorType") return record.isMember ? <Badge tone="info">Member</Badge> : <Badge>Public</Badge>;
              if (field.name === "feeCents") return <span className="mono">{money(record.feeCents)}</span>;
              return undefined;
            }}
            renderRowActions={(r) => (
              <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete inspection by ${r.inspectorName}`} disabled={!canWrite} onClick={() => remove({ id: r._id })}>
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title="Log records inspection"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save} disabled={!canWrite}>Save</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Inspector name">
              <input className="input" value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.isMember} onChange={(e) => setForm({ ...form, isMember: e.target.checked })} /> Member of the society (no fee)
            </label>
            <Field label="Records requested" hint="e.g. members register (excluded from public), bylaws, 2025 AGM minutes">
              <MarkdownEditor rows={4} value={form.recordsRequested} onChange={(markdown) => setForm({ ...form, recordsRequested: markdown })} />
            </Field>
            <Field label="Related document (optional)">
              <Select value={form.documentId ?? ""} onChange={(value) => setForm({ ...form, documentId: value || undefined })}
                options={[{ value: "", label: "— none —" }, ...(documents ?? []).map((d: any) => ({ value: d._id, label: d.title }))]} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Date"><DatePicker value={form.inspectedAtISO} onChange={(value) => setForm({ ...form, inspectedAtISO: value })} /></Field>
              <Field label="Delivery">
                <Select value={form.deliveryMethod} onChange={(value) => setForm({ ...form, deliveryMethod: value })}
                  options={[{ value: "in-person", label: "In-person" }, { value: "electronic", label: "Electronic" }]} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Inspection fee" hint="Dollars">
                <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.feeDollars} onChange={(e) => setForm({ ...form, feeDollars: e.target.value })} />
              </Field>
              <Field label="Copies (pages)">
                <input className="input" type="number" value={form.copyPages} onChange={(e) => setForm({ ...form, copyPages: Number(e.target.value) })} />
              </Field>
              <Field label="Copy fee" hint="Dollars">
                <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.copyFeeDollars} onChange={(e) => setForm({ ...form, copyFeeDollars: e.target.value })} />
              </Field>
            </div>
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
