/**
 * Row editor for minutes collections that used to be edited as raw JSON or
 * pipe-separated text (ui-meetings F10, schema B4). The value stays the JSON
 * string the structured-minutes model already parses, so saving is unchanged;
 * only the editing surface is a form. Legacy pipe text that is not JSON is
 * shown read-only with a "Convert to rows" action.
 */
import { useEffect, useState } from "react";
import { EvidenceRowsEditor, type EvidenceColumn } from "@/components/EvidenceRowsEditor";

function parseRows(value: string): any[] | null {
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeRows(rows: any[], columns: EvidenceColumn[]): string {
  const keys = new Set(columns.map((column) => column.key));
  const cleaned = rows
    .map((row) => Object.fromEntries(Object.entries(row ?? {}).filter(([key, value]) => keys.has(key) && value !== undefined && value !== "")))
    .filter((row) => Object.keys(row).length > 0);
  return cleaned.length ? JSON.stringify(cleaned) : "";
}

export function StructuredRowsField({
  title,
  value,
  onChange,
  columns,
  legacyParse,
  fill,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  columns: EvidenceColumn[];
  /** Converts legacy pipe-separated text into rows. */
  legacyParse?: (value: string) => any[] | undefined;
  /** Optional one-click fill, e.g. AGM appointments from the attendance list. */
  fill?: { label: string; rows: () => any[] };
}) {
  // Rows live locally so a freshly added (still empty) row stays visible; the
  // serialized JSON is what the parent saves.
  const [rows, setRows] = useState<any[] | null>(() => parseRows(value));
  useEffect(() => {
    setRows((current) => (current && serializeRows(current, columns) === String(value ?? "").trim() ? current : parseRows(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (rows === null) {
    return (
      <div className="structured-rows-field structured-rows-field--legacy">
        <strong>{title}</strong>
        <pre className="muted">{value}</pre>
        {legacyParse && (
          <button type="button" className="btn-action" onClick={() => onChange(serializeRows(legacyParse(value) ?? [], columns))}>
            Convert to rows
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="structured-rows-field">
      {fill && (
        <button
          type="button"
          className="btn-action"
          style={{ marginBottom: 6 }}
          onClick={() => {
            // Add only names not already listed.
            const taken = new Set(rows.map((row) => String(row?.name ?? "").trim().toLowerCase()).filter(Boolean));
            const additions = fill.rows().filter((row) => row?.name && !taken.has(String(row.name).trim().toLowerCase()));
            const next = [...rows, ...additions];
            setRows(next);
            onChange(serializeRows(next, columns));
          }}
        >
          {fill.label}
        </button>
      )}
      <EvidenceRowsEditor title={title} rows={rows} columns={columns} onChange={(next) => { setRows(next); onChange(serializeRows(next, columns)); }} />
    </div>
  );
}

export const SESSION_SEGMENT_COLUMNS: EvidenceColumn[] = [
  { key: "type", label: "Session", options: ["public", "in_camera", "executive_session", "closed", "other"] },
  { key: "title", label: "Title" },
  { key: "startedAt", label: "Started (as written)" },
  { key: "endedAt", label: "Ended (as written)" },
  { key: "notes", label: "Notes" },
];

export const APPENDIX_COLUMNS: EvidenceColumn[] = [
  { key: "title", label: "Title" },
  { key: "type", label: "Type" },
  { key: "reference", label: "Reference" },
  { key: "notes", label: "Notes" },
];

export const DIRECTOR_APPOINTMENT_COLUMNS: EvidenceColumn[] = [
  { key: "name", label: "Name" },
  { key: "roleTitle", label: "Role" },
  { key: "affiliation", label: "Affiliation" },
  { key: "term", label: "Term" },
  { key: "status", label: "Status", options: ["nominated", "elected", "acclaimed", "appointed", "reappointed", "declined", "withdrawn"] },
  { key: "elected", label: "Elected", type: "boolean" },
  { key: "consentRecorded", label: "Consent on record", type: "boolean" },
  { key: "votesReceived", label: "Votes received", type: "number" },
  { key: "notes", label: "Notes" },
];

export const SPECIAL_RESOLUTION_EXHIBIT_COLUMNS: EvidenceColumn[] = [
  { key: "title", label: "Title" },
  { key: "reference", label: "Reference" },
  { key: "notes", label: "Notes" },
];
