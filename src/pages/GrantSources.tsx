import { usePermissions } from "@/hooks/usePermissions";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { BadgeDollarSign, Globe2, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { GrantSourceLibrarySection } from "../features/grants/components/GrantSourceLibrary";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { formatDate } from "../lib/format";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

const LOCAL_DISCOVERY_NOTE = "Feed discovery needs a connected server; add opportunities manually.";

export function GrantSourcesPage() {
  const society = useSociety();
  const sourceLibrary = useQuery(
    api.grantSources.listWithLibrary,
    society ? { societyId: society._id } : "skip",
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Grant sources"
        icon={<Globe2 size={16} />}
        iconColor="green"
        subtitle="Where grant opportunities come from, and the queue to triage them."
        actions={
          <Link className="btn-action" to="/app/grants">
            <BadgeDollarSign size={12} aria-hidden="true" /> Grant pipeline
          </Link>
        }
      />

      <GrantOpportunityQueue societyId={society._id} />

      <GrantSourceLibrarySection
        societyId={society._id}
        sourceLibrary={sourceLibrary}
      />
    </div>
  );
}

type Candidate = Doc<"grantOpportunityCandidates">;
type CandidateRecord = {
  _id: string;
  title: string;
  status: string;
  funder: string | null;
  amountText: string | null;
  applicationDueDate: string | null;
  candidate: Candidate;
};
type OpportunityForm = { title: string; funder: string; opportunityUrl: string; applicationDueDate: string; amountText: string };

const EMPTY_FORM: OpportunityForm = { title: "", funder: "", opportunityUrl: "", applicationDueDate: "", amountText: "" };

const CANDIDATE_TONES: Record<string, "neutral" | "info" | "success" | "danger"> = {
  New: "info",
  Reviewing: "neutral",
  Accepted: "success",
  Rejected: "danger",
  Duplicate: "neutral",
};

const CANDIDATES_TABLE = staticRecordTable({
  id: "grant-opportunity-queue",
  nameSingular: "grantOpportunity",
  namePlural: "grantOpportunities",
  labelSingular: "Opportunity",
  labelPlural: "Opportunities",
  labelIdentifierFieldName: "title",
  fields: [
    { name: "title", label: "Opportunity", fieldType: FIELD_TYPES.TEXT, size: 300, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "New", label: "New", color: "blue" },
          { value: "Reviewing", label: "Reviewing", color: "gray" },
          { value: "Accepted", label: "Accepted", color: "green" },
          { value: "Rejected", label: "Rejected", color: "red" },
          { value: "Duplicate", label: "Duplicate", color: "gray" },
        ],
      },
    },
    { name: "funder", label: "Funder", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "amountText", label: "Amount", fieldType: FIELD_TYPES.TEXT, size: 150, config: { groupable: false } },
    { name: "applicationDueDate", label: "Due", fieldType: FIELD_TYPES.DATE, size: 130 },
  ],
});

function GrantOpportunityQueue({ societyId }: { societyId: Id<"societies"> }) {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("grants:write");
  const canDiscover = canWrite && !isLocalDataRuntime() && (typeof navigator === "undefined" || navigator.onLine);
  const toast = useToast();
  const candidates = useQuery(api.grantSources.candidates, { societyId }) as Candidate[] | undefined;
  const sources = useQuery(api.grantSources.list, { societyId }) as Doc<"grantSources">[] | undefined;
  const createCandidate = useMutation(api.grantSources.createCandidate);
  const setStatus = useMutation(api.grantSources.setCandidateStatus);
  const discover = useAction(api.grantSources.discoverFromSource);
  const [form, setForm] = useState<OpportunityForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [discoverSourceId, setDiscoverSourceId] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const records = useMemo<CandidateRecord[]>(
    () => (candidates ?? []).map((candidate) => ({
      _id: candidate._id,
      title: candidate.title,
      status: candidate.status,
      funder: candidate.funder ?? null,
      amountText: candidate.amountText ?? null,
      applicationDueDate: candidate.applicationDueDate ?? null,
      candidate,
    })),
    [candidates],
  );

  const runDiscover = async () => {
    if (!canDiscover || discovering) return;
    if (!discoverSourceId) {
      toast.info("Choose a source to discover from.");
      return;
    }
    setDiscovering(true);
    try {
      const result = await discover({ societyId, sourceId: discoverSourceId });
      toast.success(`Discovered ${result.inserted} new opportunit${result.inserted === 1 ? "y" : "ies"} (${result.found} in feed).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const openCount = (candidates ?? []).filter((c) => c.status !== "Rejected" && c.status !== "Duplicate").length;

  const save = async () => {
    if (!canWrite || !form || saving) return;
    if (!form.title.trim()) {
      toast.info("Give the opportunity a title.");
      return;
    }
    setSaving(true);
    try {
      await createCandidate({
        societyId,
        title: form.title.trim(),
        funder: form.funder || undefined,
        opportunityUrl: form.opportunityUrl || undefined,
        applicationDueDate: form.applicationDueDate || undefined,
        amountText: form.amountText || undefined,
      });
      setForm(null);
      toast.success("Opportunity added to the queue");
    } catch (error) {
      toast.error("Opportunity not added", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const review = async (candidate: Candidate, status: "Accepted" | "Rejected") => {
    await setStatus({ candidateId: candidate._id, status });
    if (status === "Accepted") toast.success("Accepted");
    else toast.info("Rejected");
  };

  const renderCell = ({ record, field }: { record: CandidateRecord; field: FieldMetadata }) => {
    if (field.name === "title") {
      const url = record.candidate.opportunityUrl;
      return url ? <a href={url} target="_blank" rel="noreferrer"><strong>{record.title}</strong></a> : <strong>{record.title}</strong>;
    }
    if (field.name === "status") return <Badge tone={CANDIDATE_TONES[record.status] ?? "neutral"}>{record.status}</Badge>;
    return undefined;
  };

  const renderRowActions = ({ candidate }: CandidateRecord) => (
    <>
      {candidate.status !== "Accepted" && (
        <button className="btn btn--sm" onClick={() => review(candidate, "Accepted")} disabled={!canWrite}>Accept</button>
      )}
      {candidate.status !== "Rejected" && (
        <button className="btn btn--sm btn--ghost" onClick={() => review(candidate, "Rejected")} disabled={!canWrite}>Reject</button>
      )}
    </>
  );

  const renderPhoneCard = (record: CandidateRecord, { selecting }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={record.title}
      badge={<Badge tone={CANDIDATE_TONES[record.status] ?? "neutral"}>{record.status}</Badge>}
      meta={[record.funder ?? "", record.amountText ?? "", record.applicationDueDate ? `Due ${formatDate(record.applicationDueDate)}` : ""]}
      selecting={selecting}
    />
  );

  return (
    <section className="card grant-queue" aria-labelledby="grant-queue-title">
      <div className="card__head grant-queue__head">
        <h2 className="card__title" id="grant-queue-title">Opportunity queue</h2>
        <span className="card__subtitle">{openCount} open</span>
        <div className="row grant-queue__actions">
          {(sources ?? []).length > 0 && (
            <>
              <Select
                aria-label="Grant discovery source"
                className="grant-queue__source"
                value={discoverSourceId}
                onChange={setDiscoverSourceId}
                placeholder="Choose a source…"
                options={(sources ?? []).map((source) => ({ value: source._id, label: source.name }))}
              />
              <button className="btn-action" disabled={!canDiscover || discovering || !discoverSourceId} onClick={runDiscover}>
                <RefreshCw size={12} /> Discover
              </button>
            </>
          )}
          <button className="btn-action btn-action--primary" onClick={() => setForm({ ...EMPTY_FORM })} disabled={!canWrite}>
            <Plus size={12} /> Add opportunity
          </button>
        </div>
      </div>
      {isLocalDataRuntime() && (
        <div className="card__body">
          <Banner tone="info">{LOCAL_DISCOVERY_NOTE}</Banner>
        </div>
      )}
      <RecordListTable<CandidateRecord>
        variant="card"
        table={CANDIDATES_TABLE}
        tableId="grant-opportunity-queue"
        label="Opportunities"
        icon={<Globe2 size={14} />}
        records={records}
        loading={candidates === undefined}
        renderCell={renderCell}
        renderRowActions={renderRowActions}
        renderPhoneCard={renderPhoneCard}
        emptyState={<RecordTableEmpty title="No opportunities yet" description={canWrite ? "Add one by hand, or discover them from a source." : undefined} />}
      />

      <AddOpportunityDrawer form={form} onChange={setForm} onSave={save} saving={saving} canWrite={canWrite} />
    </section>
  );
}

/** The queue's "Add opportunity" form, for an opportunity entered by hand. */
function AddOpportunityDrawer({
  form,
  onChange,
  onSave,
  saving,
  canWrite,
}: {
  form: OpportunityForm | null;
  onChange: (form: OpportunityForm | null) => void;
  onSave: () => void;
  saving: boolean;
  canWrite: boolean;
}) {
  return (
    <Drawer
      open={Boolean(form)}
      onClose={() => onChange(null)}
      title="Add opportunity"
      footer={
        <>
          <button className="btn" onClick={() => onChange(null)}>Cancel</button>
          <button className="btn btn--accent" onClick={onSave} disabled={!canWrite || saving}>
            <Plus size={14} /> {saving ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      {form && (
        <div>
          <Field label="Title">
            <input className="input" value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} placeholder="Community Capacity Grant 2026" />
          </Field>
          <Field label="Funder">
            <input className="input" value={form.funder} onChange={(e) => onChange({ ...form, funder: e.target.value })} />
          </Field>
          <Field label="Due date">
            <DatePicker value={form.applicationDueDate} onChange={(value) => onChange({ ...form, applicationDueDate: value })} />
          </Field>
          <Field label="Amount">
            <input className="input" value={form.amountText} onChange={(e) => onChange({ ...form, amountText: e.target.value })} placeholder="Up to $25,000" />
          </Field>
          <Field label="Opportunity URL">
            <input className="input" value={form.opportunityUrl} onChange={(e) => onChange({ ...form, opportunityUrl: e.target.value })} placeholder="https://…" />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
