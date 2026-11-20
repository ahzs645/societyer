import { useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { useSociety } from "../../../hooks/useSociety";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "../../../pages/_helpers";
import { Banner, EmptyState } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import { BooksNav } from "../components/BooksNav";
import { BillingReportScheduleForm } from "../../invoicing/BillingReportScheduleForm";
import {
  cleanCommerceDefinition,
  defaultCommerceReport,
  type CommerceReportDefinition,
  type CommerceReportResult,
} from "../../../../shared/commerceReports";
import { loadCommerceReport } from "../../../../shared/commerceReportSources";
import { commerceReportDocument } from "../../../../shared/commerceReportDocument";
import { downloadTableExport } from "../../../lib/tableExport";
import { sheetTextRows } from "../../../lib/xlsx/textRows";
import { CommerceReportEditor } from "./CommerceReportEditor";
import { CommerceReportView } from "./CommerceReportView";
import {
  FilterPresetsCard,
  ReportResultsCard,
  ReportSourceCatalog,
  SavedReportsCard,
  type CommercePreset,
  type SavedCommerceReport,
} from "./CommerceReportCards";

type SavedPage = { page: SavedCommerceReport[]; isDone: boolean; continueCursor: string };
type PresetPage = { page: CommercePreset[]; isDone: boolean; continueCursor: string };

function failure(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

/** Downloads the cleaned definition as JSON so it can be imported elsewhere. */
function downloadDefinition(draft: CommerceReportDefinition) {
  const definition = cleanCommerceDefinition(draft);
  const blob = new Blob([JSON.stringify({ format: "societyer-report", version: 1, definition }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${definition.name.replace(/[^a-z0-9_-]/gi, "_")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CommerceReportsPage() {
  const society = useSociety();
  if (society === undefined) return <PageLoading />;
  if (!society) return <SeedPrompt />;
  return <CommerceReportsWorkspace societyId={society._id} societyName={society.name} />;
}

function CommerceReportsWorkspace({ societyId, societyName }: { societyId: string; societyName: string }) {
  const client = useConvex();
  const permissions = useFinancePermissions();
  const toast = useToast();
  const save = useMutation(api.commerceReports.saveDefinition);
  const duplicate = useMutation(api.commerceReports.duplicateDefinition);
  const archive = useMutation(api.commerceReports.archiveDefinition);
  const savePreset = useMutation(api.commerceReports.savePreset);
  const removePreset = useMutation(api.commerceReports.removePreset);

  const [showArchived, setShowArchived] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prior, setPrior] = useState<SavedCommerceReport[]>([]);
  const savedPage = useQuery(api.commerceReports.listDefinitions, { societyId, archived: showArchived, cursor }) as
    | SavedPage
    | undefined;

  const [draft, setDraft] = useState<CommerceReportDefinition | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [result, setResult] = useState<CommerceReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [presetName, setPresetName] = useState("");
  const cancel = useRef(false);

  const presets = useQuery(
    api.commerceReports.listPresets,
    draft ? { societyId, source: draft.source } : "skip",
  ) as PresetPage | undefined;
  const [presetCursor, setPresetCursor] = useState<string | null>(null);
  const [extraPresets, setExtraPresets] = useState<CommercePreset[]>([]);
  const extraPage = useQuery(
    api.commerceReports.listPresets,
    draft && presetCursor ? { societyId, source: draft.source, cursor: presetCursor } : "skip",
  ) as PresetPage | undefined;
  const allPresets = [...(presets?.page ?? []), ...extraPresets, ...(extraPage?.page ?? [])];
  const lastPresetPage = extraPage ?? presets;

  const pending = Boolean(draft && result && JSON.stringify(draft) !== JSON.stringify(result.definition));
  const pdf = useMemo(() => (result ? commerceReportDocument(result) : undefined), [result]);

  const resetSavedList = () => {
    setCursor(null);
    setPrior([]);
  };

  const open = (definition: CommerceReportDefinition, id?: string) => {
    setDraft(cleanCommerceDefinition(definition));
    setSavedId(id);
    setResult(null);
    setError("");
    setExtraPresets([]);
    setPresetCursor(null);
  };

  const run = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setProgress(0);
    cancel.current = false;
    try {
      const loaded = await loadCommerceReport(
        draft,
        (page) => client.query(api.commerceReports.sourcePage, { societyId, source: draft.source, ...page }),
        setProgress,
        () => cancel.current,
      );
      setResult(loaded);
    } catch (cause) {
      setError(failure(cause, "Report could not be loaded."));
    } finally {
      setBusy(false);
    }
  };

  const persist = async () => {
    if (!draft) return;
    try {
      const definition = cleanCommerceDefinition(draft);
      const id = await save({ societyId, id: savedId, definition });
      setSavedId(String(id));
      setDraft(definition);
      resetSavedList();
      toast.success("Report saved");
    } catch (cause) {
      setError(failure(cause, "Report could not be saved."));
    }
  };

  const exportSheet = async (format: "csv" | "xlsx") => {
    if (!result || pending) return;
    try {
      const meta = new Map(result.columns.map((column) => [column.key, column]));
      const columns = result.definition.columns.filter((column) => column.visible);
      const columnFormat = (key: string) => {
        const type = meta.get(key)?.type;
        if (type === "money") return { type: "accounting" as const, cents: true, currency: result.filters.currency };
        if (type === "number" || type === "percent") return { type: "number" as const };
        return {};
      };
      const sheet = {
        name: "Report",
        title: [societyName, result.title, ...(pdf?.filterSummary ?? [])],
        columns: columns.map((column) => ({ header: column.label, ...columnFormat(column.key) })),
        rows: result.rows.map((row) => columns.map((column) => row.values[column.key] ?? "")),
      };
      await downloadTableExport(result.title, format, {
        title: result.title,
        sheet: () => sheet,
        textRows: () => sheetTextRows(sheet),
      });
    } catch (cause) {
      setError(failure(cause, "Export failed."));
    }
  };

  const importDefinition = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 150000) throw new Error("Choose a report definition smaller than 150 KB.");
      const parsed = JSON.parse(await file.text());
      open(cleanCommerceDefinition(parsed.definition ?? parsed));
    } catch (cause) {
      setError(failure(cause, "Invalid report definition."));
    }
  };

  const exportDefinition = () => {
    if (!draft) return;
    try {
      downloadDefinition(draft);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const duplicateSaved = (saved: SavedCommerceReport) =>
    void duplicate({ societyId, id: saved._id })
      .then(resetSavedList)
      .catch((cause) => setError(String(cause)));

  const toggleArchived = (saved: SavedCommerceReport) =>
    void archive({ societyId, id: saved._id, archived: !saved.archived })
      .then(resetSavedList)
      .catch((cause) => setError(String(cause)));

  const loadMoreSaved = () => {
    if (!savedPage) return;
    setPrior([...prior, ...savedPage.page]);
    setCursor(savedPage.continueCursor);
  };

  const loadMorePresets = () => {
    if (extraPage) setExtraPresets([...extraPresets, ...extraPage.page]);
    if (lastPresetPage) setPresetCursor(lastPresetPage.continueCursor);
  };

  const addPreset = () => {
    if (!draft) return;
    void savePreset({ societyId, source: draft.source, name: presetName, filters: draft.filters })
      .then(() => setPresetName(""))
      .catch((cause) => setError(String(cause)));
  };

  return (
    <div className="page page--wide books-reports">
      <PageHeader
        title="Report catalog & designer"
        subtitle="Build, save and export reports from complete paginated domain records and posted journals."
        actions={
          <Link className="btn-action" to="/app/financials/reports/balance-sheet">
            Financial statements
          </Link>
        }
      />
      <BooksNav />
      <div className="commerce-reports">
        <ReportSourceCatalog onBuild={(source) => open(defaultCommerceReport(source))} />
        <SavedReportsCard
          reports={[...prior, ...(savedPage?.page ?? [])]}
          loading={savedPage === undefined}
          showArchived={showArchived}
          canWrite={permissions.canWrite}
          onShowArchived={(value) => {
            setShowArchived(value);
            resetSavedList();
          }}
          onImport={(file) => void importDefinition(file)}
          onOpen={(saved) => open(saved.definition, saved._id)}
          onDuplicate={duplicateSaved}
          onToggleArchived={toggleArchived}
          onLoadMore={savedPage && !savedPage.isDone ? loadMoreSaved : undefined}
        />
        {error && (
          <Banner tone="danger" onDismiss={() => setError("")}>
            {error}
          </Banner>
        )}
        {draft ? (
          <>
            <section className="card" aria-label="Report designer">
              <div className="card__head">
                <h2 className="card__title commerce-draft__title">{draft.name}</h2>
                <div className="commerce-head-actions">
                  <button type="button" className="btn btn--accent btn--sm" disabled={busy} onClick={() => void run()}>
                    {busy ? `Loading ${progress.toLocaleString()} source records…` : "Run full report"}
                  </button>
                  {busy && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => {
                        cancel.current = true;
                      }}
                    >
                      Cancel loading
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={!permissions.canWrite || busy}
                    onClick={() => void persist()}
                  >
                    Save report
                  </button>
                  <button type="button" className="btn btn--sm" onClick={exportDefinition}>
                    Export definition
                  </button>
                </div>
              </div>
              <div className="card__body">
                <CommerceReportEditor societyId={societyId} definition={draft} onChange={setDraft} />
              </div>
            </section>
            <FilterPresetsCard
              presets={allPresets}
              presetName={presetName}
              canWrite={permissions.canWrite}
              onPresetName={setPresetName}
              onApply={(preset) => setDraft({ ...draft, filters: preset.filters })}
              onRemove={(preset) => void removePreset({ societyId, id: preset._id })}
              onSave={addPreset}
              onLoadMore={lastPresetPage && !lastPresetPage.isDone ? loadMorePresets : undefined}
            />
            {savedId && (
              <section className="card" aria-label="Delivery schedule">
                <div className="card__head">
                  <h2 className="card__title">Delivery schedule</h2>
                </div>
                <div className="card__body">
                  <BillingReportScheduleForm societyId={societyId} definitionId={savedId} reportName={draft.name} />
                </div>
              </section>
            )}
            {pending && (
              <Banner tone="info">The designer has changed. Run the report to apply these settings before exporting.</Banner>
            )}
            {result && (
              <>
                <ReportResultsCard
                  societyId={societyId}
                  result={result}
                  pdf={pdf}
                  canExport={permissions.canExport}
                  disabled={pending || busy}
                  onExport={(format) => void exportSheet(format)}
                />
                <CommerceReportView result={result} />
              </>
            )}
          </>
        ) : (
          <EmptyState size="sm" title="No report open" description="Choose a source above or open a saved report." />
        )}
      </div>
    </div>
  );
}
