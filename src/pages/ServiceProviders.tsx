import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Briefcase, Plus } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { todayDateOnly } from "../../shared/dateOnly";
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

/**
 * External service-provider register — lawyers, accountants, bankers and the
 * like. A row with no removedOn (or a removedOn in the future) is still
 * active. Each row carries a derived `status` (active/former) so the seeded
 * "Active providers" view filters on it like any other field.
 */
export function ServiceProvidersPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("settings:write");
  const items = useQuery(
    api.serviceProviders.list,
    society ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id: string;
        function: string;
        firmName: string;
        contactName?: string;
        firmLocation?: string;
        appointedOn?: string;
        removedOn?: string;
      }>
    | undefined;
  const catalog = useQuery(api.serviceProviders.functionsCatalog, {}) as
    | Array<{ value: string; label: string }>
    | undefined;
  const upsert = usePermissionedMutation(api.serviceProviders.upsert, canWrite);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "serviceProvider",
    viewId: currentViewId,
  });
  // Workspaces seeded before this register became a table get its metadata
  // once; the seed mutation is idempotent.
  const ensureMetadata = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const metadataHealRef = useRef<string | null>(null);
  const needsMetadata = !tableData.loading && !tableData.objectMetadata;
  useEffect(() => {
    if (!society?._id || !needsMetadata || !loaded || !can("settings:write")) return;
    if (metadataHealRef.current === String(society._id)) return;
    metadataHealRef.current = String(society._id);
    void ensureMetadata({ societyId: society._id }).catch(() => undefined);
  }, [society?._id, needsMetadata, loaded, can, ensureMetadata]);

  const today = todayDateOnly();
  const records = useMemo(
    () => (items ?? []).map((row) => ({ ...row, status: !row.removedOn || row.removedOn > today ? "active" : "former" })),
    [items, today],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      function: catalog?.[0]?.value ?? "",
      firmName: "",
      contactName: "",
      firmLocation: "",
      appointedOn: today,
      removedOn: "",
    });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setForm({
      id: row._id,
      function: row.function ?? "",
      firmName: row.firmName ?? "",
      contactName: row.contactName ?? "",
      firmLocation: row.firmLocation ?? "",
      appointedOn: row.appointedOn ?? "",
      removedOn: row.removedOn ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!canWrite || !form) return;
    await upsert({
      id: form.id,
      societyId: society._id,
      function: form.function,
      firmName: form.firmName,
      contactName: form.contactName || undefined,
      firmLocation: form.firmLocation || undefined,
      appointedOn: form.appointedOn || undefined,
      removedOn: form.removedOn || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Service providers"
        icon={<Briefcase size={16} />}
        iconColor="purple"
        subtitle="Lawyers, accountants, bankers and other advisers, with when each was appointed and removed."
        actions={
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
            <Plus size={12} /> New provider
          </button>
        }
      />

      {needsMetadata ? (
        <RecordTableMetadataEmpty societyId={society._id} objectLabel="service provider" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="service-providers"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, record) => openEdit(record)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Briefcase size={14} />}
            label="Service providers"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable loading={tableData.loading || items === undefined} />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={form?.id ? (canWrite ? "Edit service provider" : "Service provider") : "New service provider"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" disabled={!canWrite} onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Function">
              <Select
                disabled={!canWrite}
                value={form.function}
                onChange={(value) => setForm({ ...form, function: value })}
                options={(catalog ?? []).map((c) => ({ value: c.value, label: c.label }))}
              />
            </Field>
            <Field label="Firm name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.firmName}
                onChange={(e) => setForm({ ...form, firmName: e.target.value })}
              />
            </Field>
            <Field label="Contact name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </Field>
            <Field label="Firm location">
              <input
                disabled={!canWrite}
                className="input"
                value={form.firmLocation}
                onChange={(e) => setForm({ ...form, firmLocation: e.target.value })}
              />
            </Field>
            <div className="row" style={{ display: "flex", gap: 12 }}>
              <Field label="Appointed on">
                <DatePicker
                disabled={!canWrite}
                  value={form.appointedOn}
                  onChange={(value) => setForm({ ...form, appointedOn: value })}
                />
              </Field>
              <Field label="Removed on">
                <DatePicker
                disabled={!canWrite}
                  value={form.removedOn}
                  onChange={(value) => setForm({ ...form, removedOn: value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default ServiceProvidersPage;
