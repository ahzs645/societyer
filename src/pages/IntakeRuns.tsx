import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Circle, FileSearch, FolderOpen, Files, Loader2, Lock, ScanText, ScrollText, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { formatDate, formatDateTime, pluralize, relative } from "../lib/format";
import { InfoPopover } from "../components/InfoPopover";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { getDesktopBridge } from "../lib/desktopBridge";
import { todayDateOnly } from "../../shared/dateOnly";
import {
  desktopIntakeBridge, pickDesktopFolder, pickDirectory, selectionFromFileList, summarizeSelection, supportsDirectoryPicker, type IntakeSelection,
} from "../features/intake/collectFiles";
import { runIntake, type IntakeProgress, type IntakeStageId } from "../features/intake/runIntake";
import { cacheRunOriginals, importPipelineOutput, pipelineOutputFiles, type ImportProgress, type PipelineOutputFiles } from "../features/intake/importPipelineOutput";
import { clearOriginals, originalsUsage } from "../features/intake/originalsCache";
import { defaultModelFor, keyStorageLabel, providerHost, readLlmPrefs, readLocalApiKey, storeLocalApiKey, writeLlmPrefs, type LocalLlmProvider } from "../features/intake/localLlm";
import { CompactRunPanel } from "../features/intake/CompactRunPanel";
import "../features/intake/intake.css";

const STAGES: Array<{ id: IntakeStageId; label: string }> = [
  { id: "inventory", label: "Inventory" },
  { id: "junk", label: "Junk filtered" },
  { id: "extract", label: "Text extracted" },
  { id: "cluster", label: "Clusters" },
  { id: "classify", label: "Classified" },
  { id: "fields", label: "Fields extracted" },
  { id: "stage", label: "Saved" },
];
const STAGE_ORDER: IntakeStageId[] = ["inventory", "junk", "extract", "cluster", "classify", "fields", "stage", "server", "done"];

const STATUS_TONE: Record<string, "success" | "warn" | "danger" | "info" | "neutral"> = { created: "neutral", running: "info", extracted: "warn", reviewing: "info", completed: "success", failed: "danger", cancelled: "neutral" };
const STATUS_LABEL: Record<string, string> = { created: "Created", running: "Running", extracted: "Ready for review", reviewing: "In review", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * AI-led intake (audit §6, intake design §4.4): choose files or a folder, run
 * the shared pipeline (inventory → junk filter → text/layout → clusters →
 * classification → field extraction) and review the results.
 */
export function IntakeRunsPage() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const canRead = can("settings:read");
  const canWrite = loaded && can("settings:write");
  const hosted = !isLocalDataRuntime();
  const runs = useQuery(api.intake.listRuns, society && canRead ? { societyId: society._id } : "skip") as any[] | undefined;
  const summaries = useQuery(api.intake.runSummaries, society && canRead ? { societyId: society._id } : "skip") as any[] | undefined;
  const aiSettings = useQuery(api.aiSettings.getEffective, society && canRead ? { societyId: society._id } : "skip") as any;
  const createRun = usePermissionedMutation(api.intake.createRun, canWrite);
  const updateRun = usePermissionedMutation(api.intake.updateRun, canWrite);
  const recordFiles = usePermissionedMutation(api.intake.recordFiles, canWrite);
  const saveExtract = usePermissionedMutation(api.intake.saveExtract, canWrite);
  const saveClusters = usePermissionedMutation(api.intake.saveClusters, canWrite);
  const saveExtraction = usePermissionedMutation(api.intake.saveExtraction, canWrite);
  const appendProcessingLog = usePermissionedMutation(api.intake.appendProcessingLog, canWrite);
  const reconcileRun = usePermissionedMutation(api.intake.reconcileRun, canWrite);
  const extractRun = useAction(api.intakeActions.extractRun);

  const [selection, setSelection] = useState<IntakeSelection | null>(null);
  const [name, setName] = useState(() => (params.get("missing") ? `Missing: ${params.get("missing")}` : `Intake ${formatDate(todayDateOnly())}`));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IntakeProgress | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [detailRunId, setDetailRunId] = useState<string | null>(params.get("run"));
  const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
  const prefs = useMemo(() => readLlmPrefs(), []);
  const [llmEnabled, setLlmEnabled] = useState(prefs.enabled);
  const [provider, setProvider] = useState<LocalLlmProvider>(prefs.provider);
  const [modelId, setModelId] = useState(prefs.modelId);
  const [baseUrl, setBaseUrl] = useState(prefs.baseUrl ?? "");
  const [budgetTokens, setBudgetTokens] = useState(prefs.budgetTokens);
  const [apiKey, setApiKey] = useState("");
  // OCR of scanned pages runs on this device; the page budget bounds how long a run can take.
  const [ocrEnabled, setOcrEnabled] = useState(() => readOcrPrefs().enabled);
  const [ocrPageBudget, setOcrPageBudget] = useState(() => readOcrPrefs().pageBudget);
  const [keyStored, setKeyStored] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const outputInput = useRef<HTMLInputElement>(null);
  const originalsInput = useRef<HTMLInputElement>(null);
  const [pipelineOutput, setPipelineOutput] = useState<PipelineOutputFiles | null>(null);
  const [pipelineOriginals, setPipelineOriginals] = useState<FileList | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void originalsUsage().then(setUsage);
    void readLocalApiKey().then((key) => setKeyStored(Boolean(key)));
  }, []);
  // Workspace AI settings seed the device-local provider and model.
  const effective = aiSettings?.effective;
  useEffect(() => {
    if (!effective || prefs.enabled) return;
    if (["openai", "openrouter", "openai-compatible"].includes(effective.provider)) setProvider(effective.provider);
    if (effective.modelId) setModelId(effective.modelId);
    if (effective.baseUrl) setBaseUrl(effective.baseUrl);
  }, [effective, prefs.enabled]);

  const summary = useMemo(() => summarizeSelection(selection, { ocr: ocrEnabled }), [selection, ocrEnabled]);
  const desktop = desktopIntakeBridge();
  const summariesById = useMemo(() => new Map((summaries ?? []).map((row: any) => [String(row.runId), row])), [summaries]);

  if (society === undefined) return <PageLoading />;
  if (!society) return <SeedPrompt />;
  if (loaded && !canRead) {
    return <div className="page"><PageHeader title="AI intake" /><Banner tone="info">AI intake runs need settings read access (Owners and Admins run and review intake).</Banner></div>;
  }

  const onFiles = (event: ChangeEvent<HTMLInputElement>, kind: IntakeSelection["sourceKind"]) => {
    const next = selectionFromFileList(event.target.files, kind);
    if (next.files.length) setSelection(next);
    event.target.value = "";
  };
  const chooseFolder = async () => {
    try {
      if (desktop) {
        const picked = await pickDesktopFolder();
        if (picked) setSelection(picked);
        return;
      }
      if (supportsDirectoryPicker()) {
        const picked = await pickDirectory();
        if (picked) setSelection(picked);
        return;
      }
      folderInput.current?.click();
    } catch (error) {
      toast.error("Could not read the folder", error instanceof Error ? error.message : undefined);
    }
  };

  const mutation = async (fn: string, args: Record<string, unknown>) => {
    const table: Record<string, (args: any) => Promise<any>> = {
      "intake:createRun": createRun, "intake:updateRun": updateRun, "intake:recordFiles": recordFiles, "intake:saveExtract": saveExtract,
      "intake:saveClusters": saveClusters, "intake:saveExtraction": saveExtraction, "intake:appendProcessingLog": appendProcessingLog, "intake:reconcileRun": reconcileRun,
    };
    const call = table[fn];
    if (!call) throw new Error(`Unsupported intake call ${fn}.`);
    return call(args);
  };

  const start = async () => {
    if (!selection?.files.length || !canWrite) return;
    let llm;
    if (!hosted && llmEnabled) {
      const key = apiKey.trim() || (await readLocalApiKey());
      if (!key) {
        toast.error("Add an API key", "Turn off AI extraction to use the deterministic extractor only.");
        return;
      }
      if (apiKey.trim()) {
        await storeLocalApiKey(apiKey.trim()).catch(() => undefined);
        setKeyStored(true);
        setApiKey("");
      }
      llm = { provider, modelId: modelId.trim() || defaultModelFor(provider), baseUrl: baseUrl.trim() || undefined, apiKey: key, budgetTokens, concurrency: 2 };
      if (provider === "openai-compatible" && !baseUrl.trim()) {
        toast.error("Add the provider's base URL");
        return;
      }
      writeLlmPrefs({ enabled: true, provider, modelId: llm.modelId, baseUrl: llm.baseUrl, budgetTokens, concurrency: 2 });
      const ok = await confirm({
        title: "Send redacted text to an AI provider?",
        message: `Extracted text of up to ${summary.extract} files will be sent to ${providerHost(llm)} (${llm.modelId}) with phone numbers, emails, SIN, account and card numbers and postal codes masked. Restricted files (payroll, banking, contact lists, consent forms) are never sent. Every call is listed in the run's processing log. Budget: ${budgetTokens.toLocaleString()} tokens.`,
        confirmLabel: "Start run",
        tone: "warn",
      });
      if (!ok) return;
    } else if (!hosted) writeLlmPrefs({ enabled: false, provider, modelId, baseUrl: baseUrl || undefined, budgetTokens, concurrency: 2 });
    setBusy(true);
    abort.current = new AbortController();
    setProgress({ stage: "inventory", done: 0, total: selection.files.length, counts: { files: selection.files.length }, errors: [] });
    try {
      const result = await runIntake(selection, {
        societyId: society._id, name: name.trim() || `Intake ${formatDate(todayDateOnly())}`, hosted, llm, mutation,
        ocr: ocrEnabled ? { pageBudget: ocrPageBudget } : undefined,
        extractRun: hosted ? (args) => extractRun(args) : undefined,
        onRunCreated: setActiveRunId,
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      toast.success("Intake run finished", { description: `${pluralize(result.progress.counts.extractions ?? 0, "document")} ready for review.`, action: { label: "Review", onClick: () => navigate(`/app/intake/${result.runId}/review`) } });
      setSelection(null);
      void originalsUsage().then(setUsage);
    } catch (error) {
      toast.error("Intake run failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const onPipelineOutput = (event: ChangeEvent<HTMLInputElement>) => {
    const found = pipelineOutputFiles(event.target.files);
    event.target.value = "";
    if ("error" in found) { toast.error("Not an intake run folder", found.error); return; }
    setPipelineOutput(found);
  };
  const importOutput = async () => {
    if (!pipelineOutput || !canWrite) return;
    setBusy(true);
    try {
      const result = await importPipelineOutput(pipelineOutput, { societyId: society._id, name: name.trim(), mutation, originals: pipelineOriginals, onProgress: setImportProgress });
      toast.success("Run imported", { description: `${pluralize(result.extractions, "document")} ready for review · ${pluralize(result.originalsCached, "original")} cached on this device.`, action: { label: "Review", onClick: () => navigate(`/app/intake/${result.runId}/review`) } });
      setPipelineOutput(null);
      setPipelineOriginals(null);
      setActiveRunId(result.runId);
      void originalsUsage().then(setUsage);
    } catch (error) {
      toast.error("Could not import the run", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const stageIndex = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;
  const allRuns = runs ?? [];

  return (
    <div className="page intake-page">
      <PageHeader
        title="AI intake"
        subtitle="Turn a folder of records into reviewed native records."
        info={<p>Choose a folder of minutes, agendas and records. The intake reads, sorts and extracts them, and every extracted value keeps a locator back to its source for review.</p>}
        actions={<>
          <Link className="btn-action" to="/app/imports" title="Import sessions" aria-label="Import sessions"><FileSearch size={12} /> Import sessions</Link>
          <Link className="btn-action" to="/app/coverage?tab=coverage" title="Coverage & gaps" aria-label="Coverage & gaps"><ScrollText size={12} /> Coverage & gaps</Link>
        </>}
      />

      <div className="intake-grid">
        <section className="card intake-new" aria-labelledby="intake-new-title">
          <div className="card__head">
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <h2 className="card__title" id="intake-new-title">New intake run</h2>
              <InfoPopover label="Where files are processed">
                <p>Files are read on this device. {hosted ? "Fields are extracted on the server with the workspace AI settings, with a deterministic fallback." : "Fields are extracted on this device; nothing leaves it unless you turn on an AI provider."}</p>
              </InfoPopover>
            </div>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <Field label="Run name">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </Field>
            <div className="row intake-pickers" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => filesInput.current?.click()} disabled={busy || !canWrite}><Files size={14} /> Choose files</button>
              <button type="button" className="btn" onClick={() => void chooseFolder()} disabled={busy || !canWrite}><FolderOpen size={14} /> Choose folder{desktop ? " (desktop)" : ""}</button>
              <input ref={filesInput} type="file" multiple hidden aria-label="Choose files for intake" data-testid="intake-files-input" onChange={(event) => onFiles(event, "upload")} />
              <input ref={folderInput} type="file" multiple hidden aria-label="Choose a folder for intake" onChange={(event) => onFiles(event, "local_folder")} {...{ webkitdirectory: "", directory: "" }} />
            </div>
            {selection && (
              <div className="intake-selection" aria-live="polite">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <strong>{selection.root}</strong>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelection(null)} disabled={busy}>Clear</button>
                </div>
                <div className="muted">{pluralize(summary.files, "file")} · {formatBytes(summary.bytes)}</div>
                <div className="intake-chips">
                  <Badge tone="success">{summary.extract} to extract</Badge>
                  <Badge>{summary.catalogue} catalogue only</Badge>
                  <Badge tone="warn">{summary.junk} junk</Badge>
                  {summary.excluded > 0 && <Badge tone="danger">{summary.excluded} excluded</Badge>}
                  {summary.ocrImages > 0 && <Badge tone="info">{summary.ocrImages} document images (OCR)</Badge>}
                </div>
                <div className="muted intake-ext">{summary.byExtension.slice(0, 8).map(([ext, count]) => `.${ext} ${count}`).join(" · ")}</div>
              </div>
            )}
            <fieldset className="intake-llm" data-testid="intake-ocr-options">
              <legend><ScanText size={13} /> Scanned documents</legend>
              <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                <label className="intake-check">
                  <input type="checkbox" checked={ocrEnabled} onChange={(event) => { setOcrEnabled(event.target.checked); writeOcrPrefs({ enabled: event.target.checked, pageBudget: ocrPageBudget }); }} disabled={busy} />
                  Read scanned pages with OCR on this device
                </label>
                <InfoPopover label="About OCR">
                  <p>Scanned PDF pages and document images (signed forms, certificates, letters) are read with the bundled English model on this device; no page is sent anywhere. Values read from low-confidence pages are never bulk-accepted.</p>
                </InfoPopover>
              </div>
              {ocrEnabled && (
                <div className="intake-llm__grid">
                  <Field label="Most pages to read by OCR in this run" hint="A page takes a few seconds; pages past the limit stay marked as needing OCR.">
                    <input className="input" style={{ width: 120, maxWidth: "100%" }} type="number" min={1} max={5000} step={10} value={ocrPageBudget} onChange={(event) => { const next = Math.min(5000, Math.max(1, Number(event.target.value) || 1)); setOcrPageBudget(next); writeOcrPrefs({ enabled: true, pageBudget: next }); }} disabled={busy} />
                  </Field>
                </div>
              )}
            </fieldset>
            {!hosted && (
              <fieldset className="intake-llm">
                <legend><Sparkles size={13} /> AI extraction (optional)</legend>
                <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                  <label className="intake-check">
                    <input type="checkbox" checked={llmEnabled} onChange={(event) => setLlmEnabled(event.target.checked)} disabled={busy} />
                    Use an AI provider from this device
                  </label>
                  <InfoPopover label="About AI extraction">
                    <p>The deterministic extractor is the fallback. Before any call, phone numbers, emails, SIN, account and card numbers and postal codes are masked; restricted files are never sent; each call is logged.</p>
                    <p>Workspace provider defaults come from <Link to="/app/ai-agents">AI settings</Link>.</p>
                  </InfoPopover>
                </div>
                {llmEnabled && (
                  <div className="intake-llm__grid">
                    <Field label="Provider">
                      <Select aria-label="Provider" value={provider} onChange={(value) => { setProvider(value as LocalLlmProvider); setModelId(defaultModelFor(value as LocalLlmProvider)); }} options={[{ value: "openai", label: "OpenAI" }, { value: "openrouter", label: "OpenRouter" }, { value: "openai-compatible", label: "OpenAI-compatible" }]} />
                    </Field>
                    <Field label="Model"><input className="input" value={modelId} onChange={(event) => setModelId(event.target.value)} /></Field>
                    {provider === "openai-compatible" && <Field label="Base URL"><input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://…/v1" /></Field>}
                    <Field label="API key" hint={keyStored ? `A key is stored in ${keyStorageLabel()}. Enter a new one to replace it.` : `Kept in ${keyStorageLabel()}; never saved to the workspace.`}>
                      <input className="input" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={keyStored ? "•••••••• (stored)" : "sk-…"} />
                    </Field>
                    <Field label="Token budget for this run"><input className="input" type="number" min={10000} step={10000} value={budgetTokens} onChange={(event) => setBudgetTokens(Math.max(10000, Number(event.target.value) || 10000))} /></Field>
                    {keyStored && <button type="button" className="btn btn--sm" onClick={() => void storeLocalApiKey("").then(() => setKeyStored(false))}><Trash2 size={12} /> Forget stored key</button>}
                  </div>
                )}
              </fieldset>
            )}
            {hosted && (
              <p className="muted" style={{ margin: 0 }}>
                <Sparkles size={12} /> Server extraction: {effective ? `${effective.label ?? effective.provider} · ${effective.modelId}` : "no AI provider configured — the deterministic extractor is used"}. <Link to="/app/ai-agents">AI settings</Link>
              </p>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn--accent" onClick={() => void start()} disabled={busy || !canWrite || !summary.extract}>
                {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {busy ? "Running…" : "Start intake run"}
              </button>
              {busy && <button type="button" className="btn" onClick={() => abort.current?.abort()}>Cancel</button>}
              {!canWrite && loaded && <span className="muted">Only Owners and Admins can start a run.</span>}
            </div>
            <details className="intake-import" data-testid="intake-import-output">
              <summary>Import a run processed on another computer</summary>
              <p className="muted" style={{ margin: "6px 0", display: "flex", gap: 6, alignItems: "center" }}>
                Choose the output folder of a run made on a workstation.
                <InfoPopover label="About importing a run">
                  <p>For large archives, run <span className="mono">npm run intake:run</span> on a workstation (legacy .doc/.xls files are converted with LibreOffice there), then choose its output folder (run.json, coverage.json, extracts). Optionally choose the original source folder so the review viewer and promotion can use the original files.</p>
                </InfoPopover>
              </p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn--sm" onClick={() => outputInput.current?.click()} disabled={busy || !canWrite}><FolderOpen size={12} /> Choose run output folder</button>
                <button type="button" className="btn btn--sm" onClick={() => originalsInput.current?.click()} disabled={busy || !canWrite || !pipelineOutput}><FolderOpen size={12} /> Choose originals folder (optional)</button>
                <input ref={outputInput} type="file" multiple hidden aria-label="Choose an intake run output folder" data-testid="intake-output-input" onChange={onPipelineOutput} {...{ webkitdirectory: "", directory: "" }} />
                <input ref={originalsInput} type="file" multiple hidden aria-label="Choose the original source folder" data-testid="intake-originals-input" onChange={(event) => { setPipelineOriginals(event.target.files); }} {...{ webkitdirectory: "", directory: "" }} />
              </div>
              {pipelineOutput && (
                <div className="muted" style={{ marginTop: 6 }} aria-live="polite">
                  run.json · {pipelineOutput.coverage ? "coverage.json · " : ""}{pluralize(pipelineOutput.extracts.length, "extract")}{pipelineOriginals ? ` · ${pluralize(pipelineOriginals.length, "original file")}` : ""}
                </div>
              )}
              {importProgress && importProgress.stage !== "done" && (
                <div style={{ marginTop: 6 }}>
                  <progress className="intake-bar" max={importProgress.total || 1} value={importProgress.done} aria-label="Import progress" />
                  <span className="muted">{importProgress.message}</span>
                </div>
              )}
              <button type="button" className="btn btn--sm btn--accent" style={{ marginTop: 8 }} onClick={() => void importOutput()} disabled={busy || !canWrite || !pipelineOutput} data-testid="intake-import-start">
                {busy && importProgress ? <Loader2 size={12} className="spin" /> : <FileSearch size={12} />} Import run
              </button>
            </details>
          </div>
        </section>

        <section className="card intake-progress" aria-labelledby="intake-progress-title" aria-live="polite">
          <div className="card__head">
            <h2 className="card__title" id="intake-progress-title">Progress</h2>
            {activeRunId && progress?.stage === "done" && <Link className="btn btn--sm btn--accent" to={`/app/intake/${activeRunId}/review`}>Review results</Link>}
          </div>
          <div className="card__body">
            {!progress && <p className="muted">Choose files or a folder and start a run to see each stage here.</p>}
            {progress && (
              <>
                <ol className="intake-stages">
                  {STAGES.map((stage) => {
                    const index = STAGE_ORDER.indexOf(stage.id);
                    const state = progress.stage === "done" || stageIndex > index ? "done" : stageIndex === index ? "active" : "todo";
                    const count = stageCount(stage.id, progress);
                    return (
                      <li key={stage.id} className={`intake-stage intake-stage--${state}`}>
                        {state === "done" ? <CheckCircle2 size={14} aria-hidden /> : state === "active" ? <Loader2 size={14} className="spin" aria-hidden /> : <Circle size={14} aria-hidden />}
                        <span>{stage.label}</span>
                        <span className="intake-stage__count">{count}</span>
                      </li>
                    );
                  })}
                  {hosted && (
                    <li className={`intake-stage intake-stage--${progress.stage === "done" ? "done" : progress.stage === "server" ? "active" : "todo"}`}>
                      {progress.stage === "done" ? <CheckCircle2 size={14} aria-hidden /> : progress.stage === "server" ? <Loader2 size={14} className="spin" aria-hidden /> : <Circle size={14} aria-hidden />}
                      <span>Server field extraction</span>
                    </li>
                  )}
                </ol>
                {progress.stage !== "done" && progress.total > 0 && <progress className="intake-bar" max={progress.total} value={progress.done} aria-label="Stage progress" />}
                {progress.message && <p className="muted">{progress.message}</p>}
                {progress.errors.length > 0 && (
                  <div className="intake-errors">
                    <strong><AlertTriangle size={13} /> {pluralize(progress.errors.length, "error")}</strong>
                    <ul>{progress.errors.slice(0, 8).map((error, index) => <li key={index}><span className="mono">{error.fileKey?.replace(/^local:/, "") ?? "run"}</span>: {error.message}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Runs</h2>
          <span className="card__subtitle">{pluralize(allRuns.length, "run")}{usage ? ` · originals cached on this device: ${usage.files} (${formatBytes(usage.bytes)})` : ""}</span>
          {usage && usage.files > 0 && (
            <button type="button" className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={async () => {
              if (!(await confirm({ title: "Forget cached originals?", message: `This removes ${usage.files} original files (${formatBytes(usage.bytes)}) kept in this browser for the review viewer. Extracted text, reviews and promoted records are kept; the viewer falls back to the text view.`, confirmLabel: "Forget originals", tone: "danger" }))) return;
              await clearOriginals();
              setUsage(await originalsUsage());
            }}>Forget cached originals</button>
          )}
        </div>
        <div className="table-wrap">
          <table className="table intake-runs-table">
            <thead><tr><th>Run</th><th>Status</th><th>Files</th><th>Reviewed</th><th>Native coverage</th><th>Record gaps</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {runs === undefined && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {runs && allRuns.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No intake runs yet.</td></tr>}
              {allRuns.map((run: any) => {
                const summaryRow = summariesById.get(String(run._id));
                const coverage = run.coverage?.coverage;
                return (
                  <tr key={run._id}>
                    <td>
                      <button type="button" className="intake-link-button" onClick={() => setDetailRunId(run._id)}>{run.name}</button>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{relative(run.createdAtISO)} · {run.engine?.llm ? `${run.engine.llm.provider} ${run.engine.llm.model}` : run.engine?.minutes ?? "deterministic"}</div>
                    </td>
                    <td><Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{STATUS_LABEL[run.status] ?? run.status}</Badge></td>
                    <td className="mono">{run.stats?.files ?? "—"}</td>
                    <td className="mono">{summaryRow ? `${summaryRow.promoted}/${summaryRow.extractions} promoted` : "—"}</td>
                    <td className="mono" title="Reviewed: promoted fields ÷ extracted facts. Extractable: native-mappable share at extraction time.">{typeof summaryRow?.promotedCoverage === "number" ? `${Math.round(summaryRow.promotedCoverage * 100)}%` : "—"}<div className="muted" style={{ fontSize: 11 }}>{typeof coverage === "number" ? `${Math.round(coverage * 100)}% extractable` : ""}</div></td>
                    <td className="mono">{run.recordGaps || 0}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link className="btn btn--sm btn--accent" to={`/app/intake/${run._id}/review`}>Review</Link>{" "}
                      <button type="button" className="btn btn--sm" onClick={() => setDetailRunId(run._id)}>Details</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <RunDetailDrawer societyId={society._id} runId={detailRunId} onClose={() => setDetailRunId(null)} />
    </div>
  );
}

function stageCount(stage: IntakeStageId, progress: IntakeProgress): string {
  const c = progress.counts;
  switch (stage) {
    case "inventory": return `${c.files ?? 0}`;
    case "junk": return `${(c.junk ?? 0) + (c.excluded ?? 0)} removed`;
    case "extract": return c.extracted !== undefined ? `${c.extracted}${c.catalogue ? ` · ${c.catalogue} catalogued` : ""}` : progress.stage === "extract" ? `${progress.done}/${progress.total}` : "";
    case "cluster": return c.clusters !== undefined ? `${c.clusters}${c.duplicates ? ` · ${c.duplicates} copies` : ""}` : "";
    case "classify": return c.classified !== undefined ? `${c.classified}${c.restricted ? ` · ${c.restricted} restricted` : ""}` : "";
    case "fields": return progress.stage === "fields" ? `${progress.done}/${progress.total}` : c.extractions !== undefined ? `${c.extractions}` : "";
    case "stage": return progress.stage === "stage" ? `${progress.done}/${progress.total}` : "";
    default: return "";
  }
}

const DISPOSITION_TONE: Record<string, "success" | "warn" | "danger" | "info" | "neutral"> = { extract: "success", catalogue: "neutral", junk: "warn", excluded: "danger", duplicate: "info", pending: "warn", restricted: "danger" };

/** Run details: dispositions and classes, every file with its reason, and the processing log. */
function RunDetailDrawer({ societyId, runId, onClose }: { societyId: string; runId: string | null; onClose: () => void }) {
  const run = useQuery(api.intake.getRun, runId ? { societyId, runId } : "skip") as any;
  const files = useQuery(api.intake.listFiles, runId ? { societyId, runId } : "skip") as any[] | undefined;
  const log = useQuery(api.intake.processingLog, runId ? { societyId, runId } : "skip") as any[] | undefined;
  const [tab, setTab] = useState<"files" | "log" | "gaps">("files");
  const [filter, setFilter] = useState("all");
  const shown = (files ?? []).filter((file) => filter === "all" || file.disposition === filter);
  const sent = (log ?? []).filter((entry) => entry.sentToProvider);
  const toast = useToast();
  const originalsPicker = useRef<HTMLInputElement>(null);
  const [caching, setCaching] = useState(false);
  const addOriginals = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files;
    if (!chosen?.length || !files) return;
    setCaching(true);
    try {
      const result = await cacheRunOriginals(files, Array.from(chosen));
      toast.success(`${pluralize(result.cached, "original file")} cached on this device`, `${result.matched} of ${chosen.length} chosen files matched this run by path and size. The review viewer and promotion use them.`);
    } catch (error) {
      toast.error("Could not cache the originals", error instanceof Error ? error.message : undefined);
    } finally {
      setCaching(false);
      event.target.value = "";
    }
  };
  return (
    <Drawer open={Boolean(runId)} onClose={onClose} title={run?.name ?? "Intake run"} size="wide"
      footer={runId ? <Link className="btn btn--accent" to={`/app/intake/${runId}/review`}>Open review</Link> : undefined}>
      {!run && <p className="muted">Loading…</p>}
      {run && (
        <div className="col" style={{ gap: 12 }}>
          <div className="muted">{formatDateTime(run.createdAtISO)} · {run.sourceKind === "local_folder" ? "Folder" : run.sourceKind === "upload" ? "Uploaded files" : "Drive inventory"} {run.sourceRoot ? <span className="mono">{run.sourceRoot}</span> : null}</div>
          {run.stats?.error && <Banner tone="danger">{run.stats.error}</Banner>}
          <div className="stat-grid">
            <div className="stat"><div className="stat__label">Files</div><div className="stat__value">{run.counts.files}</div></div>
            <div className="stat"><div className="stat__label">Extractions</div><div className="stat__value">{run.counts.extractions}</div></div>
            <div className="stat"><div className="stat__label">Clusters</div><div className="stat__value">{run.counts.clusters}</div></div>
            <div className="stat"><div className="stat__label">Sent to a provider</div><div className="stat__value">{sent.length}</div></div>
          </div>
          <div className="intake-chips">
            {Object.entries(run.counts.byDisposition ?? {}).map(([key, count]) => <Badge key={key} tone={DISPOSITION_TONE[key] ?? "neutral"}>{key} {String(count)}</Badge>)}
          </div>
          <div className="intake-chips">
            {Object.entries(run.counts.byClass ?? {}).filter(([key]) => key !== "unknown").map(([key, count]) => <Badge key={key} tone="info">{key} {String(count)}</Badge>)}
          </div>
          {runId && <CompactRunPanel societyId={societyId} runId={runId} />}
          <div className="segmented" role="tablist" aria-label="Run details">
            {(["files", "log", "gaps"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`segmented__btn${tab === id ? " is-active" : ""}`} onClick={() => setTab(id)}>
                {id === "files" ? `Files (${files?.length ?? 0})` : id === "log" ? `Processing log (${log?.length ?? 0})` : `Record gaps (${run.recordGaps?.length ?? 0})`}
              </button>
            ))}
          </div>
          {tab === "files" && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Select aria-label="Filter by disposition" value={filter} onChange={setFilter} options={[{ value: "all", label: "All dispositions" }, ...Object.keys(run.counts.byDisposition ?? {}).map((key) => ({ value: key, label: key }))]} />
                <button type="button" className="btn btn--sm" onClick={() => originalsPicker.current?.click()} disabled={caching || !files} title="Choose the source folder, or any subfolder of it, to keep this run's original files on this device for the viewer and promotion.">
                  {caching ? <Loader2 size={12} className="spin" /> : <FolderOpen size={12} />} Add original files
                </button>
                <input ref={originalsPicker} type="file" multiple hidden aria-label="Choose original source files for this run" data-testid="intake-run-originals-input" onChange={(event) => void addOriginals(event)} {...{ webkitdirectory: "", directory: "" }} />
              </div>
              <div className="table-wrap">
                <table className="table intake-detail-table">
                  <thead><tr><th>File</th><th>Disposition</th><th>Class</th><th>Reason</th></tr></thead>
                  <tbody>
                    {shown.slice(0, 400).map((file) => (
                      <tr key={file._id}>
                        <td className="intake-path-cell"><span className="mono">{file.path}</span>{file.sensitivity === "restricted" && <> <Badge tone="danger"><Lock size={10} /> restricted</Badge></>}</td>
                        <td><Badge tone={DISPOSITION_TONE[file.disposition] ?? "neutral"}>{file.disposition}</Badge></td>
                        <td>{file.docClass ?? "—"}{file.classification?.bodyLabel ? <div className="muted">{file.classification.bodyLabel}</div> : null}</td>
                        <td className="muted">{file.dispositionReason ?? file.classification?.restrictedReason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "log" && (
            <div className="table-wrap">
              <table className="table intake-detail-table">
                <thead><tr><th>When</th><th>Stage</th><th>File</th><th>Provider</th><th>Note</th></tr></thead>
                <tbody>
                  {(log ?? []).map((entry) => (
                    <tr key={entry._id}>
                      <td className="mono">{entry.atISO.slice(11, 19)}</td>
                      <td>{entry.stage}{entry.sentToProvider && <> <Badge tone="warn">sent</Badge></>}</td>
                      <td className="mono intake-path-cell">{entry.fileKey?.replace(/^local:/, "") ?? "—"}</td>
                      <td>{entry.provider ? `${entry.provider} ${entry.model ?? ""}` : "—"}{entry.redactions && Object.keys(entry.redactions).length ? <div className="muted">masked: {Object.entries(entry.redactions).map(([kind, count]) => `${kind} ${count}`).join(", ")}</div> : null}</td>
                      <td className="muted">{entry.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "gaps" && (
            <div className="col" style={{ gap: 8 }}>
              {(run.recordGaps ?? []).length === 0 && <p className="muted">No record gaps were found in this run.</p>}
              {(run.recordGaps ?? []).map((gap: any, index: number) => (
                <div key={index} className="coverage-gap-row">
                  <div><strong>{gap.kind?.replace(/_/g, " ")}</strong> {gap.date ?? gap.year ?? ""} <Badge tone={gap.severity === "statutory" ? "danger" : "warn"}>{gap.severity}</Badge><div className="muted">{gap.explanation}</div></div>
                </div>
              ))}
              <Link to="/app/coverage?tab=record">Open record gaps in Coverage & gaps</Link>
            </div>
          )}
          {getDesktopBridge() && <p className="muted">Desktop: legacy .doc/.xls files are converted with LibreOffice when it is installed.</p>}
        </div>
      )}
    </Drawer>
  );
}

const OCR_PREFS_KEY = "societyer.intake.ocr";
function readOcrPrefs(): { enabled: boolean; pageBudget: number } {
  try {
    const stored = JSON.parse(localStorage.getItem(OCR_PREFS_KEY) ?? "null");
    if (stored && typeof stored.enabled === "boolean") return { enabled: stored.enabled, pageBudget: Math.min(5000, Math.max(1, Number(stored.pageBudget) || 200)) };
  } catch {
    // unavailable storage: defaults
  }
  return { enabled: true, pageBudget: 200 };
}
function writeOcrPrefs(prefs: { enabled: boolean; pageBudget: number }) {
  try {
    localStorage.setItem(OCR_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // not remembered
  }
}
