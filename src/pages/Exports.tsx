import { useState } from "react";
import { useConvex } from "convex/react";
import { Download, Database } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";

const TABLES = [
  "members",
  "directors",
  "committees",
  "meetings",
  "minutes",
  "filings",
  "deadlines",
  "volunteers",
  "grants",
  "grantApplications",
  "grantReports",
  "donationReceipts",
  "financialTransactions",
  "financialAccounts",
  "budgets",
  "conflicts",
  "attestations",
  "insurancePolicies",
  "pipaTrainings",
  "memberSubscriptions",
  "employees",
  "documents",
  "activity",
] as const;

type Table = (typeof TABLES)[number];
type Format = "csv" | "json";

export function ExportsPage() {
  const society = useSociety();
  const convex = useConvex();
  const [format, setFormat] = useState<Format>("csv");
  const [busy, setBusy] = useState<Table | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const download = async (table: Table) => {
    setBusy(table);
    try {
      const rows = (await convex.query(api.exports.exportTable, {
        societyId: society._id,
        table,
      })) as Array<Record<string, unknown>>;
      const body = format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const mime = format === "csv" ? "text/csv" : "application/json";
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([body], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${society.name.replace(/\s+/g, "_").toLowerCase()}-${table}-${date}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Data export"
        icon={<Database size={16} />}
        iconColor="blue"
        subtitle="Download any table as CSV or JSON. Use for backups, audits, or migrating to another tool."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="muted">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
                className="input"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </label>
          </div>
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Tables</h2>
          <span className="card__subtitle">One file per table. Document binaries are not included.</span>
        </div>
        <div className="card__body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 8,
            }}
          >
            {TABLES.map((t) => (
              <button
                key={t}
                className="btn"
                disabled={busy !== null}
                onClick={() => download(t)}
                style={{ justifyContent: "space-between" }}
              >
                <span>{t}</span>
                {busy === t ? <span className="muted">…</span> : <Download size={14} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  const header = columns.map(csvEscape).join(",");
  const body = rows
    .map((row) => columns.map((col) => csvEscape(serializeCell(row[col]))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function serializeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
