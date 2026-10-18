/**
 * Demo data for bills (accounts payable): four vendors and eight bills, one
 * in each status a bill can show (draft, needs approval, open, scheduled,
 * partially paid, paid, overdue and canceled), the journal entries their
 * approvals and payments posted (accrual-only approvals, payments on both
 * bases and a cash-only entry per payment for the paid share, as
 * shared/functions/bills.ts posts them), and the money-out bank lines: two
 * linked to payments, one unlinked that matches the overdue bill so "Record
 * payment" has a suggestion.
 *
 * Shared by the in-browser demo (src/lib/staticBillFixtures.ts, fixed string
 * ids) and the server seed (shared/functions/seed.ts, real database ids).
 * Callers choose ids through `refs.idFor` and supply the accounts and people.
 *
 * Dates follow the invoicing demo's anchor (the story date moved forward in
 * whole weeks), so overdue stays overdue and "due in the next 7 days" stays
 * true. At the story date every bank line sits after the March statement the
 * reconciliation demo has closed.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import { approvalPostingLines, billTotalCents, cashBasisPostingLines, cashBasisShares, paymentPostingLines, recognizedCashShares, type BillCashShare, type BillLine, type PostingLine } from "../bills";
import type { JournalBasis } from "../booksReports";
import { demoFiscalYearLabel } from "./journals";
import { addDays } from "../invoicing";
import { invoiceDemoAnchor } from "./invoicing";

export type DemoBillIdKind = "vendor" | "bill" | "transaction" | "journalEntry" | "journalLine";

export type DemoBillPerson = { id: string; name: string; role: string };

export type DemoBillRefs = {
  societyId: string;
  connectionId: string;
  /** Operating chequing: where the bank lines land and payments come from. */
  cashAccountId: string;
  accounts: { payable: string; facilities: string; venue: string; utilities: string; program: string };
  fundRestrictionId: string;
  owner: DemoBillPerson;
  treasurer: DemoBillPerson;
  secretary: DemoBillPerson;
  /** The `_id` to give a generated row (a fixed id, or a placeholder resolved on insert). */
  idFor: (kind: DemoBillIdKind, key: string) => string;
};

type Row = Record<string, unknown> & { _id: string };

const VENDORS = {
  hydro: "coastal_hydro",
  printing: "westside_printing",
  janitorial: "harbour_janitorial",
  rentals: "fieldhouse_rentals",
} as const;
type VendorKey = keyof typeof VENDORS;

export function billDemoRows(refs: DemoBillRefs, nowMs = Date.now()) {
  const A = invoiceDemoAnchor(nowMs);
  const d = (days: number) => addDays(A, days);
  const at = (date: string, hour = 16) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const created = at(d(-200));

  const vendorSpecs: Record<VendorKey, Record<string, unknown> & { name: string }> = {
    hydro: { name: "Coastal Hydro", email: "accounts@coastalhydro.example", phone: "604-555-0142", defaultAccountId: refs.accounts.utilities, defaultTerms: "net_15", paymentMethod: "pre_authorized_debit", paymentDetails: "Pre-authorized debit from operating chequing, account 4417-208.", notes: "Hall electricity. Bills monthly; debits on the due date." },
    printing: { name: "Westside Printing Co-op", email: "orders@westsideprinting.example", contactName: "Dana Whitford", phone: "604-555-0188", address: "1120 Commercial Drive\nVancouver, BC V5L 3X4", taxIdentifier: "78231 9940 RT0001", defaultAccountId: refs.accounts.program, defaultTerms: "net_30", paymentMethod: "e_transfer", paymentDetails: "E-transfer to payments@westsideprinting.example (auto-deposit).", notes: "Newsletter, flyers and AGM booklets. Worker co-op; 10% community discount applied on invoices." },
    janitorial: { name: "Harbour Janitorial", email: "billing@harbourjanitorial.example", contactName: "Luis Ortega", phone: "604-555-0117", address: "88 Powell Street\nVancouver, BC V6A 1E7", defaultAccountId: refs.accounts.facilities, defaultTerms: "net_15", paymentMethod: "eft", paymentDetails: "EFT to Harbour Janitorial, transit 00120, institution 001, account ending 5531." },
    rentals: { name: "Fieldhouse Rentals", email: "bookings@fieldhouse.example", contactName: "Priya Desai", phone: "604-555-0163", address: "2400 Clark Drive\nVancouver, BC V5N 3H1", defaultAccountId: refs.accounts.venue, defaultTerms: "net_30", paymentMethod: "cheque", paymentDetails: "Cheque payable to Fieldhouse Rentals Ltd., mailed to the address above." },
  };
  const vendorId = (key: VendorKey) => refs.idFor("vendor", VENDORS[key]);
  const vendors: Row[] = (Object.keys(VENDORS) as VendorKey[]).map((key) => ({
    _id: vendorId(key),
    societyId: refs.societyId,
    kind: "vendor",
    provider: "societyer",
    ...vendorSpecs[key],
    createdAtISO: created,
    updatedAtISO: created,
  }));

  const line = (key: string, accountId: string, amountCents: number, memo: string, extra: Partial<BillLine> = {}): BillLine => ({ key, accountId, amountCents, memo, ...extra });

  type PaymentSpec = { key: string; date: string; amountCents: number; method: string; reference?: string; txnKey?: string };
  type Spec = {
    key: string;
    vendor: VendorKey;
    billNumber?: string;
    billDate: string;
    terms: "due_on_receipt" | "net_15" | "net_30";
    lines: BillLine[];
    notes?: string;
    lifecycle: "draft" | "awaiting_approval" | "approved" | "scheduled" | "canceled";
    submitted?: string;
    approvers?: DemoBillPerson[];
    approvedOn?: string;
    scheduledDate?: string;
    payments?: PaymentSpec[];
    canceledOn?: string;
    cancelReason?: string;
    source?: "manual" | "upload";
  };
  const termDays = { due_on_receipt: 0, net_15: 15, net_30: 30 } as const;
  const specs: Spec[] = [
    {
      key: "hydro_march",
      vendor: "hydro",
      billNumber: "CH-2026-0318",
      billDate: d(-34),
      terms: "net_15",
      lines: [line("line_1", refs.accounts.utilities, 41238, "Hall electricity, billing period ending mid-March")],
      lifecycle: "approved",
      submitted: d(-33),
      approvers: [refs.owner],
      approvedOn: d(-32),
      payments: [{ key: "pay_hydro_march_1", date: d(-19), amountCents: 41238, method: "pre_authorized_debit", reference: "PAD 0402", txnKey: "hydro_march" }],
    },
    {
      key: "printing_newsletter",
      vendor: "printing",
      billNumber: "WP-1182",
      billDate: d(-25),
      terms: "net_30",
      lines: [
        line("line_1", refs.accounts.program, 94000, "Spring newsletter, 1,200 copies"),
        line("line_2", refs.accounts.program, 24000, "Program flyers for the youth workshops", { fundRestrictionId: refs.fundRestrictionId }),
      ],
      notes: "Paying in two instalments as agreed with Dana.",
      lifecycle: "approved",
      submitted: d(-24),
      approvers: [refs.secretary, refs.owner],
      approvedOn: d(-23),
      payments: [{ key: "pay_printing_newsletter_1", date: d(-12), amountCents: 50000, method: "e_transfer", reference: "First instalment", txnKey: "printing_first" }],
    },
    {
      key: "janitorial_march",
      vendor: "janitorial",
      billNumber: "HJ-2291",
      billDate: d(-28),
      terms: "net_15",
      lines: [line("line_1", refs.accounts.facilities, 63000, "Weekly hall cleaning, four visits")],
      lifecycle: "approved",
      submitted: d(-27),
      approvers: [refs.owner],
      approvedOn: d(-26),
    },
    {
      key: "fieldhouse_gym",
      vendor: "rentals",
      billNumber: "FR-0417",
      billDate: d(-10),
      terms: "net_30",
      lines: [line("line_1", refs.accounts.venue, 85000, "Gym rental, youth resilience program, five Saturdays", { fundRestrictionId: refs.fundRestrictionId })],
      lifecycle: "scheduled",
      submitted: d(-9),
      approvers: [refs.owner],
      approvedOn: d(-8),
      scheduledDate: d(3),
    },
    {
      key: "hydro_april",
      vendor: "hydro",
      billNumber: "CH-2026-0418",
      billDate: d(-6),
      terms: "net_15",
      lines: [line("line_1", refs.accounts.utilities, 38912, "Hall electricity, billing period ending mid-April")],
      lifecycle: "approved",
      submitted: d(-5),
      approvers: [refs.secretary],
      approvedOn: d(-4),
    },
    {
      key: "printing_agm",
      vendor: "printing",
      billNumber: "WP-1201",
      billDate: d(-3),
      terms: "net_30",
      lines: [
        line("line_1", refs.accounts.program, 118000, "AGM booklets, 300 copies, saddle-stitched"),
        line("line_2", refs.accounts.program, 27000, "Ballot cards and name tags"),
      ],
      notes: "Over $1,000, so it needs two approvals.",
      lifecycle: "awaiting_approval",
      submitted: d(-2),
      approvers: [refs.secretary],
    },
    {
      key: "janitorial_april",
      vendor: "janitorial",
      billNumber: "HJ-2318",
      billDate: d(-1),
      terms: "net_15",
      lines: [line("line_1", refs.accounts.facilities, 63000, "Weekly hall cleaning, four visits")],
      notes: "Uploaded from the emailed PDF; check the visit count before sending for approval.",
      lifecycle: "draft",
      source: "upload",
    },
    {
      key: "printing_duplicate",
      vendor: "printing",
      billNumber: "WP-1175",
      billDate: d(-40),
      terms: "net_30",
      lines: [line("line_1", refs.accounts.program, 31500, "Winter newsletter reprint")],
      lifecycle: "canceled",
      submitted: d(-39),
      canceledOn: d(-38),
      cancelReason: "Entered twice; Westside credited the reprint",
    },
  ];

  const txnId = (key: string) => refs.idFor("transaction", key);
  const entryId = (key: string) => refs.idFor("journalEntry", key);
  const bankLines: Record<string, { date: string; description: string; counterparty: string; amountCents: number; method: string; billKey?: string }> = {
    hydro_march: { date: d(-19), description: "PAD COASTAL HYDRO", counterparty: "Coastal Hydro", amountCents: -41238, method: "Pre-authorized debit", billKey: "hydro_march" },
    printing_first: { date: d(-12), description: "INTERAC E-TRANSFER WESTSIDE PRINTING", counterparty: "Westside Printing Co-op", amountCents: -50000, method: "Interac e-Transfer", billKey: "printing_newsletter" },
    // Not linked yet: matches the overdue Harbour Janitorial bill.
    janitorial_march: { date: d(-2), description: "ONLINE BANKING PAYMENT HARBOUR JANITORIAL", counterparty: "Harbour Janitorial", amountCents: -63000, method: "Online banking" },
  };

  const journalEntries: Row[] = [];
  const journalLines: Row[] = [];
  const post = (key: string, date: string, memo: string, source: string, sourceExternalId: string, basis: JournalBasis, lines: PostingLine[], vendor: string, createdBy: DemoBillPerson) => {
    const id = entryId(key);
    journalEntries.push({ _id: id, societyId: refs.societyId, date, memo, source, sourceExternalId, basis, status: "posted", fiscalYear: demoFiscalYearLabel(date), createdByUserId: createdBy.id, postedAtISO: at(date, 18), createdAtISO: at(date, 18), updatedAtISO: at(date, 18) });
    lines.forEach((posting, index) => {
      journalLines.push({
        _id: refs.idFor("journalLine", `${key}_${index + 1}`),
        societyId: refs.societyId,
        journalEntryId: id,
        accountId: posting.accountId,
        lineOrder: index,
        amountCents: posting.amountCents,
        side: posting.side,
        ...(posting.description ? { description: posting.description } : {}),
        ...(posting.fundRestrictionId ? { fundRestrictionId: posting.fundRestrictionId } : {}),
        ...(posting.financialTransactionId ? { financialTransactionId: posting.financialTransactionId } : {}),
        ...(posting.tagIds?.length ? { tagIds: posting.tagIds } : {}),
        counterpartyId: vendor,
        createdAtISO: at(date, 18),
        updatedAtISO: at(date, 18),
      });
    });
    return id;
  };

  const event = (date: string, kind: string, label: string, person?: DemoBillPerson, amountCents?: number, hour = 17) => ({
    atISO: at(date, hour),
    kind,
    label,
    ...(person ? { actorName: person.name, actorUserId: person.id } : {}),
    ...(amountCents != null ? { amountCents } : {}),
  });

  const bills: Row[] = specs.map((spec) => {
    const vendor = vendorSpecs[spec.vendor];
    const id = refs.idFor("bill", spec.key);
    const total = billTotalCents(spec.lines);
    const label = `${vendor.name} bill ${spec.billNumber}`;
    const approved = spec.lifecycle === "approved" || spec.lifecycle === "scheduled";
    const required = total >= 100_000 ? 2 : 1;
    const timeline = [
      event(spec.billDate, spec.source === "upload" ? "uploaded" : "created", spec.source === "upload" ? "Draft created from an uploaded bill" : "Draft created", refs.treasurer, undefined, 15),
    ];
    if (spec.submitted) timeline.push(event(spec.submitted, "submitted", `Sent for approval (${required} needed)`, refs.treasurer, undefined, 16));
    const approvals = (spec.approvers ?? []).map((person, index) => {
      const date = spec.approvedOn ?? spec.submitted ?? spec.billDate;
      timeline.push(event(date, "approved", `Approved (${index + 1} of ${required})`, person, undefined, 17 + index));
      return { userId: person.id, name: person.name, role: person.role, atISO: at(date, 17 + index) };
    });
    let journalEntryId: string | undefined;
    if (approved) {
      journalEntryId = post(`bill_${spec.key}`, spec.billDate, `Bill: ${label}`, "bill", `bill:${id}`, "accrual-only", approvalPostingLines({ lines: spec.lines, billNumber: spec.billNumber, vendorName: vendor.name }, refs.accounts.payable), vendorId(spec.vendor), spec.approvers!.at(-1)!);
      timeline.push(event(spec.approvedOn!, "posted", `Posted to the books: $${(total / 100).toFixed(2)} to Accounts payable`, spec.approvers!.at(-1), total, 19));
    }
    if (spec.scheduledDate) timeline.push(event(spec.approvedOn!, "scheduled", `Payment planned for ${spec.scheduledDate}`, refs.treasurer, undefined, 20));
    let paid = 0;
    const recorded: Array<{ amountCents: number; cashBasisShares: BillCashShare[] }> = [];
    const payments = (spec.payments ?? []).map((payment) => {
      paid += payment.amountCents;
      const linked = payment.txnKey ? txnId(payment.txnKey) : undefined;
      const paymentEntryId = post(
        `payment_${payment.key}`,
        payment.date,
        `Bill payment: ${label}`,
        "bill_payment",
        `bill:${id}:payment:${payment.key}`,
        "both",
        paymentPostingLines({ amountCents: payment.amountCents, financialTransactionId: linked, reference: payment.reference }, refs.accounts.payable, refs.cashAccountId, `Payment: ${label}`),
        vendorId(spec.vendor),
        refs.treasurer,
      );
      const shares = cashBasisShares(spec.lines, recognizedCashShares(spec.lines, recorded), payment.amountCents);
      recorded.push({ amountCents: payment.amountCents, cashBasisShares: shares });
      const cashBasisEntryId = post(
        `cash_${payment.key}`,
        payment.date,
        `Bill paid (cash basis): ${label}`,
        "bill_cash_basis",
        `bill:${id}:payment:${payment.key}:cash`,
        "cash-only",
        cashBasisPostingLines({ lines: spec.lines, billNumber: spec.billNumber, vendorName: vendor.name }, shares, refs.accounts.payable),
        vendorId(spec.vendor),
        refs.treasurer,
      );
      timeline.push(event(payment.date, "payment", `${paid >= total ? "Paid in full" : "Partial payment recorded"}${linked ? " · linked to the bank transaction" : ""}`, refs.treasurer, payment.amountCents, 18));
      return {
        key: payment.key,
        date: payment.date,
        amountCents: payment.amountCents,
        method: payment.method,
        ...(payment.reference ? { reference: payment.reference } : {}),
        ...(linked ? { financialTransactionId: linked, transactionBefore: { category: spec.vendor === "hydro" ? "Utilities" : "Printing" } } : {}),
        cashAccountId: refs.cashAccountId,
        journalEntryId: paymentEntryId,
        cashBasisJournalEntryId: cashBasisEntryId,
        cashBasisShares: shares,
        recordedAtISO: at(payment.date, 18),
        recordedByName: refs.treasurer.name,
      };
    });
    if (spec.lifecycle === "canceled") timeline.push(event(spec.canceledOn!, "canceled", `Canceled: ${spec.cancelReason}`, refs.owner));
    const lastEvent = timeline.at(-1)!.atISO;
    return {
      _id: id,
      societyId: refs.societyId,
      billNumber: spec.billNumber,
      vendorId: vendorId(spec.vendor),
      vendorName: vendor.name,
      billDate: spec.billDate,
      terms: spec.terms,
      dueDate: addDays(spec.billDate, termDays[spec.terms]),
      currency: "CAD",
      lines: spec.lines,
      ...(spec.notes ? { notes: spec.notes } : {}),
      status: spec.lifecycle,
      totalCents: total,
      paidCents: paid,
      payments,
      approvals,
      ...(spec.submitted ? { requiredApprovals: required, submittedByUserId: refs.treasurer.id, submittedAtISO: at(spec.submitted, 16) } : {}),
      timeline,
      ...(approved ? { approvedAtISO: at(spec.approvedOn!, 19), journalEntryId } : {}),
      ...(spec.scheduledDate ? { scheduledDate: spec.scheduledDate } : {}),
      ...(spec.lifecycle === "canceled" ? { canceledAtISO: at(spec.canceledOn!, 17), cancelReason: spec.cancelReason } : {}),
      source: spec.source ?? "manual",
      createdByUserId: refs.treasurer.id,
      createdAtISO: at(spec.billDate, 15),
      updatedAtISO: lastEvent,
    };
  });

  const financialTransactions: Row[] = Object.entries(bankLines).map(([key, row]) => {
    const bill = row.billKey ? bills.find((candidate) => candidate._id === refs.idFor("bill", row.billKey!)) : undefined;
    const base = {
      _id: txnId(key),
      societyId: refs.societyId,
      connectionId: refs.connectionId,
      accountId: refs.cashAccountId,
      externalId: `csv-bill-${key}`,
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      counterparty: row.counterparty,
      method: row.method,
      status: "posted",
    };
    if (!bill) return base;
    // Linked payments: matched to the bill and categorised to Accounts payable.
    return {
      ...base,
      category: "Accounts payable",
      accountingAccountId: refs.accounts.payable,
      categorizedBy: "manual",
      reconciledAtISO: at(row.date, 18),
      reconciledByName: refs.treasurer.name,
      matchedKind: "bill",
      matchedId: bill._id,
      reconciliationNote: `Paid ${String(bill.vendorName)} bill ${String(bill.billNumber)}`,
    };
  });

  return { anchor: A, bills, accountingCounterparties: vendors, financialTransactions, journalEntries, journalLines };
}

export type DemoBillRows = ReturnType<typeof billDemoRows>;
