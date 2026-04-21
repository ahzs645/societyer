import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, SeedPrompt } from "./_helpers";
import { PiggyBank, TrendingUp, TrendingDown, AlertTriangle, DollarSign, PlusCircle, Trash2, Upload } from "lucide-react";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { centsToDollarInput, dollarInputToCents, formatDate } from "../lib/format";
import { StudentLevyIntakeDrawer } from "../components/StudentLevyIntakeDrawer";

function cents(value: number): string {
  const abs = Math.abs(value);
  const str = (abs / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `($${str})` : `$${str}`;
}

function getFiscalYearBounds(fyEnd: string | undefined) {
  const now = new Date();
  const [monthRaw, dayRaw] = (fyEnd?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? fyEnd.slice(5)
    : fyEnd ?? "12-31"
  ).split("-");
  const month = Math.min(12, Math.max(1, Number(monthRaw) || 12));
  const day = Math.min(31, Math.max(1, Number(dayRaw) || 31));
  let endYear = now.getFullYear();
  const thisYearEnd = new Date(endYear, month - 1, day, 23, 59, 59, 999);
  if (now.getTime() > thisYearEnd.getTime()) endYear += 1;
  const end = new Date(endYear, month - 1, day);
  const start = new Date(endYear - 1, month - 1, day + 1);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end), fy: String(endYear) };
}

const SOURCE_TYPES = [
  { value: "Member dues", label: "Member dues" },
  { value: "Donor", label: "Donor" },
  { value: "Grant funder", label: "Grant funder" },
  { value: "Sponsor", label: "Sponsor" },
  { value: "Government", label: "Government" },
  { value: "Program revenue", label: "Program revenue" },
  { value: "Other", label: "Other" },
];

const SOURCE_STATUSES = [
  { value: "Active", label: "Active" },
  { value: "Prospect", label: "Prospect" },
  { value: "Paused", label: "Paused" },
  { value: "Ended", label: "Ended" },
];

const COLLECTION_MODELS = [
  { value: "direct", label: "Direct" },
  { value: "third_party", label: "Third-party collector" },
  { value: "unknown", label: "Unknown" },
];

const COLLECTION_FREQUENCIES = [
  { value: "semester", label: "Semester / term" },
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
  { value: "one_time", label: "One-time" },
  { value: "irregular", label: "Irregular" },
  { value: "unknown", label: "Unknown" },
];

const MEMBER_DISCLOSURE_LEVELS = [
  { value: "named_members", label: "Named members" },
  { value: "aggregate_count", label: "Aggregate count" },
  { value: "aggregate_amount", label: "Aggregate amount only" },
  { value: "unknown", label: "Unknown" },
];

const ATTRIBUTION_STATUSES = [
  { value: "named", label: "Named" },
  { value: "aggregate", label: "Aggregate" },
  { value: "unknown", label: "Unknown" },
];

const FUNDING_EVENT_KINDS = [
  { value: "Received", label: "Received" },
  { value: "Pledged", label: "Pledged" },
  { value: "Agreement", label: "Agreement" },
  { value: "Report", label: "Report" },
  { value: "Renewal", label: "Renewal" },
  { value: "Contact", label: "Contact" },
  { value: "Other", label: "Other" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function newSourceDraft() {
  return {
    id: undefined,
    name: "",
    sourceType: "Donor",
    status: "Active",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    collectionAgentName: "",
    collectionModel: "direct",
    memberDisclosureLevel: "named_members",
    estimatedMemberCount: "",
    collectionFrequency: "unknown",
    collectionScheduleNotes: "",
    nextExpectedCollectionDate: "",
    reconciliationCadence: "",
    expectedAnnualDollars: "",
    committedDollars: "",
    receivedToDateDollars: "",
    currency: "CAD",
    startDate: todayISO(),
    endDate: "",
    restrictedPurpose: "",
    notes: "",
  };
}

function sourceDraftFromRow(row: any) {
  return {
    id: row._id,
    name: row.name ?? "",
    sourceType: row.sourceType ?? "Donor",
    status: row.status ?? "Active",
    contactName: row.contactName ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    collectionAgentName: row.collectionAgentName ?? "",
    collectionModel: row.collectionModel ?? "direct",
    memberDisclosureLevel: row.memberDisclosureLevel ?? "named_members",
    estimatedMemberCount: row.estimatedMemberCount != null ? String(row.estimatedMemberCount) : "",
    collectionFrequency: row.collectionFrequency ?? "unknown",
    collectionScheduleNotes: row.collectionScheduleNotes ?? "",
    nextExpectedCollectionDate: row.nextExpectedCollectionDate ?? "",
    reconciliationCadence: row.reconciliationCadence ?? "",
    expectedAnnualDollars: centsToDollarInput(row.expectedAnnualCents),
    committedDollars: centsToDollarInput(row.committedCents),
    receivedToDateDollars: centsToDollarInput(row.receivedToDateCents),
    currency: row.currency ?? "CAD",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    restrictedPurpose: row.restrictedPurpose ?? "",
    notes: row.notes ?? "",
  };
}

function newEventDraft(source: any) {
  return {
    id: undefined,
    sourceId: source?._id ?? "",
    sourceName: source?.name ?? "",
    eventDate: todayISO(),
    kind: "Received",
    label: "",
    amountDollars: "",
    memberCount: "",
    periodStart: "",
    periodEnd: "",
    attributionStatus: "aggregate",
    notes: "",
  };
}

function eventDraftFromRow(event: any, source: any) {
  return {
    id: event._id,
    sourceId: event.sourceId,
    sourceName: source?.name ?? "",
    eventDate: event.eventDate ?? todayISO(),
    kind: event.kind ?? "Received",
    label: event.label ?? "",
    amountDollars: centsToDollarInput(event.amountCents),
    memberCount: event.memberCount != null ? String(event.memberCount) : "",
    periodStart: event.periodStart ?? "",
    periodEnd: event.periodEnd ?? "",
    attributionStatus: event.attributionStatus ?? "aggregate",
    notes: event.notes ?? "",
  };
}

export function TreasurerPage() {
  const society = useSociety();
  const { from: defaultFrom, to: defaultTo, fy: defaultFy } = useMemo(
    () => getFiscalYearBounds(society?.fiscalYearEnd),
    [society?.fiscalYearEnd],
  );
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [fy, setFy] = useState(defaultFy);

  const pnl = useQuery(
    api.treasury.profitAndLoss,
    society ? { societyId: society._id, from, to } : "skip",
  );
  const variance = useQuery(
    api.treasury.budgetVariance,
    society ? { societyId: society._id, fiscalYear: fy } : "skip",
  );
  const restricted = useQuery(
    api.treasury.restrictedFunds,
    society ? { societyId: society._id } : "skip",
  );
  const fundingRollup = useQuery(
    api.fundingSources.rollup,
    society ? { societyId: society._id, from, to } : "skip",
  );
  const fundingSources = useQuery(
    api.fundingSources.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsertFundingSource = useMutation(api.fundingSources.upsertSource);
  const removeFundingSource = useMutation(api.fundingSources.removeSource);
  const upsertFundingEvent = useMutation(api.fundingSources.upsertEvent);
  const removeFundingEvent = useMutation(api.fundingSources.removeEvent);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [sourceDraft, setSourceDraft] = useState<any>(null);
  const [eventDraft, setEventDraft] = useState<any>(null);
  const [levyImportOpen, setLevyImportOpen] = useState(false);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  // Server now returns these as arrays of `{ category, cents }` (object keys
  // can't carry the en-dash characters Wave uses in category names). Map to
  // tuples so the existing `[cat, amt]` destructuring downstream still works.
  const incomeEntries: Array<[string, number]> = pnl
    ? pnl.incomeByCategory.map(({ category, cents }) => [category, cents])
    : [];
  const expenseEntries: Array<[string, number]> = pnl
    ? pnl.expenseByCategory.map(({ category, cents }) => [category, cents])
    : [];
  const fundingEvents = (fundingSources ?? [])
    .flatMap((source: any) =>
      (source.events ?? []).map((event: any) => ({
        ...event,
        sourceName: source.name,
        sourceType: source.sourceType,
        source,
      })),
    )
    .sort((a: any, b: any) => b.eventDate.localeCompare(a.eventDate));

  return (
    <div className="page">
      <PageHeader
        title="Treasurer dashboard"
        icon={<PiggyBank size={16} />}
        iconColor="green"
        subtitle="P&L summary, funding sources, budget variance, and restricted-fund balances."
        actions={
          <>
            <button className="btn-action" onClick={() => setLevyImportOpen(true)}>
              <Upload size={12} /> Import levy
            </button>
            <button className="btn-action btn-action--primary" onClick={() => setSourceDraft(newSourceDraft())}>
              <PlusCircle size={12} /> New funding source
            </button>
          </>
        }
      />

      {/* date range */}
      <div className="card">
        <div className="card__body row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">FY</span>
            <input
              className="input"
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              inputMode="numeric"
              style={{ width: 90, maxWidth: "100%" }}
            />
          </label>
        </div>
      </div>

      {/* P&L */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
        <SummaryCard label="Income" value={pnl?.totalIncomeCents ?? 0} icon={<TrendingUp size={14} />} color="green" />
        <SummaryCard label="Expenses" value={-(pnl?.totalExpenseCents ?? 0)} icon={<TrendingDown size={14} />} color="red" />
        <SummaryCard label="Net" value={pnl?.netCents ?? 0} icon={<DollarSign size={14} />} color={pnl && pnl.netCents < 0 ? "red" : "green"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
        <div className="card">
          <div className="card__head"><h2 className="card__title">Income by category</h2></div>
          <div className="card__body col" style={{ gap: 4 }}>
            {incomeEntries.length === 0 && <div className="muted">No income transactions in this period.</div>}
            {incomeEntries.map(([cat, amt]) => (
              <div key={cat} className="row" style={{ justifyContent: "space-between" }}>
                <span>{cat}</span>
                <span className="mono">{cents(amt)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card__head"><h2 className="card__title">Expenses by category</h2></div>
          <div className="card__body col" style={{ gap: 4 }}>
            {expenseEntries.length === 0 && <div className="muted">No expense transactions in this period.</div>}
            {expenseEntries.map(([cat, amt]) => (
              <div key={cat} className="row" style={{ justifyContent: "space-between" }}>
                <span>{cat}</span>
                <span className="mono">{cents(amt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 12 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Funding mix</h2>
              <span className="card__subtitle">
                {cents(fundingRollup?.totalReceivedCents ?? 0)} received in selected period
              </span>
            </div>
          </div>
          <div className="card__body">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Received</th>
                  <th style={{ textAlign: "right" }}>Expected</th>
                </tr>
              </thead>
              <tbody>
                {(fundingRollup?.rows ?? []).slice(0, 8).map((row: any) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {row.observedFrom?.join(", ") || "register"}
                        {row.collectionAgents?.length ? ` · via ${row.collectionAgents.join(", ")}` : ""}
                        {row.collectionFrequencies?.length ? ` · ${row.collectionFrequencies.join(", ")}` : ""}
                        {row.nextExpectedCollectionDate ? ` · next ${formatDate(row.nextExpectedCollectionDate)}` : ""}
                        {row.estimatedMemberCount ? ` · ${row.estimatedMemberCount} est. members` : ""}
                      </div>
                    </td>
                    <td><Badge tone={row.sourceType === "Member dues" ? "info" : "neutral"}>{row.sourceType}</Badge></td>
                    <td className="mono" style={{ textAlign: "right" }}>{cents(row.receivedCents)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{row.plannedCents ? cents(row.plannedCents) : "—"}</td>
                  </tr>
                ))}
                {(!fundingRollup || fundingRollup.rows.length === 0) && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No funding sources recorded for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Source register</h2>
              <span className="card__subtitle">{(fundingSources ?? []).length} tracked sources</span>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setSourceDraft(newSourceDraft())}>
              <PlusCircle size={12} /> Add
            </button>
          </div>
          <div className="card__body">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Committed</th>
                  <th style={{ textAlign: "right" }}>Received</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(fundingSources ?? []).map((source: any) => (
                  <tr key={source._id}>
                    <td>
                      <strong>{source.name}</strong>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {source.sourceType}
                        {source.collectionAgentName ? ` · collected by ${source.collectionAgentName}` : ""}
                        {source.collectionFrequency ? ` · ${source.collectionFrequency}` : ""}
                        {source.nextExpectedCollectionDate ? ` · next ${formatDate(source.nextExpectedCollectionDate)}` : ""}
                        {source.memberDisclosureLevel ? ` · ${source.memberDisclosureLevel.replace(/_/g, " ")}` : ""}
                      </div>
                    </td>
                    <td><Badge tone={source.status === "Active" ? "success" : source.status === "Prospect" ? "warn" : "neutral"}>{source.status}</Badge></td>
                    <td className="mono" style={{ textAlign: "right" }}>{source.committedTotalCents ? cents(source.committedTotalCents) : "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{source.receivedTotalCents ? cents(source.receivedTotalCents) : "—"}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => setEventDraft(newEventDraft(source))}>Event</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setSourceDraft(sourceDraftFromRow(source))}>Edit</button>
                        <button
                          className="btn btn--ghost btn--sm btn--icon"
                          aria-label={`Delete funding source ${source.name}`}
                          onClick={async () => {
                            await removeFundingSource({ id: source._id, actingUserId });
                            toast.success("Funding source removed");
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(fundingSources ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No funding sources yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Funding source timeline</h2>
          <span className="card__subtitle">Manual funding events, including aggregate third-party remittances.</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Event</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Attribution</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fundingEvents.map((event: any) => (
              <tr key={event._id}>
                <td className="mono">{formatDate(event.eventDate)}</td>
                <td>
                  <strong>{event.sourceName}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>{event.sourceType}</div>
                </td>
                <td>
                  {event.label}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {event.kind}
                    {event.periodStart || event.periodEnd ? ` · ${event.periodStart || "?"} to ${event.periodEnd || "?"}` : ""}
                    {event.memberCount ? ` · ${event.memberCount} members` : ""}
                  </div>
                </td>
                <td className="mono" style={{ textAlign: "right" }}>{event.amountCents != null ? cents(event.amountCents) : "—"}</td>
                <td>{event.attributionStatus ? <Badge tone="info">{event.attributionStatus}</Badge> : <span className="muted">—</span>}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => setEventDraft(eventDraftFromRow(event, event.source))}>Edit</button>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete funding event ${event.label}`}
                      onClick={async () => {
                        await removeFundingEvent({ id: event._id, actingUserId });
                        toast.success("Funding event removed");
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {fundingEvents.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No funding events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Budget variance */}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Budget variance — FY {fy}</h2>
          <span className="card__subtitle">Budget line vs. actual spend</span>
        </div>
        <div className="card__body">
          {(!variance || variance.length === 0) && (
            <div className="muted">No budgets defined for this fiscal year. Add budgets in Financials.</div>
          )}
          {variance && variance.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-md)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Category</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Budget</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Actual</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Variance</th>
                  <th style={{ textAlign: "center", padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {variance.map((row) => {
                  const overBudget = row.varianceCents > 0;
                  return (
                    <tr
                      key={row.category}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: overBudget ? "var(--red-bg, rgba(255,0,0,0.03))" : undefined,
                      }}
                    >
                      <td style={{ padding: "6px 8px" }}>{row.category}</td>
                      <td className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>
                        {cents(row.plannedCents)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>
                        {cents(row.actualCents)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          color: overBudget ? "var(--red)" : undefined,
                        }}
                      >
                        {row.varianceCents === 0 ? "—" : cents(row.varianceCents)}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {overBudget ? (
                          <Badge>
                            <AlertTriangle size={10} /> Over
                          </Badge>
                        ) : (
                          <span className="muted">On track</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Restricted funds */}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Restricted funds</h2>
          <span className="card__subtitle">Active grants with earmarked funds</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          {(!restricted || restricted.length === 0) && (
            <div className="muted">No active grants with restricted purposes.</div>
          )}
          {(restricted ?? []).map((r) => (
            <div key={r.grantId} className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{r.title}</strong>
                  <span className="muted"> — {r.funder}</span>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{r.purpose}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>
                    <span className="muted">Balance</span>{" "}
                    <span className="mono" style={{ fontWeight: 600 }}>{cents(r.balanceCents)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    In: {cents(r.inflowCents)} / Out: {cents(r.outflowCents)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Drawer
        open={!!sourceDraft}
        onClose={() => setSourceDraft(null)}
        title={sourceDraft?.id ? "Edit funding source" : "New funding source"}
        footer={
          <>
            <button className="btn" onClick={() => setSourceDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!sourceDraft?.name}
              onClick={async () => {
                await upsertFundingSource({
                  id: sourceDraft.id,
                  societyId: society._id,
                  name: sourceDraft.name,
                  sourceType: sourceDraft.sourceType,
                  status: sourceDraft.status,
                  contactName: sourceDraft.contactName || undefined,
                  email: sourceDraft.email || undefined,
                  phone: sourceDraft.phone || undefined,
                  website: sourceDraft.website || undefined,
                  collectionAgentName: sourceDraft.collectionAgentName || undefined,
                  collectionModel: sourceDraft.collectionModel || undefined,
                  memberDisclosureLevel: sourceDraft.memberDisclosureLevel || undefined,
                  estimatedMemberCount: sourceDraft.estimatedMemberCount === "" ? undefined : Number(sourceDraft.estimatedMemberCount),
                  collectionFrequency: sourceDraft.collectionFrequency || undefined,
                  collectionScheduleNotes: sourceDraft.collectionScheduleNotes || undefined,
                  nextExpectedCollectionDate: sourceDraft.nextExpectedCollectionDate || undefined,
                  reconciliationCadence: sourceDraft.reconciliationCadence || undefined,
                  expectedAnnualCents: dollarInputToCents(sourceDraft.expectedAnnualDollars),
                  committedCents: dollarInputToCents(sourceDraft.committedDollars),
                  receivedToDateCents: dollarInputToCents(sourceDraft.receivedToDateDollars),
                  currency: sourceDraft.currency || "CAD",
                  startDate: sourceDraft.startDate || undefined,
                  endDate: sourceDraft.endDate || undefined,
                  restrictedPurpose: sourceDraft.restrictedPurpose || undefined,
                  notes: sourceDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Funding source saved");
                setSourceDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {sourceDraft && (
          <div>
            <Field label="Name">
              <input className="input" value={sourceDraft.name} onChange={(e) => setSourceDraft({ ...sourceDraft, name: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Type">
                <Select value={sourceDraft.sourceType} onChange={(v) => setSourceDraft({ ...sourceDraft, sourceType: v })} options={SOURCE_TYPES} />
              </Field>
              <Field label="Status">
                <Select value={sourceDraft.status} onChange={(v) => setSourceDraft({ ...sourceDraft, status: v })} options={SOURCE_STATUSES} />
              </Field>
            </div>
            <Field label="Contact name">
              <input className="input" value={sourceDraft.contactName ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, contactName: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Email">
                <input className="input" type="email" value={sourceDraft.email ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" value={sourceDraft.phone ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, phone: e.target.value })} />
              </Field>
            </div>
            <Field label="Website">
              <input className="input" value={sourceDraft.website ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, website: e.target.value })} />
            </Field>
            <Field label="Collection agent">
              <input
                className="input"
                placeholder="e.g. university finance office"
                value={sourceDraft.collectionAgentName ?? ""}
                onChange={(e) => setSourceDraft({ ...sourceDraft, collectionAgentName: e.target.value })}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Collection model">
                <Select value={sourceDraft.collectionModel} onChange={(v) => setSourceDraft({ ...sourceDraft, collectionModel: v })} options={COLLECTION_MODELS} />
              </Field>
              <Field label="Member disclosure">
                <Select value={sourceDraft.memberDisclosureLevel} onChange={(v) => setSourceDraft({ ...sourceDraft, memberDisclosureLevel: v })} options={MEMBER_DISCLOSURE_LEVELS} />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Collection frequency">
                <Select value={sourceDraft.collectionFrequency} onChange={(v) => setSourceDraft({ ...sourceDraft, collectionFrequency: v })} options={COLLECTION_FREQUENCIES} />
              </Field>
              <Field label="Next expected collection">
                <input
                  className="input"
                  type="date"
                  value={sourceDraft.nextExpectedCollectionDate ?? ""}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, nextExpectedCollectionDate: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Collection schedule" hint="Example: Fall and Winter semesters only; Summer excluded.">
              <textarea
                className="textarea"
                value={sourceDraft.collectionScheduleNotes ?? ""}
                onChange={(e) => setSourceDraft({ ...sourceDraft, collectionScheduleNotes: e.target.value })}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Estimated member count">
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={sourceDraft.estimatedMemberCount ?? ""}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, estimatedMemberCount: e.target.value })}
                />
              </Field>
              <Field label="Reconciliation cadence">
                <input className="input" value={sourceDraft.reconciliationCadence ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, reconciliationCadence: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Expected / year">
                <input className="input" type="number" min="0" step="0.01" value={sourceDraft.expectedAnnualDollars ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, expectedAnnualDollars: e.target.value })} />
              </Field>
              <Field label="Committed">
                <input className="input" type="number" min="0" step="0.01" value={sourceDraft.committedDollars ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, committedDollars: e.target.value })} />
              </Field>
              <Field label="Received to date">
                <input className="input" type="number" min="0" step="0.01" value={sourceDraft.receivedToDateDollars ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, receivedToDateDollars: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Start date">
                <input className="input" type="date" value={sourceDraft.startDate ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, startDate: e.target.value })} />
              </Field>
              <Field label="End date">
                <input className="input" type="date" value={sourceDraft.endDate ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, endDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Restricted purpose">
              <input className="input" value={sourceDraft.restrictedPurpose ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, restrictedPurpose: e.target.value })} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" value={sourceDraft.notes ?? ""} onChange={(e) => setSourceDraft({ ...sourceDraft, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!eventDraft}
        onClose={() => setEventDraft(null)}
        title={eventDraft?.id ? "Edit funding event" : "New funding event"}
        footer={
          <>
            <button className="btn" onClick={() => setEventDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!eventDraft?.sourceId || !eventDraft?.label || !eventDraft?.eventDate}
              onClick={async () => {
                await upsertFundingEvent({
                  id: eventDraft.id,
                  societyId: society._id,
                  sourceId: eventDraft.sourceId,
                  eventDate: eventDraft.eventDate,
                  kind: eventDraft.kind,
                  label: eventDraft.label,
                  amountCents: dollarInputToCents(eventDraft.amountDollars),
                  memberCount: eventDraft.memberCount === "" ? undefined : Number(eventDraft.memberCount),
                  periodStart: eventDraft.periodStart || undefined,
                  periodEnd: eventDraft.periodEnd || undefined,
                  attributionStatus: eventDraft.attributionStatus || undefined,
                  notes: eventDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Funding event saved");
                setEventDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {eventDraft && (
          <div>
            <Field label="Funding source">
              <select className="input" value={eventDraft.sourceId ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, sourceId: e.target.value })}>
                <option value="">Select source</option>
                {(fundingSources ?? []).map((source: any) => (
                  <option key={source._id} value={source._id}>{source.name}</option>
                ))}
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Date">
                <input className="input" type="date" value={eventDraft.eventDate} onChange={(e) => setEventDraft({ ...eventDraft, eventDate: e.target.value })} />
              </Field>
              <Field label="Kind">
                <Select value={eventDraft.kind} onChange={(v) => setEventDraft({ ...eventDraft, kind: v })} options={FUNDING_EVENT_KINDS} />
              </Field>
            </div>
            <Field label="Label">
              <input className="input" value={eventDraft.label} onChange={(e) => setEventDraft({ ...eventDraft, label: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Amount">
                <input className="input" type="number" min="0" step="0.01" value={eventDraft.amountDollars ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, amountDollars: e.target.value })} />
              </Field>
              <Field label="Member count">
                <input className="input" type="number" min="0" value={eventDraft.memberCount ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, memberCount: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Period start">
                <input className="input" type="date" value={eventDraft.periodStart ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, periodStart: e.target.value })} />
              </Field>
              <Field label="Period end">
                <input className="input" type="date" value={eventDraft.periodEnd ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, periodEnd: e.target.value })} />
              </Field>
            </div>
            <Field label="Attribution">
              <Select value={eventDraft.attributionStatus} onChange={(v) => setEventDraft({ ...eventDraft, attributionStatus: v })} options={ATTRIBUTION_STATUSES} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" value={eventDraft.notes ?? ""} onChange={(e) => setEventDraft({ ...eventDraft, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <StudentLevyIntakeDrawer
        open={levyImportOpen}
        onClose={() => setLevyImportOpen(false)}
        societyId={society._id}
        societyName={society.name}
        actingUserId={actingUserId}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <span style={{ color: `var(--${color}, inherit)` }}>{icon}</span>
        <span className="muted">{label}</span>
      </div>
      <div className="mono" style={{ fontSize: "var(--fs-xl, 24px)", marginTop: 4, fontWeight: 600 }}>
        {cents(value)}
      </div>
    </div>
  );
}
