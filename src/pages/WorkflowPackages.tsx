import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt } from "./_helpers";
import { Badge, Button, Drawer, Field, SettingsShell } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileJson, Plus, Trash2, Workflow } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";
import { Select } from "../components/Select";

export function WorkflowPackagesPage() {
  const society = useSociety();
  const packages = useQuery(api.workflowPackages.list, society ? { societyId: society._id } : "skip");
  const workflows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.workflowPackages.upsert);
  const remove = useMutation(api.workflowPackages.remove);
  const createFollowUpTask = useMutation(api.workflowPackages.createFollowUpTask);
  const markFiled = useMutation(api.workflowPackages.markFiled);
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

  const createPackageTask = async (row: any) => {
    await createFollowUpTask({ packageId: row._id });
    toast.success("Package task created");
  };

  const filePackage = async (row: any) => {
    await markFiled({ packageId: row._id });
    toast.success("Package marked filed");
  };

  return (
    <div className="page page--wide">
      <SettingsShell
        title="Workflow packages"
        icon={<FileJson size={16} />}
        iconColor="orange"
        description="Legal package metadata for events, effective dates, signer rosters, supporting documents, and payment references."
        tabs={[
          { id: "packages", label: "Packages", icon: <Workflow size={14} /> },
          { id: "lifecycle", label: "Lifecycle" },
        ]}
        activeTab="packages"
        actions={
          <Button variant="accent" onClick={openNew}>
            <Plus size={12} /> New package
          </Button>
        }
      >

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
                <th>Lifecycle</th>
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
                      <div>{optionLabel("eventTypes", row.eventType)}</div>
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
                    <td><PackageLifecycle lifecycle={row.lifecycle} /></td>
                    <td><Badge tone={toneForPackageStatus(row.status)}>{optionLabel("workflowPackageStatuses", row.status)}</Badge></td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => createPackageTask(row)}>Task</button>
                        {!row.lifecycle?.filed && <button className="btn btn--ghost btn--sm" onClick={() => filePackage(row)}>Filed</button>}
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
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No workflow packages yet.</td></tr>
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
              <OptionSelect label="Event type" setName="eventTypes" value={draft.eventType ?? ""} onChange={(value) => setDraft({ ...draft, eventType: value })} />
              <OptionSelect label="Status" setName="workflowPackageStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
            </div>
            <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
            <Field label="Workflow">
              <Select value={draft.workflowId ?? ""} onChange={value => setDraft({
  ...draft,
  workflowId: value || undefined
})} options={[{
  value: "",
  label: "No workflow"
}, ...(workflows ?? []).map((workflow: any) => ({
  value: workflow._id,
  label: workflow.name
}))]} className="input" />
            </Field>
            <Field label="Supporting document">
              <Select value={draft.supportingDocumentId ?? ""} onChange={value => setDraft({
  ...draft,
  supportingDocumentId: value || undefined
})} options={[{
  value: "",
  label: "No supporting document"
}, ...(documents ?? []).map((doc: any) => ({
  value: doc._id,
  label: doc.title
}))]} className="input" />
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
      </SettingsShell>
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

function PackageLifecycle({ lifecycle }: { lifecycle?: any }) {
  if (!lifecycle) return <span className="muted">-</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <Badge tone={lifecycle.signerState === "complete" ? "success" : lifecycle.signerState === "needed" ? "warn" : "neutral"}>
        {labelize(lifecycle.signerState)}
      </Badge>
      <Badge tone={lifecycle.paymentState === "transaction_linked" ? "success" : lifecycle.paymentState === "checkout_created" ? "info" : "neutral"}>
        {labelize(lifecycle.paymentState)}
      </Badge>
      <Badge tone={lifecycle.openTaskCount ? "warn" : "neutral"}>{lifecycle.openTaskCount ?? 0} open tasks</Badge>
      <Badge>{lifecycle.filingCount ?? 0} filings</Badge>
    </div>
  );
}

function toneForPackageStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("filed") || value.includes("ready")) return "success" as const;
  if (value.includes("signature") || value.includes("draft")) return "warn" as const;
  if (value.includes("cancel") || value.includes("archiv")) return "danger" as const;
  return "neutral" as const;
}
