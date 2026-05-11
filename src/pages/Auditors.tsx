import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Plus, Calculator, Trash2 } from "lucide-react";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";
import { Select } from "../components/Select";

/**
 * Auditor appointments. Metadata-driven table — the page still owns the
 * "New appointment" drawer because engagement-letter attachment needs a
 * document picker that doesn't fit the generic inline editor.
 */
export function AuditorsPage() {
  const society = useSociety();
  const items = useQuery(api.auditors.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.auditors.create);
  const update = useMutation(api.auditors.update);
  const remove = useMutation(api.auditors.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "auditorAppointment",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      firmName: "",
      engagementType: "ReviewEngagement",
      fiscalYear: new Date().getFullYear().toString(),
      appointedBy: "Directors",
      appointedAtISO: new Date().toISOString().slice(0, 10),
      independenceAttested: true,
      status: "Active",
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  const records = (items ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Auditor appointments"
        icon={<Calculator size={16} />}
        iconColor="green"
        subtitle="First auditor appointed by directors; subsequent appointments made by members at the AGM. Only independent CPAs or CPA firms may serve as auditors."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New appointment
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="auditor-appointment" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="auditors"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"auditorAppointments">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Calculator size={14} />}
            label="All appointments"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderRowActions={(r) => (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete auditor ${r.firmName}`}
                onClick={() => remove({ id: r._id })}
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

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New auditor appointment"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Firm name"><input className="input" value={form.firmName} onChange={(e) => setForm({ ...form, firmName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Engagement">
                <Select value={form.engagementType} onChange={value => setForm({
  ...form,
  engagementType: value
})} options={[{
  value: "",
  label: "Audit"
}, {
  value: "",
  label: "ReviewEngagement"
}, {
  value: "",
  label: "CompilationEngagement"
}]} className="input" />
              </Field>
              <Field label="Fiscal year"><input className="input" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} /></Field>
              <Field label="Appointed by">
                <Select value={form.appointedBy} onChange={value => setForm({
  ...form,
  appointedBy: value
})} options={[{
  value: "",
  label: "Directors"
}, {
  value: "",
  label: "Members"
}]} className="input" />
              </Field>
            </div>
            <Field label="Appointed on"><input className="input" type="date" value={form.appointedAtISO} onChange={(e) => setForm({ ...form, appointedAtISO: e.target.value })} /></Field>
            <Field label="Engagement letter">
              <Select value={form.engagementLetterDocId ?? ""} onChange={value => setForm({
  ...form,
  engagementLetterDocId: value || undefined
})} options={[{
  value: "",
  label: "— none —"
}, ...(documents ?? []).map((d: any) => ({
  value: d._id,
  label: d.title
}))]} className="input" />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.independenceAttested} onChange={(e) => setForm({ ...form, independenceAttested: e.target.checked })} /> Firm has confirmed independence from the society
            </label>
          </div>
        )}
      </Drawer>
    </div>
  );
}
