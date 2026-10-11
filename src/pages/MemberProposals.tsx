import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Plus, Vote, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { useBylawRules } from "../hooks/useBylawRules";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
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

export function MemberProposalsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("motions:write");
  const { rules } = useBylawRules();
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const items = useQuery(api.memberProposals.list, society ? { societyId: society._id } : "skip");
  const create = usePermissionedMutation(api.memberProposals.create, canWrite);
  const update = usePermissionedMutation(api.memberProposals.update, canWrite);
  const remove = usePermissionedMutation(api.memberProposals.remove, canWrite);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "memberProposal",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const eligibleVoters = (members ?? []).filter((m: any) => m.status === "Active" && m.votingRights).length;

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      title: "",
      text: "",
      submittedByName: "",
      submittedAtISO: todayDateOnly(),
      signatureCount: 1,
      thresholdPercent: rules?.memberProposalThresholdPct ?? 5,
      eligibleVotersAtSubmission: eligibleVoters,
    });
    setOpen(true);
  };
  const save = async () => {
    if (!canWrite) return;
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Member proposals"
        icon={<Vote size={16} />}
        iconColor="purple"
        subtitle={`Proposals from members. ${eligibleVoters} voting members today.`}
        info={
          <p>
            Under the active rules a proposal needs at least {rules?.memberProposalThresholdPct ?? 5}% of voting members (and no fewer than{" "}
            {rules?.memberProposalMinSignatures ?? 1}), received at least {rules?.memberProposalLeadDays ?? 7} days before the AGM notice goes out.
          </p>
        }
        actions={
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
            <Plus size={12} /> New proposal
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="member proposal" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="memberProposals"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={(items ?? []) as any[]}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Vote size={14} />}
            label="All proposals"
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
              if (field.name === "submittedAtISO") return <span className="mono">{formatDate(record.submittedAtISO)}</span>;
              if (field.name === "signatureCount") {
                const req = Math.max(
                  rules?.memberProposalMinSignatures ?? 1,
                  Math.ceil((record.eligibleVotersAtSubmission ?? 0) * (record.thresholdPercent / 100)),
                );
                return <span><strong>{record.signatureCount}</strong><span className="muted"> / {req} req ({record.thresholdPercent}%)</span></span>;
              }
              if (field.name === "status") {
                return <Badge tone={record.status === "MeetsThreshold" || record.status === "Included" ? "success" : record.status === "Rejected" ? "danger" : "warn"}>{record.status}</Badge>;
              }
              return undefined;
            }}
            renderRowActions={(r) => (
              <>
                {!r.includedInAgenda && r.status === "MeetsThreshold" && (
                  <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => canWrite && update({ id: r._id, patch: { includedInAgenda: true, status: "Included" } })}>Include</button>
                )}
                {r.status !== "Rejected" && (
                  <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => canWrite && update({ id: r._id, patch: { status: "Rejected" } })}>Reject</button>
                )}
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete proposal ${r.title}`} disabled={!canWrite} onClick={() => canWrite && remove({ id: r._id })}><Trash2 size={12} /></button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title="New member proposal"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" disabled={!canWrite} onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Proposal text"><MarkdownEditor rows={4} value={form.text} onChange={(markdown) => setForm({ ...form, text: markdown })} /></Field>
            <Field label="Submitted by"><input className="input" value={form.submittedByName} onChange={(e) => setForm({ ...form, submittedByName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Submitted on"><DatePicker value={form.submittedAtISO} onChange={(value) => setForm({ ...form, submittedAtISO: value })} /></Field>
              <Field label="Signature count"><input className="input" type="number" value={form.signatureCount} onChange={(e) => setForm({ ...form, signatureCount: Number(e.target.value) })} /></Field>
              <Field label="Threshold %"><input className="input" type="number" value={form.thresholdPercent} onChange={(e) => setForm({ ...form, thresholdPercent: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Eligible voters at submission"><input className="input" type="number" value={form.eligibleVotersAtSubmission ?? eligibleVoters} onChange={(e) => setForm({ ...form, eligibleVotersAtSubmission: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
