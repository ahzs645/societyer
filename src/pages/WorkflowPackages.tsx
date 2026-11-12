import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Button, Drawer, Field, SettingsShell } from "../components/ui";
import { InfoPopover } from "../components/InfoPopover";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileJson, Plus, Trash2, Workflow } from "lucide-react";
import { formatDate } from "../lib/format";
import { OPTION_SETS, optionLabel } from "../lib/orgHubOptions";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import type { Doc, Id } from "../../convex/_generated/dataModel";

type PackageLifecycleState = {
  signerState?: string;
  paymentState?: string;
  openTaskCount?: number;
  filingCount?: number;
  filed?: boolean;
};

type PackageRow = Doc<"workflowPackages"> & { lifecycle?: PackageLifecycleState };

type PackageRecord = {
  _id: Id<"workflowPackages">;
  packageName: string;
  effectiveDate: string | null;
  eventType: string;
  workflowName: string | null;
  documentTitle: string | null;
  signerCount: number;
  payment: string;
  lifecycle: string;
  status: string;
  pkg: PackageRow;
};

const SELECT_COLOR_FOR_TONE = { success: "green", warn: "orange", danger: "red", neutral: "gray" } as const;

const PACKAGES_TABLE = staticRecordTable({
  id: "workflow-packages",
  nameSingular: "workflowPackage",
  namePlural: "workflowPackages",
  labelSingular: "Workflow package",
  labelPlural: "Workflow packages",
  labelIdentifierFieldName: "packageName",
  density: "comfortable",
  fields: [
    { name: "packageName", label: "Package", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "effectiveDate", label: "Effective", fieldType: FIELD_TYPES.DATE, size: 130 },
    {
      name: "eventType",
      label: "Event",
      fieldType: FIELD_TYPES.SELECT,
      size: 200,
      config: { options: OPTION_SETS.eventTypes.map((option) => ({ value: option.value, label: option.label, color: "gray" })) },
    },
    { name: "workflowName", label: "Workflow", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "documentTitle", label: "Supporting document", fieldType: FIELD_TYPES.TEXT, size: 200, isVisible: false },
    { name: "signerCount", label: "Signers", fieldType: FIELD_TYPES.NUMBER, size: 110 },
    { name: "payment", label: "Payment", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "lifecycle", label: "Lifecycle", fieldType: FIELD_TYPES.TEXT, size: 320, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 170,
      config: {
        options: OPTION_SETS.workflowPackageStatuses.map((option) => ({
          value: option.value,
          label: option.label,
          color: SELECT_COLOR_FOR_TONE[toneForPackageStatus(option.value)],
        })),
      },
    },
  ],
});

export function WorkflowPackagesPage() {
  const society = useSociety();
  const canManage = usePermissions().can("tasks:write");
  const packages = useQuery(api.workflowPackages.list, society ? { societyId: society._id } : "skip");
  const workflows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.workflowPackages.upsert);
  const remove = useMutation(api.workflowPackages.remove);
  const createFollowUpTask = useMutation(api.workflowPackages.createFollowUpTask);
  const markFiled = useMutation(api.workflowPackages.markFiled);
  const confirm = useConfirm();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("packages");
  const [nameError, setNameError] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const packageRecords = useMemo<PackageRecord[]>(() => {
    const workflowNames = new Map<string, string>((workflows ?? []).map((workflow: { _id: string; name: string }) => [workflow._id, workflow.name]));
    const documentTitles = new Map<string, string>((documents ?? []).map((document: { _id: string; title: string }) => [document._id, document.title]));
    return ((packages ?? []) as PackageRow[]).map((pkg) => ({
      _id: pkg._id,
      packageName: pkg.packageName,
      effectiveDate: pkg.effectiveDate ?? null,
      eventType: pkg.eventType,
      workflowName: pkg.workflowId ? workflowNames.get(pkg.workflowId) ?? null : null,
      documentTitle: pkg.supportingDocumentIds?.[0] ? documentTitles.get(pkg.supportingDocumentIds[0]) ?? null : null,
      signerCount: pkg.signerRoster?.length ?? 0,
      payment: [pkg.priceItems?.join(", "), paymentStatusLabel(pkg.lifecycle?.paymentState), pkg.stripeCheckoutSessionId ?? pkg.transactionId].filter(Boolean).join(" · "),
      lifecycle: lifecycleText(pkg.lifecycle),
      status: pkg.status,
      pkg,
    }));
  }, [packages, workflows, documents]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canManage) return;
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
    if (!canManage || !draft) return;
    if (!String(draft.packageName ?? "").trim()) {
      setNameError("Name the package so it can be tracked.");
      return;
    }
    setNameError("");
    await upsert({
      id: draft._id,
      societyId: society._id,
      workflowId: draft.workflowId || undefined,
      workflowRunId: draft.workflowRunId || undefined,
      eventType: draft.eventType || "custom.event",
      effectiveDate: draft.effectiveDate || undefined,
      status: draft.status || "draft",
      packageName: String(draft.packageName).trim(),
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

  const editPackage = (row: PackageRow) => {
    if (!canManage) return;
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
  };

  const confirmDelete = async (row: PackageRow) => {
    if (!canManage) return;
    const ok = await confirm({
      title: "Delete workflow package?",
      message: `"${row.packageName}" will be removed from legal package tracking.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!canManage || !ok) return;
    await remove({ id: row._id });
    toast.success("Workflow package deleted");
  };

  const createPackageTask = async (row: PackageRow) => {
    if (!canManage) return;
    await createFollowUpTask({ packageId: row._id });
    toast.success("Package task created");
  };

  const filePackage = async (row: PackageRow) => {
    if (!canManage) return;
    await markFiled({ packageId: row._id });
    toast.success("Package marked filed");
  };

  return (
    <div className="page page--wide">
      <SettingsShell
        title="Workflow packages"
        icon={<FileJson size={16} />}
        iconColor="orange"
        description={
          <span className="settings-shell__description-row">
            Legal packages for events, signers and payments.
            <InfoPopover label="About workflow packages">
              <p>
                Legal package metadata for events, effective dates, signer rosters, supporting documents, and payment
                references — usually managed by an administrator.
              </p>
            </InfoPopover>
          </span>
        }
        tabs={[
          { id: "packages", label: "Packages", icon: <Workflow size={14} /> },
          { id: "lifecycle", label: "Lifecycle" },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          <Button variant="accent" disabled={!canManage} onClick={openNew} aria-label="New package">
            <Plus size={12} /> <span className="settings-shell__action-label">New package</span>
          </Button>
        }
      >

      {activeTab === "lifecycle" && <section role="tabpanel" aria-label="Lifecycle" className="card"><div className="card__head"><h2 className="card__title">Package lifecycle</h2></div><div className="card__body col" style={{ gap: 16 }}>{(packages ?? []).length ? (packages ?? []).map((row: any) => <div key={row._id}><strong>{row.packageName || optionLabel("eventTypes", row.eventType)}</strong><PackageLifecycle lifecycle={row.lifecycle} /></div>) : <p className="muted">No workflow packages yet. Create a package to track signers, payment, follow-up tasks, and filing.</p>}</div></section>}
      {activeTab === "packages" && <div className="card">
        <div className="card__head">
          <h2 className="card__title">Packages</h2>
          <Badge>{packages?.length ?? 0}</Badge>
        </div>
        <RecordListTable<PackageRecord>
          variant="card"
          table={PACKAGES_TABLE}
          tableId="workflow-packages"
          label="Packages"
          icon={<Workflow size={14} />}
          records={packageRecords}
          loading={packages === undefined}
          onOpen={canManage ? (record) => editPackage(record.pkg) : undefined}
          renderCell={({ record, field }) => {
            const row = record.pkg;
            if (field.name === "packageName") return <strong>{row.packageName}</strong>;
            if (field.name === "effectiveDate" && !row.effectiveDate) return <span className="muted">No effective date</span>;
            if (field.name === "eventType")
              return (
                <span>
                  <span style={{ display: "block" }}>{optionLabel("eventTypes", row.eventType)}</span>
                  <span className="muted" style={{ display: "block" }}>{row.parts?.length ? `${row.parts.length} parts` : "No parts listed"}</span>
                </span>
              );
            if (field.name === "workflowName")
              return row.workflowId && record.workflowName
                ? <Link to={`/app/workflows/${row.workflowId}`}>{record.workflowName}</Link>
                : <span className="muted">Not linked</span>;
            if (field.name === "documentTitle") {
              const documentId = row.supportingDocumentIds?.[0];
              return documentId && record.documentTitle
                ? <Link to={`/app/documents/${documentId}`}>{record.documentTitle}</Link>
                : <span className="muted">None</span>;
            }
            if (field.name === "signerCount")
              return (
                <span>
                  <span style={{ display: "block" }}>{row.signerRoster?.length || 0} people</span>
                  <span className="muted" style={{ display: "block" }}>{row.signerEmails?.length || 0} emails</span>
                </span>
              );
            if (field.name === "payment")
              return (
                <span>
                  <span style={{ display: "block" }}>{row.priceItems?.length ? row.priceItems.join(", ") : "No price items"}</span>
                  <span className="muted" style={{ display: "block" }}>{paymentStatusLabel(row.lifecycle?.paymentState)}</span>
                  {(row.stripeCheckoutSessionId || row.transactionId) && (
                    <span className="mono muted" style={{ display: "block", fontSize: "var(--fs-xs)" }} title="Payment reference ID (for support)">
                      {row.stripeCheckoutSessionId || row.transactionId}
                    </span>
                  )}
                </span>
              );
            if (field.name === "lifecycle") return <PackageLifecycle lifecycle={row.lifecycle} />;
            if (field.name === "status") return <Badge tone={toneForPackageStatus(row.status)}>{optionLabel("workflowPackageStatuses", row.status)}</Badge>;
            return undefined;
          }}
          renderRowActions={(record) => {
            const row = record.pkg;
            return (
              <>
                <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => createPackageTask(row)}>Task</button>
                {!row.lifecycle?.filed && <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => filePackage(row)}>Filed</button>}
                <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => editPackage(row)}>Edit</button>
                <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Delete workflow package" disabled={!canManage} onClick={() => confirmDelete(row)}>
                  <Trash2 size={12} />
                </button>
              </>
            );
          }}
          renderPhoneCard={(record, { open, field, selecting }) => (
            <RecordTablePhoneCard
              title={record.packageName}
              badge={field("status")}
              meta={[optionLabel("eventTypes", record.eventType), record.effectiveDate ? formatDate(record.effectiveDate) : "No effective date"]}
              detail={[record.workflowName ?? "", paymentStatusLabel(record.pkg.lifecycle?.paymentState)]}
              onOpen={canManage ? open : undefined}
              selecting={selecting}
            />
          )}
          emptyState={<RecordTableEmpty title="No workflow packages yet." />}
        />
      </div>

      }
      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit workflow package" : "New workflow package"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" disabled={!canManage} onClick={save}>Save</button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Package name" required error={nameError || undefined}><input className="input" value={draft.packageName ?? ""} onChange={(e) => setDraft({ ...draft, packageName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <OptionSelect label="Event type" setName="eventTypes" value={draft.eventType ?? ""} onChange={(value) => setDraft({ ...draft, eventType: value })} />
              <OptionSelect label="Status" setName="workflowPackageStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
            </div>
            <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
            <Field label="Workflow">
              <Select value={draft.workflowId ?? ""} onChange={(value) => setDraft({ ...draft, workflowId: value || undefined })}
                options={[{ value: "", label: "No workflow" }, ...(workflows ?? []).map((workflow: any) => ({ value: workflow._id, label: workflow.name }))]} />
            </Field>
            <Field label="Supporting document">
              <Select value={draft.supportingDocumentId ?? ""} onChange={(value) => setDraft({ ...draft, supportingDocumentId: value || undefined })}
                options={[{ value: "", label: "No supporting document" }, ...(documents ?? []).map((doc: any) => ({ value: doc._id, label: doc.title }))]} />
            </Field>
            <Field label="Parts"><input className="input" value={draft.partsText ?? ""} onChange={(e) => setDraft({ ...draft, partsText: e.target.value })} placeholder="Resolution, filing, receipt" /></Field>
            <Field label="Signer roster"><input className="input" value={draft.signerRosterText ?? ""} onChange={(e) => setDraft({ ...draft, signerRosterText: e.target.value })} /></Field>
            <Field label="Signer emails"><input className="input" value={draft.signerEmailsText ?? ""} onChange={(e) => setDraft({ ...draft, signerEmailsText: e.target.value })} /></Field>
            <Field label="Signing package IDs"><input className="input mono" value={draft.signingPackageIdsText ?? ""} onChange={(e) => setDraft({ ...draft, signingPackageIdsText: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Payment reference (transaction ID)" hint="Optional. Raw payment record ID, useful for reconciling with bank/accounting records or support requests.">
                <input className="input mono" value={draft.transactionId ?? ""} onChange={(e) => setDraft({ ...draft, transactionId: e.target.value })} />
              </Field>
              <Field label="Payment reference (checkout session)" hint="Optional. Raw Stripe checkout session ID, useful for support if a payment needs to be traced.">
                <input className="input mono" value={draft.stripeCheckoutSessionId ?? ""} onChange={(e) => setDraft({ ...draft, stripeCheckoutSessionId: e.target.value })} />
              </Field>
            </div>
            <Field label="Price items"><input className="input" value={draft.priceItemsText ?? ""} onChange={(e) => setDraft({ ...draft, priceItemsText: e.target.value })} /></Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
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

// Friendlier "Payment: ..." wording for the raw paymentState enum, so a viewer
// doesn't need to know what "checkout_created" or "transaction_linked" means.
function paymentStatusLabel(paymentState?: string) {
  if (paymentState === "transaction_linked") return "Payment: Paid";
  if (paymentState === "checkout_created") return "Payment: Pending";
  if (!paymentState) return "Payment: Not started";
  return `Payment: ${labelize(paymentState)}`;
}

/** The lifecycle badges as one line of text, for search, sort and export. */
function lifecycleText(lifecycle?: PackageLifecycleState) {
  if (!lifecycle) return "";
  return [labelize(lifecycle.signerState), paymentStatusLabel(lifecycle.paymentState), `${lifecycle.openTaskCount ?? 0} open tasks`, `${lifecycle.filingCount ?? 0} filings`].join(" · ");
}

function PackageLifecycle({ lifecycle }: { lifecycle?: PackageLifecycleState }) {
  if (!lifecycle) return <span className="muted">-</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <Badge tone={lifecycle.signerState === "complete" ? "success" : lifecycle.signerState === "needed" ? "warn" : "neutral"}>
        {labelize(lifecycle.signerState)}
      </Badge>
      <Badge tone={lifecycle.paymentState === "transaction_linked" ? "success" : lifecycle.paymentState === "checkout_created" ? "info" : "neutral"}>
        {paymentStatusLabel(lifecycle.paymentState)}
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
