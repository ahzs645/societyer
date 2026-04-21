import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { useConfirm, usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Scale, Link2, Undo2 } from "lucide-react";
import { formatDate, money } from "../lib/format";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Bank reconciliation page. The record table on the left is purely
 * read-only — rows are projected from `reconciliation.overview` into
 * the shape the seed expects (`date`, `description`, `counterparty`,
 * `amountCents`, `status`). All match/unmatch/manual-mark mutations
 * still run from the side panel's buttons; clicking a row sets
 * `selected` so the panel rehydrates with that transaction.
 */
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
  const confirm = useConfirm();
  const toast = useToast();

  const [selected, setSelected] = useState<string | null>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "reconciliationTransaction",
    viewId: currentViewId,
  });

  const rows = overview?.rows ?? [];
  const summary = overview?.summary ?? { total: 0, reconciled: 0, withSuggestions: 0, unmatched: 0 };

  const records = useMemo(
    () =>
      rows.map((r: any) => ({
        _id: r.txn._id,
        date: r.txn.date,
        description: r.txn.description,
        counterparty: r.txn.counterparty ?? "",
        amountCents: r.txn.amountCents,
        status: r.txn.reconciledAtISO
          ? "Reconciled"
          : (r.candidates?.length ?? 0) > 0
            ? "Has suggestion"
            : "Unmatched",
      })),
    [rows],
  );

  const selectedRow = useMemo(
    () => rows.find((r: any) => (r.txn._id as any) === selected) ?? null,
    [rows, selected],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const autoMatchAllHighConfidence = async () => {
    const candidates = rows
      .filter((r: any) => !r.txn.reconciledAtISO)
      .map((r: any) => ({ row: r, top: r.candidates[0] }))
      .filter(({ top }: any) => top && top.score >= 110);
    if (candidates.length === 0) {
      toast.info("No high-confidence matches to apply");
      return;
    }
    const ok = await confirm({
      title: "Auto-match transactions?",
      message: `This will reconcile ${candidates.length} transaction${candidates.length === 1 ? "" : "s"} using the current top high-confidence suggestions. Review the unmatched rows after it finishes.`,
      confirmLabel: "Auto-match",
      tone: "warn",
    });
    if (!ok) return;
    let count = 0;
    for (const { row: r, top } of candidates) {
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
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

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
        <div>
          {showMetadataWarning ? (
            <div className="record-table__empty">
              <div className="record-table__empty-title">Metadata not seeded</div>
              <div className="record-table__empty-desc">
                Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
                reconciliation object metadata + default view.
              </div>
            </div>
          ) : tableData.objectMetadata ? (
            <RecordTableScope
              tableId="reconciliation"
              objectMetadata={tableData.objectMetadata}
              hydratedView={tableData.hydratedView}
              records={records}
              onRecordClick={(_, record) => setSelected(record._id)}
            >
              <RecordTableViewToolbar
                societyId={society._id}
                objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
                icon={<Scale size={14} />}
                label="All transactions"
                views={tableData.views}
                currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
                onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
                onOpenFilter={() => setFilterOpen((x) => !x)}
              />
              <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
              <RecordTableFilterChips />
              <RecordTable loading={tableData.loading || overview === undefined} />
            </RecordTableScope>
          ) : (
            <div className="record-table__loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="record-table__loading-row" />
              ))}
            </div>
          )}
        </div>

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
