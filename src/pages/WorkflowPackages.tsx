import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Trash2, Workflow } from "lucide-react";
import { formatDate } from "../lib/format";

export function WorkflowPackagesPage() {
  const society = useSociety();
  const packages = useQuery(api.workflowPackages.list, society ? { societyId: society._id } : "skip");
  const workflows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.workflowPackages.upsert);
  const remove = useMutation(api.workflowPackages.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const workflowById = useMemo(
    () => new Map<string, any>((workflows ?? []).map((workflow: any) => [workflow._id, workflow])),
    [workflows],
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      eventType: "custom.event",
      packageName: "",
      status: "draft",
      partsText: "",
      priceItemsText: "",
      signerRosterText: "",
      signerEmailsText: "",
      signingPackageIdsText: "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      workflowId: draft.workflowId || undefined,
      workflowRunId: draft.workflowRunId || undefined,
      eventType: draft.eventType || "custom.event",
      effectiveDate: draft.effectiveDate || undefined,
      status: draft.status || "draft",
      packageName: draft.packageName || "Untitled package",
      parts: csv(draft.partsText ?? draft.parts),
      notes: draft.notes || undefined,
      supportingDocumentIds: draft.supportingDocumentId ? [draft.supportingDocumentId] : draft.supportingDocumentIds ?? [],
      priceItems: csv(draft.priceItemsText ?? draft.priceItems),
      transactionId: draft.transactionId || undefined,
      signerRoster: csv(draft.signerRosterText ?? draft.signerRoster),
      signerEmails: csv(draft.signerEmailsText ?? draft.signerEmails),
      signingPackageIds: csv(draft.signingPackageIdsText ?? draft.signingPackageIds),
      stripeCheckoutSessionId: draft.stripeCheckoutSessionId || undefined,
    });
    setOpen(false);
    setDraft(null);
    toast.success("Workflow package saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete workflow package?",
      message: `"${row.packageName}" will be removed from legal package tracking.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Workflow package deleted");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Workflow packages"
        icon={<Workflow size={16} />}
        iconColor="orange"
        subtitle="Legal package metadata for events, effective dates, signer rosters, supporting documents, and payment references."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New package
          </button>
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Packages</h2>
          <Badge>{packages?.length ?? 0}</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Event</th>
                <th>Workflow</th>
                <th>Signers</th>
                <th>Commerce</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(packages ?? []).map((row: any) => {
                const workflow = row.workflowId ? workflowById.get(row.workflowId) : null;
                return (
                  <tr key={row._id}>
                    <td>
                      <strong>{row.packageName}</strong>
                      <div className="muted">{row.effectiveDate ? formatDate(row.effectiveDate) : "No effective date"}</div>
                    </td>
                    <td>
                      <div className="mono">{row.eventType}</div>
                      <div className="muted">{row.parts?.length ? `${row.parts.length} parts` : "No parts listed"}</div>
                    </td>
                    <td>
                      {workflow ? <Link to={`/app/workflows/${workflow._id}`}>{workflow.name}</Link> : <span className="muted">Not linked</span>}
                    </td>
                    <td>
                      <div>{row.signerRoster?.length || 0} people</div>
                      <div className="muted">{row.signerEmails?.length || 0} emails</div>
                    </td>
                    <td>
                      <div>{row.priceItems?.length ? row.priceItems.join(", ") : "No price items"}</div>
                      <div className="mono muted">{row.stripeCheckoutSessionId || row.transactionId || ""}</div>
                    </td>
                    <td><Badge tone={toneForPackageStatus(row.status)}>{labelize(row.status)}</Badge></td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => {
                            setDraft({
                              ...row,
                              supportingDocumentId: row.supportingDocumentIds?.[0],
                              partsText: (row.parts ?? []).join(", "),
                              priceItemsText: (row.priceItems ?? []).join(", "),
                              signerRosterText: (row.signerRoster ?? []).join(", "),
                              signerEmailsText: (row.signerEmails ?? []).join(", "),
                              signingPackageIdsText: (row.signingPackageIds ?? []).join(", "),
                            });
                            setOpen(true);
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn btn--ghost btn--sm btn--icon" aria-label="Delete workflow package" onClick={() => confirmDelete(row)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(packages ?? []).length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No workflow packages yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit workflow package" : "New workflow package"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Package name"><input className="input" value={draft.packageName ?? ""} onChange={(e) => setDraft({ ...draft, packageName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Event type"><input className="input mono" value={draft.eventType ?? ""} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })} /></Field>
              <Field label="Status"><input className="input" value={draft.status ?? ""} onChange={(e) => setDraft({ ...draft, status: e.target.value })} /></Field>
            </div>
            <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
            <Field label="Workflow">
              <select className="input" value={draft.workflowId ?? ""} onChange={(e) => setDraft({ ...draft, workflowId: e.target.value || undefined })}>
                <option value="">No workflow</option>
                {(workflows ?? []).map((workflow: any) => <option key={workflow._id} value={workflow._id}>{workflow.name}</option>)}
              </select>
            </Field>
            <Field label="Supporting document">
              <select className="input" value={draft.supportingDocumentId ?? ""} onChange={(e) => setDraft({ ...draft, supportingDocumentId: e.target.value || undefined })}>
                <option value="">No supporting document</option>
                {(documents ?? []).map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}
              </select>
            </Field>
            <Field label="Parts"><input className="input" value={draft.partsText ?? ""} onChange={(e) => setDraft({ ...draft, partsText: e.target.value })} placeholder="Resolution, filing, receipt" /></Field>
            <Field label="Signer roster"><input className="input" value={draft.signerRosterText ?? ""} onChange={(e) => setDraft({ ...draft, signerRosterText: e.target.value })} /></Field>
            <Field label="Signer emails"><input className="input" value={draft.signerEmailsText ?? ""} onChange={(e) => setDraft({ ...draft, signerEmailsText: e.target.value })} /></Field>
            <Field label="Signing package IDs"><input className="input mono" value={draft.signingPackageIdsText ?? ""} onChange={(e) => setDraft({ ...draft, signingPackageIdsText: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Transaction ID"><input className="input mono" value={draft.transactionId ?? ""} onChange={(e) => setDraft({ ...draft, transactionId: e.target.value })} /></Field>
              <Field label="Stripe checkout session"><input className="input mono" value={draft.stripeCheckoutSessionId ?? ""} onChange={(e) => setDraft({ ...draft, stripeCheckoutSessionId: e.target.value })} /></Field>
            </div>
            <Field label="Price items"><input className="input" value={draft.priceItemsText ?? ""} onChange={(e) => setDraft({ ...draft, priceItemsText: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

function csv(value: any) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function labelize(value?: string) {
  return String(value ?? "-").replace(/_/g, " ");
}

function toneForPackageStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("filed") || value.includes("ready")) return "success" as const;
  if (value.includes("signature") || value.includes("draft")) return "warn" as const;
  if (value.includes("cancel") || value.includes("archiv")) return "danger" as const;
  return "neutral" as const;
}
