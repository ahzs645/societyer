/**
 * Demo data for banking: money-account details for the Accounts page (plus a
 * manual petty cash account), a receipt inbox with files that match, nearly
 * match and don't match the bank feed, committee spend budgets in every state
 * and the claims charged to them (including mileage claims).
 *
 * Shared by the in-browser demo (src/lib/staticFinanceWorkflowFixtures.ts,
 * fixed string ids) and the server seed (shared/functions/seed.ts, real
 * database ids) through `refs.idFor`, like shared/demoData/financeWorkflows.ts.
 * Inbox receipts are picked from the feed rows passed in, and claim and budget
 * dates are relative to `today`, so both demos tell the same story on any day.
 * Nothing here adds bank lines; the petty cash account has no transactions,
 * so its balance is its opening balance.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import type { DemoFinancePerson, DemoFinanceRefs } from "./financeWorkflows";
import { mileageAmountCents } from "../expensePolicy";

export type DemoBankingRefs = DemoFinanceRefs & {
  connectionId: string;
  /** The committee the finance spend budget belongs to. */
  financeCommitteeId: string;
  /** YYYY-MM-DD; claim and budget dates are relative to it. */
  today: string;
};

type FeedRow = Record<string, unknown> & { _id: string; accountId: string; date: string; amountCents: number };

/** The organisation's configured mileage rate in the demo (not an official rate). */
export const DEMO_MILEAGE_RATE_CENTS = 70;

export const DEMO_PETTY_CASH = { externalId: "petty-cash", code: "1020", openingBalanceCents: 25_000, openingDate: "2026-01-01" } as const;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
/** `days` before today, but never before the first of this month (so it lands in this month's cycle). */
const thisMonth = (today: string, days: number) => {
  const date = addDays(today, -days);
  return date < monthStart(today) ? monthStart(today) : date;
};
const quarterStart = (date: string) => {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
};

export function demoPettyCashAccount(refs: DemoBankingRefs) {
  return {
    _id: refs.idFor("account", "petty_cash"),
    societyId: refs.societyId,
    connectionId: refs.connectionId,
    externalId: DEMO_PETTY_CASH.externalId,
    code: DEMO_PETTY_CASH.code,
    name: "Petty cash",
    currency: "CAD",
    accountType: "Bank",
    subtype: "cash",
    balanceCents: DEMO_PETTY_CASH.openingBalanceCents,
    isRestricted: false,
    sourceSystem: "societyer",
    normalBalance: "debit",
  };
}

export function demoBankAccountProfiles(refs: DemoBankingRefs) {
  const at = "2026-01-02T17:00:00.000Z";
  const base = { societyId: refs.societyId, createdAtISO: at, updatedAtISO: at };
  return [
    { _id: refs.idFor("accountProfile", "operating"), ...base, accountId: refs.cashAccountId, institution: "Riverbank Credit Union", lastFour: "4821" },
    { _id: refs.idFor("accountProfile", "restricted"), ...base, accountId: refs.grantAccountId, institution: "Riverbank Credit Union", lastFour: "4839" },
    { _id: refs.idFor("accountProfile", "card"), ...base, accountId: refs.cardAccountId, institution: "Riverbank Credit Union", lastFour: "4417" },
    {
      _id: refs.idFor("accountProfile", "petty_cash"),
      ...base,
      accountId: refs.idFor("account", "petty_cash"),
      origin: "manual",
      openingBalanceCents: DEMO_PETTY_CASH.openingBalanceCents,
      openingDate: DEMO_PETTY_CASH.openingDate,
    },
  ];
}

const hyphenate = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Receipt files and their inbox rows: two that match a feed line missing its
 * receipt exactly, one named only by merchant and date (to pick among
 * candidates), and a phone photo with nothing to go on.
 */
export function demoReceiptInbox(refs: DemoBankingRefs, feed: readonly FeedRow[]) {
  const accounts = new Set([refs.cashAccountId, refs.cardAccountId]);
  const outflows = feed
    .filter((row) => accounts.has(row.accountId) && row.amountCents < 0 && !row.receiptDocumentId && row.status !== "pending")
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.externalId ?? "").localeCompare(String(b.externalId ?? "")));
  const missing = outflows.filter((row) => row.receiptStatus === "missing").slice(0, 2);
  const hydro = outflows.find((row) => /coastal hydro/i.test(String(row.counterparty ?? "")) && !missing.includes(row));
  const createdAtISO = `${refs.today}T15:30:00.000Z`;
  const files: Array<{ key: string; fileName: string; mimeType: string; merchant?: string; amountCents?: number; date?: string }> = [
    ...missing.map((row, index) => {
      const date = addDays(row.date, -1);
      const amount = (Math.abs(row.amountCents) / 100).toFixed(2);
      return { key: `exact_${index + 1}`, fileName: `${date}_${hyphenate(String(row.counterparty ?? row.description))}_${amount}.pdf`, mimeType: "application/pdf", merchant: String(row.counterparty ?? row.description), amountCents: Math.abs(row.amountCents), date };
    }),
    ...(hydro ? [{ key: "hydro", fileName: `coastal-hydro-bill-${hydro.date}.pdf`, mimeType: "application/pdf", merchant: "Coastal Hydro", date: hydro.date }] : []),
    { key: "photo", fileName: "IMG_2041.jpg", mimeType: "image/jpeg" },
  ];
  const documents = files.map((file) => ({
    _id: refs.idFor("receiptDocument", file.key),
    societyId: refs.societyId,
    title: `Receipt: ${file.fileName}`,
    category: "Receipt",
    fileName: file.fileName,
    mimeType: file.mimeType,
    retentionYears: 7,
    librarySection: "finance",
    flaggedForDeletion: false,
    tags: ["receipt", "inbox"],
    createdAtISO,
  }));
  const items = files.map((file) => ({
    _id: refs.idFor("receiptInbox", file.key),
    societyId: refs.societyId,
    documentId: refs.idFor("receiptDocument", file.key),
    fileName: file.fileName,
    ...(file.merchant ? { merchant: file.merchant } : {}),
    ...(file.amountCents ? { amountCents: file.amountCents } : {}),
    ...(file.date ? { date: file.date } : {}),
    status: "unmatched",
    uploadedByUserId: refs.treasurer.id,
    uploadedByName: refs.treasurer.name,
    createdAtISO,
    updatedAtISO: createdAtISO,
  }));
  return { documents, items };
}

export const DEMO_SPEND_BUDGET_KEYS = {
  finance: "finance_committee",
  mileage: "volunteer_mileage",
  youth: "youth_supplies",
  agm: "agm_hospitality",
  plantSale: "plant_sale",
} as const;

export function demoSpendBudgets(refs: DemoBankingRefs) {
  const id = (key: string) => refs.idFor("spendBudget", key);
  const at = "2026-01-02T18:00:00.000Z";
  const base = { societyId: refs.societyId, currency: "CAD", createdByUserId: refs.owner.id, createdAtISO: at, updatedAtISO: at };
  const nextMonth = `${addDays(monthStart(refs.today), 32).slice(0, 7)}-01`;
  return [
    { _id: id(DEMO_SPEND_BUDGET_KEYS.finance), ...base, name: "Finance committee expenses", limitCents: 30_000, cycle: "monthly", startDate: "2026-01-01", committeeId: refs.financeCommitteeId, memberUserIds: [], notes: "Meeting refreshments, printing and statement binders." },
    { _id: id(DEMO_SPEND_BUDGET_KEYS.mileage), ...base, name: "Volunteer mileage", limitCents: 25_000, cycle: "monthly", startDate: "2026-01-01", memberUserIds: [refs.treasurer.id, refs.secretary.id], notes: "Food bank pickups and site visits, at the organisation's mileage rate." },
    { _id: id(DEMO_SPEND_BUDGET_KEYS.youth), ...base, name: "Youth program supplies", limitCents: 60_000, cycle: "quarterly", startDate: "2026-01-01", memberUserIds: [refs.owner.id, refs.secretary.id] },
    { _id: id(DEMO_SPEND_BUDGET_KEYS.agm), ...base, name: "AGM hospitality", limitCents: 80_000, cycle: "once", startDate: nextMonth, endDate: addDays(nextMonth, 59), memberUserIds: [refs.owner.id], notes: "Venue snacks and coffee for the annual general meeting." },
    { _id: id(DEMO_SPEND_BUDGET_KEYS.plantSale), ...base, name: "Spring plant sale", limitCents: 40_000, cycle: "once", startDate: addDays(monthStart(refs.today), -150), endDate: addDays(monthStart(refs.today), -90), memberUserIds: [refs.secretary.id] },
  ];
}

/**
 * Claims charged to the spend budgets: committee expenses (one draft that
 * would take the budget over its limit), mileage claims at the demo rate, and
 * program supplies. Dated inside the current cycle.
 */
export function demoSpendBudgetClaims(refs: DemoBankingRefs) {
  const budget = (key: string) => refs.idFor("spendBudget", key);
  const vote = (p: DemoFinancePerson, atISO: string) => ({ userId: p.id, name: p.name, role: p.role, atISO });
  const step = (p: DemoFinancePerson, action: string, atISO: string, note?: string) => ({ atISO, action, actorName: p.name, actorUserId: p.id, ...(note ? { note } : {}) });
  const claim = (key: string, p: DemoFinancePerson, fields: Record<string, unknown> & { incurredAtISO: string; submittedAtISO?: string }) => ({
    _id: refs.idFor("expense", key),
    societyId: refs.societyId,
    claimantName: p.name,
    claimantUserId: p.id,
    currency: "CAD",
    createdAtISO: `${fields.incurredAtISO}T16:00:00.000Z`,
    updatedAtISO: `${fields.submittedAtISO ?? fields.incurredAtISO}T16:00:00.000Z`,
    ...fields,
  });
  const mileage = (distanceKm: number, fromLocation: string, toLocation: string, tripDescription: string) => ({
    claimType: "mileage",
    category: "Travel",
    mileage: { distanceKm, rateCentsPerKm: DEMO_MILEAGE_RATE_CENTS, fromLocation, toLocation, tripDescription },
    amountCents: mileageAmountCents(distanceKm, DEMO_MILEAGE_RATE_CENTS),
  });
  const t = refs.today;
  const refreshments = thisMonth(t, 9);
  const binders = thisMonth(t, 4);
  const visit = thisMonth(t, 6);
  const pickups = thisMonth(t, 3);
  const supplies = (() => {
    const date = addDays(t, -12);
    return date < quarterStart(t) ? quarterStart(t) : date;
  })();
  return [
    claim("finance_refreshments", refs.treasurer, {
      title: "Finance committee meeting refreshments",
      category: "Meals",
      amountCents: 8_640,
      incurredAtISO: refreshments,
      submittedAtISO: refreshments,
      status: "Paid",
      requiredApprovals: 1,
      approvals: [vote(refs.owner, `${refreshments}T19:00:00.000Z`)],
      approvedAtISO: `${refreshments}T19:00:00.000Z`,
      paidAtISO: `${refreshments}T21:00:00.000Z`,
      paymentReference: "e-Transfer CA8841",
      receiptDocumentId: refs.receiptDocumentId,
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.finance),
      approvalTrail: [step(refs.treasurer, "submitted", `${refreshments}T16:00:00.000Z`), step(refs.owner, "approved", `${refreshments}T19:00:00.000Z`), step(refs.owner, "paid", `${refreshments}T21:00:00.000Z`, "e-Transfer CA8841")],
    }),
    claim("finance_binders", refs.treasurer, {
      title: "Statement binders and printing",
      category: "Supplies",
      amountCents: 14_200,
      incurredAtISO: binders,
      submittedAtISO: binders,
      status: "Submitted",
      requiredApprovals: 1,
      approvals: [],
      notes: "Board packages for the quarterly financial review.",
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.finance),
      approvalTrail: [step(refs.treasurer, "submitted", `${binders}T16:00:00.000Z`)],
    }),
    // Would take the committee budget past its limit if submitted.
    claim("finance_software", refs.treasurer, {
      title: "Statement software, annual plan",
      category: "Office & technology",
      amountCents: 9_500,
      incurredAtISO: thisMonth(t, 1),
      status: "Draft",
      notes: "Renewal for the tool the committee uses to prepare monthly statements.",
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.finance),
    }),
    claim("mileage_site_visit", refs.treasurer, {
      title: "Mileage – community garden site visit",
      ...mileage(42, "Riverside Community Hall", "Eastside Community Garden", "Site visit with the garden committee before the fall planting grant."),
      incurredAtISO: visit,
      submittedAtISO: visit,
      status: "Submitted",
      requiredApprovals: 1,
      approvals: [],
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.mileage),
      approvalTrail: [step(refs.treasurer, "submitted", `${visit}T16:00:00.000Z`)],
    }),
    claim("mileage_food_bank", refs.secretary, {
      title: "Mileage – food bank pickups",
      ...mileage(25, "Riverside Community Hall", "Harbour Food Bank", "Two pickups for the summer meal program."),
      incurredAtISO: pickups,
      submittedAtISO: pickups,
      status: "Approved",
      requiredApprovals: 1,
      approvals: [vote(refs.owner, `${pickups}T20:00:00.000Z`)],
      approvedAtISO: `${pickups}T20:00:00.000Z`,
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.mileage),
      approvalTrail: [step(refs.secretary, "submitted", `${pickups}T16:00:00.000Z`), step(refs.owner, "approved", `${pickups}T20:00:00.000Z`)],
    }),
    claim("mileage_draft", refs.secretary, {
      title: "Mileage – volunteer orientation",
      ...mileage(18.5, "Riverside Community Hall", "Northshore Library", "Dropped off orientation kits."),
      incurredAtISO: thisMonth(t, 0),
      status: "Draft",
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.mileage),
    }),
    claim("youth_craft_supplies", refs.owner, {
      title: "Craft supplies for the youth drop-in",
      category: "Supplies",
      amountCents: 26_875,
      incurredAtISO: supplies,
      submittedAtISO: supplies,
      status: "Approved",
      requiredApprovals: 1,
      approvals: [vote(refs.secretary, `${supplies}T20:00:00.000Z`)],
      approvedAtISO: `${supplies}T20:00:00.000Z`,
      receiptDocumentId: refs.receiptDocumentId,
      spendBudgetId: budget(DEMO_SPEND_BUDGET_KEYS.youth),
      approvalTrail: [step(refs.owner, "submitted", `${supplies}T16:00:00.000Z`), step(refs.secretary, "approved", `${supplies}T20:00:00.000Z`)],
    }),
  ];
}
