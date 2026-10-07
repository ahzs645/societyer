import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { FileSearch, Lock } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { Drawer } from "./ui";
import { pluralize } from "../lib/format";
import { isStructuralProvenanceField, provenanceFieldLabel } from "../../shared/provenanceFields";

type ProvenanceRow = {
  _id: string; targetTable: string; targetId: string; fieldPath: string; sourceFieldPath?: string; runId?: string; extractionId?: string; fileKey?: string;
  locator: { kind: string; page?: number; blockIndex?: number; cell?: string; sheet?: string; quote?: string }; value?: unknown; decision?: string; fileName?: string; runName?: string; restricted?: boolean;
};

const TABLE_LABEL: Record<string, string> = {
  meetings: "Meeting", minutes: "Minutes", motions: "Motion", agendaItems: "Agenda item", meetingMaterials: "Meeting material", policies: "Policy", bylawRuleSets: "Bylaw rule set",
  committees: "Committee", directors: "Director", organizationSeats: "Seat", proxies: "Proxy", financialStatementImports: "Financial statement", budgetSnapshots: "Budget",
  insurancePolicies: "Insurance policy", grants: "Grant", deadlines: "Deadline", filings: "Filing", sourceEvidence: "Source evidence", transactionCandidates: "Transaction candidate", agreements: "Agreement",
};

function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const object = value as Record<string, any>;
  if (typeof object.nameAsWritten === "string") return object.resolvedName ?? object.nameAsWritten;
  if (typeof object.iso === "string") return object.iso;
  if (typeof object.text === "string") return object.text;
  return JSON.stringify(value);
}

function where(locator: ProvenanceRow["locator"]) {
  return [locator.page ? `page ${locator.page}` : "", locator.sheet ? `sheet ${locator.sheet}` : "", locator.cell ? `cell ${locator.cell}` : "", locator.blockIndex !== undefined ? `block ${locator.blockIndex}` : ""].filter(Boolean).join(", ") || locator.kind;
}

/**
 * "View source" affordance for records promoted from an AI intake run (field
 * provenance). Renders nothing when the record has no provenance or the
 * viewer cannot read intake runs. Opens a drawer listing each promoted field
 * with the quoted source span and a link back to the review screen.
 *
 *   <SourceProvenanceButton table="meetings" id={meeting._id} />
 *
 * For a meeting it also covers the meeting's minutes and motions.
 */
export function SourceProvenanceButton({ table, id, label = "View source" }: { table: string; id: string | undefined | null; label?: string }) {
  const society = useSociety();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const allRows = useQuery(
    api.intake.provenanceForRecords,
    society && id && can("settings:read") ? { societyId: society._id, targets: [{ targetTable: table, targetId: String(id) }] } : "skip",
  ) as ProvenanceRow[] | undefined;
  // Structural paths (the extractor's `kind`, source ids, column keys…) stay stored but are not shown.
  const rows = allRows?.filter((row) => !isStructuralProvenanceField(row.fieldPath));
  if (!rows?.length) return null;
  const files = new Map<string, { fileName: string; runId?: string; runName?: string; extractionId?: string; restricted?: boolean; rows: ProvenanceRow[] }>();
  const order: Record<string, number> = { meetings: 0, minutes: 1, motions: 2 };
  const sorted = [...rows].sort((a, b) => (order[a.targetTable] ?? 9) - (order[b.targetTable] ?? 9) || a.targetId.localeCompare(b.targetId) || a.fieldPath.localeCompare(b.fieldPath, undefined, { numeric: true }));
  for (const row of sorted) {
    const key = `${row.runId}|${row.fileKey}`;
    const entry = files.get(key) ?? { fileName: row.fileName ?? row.fileKey ?? "Source", runId: row.runId, runName: row.runName, extractionId: row.extractionId, restricted: row.restricted, rows: [] };
    entry.rows.push(row);
    files.set(key, entry);
  }
  return (
    <span className="source-provenance" style={{ display: "inline-flex" }}>
      <button type="button" className="badge badge--info" onClick={() => setOpen(true)} aria-haspopup="dialog" title={`${pluralize(rows.length, "field")} came from ${pluralize(files.size, "source file")} through AI intake review`} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", border: 0 }} data-testid="view-source">
        <FileSearch size={12} aria-hidden="true" /> {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Source of this record" size="wide">
        <div className="col" style={{ gap: 16 }}>
          {[...files.values()].map((file) => (
            <section key={`${file.runId}|${file.fileName}`} className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{file.fileName}</strong>
                {file.restricted && <span className="badge badge--danger"><Lock size={10} /> restricted</span>}
                {file.runName && <span className="muted">from intake run “{file.runName}”</span>}
                {file.runId && file.extractionId && <Link className="btn btn--sm" to={`/app/intake/${file.runId}/review?e=${file.extractionId}`}>Open in review</Link>}
              </div>
              <ul className="source-provenance__list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {file.rows.map((row) => (
                  <li key={row._id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                      <strong>{TABLE_LABEL[row.targetTable] ?? row.targetTable} · {provenanceFieldLabel(row.fieldPath)}</strong>
                      {valueText(row.value) && <span>= {valueText(row.value)}</span>}
                      {row.decision === "edit" && <span className="badge badge--warn">edited by reviewer</span>}
                    </div>
                    {row.locator.quote && <blockquote style={{ margin: "4px 0", paddingLeft: 8, borderLeft: "3px solid var(--yellow-7)", color: "var(--text-secondary)", fontSize: 13 }}>“{row.locator.quote}”</blockquote>}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {where(row.locator)}
                      {row.runId && row.extractionId && row.sourceFieldPath && <> · <Link to={`/app/intake/${row.runId}/review?e=${row.extractionId}&f=${encodeURIComponent(row.sourceFieldPath)}`}>show in source</Link></>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Drawer>
    </span>
  );
}
