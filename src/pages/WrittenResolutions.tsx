import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { Progress } from "../components/primitives";
import { Plus, PenLine, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
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
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

export function WrittenResolutionsPage() {
  const society = useSociety();
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const items = useQuery(api.writtenResolutions.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.writtenResolutions.create);
  const sign = useMutation(api.writtenResolutions.sign);
  const markFailed = useMutation(api.writtenResolutions.markFailed);
  const remove = useMutation(api.writtenResolutions.remove);
  const prompt = usePrompt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "writtenResolution",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const records = useMemo(
    () => (items ?? []).map((r: any) => ({ ...r, signatureCount: r.signatures?.length ?? 0 })),
    [items],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const eligibleVoters = (members ?? []).filter((m: any) => m.status === "Active" && m.votingRights).length;

  const openNew = () => {
    setForm({
      title: "",
      text: "",
      kind: "Special",
      requiredCount: eligibleVoters,
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Written resolutions"
        icon={<PenLine size={16} />}
        iconColor="purple"
        subtitle="Members' resolutions in lieu of a meeting — ordinary resolutions need majority consent in writing; special resolutions need unanimous written consent from all voting members."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New resolution
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="written resolution" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="writtenResolutions"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<PenLine size={14} />}
            label="All written resolutions"
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
              if (field.name === "kind") return <Badge tone={record.kind === "Special" ? "warn" : "neutral"}>{record.kind}</Badge>;
              if (field.name === "circulatedAtISO") return <span className="mono">{formatDate(record.circulatedAtISO)}</span>;
              if (field.name === "signatureCount") {
                const count = record.signatures?.length ?? 0;
                return (
                  <div style={{ minWidth: 140 }}>
                    <Progress value={Math.min(100, (count / Math.max(1, record.requiredCount)) * 100)} tone={count >= record.requiredCount ? "success" : undefined} />
                    <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>{count} / {record.requiredCount}</div>
                  </div>
                );
              }
              if (field.name === "status") return <Badge tone={record.status === "Carried" ? "success" : record.status === "Failed" ? "danger" : "warn"}>{record.status}</Badge>;
              return undefined;
            }}
            renderRowActions={(r) => (
              <>
                {r.status === "Circulating" && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      const name = await prompt({
                        title: "Sign resolution",
                        message: "Enter the name of the signer as it will appear on the record.",
                        placeholder: "Full name",
                        confirmLabel: "Sign",
                        required: true,
                      });
                      if (!name) return;
                      await sign({ id: r._id, signerName: name });
                      toast.success(`Signed by ${name}`);
                    }}
                  >
                    <PenLine size={12} /> Sign
                  </button>
                )}
                {r.status === "Circulating" && (
                  <button className="btn btn--ghost btn--sm" onClick={() => markFailed({ id: r._id })}>Mark failed</button>
                )}
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete written resolution ${r.title}`} onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New written resolution"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Circulate</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Resolution text"><MarkdownEditor rows={4} value={form.text} onChange={(markdown) => setForm({ ...form, text: markdown })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind">
                <Select value={form.kind} onChange={(value) => {
                  const k = value;
                  setForm({ ...form, kind: k, requiredCount: k === "Special" ? eligibleVoters : Math.ceil(eligibleVoters / 2) });
                }}
                  options={[
                    { value: "Ordinary", label: "Ordinary (majority)" },
                    { value: "Special", label: "Special (unanimous, in lieu of meeting)" },
                  ]} />
              </Field>
              <Field label="Required signatures" hint={`Eligible voting members: ${eligibleVoters}`}>
                <input className="input" type="number" value={form.requiredCount} onChange={(e) => setForm({ ...form, requiredCount: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
