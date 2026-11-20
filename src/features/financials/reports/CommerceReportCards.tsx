import { FileBarChart, Upload } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import {
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type RecordTableCardHelpers,
} from "../../../platform/record-engine/record-table";
import { FIELD_TYPES, type FieldMetadata } from "../../../platform/record-engine/types";
import {
  COMMERCE_REPORT_CATALOG,
  COMMERCE_REPORT_SOURCES,
  type CommerceReportDefinition,
  type CommerceReportResult,
  type CommerceReportSource,
} from "../../../../shared/commerceReports";
import type { BrandedReportData } from "./brandedReportTypes";
import { ReportPdfDownload } from "./ReportPdfDownload";

export type SavedCommerceReport = { _id: string; definition: CommerceReportDefinition; archived: boolean };
export type CommercePreset = { _id: string; name: string; filters: CommerceReportDefinition["filters"] };

/** A saved report as the table reads it. */
type SavedRecord = {
  _id: string;
  name: string;
  source: CommerceReportSource;
  status: "active" | "archived";
  saved: SavedCommerceReport;
};

const SAVED_REPORTS_TABLE = staticRecordTable({
  id: "commerce-saved-reports",
  nameSingular: "commerceReport",
  namePlural: "commerceReports",
  labelSingular: "Saved report",
  labelPlural: "Saved reports",
  labelIdentifierFieldName: "name",
  fields: [
    { name: "name", label: "Report", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    {
      name: "source",
      label: "Source",
      fieldType: FIELD_TYPES.SELECT,
      size: 220,
      config: {
        options: COMMERCE_REPORT_SOURCES.map((source) => ({
          value: source,
          label: COMMERCE_REPORT_CATALOG[source].title,
          color: "blue",
        })),
      },
    },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "active", label: "Active", color: "green" },
          { value: "archived", label: "Archived", color: "gray" },
        ],
      },
    },
  ],
});

/** One card per report source, each with its Build button. */
export function ReportSourceCatalog({ onBuild }: { onBuild: (source: CommerceReportSource) => void }) {
  return (
    <div className="invoice-commerce-grid">
      {COMMERCE_REPORT_SOURCES.map((source) => (
        <div className="card commerce-report-card" key={source}>
          <div className="card__head">
            <h2 className="card__title">{COMMERCE_REPORT_CATALOG[source].title}</h2>
          </div>
          <div className="card__body">
            <p className="muted">{COMMERCE_REPORT_CATALOG[source].description}</p>
            <button type="button" className="btn btn--sm commerce-report-card__build" onClick={() => onBuild(source)}>
              <span>
                Build<span className="finance-label-wide"> {COMMERCE_REPORT_CATALOG[source].title.toLowerCase()}</span>
              </span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SavedReportsCard({
  reports,
  loading,
  showArchived,
  canWrite,
  onShowArchived,
  onImport,
  onOpen,
  onDuplicate,
  onToggleArchived,
  onLoadMore,
}: {
  reports: SavedCommerceReport[];
  loading: boolean;
  showArchived: boolean;
  canWrite: boolean;
  onShowArchived: (value: boolean) => void;
  onImport: (file?: File) => void;
  onOpen: (report: SavedCommerceReport) => void;
  onDuplicate: (report: SavedCommerceReport) => void;
  onToggleArchived: (report: SavedCommerceReport) => void;
  /** Present while more saved reports remain to load. */
  onLoadMore?: () => void;
}) {
  const records: SavedRecord[] = reports.map((saved) => ({
    _id: saved._id,
    name: saved.definition.name,
    source: saved.definition.source,
    status: saved.archived ? "archived" : "active",
    saved,
  }));

  const renderCell = ({ record, field }: { record: SavedRecord; field: FieldMetadata }) => {
    if (field.name !== "status") return undefined;
    return (
      <Badge tone={record.saved.archived ? "neutral" : "success"}>{record.saved.archived ? "Archived" : "Active"}</Badge>
    );
  };

  const renderActions = (record: SavedRecord) => (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label={`Duplicate ${record.name}`}
        onClick={() => onDuplicate(record.saved)}
      >
        Duplicate
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label={`${record.saved.archived ? "Restore" : "Archive"} ${record.name}`}
        onClick={() => onToggleArchived(record.saved)}
      >
        {record.saved.archived ? "Restore" : "Archive"}
      </button>
    </>
  );

  // The card's button is named by the report alone, the way the table's name cell is.
  const renderPhoneCard = (record: SavedRecord, { open, selecting }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={record.name}
      badge={record.saved.archived ? <Badge tone="neutral">Archived</Badge> : undefined}
      onOpen={open}
      selecting={selecting}
    />
  );

  return (
    <section className="card" aria-label="Saved reports">
      <div className="card__head">
        <h2 className="card__title">Saved reports</h2>
        <div className="commerce-head-actions">
          <Checkbox label="Show archived reports" checked={showArchived} onChange={onShowArchived} />
          <label className="btn btn--sm bank-csv-import__file">
            <Upload size={12} aria-hidden="true" /> Import report definition
            <input
              className="bank-csv-import__file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                onImport(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <RecordListTable<SavedRecord>
        variant="card"
        table={SAVED_REPORTS_TABLE}
        tableId="commerce-saved-reports"
        label="Saved reports"
        icon={<FileBarChart size={14} />}
        records={records}
        loading={loading}
        onOpen={(record) => onOpen(record.saved)}
        renderCell={renderCell}
        renderRowActions={canWrite ? renderActions : undefined}
        renderPhoneCard={renderPhoneCard}
        emptyState={
          <RecordTableEmpty
            title={showArchived ? "No archived reports" : "No saved reports yet"}
            description={showArchived ? undefined : "Build a report from a source above, then save it here."}
          />
        }
      />
      {onLoadMore && (
        <div className="card__footer">
          <button type="button" className="btn btn--sm" onClick={onLoadMore}>
            Load more saved reports
          </button>
        </div>
      )}
    </section>
  );
}

export function FilterPresetsCard({
  presets,
  presetName,
  canWrite,
  onPresetName,
  onApply,
  onRemove,
  onSave,
  onLoadMore,
}: {
  presets: CommercePreset[];
  presetName: string;
  canWrite: boolean;
  onPresetName: (name: string) => void;
  onApply: (preset: CommercePreset) => void;
  onRemove: (preset: CommercePreset) => void;
  onSave: () => void;
  /** Present while more presets remain to load. */
  onLoadMore?: () => void;
}) {
  return (
    <section className="card" aria-label="Saved filter presets">
      <div className="card__head">
        <h2 className="card__title">Saved filter presets</h2>
      </div>
      <div className="card__body commerce-presets">
        {presets.length > 0 && (
          <div className="commerce-presets__list">
            {presets.map((preset) => (
              <span key={preset._id} className="commerce-presets__item">
                <button type="button" className="btn btn--sm" onClick={() => onApply(preset)}>
                  {preset.name}
                </button>
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={() => onRemove(preset)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {onLoadMore && (
          <button type="button" className="btn btn--sm" onClick={onLoadMore}>
            Load more presets
          </button>
        )}
        <div className="commerce-presets__new">
          <input
            className="input"
            aria-label="Filter preset name"
            placeholder="Preset name"
            value={presetName}
            onChange={(event) => onPresetName(event.target.value)}
          />
          <button type="button" className="btn btn--sm" disabled={!canWrite || !presetName.trim()} onClick={onSave}>
            Save filter preset
          </button>
        </div>
      </div>
    </section>
  );
}

/** The run's row counts and its CSV, Excel and branded PDF exports. */
export function ReportResultsCard({
  societyId,
  result,
  pdf,
  canExport,
  disabled,
  onExport,
}: {
  societyId: string;
  result: CommerceReportResult;
  pdf?: BrandedReportData;
  canExport: boolean;
  /** The designer changed since the run, or a run or export is in progress. */
  disabled: boolean;
  onExport: (format: "csv" | "xlsx") => void;
}) {
  const counts = `${result.sourceRowCount.toLocaleString()} source rows → ${result.rows.length.toLocaleString()} result rows · ${result.filters.currency}`;
  return (
    <section className="card" aria-label="Report results">
      <div className="card__head">
        <div className="commerce-results__title">
          <h2 className="card__title">Report results</h2>
          <span className="card__subtitle">{counts}</span>
        </div>
        <div className="commerce-head-actions">
          <button type="button" className="btn btn--sm" disabled={!canExport || disabled} onClick={() => onExport("csv")}>
            Export all CSV
          </button>
          <button type="button" className="btn btn--sm" disabled={!canExport || disabled} onClick={() => onExport("xlsx")}>
            Export all Excel
          </button>
        </div>
      </div>
      {canExport && (
        <div className="card__body">
          <ReportPdfDownload societyId={societyId} report={pdf} disabled={disabled} filename={result.title} />
        </div>
      )}
    </section>
  );
}
