import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field, InspectorNote } from "../components/ui";
import { Modal, useConfirm } from "../components/Modal";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { Plus, Check, ClipboardList, Bot, FileDown, Trash2 } from "lucide-react";
import { centsToDollarInput, dollarInputToCents } from "../lib/format";
import { kindLabel } from "./Dashboard";
import { FilingBotRunner } from "../components/FilingBotRunner";
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
import {
  filingKindDefinitions,
  jurisdictionDisplayCopy,
  jurisdictionModuleContract,
} from "../../shared/jurisdictionWorkspace";
import { MarkdownEditor } from "../components/MarkdownEditor";

const TAX_FILING_KINDS = ["T2", "T1044", "T3010", "T4", "GSTHST"] as const;

export function FilingsPage() {
  const society = useSociety();
  const jurisdictionCopy = jurisdictionDisplayCopy(society?.jurisdictionCode);
  const jurisdictionModule = jurisdictionModuleContract(society?.jurisdictionCode);
  const jurisdictionFilingKinds = filingKindDefinitions(society?.jurisdictionCode);
  const filingKindOptions = [
    ...jurisdictionFilingKinds.map((definition) => ({
      value: definition.kind,
      label: definition.label,
    })),
    ...TAX_FILING_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
  ];
  const actingUserId = useCurrentUserId() ?? undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [botFor, setBotFor] = useState<{ id: any; label: string } | null>(null);
  const [completeDraft, setCompleteDraft] = useState<any | null>(null);
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importingRegistry, setImportingRegistry] = useState(false);
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const filingGuidance = useQuery(
    api.filings.guidance,
    completeDraft?.kind
      ? {
          kind: completeDraft.kind,
          jurisdictionCode: completeDraft.jurisdictionCode ?? society?.jurisdictionCode,
        }
      : "skip",
  );
  const create = useMutation(api.filings.create);
  const update = useMutation(api.filings.update);
  const markFiled = useMutation(api.filings.markFiled);
  const removeFiling = useMutation(api.filings.remove);
  const confirm = useConfirm();
  const toast = useToast();

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "filing",
    viewId: currentViewId,
  });

  const markFiledIntentHandled = useRef(false);
  useEffect(() => {
    if (params.get("intent") !== "mark-filed") {
      markFiledIntentHandled.current = false;
      return;
    }
    if (markFiledIntentHandled.current) return;
    if (!society || filings === undefined) return;
    markFiledIntentHandled.current = true;
    const target = (filings ?? []).find((filing: any) => filing.status !== "Filed");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    if (!target) {
      toast.info("No open filing found");
      return;
    }
    setCompleteDraft({
      id: target._id,
      kind: target.kind,
      jurisdictionCode: target.jurisdictionCode,
      contextKind: target.contextKind,
      sourceRegistrationId: target.sourceRegistrationId,
      filedAt: new Date().toISOString().slice(0, 10),
      submissionMethod: target.submissionMethod ?? "ManualPortal",
      confirmationNumber: target.confirmationNumber ?? "",
      feePaidDollars: centsToDollarInput(target.feePaidCents),
      receiptDocumentId: target.receiptDocumentId ?? "",
      stagedPacketDocumentId: target.stagedPacketDocumentId ?? "",
      evidenceNotes: target.evidenceNotes ?? "",
      submissionChecklist: target.submissionChecklist ?? [],
      registryUrl: target.registryUrl ?? "",
    });
  }, [filings, params, setParams, society, toast]);

  // ?intent=add (from the "Add filing" command palette action) opens the
  // new-filing form. Mirrors the mark-filed handler above.
  const addIntentHandled = useRef(false);
  useEffect(() => {
    if (params.get("intent") !== "add") {
      addIntentHandled.current = false;
      return;
    }
    if (addIntentHandled.current) return;
    if (!society) return;
    addIntentHandled.current = true;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    setForm({
      kind: jurisdictionFilingKinds[0]?.kind ?? "AnnualReport",
      periodLabel: "",
      dueDate: new Date().toISOString().slice(0, 10),
      status: "Upcoming",
      jurisdictionCode: society.jurisdictionCode,
      contextKind: "home",
    });
    setOpen(true);
  }, [params, setParams, society, jurisdictionFilingKinds]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      kind: jurisdictionFilingKinds[0]?.kind ?? "AnnualReport",
      periodLabel: "",
      dueDate: new Date().toISOString().slice(0, 10),
      status: "Upcoming",
      jurisdictionCode: society.jurisdictionCode,
      contextKind: "home",
    });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form, submittedByUserId: actingUserId }); setOpen(false); };

  const importRegistryHistory = async () => {
    setImportingRegistry(true);
    try {
      const response = await fetch("/api/v1/browser-connectors/filing-history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          societyId: society._id,
          corpNum: society.incorporationNumber,
          importDocuments: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed with ${response.status}`);
      }
      const data = payload.data ?? {};
      toast.success(
        `${jurisdictionModule.registryPortalLabel} filings imported`,
        `${data.inserted ?? 0} created, ${data.updated ?? 0} updated, ${data.documents?.created ?? 0} document(s) added`,
      );
    } catch (error: any) {
      toast.error(
        `Could not import ${jurisdictionModule.registryPortalLabel} filings`,
        error?.message ?? `Open a ${jurisdictionModule.registryPortalLabel} browser session and try again.`,
      );
    } finally {
      setImportingRegistry(false);
    }
  };

  const records = (filings ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Filings"
        icon={<ClipboardList size={16} />}
        iconColor="orange"
        subtitle={jurisdictionCopy.filingsSubtitle}
        actions={
          <>
            {jurisdictionModule.registryImportSupported && (
              <button className="btn-action" onClick={importRegistryHistory} disabled={importingRegistry}>
                <FileDown size={12} /> {importingRegistry ? "Importing…" : "Import registry"}
              </button>
            )}
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New filing
            </button>
          </>
        }
      />

      <p className="muted">
        Related: annual jurisdiction filings are also tracked on{" "}
        <Link to="/app/annual-filings">Annual filings</Link> and{" "}
        <Link to="/app/formation-maintenance">Formation &amp; annual maintenance</Link>.
      </p>

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="filing" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="filings"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_recordId, r) => {
            if (r.status === "Filed") return;
            setCompleteDraft({
              id: r._id,
              kind: r.kind,
              jurisdictionCode: r.jurisdictionCode,
              contextKind: r.contextKind,
              sourceRegistrationId: r.sourceRegistrationId,
              filedAt: new Date().toISOString().slice(0, 10),
              submissionMethod: r.submissionMethod ?? "ManualPortal",
              confirmationNumber: r.confirmationNumber ?? "",
              feePaidDollars: centsToDollarInput(r.feePaidCents),
              receiptDocumentId: r.receiptDocumentId ?? "",
              stagedPacketDocumentId: r.stagedPacketDocumentId ?? "",
              evidenceNotes: r.evidenceNotes ?? "",
              submissionChecklist: r.submissionChecklist ?? [],
              registryUrl: r.registryUrl ?? "",
            });
          }}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"filings">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<ClipboardList size={14} />}
            label="All filings"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || filings === undefined}
            renderRowActions={(r) =>
              r.status !== "Filed" ? (
                <>
                  {jurisdictionFilingKinds.some((definition) => definition.kind === r.kind && definition.botSupported) && (
                    <button
                      className="btn btn--sm"
                      onClick={() => setBotFor({ id: r._id, label: `${r.kind}: ${r.periodLabel ?? r.dueDate}` })}
                      title="Run the Societies Online filing bot"
                    >
                      <Bot size={12} /> Bot
                    </button>
                  )}
                  <button
                    className="btn btn--sm"
                    onClick={() =>
                      setCompleteDraft({
                        id: r._id,
                        kind: r.kind,
                        jurisdictionCode: r.jurisdictionCode,
                        contextKind: r.contextKind,
                        sourceRegistrationId: r.sourceRegistrationId,
                        filedAt: new Date().toISOString().slice(0, 10),
                        submissionMethod: r.submissionMethod ?? "ManualPortal",
                        confirmationNumber: r.confirmationNumber ?? "",
                        feePaidDollars: centsToDollarInput(r.feePaidCents),
                        receiptDocumentId: r.receiptDocumentId ?? "",
                        stagedPacketDocumentId: r.stagedPacketDocumentId ?? "",
                        evidenceNotes: r.evidenceNotes ?? "",
                        submissionChecklist: r.submissionChecklist ?? [],
                        registryUrl: r.registryUrl ?? "",
                      })
                    }
                  >
                    <Check size={12} /> Mark filed
                  </button>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label="Delete filing"
                    title="Delete this filing"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Delete filing?",
                        message: `Permanently remove "${r.kind}: ${r.periodLabel ?? r.dueDate}". This can't be undone. Use it only for filings created in error — already-filed records can't be deleted.`,
                        confirmLabel: "Delete",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await removeFiling({ id: r._id });
                      toast.success("Filing deleted");
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              ) : null
            }
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
        open={open} onClose={() => setOpen(false)} title="Add filing"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <InspectorNote title="Create the obligation first">
              Use this when a filing obligation exists and you want it tracked in the workspace
              before submission evidence is available.
            </InspectorNote>
            <Field label="Kind">
              <Select
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v })}
                options={filingKindOptions}
              />
            </Field>
            <Field label="Jurisdiction">
              <Select
                value={form.jurisdictionCode ?? society.jurisdictionCode ?? ""}
                onChange={(v) => setForm({ ...form, jurisdictionCode: v })}
                options={[
                  { value: society.jurisdictionCode ?? "", label: `${society.jurisdictionCode ?? "Workspace"} home jurisdiction` },
                  { value: "CA-FED-CBCA", label: "Canada federal - CBCA" },
                  { value: "CA-BC", label: "British Columbia" },
                  { value: "CA-ON-OBCA", label: "Ontario" },
                ].filter((option, index, options) => option.value && options.findIndex((item) => item.value === option.value) === index)}
              />
            </Field>
            <Field label="Context">
              <Select
                value={form.contextKind ?? "home"}
                onChange={(v) => setForm({ ...form, contextKind: v })}
                options={[
                  { value: "home", label: "Home jurisdiction" },
                  { value: "extra_provincial", label: "Extra-provincial registration" },
                  { value: "branch", label: "Branch" },
                  { value: "business_name", label: "Business name" },
                ]}
              />
            </Field>
            {form.contextKind === "extra_provincial" && (
              <Field label="Source registration ID" hint="Optional internal registration row ID for traceability">
                <input className="input" value={form.sourceRegistrationId ?? ""} onChange={(e) => setForm({ ...form, sourceRegistrationId: e.target.value })} />
              </Field>
            )}
            <Field label="Period / label"><input className="input" value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} /></Field>
            <Field label="Due date">
              <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>

      <FilingBotRunner
        open={!!botFor}
        onClose={() => setBotFor(null)}
        filingId={botFor?.id ?? null}
        societyId={society._id}
        filingLabel={botFor?.label ?? ""}
      />

      <Modal
        open={!!completeDraft}
        onClose={() => setCompleteDraft(null)}
        title="Mark filing as filed"
        size="md"
        footer={
          <>
            <button className="btn" onClick={() => setCompleteDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                const hasEvidence =
                  !!completeDraft.confirmationNumber?.trim() ||
                  !!completeDraft.receiptDocumentId ||
                  !!completeDraft.stagedPacketDocumentId ||
                  !!completeDraft.evidenceNotes?.trim();
                if (!completeDraft.filedAt || !completeDraft.submissionMethod || !hasEvidence) {
                  toast.error("Add filed date, method, and at least one evidence item before marking filed");
                  return;
                }
                await markFiled({
                  id: completeDraft.id,
                  filedAt: completeDraft.filedAt,
                  submissionMethod: completeDraft.submissionMethod || undefined,
                  submittedByUserId: actingUserId,
                  confirmationNumber: completeDraft.confirmationNumber || undefined,
                  feePaidCents: dollarInputToCents(completeDraft.feePaidDollars),
                  receiptDocumentId: completeDraft.receiptDocumentId || undefined,
                  stagedPacketDocumentId: completeDraft.stagedPacketDocumentId || undefined,
                  evidenceNotes: completeDraft.evidenceNotes || undefined,
                  submissionChecklist: completeDraft.submissionChecklist?.filter(Boolean) ?? undefined,
                  attestedByUserId: actingUserId,
                });
                toast.success("Filing marked as filed");
                setCompleteDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {completeDraft && (
          <div>
            <InspectorNote tone="warn" title="Only mark filed with evidence">
              Capture the filed date, method, confirmation number, and receipt once the submission
              is actually complete so audit trails stay defensible.
            </InspectorNote>
            {(completeDraft.registryUrl || filingGuidance?.registryUrl) && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Registry / filing portal:{" "}
                <a href={completeDraft.registryUrl || filingGuidance?.registryUrl} target="_blank" rel="noreferrer">
                  {completeDraft.registryUrl || filingGuidance?.registryUrl}
                </a>
              </div>
            )}
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Filing context: {contextKindLabel(completeDraft.contextKind)} · {completeDraft.jurisdictionCode ?? society.jurisdictionCode}
              {completeDraft.sourceRegistrationId ? ` · registration ${completeDraft.sourceRegistrationId}` : ""}
            </div>
            <Field label="Filed date"><DatePicker value={completeDraft.filedAt} onChange={(value) => setCompleteDraft({ ...completeDraft, filedAt: value })} /></Field>
            <Field label="Submission method">
              <Select
                value={completeDraft.submissionMethod ?? ""}
                onChange={(v) => setCompleteDraft({ ...completeDraft, submissionMethod: v })}
                options={[
                  { value: "ManualPortal", label: "Manual portal" },
                  { value: "BotAssisted", label: "Bot-assisted" },
                  { value: "CRAOnline", label: "CRA online" },
                ]}
              />
            </Field>
            <Field label="Submission checklist" hint="One step per line">
              <textarea
                className="textarea"
                rows={5}
                value={(completeDraft.submissionChecklist?.length ? completeDraft.submissionChecklist : filingGuidance?.checklist ?? []).join("\n")}
                onChange={(e) => setCompleteDraft({
                  ...completeDraft,
                  submissionChecklist: e.target.value.split("\n").map((row) => row.trim()).filter(Boolean),
                })}
              />
            </Field>
            <Field label="Confirmation number"><input className="input" value={completeDraft.confirmationNumber ?? ""} onChange={(e) => setCompleteDraft({ ...completeDraft, confirmationNumber: e.target.value })} /></Field>
            <Field label="Fee paid" hint="Dollars">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={completeDraft.feePaidDollars ?? ""}
                onChange={(e) => setCompleteDraft({ ...completeDraft, feePaidDollars: e.target.value })}
              />
            </Field>
            <Field label="Staged packet / pre-fill document">
              <Select
                value={completeDraft.stagedPacketDocumentId ?? ""}
                onChange={(v) => setCompleteDraft({ ...completeDraft, stagedPacketDocumentId: v })}
                options={[
                  { value: "", label: "None" },
                  ...(documents ?? []).map((document) => ({ value: document._id, label: document.title })),
                ]}
              />
            </Field>
            <Field label="Receipt / evidence document">
              <Select
                value={completeDraft.receiptDocumentId ?? ""}
                onChange={(v) => setCompleteDraft({ ...completeDraft, receiptDocumentId: v })}
                options={[
                  { value: "", label: "None" },
                  ...(documents ?? []).map((document) => ({ value: document._id, label: document.title })),
                ]}
              />
            </Field>
            <Field label="Evidence notes">
              <MarkdownEditor rows={4} value={completeDraft.evidenceNotes ?? ""} onChange={(markdown) => setCompleteDraft({ ...completeDraft, evidenceNotes: markdown })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function contextKindLabel(contextKind?: string | null) {
  if (contextKind === "extra_provincial") return "Extra-provincial";
  if (contextKind === "branch") return "Branch";
  if (contextKind === "business_name") return "Business name";
  return "Home";
}
