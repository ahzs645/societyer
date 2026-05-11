import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { Button, Banner, EmptyState } from "./ui";
import { Upload, FileText, CheckCircle2 } from "lucide-react";
import { cleanCsvCell, parseCsv } from "../lib/csv";
import { Select } from "./Select";
import {
  suggestImportMappings,
  validateImportedRows,
  buildRecordFromImportedRow,
  type ImportMappingSuggestion,
} from "../lib/importMapping";

export type ImportTargetField = {
  id: string;
  label: string;
  required?: boolean;
  aliases?: string[];
  type?: "text" | "number" | "select" | "multiSelect" | "date" | "boolean";
  options?: { value: string; label: string }[];
  targetPath?: string;
  transform?: (value: string, row: Record<string, string>) => unknown;
  /** Optional per-row validator. Returns an error string if invalid. */
  validate?: (value: string) => string | null;
};

export type ImportTarget = {
  id: string;
  label: string;
  fields: ImportTargetField[];
  maxRows?: number;
  /** Commit one row to the backend. */
  onImportRow: (row: Record<string, any>) => Promise<void>;
};

type Step = "upload" | "map" | "preview";

export function ImportWizard({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ImportTarget;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [mappingSuggestions, setMappingSuggestions] = useState<Record<number, ImportMappingSuggestion[]>>({});
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  const reset = () => {
    setStep("upload");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setMappingSuggestions({});
    setImporting(false);
    setImportedCount(0);
    setErrors([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) return;
    const [head, ...body] = parsed.map((row) => row.map(cleanCsvCell));
    setHeaders(head);
    setRows(body);
    const suggested = suggestImportMappings({
      headers: head,
      fields: target.fields.map((field) => ({
        id: field.id,
        label: field.label,
        aliases: field.aliases,
        required: field.required,
        type: field.type,
        options: field.options,
      })),
    });
    setMapping(suggested.mapping);
    setMappingSuggestions(suggested.suggestionsByColumn);
    setStep("map");
  };

  const mappedRows = useMemo(() => {
    return rows.map((r) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) {
        const field = mapping[i];
        if (field) obj[field] = (r[i] ?? "").trim();
      }
      return obj;
    });
  }, [rows, headers, mapping]);

  const validationErrors = useMemo(() => {
    const errs: { row: number; message: string }[] = [];
    validateImportedRows({
      rows: mappedRows,
      fields: target.fields,
      maxRows: target.maxRows ?? 5000,
    }).forEach((issue) => {
      errs.push({
        row: issue.row,
        message: `${issue.level === "warn" ? "Warning: " : ""}${issue.message}`,
      });
    });
    mappedRows.forEach((r, idx) => {
      for (const f of target.fields) {
        if (f.required && !r[f.id]) {
          errs.push({ row: idx + 2, message: `Missing ${f.label}` });
          continue;
        }
        const v = r[f.id];
        if (v && f.validate) {
          const msg = f.validate(v);
          if (msg) errs.push({ row: idx + 2, message: `${f.label}: ${msg}` });
        }
      }
    });
    return errs;
  }, [mappedRows, target.fields, target.maxRows]);

  const requiredUnmapped = target.fields
    .filter((f) => f.required)
    .filter((f) => !Object.values(mapping).includes(f.id));

  const doImport = async () => {
    setImporting(true);
    setImportedCount(0);
    const newErrors: { row: number; message: string }[] = [];
    for (let i = 0; i < mappedRows.length; i += 1) {
      try {
        await target.onImportRow(
          buildRecordFromImportedRow({
            row: mappedRows[i],
            fields: target.fields,
          }),
        );
        setImportedCount((c) => c + 1);
      } catch (err) {
        newErrors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : "Failed",
        });
      }
    }
    setErrors(newErrors);
    setImporting(false);
  };

  return (
    <Modal open={open} onClose={close} title={`Import ${target.label}`} size="lg">
      <div className="import-wizard">
        <ol className="import-wizard__steps">
          <li className={`import-wizard__step${step === "upload" ? " is-active" : ""}`}>
            <Upload size={14} /> Upload CSV
          </li>
          <li className={`import-wizard__step${step === "map" ? " is-active" : ""}`}>
            <FileText size={14} /> Map columns
          </li>
          <li className={`import-wizard__step${step === "preview" ? " is-active" : ""}`}>
            <CheckCircle2 size={14} /> Preview & import
          </li>
        </ol>

        {step === "upload" && (
          <div className="import-wizard__pane">
            <EmptyState
              icon={<Upload size={18} />}
              title={`Drop your ${target.label.toLowerCase()} CSV here`}
              description="The first row should contain column headers."
              action={
                <label className="btn btn--accent">
                  Choose file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onFile(f);
                    }}
                  />
                </label>
              }
            />
          </div>
        )}

        {step === "map" && (
          <div className="import-wizard__pane">
            <Banner tone="info">
              We guessed mappings from your headers — double-check below. Unmapped columns are ignored.
            </Banner>
            <table className="table import-wizard__mapping">
              <thead>
                <tr>
                  <th>Your column</th>
                  <th>Sample</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i}>
                    <td><strong>{h}</strong></td>
                    <td className="muted">{rows[0]?.[i] ?? ""}</td>
                    <td>
                      <Select value={mapping[i] ?? ""} onChange={value => setMapping(m => ({
  ...m,
  [i]: value
}))} options={[{
  value: "",
  label: "— Ignore —"
}, ...target.fields.map(f => ({
  value: f.id,
  label: [f.label, f.required ? " *" : ""].join(" ")
}))]} className="input" />
                      {mappingSuggestions[i]?.length > 1 && (
                        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          Alternatives:{" "}
                          {mappingSuggestions[i]
                            .slice(0, 3)
                            .map((suggestion) =>
                              `${target.fields.find((field) => field.id === suggestion.fieldId)?.label} (${suggestion.confidence})`,
                            )
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {requiredUnmapped.length > 0 && (
              <Banner tone="warn" title="Required fields not mapped">
                Map a column to: {requiredUnmapped.map((f) => f.label).join(", ")}
              </Banner>
            )}
            <div className="import-wizard__footer">
              <Button onClick={() => setStep("upload")}>Back</Button>
              <Button
                variant="accent"
                onClick={() => setStep("preview")}
                disabled={requiredUnmapped.length > 0}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="import-wizard__pane">
            <Banner tone={validationErrors.length > 0 ? "warn" : "info"}>
              {mappedRows.length} row{mappedRows.length === 1 ? "" : "s"} parsed.
              {validationErrors.length > 0 && ` ${validationErrors.length} validation issue${validationErrors.length === 1 ? "" : "s"} — rows with missing required fields will fail to import.`}
            </Banner>
            <div className="import-wizard__preview-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {target.fields.map((f) => <th key={f.id}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      {target.fields.map((f) => {
                        const v = r[f.id] ?? "";
                        const missing = f.required && !v;
                        return (
                          <td
                            key={f.id}
                            style={missing ? { color: "var(--danger)" } : undefined}
                          >
                            {v || (missing ? "— missing —" : <span className="muted">—</span>)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {mappedRows.length > 10 && (
                <div className="muted" style={{ padding: 8, textAlign: "center" }}>
                  Showing first 10 of {mappedRows.length} rows.
                </div>
              )}
            </div>
            {importing && (
              <Banner tone="info">
                Importing… {importedCount} of {mappedRows.length}
              </Banner>
            )}
            {!importing && importedCount > 0 && errors.length === 0 && (
              <Banner tone="success">
                Imported {importedCount} {target.label.toLowerCase()} successfully.
              </Banner>
            )}
            {errors.length > 0 && (
              <Banner tone="danger" title="Some rows failed">
                <ul>
                  {errors.slice(0, 5).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.message}</li>
                  ))}
                </ul>
              </Banner>
            )}
            <div className="import-wizard__footer">
              <Button onClick={() => setStep("map")} disabled={importing}>Back</Button>
              {importedCount === 0 ? (
                <Button
                  variant="accent"
                  onClick={doImport}
                  disabled={importing || mappedRows.length === 0}
                >
                  {importing ? "Importing…" : `Import ${mappedRows.length} row${mappedRows.length === 1 ? "" : "s"}`}
                </Button>
              ) : (
                <Button variant="accent" onClick={close}>Done</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
