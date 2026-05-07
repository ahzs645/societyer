import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Plus, Gavel, Trash2 } from "lucide-react";
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

/**
 * Court orders affecting the society — required to be kept with
 * governance records under s.20. Detail table uses the metadata-driven
 * record grid; the page keeps its own "Record order" drawer so new rows
 * can attach a document.
 */
export function CourtOrdersPage() {
  const society = useSociety();
  const items = useQuery(api.courtOrders.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.courtOrders.create);
  const update = useMutation(api.courtOrders.update);
  const remove = useMutation(api.courtOrders.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "courtOrder",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      title: "",
      orderDate: new Date().toISOString().slice(0, 10),
      court: "Supreme Court of British Columbia",
      description: "",
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
        title="Court orders"
        icon={<Gavel size={16} />}
        iconColor="red"
        subtitle="Court orders affecting the society — required to be kept with governance records under s.20."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Record order
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="court-order" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="court-orders"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"courtOrders">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Gavel size={14} />}
            label="All court orders"
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
                aria-label={`Delete court order ${r.title}`}
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
        title="Record court order"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Court"><input className="input" value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} /></Field>
              <Field label="File #"><input className="input" value={form.fileNumber ?? ""} onChange={(e) => setForm({ ...form, fileNumber: e.target.value })} /></Field>
              <Field label="Order date"><input className="input" type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Document (optional)">
              <select className="input" value={form.documentId ?? ""} onChange={(e) => setForm({ ...form, documentId: e.target.value || undefined })}>
                <option value="">— none —</option>
                {(documents ?? []).map((d: any) => <option key={d._id} value={d._id}>{d.title}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option>Active</option><option>Satisfied</option><option>Vacated</option>
              </select>
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
