import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Download, FileSpreadsheet, GitCompareArrows, Landmark, Lock, PlusCircle, Scale, Split, Unlock } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../../../hooks/useSociety";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { useToast } from "../../../components/Toast";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { formatDate, money } from "../../../lib/format";

type DrawerKind = "period" | "opening" | "journal" | "candidate" | "reconciliation" | "counterparty" | "fundRestriction" | null;

const today = () => new Date().toISOString().slice(0, 10);
const currentYear = () => new Date().getFullYear().toString();

function centsFromInput(value: string) {
  return Math.round(Number(value || "0") * 100);
}

function dollarsFromCents(value: number) {
  return (value / 100).toFixed(2);
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function downloadZip(filename: string, files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const central: number[] = [];
  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = crc32(content);
    const offset = output.length;
    writeU32(output, 0x04034b50);
    writeU16(output, 20);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU32(output, crc);
    writeU32(output, content.length);
    writeU32(output, content.length);
    writeU16(output, name.length);
    writeU16(output, 0);
    output.push(...name, ...content);
    writeU32(central, 0x02014b50);
    writeU16(central, 20);
    writeU16(central, 20);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, crc);
    writeU32(central, content.length);
    writeU32(central, content.length);
    writeU16(central, name.length);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU16(central, 0);
    writeU32(central, 0);
    writeU32(central, offset);
    central.push(...name);
  }
  const centralOffset = output.length;
  output.push(...central);
  writeU32(output, 0x06054b50);
  writeU16(output, 0);
  writeU16(output, 0);
  writeU16(output, files.length);
  writeU16(output, files.length);
  writeU32(output, central.length);
  writeU32(output, centralOffset);
  writeU16(output, 0);
  const blob = new Blob([new Uint8Array(output)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AccountingWorkbenchPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [busy, setBusy] = useState(false);
  const [periodForm, setPeriodForm] = useState({
    fiscalYear: currentYear(),
    periodLabel: `FY ${currentYear()}`,
    startDate: `${currentYear()}-01-01`,
    endDate: `${currentYear()}-12-31`,
  });
  const [openingRows, setOpeningRows] = useState([
    { accountId: "", side: "debit", amount: "" },
    { accountId: "", side: "credit", amount: "" },
  ]);
  const [journalForm, setJournalForm] = useState({
    date: today(),
    memo: "",
    fiscalYear: currentYear(),
    allowClosed: false,
    lines: [
      { accountId: "", side: "debit", amount: "", description: "" },
      { accountId: "", side: "credit", amount: "", description: "" },
    ],
  });
  const [candidateForm, setCandidateForm] = useState({
    candidateId: "",
    cashAccountId: "",
    allocationAccountId: "",
    amount: "",
    description: "",
    counterpartyId: "",
    fundRestrictionId: "",
    grantId: "",
  });
  const [reconciliationForm, setReconciliationForm] = useState({
    financialAccountId: "",
    statementDate: today(),
    statementBalance: "",
  });
  const [counterpartyForm, setCounterpartyForm] = useState({ name: "", kind: "vendor", email: "", taxIdentifier: "" });
  const [fundForm, setFundForm] = useState({ name: "", purpose: "", status: "active", startDate: "", endDate: "" });

  const accounts = useQuery(api.accounting.chartAccounts, society ? { societyId: society._id } : "skip");
  const periods = useQuery(api.accounting.fiscalPeriods, society ? { societyId: society._id } : "skip");
  const journalEntries = useQuery(api.accounting.journalEntries, society ? { societyId: society._id, limit: 25 } : "skip");
  const trialBalance = useQuery(api.accounting.trialBalance, society ? { societyId: society._id } : "skip");
  const restrictedBalances = useQuery(api.accounting.restrictedFundBalances, society ? { societyId: society._id } : "skip");
  const counterparties = useQuery(api.accounting.counterparties, society ? { societyId: society._id } : "skip");
  const fundRestrictions = useQuery(api.accounting.fundRestrictions, society ? { societyId: society._id } : "skip");
  const grants = useQuery(api.grants.list, society ? { societyId: society._id } : "skip");
  const transactionCandidates = useQuery(api.evidenceRegisters.overview, society ? { societyId: society._id } : "skip");
  const seedChart = useMutation(api.accounting.seedSocietyChartOfAccounts);
  const upsertPeriod = useMutation(api.accounting.upsertFiscalPeriod);
  const closePeriod = useMutation(api.accounting.closeFiscalPeriod);
  const reopenPeriod = useMutation(api.accounting.reopenFiscalPeriod);
  const postOpening = useMutation(api.accounting.postOpeningBalances);
  const upsertJournal = useMutation(api.accounting.upsertJournalEntry);
  const postAllocation = useMutation(api.accounting.postTransactionCandidateAllocation);
  const createRecon = useMutation(api.accounting.createReconciliationRun);
  const setReconStatus = useMutation(api.accounting.setReconciliationRunStatus);
  const backfillTransactions = useMutation(api.accounting.backfillFinancialTransactionsToJournal);
  const upsertCounterparty = useMutation(api.accounting.upsertCounterparty);
  const upsertFundRestriction = useMutation(api.accounting.upsertFundRestriction);
  const chartCsv = useQuery(api.accounting.exportCsv, society ? { societyId: society._id, kind: "chart_of_accounts" } : "skip");
  const trialCsv = useQuery(api.accounting.exportCsv, society ? { societyId: society._id, kind: "trial_balance" } : "skip");
  const journalCsv = useQuery(api.accounting.exportCsv, society ? { societyId: society._id, kind: "journal_entries" } : "skip");
  const ledgerCsv = useQuery(api.accounting.exportCsv, society ? { societyId: society._id, kind: "general_ledger" } : "skip");
  const boardAuditorPackage = useQuery(api.accounting.boardAuditorPackage, society ? { societyId: society._id, fiscalYear: currentYear(), packageKind: "board_auditor" } : "skip");

  const candidates = transactionCandidates?.transactionCandidates ?? [];
  const cashAccounts = (accounts ?? []).filter((account: any) => ["Asset", "Bank", "Credit"].includes(account.accountType));
  const totalDebit = (trialBalance ?? []).reduce((sum: number, row: any) => sum + row.debitCents, 0);
  const totalCredit = (trialBalance ?? []).reduce((sum: number, row: any) => sum + row.creditCents, 0);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const run = async (fn: () => Promise<void>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (error: any) {
      toast.error(error?.message ?? "Accounting action failed");
    } finally {
      setBusy(false);
    }
  };

  const savePeriod = () =>
    run(async () => {
      await upsertPeriod({ societyId: society._id, ...periodForm, status: "open", actingUserId });
      setDrawer(null);
    }, "Fiscal period created");

  const saveOpening = () =>
    run(async () => {
      await postOpening({
        societyId: society._id,
        date: periodForm.startDate || today(),
        fiscalYear: periodForm.fiscalYear,
        lines: openingRows
          .filter((row) => row.accountId && row.amount)
          .map((row) => ({
            accountId: row.accountId as any,
            side: row.side,
            amountCents: centsFromInput(row.amount),
          })),
        actingUserId,
      });
      setDrawer(null);
    }, "Opening balances posted");

  const saveJournal = () =>
    run(async () => {
      await upsertJournal({
        societyId: society._id,
        date: journalForm.date,
        memo: journalForm.memo || "Manual journal entry",
        source: journalForm.allowClosed ? "adjustment" : "manual",
        status: "posted",
        fiscalYear: journalForm.fiscalYear,
        allowClosedPeriodAdjustment: journalForm.allowClosed,
        lines: journalForm.lines
          .filter((line) => line.accountId && line.amount)
          .map((line: any) => ({
            accountId: line.accountId as any,
            side: line.side,
            amountCents: centsFromInput(line.amount),
            description: line.description || undefined,
            counterpartyId: (line.counterpartyId || undefined) as any,
            fundRestrictionId: (line.fundRestrictionId || undefined) as any,
            grantId: (line.grantId || undefined) as any,
          })),
        actingUserId,
      });
      setDrawer(null);
    }, "Journal entry posted");

  const saveCandidateAllocation = () =>
    run(async () => {
      await postAllocation({
        transactionCandidateId: candidateForm.candidateId as any,
        cashAccountId: candidateForm.cashAccountId as any,
        allocations: [
          {
            accountId: candidateForm.allocationAccountId as any,
            amountCents: centsFromInput(candidateForm.amount),
            description: candidateForm.description || undefined,
            counterpartyId: (candidateForm.counterpartyId || undefined) as any,
            fundRestrictionId: (candidateForm.fundRestrictionId || undefined) as any,
            grantId: (candidateForm.grantId || undefined) as any,
          },
        ],
        fiscalYear: currentYear(),
        actingUserId,
      });
      setDrawer(null);
    }, "Candidate posted to journal");

  const saveReconciliation = () =>
    run(async () => {
      const result = await createRecon({
        societyId: society._id,
        financialAccountId: reconciliationForm.financialAccountId as any,
        statementDate: reconciliationForm.statementDate,
        statementBalanceCents: centsFromInput(reconciliationForm.statementBalance),
        actingUserId,
      });
      if (result.differenceCents === 0) {
        await setReconStatus({ id: result.runId, status: "reconciled", actingUserId });
      }
      setDrawer(null);
      toast.info(`Book balance ${money(result.bookBalanceCents)} · difference ${money(result.differenceCents)}`);
    }, "Reconciliation run created");

  const saveCounterparty = () =>
    run(async () => {
      if (!counterpartyForm.name.trim()) {
        toast.warn("Counterparty name is required");
        return;
      }
      await upsertCounterparty({
        societyId: society._id,
        name: counterpartyForm.name.trim(),
        kind: counterpartyForm.kind,
        email: counterpartyForm.email.trim() || undefined,
        taxIdentifier: counterpartyForm.taxIdentifier.trim() || undefined,
      } as any);
      setCounterpartyForm({ name: "", kind: "vendor", email: "", taxIdentifier: "" });
      setDrawer(null);
    }, "Counterparty saved");

  const saveFundRestriction = () =>
    run(async () => {
      if (!fundForm.name.trim() || !fundForm.purpose.trim()) {
        toast.warn("Name and purpose are required");
        return;
      }
      await upsertFundRestriction({
        societyId: society._id,
        name: fundForm.name.trim(),
        purpose: fundForm.purpose.trim(),
        status: fundForm.status,
        startDate: fundForm.startDate || undefined,
        endDate: fundForm.endDate || undefined,
      } as any);
      setFundForm({ name: "", purpose: "", status: "active", startDate: "", endDate: "" });
      setDrawer(null);
    }, "Fund restriction saved");

  const exportByKind: Record<string, any> = {
    chart_of_accounts: chartCsv,
    trial_balance: trialCsv,
    journal_entries: journalCsv,
    general_ledger: ledgerCsv,
  };

  const doExport = (kind: string) => {
    const result = exportByKind[kind];
    if (!result?.csv) {
      toast.warn("Export is still loading");
      return;
    }
    downloadCsv(result.filename, result.csv);
  };

  const doPackageExport = () => {
    if (!boardAuditorPackage?.files) {
      toast.warn("Package is still loading");
      return;
    }
    downloadZip(boardAuditorPackage.filename, boardAuditorPackage.files);
  };

  return (
    <div className="page page--wide accounting-workbench">
      <PageHeader
        title="Accounting"
        icon={<Landmark size={16} />}
        iconColor="green"
        subtitle="Internal ledger setup, journal posting, candidate allocation, reconciliation, and audit exports."
        actions={<Link className="btn-action" to="/app/financials"><ArrowLeft size={12} /> Financials</Link>}
      />

      <div className="accounting-action-panel">
        <div className="accounting-action-panel__heading">
          <strong>Accounting tools</strong>
          <span>Set up, post, and reconcile the ledger.</span>
        </div>
        <div className="accounting-action-bar" role="group" aria-label="Accounting tools">
          <button className="btn-action btn-action--primary" disabled={busy} onClick={() => run(async () => { await seedChart({ societyId: society._id, actingUserId }); }, "Chart of accounts seeded")}>
            <Landmark size={12} /> Seed chart
          </button>
          <button className="btn-action" onClick={() => setDrawer("period")}><PlusCircle size={12} /> Fiscal period</button>
          <button className="btn-action" onClick={() => setDrawer("opening")}><FileSpreadsheet size={12} /> Opening balances</button>
          <button className="btn-action" onClick={() => setDrawer("journal")}><GitCompareArrows size={12} /> Journal entry</button>
          <button className="btn-action" onClick={() => setDrawer("candidate")}><Split size={12} /> Post candidate</button>
          <button className="btn-action" onClick={() => setDrawer("reconciliation")}><Scale size={12} /> Reconcile</button>
          <button className="btn-action" disabled={busy} onClick={() => run(async () => {
            const result = await backfillTransactions({ societyId: society._id, fiscalYear: currentYear(), actingUserId });
            toast.success(`Backfilled ${result.posted} transaction${result.posted === 1 ? "" : "s"}`);
          })}>
            <FileSpreadsheet size={12} /> Backfill imports
          </button>
          <Link className="btn-action" to="/app/reconciliation"><GitCompareArrows size={12} /> Bank reconciliation</Link>
        </div>
      </div>

      <details className="accounting-reconciliation-note">
        <summary>How reconciliation works</summary>
        <div className="muted">
          <Link to="/app/reconciliation">Bank reconciliation</Link> matches imported bank lines to records, while ledger
          reconciliation here checks the journal against a statement balance. Use <strong>Backfill imports</strong> to post
          synced/manual bank transactions into the journal so both agree.
        </div>
      </details>

      <div className="stat-grid">
        <div className="stat"><div className="stat__label">Chart accounts</div><div className="stat__value">{accounts?.length ?? 0}</div></div>
        <div className="stat"><div className="stat__label">Posted entries</div><div className="stat__value">{journalEntries?.filter((e: any) => e.status === "posted").length ?? 0}</div></div>
        <div className="stat"><div className="stat__label">Debit total</div><div className="stat__value">{money(totalDebit)}</div></div>
        <div className="stat"><div className="stat__label">Credit total</div><div className="stat__value">{money(totalCredit)}</div></div>
      </div>

      <div className="accounting-grid">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Fiscal periods</h2>
            <span className="card__subtitle">Close periods before year-end exports.</span>
          </div>
          <div className="accounting-list">
            {(periods ?? []).map((period: any) => (
              <div className="accounting-row" key={period._id}>
                <div>
                  <strong>{period.periodLabel}</strong>
                  <div className="muted">{formatDate(period.startDate)} to {formatDate(period.endDate)}</div>
                </div>
                <div className="accounting-row__actions">
                  <Badge tone={period.status === "open" ? "success" : "warn"}>{period.status}</Badge>
                  {period.status === "open" ? (
                    <button className="btn btn--ghost btn--sm" onClick={() => run(async () => { await closePeriod({ id: period._id, actingUserId }); }, "Period closed")}><Lock size={12} /> Close</button>
                  ) : (
                    <button className="btn btn--ghost btn--sm" onClick={() => run(async () => { await reopenPeriod({ id: period._id, actingUserId }); }, "Period reopened")}><Unlock size={12} /> Reopen</button>
                  )}
                </div>
              </div>
            ))}
            {(periods ?? []).length === 0 && <div className="muted accounting-empty">No fiscal periods yet.</div>}
          </div>
        </section>

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Exports</h2>
            <span className="card__subtitle">CSV downloads for board and auditor packages.</span>
          </div>
          <div className="accounting-export-grid">
            {["chart_of_accounts", "trial_balance", "journal_entries", "general_ledger"].map((kind) => (
              <button key={kind} className="btn-action" onClick={() => doExport(kind)} disabled={!exportByKind[kind]}>
                <Download size={12} /> {kind.replace(/_/g, " ")}
              </button>
            ))}
            <button className="btn-action btn-action--primary" onClick={doPackageExport} disabled={!boardAuditorPackage?.files}>
              <Download size={12} /> board/auditor ZIP
            </button>
          </div>
          <div className="muted accounting-note">Exports are generated from the internal journal shape and include attachment references.</div>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Trial balance</h2>
          <span className="card__subtitle">Posted journal-line totals by chart account.</span>
        </div>
        <ResponsiveTable>
          <thead><tr><th>Account</th><th>Type</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
          <tbody>
            {(trialBalance ?? []).map((row: any) => (
              <tr key={row.account?._id ?? row.account?.code}>
                <td><strong>{row.account?.code}</strong> {row.account?.name}</td>
                <td>{row.account?.accountType}</td>
                <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.debitCents)}</td>
                <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.creditCents)}</td>
                <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.balanceCents)}</td>
              </tr>
            ))}
            {(trialBalance ?? []).length === 0 && <tr><td colSpan={5} className="muted accounting-empty">No posted journal lines yet.</td></tr>}
          </tbody>
        </ResponsiveTable>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Journal entries</h2>
          <span className="card__subtitle">Recent posted and draft ledger entries.</span>
        </div>
        <div className="accounting-journal-list">
          {(journalEntries ?? []).map((entry: any) => (
            <details className="accounting-entry" key={entry._id}>
              <summary>
                <span><strong>{formatDate(entry.date)}</strong> {entry.memo}</span>
                <Badge tone={entry.status === "posted" ? "success" : "warn"}>{entry.status}</Badge>
              </summary>
              <ResponsiveTable>
                <thead><tr><th>Account</th><th>Side</th><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {(entry.lines ?? []).map((line: any) => {
                    const account = (accounts ?? []).find((candidate: any) => candidate._id === line.accountId);
                    return (
                      <tr key={line._id}>
                        <td>{account?.code} {account?.name}</td>
                        <td>{line.side}</td>
                        <td>{line.description ?? "—"}</td>
                        <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(line.amountCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </ResponsiveTable>
            </details>
          ))}
          {(journalEntries ?? []).length === 0 && <div className="muted accounting-empty">No journal entries yet.</div>}
        </div>
      </section>

      {(restrictedBalances ?? []).length > 0 && (
        <section className="card">
          <div className="card__head"><h2 className="card__title">Restricted funds</h2></div>
          <div className="accounting-list">
            {(restrictedBalances ?? []).map((row: any) => (
              <div className="accounting-row" key={row._id}>
                <div><strong>{row.name}</strong><div className="muted">{row.purpose}</div></div>
                <div className="mono">{money(row.balanceCents)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Fund restrictions register</h2>
          <button className="btn-action" onClick={() => setDrawer("fundRestriction")}><PlusCircle size={12} /> Add restriction</button>
        </div>
        <div className="accounting-list">
          {(fundRestrictions ?? []).map((row: any) => (
            <div className="accounting-row" key={row._id}>
              <div><strong>{row.name}</strong><div className="muted">{row.purpose}</div></div>
              <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge>
            </div>
          ))}
          {(fundRestrictions ?? []).length === 0 && <div className="muted accounting-empty">No restriction terms recorded. Add one to track donor/grant-restricted purposes.</div>}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Counterparties</h2>
          <button className="btn-action" onClick={() => setDrawer("counterparty")}><PlusCircle size={12} /> Add counterparty</button>
        </div>
        <div className="accounting-list">
          {(counterparties ?? []).map((row: any) => (
            <div className="accounting-row" key={row._id}>
              <div><strong>{row.name}</strong><div className="muted">{row.email ?? row.externalId ?? "—"}</div></div>
              <Badge tone="neutral">{row.kind}</Badge>
            </div>
          ))}
          {(counterparties ?? []).length === 0 && <div className="muted accounting-empty">No counterparties yet. Add vendors and customers to categorize transactions.</div>}
        </div>
      </section>

      <Drawer open={drawer === "fundRestriction"} onClose={() => setDrawer(null)} title="Add fund restriction" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={saveFundRestriction}>Save</button></>}>
        <div className="col">
          <Field label="Name"><input className="input" value={fundForm.name} onChange={(e) => setFundForm({ ...fundForm, name: e.target.value })} placeholder="e.g. Capital campaign 2026" /></Field>
          <Field label="Purpose"><input className="input" value={fundForm.purpose} onChange={(e) => setFundForm({ ...fundForm, purpose: e.target.value })} placeholder="What the funds are restricted to" /></Field>
          <Field label="Status"><Select value={fundForm.status} onChange={(value) => setFundForm({ ...fundForm, status: value })} options={[{ value: "active", label: "Active" }, { value: "released", label: "Released" }, { value: "closed", label: "Closed" }]} /></Field>
          <Field label="Start date"><DatePicker value={fundForm.startDate} onChange={(value) => setFundForm({ ...fundForm, startDate: value })} /></Field>
          <Field label="End date"><DatePicker value={fundForm.endDate} onChange={(value) => setFundForm({ ...fundForm, endDate: value })} /></Field>
        </div>
      </Drawer>

      <Drawer open={drawer === "counterparty"} onClose={() => setDrawer(null)} title="Add counterparty" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={saveCounterparty}>Save</button></>}>
        <div className="col">
          <Field label="Name"><input className="input" value={counterpartyForm.name} onChange={(e) => setCounterpartyForm({ ...counterpartyForm, name: e.target.value })} /></Field>
          <Field label="Kind"><Select value={counterpartyForm.kind} onChange={(value) => setCounterpartyForm({ ...counterpartyForm, kind: value })} options={[{ value: "vendor", label: "Vendor" }, { value: "customer", label: "Customer" }, { value: "other", label: "Other" }]} /></Field>
          <Field label="Email"><input className="input" value={counterpartyForm.email} onChange={(e) => setCounterpartyForm({ ...counterpartyForm, email: e.target.value })} /></Field>
          <Field label="Tax identifier"><input className="input" value={counterpartyForm.taxIdentifier} onChange={(e) => setCounterpartyForm({ ...counterpartyForm, taxIdentifier: e.target.value })} /></Field>
        </div>
      </Drawer>

      <Drawer open={drawer === "period"} onClose={() => setDrawer(null)} title="Create fiscal period" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={savePeriod}>Create</button></>}>
        <FormGrid>
          <Field label="Fiscal year"><input className="input" value={periodForm.fiscalYear} onChange={(e) => setPeriodForm({ ...periodForm, fiscalYear: e.target.value })} /></Field>
          <Field label="Period label"><input className="input" value={periodForm.periodLabel} onChange={(e) => setPeriodForm({ ...periodForm, periodLabel: e.target.value })} /></Field>
          <Field label="Start date"><DatePicker value={periodForm.startDate} onChange={(value) => setPeriodForm({ ...periodForm, startDate: value })} /></Field>
          <Field label="End date"><DatePicker value={periodForm.endDate} onChange={(value) => setPeriodForm({ ...periodForm, endDate: value })} /></Field>
        </FormGrid>
      </Drawer>

      <Drawer open={drawer === "opening"} onClose={() => setDrawer(null)} title="Post opening balances" size="wide" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={saveOpening}>Post</button></>}>
        <AccountingLines rows={openingRows} setRows={setOpeningRows} accounts={accounts ?? []} />
      </Drawer>

      <Drawer open={drawer === "journal"} onClose={() => setDrawer(null)} title="Post journal entry" size="wide" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={saveJournal}>Post</button></>}>
        <FormGrid>
          <Field label="Date"><DatePicker value={journalForm.date} onChange={(value) => setJournalForm({ ...journalForm, date: value })} /></Field>
          <Field label="Fiscal year"><input className="input" value={journalForm.fiscalYear} onChange={(e) => setJournalForm({ ...journalForm, fiscalYear: e.target.value })} /></Field>
          <Field label="Memo"><input className="input" value={journalForm.memo} onChange={(e) => setJournalForm({ ...journalForm, memo: e.target.value })} /></Field>
          <label className="checkbox"><input type="checkbox" checked={journalForm.allowClosed} onChange={(e) => setJournalForm({ ...journalForm, allowClosed: e.target.checked })} /> Closed-period adjustment</label>
        </FormGrid>
        <AccountingLines
          rows={journalForm.lines}
          setRows={(lines: any) => setJournalForm({ ...journalForm, lines })}
          accounts={accounts ?? []}
          includeDescription
          links={{
            counterparties: (counterparties ?? []).map((row: any) => ({ value: row._id, label: row.name })),
            fundRestrictions: (fundRestrictions ?? []).map((row: any) => ({ value: row._id, label: row.name })),
            grants: (grants ?? []).map((row: any) => ({ value: row._id, label: row.title })),
          }}
        />
      </Drawer>

      <Drawer open={drawer === "candidate"} onClose={() => setDrawer(null)} title="Post transaction candidate" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy || !candidateForm.candidateId} onClick={saveCandidateAllocation}>Post</button></>}>
        <div className="col">
          <Field label="Candidate"><Select value={candidateForm.candidateId} onChange={(value) => {
            const candidate = candidates.find((row: any) => row._id === value);
            setCandidateForm({ ...candidateForm, candidateId: value, amount: candidate?.amountCents ? dollarsFromCents(Math.abs(candidate.amountCents)) : candidateForm.amount, description: candidate?.description ?? candidateForm.description });
          }} options={[{ value: "", label: "Select candidate" }, ...candidates.map((row: any) => ({ value: row._id, label: `${row.transactionDate} · ${row.description}` }))]} /></Field>
          <Field label="Cash account"><AccountSelect accounts={cashAccounts} value={candidateForm.cashAccountId} onChange={(cashAccountId) => setCandidateForm({ ...candidateForm, cashAccountId })} /></Field>
          <Field label="Offset account"><AccountSelect accounts={accounts ?? []} value={candidateForm.allocationAccountId} onChange={(allocationAccountId) => setCandidateForm({ ...candidateForm, allocationAccountId })} /></Field>
          <Field label="Amount"><input className="input" type="number" value={candidateForm.amount} onChange={(e) => setCandidateForm({ ...candidateForm, amount: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={candidateForm.description} onChange={(e) => setCandidateForm({ ...candidateForm, description: e.target.value })} /></Field>
          <Field label="Counterparty" hint="Optional — tag the vendor/customer for reporting."><LinkSelect placeholder="No counterparty" value={candidateForm.counterpartyId} onChange={(counterpartyId) => setCandidateForm({ ...candidateForm, counterpartyId })} options={(counterparties ?? []).map((row: any) => ({ value: row._id, label: row.name }))} /></Field>
          <Field label="Restricted fund" hint="Optional — track against a donor/grant restriction."><LinkSelect placeholder="No fund restriction" value={candidateForm.fundRestrictionId} onChange={(fundRestrictionId) => setCandidateForm({ ...candidateForm, fundRestrictionId })} options={(fundRestrictions ?? []).map((row: any) => ({ value: row._id, label: row.name }))} /></Field>
          <Field label="Grant" hint="Optional — link to a grant."><LinkSelect placeholder="No grant" value={candidateForm.grantId} onChange={(grantId) => setCandidateForm({ ...candidateForm, grantId })} options={(grants ?? []).map((row: any) => ({ value: row._id, label: row.title }))} /></Field>
        </div>
      </Drawer>

      <Drawer open={drawer === "reconciliation"} onClose={() => setDrawer(null)} title="Create reconciliation run" footer={<><button className="btn" onClick={() => setDrawer(null)}>Cancel</button><button className="btn btn--accent" disabled={busy} onClick={saveReconciliation}>Create</button></>}>
        <div className="col">
          <Field label="Financial account"><AccountSelect accounts={cashAccounts} value={reconciliationForm.financialAccountId} onChange={(financialAccountId) => setReconciliationForm({ ...reconciliationForm, financialAccountId })} /></Field>
          <Field label="Statement date"><DatePicker value={reconciliationForm.statementDate} onChange={(value) => setReconciliationForm({ ...reconciliationForm, statementDate: value })} /></Field>
          <Field label="Statement balance"><input className="input" type="number" value={reconciliationForm.statementBalance} onChange={(e) => setReconciliationForm({ ...reconciliationForm, statementBalance: e.target.value })} /></Field>
        </div>
      </Drawer>
    </div>
  );
}

function ResponsiveTable({ children }: { children: ReactNode }) {
  return <div className="accounting-table-wrap"><table className="table">{children}</table></div>;
}

function FormGrid({ children }: { children: ReactNode }) {
  return <div className="accounting-form-grid">{children}</div>;
}

function AccountSelect({ accounts, value, onChange }: { accounts: any[]; value: string; onChange: (value: string) => void }) {
  return (
    <Select
      value={value}
      onChange={(next) => onChange(next)}
      options={[
        { value: "", label: "Select account" },
        ...accounts.map((account) => ({ value: account._id, label: (account.code ? `${account.code} · ` : "") + account.name })),
      ]}
    />
  );
}

function LinkSelect({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder: string }) {
  return (
    <Select
      value={value}
      onChange={(next) => onChange(next)}
      options={[{ value: "", label: placeholder }, ...options]}
    />
  );
}

function AccountingLines({
  rows,
  setRows,
  accounts,
  includeDescription,
  links,
}: {
  rows: any[];
  setRows: (rows: any[]) => void;
  accounts: any[];
  includeDescription?: boolean;
  links?: {
    counterparties: Array<{ value: string; label: string }>;
    fundRestrictions: Array<{ value: string; label: string }>;
    grants: Array<{ value: string; label: string }>;
  };
}) {
  const update = (index: number, patch: any) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return (
    <div className="accounting-lines">
      {rows.map((row, index) => (
        <div className="accounting-line" key={index}>
          <Field label="Account"><AccountSelect accounts={accounts} value={row.accountId} onChange={(accountId) => update(index, { accountId })} /></Field>
          <Field label="Side"><Select value={row.side} onChange={(value) => update(index, { side: value })} options={[{ value: "debit", label: "Debit" }, { value: "credit", label: "Credit" }]} /></Field>
          <Field label="Amount"><input className="input" type="number" value={row.amount} onChange={(e) => update(index, { amount: e.target.value })} /></Field>
          {includeDescription && <Field label="Description"><input className="input" value={row.description ?? ""} onChange={(e) => update(index, { description: e.target.value })} /></Field>}
          {links && <Field label="Counterparty"><LinkSelect placeholder="No counterparty" value={row.counterpartyId ?? ""} onChange={(counterpartyId) => update(index, { counterpartyId })} options={links.counterparties} /></Field>}
          {links && <Field label="Restricted fund"><LinkSelect placeholder="No fund restriction" value={row.fundRestrictionId ?? ""} onChange={(fundRestrictionId) => update(index, { fundRestrictionId })} options={links.fundRestrictions} /></Field>}
          {links && <Field label="Grant"><LinkSelect placeholder="No grant" value={row.grantId ?? ""} onChange={(grantId) => update(index, { grantId })} options={links.grants} /></Field>}
        </div>
      ))}
      <button className="btn-action" type="button" onClick={() => setRows([...rows, { accountId: "", side: "debit", amount: "", description: "" }])}>
        <PlusCircle size={12} /> Add line
      </button>
    </div>
  );
}
