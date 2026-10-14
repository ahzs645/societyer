/**
 * Demo data for invoicing: a catalog, five customers, 25 invoices across every
 * status over the last six months (dues, space rentals, sponsorships and
 * program fees), a monthly room-rental series, invoice settings, membership
 * renewals falling in the current month (for "Generate dues invoices") and the
 * money-in bank lines that some payments are linked to.
 *
 * Shared by the in-browser demo (src/lib/staticInvoiceFixtures.ts, fixed
 * string ids) and the server seed (shared/functions/seed.ts, real database
 * ids). Callers choose ids through `refs.idFor` and say which of their members
 * play each part; every other value is deterministic.
 *
 * Dates are written relative to the demo story date (2026-04-21) and move
 * forward in whole weeks, rounded down, so "overdue", "paid last 30 days" and
 * "due soon" stay true whenever the demo is opened. With the clock at the
 * story date nothing moves, and every bank line sits after the March
 * statement the reconciliation demo has already closed.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import { addDays, addMonthsClamped, computeInvoiceTotals, formatInvoiceNumber, monthBounds, type InvoiceLine } from "../invoicing";

export type DemoInvoiceIdKind =
  | "catalogItem"
  | "counterparty"
  | "series"
  | "invoice"
  | "transaction"
  | "settings"
  | "subscription"
  | "identifier";

/** The members the invoicing story bills (keys are the static demo's first names). */
export const DEMO_INVOICE_MEMBER_KEYS = ["mina", "jordan", "priya", "wei", "grace", "hannah", "noor", "liam", "devon", "avery", "sam", "fatima"] as const;
export type DemoInvoiceMemberKey = (typeof DEMO_INVOICE_MEMBER_KEYS)[number];

export type DemoInvoiceMember = { id: string; name: string; email: string };

export type DemoInvoiceRefs = {
  societyId: string;
  connectionId: string;
  cashAccountId: string;
  ownerName: string;
  treasurerName: string;
  members: Record<DemoInvoiceMemberKey, DemoInvoiceMember>;
  plans: { regular: string; student: string };
  /** The `_id` to give a generated row (a fixed id, or a placeholder resolved on insert). */
  idFor: (kind: DemoInvoiceIdKind, key: string) => string;
  /** The workspace's local calendar date; dues renewals fall in its month. */
  today: string;
};

const STORY_DATE_MS = Date.parse("2026-04-21T12:00:00.000Z");
const DAY_MS = 86_400_000;
export const DEMO_INVOICE_PREFIX = "RCS-";

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The demo's "today" for invoices: the story date moved forward in whole weeks, never past the real date. */
export function invoiceDemoAnchor(nowMs = Date.now()): string {
  const weeks = Math.max(0, Math.floor((nowMs - STORY_DATE_MS) / (7 * DAY_MS)));
  return isoDay(STORY_DATE_MS + weeks * 7 * DAY_MS);
}

/** Catalog keys (used in line specs) and the id key each item is stored under. */
const CATALOG = {
  regularDues: "regular_dues",
  studentDues: "student_dues",
  room: "room_half_day",
  hall: "hall_full_day",
  kitchen: "kitchen",
  workshop: "workshop",
  bronze: "sponsor_bronze",
  gold: "sponsor_gold",
  projector: "projector",
};

const CUSTOMERS = {
  yoga: "westside_yoga",
  creditUnion: "harbour_cu",
  pac: "cedar_pac",
  market: "farmers_market",
  dental: "lighthouse_dental",
};

const SERIES_YOGA = "westside_yoga";

type LineSpec = { item: keyof typeof CATALOG; quantity?: number; description?: string; unitPriceCents?: number };

function catalogItems(refs: DemoInvoiceRefs, at: string): Array<Record<string, any>> {
  const row = (key: string, name: string, unitPriceCents: number, category: string, extra: Record<string, any> = {}) => ({
    _id: refs.idFor("catalogItem", key),
    societyId: refs.societyId,
    name,
    unitPriceCents,
    category,
    active: true,
    createdAtISO: at,
    updatedAtISO: at,
    ...extra,
  });
  const gst = { taxRatePercent: 5, taxLabel: "GST" };
  return [
    row(CATALOG.regularDues, "Annual membership dues — Regular", 2500, "Membership fees", { description: "Voting membership for one year." }),
    row(CATALOG.studentDues, "Annual membership dues — Student", 500, "Membership fees", { description: "Reduced dues for students." }),
    row(CATALOG.room, "Program room rental — half day", 12000, "Rental income", { description: "Up to four hours, tables and chairs included.", ...gst }),
    row(CATALOG.hall, "Main hall rental — full day", 45000, "Rental income", { description: "8 am to 6 pm, capacity 120.", ...gst }),
    row(CATALOG.kitchen, "Kitchen use add-on", 7500, "Rental income", { description: "Commercial kitchen, cleaning included.", ...gst }),
    row(CATALOG.workshop, "Youth workshop registration", 4000, "Registration fees", { description: "Per participant, materials included." }),
    row(CATALOG.bronze, "Community sponsorship — Bronze", 50000, "Sponsorship", { description: "Logo on event signage and the newsletter." }),
    row(CATALOG.gold, "Community sponsorship — Gold", 250000, "Sponsorship", { description: "Named program sponsor for the season." }),
    row(CATALOG.projector, "Projector and screen rental", 6000, "Rental income", { description: "Per booking.", active: false, ...gst }),
  ];
}

/** "Hannah Goldberg" → "H GOLDBERG", as a bank prints an e-transfer sender. */
function bankName(name: string) {
  const [first = "", ...rest] = name.split(" ");
  return `${first.charAt(0)} ${rest.join(" ").toUpperCase()}`.trim();
}

export function invoiceDemoRows(refs: DemoInvoiceRefs, nowMs = Date.now()) {
  const A = invoiceDemoAnchor(nowMs);
  const d = (days: number) => addDays(A, days);
  const at = (date: string, hour = 16) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const catalog = catalogItems(refs, at(d(-180)));
  const byKey = new Map(Object.entries(CATALOG).map(([spec, key]) => [spec, catalog.find((item) => item._id === refs.idFor("catalogItem", key))!]));

  const lines = (specs: LineSpec[]): InvoiceLine[] =>
    specs.map((spec, index) => {
      const item = byKey.get(spec.item)!;
      const line: InvoiceLine = {
        key: `line_${index + 1}`,
        catalogItemId: item._id,
        item: item.name,
        quantity: spec.quantity ?? 1,
        unitPriceCents: spec.unitPriceCents ?? item.unitPriceCents,
      };
      if (spec.description ?? item.description) line.description = spec.description ?? item.description;
      if ((item as any).taxRatePercent) {
        line.taxRatePercent = (item as any).taxRatePercent;
        line.taxLabel = (item as any).taxLabel;
      }
      return line;
    });

  const member = (key: DemoInvoiceMemberKey) => {
    const row = refs.members[key];
    return { partyKind: "member", memberId: row.id, billToName: row.name, billToEmail: row.email };
  };
  const customer = (key: string, name: string, email: string, address: string) => ({ partyKind: "organization", counterpartyId: refs.idFor("counterparty", key), billToName: name, billToEmail: email, billToAddress: address });
  const parties = {
    yoga: customer(CUSTOMERS.yoga, "Westside Yoga Collective", "bookings@westsideyoga.example", "2150 W 4th Avenue\nVancouver, BC V6K 1N6"),
    creditUnion: customer(CUSTOMERS.creditUnion, "Harbour Credit Union", "community@harbourcu.example", "88 Harbour Way\nVancouver, BC V6C 3E8"),
    pac: customer(CUSTOMERS.pac, "Cedar Elementary PAC", "treasurer@cedarpac.example", "1400 Cedar Street\nVancouver, BC V5N 2K4"),
    market: customer(CUSTOMERS.market, "Riverside Farmers Market Association", "manager@riversidemarket.example", "PO Box 311\nVancouver, BC V6B 3W1"),
    dental: customer(CUSTOMERS.dental, "Lighthouse Dental", "office@lighthousedental.example", "501 Marine Drive\nVancouver, BC V5X 2T1"),
  };

  type Spec = {
    key: string;
    party: Record<string, any>;
    issue: string;
    terms: "due_on_receipt" | "net_15" | "net_30" | "net_60";
    lines: InvoiceLine[];
    discount?: { kind: "percent" | "amount"; value: number };
    reference?: string;
    memo?: string;
    state: "draft" | "sent" | "void";
    payments?: Array<{ date: string; amountCents?: number; method: string; reference?: string; txnKey?: string }>;
    voidReason?: string;
    seriesIndex?: number;
    source?: string;
    reminder?: string;
  };
  const termDays = { due_on_receipt: 0, net_15: 15, net_30: 30, net_60: 60 } as const;

  const yogaStart = addMonthsClamped(A, -5);
  const yogaLines = lines([{ item: "room", quantity: 4, description: "Tuesday and Thursday evening classes, four sessions" }]);
  const yoga: Spec[] = [0, 1, 2, 3, 4, 5].map((index) => {
    const issue = addMonthsClamped(yogaStart, index);
    const base: Spec = { key: `yoga_${index}`, party: parties.yoga, issue, terms: "net_15", lines: yogaLines, state: "sent", seriesIndex: index, source: "series", reference: "Room booking WY-2026" };
    if (index <= 3) return { ...base, payments: [{ date: addDays(issue, 9), method: "e_transfer", reference: `WY-${index + 1}` }] };
    if (index === 4) return { ...base, reminder: d(-6) };
    return { ...base, state: "draft" };
  });

  const specs: Spec[] = [
    ...yoga,
    // Membership dues
    { key: "dues_mina", party: member("mina"), issue: d(-170), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues", payments: [{ date: d(-160), method: "e_transfer" }] },
    { key: "dues_jordan", party: member("jordan"), issue: d(-165), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues", payments: [{ date: d(-150), method: "cheque", reference: "Cheque 218" }] },
    { key: "dues_priya", party: member("priya"), issue: d(-120), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues", payments: [{ date: d(-112), method: "e_transfer" }] },
    { key: "dues_wei", party: member("wei"), issue: d(-90), terms: "net_30", lines: lines([{ item: "studentDues" }]), state: "sent", source: "dues", payments: [{ date: d(-90), method: "cash" }] },
    { key: "dues_grace", party: member("grace"), issue: d(-40), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues", reminder: d(-4) },
    { key: "dues_hannah", party: member("hannah"), issue: d(-25), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues", payments: [{ date: d(-5), method: "e_transfer", txnKey: "hannah" }] },
    { key: "dues_noor", party: member("noor"), issue: d(-12), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "sent", source: "dues" },
    { key: "dues_liam", party: member("liam"), issue: d(-2), terms: "net_30", lines: lines([{ item: "regularDues" }]), state: "draft", source: "dues" },
    // Sponsorships
    { key: "sponsor_dental", party: parties.dental, issue: d(-100), terms: "net_30", lines: lines([{ item: "bronze", description: "Spring newsletter and community picnic signage" }]), state: "sent", reference: "Sponsorship 2026", payments: [{ date: d(-82), method: "cheque", reference: "Cheque 4471" }] },
    { key: "sponsor_cu_gold", party: parties.creditUnion, issue: d(-45), terms: "net_60", lines: lines([{ item: "gold", description: "Youth resilience program, presenting sponsor" }]), state: "sent", reference: "PO 55-1180", memo: "Payable in two instalments of $1,250; the second is due by the invoice due date.", payments: [{ date: d(-20), amountCents: 125000, method: "direct_deposit", txnKey: "cu", reference: "First instalment" }] },
    { key: "sponsor_cu_gala", party: parties.creditUnion, issue: d(-1), terms: "net_30", lines: lines([{ item: "bronze", description: "Fall gala table sponsor" }, { item: "bronze", description: "Fall gala program advertisement", unitPriceCents: 25000 }]), state: "draft", reference: "Fall gala" },
    // Space rentals
    { key: "hall_seniors", party: { partyKind: "custom", billToName: "Riverside Seniors Club", billToEmail: "seniors.club@example.org", billToAddress: "c/o Margaret Lin\n12 Elm Court\nVancouver, BC V5L 1A2" }, issue: d(-130), terms: "net_15", lines: lines([{ item: "hall", description: "Winter social" }, { item: "kitchen" }]), state: "sent", payments: [{ date: d(-122), method: "cheque", reference: "Cheque 902" }] },
    { key: "hall_market_spring", party: parties.market, issue: d(-75), terms: "net_30", lines: lines([{ item: "hall", quantity: 2, description: "Indoor market days" }, { item: "kitchen" }]), state: "sent", payments: [{ date: d(-52), method: "e_transfer" }] },
    { key: "hall_market_now", party: parties.market, issue: d(-8), terms: "net_15", lines: lines([{ item: "hall", description: "Seedling swap" }, { item: "projector", description: "Projector for the growers' talk" }]), state: "sent" },
    { key: "hall_cancelled", party: { partyKind: "custom", billToName: "Northside Choir", billToEmail: "northside.choir@example.org" }, issue: d(-60), terms: "net_15", lines: lines([{ item: "hall", description: "Spring concert" }]), state: "void", voidReason: "Booking cancelled by the choir" },
    // Program fees
    { key: "program_pac", party: parties.pac, issue: d(-20), terms: "net_30", lines: lines([{ item: "workshop", quantity: 18, description: "Grade 6 resilience workshop series" }]), discount: { kind: "percent", value: 10 }, state: "sent", reference: "PAC request 2026-03", payments: [{ date: d(-6), amountCents: 40000, method: "e_transfer", txnKey: "pac", reference: "Deposit" }] },
    { key: "program_devon", party: member("devon"), issue: d(-58), terms: "net_15", lines: lines([{ item: "workshop", unitPriceCents: 9500, description: "First aid certification course" }]), state: "sent", payments: [{ date: d(-55), method: "card" }] },
    { key: "program_avery", party: member("avery"), issue: d(-33), terms: "net_15", lines: lines([{ item: "workshop", description: "Emergency preparedness evening" }]), state: "sent", payments: [{ date: d(-29), method: "e_transfer" }] },
    { key: "program_sam", party: member("sam"), issue: d(-3), terms: "net_15", lines: lines([{ item: "workshop", quantity: 2, description: "Two sessions of the neighbourhood mapping workshop" }]), state: "sent" },
  ];

  specs.sort((a, b) => a.issue.localeCompare(b.issue) || a.key.localeCompare(b.key));

  const bankLines: Record<string, { date: string; description: string; category: string }> = {
    hannah: { date: d(-5), description: `E-TRANSFER DEPOSIT ${bankName(refs.members.hannah.name)}`, category: "Membership fees" },
    cu: { date: d(-20), description: "DEPOSIT HARBOUR CREDIT UNION SPONSOR", category: "Sponsorship" },
    pac: { date: d(-6), description: "E-TRANSFER CEDAR ELEMENTARY PAC", category: "Registration fees" },
  };
  const txnId = (key: string) => refs.idFor("transaction", key);
  const seriesId = refs.idFor("series", SERIES_YOGA);

  const invoices: Array<Record<string, any>> = specs.map((spec, index) => {
    const sequence = index + 1;
    const totals = computeInvoiceTotals(spec.lines, spec.discount);
    const dueDate = addDays(spec.issue, termDays[spec.terms]);
    const payments = (spec.payments ?? []).map((payment, n) => ({
      key: `pay_${spec.key}_${n + 1}`,
      date: payment.date,
      amountCents: payment.amountCents ?? totals.totalCents,
      method: payment.method,
      ...(payment.reference ? { reference: payment.reference } : {}),
      ...(payment.txnKey ? { financialTransactionId: txnId(payment.txnKey) } : {}),
      recordedAtISO: at(payment.date, 18),
      recordedByName: refs.treasurerName,
    }));
    const timeline: Array<Record<string, any>> = [
      spec.source === "series"
        ? { atISO: at(spec.issue, 15), kind: "issued_from_series", label: "Issued from Westside Yoga room rental", actorName: refs.treasurerName }
        : { atISO: at(spec.issue, 15), kind: "created", label: spec.source === "dues" ? "Draft created from fee tier" : "Draft created", actorName: refs.treasurerName },
    ];
    if (spec.state !== "draft") timeline.push({ atISO: at(spec.issue, 17), kind: "sent", label: "Marked as sent", actorName: refs.treasurerName });
    if (spec.reminder) timeline.push({ atISO: at(spec.reminder, 17), kind: "reminder", label: "Reminder drafted in Outbox", actorName: refs.treasurerName });
    let paidSoFar = 0;
    for (const payment of payments) {
      paidSoFar += payment.amountCents;
      timeline.push({ atISO: payment.recordedAtISO, kind: "payment", label: paidSoFar >= totals.totalCents ? "Paid in full" : "Partial payment recorded", actorName: refs.treasurerName, amountCents: payment.amountCents });
    }
    if (spec.state === "void") timeline.push({ atISO: at(addDays(spec.issue, 6), 17), kind: "voided", label: `Voided: ${spec.voidReason}`, actorName: refs.ownerName });
    return {
      _id: refs.idFor("invoice", spec.key),
      societyId: refs.societyId,
      sequence,
      number: formatInvoiceNumber(DEMO_INVOICE_PREFIX, sequence),
      status: spec.state,
      ...spec.party,
      issueDate: spec.issue,
      terms: spec.terms,
      dueDate,
      ...(spec.reference ? { reference: spec.reference } : {}),
      currency: "CAD",
      lines: spec.lines,
      ...(spec.discount ? { discount: spec.discount } : {}),
      ...(spec.memo ? { memo: spec.memo } : {}),
      totalCents: totals.totalCents,
      paidCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
      payments,
      timeline,
      ...(spec.seriesIndex != null ? { seriesId } : {}),
      source: spec.source ?? "manual",
      ...(spec.state !== "draft" ? { sentAtISO: at(spec.issue, 17) } : {}),
      ...(spec.reminder ? { lastReminderAtISO: at(spec.reminder, 17) } : {}),
      ...(spec.state === "void" ? { voidedAtISO: at(addDays(spec.issue, 6), 17), voidReason: spec.voidReason } : {}),
      createdAtISO: at(spec.issue, 15),
      updatedAtISO: at(payments.at(-1)?.date ?? spec.issue, 18),
    };
  });

  const noor = refs.members.noor;
  const financialTransactions = [
    ...Object.entries(bankLines).map(([key, line]) => {
      const invoice = invoices.find((row) => row.payments.some((payment: any) => payment.financialTransactionId === txnId(key)))!;
      const payment = invoice.payments.find((row: any) => row.financialTransactionId === txnId(key))!;
      return { key, ...line, amountCents: payment.amountCents, counterparty: invoice.billToName };
    }),
    // Unlinked deposits that match open invoices, so "Record payment" has suggestions.
    { key: "noor", date: d(-1), description: `E-TRANSFER DEPOSIT ${bankName(noor.name)}`, category: "Membership fees", amountCents: 2500, counterparty: noor.name },
    { key: "yoga", date: d(-1), description: "E-TRANSFER WESTSIDE YOGA COLLECTIVE", category: "Rental income", amountCents: computeInvoiceTotals(yogaLines).totalCents, counterparty: "Westside Yoga Collective" },
  ].map((row) => ({
    _id: txnId(row.key),
    societyId: refs.societyId,
    connectionId: refs.connectionId,
    accountId: refs.cashAccountId,
    externalId: `csv-invoice-${row.key}`,
    date: row.date,
    description: row.description,
    amountCents: row.amountCents,
    category: row.category,
    counterparty: row.counterparty,
    categorizedBy: "manual",
  }));

  const series = [
    {
      _id: seriesId,
      societyId: refs.societyId,
      name: "Westside Yoga room rental",
      frequency: "monthly",
      startDate: yogaStart,
      nextIssueDate: addMonthsClamped(yogaStart, 6),
      endKind: "never",
      issuedCount: 6,
      autoSend: false,
      status: "active",
      ...parties.yoga,
      terms: "net_15",
      reference: "Room booking WY-2026",
      currency: "CAD",
      lines: yogaLines,
      lastIssuedAtISO: at(addMonthsClamped(yogaStart, 5), 15),
      createdAtISO: at(yogaStart, 15),
      updatedAtISO: at(addMonthsClamped(yogaStart, 5), 15),
    },
  ];

  const settings = [
    {
      _id: refs.idFor("settings", "default"),
      societyId: refs.societyId,
      prefix: DEMO_INVOICE_PREFIX,
      nextNumber: invoices.length + 1,
      defaultTerms: "net_30",
      paymentInstructions: "E-transfer to treasurer@riverside.example (auto-deposit is on), or mail a cheque payable to Riverside Community Society, PO Box 2407, Vancouver, BC V6B 3W7. Please include the invoice number.",
      defaultMemo: "Thank you for supporting community programs in Riverside.",
      replyToEmail: "treasurer@riverside.example",
      updatedAtISO: at(d(-180)),
    },
  ];

  const counterparties = [
    [CUSTOMERS.yoga, "Westside Yoga Collective", "bookings@westsideyoga.example"],
    [CUSTOMERS.creditUnion, "Harbour Credit Union", "community@harbourcu.example"],
    [CUSTOMERS.pac, "Cedar Elementary PAC", "treasurer@cedarpac.example"],
    [CUSTOMERS.market, "Riverside Farmers Market Association", "manager@riversidemarket.example"],
    [CUSTOMERS.dental, "Lighthouse Dental", "office@lighthousedental.example"],
  ].map(([key, name, email]) => ({ _id: refs.idFor("counterparty", key), societyId: refs.societyId, name, kind: "customer", provider: "societyer", email, createdAtISO: at(d(-180)), updatedAtISO: at(d(-180)) }));

  // Renewals in the current calendar month, for "Generate dues invoices".
  const { start } = monthBounds(refs.today);
  const renewal = (day: number) => addDays(start, day - 1);
  const subscriptions = ([
    ["sam", "regular", renewal(5)],
    ["mina", "regular", renewal(12)],
    ["fatima", "student", renewal(19)],
    ["jordan", "regular", renewal(26)],
  ] as Array<[DemoInvoiceMemberKey, "regular" | "student", string]>).map(([key, plan, renewalDate]) => ({
    _id: refs.idFor("subscription", key),
    societyId: refs.societyId,
    planId: refs.plans[plan],
    memberId: refs.members[key].id,
    email: refs.members[key].email,
    fullName: refs.members[key].name,
    status: "active",
    startedAtISO: `${addMonthsClamped(renewalDate, -12)}T16:00:00.000Z`,
    currentPeriodEndISO: `${renewalDate}T23:59:59.000Z`,
    lastPaymentAtISO: `${addMonthsClamped(renewalDate, -12)}T16:05:00.000Z`,
    lastPaymentCents: plan === "student" ? 500 : 2500,
    demo: true,
  }));

  const identifiers = [
    {
      _id: refs.idFor("identifier", "gst"),
      societyId: refs.societyId,
      kind: "gst",
      number: "81234 5678 RT0001",
      jurisdiction: "CA",
      status: "active",
      accessLevel: "internal",
      notes: "Fictional GST/HST registration used on demo invoices.",
      createdAtISO: at(d(-180)),
      updatedAtISO: at(d(-180)),
    },
  ];

  return {
    anchor: A,
    invoices,
    invoiceCatalogItems: catalog,
    invoiceSeries: series,
    invoiceSettings: settings,
    financialTransactions,
    accountingCounterparties: counterparties,
    memberSubscriptions: subscriptions,
    organizationIdentifiers: identifiers,
  };
}

export type DemoInvoiceRows = ReturnType<typeof invoiceDemoRows>;
