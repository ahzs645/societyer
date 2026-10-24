import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
import * as remit from "../shared/functions/payrollRemittance";
import {
  refreshPayrollRegister,
  payrollRecordRemittancePortable,
  payrollSaveSettingsPortable,
} from "../shared/functions/businessRegisters";
import {
  assertNativePayrollBankAccountPatch,
  assertNativePayrollBankPatch,
} from "../shared/functions/payrollPaymentGuard";
import {
  unmatchPortable,
  matchPortable,
} from "../shared/functions/reconciliation";
import { remittanceReadiness } from "../shared/payrollRemittance";
import {
  refreshFinancialProviderDataPortable,
  assertProviderConnectionRemovable,
} from "../shared/functions/financialProviderRefresh";
const societyId = "remittance_org",
  userId = "remittance_owner",
  rp = "123456789RP0001";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "remittance-owner",
  issuer: "https://remittance.test",
  userId,
  societyId,
} as const;
const at = "2026-05-31T12:00:00Z";
const amounts = {
  grossCents: 100000,
  cppEmployeeCents: 1000,
  cpp2EmployeeCents: 500,
  eiEmployeeCents: 200,
  incomeTaxCents: 10000,
  cppEmployerCents: 1000,
  cpp2EmployerCents: 500,
  eiEmployerCents: 280,
  netCents: 88300,
};
const seed = {
  secretVaultItems: [
    {
      _id: "vault_credential",
      societyId,
      name: "Synthetic approved payment service",
      service: "EDI trading partner",
      status: "Active",
      storageMode: "stored_encrypted",
      secretEncrypted: "never-project-credential-payload",
    },
  ],
  societies: [
    {
      _id: societyId,
      name: "Synthetic remittance organization",
      currency: "CAD",
    },
    { _id: "foreign_org", name: "Other organization" },
  ],
  users: [
    {
      _id: userId,
      societyId,
      role: "Owner",
      status: "Active",
      authSubject: principal.subject,
      authIssuer: principal.issuer,
    },
    {
      _id: "remittance_reader",
      societyId,
      role: "Director",
      status: "Active",
      authSubject: "reader",
      authIssuer: principal.issuer,
    },
  ],
  financialConnections: [
    { _id: "connection", societyId, provider: "bank_csv", status: "connected" },
  ],
  financialAccounts: [
    {
      _id: "bank",
      societyId,
      name: "Remittance operating bank",
      currency: "CAD",
      accountType: "Bank",
      connectionId: "connection",
      externalId: "bank_ext",
    },
    {
      _id: "liability",
      societyId,
      name: "CRA source deductions",
      currency: "CAD",
      accountType: "Liability",
    },
    {
      _id: "employer_expense",
      societyId,
      name: "Employer CPP and EI",
      currency: "CAD",
      accountType: "Expense",
    },
    {
      _id: "original_expense",
      societyId,
      name: "Unclassified original bank cost",
      currency: "CAD",
      accountType: "Expense",
    },
    {
      _id: "ar",
      societyId,
      name: "Accounts receivable",
      code: "1100",
      subtype: "receivable",
      currency: "CAD",
      accountType: "Asset",
    },
    {
      _id: "usd_bank",
      societyId,
      name: "USD bank",
      currency: "USD",
      accountType: "Bank",
    },
    {
      _id: "foreign_bank",
      societyId: "foreign_org",
      name: "Foreign bank",
      currency: "CAD",
      accountType: "Bank",
    },
  ],
  payrollSettings: [
    {
      _id: "settings",
      societyId,
      remitterType: "regular",
      payrollAccountNumber: rp,
      province: "BC",
      updatedAtISO: at,
    },
  ],
  payRuns: [15, 31].map((day) => ({
    _id: `run_${day}`,
    societyId,
    periodStart: day === 15 ? "2026-05-01" : "2026-05-16",
    periodEnd: `2026-05-${day}`,
    payDate: `2026-05-${day}`,
    source: "provider",
    providerName: "Actual reviewed payroll record",
    providerRunId: `MAY-${day}`,
    lines: [
      {
        employeeName: "Restricted source name should not be projected",
        ...amounts,
      },
    ],
    ...amounts,
    createdAtISO: at,
    updatedAtISO: at,
  })),
  payrollRemittances: [
    {
      _id: "foreign_obligation",
      societyId: "foreign_org",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      dueDate: "2026-06-15",
      amountDueCents: 999,
      createdAtISO: at,
      updatedAtISO: at,
    },
  ],
  financialTransactions: [
    {
      _id: "partial_bank",
      societyId,
      connectionId: "connection",
      accountId: "bank",
      externalId: "payment_partial",
      date: "2026-06-12",
      description: "Actual CRA payroll bill payment",
      amountCents: -12000,
      status: "posted",
    },
    {
      _id: "final_bank",
      societyId,
      connectionId: "connection",
      accountId: "bank",
      externalId: "payment_final",
      date: "2026-06-15",
      description: "Actual remaining CRA payroll bill payment",
      amountCents: -14960,
      status: "posted",
    },
    {
      _id: "pending_bank",
      societyId,
      connectionId: "connection",
      accountId: "bank",
      externalId: "payment_pending",
      date: "2026-06-12",
      description: "Pending scheduled PAD",
      amountCents: -12000,
      status: "pending",
    },
    {
      _id: "wrong_bank",
      societyId,
      connectionId: "connection",
      accountId: "usd_bank",
      externalId: "wrong_currency",
      date: "2026-06-12",
      description: "Foreign currency payment",
      amountCents: -12000,
      status: "posted",
    },
    {
      _id: "matched_bank",
      societyId,
      connectionId: "connection",
      accountId: "bank",
      externalId: "already_other",
      date: "2026-06-12",
      description: "Unrelated supplier",
      amountCents: -12000,
      status: "posted",
      matchedKind: "manual",
      matchedId: "unrelated",
    },
  ],
  journalEntries: [
    {
      _id: "bank_backfill",
      societyId,
      date: "2026-06-12",
      memo: "Original imported classification",
      source: "financialTransactionBackfill",
      sourceExternalId: "partial_bank",
      status: "posted",
      basis: "both",
      createdAtISO: at,
      updatedAtISO: at,
    },
  ],
  journalLines: [
    {
      _id: "backfill_expense",
      societyId,
      journalEntryId: "bank_backfill",
      accountId: "original_expense",
      amountCents: 12000,
      side: "debit",
      lineOrder: 0,
      financialTransactionId: "partial_bank",
      createdAtISO: at,
      updatedAtISO: at,
    },
    {
      _id: "backfill_cash",
      societyId,
      journalEntryId: "bank_backfill",
      accountId: "bank",
      amountCents: 12000,
      side: "credit",
      lineOrder: 1,
      financialTransactionId: "partial_bank",
      createdAtISO: at,
      updatedAtISO: at,
    },
  ],
};
for (const runtime of ["memory", "indexed-local"] as const) {
  const db =
    runtime === "memory"
      ? new MemoryDb({ seed: structuredClone(seed) })
      : new LocalStoreDb(
          new MemoryRowStore(structuredClone(seed), { indexed: true }),
        );
  const writeDb = {
    insert: (table: string, fields: Record<string, any>) =>
      db.transaction(() => db.insert(table, fields)),
    patch: (id: string, fields: Record<string, any>) =>
      db.transaction(() => db.patch(id, fields)),
    delete: (id: string) => db.transaction(() => db.delete(id)),
  };
  function context(
    actor: PortableMutationCtx["principal"] = principal,
  ): PortableMutationCtx {
    let pages = 0;
    const proxy = new Proxy(db, {
      get(target, key) {
        if (key === "query")
          return (table: string) => {
            const query = target.query(table);
            let wrapped: any;
            wrapped = new Proxy(query, {
              get(inner, method) {
                const value = Reflect.get(inner, method);
                if (typeof value !== "function") return value;
                return (...args: any[]) => {
                  if (method === "paginate")
                    assert.ok(
                      ++pages <= 1,
                      "at most one paginate per invocation",
                    );
                  const result = value.apply(inner, args);
                  return result === inner ? wrapped : result;
                };
              },
            });
            return wrapped;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return {
      db: proxy,
      principal: actor,
      capabilities: makeCapabilities({}),
    } as PortableMutationCtx;
  }
  const invoke = <T>(fn: (ctx: PortableMutationCtx) => Promise<T>) =>
    db.transaction(() => fn(context()));
  await invoke((c) => refreshPayrollRegister(c, societyId));
  const obligations = await invoke((c) =>
    remit.workspacePortable(c, { societyId, collection: "obligations" }),
  );
  const obligationId = obligations.rows[0]._id;
  const preview = await invoke((c) =>
    remit.previewPortable(c, { societyId, obligationId }),
  );
  assert.equal(preview.amountDueCents, 26960);
  assert.equal(preview.components.cpp2EmployeeCents, 1000);
  assert.equal(preview.components.cpp2EmployerCents, 1000);
  assert.equal(preview.components.incomeTaxCents, 20000);
  assert.equal(preview.payRunIds.length, 2);
  assert.ok(!JSON.stringify(preview).includes("Restricted source name"));
  assert.equal(preview.readiness.automationAvailable, false);
  const service = {
    kind: "service",
    runtime: "test",
    assurance: "trusted-internal",
    subject: "finance-only",
    societyId,
    actorUserId: userId,
    scopes: ["financials:read"],
  } as const;
  const financeOnly = await db.transaction(() =>
    remit.previewPortable(context(service as any), { societyId, obligationId }),
  );
  assert.equal(
    financeOnly.amountDueCents,
    26960,
    "aggregate finance access does not require employee PII",
  );
  await assert.rejects(
    db.transaction(() =>
      remit.workspacePortable(context(service as any), {
        societyId,
        collection: "credentials",
      }),
    ),
    /settings:read|scope|permission/i,
  );
  const vaultPage = await invoke((c) =>
    remit.workspacePortable(c, { societyId, collection: "credentials" }),
  );
  assert.ok(
    !JSON.stringify(vaultPage).includes("never-project-credential-payload"),
  );
  const fields = {
    obligationId,
    bankAccountId: "bank",
    amountCents: 26960,
    scheduledDate: "2026-06-12",
    channel: "financial_institution" as const,
    destinationReference: `CRA payroll deductions regular/quarterly ${rp}`,
    liabilityAccountId: "liability",
    employerExpenseAccountId: "employer_expense",
  };
  await assert.rejects(
    invoke((c) =>
      remit.saveDraftPortable(c, {
        societyId,
        fields: { ...fields, bankAccountId: "foreign_bank" },
      }),
    ),
    /not found|belong|workspace/i,
  );
  await assert.rejects(
    invoke((c) =>
      remit.saveDraftPortable(c, {
        societyId,
        fields: { ...fields, bankAccountId: "usd_bank" },
      }),
    ),
    /CAD bank/,
  );
  await assert.rejects(
    invoke((c) =>
      remit.previewPortable(c, {
        societyId,
        obligationId: "foreign_obligation",
      }),
    ),
    /not found|belong|workspace/i,
  );
  const id = await invoke((c) =>
    remit.saveDraftPortable(c, { societyId, fields }),
  );
  let row = await db.get(id, "payrollRemittancePlans");
  assert.equal(row!.version, 1);
  await invoke((c) =>
    remit.saveDraftPortable(c, {
      societyId,
      id,
      expectedVersion: 1,
      fields: { ...fields, notes: "Reviewed exact CRA payee" },
    }),
  );
  row = await db.get(id, "payrollRemittancePlans");
  assert.equal(row!.revisions.length, 1);
  assert.equal(row!.version, 2);
  await assert.rejects(
    invoke((c) =>
      remit.approvePortable(c, { societyId, id, expectedVersion: 1 }),
    ),
    /changed/,
  );
  await invoke((c) =>
    remit.approvePortable(c, { societyId, id, expectedVersion: 2 }),
  );
  await assert.rejects(
    invoke((c) =>
      payrollRecordRemittancePortable(c, {
        id: obligationId,
        paidCents: 5000,
        paidOn: "2026-06-12",
        confirmationNumber: "Legacy route must not bypass the approved plan",
      }),
    ),
    /approved|payment plan/i,
  );
  await assert.rejects(
    invoke((c) =>
      payrollRecordRemittancePortable(c, { id: obligationId, clear: true }),
    ),
    /approved|payment plan/i,
  );
  await writeDb.patch(obligationId, {
    paidCents: 5000,
    paidOn: "2026-06-12",
    payrollAccountNumber: rp,
  });
  await assert.rejects(
    invoke((c) =>
      remit.recordPreparedExportPortable(c, {
        societyId,
        id,
        expectedVersion: 3,
      }),
    ),
    /outstanding CRA obligation/,
  );
  assert.equal(
    (await db.get(id, "payrollRemittancePlans"))!.version,
    3,
    "unsafe export refuses without changing the approved plan",
  );
  await writeDb.patch(obligationId, {
    paidCents: undefined,
    paidOn: undefined,
    payrollAccountNumber: undefined,
  });
  await assert.rejects(
    invoke((c) =>
      remit.saveDraftPortable(c, { societyId, id, expectedVersion: 3, fields }),
    ),
    /retain/,
  );
  const exported = await invoke((c) =>
    remit.recordPreparedExportPortable(c, {
      societyId,
      id,
      expectedVersion: 3,
    }),
  );
  assert.match(exported, /PREPARED INSTRUCTIONS ONLY/);
  assert.match(exported, /No payment has been initiated/);
  assert.match(exported, /CAD 269.60/);
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    undefined,
    "export is never payment",
  );
  await invoke((c) =>
    remit.recordManualSubmissionPortable(c, {
      societyId,
      id,
      expectedVersion: 4,
      reference: "Actual bank submission acknowledgement",
    }),
  );
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    undefined,
    "external submission is never settlement",
  );
  await assert.rejects(
    invoke((c) =>
      remit.saveDraftPortable(c, {
        societyId,
        fields: { ...fields, amountCents: 1 },
      }),
    ),
    /other approved/,
  );
  const actual = {
    societyId,
    id,
    date: "2026-06-12",
    amountCents: 12000,
    evidence: "Actual settled bank entry and reviewed CRA RP payee",
    destinationConfirmed: true,
    idempotencyKey: "actual-partial",
    transactionId: "partial_bank",
    postToLedger: true,
  };
  for (const [transactionId, pattern] of [
    ["pending_bank", /pending/i],
    ["wrong_bank", /match/i],
    ["matched_bank", /another reconciliation/i],
  ] as const)
    await assert.rejects(
      invoke((c) =>
        remit.reconcilePaymentPortable(c, { ...actual, transactionId }),
      ),
      pattern,
    );
  await assert.rejects(
    invoke((c) =>
      remit.reconcilePaymentPortable(c, { ...actual, amountCents: 12001 }),
    ),
    /match/,
  );
  await assert.rejects(
    invoke((c) =>
      remit.reconcilePaymentPortable(c, {
        ...actual,
        destinationConfirmed: false,
      }),
    ),
    /Confirm/,
  );
  const closedId = await writeDb.insert("booksSettings", {
    societyId,
    closeDate: "2026-06-12",
  });
  await assert.rejects(
    invoke((c) => remit.reconcilePaymentPortable(c, actual)),
    /closed books/,
  );
  await writeDb.delete(closedId);
  const foreignCash = await writeDb.insert("financialAccounts", {
    societyId,
    name: "Linked cash ledger",
    currency: "USD",
    accountType: "Asset",
  });
  const foreignProfile = await writeDb.insert("bankAccountProfiles", {
    societyId,
    accountId: "bank",
    ledgerAccountId: foreignCash,
  });
  await assert.rejects(
    invoke((c) => remit.reconcilePaymentPortable(c, actual)),
    /resolved cash ledger/,
  );
  await writeDb.patch(foreignCash, { currency: "CAD", accountType: "Expense" });
  await assert.rejects(
    invoke((c) => remit.reconcilePaymentPortable(c, actual)),
    /resolved cash ledger/,
  );
  assert.equal(
    (await db.query("journalEntries").collect()).length,
    1,
    "invalid resolved cash mapping cannot write a mirror or settlement",
  );
  assert.equal(
    (await db.query("payrollRemittanceSettlements").collect()).length,
    0,
  );
  await writeDb.delete(foreignProfile);
  await writeDb.delete(foreignCash);
  const settlementId = await invoke((c) =>
    remit.reconcilePaymentPortable(c, actual),
  );
  assert.equal(
    await invoke((c) => remit.reconcilePaymentPortable(c, actual)),
    settlementId,
    "same exact settlement is idempotent",
  );
  await assert.rejects(
    invoke((c) =>
      remit.reconcilePaymentPortable(c, { ...actual, postToLedger: false }),
    ),
    /different actual/,
  );
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    12000,
  );
  assert.equal(
    (await db.get(id, "payrollRemittancePlans"))!.status,
    "manual_submitted",
  );
  const remainingInstructions = await invoke((c) =>
    remit.recordPreparedExportPortable(c, {
      societyId,
      id,
      expectedVersion: 6,
    }),
  );
  assert.match(remainingInstructions, /Amount: CAD 149\.60/);
  assert.match(remainingInstructions, /Original approved plan: CAD 269\.60/);
  assert.match(
    remainingInstructions,
    /Recorded actual settlements: CAD 120\.00/,
  );
  assert.equal(
    (await db.get("partial_bank", "financialTransactions"))!.matchedId,
    settlementId,
  );
  const bank = await db.get("partial_bank", "financialTransactions");
  await assert.rejects(
    invoke((c) => assertNativePayrollBankPatch(c, bank!, { amountCents: -1 })),
    /retained|finalized/i,
  );
  await assert.rejects(
    invoke((c) =>
      assertNativePayrollBankAccountPatch(
        c,
        seed.financialAccounts.find((r) => r._id === "bank") as any,
        { currency: "USD", accountType: "Bank" },
      ),
    ),
    /retained/,
  );
  await assert.rejects(
    invoke((c) => unmatchPortable(c, { txnId: "partial_bank" })),
    /retained|finalized/i,
  );
  await assert.rejects(
    invoke((c) =>
      matchPortable(c, {
        txnId: "final_bank",
        matchedKind: "payroll_remittance",
        matchedId: settlementId,
      }),
    ),
    /approved payroll remittance/,
  );
  const providerAccount = {
    externalId: "bank_ext",
    name: "Remittance operating bank",
    currency: "CAD",
    accountType: "Bank",
    isRestricted: false,
  };
  const providerTx = {
    externalId: "payment_partial",
    accountExternalId: "bank_ext",
    date: "2026-06-12",
    description: "Refreshed settled CRA payment",
    amountCents: -12000,
  };
  await invoke((c) =>
    refreshFinancialProviderDataPortable(c, {
      societyId,
      connectionId: "connection",
      accounts: [providerAccount],
      transactions: [providerTx],
    }),
  );
  assert.equal(
    (await db.get("partial_bank", "financialTransactions"))!.matchedId,
    settlementId,
    "provider refresh retains payment link",
  );
  await assert.rejects(
    invoke((c) =>
      refreshFinancialProviderDataPortable(c, {
        societyId,
        connectionId: "connection",
        accounts: [providerAccount],
        transactions: [{ ...providerTx, amountCents: -12001 }],
      }),
    ),
    /recorded payment|retained|finalized/i,
  );
  await assert.rejects(
    invoke((c) =>
      refreshFinancialProviderDataPortable(c, {
        societyId,
        connectionId: "connection",
        accounts: [{ ...providerAccount, currency: "USD" }],
        transactions: [providerTx],
      }),
    ),
    /currency and account type/,
  );
  await assert.rejects(
    invoke((c) =>
      assertProviderConnectionRemovable(c, societyId, "connection"),
    ),
    /recorded payment|posted bank journal/,
  );
  await assert.rejects(
    invoke((c) =>
      payrollRecordRemittancePortable(c, { id: obligationId, clear: true }),
    ),
    /settlement|remittance plan/i,
  );
  await invoke((c) =>
    remit.reconcilePaymentPortable(c, {
      ...actual,
      date: "2026-06-15",
      amountCents: 14960,
      transactionId: "final_bank",
      idempotencyKey: "actual-final",
      evidence: "Remaining actual posted CRA payroll payment",
      craConfirmationNumber: "CRA-RECEIPT-FINAL",
    }),
  );
  assert.equal((await db.get(id, "payrollRemittancePlans"))!.status, "settled");
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    26960,
  );
  const settlements = await db.query("payrollRemittanceSettlements").collect();
  assert.equal(
    settlements.reduce(
      (s, r) => s + (r.employerContributionsRecognizedCents as number),
      0,
    ),
    3560,
    "partial employer cash recognition conserves actual cents",
  );
  const entries = await db.query("journalEntries").collect(),
    lines = await db.query("journalLines").collect(),
    cash = lines
      .filter((l) => l.accountId === "bank")
      .reduce(
        (n, l) => n + (l.side === "debit" ? l.amountCents : -l.amountCents),
        0,
      );
  assert.equal(
    cash,
    -26960,
    "backfill mirror plus settlement records cash once",
  );
  assert.equal(
    lines
      .filter((l) => l.accountId === "original_expense")
      .reduce(
        (n, l) => n + (l.side === "debit" ? l.amountCents : -l.amountCents),
        0,
      ),
    0,
    "original expense is reversed, not duplicated",
  );
  assert.equal(
    entries.filter((e) => e.source === "payroll_remittance_cash_recognition")
      .length,
    2,
  );
  assert.equal(
    entries.filter((e) => e.source === "payroll_reversal").length,
    1,
  );
  await invoke((c) => refreshPayrollRegister(c, societyId));
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    26960,
    "rebuild retains actual settlement",
  );
  const sourceRun = await db.get("run_15", "payRuns");
  await writeDb.patch("run_15", { updatedAtISO: "2026-06-01T00:00:00Z" });
  await assert.rejects(
    invoke((c) =>
      remit.recordPreparedExportPortable(c, {
        societyId,
        id,
        expectedVersion: 7,
      }),
    ),
    /Approve|changed/i,
  );
  await writeDb.patch("run_15", { updatedAtISO: sourceRun!.updatedAtISO });
  await writeDb.insert("payRuns", {
    ...amounts,
    societyId,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    payDate: "2026-06-15",
    source: "provider",
    createdAtISO: at,
    updatedAtISO: at,
  });
  await invoke((c) => refreshPayrollRegister(c, societyId));
  const nextObligation = (await db.query("payrollRemittances").collect()).find(
    (r) => r.societyId === societyId && r.periodStart === "2026-06-01",
  )!;
  const moreFields = {
    ...fields,
    obligationId: nextObligation._id,
    amountCents: 100,
  };
  let last = "";
  for (let i = 0; i < 12; i++)
    last = await invoke((c) =>
      remit.saveDraftPortable(c, {
        societyId,
        fields: { ...moreFields, notes: `Draft ${i + 1}` },
      }),
    );
  const firstPage = await invoke((c) =>
    remit.workspacePortable(c, { societyId, collection: "plans" }),
  );
  assert.equal(firstPage.rows.length, 10);
  assert.equal(firstPage.isDone, false);
  const secondPage = await invoke((c) =>
    remit.workspacePortable(c, {
      societyId,
      collection: "plans",
      cursor: firstPage.continueCursor,
    }),
  );
  assert.ok(secondPage.rows.length >= 3);
  const direct = await invoke((c) =>
    remit.workspacePortable(c, { societyId, collection: "plan", id: last }),
  );
  assert.equal(direct.plan._id, last);
  assert.ok(
    !firstPage.rows.some((r: any) => r.source?.payrollAccountNumber),
    "lists use masked RP metadata",
  );
  const stale = await invoke((c) =>
    remit.saveDraftPortable(c, { societyId, fields: moreFields }),
  );
  await writeDb.patch("settings", { payrollAccountNumber: "987654321RP0001" });
  assert.equal(
    (await invoke((c) => remit.previewPortable(c, { societyId, obligationId })))
      .payrollAccountNumber,
    rp,
    "paid historical obligation keeps its original RP after global change",
  );
  assert.equal(
    (
      await invoke((c) =>
        remit.previewPortable(c, {
          societyId,
          obligationId: nextObligation._id,
        }),
      )
    ).payrollAccountNumber,
    "987654321RP0001",
    "unpaid future period uses the current global RP",
  );
  assert.equal(
    (await db.get(obligationId, "payrollRemittances"))!.paidCents,
    26960,
  );
  await assert.rejects(
    invoke((c) =>
      remit.approvePortable(c, { societyId, id: stale, expectedVersion: 1 }),
    ),
    /changed/,
  );
  await writeDb.patch("settings", { payrollAccountNumber: rp });
  const reader = {
    ...principal,
    subject: "reader",
    userId: "remittance_reader",
  };
  await assert.rejects(
    db.transaction(() =>
      remit.saveDraftPortable(context(reader), {
        societyId,
        fields: moreFields,
      }),
    ),
    /permission/i,
  );
  const partialPlan = await invoke((c) =>
    remit.saveDraftPortable(c, {
      societyId,
      fields: { ...moreFields, amountCents: 13480 },
    }),
  );
  await invoke((c) =>
    remit.approvePortable(c, {
      societyId,
      id: partialPlan,
      expectedVersion: 1,
    }),
  );
  await invoke((c) =>
    remit.reconcilePaymentPortable(c, {
      societyId,
      id: partialPlan,
      date: "2026-07-10",
      amountCents: 5000,
      evidence: "Actual CRA credited receipt for first June instalment",
      destinationConfirmed: true,
      idempotencyKey: "june-partial",
      craConfirmationNumber: "CRA-JUNE-PARTIAL",
      postToLedger: false,
    }),
  );
  const juneRun = (await db.query("payRuns").collect()).find(
    (r) => r.societyId === societyId && r.payDate === "2026-06-15",
  )!;
  await writeDb.patch(juneRun._id, {
    incomeTaxCents: 8000,
    netCents: 90300,
    updatedAtISO: "2026-07-11T00:00:00Z",
  });
  await invoke((c) => refreshPayrollRegister(c, societyId));
  await assert.rejects(
    invoke((c) =>
      remit.reconcilePaymentPortable(c, {
        societyId,
        id: partialPlan,
        date: "2026-07-15",
        amountCents: 6480,
        evidence: "Actual final corrected June receipt",
        destinationConfirmed: true,
        idempotencyKey: "june-stale",
        craConfirmationNumber: "CRA-JUNE-FINAL",
        postToLedger: false,
      }),
    ),
    /changed/,
  );
  await assert.rejects(
    invoke((c) =>
      remit.saveDraftPortable(c, {
        societyId,
        fields: { ...moreFields, amountCents: 6480 },
      }),
    ),
    /other approved/,
  );
  await invoke((c) =>
    remit.rejectPortable(c, {
      societyId,
      id: partialPlan,
      expectedVersion: 3,
      reason:
        "Release only the unpaid commitment after corrected June source amounts; retain actual CRA receipt",
    }),
  );
  assert.equal(
    (await db.get(nextObligation._id, "payrollRemittances"))!.paidCents,
    5000,
    "cancelling remaining commitment preserves actual paid amount",
  );
  const cancelled = await db.get(partialPlan, "payrollRemittancePlans");
  assert.equal(cancelled!.status, "rejected");
  assert.equal(
    cancelled!.history.at(-1).action,
    "remaining_commitment_cancelled",
  );
  assert.equal(
    (await db.query("payrollRemittanceSettlements").collect()).filter(
      (s) => s.planId === partialPlan,
    ).length,
    1,
  );
  const replacement = await invoke((c) =>
    remit.saveDraftPortable(c, {
      societyId,
      fields: { ...moreFields, amountCents: 6480 },
    }),
  );
  await invoke((c) =>
    remit.approvePortable(c, {
      societyId,
      id: replacement,
      expectedVersion: 1,
    }),
  );
  await assert.rejects(
    invoke((c) =>
      remit.reconcilePaymentPortable(c, {
        societyId,
        id: replacement,
        date: "2026-07-15",
        amountCents: 6480,
        evidence: "Attempted duplicate original CRA receipt",
        destinationConfirmed: true,
        idempotencyKey: "june-duplicate",
        craConfirmationNumber: "CRA-JUNE-PARTIAL",
        postToLedger: false,
      }),
    ),
    /already recorded/,
  );
  await invoke((c) =>
    remit.reconcilePaymentPortable(c, {
      societyId,
      id: replacement,
      date: "2026-07-15",
      amountCents: 6480,
      evidence: "Actual final corrected June receipt",
      destinationConfirmed: true,
      idempotencyKey: "june-final",
      craConfirmationNumber: "CRA-JUNE-FINAL",
      postToLedger: false,
    }),
  );
  assert.equal(
    (await db.get(nextObligation._id, "payrollRemittances"))!.paidCents,
    11480,
  );
  assert.equal(
    (await db.get(replacement, "payrollRemittancePlans"))!.status,
    "settled",
  );
  await writeDb.insert("payRuns", {
    ...amounts,
    societyId,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-15",
    payDate: "2026-08-15",
    source: "provider",
    createdAtISO: at,
    updatedAtISO: at,
  });
  await invoke((c) => refreshPayrollRegister(c, societyId));
  const legacyObligation = (
    await db.query("payrollRemittances").collect()
  ).find((r) => r.societyId === societyId && r.periodStart === "2026-08-01")!;
  await writeDb.patch(legacyObligation._id, {
    paidCents: 2000,
    paidOn: "2026-09-01",
    confirmationNumber: "Actual legacy receipt without captured RP",
  });
  await assert.rejects(
    invoke((c) =>
      remit.previewPortable(c, {
        societyId,
        obligationId: legacyObligation._id,
      }),
    ),
    /legacy paid obligation/,
  );
  const switchRp = {
    societyId,
    remitterType: "regular",
    province: "BC",
    payrollAccountNumber: "987654321RP0002",
  };
  await assert.rejects(
    invoke((c) =>
      payrollRecordRemittancePortable(c, {
        id: legacyObligation._id,
        clear: true,
      }),
    ),
    /historical|attribution/i,
  );
  assert.equal(
    (await db.get(legacyObligation._id, "payrollRemittances"))!.paidCents,
    2000,
  );
  await assert.rejects(
    invoke((c) => payrollSaveSettingsPortable(c, switchRp)),
    /legacy|attribution|historical|unbound/i,
  );
  await assert.rejects(
    invoke((c) =>
      remit.confirmLegacyAccountPortable(c, {
        societyId,
        obligationId: "foreign_obligation",
        payrollAccountNumber: rp,
        evidence: "Actual historical statement",
      }),
    ),
    /not found|belong|workspace/i,
  );
  await invoke((c) =>
    remit.confirmLegacyAccountPortable(c, {
      societyId,
      obligationId: legacyObligation._id,
      payrollAccountNumber: rp,
      evidence:
        "Reviewed actual CRA statement and legacy payment receipt confirming original RP0001",
    }),
  );
  const legacyBound = await db.get(legacyObligation._id, "payrollRemittances");
  assert.equal(legacyBound!.paidCents, 2000);
  assert.equal(legacyBound!.paidOn, "2026-09-01");
  assert.equal(legacyBound!.payrollAccountNumber, rp);
  assert.equal(legacyBound!.rpAccountConfirmedByUserId, userId);
  await assert.rejects(
    invoke((c) =>
      remit.confirmLegacyAccountPortable(c, {
        societyId,
        obligationId: legacyObligation._id,
        payrollAccountNumber: "987654321RP0002",
        evidence: "Attempted account reassignment",
      }),
    ),
    /cannot be reassigned/,
  );
  await invoke((c) => payrollSaveSettingsPortable(c, switchRp));
  const historical = await invoke((c) =>
    remit.previewPortable(c, { societyId, obligationId: legacyObligation._id }),
  );
  assert.equal(historical.payrollAccountNumber, rp);
  assert.equal(historical.outstandingCents, 11480);
  const legacyPlan = await invoke((c) =>
    remit.saveDraftPortable(c, {
      societyId,
      fields: {
        ...fields,
        obligationId: legacyObligation._id,
        amountCents: 11480,
        scheduledDate: "2026-09-15",
      },
    }),
  );
  await invoke((c) =>
    remit.approvePortable(c, { societyId, id: legacyPlan, expectedVersion: 1 }),
  );
  await invoke((c) =>
    remit.reconcilePaymentPortable(c, {
      societyId,
      id: legacyPlan,
      date: "2026-09-15",
      amountCents: 11480,
      evidence:
        "Actual remaining CRA payment to the original historical RP account",
      destinationConfirmed: true,
      idempotencyKey: "legacy-remaining-old-rp",
      craConfirmationNumber: "CRA-LEGACY-OLD-RP-REMAINING",
      postToLedger: false,
    }),
  );
  assert.equal(
    (await db.get(legacyObligation._id, "payrollRemittances"))!.paidCents,
    13480,
  );
  assert.equal(
    (await db.get(legacyObligation._id, "payrollRemittances"))!
      .payrollAccountNumber,
    rp,
  );
  await writeDb.insert("payRuns", {
    ...amounts,
    societyId,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    payDate: "2026-09-15",
    source: "provider",
    createdAtISO: at,
    updatedAtISO: at,
  });
  await invoke((c) => refreshPayrollRegister(c, societyId));
  const futureObligation = (
    await db.query("payrollRemittances").collect()
  ).find((r) => r.societyId === societyId && r.periodStart === "2026-09-01")!;
  assert.equal(
    (
      await invoke((c) =>
        remit.previewPortable(c, {
          societyId,
          obligationId: futureObligation._id,
        }),
      )
    ).payrollAccountNumber,
    "987654321RP0002",
  );
  const readyFields = {
    rpRegistrationConfirmed: true,
    remitterCategoryConfirmed: true,
    mandateConfirmed: true,
    mandateReference: "Actual bank authorization on file",
    statusWebhookConfirmed: true,
    leadBusinessDays: 5,
    timezone: "America/Vancouver",
    providerContractReference: "Reviewed EDI partner contract",
    approvalPolicyReference: "Two-person policy",
    cutoffLocalTime: "14:00",
    retryPolicyReference: "Reviewed callback and retry policy",
    credentialVaultItemId: "vault_credential",
  };
  await invoke((c) =>
    remit.saveReadinessPortable(c, { societyId, fields: readyFields }),
  );
  await db.transaction(() =>
    remit.saveReadinessPortable(
      context({
        ...service,
        scopes: ["financials:read", "financials:write"],
      } as any),
      { societyId, fields: { ...readyFields, leadBusinessDays: 6 } },
    ),
  );
  await assert.rejects(
    db.transaction(() =>
      remit.saveReadinessPortable(
        context({
          ...service,
          scopes: ["financials:read", "financials:write"],
        } as any),
        {
          societyId,
          fields: {
            ...readyFields,
            credentialVaultItemId: "another_vault_item",
          },
        },
      ),
    ),
    /settings:read|scope|permission/i,
  );
  assert.equal(
    remittanceReadiness(readyFields).automationAvailable,
    false,
    "configured readiness never fabricates a connector",
  );
  console.log(
    `CRA remittance ${runtime}: source/CPP2, scope/privacy, approval/version/reservations, export != payment, actual partial/idempotent settlement, closed books, ledger mirror/cash recognition, source locks, paging and readiness passed`,
  );
}
