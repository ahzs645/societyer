import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, useCurrentUser } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useConfirm, usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { StatTile } from "../components/StatTile";
import { Boxes, GitCompareArrows, Scale, Link2, Undo2, Plus, Wand2 } from "lucide-react";
import { formatDate, money } from "../lib/format";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { useIsMobile } from "../lib/useIsMobile";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { todayDateOnly } from "../../shared/dateOnly";
import { ReconciliationStatements } from "../features/financials/reconciliation/ReconciliationStatements";
import { ReconciliationBanner } from "../features/financials/reconciliation/ReconciliationBanner";
import { StartReconciliationModal } from "../features/financials/reconciliation/StartReconciliationModal";
import type { ReconPeriodsData } from "../features/financials/reconciliation/types";

/**
 * Bank reconciliation page. The record table on the left is purely
 * read-only — rows are projected from `reconciliation.overview` into
 * the shape the seed expects (`date`, `description`, `counterparty`,
 * `amountCents`, `status`). All match/unmatch/manual-mark mutations
 * still run from the side panel's buttons; clicking a row sets
 * `selected` so the panel rehydrates with that transaction.
 */
export function ReconciliationPage() {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const overview = useQuery(
    api.reconciliation.overview,
    society ? { societyId: society._id } : "skip",
  );
  // Statement periods (account -> statements -> reconciliation detail), driven by ?account= and ?period=.
  const periodsData = useQuery(api.reconciliation.periods, society ? { societyId: society._id } : "skip") as ReconPeriodsData | undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const periodId = searchParams.get("period") ?? undefined;
  const accountParam = searchParams.get("account") ?? undefined;
  const activePeriod = periodsData?.periods.find((period) => period._id === periodId);
  const [startOpen, setStartOpen] = useState<{ accountId?: string } | null>(null);
  const setView = (next: { account?: string; period?: string }) => {
    const params = new URLSearchParams(searchParams);
    for (const key of ["account", "period"] as const) {
      if (next[key]) params.set(key, next[key]!);
      else params.delete(key);
    }
    setSearchParams(params);
  };
  const matchM = useMutation(api.reconciliation.match);
  const markManualM = useMutation(api.reconciliation.markManual);
  const unmatchM = useMutation(api.reconciliation.unmatch);
  const addManualTxn = useMutation(api.reconciliation.addManualTransaction);
  const inventoryItems = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const inventoryLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const linkInventoryReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkInventoryReceipt = useMutation(api.inventoryHub.unlinkReceipt);
  const actingUserId = useCurrentUserId() ?? undefined;
  const actorName = useCurrentUser()?.displayName ?? undefined;
  const prompt = usePrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string | null>(null);
  // Opening another statement starts with an empty match panel.
  useEffect(() => setSelected(null), [periodId]);
  const selectForMatching = (id: string) => {
    setSelected(id);
    // On narrow screens the match panel stacks below the table; bring it into view.
    window.requestAnimationFrame(() => {
      const panel = document.getElementById("reconciliation-match-panel");
      if (panel && panel.getBoundingClientRect().top > window.innerHeight) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const [linkItemId, setLinkItemId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [txnForm, setTxnForm] = useState({
    date: todayDateOnly(),
    description: "",
    amountDollars: "",
    direction: "out" as "in" | "out",
    counterparty: "",
    category: "",
  });
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "reconciliationTransaction",
    viewId: currentViewId,
  });

  // Amount and match status are what a reconciler scans for, so they sit
  // right after the description/date (and stay visible) instead of off to
  // the right past a wide counterparty column. On phones only the frozen
  // description and the next column or two fit, so the amount comes first.
  const isMobile = useIsMobile();
  const reconciliationView = useMemo(() => {
    const view = tableData.hydratedView;
    if (!view) return view;
    const order = isMobile
      ? ["description", "amountCents", "status", "date", "counterparty"]
      : ["description", "date", "amountCents", "status", "counterparty"];
    const sizes: Record<string, number> = { description: 210, date: 130, amountCents: 145, status: 140, counterparty: 160 };
    const rank = (name: string) => {
      const index = order.indexOf(name);
      return index < 0 ? order.length : index;
    };
    return {
      ...view,
      view: { ...view.view, openRecordIn: "page" as const },
      columns: view.columns
        .map((column) => {
          const name = column.field.name;
          if (!order.includes(name)) return column;
          return {
            ...column,
            isVisible: name === "amountCents" || name === "status" ? true : column.isVisible,
            size: sizes[name] ?? column.size,
          };
        })
        .sort((a, b) => rank(a.field.name) - rank(b.field.name))
        .map((column, position) => ({ ...column, position })),
    };
  }, [isMobile, tableData.hydratedView]);

  const rows = overview?.rows ?? [];
  const summary = overview?.summary ?? { total: 0, reconciled: 0, withSuggestions: 0, unmatched: 0 };

  const periodTxnIds = useMemo(() => (activePeriod ? new Set(activePeriod.transactionIds) : null), [activePeriod]);
  const records = useMemo(
    () =>
      rows.filter((r: any) => !periodTxnIds || periodTxnIds.has(String(r.txn._id))).map((r: any) => ({
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
    [rows, periodTxnIds],
  );

  const selectedRow = useMemo(
    () => rows.find((r: any) => (r.txn._id as any) === selected) ?? null,
    [rows, selected],
  );

  const selectedLinks = useMemo(
    () => ((inventoryLinks ?? []) as any[]).filter((l) => selected && l.financialTransactionId === selected),
    [inventoryLinks, selected],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const linkSelectedItem = async () => {
    if (!selectedRow || !linkItemId) {
      toast.error("Choose an inventory item to link.");
      return;
    }
    await linkInventoryReceipt({
      societyId: society._id,
      inventoryItemId: linkItemId as any,
      financialTransactionId: selectedRow.txn._id,
      createdByUserId: actingUserId as any,
    } as any);
    toast.success("Inventory item linked");
    setLinkItemId("");
  };

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
        actor: actorName,
      });
      count++;
    }
    toast.success(`Auto-matched ${count} transaction${count === 1 ? "" : "s"}`);
  };

  const percent = summary.total ? Math.round((summary.reconciled / summary.total) * 100) : 0;
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const saveManualTxn = async () => {
    if (!society) return;
    const dollars = Number(txnForm.amountDollars);
    if (!txnForm.description.trim() || !Number.isFinite(dollars) || dollars <= 0) {
      toast.warn("Enter a description and a positive amount");
      return;
    }
    const cents = Math.round(dollars * 100) * (txnForm.direction === "out" ? -1 : 1);
    await addManualTxn({
      societyId: society._id,
      date: txnForm.date,
      description: txnForm.description.trim(),
      amountCents: cents,
      counterparty: txnForm.counterparty.trim() || undefined,
      category: txnForm.category.trim() || undefined,
    });
    toast.success("Transaction added");
    setAddOpen(false);
    setTxnForm({ date: todayDateOnly(), description: "", amountDollars: "", direction: "out", counterparty: "", category: "" });
  };

  return (
    <div className="page">
      <PageHeader
        title="Bank reconciliation"
        icon={<Scale size={16} />}
        iconColor="green"
        subtitle="Match imported bank transactions to internal records."
        info={
          <p>
            Match imported bank transactions to internal records such as filings, donation receipts and payroll.
            Anything unreconciled at year-end is a red flag for the auditor.
          </p>
        }
        actions={
          <>
            <MoreActionsMenu
              items={[
                { id: "ledger-reconciliation", label: "Ledger reconciliation", icon: <Scale size={14} />, onSelect: () => navigate("/app/financials/accounting") },
                { disabled: !canWrite, id: "add-transaction", label: "Add transaction", icon: <Plus size={14} />, onSelect: () => setAddOpen(true) },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={autoMatchAllHighConfidence} disabled={!canWrite}>
              <Wand2 size={12} /> Auto-match high confidence
            </button>
          </>
        }
      />

      <Drawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add bank transaction"
        footer={
          <>
            <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveManualTxn} disabled={!canWrite}>Add transaction</button>
          </>
        }
      >
        <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          Manually record a bank line so it can be reconciled when no Wave/browser-connector sync is configured.
        </div>
        <Field label="Date"><DatePicker value={txnForm.date} onChange={(v) => setTxnForm({ ...txnForm, date: v })} /></Field>
        <Field label="Description"><input className="input" value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} /></Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Direction">
            <Select
              value={txnForm.direction}
              onChange={(v) => setTxnForm({ ...txnForm, direction: v as "in" | "out" })}
              options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]}
            />
          </Field>
          <Field label="Amount"><input className="input" type="number" min="0" step="0.01" value={txnForm.amountDollars} onChange={(e) => setTxnForm({ ...txnForm, amountDollars: e.target.value })} /></Field>
        </div>
        <Field label="Counterparty"><input className="input" value={txnForm.counterparty} onChange={(e) => setTxnForm({ ...txnForm, counterparty: e.target.value })} placeholder="e.g. BC Registries, a donor, a vendor" /></Field>
        <Field label="Category"><input className="input" value={txnForm.category} onChange={(e) => setTxnForm({ ...txnForm, category: e.target.value })} placeholder="Optional" /></Field>
      </Drawer>

      {periodsData && (activePeriod ? (
        <ReconciliationBanner
          period={activePeriod}
          account={periodsData.accounts.find((account) => account._id === activePeriod.accountId)}
          canWrite={canWrite}
          onBack={() => setView({ account: activePeriod.accountId })}
          onDiscarded={() => setView({ account: activePeriod.accountId })}
        />
      ) : (
        <ReconciliationStatements
          data={periodsData}
          accountId={accountParam}
          canWrite={canWrite}
          onSelectAccount={(account) => setView({ account })}
          onOpenPeriod={(period) => setView({ account: periodsData.periods.find((row) => row._id === period)?.accountId, period })}
          onStart={(accountId) => setStartOpen({ accountId })}
        />
      ))}
      {periodsData && startOpen && (
        <StartReconciliationModal
          open
          accounts={periodsData.accounts}
          initialAccountId={startOpen.accountId}
          societyId={society._id}
          onClose={() => setStartOpen(null)}
          onStarted={(period, account) => {
            setStartOpen(null);
            setView({ account, period });
          }}
        />
      )}

      {!activePeriod && <div className="stat-grid">
        <StatTile label="Transactions" value={summary.total} />
        <StatTile label="Reconciled" value={summary.reconciled} tone={summary.reconciled ? "ok" : "neutral"} sub={`${percent}% of total`} />
        <StatTile label="With suggestion" value={summary.withSuggestions} tone={summary.withSuggestions ? "info" : "neutral"} sub="One click to apply" />
        <StatTile label="Unmatched" value={summary.unmatched} tone={summary.unmatched ? "danger" : "neutral"} sub="Need a manual note" />
      </div>}

      <div className="two-col">
        <div>
          {showMetadataWarning ? (
            <RecordTableMetadataEmpty societyId={society?._id} objectLabel="reconciliation" />
          ) : tableData.objectMetadata ? (
            <RecordTableScope
              tableId="reconciliation"
              objectMetadata={tableData.objectMetadata}
              // Row clicks select the transaction for matching (the panel on the
              // right) instead of opening the generic record side panel.
              hydratedView={reconciliationView}
              records={records}
              onRecordClick={(_, record) => selectForMatching(record._id)}
            >
              <RecordTableViewToolbar
                societyId={society._id}
                objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
                icon={<Scale size={14} />}
                label={activePeriod ? "Statement transactions" : "All transactions"}
                views={tableData.views}
                currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
                onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
                onOpenFilter={() => setFilterOpen((x) => !x)}
              />
              <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
              <RecordTableFilterChips />
              <RecordTable
                loading={tableData.loading || overview === undefined}
                renderRowActions={(row: any) => (
                  <button
                    className={`btn btn--sm ${selected === row._id ? "btn--accent" : "btn--ghost"}`}
                    aria-pressed={selected === row._id}
                    aria-label={`Match ${row.description ?? "transaction"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectForMatching(row._id);
                    }}
                  >
                    <GitCompareArrows size={12} /> Match
                  </button>
                )}
              />
            </RecordTableScope>
          ) : (
            <div className="record-table__loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="record-table__loading-row" />
              ))}
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }} id="reconciliation-match-panel">
          {!selectedRow && (
            <div className="card reconciliation-match-placeholder">
              <div className="card__body muted" style={{ textAlign: "center", padding: 32 }}>
                Click a transaction (or its Match button) to see match suggestions.
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
                      }} disabled={!canWrite}
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
                              actor: actorName,
                            });
                            toast.success("Matched");
                          }} disabled={!canWrite}
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
                        await markManualM({ txnId: selectedRow.txn._id, note, actor: actorName });
                        toast.success("Manual reconciliation recorded");
                      }} disabled={!canWrite}
                    >
                      Mark manually reconciled…
                    </button>
                  </>
                )}

                <div className="hr" />
                <div className="col" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6, alignItems: "center", fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                    <Boxes size={12} /> Linked inventory items
                  </div>
                  {selectedLinks.length === 0 && (
                    <div className="muted">No inventory items linked to this purchase yet.</div>
                  )}
                  {selectedLinks.map((link: any) => (
                    <div key={link._id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <Link to="/app/inventory">{link.inventoryItem?.name ?? link.asset?.name ?? link.receiptLineLabel ?? "Linked item"}</Link>
                      <button
                        className="btn-action"
                        onClick={async () => { await unlinkInventoryReceipt({ id: link._id }); toast.info("Item unlinked"); }} disabled={!canWrite}
                      >
                        <Undo2 size={12} /> Unlink
                      </button>
                    </div>
                  ))}
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                      <Select
                        value={linkItemId}
                        onChange={setLinkItemId}
                        placeholder="Choose an item"
                        searchable
                        options={((inventoryItems ?? []) as any[]).map((i) => ({ value: i._id, label: i.sku ? `${i.name} (${i.sku})` : i.name }))}
                      />
                    </div>
                    <button className="btn-action btn-action--primary" onClick={linkSelectedItem} disabled={!canWrite}>
                      <Link2 size={12} /> Link item
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
