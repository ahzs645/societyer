import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Scale, Link2, Undo2, Tag } from "lucide-react";
import { formatDate, money } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  {
    id: "status",
    label: "Status",
    icon: <Tag size={14} />,
    options: ["Reconciled", "Has suggestion", "Unmatched"],
    match: (r, q) => {
      if (r.txn.reconciledAtISO) return q === "Reconciled";
      if ((r.candidates?.length ?? 0) > 0) return q === "Has suggestion";
      return q === "Unmatched";
    },
  },
  {
    id: "direction",
    label: "Direction",
    options: ["Inflow", "Outflow"],
    match: (r, q) => (r.txn.amountCents > 0 ? "Inflow" : "Outflow") === q,
  },
  {
    id: "year",
    label: "Year",
    match: (r, q) => (r.txn.date ?? "").startsWith(q),
  },
];

export function ReconciliationPage() {
  const society = useSociety();
  const overview = useQuery(
    api.reconciliation.overview,
    society ? { societyId: society._id } : "skip",
  );
  const matchM = useMutation(api.reconciliation.match);
  const markManualM = useMutation(api.reconciliation.markManual);
  const unmatchM = useMutation(api.reconciliation.unmatch);
  const prompt = usePrompt();
  const toast = useToast();

  const [selected, setSelected] = useState<string | null>(null);

  const rows = overview?.rows ?? [];
  const summary = overview?.summary ?? { total: 0, reconciled: 0, withSuggestions: 0, unmatched: 0 };

  const selectedRow = useMemo(
    () => rows.find((r: any) => (r.txn._id as any) === selected) ?? null,
    [rows, selected],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const autoMatchAllHighConfidence = async () => {
    let count = 0;
    for (const r of rows) {
      if (r.txn.reconciledAtISO) continue;
      const top = r.candidates[0];
      if (!top) continue;
      if (top.score < 110) continue; // high-confidence only
      await matchM({
        txnId: r.txn._id,
        matchedKind: top.kind,
        matchedId: top.id,
        note: `Auto-matched · score ${top.score.toFixed(0)}`,
      });
      count++;
    }
    toast.success(`Auto-matched ${count} transaction${count === 1 ? "" : "s"}`);
  };

  const percent = summary.total ? Math.round((summary.reconciled / summary.total) * 100) : 0;

  return (
    <div className="page">
      <PageHeader
        title="Bank reconciliation"
        icon={<Scale size={16} />}
        iconColor="green"
        subtitle="Match imported bank transactions to internal records (filings, donation receipts, payroll). Anything unreconciled at year-end is a red flag for the auditor."
        actions={
          <button className="btn-action btn-action--primary" onClick={autoMatchAllHighConfidence}>
            <Link2 size={12} /> Auto-match high confidence
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Transactions</div>
          <div className="stat__value" style={{ fontSize: 22 }}>{summary.total}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Reconciled</div>
          <div className="stat__value" style={{ fontSize: 22, color: "var(--success)" }}>{summary.reconciled}</div>
          <div className="stat__sub">{percent}% of total</div>
        </div>
        <div className="stat">
          <div className="stat__label">With suggestion</div>
          <div className="stat__value" style={{ fontSize: 22, color: "var(--accent)" }}>{summary.withSuggestions}</div>
          <div className="stat__sub">One click to apply</div>
        </div>
        <div className="stat">
          <div className="stat__label">Unmatched</div>
          <div className="stat__value" style={{ fontSize: 22, color: summary.unmatched ? "var(--danger)" : undefined }}>{summary.unmatched}</div>
          <div className="stat__sub">Need a manual note</div>
        </div>
      </div>

      <div className="two-col">
        <DataTable<any>
          label="All transactions"
          icon={<Scale size={14} />}
          data={rows as any[]}
          rowKey={(r) => r.txn._id}
          filterFields={FIELDS}
          searchPlaceholder="Search description, counterparty…"
          searchExtraFields={[(r) => r.txn.description, (r) => r.txn.counterparty]}
          defaultSort={{ columnId: "date", dir: "desc" }}
          onRowClick={(r) => setSelected(r.txn._id)}
          columns={[
            {
              id: "date",
              header: "Date",
              sortable: true,
              accessor: (r) => r.txn.date,
              render: (r) => <span className="mono">{formatDate(r.txn.date)}</span>,
            },
            {
              id: "description",
              header: "Description",
              sortable: true,
              accessor: (r) => r.txn.description,
              render: (r) => (
                <div>
                  <strong>{r.txn.description}</strong>
                  {r.txn.counterparty && (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{r.txn.counterparty}</div>
                  )}
                </div>
              ),
            },
            {
              id: "amount",
              header: "Amount",
              sortable: true,
              align: "right",
              accessor: (r) => r.txn.amountCents,
              render: (r) => (
                <span className="mono" style={{ color: r.txn.amountCents < 0 ? "var(--danger)" : "var(--success)" }}>
                  {r.txn.amountCents < 0 ? "−" : "+"}{money(Math.abs(r.txn.amountCents))}
                </span>
              ),
            },
            {
              id: "status",
              header: "Status",
              render: (r) => {
                if (r.txn.reconciledAtISO) return <Badge tone="success">Reconciled</Badge>;
                if (r.candidates.length > 0) return <Badge tone="accent">{r.candidates.length} suggestion{r.candidates.length === 1 ? "" : "s"}</Badge>;
                return <Badge tone="warn">Unmatched</Badge>;
              },
            },
          ]}
        />

        <div className="col" style={{ gap: 16 }}>
          {!selectedRow && (
            <div className="card">
              <div className="card__body muted" style={{ textAlign: "center", padding: 32 }}>
                Select a transaction to see match suggestions.
              </div>
            </div>
          )}

          {selectedRow && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">{selectedRow.txn.description}</h2>
                <span className="card__subtitle">
                  {formatDate(selectedRow.txn.date)} · {selectedRow.txn.amountCents < 0 ? "−" : "+"}{money(Math.abs(selectedRow.txn.amountCents))}
                </span>
              </div>
              <div className="card__body col">
                {selectedRow.txn.reconciledAtISO ? (
                  <>
                    <div>
                      <Badge tone="success">Reconciled</Badge>{" "}
                      <span className="muted">
                        by {selectedRow.txn.reconciledByName} on {formatDate(selectedRow.txn.reconciledAtISO)}
                      </span>
                    </div>
                    <div className="muted">
                      Matched to <strong>{selectedRow.txn.matchedKind}</strong>
                      {selectedRow.txn.reconciliationNote && ` · ${selectedRow.txn.reconciliationNote}`}
                    </div>
                    <button
                      className="btn-action"
                      onClick={async () => {
                        await unmatchM({ txnId: selectedRow.txn._id });
                        toast.info("Reconciliation removed");
                      }}
                    >
                      <Undo2 size={12} /> Unmatch
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                      Top candidates:
                    </div>
                    {selectedRow.candidates.length === 0 && (
                      <div className="muted">No automatic matches found. Record a manual reconciliation if this is still valid.</div>
                    )}
                    {selectedRow.candidates.map((c: any) => (
                      <div
                        key={`${c.kind}-${c.id}`}
                        className="row"
                        style={{
                          padding: 10,
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          gap: 8,
                        }}
                      >
                        <Badge tone="accent">{c.kind}</Badge>
                        <span style={{ flex: 1 }}>{c.label}</span>
                        <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                          score {c.score.toFixed(0)}
                        </span>
                        <button
                          className="btn-action btn-action--primary"
                          onClick={async () => {
                            await matchM({
                              txnId: selectedRow.txn._id,
                              matchedKind: c.kind,
                              matchedId: c.id,
                              note: `Matched via UI · ${c.label}`,
                            });
                            toast.success("Matched");
                          }}
                        >
                          <Link2 size={12} /> Match
                        </button>
                      </div>
                    ))}
                    <div className="hr" />
                    <button
                      className="btn-action"
                      onClick={async () => {
                        const note = await prompt({
                          title: "Manual reconciliation",
                          message: "Record a note explaining what this transaction is (e.g. bank fee, transfer between accounts, refund).",
                          placeholder: "Reason",
                          required: true,
                        });
                        if (!note) return;
                        await markManualM({ txnId: selectedRow.txn._id, note });
                        toast.success("Manual reconciliation recorded");
                      }}
                    >
                      Mark manually reconciled…
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
