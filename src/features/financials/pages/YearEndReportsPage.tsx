import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Circle,
  FileDown,
  PiggyBank,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useSociety } from "../../../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "../../../pages/_helpers";
import { Badge, Field } from "../../../components/ui";
import { centsToDollarInput, dollarInputToCents, money } from "../../../lib/format";
import { exportPdfDownload, printPdfDocument } from "../../../lib/pdf";
import { exportWordDocx } from "../../../lib/docx";
import {
  EXPENSE_CATEGORIES,
  REVENUE_CATEGORIES,
  blankProgramStatement,
  buildStatementFromGrant,
  computeStatementTotals,
  type ProgramStatement,
  type ProgramStatementLine,
} from "../../../../shared/programStatement";
import {
  ORG_EXPENSE_CATEGORIES,
  ORG_REVENUE_CATEGORIES,
  blankOrgStatement,
  buildOrgStatementFromFinances,
  computeOrgStatementTotals,
  lineTotalCents,
  type OrgRevenueStatement,
  type OrgStatementLine,
} from "../../../../shared/orgRevenueStatement";
import {
  renderAnnualStatementHtml,
  renderOrgStatementHtml,
  renderProgramStatementHtml,
  renderReadinessHtml,
  renderRestrictedFundsHtml,
} from "../lib/yearEndRenderers";

type TabId = "readiness" | "annual" | "restricted" | "org" | "programs";

type EditLine = { key: string; label: string; actual: string; budget: string; notes?: string };
type EditState = {
  _id?: string;
  grantId?: string;
  programName: string;
  funderName: string;
  priorFiscalYearLabel: string;
  currentFiscalYearLabel: string;
  status: string;
  narrative: string;
  revenues: EditLine[];
  expenses: EditLine[];
};

function toEditLine(line: ProgramStatementLine): EditLine {
  return {
    key: line.key,
    label: line.label,
    actual: centsToDollarInput(line.actualCents),
    budget: centsToDollarInput(line.budgetCents),
    notes: line.notes,
  };
}

function editFromStatement(statement: ProgramStatement & { _id?: string }): EditState {
  return {
    _id: statement._id,
    grantId: statement.grantId,
    programName: statement.programName ?? "",
    funderName: statement.funderName ?? "",
    priorFiscalYearLabel: statement.priorFiscalYearLabel,
    currentFiscalYearLabel: statement.currentFiscalYearLabel,
    status: statement.status ?? "Draft",
    narrative: statement.narrative ?? "",
    revenues: statement.revenues.map(toEditLine),
    expenses: statement.expenses.map(toEditLine),
  };
}

function editLineToLine(line: EditLine): ProgramStatementLine {
  return {
    key: line.key,
    label: line.label,
    actualCents: dollarInputToCents(line.actual) ?? 0,
    budgetCents: dollarInputToCents(line.budget) ?? 0,
    ...(line.notes ? { notes: line.notes } : {}),
  };
}

function statementFromEdit(edit: EditState): ProgramStatement {
  return {
    _id: edit._id,
    grantId: edit.grantId,
    programName: edit.programName,
    funderName: edit.funderName || undefined,
    priorFiscalYearLabel: edit.priorFiscalYearLabel,
    currentFiscalYearLabel: edit.currentFiscalYearLabel,
    status: edit.status,
    narrative: edit.narrative || undefined,
    revenues: edit.revenues.map(editLineToLine),
    expenses: edit.expenses.map(editLineToLine),
  };
}

type OrgEditLine = { key: string; label: string; general: string; gaming: string; notes?: string };
type OrgEditState = {
  _id?: string;
  organizationName: string;
  fiscalYearLabel: string;
  periodLabel: string;
  status: string;
  narrative: string;
  revenues: OrgEditLine[];
  expenses: OrgEditLine[];
};

function toOrgEditLine(line: OrgStatementLine): OrgEditLine {
  return {
    key: line.key,
    label: line.label,
    general: centsToDollarInput(line.generalCents),
    gaming: centsToDollarInput(line.gamingCents),
    notes: line.notes,
  };
}

function orgEditFromStatement(statement: OrgRevenueStatement & { _id?: string }): OrgEditState {
  return {
    _id: statement._id,
    organizationName: statement.organizationName ?? "",
    fiscalYearLabel: statement.fiscalYearLabel,
    periodLabel: statement.periodLabel ?? "",
    status: statement.status ?? "Draft",
    narrative: statement.narrative ?? "",
    revenues: statement.revenues.map(toOrgEditLine),
    expenses: statement.expenses.map(toOrgEditLine),
  };
}

function orgEditLineToLine(line: OrgEditLine): OrgStatementLine {
  return {
    key: line.key,
    label: line.label,
    generalCents: dollarInputToCents(line.general) ?? 0,
    gamingCents: dollarInputToCents(line.gaming) ?? 0,
    ...(line.notes ? { notes: line.notes } : {}),
  };
}

function orgStatementFromEdit(edit: OrgEditState): OrgRevenueStatement {
  return {
    _id: edit._id,
    organizationName: edit.organizationName,
    fiscalYearLabel: edit.fiscalYearLabel,
    periodLabel: edit.periodLabel || undefined,
    status: edit.status,
    narrative: edit.narrative || undefined,
    revenues: edit.revenues.map(orgEditLineToLine),
    expenses: edit.expenses.map(orgEditLineToLine),
  };
}

function ToneBadge({ tone }: { tone: string }) {
  if (tone === "complete") return <Badge tone="success">Complete</Badge>;
  if (tone === "upcoming") return <Badge tone="neutral">Upcoming</Badge>;
  return <Badge tone="warn">Needs attention</Badge>;
}

function ReportActions({ title, filenameBase, bodyHtml }: { title: string; filenameBase: string; bodyHtml: string }) {
  return (
    <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
      <button className="btn-action btn-action--primary" onClick={() => void exportWordDocx({ filename: `${filenameBase}.docx`, title, bodyHtml })}>
        <FileDown size={12} /> Export Word
      </button>
      <button className="btn-action" onClick={() => void exportPdfDownload({ filename: `${filenameBase}.pdf`, title, bodyHtml })}>
        <FileDown size={12} /> Download PDF
      </button>
      <button className="btn-action" onClick={() => void printPdfDocument({ title, bodyHtml })}>
        <Printer size={12} /> Print
      </button>
    </div>
  );
}

function PreviewBox({ bodyHtml }: { bodyHtml: string }) {
  return (
    <div
      className="card"
      style={{ padding: 16, background: "#fff", overflowX: "auto" }}
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}

export function YearEndReportsPage() {
  const society = useSociety();
  const [tab, setTab] = useState<TabId>("readiness");
  const financials = useQuery(api.financials.list, society ? { societyId: society._id } : "skip");

  const fiscalYears = useMemo(() => {
    const years = new Set<string>((financials ?? []).map((f: any) => String(f.fiscalYear)).filter(Boolean));
    if (years.size === 0) years.add("2024-2025");
    return Array.from(years).sort().reverse();
  }, [financials]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const fiscalYear = selectedYear ?? fiscalYears[0];

  const readiness = useQuery(api.yearEnd.readiness, society && fiscalYear ? { societyId: society._id, fiscalYear } : "skip");
  const annual = useQuery(api.yearEnd.annualStatement, society && fiscalYear ? { societyId: society._id, fiscalYear } : "skip");
  const restricted = useQuery(api.yearEnd.restrictedFundStatement, society ? { societyId: society._id } : "skip");
  const statements = useQuery(api.programStatements.list, society ? { societyId: society._id } : "skip");
  const grants = useQuery(api.grants.list, society ? { societyId: society._id } : "skip");
  const grantTxns = useQuery(api.grants.transactions, society ? { societyId: society._id } : "skip");

  const orgStatements = useQuery(api.orgRevenueStatements.list, society ? { societyId: society._id } : "skip");

  const createStatement = useMutation(api.programStatements.create);
  const updateStatement = useMutation(api.programStatements.update);
  const removeStatement = useMutation(api.programStatements.remove);
  const createOrg = useMutation(api.orgRevenueStatements.create);
  const updateOrg = useMutation(api.orgRevenueStatements.update);
  const removeOrg = useMutation(api.orgRevenueStatements.remove);

  const [edit, setEdit] = useState<EditState | null>(null);
  const [grantPick, setGrantPick] = useState<string>("");
  const [orgEdit, setOrgEdit] = useState<OrgEditState | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const priorLabel = fiscalYear ?? "Previous fiscal year";
  const currentLabel = (() => {
    const m = /^(\d{4})-(\d{4})$/.exec(fiscalYear ?? "");
    if (m) return `${Number(m[1]) + 1}-${Number(m[2]) + 1}`;
    return "Current fiscal year";
  })();

  const startNew = () => {
    setEdit(
      editFromStatement(
        blankProgramStatement({ priorFiscalYearLabel: priorLabel, currentFiscalYearLabel: currentLabel }),
      ),
    );
  };

  const startFromGrant = (grantId: string) => {
    const grant = (grants ?? []).find((g: any) => String(g._id) === grantId);
    if (!grant) return;
    const txns = (grantTxns ?? []).filter((t: any) => String(t.grantId) === grantId);
    const built = buildStatementFromGrant(grant, txns, { priorFiscalYearLabel: priorLabel, currentFiscalYearLabel: currentLabel });
    built.grantId = grantId;
    setEdit(editFromStatement(built));
  };

  const saveEdit = async () => {
    if (!edit) return;
    const statement = statementFromEdit(edit);
    if (edit._id) {
      await updateStatement({
        id: edit._id as any,
        patch: {
          grantId: edit.grantId as any,
          programName: statement.programName,
          funderName: statement.funderName,
          priorFiscalYearLabel: statement.priorFiscalYearLabel,
          currentFiscalYearLabel: statement.currentFiscalYearLabel,
          revenues: statement.revenues,
          expenses: statement.expenses,
          narrative: statement.narrative,
          status: statement.status,
        },
      });
    } else {
      await createStatement({
        societyId: society._id,
        grantId: edit.grantId as any,
        programName: statement.programName,
        funderName: statement.funderName,
        priorFiscalYearLabel: statement.priorFiscalYearLabel,
        currentFiscalYearLabel: statement.currentFiscalYearLabel,
        revenues: statement.revenues,
        expenses: statement.expenses,
        narrative: statement.narrative,
        status: statement.status,
      });
    }
    setEdit(null);
  };

  const deleteStatement = async (id: string) => {
    await removeStatement({ id: id as any });
    if (edit?._id === id) setEdit(null);
  };

  const updateLine = (kind: "revenues" | "expenses", index: number, patch: Partial<EditLine>) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const lines = prev[kind].slice();
      lines[index] = { ...lines[index], ...patch };
      return { ...prev, [kind]: lines };
    });
  };
  const addOtherLine = (kind: "revenues" | "expenses") => {
    setEdit((prev) => {
      if (!prev) return prev;
      const line: EditLine = { key: `custom:${kind}:${Date.now()}`, label: "Other", actual: "", budget: "" };
      return { ...prev, [kind]: [...prev[kind], line] };
    });
  };
  const removeLine = (kind: "revenues" | "expenses", index: number) => {
    setEdit((prev) => {
      if (!prev) return prev;
      return { ...prev, [kind]: prev[kind].filter((_, i) => i !== index) };
    });
  };

  const startNewOrg = () => {
    setOrgEdit(
      orgEditFromStatement(
        blankOrgStatement({ organizationName: society.name, fiscalYearLabel: fiscalYear ?? "" }),
      ),
    );
  };
  const prefillOrgFromFinances = () => {
    const built = buildOrgStatementFromFinances({
      organizationName: society.name,
      fiscalYearLabel: fiscalYear ?? "",
      incomeByCategory: annual?.incomeByCategory ?? [],
      expenseByCategory: annual?.expenseByCategory ?? [],
      gamingGrantCents: restricted?.totals?.receiptsCents ?? 0,
    });
    setOrgEdit(orgEditFromStatement(built));
  };
  const saveOrg = async () => {
    if (!orgEdit) return;
    const statement = orgStatementFromEdit(orgEdit);
    if (orgEdit._id) {
      await updateOrg({
        id: orgEdit._id as any,
        patch: {
          organizationName: statement.organizationName,
          fiscalYearLabel: statement.fiscalYearLabel,
          periodLabel: statement.periodLabel,
          revenues: statement.revenues,
          expenses: statement.expenses,
          narrative: statement.narrative,
          status: statement.status,
        },
      });
    } else {
      await createOrg({
        societyId: society._id,
        organizationName: statement.organizationName,
        fiscalYearLabel: statement.fiscalYearLabel,
        periodLabel: statement.periodLabel,
        revenues: statement.revenues,
        expenses: statement.expenses,
        narrative: statement.narrative,
        status: statement.status,
      });
    }
    setOrgEdit(null);
  };
  const deleteOrg = async (id: string) => {
    await removeOrg({ id: id as any });
    if (orgEdit?._id === id) setOrgEdit(null);
  };
  const updateOrgLine = (kind: "revenues" | "expenses", index: number, patch: Partial<OrgEditLine>) => {
    setOrgEdit((prev) => {
      if (!prev) return prev;
      const lines = prev[kind].slice();
      lines[index] = { ...lines[index], ...patch };
      return { ...prev, [kind]: lines };
    });
  };
  const addOrgLine = (kind: "revenues" | "expenses") => {
    setOrgEdit((prev) => {
      if (!prev) return prev;
      const line: OrgEditLine = { key: `custom:${kind}:${Date.now()}`, label: "Other", general: "", gaming: "" };
      return { ...prev, [kind]: [...prev[kind], line] };
    });
  };
  const removeOrgLine = (kind: "revenues" | "expenses", index: number) => {
    setOrgEdit((prev) => {
      if (!prev) return prev;
      return { ...prev, [kind]: prev[kind].filter((_, i) => i !== index) };
    });
  };

  const TABS: Array<{ id: TabId; label: string }> = [
    { id: "readiness", label: "Readiness checklist" },
    { id: "annual", label: "Annual statement" },
    { id: "restricted", label: "Restricted funds" },
    { id: "org", label: "Organization revenue & expenses" },
    { id: "programs", label: "Program actuals & budget" },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Year-end reports"
        icon={<PiggyBank size={16} />}
        iconColor="green"
        subtitle="Assemble and export the society's year-end financial reports — annual statement, restricted funds, the BC Community Gaming Grants program actuals & budget, and a readiness checklist."
        actions={
          <Link className="btn-action" to="/app/financials">
            <ArrowLeft size={12} /> Financials
          </Link>
        }
      />

      <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
        <Field label="Fiscal year">
          <select className="input" value={fiscalYear ?? ""} onChange={(e) => setSelectedYear(e.target.value)}>
            {fiscalYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="tab-row" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn-action${tab === t.id ? " btn-action--primary" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "readiness" && (
        <div className="col" style={{ gap: 12 }}>
          {readiness === undefined ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <CalendarCheck size={16} />
                  <strong>
                    {readiness.completed} of {readiness.total} complete
                  </strong>
                  {readiness.ready ? <Badge tone="success">Year-end ready</Badge> : <Badge tone="warn">In progress</Badge>}
                </div>
                <ReportActions
                  title="Year-End Readiness Checklist"
                  filenameBase={`year-end-readiness-${fiscalYear}`}
                  bodyHtml={renderReadinessHtml(readiness, society, fiscalYear)}
                />
              </div>
              <div className="col" style={{ gap: 8 }}>
                {readiness.items.map((item: any) => (
                  <div key={item.key} className="card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ marginTop: 2 }}>
                      {item.ok ? (
                        <CheckCircle2 size={16} color="#0a8f4e" />
                      ) : item.status === "upcoming" ? (
                        <Circle size={16} color="#888" />
                      ) : (
                        <AlertTriangle size={16} color="#c9264a" />
                      )}
                    </span>
                    <div className="col" style={{ gap: 2, flex: 1 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                        <strong>{item.label}</strong>
                        <ToneBadge tone={item.status} />
                      </div>
                      <span className="muted">{item.detail}</span>
                      <Link to={item.href} className="meta">
                        Open →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "annual" && (
        <div className="col" style={{ gap: 12 }}>
          {annual === undefined ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <ReportActions
                title="Annual Financial Statement"
                filenameBase={`annual-statement-${fiscalYear}`}
                bodyHtml={renderAnnualStatementHtml(annual, society, fiscalYear)}
              />
              <PreviewBox bodyHtml={renderAnnualStatementHtml(annual, society, fiscalYear)} />
            </>
          )}
        </div>
      )}

      {tab === "restricted" && (
        <div className="col" style={{ gap: 12 }}>
          {restricted === undefined ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <ReportActions
                title="Statement of Restricted Funds"
                filenameBase={`restricted-funds-${fiscalYear}`}
                bodyHtml={renderRestrictedFundsHtml(restricted, society)}
              />
              <PreviewBox bodyHtml={renderRestrictedFundsHtml(restricted, society)} />
            </>
          )}
        </div>
      )}

      {tab === "org" && (
        <div className="col" style={{ gap: 12 }}>
          {!orgEdit ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn-action btn-action--primary" onClick={startNewOrg}>
                  <Plus size={12} /> New statement
                </button>
                <button className="btn-action" onClick={prefillOrgFromFinances}>
                  Prefill from finances
                </button>
              </div>
              <p className="meta">
                Organization-wide Statement of Revenues &amp; Expenses (General Fund / Gaming Fund / Total) — the BC
                Community Gaming Grants org-level financial statement required for Program and Capital Project grants.
              </p>
              {orgStatements === undefined ? (
                <p className="muted">Loading…</p>
              ) : orgStatements.length === 0 ? (
                <p className="muted">No organization statements yet. Create one or prefill it from your finances.</p>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  {orgStatements.map((s: any) => {
                    const totals = computeOrgStatementTotals(s);
                    return (
                      <div key={s._id} className="card" style={{ padding: 12 }}>
                        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div className="col" style={{ gap: 2 }}>
                            <strong>{s.organizationName}</strong>
                            <span className="meta">
                              {s.periodLabel ? s.periodLabel : `Fiscal year ${s.fiscalYearLabel}`}
                            </span>
                            <span className="meta">
                              Total revenues {money(totals.revenue.totalCents)} · Total expenses{" "}
                              {money(totals.expense.totalCents)} · Excess {money(totals.excess.totalCents)}
                            </span>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            <Badge tone={s.status === "Final" ? "success" : "neutral"}>{s.status}</Badge>
                            <button className="btn-action" onClick={() => setOrgEdit(orgEditFromStatement(s))}>
                              Edit
                            </button>
                            <button className="btn-action" onClick={() => void deleteOrg(s._id)}>
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <OrgStatementEditor
              edit={orgEdit}
              society={society}
              onField={(patch) => setOrgEdit((prev) => (prev ? { ...prev, ...patch } : prev))}
              onLine={updateOrgLine}
              onAddLine={addOrgLine}
              onRemoveLine={removeOrgLine}
              onSave={saveOrg}
              onCancel={() => setOrgEdit(null)}
            />
          )}
        </div>
      )}

      {tab === "programs" && (
        <div className="col" style={{ gap: 12 }}>
          {!edit ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <button className="btn-action btn-action--primary" onClick={startNew}>
                  <Plus size={12} /> New statement
                </button>
                <Field label="Prefill from grant">
                  <select
                    className="input"
                    value={grantPick}
                    onChange={(e) => {
                      setGrantPick(e.target.value);
                      if (e.target.value) startFromGrant(e.target.value);
                    }}
                  >
                    <option value="">Select a grant…</option>
                    {(grants ?? []).map((g: any) => (
                      <option key={g._id} value={g._id}>
                        {g.title} — {g.funder}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {statements === undefined ? (
                <p className="muted">Loading…</p>
              ) : statements.length === 0 ? (
                <p className="muted">No program statements yet. Create one to reproduce the BC Community Gaming Grants form.</p>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  {statements.map((s: any) => {
                    const totals = computeStatementTotals(s);
                    return (
                      <div key={s._id} className="card" style={{ padding: 12 }}>
                        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div className="col" style={{ gap: 2 }}>
                            <strong>{s.programName}</strong>
                            <span className="meta">
                              {s.funderName ? `${s.funderName} · ` : ""}Actuals {s.priorFiscalYearLabel} · Budget {s.currentFiscalYearLabel}
                            </span>
                            <span className="meta">
                              Revenues {money(totals.revenueActualCents)} · Expenses {money(totals.expenseActualCents)} · Surplus/Deficit{" "}
                              {money(totals.surplusActualCents)}
                            </span>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            <Badge tone={s.status === "Final" ? "success" : "neutral"}>{s.status}</Badge>
                            <button className="btn-action" onClick={() => setEdit(editFromStatement(s))}>
                              Edit
                            </button>
                            <button className="btn-action" onClick={() => void deleteStatement(s._id)}>
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <ProgramStatementEditor
              edit={edit}
              society={society}
              onField={(patch) => setEdit((prev) => (prev ? { ...prev, ...patch } : prev))}
              onLine={updateLine}
              onAddLine={addOtherLine}
              onRemoveLine={removeLine}
              onSave={saveEdit}
              onCancel={() => setEdit(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LineEditor({
  title,
  categories,
  lines,
  kind,
  onLine,
  onAddLine,
  onRemoveLine,
}: {
  title: string;
  categories: Array<{ key: string }>;
  lines: EditLine[];
  kind: "revenues" | "expenses";
  onLine: (kind: "revenues" | "expenses", index: number, patch: Partial<EditLine>) => void;
  onAddLine: (kind: "revenues" | "expenses") => void;
  onRemoveLine: (kind: "revenues" | "expenses", index: number) => void;
}) {
  const fixedKeys = new Set(categories.map((c) => c.key));
  return (
    <div className="col" style={{ gap: 6 }}>
      <strong>{title}</strong>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Line</th>
            <th style={{ width: 130 }}>Actual ($)</th>
            <th style={{ width: 130 }}>Budget ($)</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.key}-${index}`}>
              <td>
                <input
                  className="input"
                  value={line.label}
                  onChange={(e) => onLine(kind, index, { label: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input"
                  inputMode="decimal"
                  value={line.actual}
                  onChange={(e) => onLine(kind, index, { actual: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input"
                  inputMode="decimal"
                  value={line.budget}
                  onChange={(e) => onLine(kind, index, { budget: e.target.value })}
                />
              </td>
              <td>
                {!fixedKeys.has(line.key) && (
                  <button className="btn-action" onClick={() => onRemoveLine(kind, index)} aria-label="Remove line">
                    <Trash2 size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button className="btn-action" onClick={() => onAddLine(kind)}>
          <Plus size={12} /> Add line
        </button>
      </div>
    </div>
  );
}

function ProgramStatementEditor({
  edit,
  society,
  onField,
  onLine,
  onAddLine,
  onRemoveLine,
  onSave,
  onCancel,
}: {
  edit: EditState;
  society: any;
  onField: (patch: Partial<EditState>) => void;
  onLine: (kind: "revenues" | "expenses", index: number, patch: Partial<EditLine>) => void;
  onAddLine: (kind: "revenues" | "expenses") => void;
  onRemoveLine: (kind: "revenues" | "expenses", index: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const statement = statementFromEdit(edit);
  const totals = computeStatementTotals(statement);
  const bodyHtml = renderProgramStatementHtml(statement, society);
  const filenameBase = `program-actuals-budget-${(edit.programName || "program").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <button className="btn-action" onClick={onCancel}>
          <ArrowLeft size={12} /> Back to list
        </button>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn-action btn-action--primary" onClick={onSave}>
            Save statement
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label="Program name">
          <input className="input" value={edit.programName} onChange={(e) => onField({ programName: e.target.value })} />
        </Field>
        <Field label="Funder">
          <input className="input" value={edit.funderName} onChange={(e) => onField({ funderName: e.target.value })} />
        </Field>
        <Field label="Actuals fiscal year">
          <input
            className="input"
            value={edit.priorFiscalYearLabel}
            onChange={(e) => onField({ priorFiscalYearLabel: e.target.value })}
          />
        </Field>
        <Field label="Budget fiscal year">
          <input
            className="input"
            value={edit.currentFiscalYearLabel}
            onChange={(e) => onField({ currentFiscalYearLabel: e.target.value })}
          />
        </Field>
        <Field label="Status">
          <select className="input" value={edit.status} onChange={(e) => onField({ status: e.target.value })}>
            <option value="Draft">Draft</option>
            <option value="Final">Final</option>
          </select>
        </Field>
      </div>

      <LineEditor
        title="Program Revenues"
        categories={REVENUE_CATEGORIES}
        lines={edit.revenues}
        kind="revenues"
        onLine={onLine}
        onAddLine={onAddLine}
        onRemoveLine={onRemoveLine}
      />
      <LineEditor
        title="Program Expenses"
        categories={EXPENSE_CATEGORIES}
        lines={edit.expenses}
        kind="expenses"
        onLine={onLine}
        onAddLine={onAddLine}
        onRemoveLine={onRemoveLine}
      />

      <Field label="Notes">
        <textarea
          className="input"
          rows={2}
          value={edit.narrative}
          onChange={(e) => onField({ narrative: e.target.value })}
        />
      </Field>

      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <span>
            Total Revenues: <strong>{money(totals.revenueActualCents)}</strong> / {money(totals.revenueBudgetCents)}
          </span>
          <span>
            Total Expenses: <strong>{money(totals.expenseActualCents)}</strong> / {money(totals.expenseBudgetCents)}
          </span>
          <span>
            Surplus / Deficit: <strong>{money(totals.surplusActualCents)}</strong> / {money(totals.surplusBudgetCents)}
          </span>
        </div>
      </div>

      <ReportActions title="Program Actual Revenue and Expenses and Budget" filenameBase={filenameBase} bodyHtml={bodyHtml} />
      <PreviewBox bodyHtml={bodyHtml} />
    </div>
  );
}

function OrgLineEditor({
  title,
  categories,
  lines,
  kind,
  onLine,
  onAddLine,
  onRemoveLine,
}: {
  title: string;
  categories: Array<{ key: string }>;
  lines: OrgEditLine[];
  kind: "revenues" | "expenses";
  onLine: (kind: "revenues" | "expenses", index: number, patch: Partial<OrgEditLine>) => void;
  onAddLine: (kind: "revenues" | "expenses") => void;
  onRemoveLine: (kind: "revenues" | "expenses", index: number) => void;
}) {
  const fixedKeys = new Set(categories.map((c) => c.key));
  return (
    <div className="col" style={{ gap: 6 }}>
      <strong>{title}</strong>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Line</th>
            <th style={{ width: 120 }}>General Fund ($)</th>
            <th style={{ width: 120 }}>Gaming Fund ($)</th>
            <th style={{ width: 110 }}>Total</th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.key}-${index}`}>
              <td>
                <input className="input" value={line.label} onChange={(e) => onLine(kind, index, { label: e.target.value })} />
              </td>
              <td>
                <input
                  className="input"
                  inputMode="decimal"
                  value={line.general}
                  onChange={(e) => onLine(kind, index, { general: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input"
                  inputMode="decimal"
                  value={line.gaming}
                  onChange={(e) => onLine(kind, index, { gaming: e.target.value })}
                />
              </td>
              <td style={{ textAlign: "right" }}>
                {money(lineTotalCents(orgEditLineToLine(line)))}
              </td>
              <td>
                {!fixedKeys.has(line.key) && (
                  <button className="btn-action" onClick={() => onRemoveLine(kind, index)} aria-label="Remove line">
                    <Trash2 size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button className="btn-action" onClick={() => onAddLine(kind)}>
          <Plus size={12} /> Add line
        </button>
      </div>
    </div>
  );
}

function OrgStatementEditor({
  edit,
  society,
  onField,
  onLine,
  onAddLine,
  onRemoveLine,
  onSave,
  onCancel,
}: {
  edit: OrgEditState;
  society: any;
  onField: (patch: Partial<OrgEditState>) => void;
  onLine: (kind: "revenues" | "expenses", index: number, patch: Partial<OrgEditLine>) => void;
  onAddLine: (kind: "revenues" | "expenses") => void;
  onRemoveLine: (kind: "revenues" | "expenses", index: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const statement = orgStatementFromEdit(edit);
  const totals = computeOrgStatementTotals(statement);
  const bodyHtml = renderOrgStatementHtml(statement, society);
  const filenameBase = `organization-revenue-expenses-${(edit.fiscalYearLabel || "fy").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <button className="btn-action" onClick={onCancel}>
          <ArrowLeft size={12} /> Back to list
        </button>
        <button className="btn-action btn-action--primary" onClick={onSave}>
          Save statement
        </button>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label="Organization name">
          <input className="input" value={edit.organizationName} onChange={(e) => onField({ organizationName: e.target.value })} />
        </Field>
        <Field label="Fiscal year">
          <input className="input" value={edit.fiscalYearLabel} onChange={(e) => onField({ fiscalYearLabel: e.target.value })} />
        </Field>
        <Field label="Period (optional)">
          <input
            className="input"
            placeholder="April 1, 2024 to March 31, 2025"
            value={edit.periodLabel}
            onChange={(e) => onField({ periodLabel: e.target.value })}
          />
        </Field>
        <Field label="Status">
          <select className="input" value={edit.status} onChange={(e) => onField({ status: e.target.value })}>
            <option value="Draft">Draft</option>
            <option value="Final">Final</option>
          </select>
        </Field>
      </div>

      <OrgLineEditor
        title="Revenues"
        categories={ORG_REVENUE_CATEGORIES}
        lines={edit.revenues}
        kind="revenues"
        onLine={onLine}
        onAddLine={onAddLine}
        onRemoveLine={onRemoveLine}
      />
      <OrgLineEditor
        title="Expenses"
        categories={ORG_EXPENSE_CATEGORIES}
        lines={edit.expenses}
        kind="expenses"
        onLine={onLine}
        onAddLine={onAddLine}
        onRemoveLine={onRemoveLine}
      />

      <Field label="Notes">
        <textarea className="input" rows={2} value={edit.narrative} onChange={(e) => onField({ narrative: e.target.value })} />
      </Field>

      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <span>
            Total Revenues: <strong>{money(totals.revenue.totalCents)}</strong> (Gen {money(totals.revenue.generalCents)} · Gaming{" "}
            {money(totals.revenue.gamingCents)})
          </span>
          <span>
            Total Expenses: <strong>{money(totals.expense.totalCents)}</strong>
          </span>
          <span>
            Excess of Revenues over Expenses: <strong>{money(totals.excess.totalCents)}</strong>
          </span>
        </div>
      </div>

      <ReportActions title="Organization Revenue and Expense Statement" filenameBase={filenameBase} bodyHtml={bodyHtml} />
      <PreviewBox bodyHtml={bodyHtml} />
    </div>
  );
}
