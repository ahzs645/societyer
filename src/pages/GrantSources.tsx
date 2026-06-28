import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ArrowLeft, BadgeDollarSign, Globe2, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/convexApi";
import { GrantSourceLibrarySection } from "../features/grants/components/GrantSourceLibrary";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { useToast } from "../components/Toast";

export function GrantSourcesPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
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
        subtitle="Built-in and workspace grant discovery sources, extraction notes, and source profiles."
        actions={
          <>
            <Link className="btn-action" to="/app/grants">
              <ArrowLeft size={12} /> Grants
            </Link>
            <Link className="btn-action" to="/app/grants">
              <BadgeDollarSign size={12} /> Grant pipeline
            </Link>
          </>
        }
      />

      <GrantOpportunityQueue societyId={society._id} />

      <GrantSourceLibrarySection
        actingUserId={actingUserId}
        societyId={society._id}
        sourceLibrary={sourceLibrary}
      />
    </div>
  );
}

const CANDIDATE_TONES: Record<string, "neutral" | "info" | "success" | "danger"> = {
  New: "info",
  Reviewing: "neutral",
  Accepted: "success",
  Rejected: "danger",
  Duplicate: "neutral",
};

function GrantOpportunityQueue({ societyId }: { societyId: any }) {
  const toast = useToast();
  const candidates = useQuery(api.grantSources.candidates, { societyId });
  const sources = useQuery(api.grantSources.list, { societyId });
  const createCandidate = useMutation(api.grantSources.createCandidate);
  const setStatus = useMutation(api.grantSources.setCandidateStatus);
  const discover = useAction(api.grantSources.discoverFromSource);
  const [adding, setAdding] = useState(false);
  const [discoverSourceId, setDiscoverSourceId] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [form, setForm] = useState({ title: "", funder: "", opportunityUrl: "", applicationDueDate: "", amountText: "" });

  const runDiscover = async () => {
    if (!discoverSourceId) {
      toast.info("Choose a source to discover from.");
      return;
    }
    setDiscovering(true);
    try {
      const result = await discover({ societyId, sourceId: discoverSourceId as any });
      toast.success(`Discovered ${result.inserted} new opportunit${result.inserted === 1 ? "y" : "ies"} (${result.found} in feed).`);
    } catch (err: any) {
      toast.error(err?.message ?? "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const active = (candidates ?? []).filter((c: any) => c.status !== "Rejected" && c.status !== "Duplicate");

  const save = async () => {
    if (!form.title.trim()) {
      toast.info("Give the opportunity a title.");
      return;
    }
    await createCandidate({
      societyId,
      title: form.title.trim(),
      funder: form.funder || undefined,
      opportunityUrl: form.opportunityUrl || undefined,
      applicationDueDate: form.applicationDueDate || undefined,
      amountText: form.amountText || undefined,
    });
    setForm({ title: "", funder: "", opportunityUrl: "", applicationDueDate: "", amountText: "" });
    setAdding(false);
    toast.success("Opportunity added to the queue");
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Opportunity queue</h2>
        <span className="card__subtitle">{active.length} open · triage discovered or manually-added grant opportunities</span>
        <div className="row" style={{ gap: 6, marginLeft: "auto", alignItems: "center" }}>
          {(sources ?? []).length > 0 && (
            <>
              <select className="input" value={discoverSourceId} onChange={(e) => setDiscoverSourceId(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">Discover from source…</option>
                {(sources ?? []).map((s: any) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
              <button className="btn-action" disabled={discovering || !discoverSourceId} onClick={runDiscover}>
                <RefreshCw size={12} /> Discover
              </button>
            </>
          )}
          <button className="btn-action btn-action--primary" onClick={() => setAdding((v) => !v)}>
            <Plus size={12} /> {adding ? "Close" : "Add opportunity"}
          </button>
        </div>
      </div>
      <div className="card__body col" style={{ gap: 10 }}>
        {adding && (
          <div className="col" style={{ gap: 8 }}>
            <Field label="Title">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Community Capacity Grant 2026" />
            </Field>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Field label="Funder"><input className="input" value={form.funder} onChange={(e) => setForm({ ...form, funder: e.target.value })} /></Field>
              <Field label="Due date"><input className="input" type="date" value={form.applicationDueDate} onChange={(e) => setForm({ ...form, applicationDueDate: e.target.value })} /></Field>
              <Field label="Amount"><input className="input" value={form.amountText} onChange={(e) => setForm({ ...form, amountText: e.target.value })} placeholder="Up to $25,000" /></Field>
            </div>
            <Field label="Opportunity URL"><input className="input" value={form.opportunityUrl} onChange={(e) => setForm({ ...form, opportunityUrl: e.target.value })} placeholder="https://…" /></Field>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--accent" onClick={save}><Plus size={14} /> Add</button>
            </div>
          </div>
        )}
        {(candidates ?? []).length === 0 ? (
          <div className="muted">No opportunities yet. Add one above to start a review queue.</div>
        ) : (
          (candidates ?? []).map((c: any) => (
            <div key={c._id} className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
              <span>
                <Badge tone={CANDIDATE_TONES[c.status] ?? "neutral"}>{c.status}</Badge>{" "}
                {c.opportunityUrl ? <a href={c.opportunityUrl} target="_blank" rel="noreferrer"><strong>{c.title}</strong></a> : <strong>{c.title}</strong>}
                <span className="muted">
                  {c.funder ? ` · ${c.funder}` : ""}{c.amountText ? ` · ${c.amountText}` : ""}{c.applicationDueDate ? ` · due ${c.applicationDueDate}` : ""}
                </span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                {c.status !== "Accepted" && (
                  <button className="btn btn--sm" onClick={async () => { await setStatus({ candidateId: c._id, status: "Accepted" }); toast.success("Accepted"); }}>Accept</button>
                )}
                {c.status !== "Rejected" && (
                  <button className="btn btn--sm btn--ghost" onClick={async () => { await setStatus({ candidateId: c._id, status: "Rejected" }); toast.info("Rejected"); }}>Reject</button>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
