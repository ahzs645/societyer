import { serverActionErrorMessage, serverActionsUnavailable, serverConnectionMessage } from "../lib/serverConnection";
import { authenticatedFetch } from "@/lib/authToken";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { usePermissions } from "../hooks/usePermissions";
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
} from "@/platform/record-engine";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  filingKindDefinitions,
  jurisdictionDisplayCopy,
  jurisdictionModuleContract,
} from "../../shared/jurisdictionWorkspace";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { calendarDateKey } from "../lib/calendarDates";

const TAX_FILING_KINDS = ["T2", "T1044", "T3010", "T4", "GSTHST"] as const;

export function FilingsPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canWrite = can("filings:write");
  const canImportRegistry = can("settings:manage");
  const jurisdictionCopy = jurisdictionDisplayCopy(society);
  const jurisdictionModule = jurisdictionModuleContract(society);
  const jurisdictionFilingKinds = filingKindDefinitions(society);
  // The legacy generic "AnnualReport" kind duplicates the jurisdiction's own
  // annual report kind (e.g. BC society annual report); offer only one (G-17).
  const hasSpecificAnnualReport = jurisdictionFilingKinds.some((definition) => /AnnualReport$/.test(definition.kind) && definition.kind !== "AnnualReport");
  const filingKindOptions = [
    ...jurisdictionFilingKinds
      .filter((definition) => !(hasSpecificAnnualReport && definition.kind === "AnnualReport"))
      .map((definition) => ({
        value: definition.kind,
        label: definition.label,
      })),
    ...TAX_FILING_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
  ];
  const actingUserId = useCurrentUserId() ?? undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [botFor, setBotFor] = useState<{ id: any; kind: string; label: string } | null>(null);
  const [completeDraft, setCompleteDraft] = useState<any | null>(null);
  const [params, setParams] = useSearchParams();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importingRegistry, setImportingRegistry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingFiled, setMarkingFiled] = useState(false);
  const [viewFiled, setViewFiled] = useState<any | null>(null);
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
  const create = usePermissionedMutation(api.filings.create, canWrite);
  const update = usePermissionedMutation(api.filings.update, canWrite);
  const markFiled = usePermissionedMutation(api.filings.markFiled, canWrite);
  const removeFiling = usePermissionedMutation(api.filings.remove, canWrite);
  const confirm = useConfirm();
  const toast = useToast();

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "filing",
    viewId: currentViewId,
  });

  const openMarkFiled = useCallback((filing: Doc<"filings">) => {
    if (!canWrite) return;
    setCompleteDraft({
      id: filing._id,
      kind: filing.kind,
      jurisdictionCode: filing.jurisdictionCode,
      contextKind: filing.contextKind,
      sourceRegistrationId: filing.sourceRegistrationId,
      filedAt: calendarDateKey(new Date()),
      submissionMethod: filing.submissionMethod ?? "ManualPortal",
      confirmationNumber: filing.confirmationNumber ?? "",
      feePaidDollars: centsToDollarInput(filing.feePaidCents),
      receiptDocumentId: filing.receiptDocumentId ?? "",
      stagedPacketDocumentId: filing.stagedPacketDocumentId ?? "",
      evidenceNotes: filing.evidenceNotes ?? "",
      submissionChecklist: filing.submissionChecklist ?? [],
      registryUrl: filing.registryUrl ?? "",
    });
  }, [canWrite]);

  const markFiledIntentHandled = useRef(false);
  useEffect(() => {
    if (params.get("intent") !== "mark-filed") {
      markFiledIntentHandled.current = false;
      return;
    }
    if (markFiledIntentHandled.current) return;
    if (!canWrite || !society || filings === undefined) return;
    markFiledIntentHandled.current = true;
    const target = (filings ?? []).find((filing) => filing.status !== "Filed");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    if (!target) {
      toast.info("No open filing found");
      return;
    }
    openMarkFiled(target);
  }, [canWrite, filings, openMarkFiled, params, setParams, society, toast]);

  // ?filing=<id> (dashboard rows) opens that filing: mark-filed for an open
  // filing, the read-only detail drawer for a filed one.
  const filingParamHandled = useRef<string | null>(null);
  useEffect(() => {
    const filingId = params.get("filing");
    if (!filingId || filings === undefined || filingParamHandled.current === filingId) return;
    filingParamHandled.current = filingId;
    const target = (filings ?? []).find((filing) => String(filing._id) === filingId);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("filing");
      return next;
    }, { replace: true });
    if (!target) {
      toast.info("That filing no longer exists");
      return;
    }
    if (target.status !== "Filed" && canWrite) openMarkFiled(target);
    else setViewFiled(target);
  }, [canWrite, filings, openMarkFiled, params, setParams, toast]);

  // ?intent=add (from the "Add filing" command palette action) opens the
  // new-filing form. Mirrors the mark-filed handler above.
  const addIntentHandled = useRef(false);
  useEffect(() => {
    if (params.get("intent") !== "add") {
      addIntentHandled.current = false;
      return;
    }
    if (addIntentHandled.current) return;
    if (!canWrite || !society) return;
    addIntentHandled.current = true;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    setForm({
      kind: jurisdictionFilingKinds[0]?.kind ?? "AnnualReport",
      periodLabel: "",
      dueDate: calendarDateKey(new Date()),
      status: "Upcoming",
      jurisdictionCode: society.jurisdictionCode,
      contextKind: "home",
    });
    setOpen(true);
  }, [canWrite, params, setParams, society, jurisdictionFilingKinds]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      kind: jurisdictionFilingKinds[0]?.kind ?? "AnnualReport",
      periodLabel: "",
      dueDate: calendarDateKey(new Date()),
      status: "Upcoming",
      jurisdictionCode: society.jurisdictionCode,
      contextKind: "home",
    });
    setOpen(true);
  };
  const save = async () => {
    if (!canWrite || saving) return;
    if (!String(form?.periodLabel ?? "").trim()) {
      toast.error("Filing not saved", "Enter the period this filing covers (for example 2026 or FY2025-26).");
      return;
    }
    if (!form?.dueDate) {
      toast.error("Filing not saved", "Choose the due date.");
      return;
    }
    setSaving(true);
    try {
      await create({ societyId: society._id, ...form, submittedByUserId: actingUserId });
      setOpen(false);
      toast.success("Filing obligation saved");
    } catch (error: any) {
      toast.error("Could not save filing", error?.message ?? String(error));
    } finally { setSaving(false); }
  };

  const registryNeedsServer = serverActionsUnavailable();
  const importRegistryHistory = async () => {
    if (!canImportRegistry) return;
    if (registryNeedsServer) {
      toast.info("Registry import unavailable here", serverConnectionMessage(`Importing ${jurisdictionModule.registryPortalLabel} filings`));
      return;
    }
    setImportingRegistry(true);
    try {
      const response = await authenticatedFetch("/api/v1/browser-connectors/filing-history/import", {
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
        serverActionErrorMessage(`Importing ${jurisdictionModule.registryPortalLabel} filings`, error, `Open a ${jurisdictionModule.registryPortalLabel} browser session and try again.`),
      );
    } finally {
      setImportingRegistry(false);
    }
  };

  // Unfiled filings past their due date read "Overdue" here, as they do on the
  // dashboard, instead of a stale stored "Upcoming" (G-17).
  const todayKey = calendarDateKey(new Date());
  const records = ((filings ?? []) as any[]).map((filing) =>
    filing.status !== "Filed" && filing.status !== "Attested" && filing.dueDate && String(filing.dueDate).slice(0, 10) < todayKey
      ? { ...filing, status: "Overdue" }
      : filing,
  );
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
              <button
                className="btn-action"
                onClick={importRegistryHistory}
                disabled={!canImportRegistry || importingRegistry || registryNeedsServer}
                title={registryNeedsServer ? serverConnectionMessage(`Importing ${jurisdictionModule.registryPortalLabel} filings`) : undefined}
              >
                <FileDown size={12} /> {importingRegistry ? "Importing…" : "Import registry"}
              </button>
            )}
            <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
              <Plus size={12} /> New filing
            </button>
          </>
        }
      />

      <p className="muted">
        Related: annual jurisdiction filings are also tracked on{" "}
        <Link to="/app/annual-filings">Annual filings</Link> and{" "}
        <Link to="/app/formation-maintenance">Formation &amp; annual maintenance</Link>.{" "}
        <Link to="/app/filings/prefill">Prepare filing values</Link> before submitting through the official portal.
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
            if (r.status === "Filed" || r.status === "Attested" || !canWrite) {
              setViewFiled(r);
              return;
            }
            openMarkFiled(r as Doc<"filings">);
          }}
          onUpdate={canWrite ? async ({ recordId, fieldName, value }) => {
            if (fieldName === "status" && value === "Filed") {
              const filing = filings?.find((candidate) => String(candidate._id) === recordId);
              if (!filing || filing.status === "Filed") return;
              openMarkFiled(filing);
              return;
            }
            await update({
              id: recordId as Id<"filings">,
              patch: { [fieldName]: value } as any,
            });
          } : undefined}
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
                      onClick={() => setBotFor({ id: r._id, kind: r.kind, label: [kindLabel(r.kind), r.periodLabel || r.dueDate].filter(Boolean).join(": ") })}
                      title="Prepare a BC society filing for manual submission"
                    disabled={!canWrite}
                   >
                      <Bot size={12} /> Prepare
                    </button>
                  )}
                  <button
                    className="btn btn--sm"
                    onClick={() => openMarkFiled(r as Doc<"filings">)}
                  disabled={!canWrite}
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
                        message: `Permanently remove "${[kindLabel(r.kind), r.periodLabel || r.dueDate].filter(Boolean).join(": ")}". This can't be undone. Use it only for filings created in error — already-filed records can't be deleted.`,
                        confirmLabel: "Delete",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await removeFiling({ id: r._id });
                      toast.success("Filing deleted");
                    }}
                  disabled={!canWrite}
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
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save} disabled={!canWrite || saving}>{saving ? "Saving…" : "Save"}</button></>}
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
            <Field label="Period / label" hint="Required. For example 2026, FY2025-26 or 2026 AGM"><input className="input" value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} /></Field>
            <Field label="Due date">
              <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!viewFiled}
        onClose={() => setViewFiled(null)}
        title={viewFiled ? [kindLabel(viewFiled.kind), viewFiled.periodLabel].filter(Boolean).join(" · ") : "Filing"}
        footer={<button className="btn" onClick={() => setViewFiled(null)}>Close</button>}
      >
        {viewFiled && (
          <div className="col" style={{ gap: 8 }}>
            {viewFiled.status === "Filed" || viewFiled.status === "Attested" ? (
              <InspectorNote title="Filed records are kept as evidence">
                Filed filings cannot be deleted. To correct a detail, edit the cell in the table; the original submission evidence stays attached.
              </InspectorNote>
            ) : (
              <InspectorNote tone="warn" title="Read-only">You do not have permission to mark this filing filed.</InspectorNote>
            )}
            <div><span className="muted">Status:</span> {viewFiled.status}</div>
            <div><span className="muted">Due:</span> {viewFiled.dueDate ?? "—"}</div>
            {viewFiled.filedAt && <div><span className="muted">Filed:</span> {viewFiled.filedAt}{viewFiled.dueDate && String(viewFiled.filedAt).slice(0, 10) > String(viewFiled.dueDate).slice(0, 10) ? " (after the due date)" : ""}</div>}
            {viewFiled.submissionMethod && <div><span className="muted">Method:</span> {viewFiled.submissionMethod}</div>}
            {viewFiled.confirmationNumber && <div><span className="muted">Confirmation:</span> {viewFiled.confirmationNumber}</div>}
            {viewFiled.feePaidCents != null && <div><span className="muted">Fee paid:</span> ${(viewFiled.feePaidCents / 100).toFixed(2)}</div>}
            {viewFiled.evidenceNotes && <div><span className="muted">Evidence notes:</span> {viewFiled.evidenceNotes}</div>}
            {viewFiled.receiptDocumentId && (
              <div><Link to={`/app/documents/${viewFiled.receiptDocumentId}`}>Open receipt document</Link></div>
            )}
          </div>
        )}
      </Drawer>

      <FilingBotRunner
        open={canWrite && !!botFor}
        onClose={() => setBotFor(null)}
        filingId={botFor?.id ?? null}
        societyId={society._id}
        filingLabel={botFor?.label ?? ""}
        filingKind={botFor?.kind ?? ""}
      />

      <Modal
        open={canWrite && !!completeDraft}
        onClose={() => setCompleteDraft(null)}
        title="Mark filing as filed"
        size="md"
        footer={
          <>
            <button className="btn" onClick={() => setCompleteDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                if (!canWrite || markingFiled) return;
                const hasEvidence =
                  !!completeDraft.confirmationNumber?.trim() ||
                  !!completeDraft.receiptDocumentId ||
                  !!completeDraft.stagedPacketDocumentId ||
                  !!completeDraft.evidenceNotes?.trim();
                if (!completeDraft.filedAt || !completeDraft.submissionMethod || !hasEvidence) {
                  toast.error("Add filed date, method, and at least one evidence item before marking filed");
                  return;
                }
                const feeCents = dollarInputToCents(completeDraft.feePaidDollars);
                if (feeCents != null && (!Number.isFinite(feeCents) || feeCents < 0)) {
                  toast.error("The fee paid cannot be negative");
                  return;
                }
                if (completeDraft.filedAt > calendarDateKey(new Date())) {
                  toast.error("The filed date cannot be in the future");
                  return;
                }
                setMarkingFiled(true);
                try {
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
                } catch (error: any) {
                  toast.error("Could not mark filing as filed", error?.message ?? String(error));
                } finally { setMarkingFiled(false); }
              }}
            disabled={!canWrite || markingFiled}
           >
              {markingFiled ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {completeDraft && (
          <div>
            <InspectorNote tone="warn" title="Only mark filed with evidence">
              Capture the filed date, method, confirmation number, and receipt once the submission
              is actually complete so audit trails stay defensible. This records your attestation; it does not independently verify government acceptance.
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
