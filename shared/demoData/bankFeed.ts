/**
 * Deterministic bank feed for the demo society (Riverside Community Society).
 *
 * Produces about a year and a half of transactions across three money
 * accounts: operating chequing, the restricted programs fund and the
 * organization Visa card. The shape follows how a small BC society's books
 * actually move:
 *
 *  - recurring monthly items on fixed days (hall rent, semi-monthly payroll and
 *    the CRA source-deduction remittance, utilities, telecom, insurance
 *    instalments, bookkeeping, software on the card, bank fee and interest);
 *  - member dues by e-transfer clustered in the April-May renewal season, plus
 *    joiners through the year (payers come from the member register);
 *  - weekly online-donation payouts and fortnightly program-registration
 *    payouts, each with a monthly processor-fee debit, seasonal peaks in
 *    November-December (giving) and September/January (program sign-up);
 *  - a fall gala (ticket payouts, sponsorship cheques, venue and catering) and
 *    a spring plant sale;
 *  - quarterly grant disbursements into the restricted fund and program
 *    delivery spending out of it;
 *  - card purchases for programs, food, travel and the office, a monthly card
 *    payment from chequing (category "Transfer" so statements skip it), a
 *    supplier refund and a duplicate-charge reversal;
 *  - the last few days are pending, recent rows are partly uncategorised
 *    ("To review") or missing receipts, and some rows carry memo notes.
 *
 * Every random choice comes from a PRNG seeded by (stream, month), so a month
 * renders identically whenever it is generated; only `asOf` decides how far
 * the feed runs and which recent rows are still pending. Counterparty names
 * are fictional. Pure TypeScript: no Convex, DOM or Node imports.
 */

import { TRANSFER_CATEGORY } from "../transferCategories";
import { addDays, createRng, dayOfMonth, daysBetween, daysInMonth, monthKeys, nextBusinessDay, weekday } from "./prng";

export const DEMO_TRANSFER_CATEGORY = TRANSFER_CATEGORY;

export type DemoFeedAccountKey = "operating" | "restricted" | "card";

export type DemoFeedRow = {
  /** Stable, unique key (used to build ids). */
  key: string;
  account: DemoFeedAccountKey;
  date: string;
  /** What the bank shows first: the payee or payer. */
  description: string;
  counterparty: string;
  amountCents: number;
  /** Undefined = not yet categorised ("To review"). */
  category?: string;
  method: string;
  memo?: string;
  receiptStatus?: "attached" | "missing";
  status: "posted" | "pending";
};

export type DemoDuesPayment = { name: string; date: string; amountCents: number; memo?: string };

export type DemoFixedRow = { account: DemoFeedAccountKey; date: string; amountCents: number; category?: string };

export type DemoFeedOptions = {
  /** First day of the feed (YYYY-MM-DD). */
  start: string;
  /** The demo's "today": nothing is generated after it. */
  asOf: string;
  /** Member dues paid by e-transfer (already dated). */
  duesPayments: DemoDuesPayment[];
  /** Names that send one-off e-transfer gifts. */
  donorNames: string[];
  /** Reviewer/auditor firm that bills the annual review engagement. */
  auditorName: string;
  /** Last four digits shown for the organization card. */
  cardLast4: string;
  /** Generated row keys to leave out because a fixed row already covers them. */
  skipKeys?: string[];
  /** Rows that exist outside the generator but count toward balances and totals. */
  fixedRows?: DemoFixedRow[];
  /** Bank balances to hit at the end of a date (sets each opening balance). */
  balanceAt?: { date: string; operating: number; restricted: number };
  /**
   * Revenue and expense totals (excluding transfers, all accounts) that the
   * fiscal year must add up to, e.g. the board-approved statements. Two
   * calibration rows (a major operating gift and the review engagement fee)
   * absorb the difference.
   */
  fiscalTarget?: { start: string; end: string; revenueCents: number; expenseCents: number };
};

export type DemoFeed = {
  rows: DemoFeedRow[];
  /** Balance of each account at the start of `start`. */
  openingBalances: Record<DemoFeedAccountKey, number>;
  /** Balance of each account at the end of `asOf` (opening + every row). */
  balances: Record<DemoFeedAccountKey, number>;
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthName(monthKey: string) {
  return MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];
}

function previousMonth(monthKey: string) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function monthNumber(monthKey: string) {
  return Number(monthKey.slice(5, 7));
}

/** Last business day on or before the end of the month. */
function lastBusinessDay(monthKey: string) {
  let date = dayOfMonth(monthKey, daysInMonth(monthKey));
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, -1);
  return date;
}

/** Business day on or before `iso` (payroll is paid early, never late). */
function businessDayOnOrBefore(iso: string) {
  let date = iso;
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, -1);
  return date;
}

/** Every date in the month falling on `day` (0 = Sunday). */
function weekdaysInMonth(monthKey: string, day: number) {
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth(monthKey); d += 1) {
    const iso = dayOfMonth(monthKey, d);
    if (weekday(iso) === day) dates.push(iso);
  }
  return dates;
}

// Seasonal multipliers indexed by month number (1-12).
const GIVING_SEASON = [0, 1.15, 0.8, 0.9, 0.95, 1.25, 0.85, 0.7, 0.75, 0.95, 1.05, 1.5, 2.6];
const PROGRAM_SEASON = [0, 1.55, 1.05, 0.95, 1.15, 1.0, 0.85, 0.55, 0.5, 1.7, 1.15, 1.05, 0.7];
const HEATING_SEASON = [0, 1.9, 1.7, 1.4, 1.0, 0.7, 0.5, 0.45, 0.45, 0.6, 1.0, 1.5, 1.9];
const PROGRAM_DELIVERY_SEASON = [0, 1.1, 1.1, 1.2, 1.1, 1.0, 0.8, 0.5, 0.45, 1.1, 1.15, 1.1, 0.7];

type CardMerchant = {
  name: string;
  category: string;
  min: number;
  max: number;
  weight: number;
  memos: string[];
};

const CARD_MERCHANTS: CardMerchant[] = [
  { name: "Brushstroke Art Supply", category: "Program supplies", min: 38, max: 240, weight: 3, memos: ["Paint and brushes for Thursday studio", "Canvas boards for the youth cohort", "Clay for the family drop-in"] },
  { name: "Greenway Market", category: "Program supplies", min: 32, max: 190, weight: 4, memos: ["Snacks for youth drop-in", "Community dinner ingredients", "Community fridge restock"] },
  { name: "Little Fig Bakery", category: "Program supplies", min: 18, max: 78, weight: 2, memos: ["Volunteer appreciation treats", "Board meeting refreshments"] },
  { name: "Pho Garden", category: "Program supplies", min: 45, max: 165, weight: 1, memos: ["Mentor dinner", "Cohort wrap-up meal"] },
  { name: "Maple Office Supply", category: "Office & technology", min: 22, max: 165, weight: 2, memos: ["Printer toner", "Sign-in sheets and folders"] },
  { name: "Hillcrest Hardware", category: "Facilities", min: 16, max: 145, weight: 2, memos: ["Hooks and shelving for storage room", "Replacement bulbs for the hall"] },
  { name: "Metro Transit fares", category: "Travel", min: 3, max: 42, weight: 2, memos: ["Fares for youth field trip", "Staff travel to funder meeting"] },
  { name: "Coastline Ferries", category: "Travel", min: 58, max: 128, weight: 0.4, memos: ["Sector conference travel"] },
];

const CARD_SUBSCRIPTIONS = [
  { key: "workspace", name: "Cloudnest Workspace", day: 2, cents: 4800, category: "Office & technology", memo: "6 staff and board seats" },
  { key: "ledger-software", name: "Ledgerline Software", day: 7, cents: 4200, category: "Office & technology", memo: "Bookkeeping software" },
  { key: "design", name: "Pixelpress Design", day: 16, cents: 1699, category: "Office & technology", memo: undefined },
];

const RESTRICTED_VENDORS = [
  { name: "Youth Arts Collective", min: 1250, max: 2700, method: "Online banking", memos: ["Facilitator honoraria, spring cohort", "Studio facilitation, fall cohort", "Showcase production costs"] },
  { name: "Riverside Mentors Network", min: 780, max: 1950, method: "Cheque", memos: ["Mentor stipends", "Mentor training session"] },
  { name: "Greenway Market", min: 480, max: 1300, method: "Online banking", memos: ["Bulk food for community meals", "Food security program purchases"] },
];

const CHEQUE_DONORS = ["Grandview Neighbours Fund", "Harbourside Dental Group", "Brightline Realty", "Eastside Credit Workers Local 12", "Kettle Street Cafe"];

const ETRANSFER_GIFT_MEMOS = ["Monthly gift", "Fall appeal", "In honour of a volunteer", "Community fridge", undefined, undefined];

/** Net pay sent in a month's semi-monthly payroll run (index 0: mid-month, 1: month end). */
export function demoNetPayCents(monthKey: string, index: number): number {
  return createRng(`payroll:${monthKey}:${index}`).cents(2380, 2470);
}

/** The CRA source-deduction remittance paid in `monthKey` (for the previous month's payroll). */
export function demoRemittanceCents(monthKey: string): number {
  return createRng(`remittance:${monthKey}`).cents(1250, 1310);
}

export function buildDemoBankFeed(options: DemoFeedOptions): DemoFeed {
  const { start, asOf } = options;
  const skip = new Set(options.skipKeys ?? []);
  const rows: DemoFeedRow[] = [];
  const card = `Visa ••${options.cardLast4}`;
  const months = monthKeys(start, asOf);

  const push = (row: Omit<DemoFeedRow, "status"> & { status?: DemoFeedRow["status"] }) => {
    if (row.date < start || row.date > asOf || skip.has(row.key)) return;
    rows.push({ status: "posted", ...row });
  };

  for (const m of months) {
    const mn = monthNumber(m);
    const label = `${monthName(m)} ${m.slice(0, 4)}`;

    // --- Operating chequing: fixed monthly obligations -------------------
    push({ key: `rent-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 1)), description: "Community Hall Association", counterparty: "Community Hall Association", amountCents: -180000, category: "Facilities", method: "Pre-authorized debit", memo: mn % 3 === 1 ? `${monthName(m)} rent: main hall and two program rooms` : undefined });
    push({ key: `insurance-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 3)), description: "Tidewater Mutual Insurance", counterparty: "Tidewater Mutual Insurance", amountCents: -41750, category: "Insurance", method: "Pre-authorized debit", memo: mn === 4 ? "Liability and D&O package, instalment 1 of 12" : undefined });
    {
      const rng = createRng(`bookkeeping:${m}`);
      push({ key: `bookkeeping-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 5)), description: "Cedar & Pine Bookkeeping", counterparty: "Cedar & Pine Bookkeeping", amountCents: -47250, category: "Professional fees", method: "Online banking", receiptStatus: rng.chance(0.12) ? "missing" : "attached", memo: `${monthName(previousMonth(m))} bookkeeping and payroll review` });
    }
    {
      const rng = createRng(`gas:${m}`);
      push({ key: `gas-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 12)), description: "Northshore Gas Co-op", counterparty: "Northshore Gas Co-op", amountCents: -Math.round(rng.cents(52, 68) * HEATING_SEASON[mn]), category: "Facilities", method: "Pre-authorized debit" });
    }
    if (mn % 2 === 0) {
      const rng = createRng(`hydro:${m}`);
      push({ key: `hydro-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 9)), description: "Coastal Hydro", counterparty: "Coastal Hydro", amountCents: -Math.round(rng.cents(150, 180) * (0.75 + HEATING_SEASON[mn] / 4)), category: "Facilities", method: "Pre-authorized debit", memo: "Two-month billing, office and storage room" });
    }
    push({ key: `telecom-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 18)), description: "Harbourline Telecom", counterparty: "Harbourline Telecom", amountCents: -8960, category: "Office & technology", method: "Pre-authorized debit", receiptStatus: "attached" });

    // Payroll: semi-monthly net pay, the payroll service fee and the CRA
    // source-deduction remittance for the previous month.
    for (const [index, day] of [15, daysInMonth(m)].entries()) {
      const date = businessDayOnOrBefore(dayOfMonth(m, day));
      push({ key: `payroll-${m}-${index}`, account: "operating", date, description: "Brightwave Payroll", counterparty: "Brightwave Payroll", amountCents: -demoNetPayCents(m, index), category: "Wages & benefits", method: "Payroll direct deposit", memo: index === 0 && mn % 4 === 0 ? `Net pay, period ending ${date}` : undefined });
    }
    {
      push({ key: `remittance-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 14)), description: "CRA source deductions", counterparty: "Canada Revenue Agency", amountCents: -demoRemittanceCents(m), category: "Wages & benefits", method: "Online banking", memo: `Remittance for ${monthName(previousMonth(m))}` });
    }

    // Bank fee and interest on the last business day.
    {
      const rng = createRng(`interest:${m}`);
      const eom = lastBusinessDay(m);
      push({ key: `bank-fee-${m}`, account: "operating", date: eom, description: "Riverbank Credit Union", counterparty: "Riverbank Credit Union", amountCents: -1250, category: "Bank & processing fees", method: "Account fee", memo: "Monthly account fee" });
      push({ key: `interest-${m}`, account: "operating", date: eom, description: "Riverbank Credit Union", counterparty: "Riverbank Credit Union", amountCents: rng.cents(14, 41), category: "Interest & other", method: "Interest" });
    }

    // --- Online donations: weekly payouts + monthly processor fee ----------
    let donationGross = 0;
    for (const [index, date] of weekdaysInMonth(m, 2).entries()) {
      const rng = createRng(`donations:${m}:${index}`);
      const amount = Math.round(rng.cents(360, 1150) * GIVING_SEASON[mn]);
      donationGross += date <= asOf ? amount : 0;
      const gifts = Math.max(3, Math.round(amount / 5200));
      push({ key: `donations-${m}-${index}`, account: "operating", date, description: "DonorLoop Payments", counterparty: "DonorLoop Payments", amountCents: amount, category: "Donations", method: "Deposit", memo: rng.chance(0.25) ? `Weekly online gifts (${gifts})` : undefined });
    }
    // --- Program registrations: fortnightly Friday payouts -----------------
    let registrationGross = 0;
    for (const [index, date] of weekdaysInMonth(m, 5).entries()) {
      if (index % 2 === 1) continue;
      const rng = createRng(`registrations:${m}:${index}`);
      const amount = Math.round(rng.cents(1050, 1900) * PROGRAM_SEASON[mn]);
      registrationGross += date <= asOf ? amount : 0;
      push({ key: `registrations-${m}-${index}`, account: "operating", date, description: "Fieldhouse Registrations", counterparty: "Fieldhouse Registrations", amountCents: amount, category: "Program fees", method: "Deposit", memo: mn === 9 || mn === 1 ? "Term sign-ups" : undefined });
    }
    {
      const date = lastBusinessDay(m);
      if (donationGross > 0) push({ key: `donation-fees-${m}`, account: "operating", date, description: "DonorLoop Payments", counterparty: "DonorLoop Payments", amountCents: -Math.round(donationGross * 0.024), category: "Bank & processing fees", method: "Processor fee", receiptStatus: "attached", memo: "Monthly processing fees" });
      if (registrationGross > 0) push({ key: `registration-fees-${m}`, account: "operating", date, description: "Fieldhouse Registrations", counterparty: "Fieldhouse Registrations", amountCents: -Math.round(registrationGross * 0.029), category: "Bank & processing fees", method: "Processor fee", receiptStatus: "attached", memo: "Monthly processing fees" });
    }

    // --- One-off e-transfer gifts and cheque deposits ----------------------
    {
      const rng = createRng(`etransfer-gifts:${m}`);
      const count = rng.int(0, mn === 12 ? 4 : 2);
      for (let index = 0; index < count && options.donorNames.length; index += 1) {
        const name = rng.pick(options.donorNames);
        push({ key: `gift-${m}-${index}`, account: "operating", date: dayOfMonth(m, rng.int(1, daysInMonth(m))), description: name, counterparty: name, amountCents: rng.pick([2000, 2500, 5000, 5000, 10000, 15000, 25000]), category: "Donations", method: "Interac e-Transfer", memo: rng.pick(ETRANSFER_GIFT_MEMOS) });
      }
      if (rng.chance(0.55)) {
        const donor = rng.pick(CHEQUE_DONORS);
        push({ key: `cheque-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, rng.int(3, 26))), description: donor, counterparty: donor, amountCents: rng.pick([25000, 50000, 75000, 100000]), category: "Donations", method: "Cheque deposit" });
      }
    }

    // --- Advertising each quarter -----------------------------------------
    if (mn % 3 === 2) {
      const rng = createRng(`advertising:${m}`);
      push({ key: `advertising-${m}`, account: "operating", date: nextBusinessDay(dayOfMonth(m, 10)), description: "Eastside Community News", counterparty: "Eastside Community News", amountCents: -rng.cents(260, 420), category: "Advertising", method: "Online banking", receiptStatus: "attached", memo: "Program listings, quarter page" });
    }

    // --- Restricted fund: grants in, program delivery out ------------------
    if (mn % 3 === 1) {
      push({ key: `grant-harbour-${m}`, account: "restricted", date: nextBusinessDay(dayOfMonth(m, 15)), description: "Harbour Foundation", counterparty: "Harbour Foundation", amountCents: 1100000, category: "Grant revenue", method: "Wire", memo: `Quarterly disbursement, ${label}` });
    }
    if (mn === 6 || mn === 12) {
      push({ key: `grant-eastside-${m}`, account: "restricted", date: nextBusinessDay(dayOfMonth(m, 20)), description: "Eastside Community Fund", counterparty: "Eastside Community Fund", amountCents: 450000, category: "Grant revenue", method: "Wire", memo: "Food security program, semi-annual" });
    }
    {
      const rng = createRng(`restricted:${m}`);
      for (const [index, vendor] of RESTRICTED_VENDORS.entries()) {
        if (index > 0 && !rng.chance(0.7)) continue;
        push({ key: `program-${m}-${index}`, account: "restricted", date: nextBusinessDay(dayOfMonth(m, 6 + index * 8 + rng.int(0, 4))), description: vendor.name, counterparty: vendor.name, amountCents: -Math.round(rng.cents(vendor.min, vendor.max) * PROGRAM_DELIVERY_SEASON[mn]), category: "Program delivery", method: vendor.method, receiptStatus: rng.chance(0.08) ? "missing" : "attached", memo: rng.chance(0.5) ? rng.pick(vendor.memos) : undefined });
      }
    }

    // --- Organization Visa -------------------------------------------------
    for (const sub of CARD_SUBSCRIPTIONS) {
      push({ key: `card-${sub.key}-${m}`, account: "card", date: dayOfMonth(m, sub.day), description: sub.name, counterparty: sub.name, amountCents: -sub.cents, category: sub.category, method: card, receiptStatus: "attached", memo: sub.memo });
    }
    {
      const rng = createRng(`card:${m}`);
      const purchases = Math.round(rng.int(3, 6) * (mn === 7 || mn === 8 ? 0.6 : 1));
      const totalWeight = CARD_MERCHANTS.reduce((sum, merchant) => sum + merchant.weight, 0);
      for (let index = 0; index < purchases; index += 1) {
        let roll = rng.next() * totalWeight;
        const merchant = CARD_MERCHANTS.find((candidate) => (roll -= candidate.weight) < 0) ?? CARD_MERCHANTS[0];
        push({ key: `card-${m}-${index}`, account: "card", date: dayOfMonth(m, rng.int(1, daysInMonth(m))), description: merchant.name, counterparty: merchant.name, amountCents: -rng.cents(merchant.min, merchant.max), category: merchant.category, method: card, receiptStatus: rng.chance(0.07) ? "missing" : "attached", memo: rng.chance(0.3) ? rng.pick(merchant.memos) : undefined });
      }
    }
  }

  // --- Seasonal fundraising -------------------------------------------------
  for (const year of [Number(start.slice(0, 4)), Number(start.slice(0, 4)) + 1, Number(start.slice(0, 4)) + 2]) {
    const rng = createRng(`gala:${year}`);
    // Fall gala on the second Saturday of November.
    const galaDay = weekdaysInMonth(`${year}-11`, 6)[1];
    push({ key: `gala-venue-deposit-${year}`, account: "operating", date: nextBusinessDay(`${year}-08-12`), description: "Waterfront Event Hall", counterparty: "Waterfront Event Hall", amountCents: -150000, category: "Fundraising costs", method: "Online banking", receiptStatus: "attached", memo: "Fall gala venue deposit" });
    for (let index = 0; index < 6; index += 1) {
      const date = addDays(galaDay, -38 + index * 7);
      push({ key: `gala-tickets-${year}-${index}`, account: "operating", date: nextBusinessDay(date), description: "Ticketbay", counterparty: "Ticketbay", amountCents: Math.round(rng.cents(1400, 2600) * (index >= 3 ? 1.5 : 1)), category: "Fundraising", method: "Deposit", memo: index === 0 ? "Fall gala early-bird tickets" : undefined });
    }
    push({ key: `gala-sponsor-a-${year}`, account: "operating", date: nextBusinessDay(addDays(galaDay, -30)), description: "Harbourside Dental Group", counterparty: "Harbourside Dental Group", amountCents: 250000, category: "Fundraising", method: "Cheque deposit", memo: "Gala presenting sponsor" });
    push({ key: `gala-sponsor-b-${year}`, account: "operating", date: nextBusinessDay(addDays(galaDay, -21)), description: "Brightline Realty", counterparty: "Brightline Realty", amountCents: 150000, category: "Fundraising", method: "Cheque deposit", memo: "Gala table sponsor" });
    push({ key: `gala-decor-${year}`, account: "card", date: addDays(galaDay, -5), description: "Lantern & Co. Decor", counterparty: "Lantern & Co. Decor", amountCents: -rng.cents(420, 640), category: "Fundraising costs", method: card, receiptStatus: "attached", memo: "Gala table decor" });
    push({ key: `gala-venue-balance-${year}`, account: "operating", date: nextBusinessDay(addDays(galaDay, 3)), description: "Waterfront Event Hall", counterparty: "Waterfront Event Hall", amountCents: -285000, category: "Fundraising costs", method: "Online banking", receiptStatus: "attached", memo: "Fall gala venue balance" });
    push({ key: `gala-catering-${year}`, account: "operating", date: nextBusinessDay(addDays(galaDay, 6)), description: "Saffron Table Catering", counterparty: "Saffron Table Catering", amountCents: -rng.cents(3900, 4400), category: "Fundraising costs", method: "Online banking", receiptStatus: "attached", memo: "Gala dinner for 140" });

    // Spring plant sale on the second Saturday of May.
    const saleDay = weekdaysInMonth(`${year}-05`, 6)[1];
    push({ key: `plant-nursery-${year}`, account: "card", date: addDays(saleDay, -16), description: "Fernbrook Nursery", counterparty: "Fernbrook Nursery", amountCents: -rng.cents(880, 1020), category: "Fundraising costs", method: card, receiptStatus: "attached", memo: "Plant sale stock" });
    push({ key: `plant-cash-${year}`, account: "operating", date: nextBusinessDay(addDays(saleDay, 2)), description: "Plant sale cash deposit", counterparty: "Spring plant sale", amountCents: rng.cents(2700, 3500), category: "Fundraising", method: "Branch deposit", memo: "Cash float returned separately" });
    push({ key: `plant-tap-${year}`, account: "operating", date: nextBusinessDay(addDays(saleDay, 3)), description: "Tapline", counterparty: "Tapline", amountCents: rng.cents(950, 1350), category: "Fundraising", method: "Deposit", memo: "Card reader sales, plant sale" });
  }

  // --- Member dues by e-transfer ---------------------------------------------
  for (const [index, payment] of options.duesPayments.entries()) {
    push({ key: `dues-${payment.date}-${index}`, account: "operating", date: payment.date, description: payment.name, counterparty: payment.name, amountCents: payment.amountCents, category: "Membership fees", method: "Interac e-Transfer", memo: payment.memo });
  }

  // --- A refund and a duplicate-charge reversal on the card -----------------
  push({ key: "card-refund-2025-08", account: "card", date: "2025-08-21", description: "Maple Office Supply", counterparty: "Maple Office Supply", amountCents: 6498, category: "Refunds", method: card, memo: "Returned unopened toner" });
  push({ key: "card-duplicate-2026-02", account: "card", date: "2026-02-11", description: "Brushstroke Art Supply", counterparty: "Brushstroke Art Supply", amountCents: -18640, category: "Program supplies", method: card, receiptStatus: "attached", memo: "Charged twice at the till" });
  push({ key: "card-reversal-2026-02", account: "card", date: "2026-02-13", description: "Brushstroke Art Supply", counterparty: "Brushstroke Art Supply", amountCents: 18640, category: "Refunds", method: card, memo: "Reversal of duplicate charge" });
  push({ key: "card-refund-2026-07", account: "card", date: "2026-07-09", description: "Hillcrest Hardware", counterparty: "Hillcrest Hardware", amountCents: 4215, category: "Refunds", method: card, memo: "Returned shelving brackets" });

  // --- Calibration to the approved fiscal-year statements --------------------
  const isTransfer = (row: { category?: string }) => row.category === DEMO_TRANSFER_CATEGORY;
  if (options.fiscalTarget) {
    const { start: fyStart, end: fyEnd, revenueCents, expenseCents } = options.fiscalTarget;
    const inFy = [...rows, ...(options.fixedRows ?? [])].filter((row) => row.date >= fyStart && row.date <= fyEnd && !isTransfer(row));
    const revenue = inFy.filter((row) => row.amountCents > 0).reduce((sum, row) => sum + row.amountCents, 0);
    const expense = inFy.filter((row) => row.amountCents < 0).reduce((sum, row) => sum - row.amountCents, 0);
    const giftCents = revenueCents - revenue;
    const reviewCents = expenseCents - expense;
    if (giftCents > 0) {
      push({ key: `operating-gift-${fyEnd}`, account: "operating", date: nextBusinessDay(addDays(fyEnd, -10)), description: "Grandview Neighbours Fund", counterparty: "Grandview Neighbours Fund", amountCents: giftCents, category: "Donations", method: "Cheque deposit", memo: "Annual operating gift" });
    }
    if (reviewCents > 0) {
      push({ key: `review-engagement-${fyEnd}`, account: "operating", date: nextBusinessDay(addDays(fyStart, 182)), description: options.auditorName, counterparty: options.auditorName, amountCents: -reviewCents, category: "Professional fees", method: "Online banking", receiptStatus: "attached", memo: "Review engagement, prior-year statements" });
    }
  }

  // --- Card payments: the previous month's card activity, paid from chequing -
  for (const m of months) {
    const prior = previousMonth(m);
    const owed = -rows
      .filter((row) => row.account === "card" && row.date.slice(0, 7) === prior && !isTransfer(row))
      .reduce((sum, row) => sum + row.amountCents, 0);
    if (owed <= 0) continue;
    const date = nextBusinessDay(dayOfMonth(m, 22));
    push({ key: `card-payment-${m}`, account: "operating", date, description: "Organization Visa payment", counterparty: "Riverbank Credit Union", amountCents: -owed, category: DEMO_TRANSFER_CATEGORY, method: "Online banking", memo: `${monthName(prior)} statement` });
    push({ key: `card-payment-received-${m}`, account: "card", date, description: "Payment received, thank you", counterparty: "Riverbank Credit Union", amountCents: owed, category: DEMO_TRANSFER_CATEGORY, method: card });
  }

  // --- Recency: pending holds, rows to review, receipts still owed ----------
  for (const row of rows) {
    const age = daysBetween(row.date, asOf);
    const rng = createRng(`recency:${row.key}`);
    // Recurring debits and processor payouts arrive categorised (the kind of
    // rows a rule would catch); one-off card spend, e-transfers and cheques
    // are what a treasurer still has to review.
    const oneOff = row.account === "card" || row.method === "Interac e-Transfer" || row.method === "Cheque deposit";
    const reviewable = oneOff && !isTransfer(row) && !/^(operating-gift|review-engagement)-/.test(row.key);
    if (age <= 3 && (row.account === "card" || row.method === "Interac e-Transfer" || row.method === "Deposit")) {
      row.status = "pending";
      if (row.amountCents < 0) row.receiptStatus = "missing";
    }
    if (reviewable && age <= 60 && rng.chance(0.6)) {
      row.category = undefined;
    } else if (reviewable && age > 60 && age < 400 && rng.chance(0.03)) {
      row.category = undefined;
    }
    if (row.receiptStatus === "attached" && age <= 30 && rng.chance(0.35)) row.receiptStatus = "missing";
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  // --- Balances ----------------------------------------------------------------
  const keys: DemoFeedAccountKey[] = ["operating", "restricted", "card"];
  const all = [...rows, ...(options.fixedRows ?? []).filter((row) => row.date >= start && row.date <= asOf)];
  const sumThrough = (account: DemoFeedAccountKey, through: string) =>
    all.filter((row) => row.account === account && row.date <= through).reduce((sum, row) => sum + row.amountCents, 0);
  const openingBalances: Record<DemoFeedAccountKey, number> = { operating: 0, restricted: 0, card: 0 };
  if (options.balanceAt) {
    openingBalances.operating = options.balanceAt.operating - sumThrough("operating", options.balanceAt.date);
    openingBalances.restricted = options.balanceAt.restricted - sumThrough("restricted", options.balanceAt.date);
  }
  const balances = Object.fromEntries(
    keys.map((account) => [account, openingBalances[account] + sumThrough(account, asOf)]),
  ) as Record<DemoFeedAccountKey, number>;
  return { rows, openingBalances, balances };
}
