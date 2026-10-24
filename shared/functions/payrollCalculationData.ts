import type {
  PortableMutationCtx,
  PortableQueryCtx,
  PortableQuery,
} from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  resolutionCalendarDate,
  resolutionTimeZone,
} from "../writtenResolutionEvidence";
import type {
  CalculationInput,
  EarningCodeFields,
  EmployeeProfileFields,
  EmployerSettingsFields,
  OpeningBalanceFields,
  PayrollCalculationCollection,
  PayrollCalculationRecord,
  WorkDayFields,
} from "../payrollCalculation";
import {
  cleanPayrollCode,
  cleanPayrollEmployer,
  cleanPayrollOpening,
  cleanPayrollProfile,
  cleanPayrollWork,
  payrollDate,
  payrollJson,
  payrollText,
  payrollYear,
} from "../payrollCalculationValidation";

export type PayrollRow = { _id: string; societyId: string; [key: string]: any };
export async function payrollRead(
  ctx: PortableQueryCtx,
  societyId: string,
  employees = true,
) {
  await requirePermissionPortable(ctx, societyId, "financials:read");
  if (employees)
    await requirePermissionPortable(ctx, societyId, "employees:read");
}
export async function payrollWrite(
  ctx: PortableQueryCtx,
  societyId: string,
  employees = true,
) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
  if (employees)
    await requirePermissionPortable(ctx, societyId, "employees:read");
}
export async function payrollActor(ctx: PortableQueryCtx, societyId: string) {
  return principalUserId(ctx, societyId);
}
export async function payrollOrganization(
  ctx: PortableQueryCtx,
  societyId: string,
) {
  const organization = await ctx.db.get(societyId, "societies");
  if (!organization) throw new Error("Organization not found.");
  const today =
    resolutionCalendarDate(
      new Date().toISOString(),
      resolutionTimeZone(organization),
    ) ?? new Date().toISOString().slice(0, 10);
  return { organization, today };
}
export async function payrollBounded(
  query: PortableQuery<PayrollRow>,
  limit: number,
  name: string,
) {
  const result = await query.take(limit + 1);
  if (result.length > limit)
    throw new Error(
      `${name} exceeds the complete ${limit}-record calculation bound. Narrow the source period or reconcile through explicit same-employer opening records.`,
    );
  return result;
}
export function payrollSafeEmployee(employee: PayrollRow, today: string) {
  return {
    _id: employee._id,
    name: `${String(employee.firstName ?? "")} ${String(employee.lastName ?? "")}`.trim(),
    position: employee.role,
    startDate: employee.startDate,
    endDate: employee.endDate,
    status:
      employee.startDate > today
        ? "upcoming"
        : employee.endDate && employee.endDate < today
          ? "ended"
          : "active",
  };
}
const moneyFields = [
  "grossCents",
  "cppEmployeeCents",
  "cpp2EmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "federalTaxCents",
  "provincialTaxCents",
  "additionalIncomeTaxCents",
  "otherDeductionsCents",
  "cppEmployerCents",
  "cpp2EmployerCents",
  "eiEmployerCents",
  "netCents",
  "nonCashTaxableCents",
  "nonTaxableCashCents",
];
export function payrollSafeRun(row: PayrollRow) {
  const pickAmounts = (value: any) =>
    Object.fromEntries(
      moneyFields
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    );
  return {
    _id: row._id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate: row.payDate,
    source: row.source,
    providerName: row.providerName,
    providerRunId: row.providerRunId,
    runType: row.runType,
    calculationId: row.calculationId,
    correctsRunId: row.correctsRunId,
    reversedDate: row.reversedDate,
    reversalId: row.reversalId,
    ...pickAmounts(row),
    lines: row.lines?.map((line: any) => ({
      employeeId: line.employeeId,
      employeeName: line.employeeName,
      providerEmployeeId: line.providerEmployeeId,
      ...pickAmounts(line),
      provinceOfEmployment: line.provinceOfEmployment,
      ehtLocationId: line.ehtLocationId,
      ehtAttributionBasis: line.ehtAttributionBasis,
      ehtAttributionEvidence: line.ehtAttributionEvidence,
      regularClassifiedBases: line.regularClassifiedBases,
      bonusClassifiedBases: line.bonusClassifiedBases,
      classifiedBases: line.classifiedBases,
      deductionYtdDelta: line.deductionYtdDelta,
      insurableHours: line.insurableHours,
    })),
  };
}
export function payrollHydrate(row: PayrollRow): PayrollCalculationRecord {
  const input = JSON.parse(row.inputJson) as CalculationInput,
    result = JSON.parse(row.resultJson);
  result.employees = result.employees.map((employee: any) => ({
    ...employee,
    ...(employee.statement
      ? {
          statement: {
            ...employee.statement,
            calculationId: row._id,
            calculationVersion: row.version,
            statementNumber: `PAY-${row._id.slice(-10).toUpperCase()}-${employee.employeeId.slice(-6).toUpperCase()}`,
            status: row.status,
            finalizedAtISO: row.finalizedAtISO,
          },
        }
      : {}),
  }));
  const { inputJson: _input, resultJson: _result, ...metadata } = row;
  return { ...metadata, input, result } as PayrollCalculationRecord;
}
function decodeCursor(raw: string | null | undefined, scope: string) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid payroll page; return to the first page.");
  }
  if (!parsed || parsed.scope !== scope || typeof parsed.cursor !== "string")
    throw new Error("This payroll page belongs to another selection.");
  return parsed.cursor as string;
}

export async function workspacePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    collection: PayrollCalculationCollection;
    cursor?: string | null;
    employeeId?: string;
    id?: string;
    year?: number;
    from?: string;
    to?: string;
  },
) {
  const privateCollection = [
    "profiles",
    "work",
    "openings",
    "calculations",
    "calculation",
    "employees",
    "recorded_runs",
  ].includes(args.collection);
  await payrollRead(ctx, args.societyId, privateCollection);
  if (args.collection === "grants")
    await requirePermissionPortable(ctx, args.societyId, "grants:read");
  const { organization, today } = await payrollOrganization(
      ctx,
      args.societyId,
    ),
    year = payrollYear(args.year ?? Number(today.slice(0, 4)));
  const metadata = { today, year, organization: { name: organization.name } };
  if (args.employeeId)
    await getOwned(ctx, "employees", args.employeeId, args.societyId);
  if (args.collection === "calculation") {
    if (!args.id) throw new Error("Choose a calculation.");
    return {
      page: [],
      isDone: true,
      continueCursor: "",
      detail: payrollHydrate(
        await getOwned<PayrollRow>(
          ctx,
          "payrollCalculations",
          args.id,
          args.societyId,
        ),
      ),
      ...metadata,
    };
  }
  const scope = JSON.stringify([
      args.societyId,
      args.collection,
      args.employeeId ?? "",
      year,
      args.from ?? "",
      args.to ?? "",
    ]),
    cursor = decodeCursor(args.cursor, scope);
  const from = payrollDate(args.from ?? `${year}-01-01`),
    to = payrollDate(args.to ?? `${year}-12-31`);
  if (to < from) throw new Error("Payroll source dates must be ordered.");
  let query: PortableQuery<PayrollRow>;
  switch (args.collection) {
    case "employer":
      query = ctx.db
        .query<PayrollRow>("payrollEmployerProfiles")
        .withIndex("by_society_year", (q) =>
          q.eq("societyId", args.societyId).eq("year", year),
        );
      break;
    case "profiles":
      query = args.employeeId
        ? ctx.db
            .query<PayrollRow>("payrollEmployeeProfiles")
            .withIndex("by_society_employee_from", (q) =>
              q
                .eq("societyId", args.societyId)
                .eq("employeeId", args.employeeId),
            )
        : ctx.db
            .query<PayrollRow>("payrollEmployeeProfiles")
            .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "codes":
      query = ctx.db
        .query<PayrollRow>("payrollEarningCodes")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "work":
      query = args.employeeId
        ? ctx.db
            .query<PayrollRow>("payrollWorkDays")
            .withIndex("by_society_employee_date", (q) =>
              q
                .eq("societyId", args.societyId)
                .eq("employeeId", args.employeeId)
                .gte("date", from)
                .lte("date", to),
            )
        : ctx.db
            .query<PayrollRow>("payrollWorkDays")
            .withIndex("by_society_date", (q) =>
              q
                .eq("societyId", args.societyId)
                .gte("date", from)
                .lte("date", to),
            );
      break;
    case "openings":
      query = args.employeeId
        ? ctx.db
            .query<PayrollRow>("payrollOpeningBalances")
            .withIndex("by_society_employee_year", (q) =>
              q
                .eq("societyId", args.societyId)
                .eq("employeeId", args.employeeId)
                .eq("year", year),
            )
        : ctx.db
            .query<PayrollRow>("payrollOpeningBalances")
            .withIndex("by_society_year", (q) =>
              q.eq("societyId", args.societyId).eq("year", year),
            );
      break;
    case "calculations":
      query = ctx.db
        .query<PayrollRow>("payrollCalculations")
        .withIndex("by_society_year", (q) =>
          q.eq("societyId", args.societyId).eq("year", year),
        );
      break;
    case "recorded_runs":
      query = ctx.db
        .query<PayrollRow>("payRuns")
        .withIndex("by_society_pay_date", (q) =>
          q
            .eq("societyId", args.societyId)
            .gte("payDate", from)
            .lte("payDate", to),
        );
      break;
    case "employees":
      query = ctx.db
        .query<PayrollRow>("employees")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "accounts":
      query = ctx.db
        .query<PayrollRow>("financialAccounts")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "funds":
      query = ctx.db
        .query<PayrollRow>("fundRestrictions")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "grants":
      query = ctx.db
        .query<PayrollRow>("grants")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
      break;
    case "transactions":
      query = ctx.db
        .query<PayrollRow>("financialTransactions")
        .withIndex("by_society_date", (q) =>
          q.eq("societyId", args.societyId).gte("date", from).lte("date", to),
        );
      break;
    default:
      throw new Error("Choose a supported payroll collection.");
  }
  const result = await query.order("desc").paginate({
    numItems: ["calculations", "recorded_runs"].includes(args.collection)
      ? 4
      : 25,
    cursor,
    maximumBytesRead: 1_500_000,
  });
  const accounts = new Map<string, PayrollRow>();
  const page = await Promise.all(
    result.page.map(async (row) => {
      if (args.collection === "calculations") {
        const result = JSON.parse(row.resultJson);
        return {
          _id: row._id,
          status: row.status,
          version: row.version,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          payDate: row.payDate,
          runType: row.runType,
          employeeIds: row.employeeIds,
          totals: result.totals,
          blockerCount: result.blockers.length,
          payRunId: row.payRunId,
          reversedDate: row.reversedDate,
        };
      }
      if (args.collection === "recorded_runs") return payrollSafeRun(row);
      if (args.collection === "employees")
        return payrollSafeEmployee(row, today);
      if (args.collection === "accounts")
        return {
          _id: row._id,
          name: row.name,
          code: row.code,
          accountType: row.accountType,
          subtype: row.subtype,
          currency: row.currency,
        };
      if (args.collection === "funds" || args.collection === "grants")
        return {
          _id: row._id,
          name: row.name ?? row.title ?? row.programName ?? "Unnamed source",
          status: row.status,
        };
      if (args.collection === "transactions") {
        let account = accounts.get(row.accountId);
        if (!account) {
          account = await getOwned<PayrollRow>(
            ctx,
            "financialAccounts",
            row.accountId,
            args.societyId,
          );
          accounts.set(row.accountId, account);
        }
        return {
          _id: row._id,
          date: row.date,
          description: row.description,
          amountCents: row.amountCents,
          currency: account.currency ?? null,
          accountType: account.accountType,
          accountName: account.name,
          status: row.status ?? "recorded",
          matchedKind: row.matchedKind,
          matchedId: row.matchedId,
        };
      }
      return row;
    }),
  );
  return {
    ...metadata,
    page,
    isDone: result.isDone,
    continueCursor: result.isDone
      ? ""
      : JSON.stringify({ scope, cursor: result.continueCursor }),
  };
}

async function save(
  ctx: PortableMutationCtx,
  societyId: string,
  table: string,
  fields: Record<string, unknown>,
  old: PayrollRow | null,
  extra: Record<string, unknown> = {},
) {
  payrollJson(fields, 120000);
  const at = new Date().toISOString(),
    actor = await payrollActor(ctx, societyId);
  const record = {
    ...fields,
    ...extra,
    societyId,
    createdByUserId: old?.createdByUserId ?? actor,
    createdAtISO: old?.createdAtISO ?? at,
    updatedByUserId: actor,
    updatedAtISO: at,
    version: (old?.version ?? 0) + 1,
  };
  if (old) {
    await ctx.db.replace(old._id, record);
    return old._id;
  }
  return ctx.db.insert(table, record);
}
async function representedRuns(
  ctx: PortableQueryCtx,
  societyId: string,
  ids: string[],
  year: number,
  coveredThroughDate: string,
  employeeId?: string,
) {
  for (const id of ids) {
    const run = await getOwned<PayrollRow>(ctx, "payRuns", id, societyId);
    if (
      Number(run.payDate.slice(0, 4)) !== year ||
      run.payDate > coveredThroughDate
    )
      throw new Error(
        "An opening can represent only owned runs in its payment year through the stated coverage date.",
      );
    if (
      employeeId &&
      run.lines?.length &&
      !run.lines.some((line: any) => line.employeeId === employeeId)
    )
      throw new Error("The represented run has no line for this employee.");
  }
}
export async function saveEmployerSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; fields: EmployerSettingsFields },
) {
  await payrollWrite(ctx, args.societyId, false);
  const fields = cleanPayrollEmployer(args.fields);
  for (const [key, id] of Object.entries(fields.ledger ?? {})) {
    if (!id) continue;
    const account = await getOwned<PayrollRow>(
      ctx,
      "financialAccounts",
      id,
      args.societyId,
    );
    if (account.currency !== "CAD")
      throw new Error(
        "Native payroll ledger mappings must be CAD; no FX posting is guessed.",
      );
    if (
      key.includes("Expense")
        ? account.accountType !== "Expense"
        : account.accountType !== "Liability"
    )
      throw new Error(
        "Choose expense accounts for costs and liability accounts for payroll payables.",
      );
  }
  await representedRuns(
    ctx,
    args.societyId,
    fields.ehtOpeningRepresentedPayRunIds,
    fields.year,
    fields.ehtOpeningThroughDate,
  );
  const rows = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollEmployerProfiles")
      .withIndex("by_society_year", (q) =>
        q.eq("societyId", args.societyId).eq("year", fields.year),
      ),
    1,
    "Employer year settings",
  );
  return save(
    ctx,
    args.societyId,
    "payrollEmployerProfiles",
    fields,
    rows[0] ?? null,
  );
}
export async function saveProfilePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    employeeId: string;
    fields: EmployeeProfileFields;
  },
) {
  await payrollWrite(ctx, args.societyId);
  await getOwned(ctx, "employees", args.employeeId, args.societyId);
  const fields = cleanPayrollProfile(args.fields),
    old = args.id
      ? await getOwned<PayrollRow>(
          ctx,
          "payrollEmployeeProfiles",
          args.id,
          args.societyId,
        )
      : null;
  if (old && old.employeeId !== args.employeeId)
    throw new Error("A payroll profile cannot be moved to another employee.");
  if (fields.ehtLocationId) {
    const employers = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollEmployerProfiles")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId)),
      100,
      "Employer EHT location configurations",
    );
    if (
      !employers.some((e) =>
        [
          ...(e.ehtLocations ?? []),
          ...(e.ehtLocation ? [e.ehtLocation] : []),
        ].some((l: any) => l.id === fields.ehtLocationId && l.qualifying),
      )
    )
      throw new Error(
        "Choose an evidenced qualifying EHT location configured for this organization.",
      );
  }
  const peers = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollEmployeeProfiles")
      .withIndex("by_society_employee_from", (q) =>
        q.eq("societyId", args.societyId).eq("employeeId", args.employeeId),
      ),
    100,
    "Effective employee profiles",
  );
  if (
    peers.some(
      (row) =>
        row._id !== old?._id &&
        row.effectiveFrom <= (fields.effectiveTo ?? "9999-12-31") &&
        (row.effectiveTo ?? "9999-12-31") >= fields.effectiveFrom,
    )
  )
    throw new Error(
      "Effective profiles cannot overlap. End the prior profile before starting a new wage/declaration version.",
    );
  if (fields.portalUserId)
    await getOwned(ctx, "users", fields.portalUserId, args.societyId);
  for (const allocation of fields.fundingAllocations ?? []) {
    if (allocation.grantId) {
      await requirePermissionPortable(ctx, args.societyId, "grants:read");
      await getOwned(ctx, "grants", allocation.grantId, args.societyId);
    }
    if (allocation.fundRestrictionId)
      await getOwned(
        ctx,
        "fundRestrictions",
        allocation.fundRestrictionId,
        args.societyId,
      );
  }
  return save(ctx, args.societyId, "payrollEmployeeProfiles", fields, old, {
    employeeId: args.employeeId,
  });
}
export async function saveEarningCodePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id?: string; fields: EarningCodeFields },
) {
  await payrollWrite(ctx, args.societyId, false);
  const fields = cleanPayrollCode(args.fields),
    old = args.id
      ? await getOwned<PayrollRow>(
          ctx,
          "payrollEarningCodes",
          args.id,
          args.societyId,
        )
      : null;
  const existing = await ctx.db
    .query<PayrollRow>("payrollEarningCodes")
    .withIndex("by_society_code", (q) =>
      q.eq("societyId", args.societyId).eq("code", fields.code),
    )
    .first();
  if (existing && existing._id !== old?._id)
    throw new Error("That earning code already exists.");
  return save(ctx, args.societyId, "payrollEarningCodes", fields, old);
}
export async function saveWorkDayPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    employeeId: string;
    fields: WorkDayFields;
  },
) {
  await payrollWrite(ctx, args.societyId);
  await getOwned(ctx, "employees", args.employeeId, args.societyId);
  const fields = cleanPayrollWork(args.fields),
    old = args.id
      ? await getOwned<PayrollRow>(
          ctx,
          "payrollWorkDays",
          args.id,
          args.societyId,
        )
      : null;
  await payrollWorkVacationSource(ctx, args.societyId, args.employeeId, fields);
  if (fields.paidVacationMinutes) {
    const profiles = await payrollBounded(
      ctx.db
        .query<PayrollRow>("payrollEmployeeProfiles")
        .withIndex("by_society_employee_from", (q) =>
          q.eq("societyId", args.societyId).eq("employeeId", args.employeeId),
        ),
      100,
      "Effective salary profiles",
    );
    const effective = profiles.filter(
      (p) =>
        p.effectiveFrom <= fields.date &&
        (!p.effectiveTo || p.effectiveTo >= fields.date),
    );
    if (effective.length !== 1 || effective[0].compensation === "hourly")
      throw new Error(
        "Paid annual-leave minutes apply to a reviewed salaried profile. Hourly vacation money needs an explicit classified payout and liability source.",
      );
  }
  if (old && old.employeeId !== args.employeeId)
    throw new Error("A work record cannot be moved to another employee.");
  if (old?.postedCalculationId)
    throw new Error(
      "Finalized work cannot be edited or paid again. Reverse/correct its calculation explicitly.",
    );
  const existing = await ctx.db
    .query<PayrollRow>("payrollWorkDays")
    .withIndex("by_society_employee_date", (q) =>
      q
        .eq("societyId", args.societyId)
        .eq("employeeId", args.employeeId)
        .eq("date", fields.date),
    )
    .first();
  if (existing?.postedCalculationId)
    throw new Error("This day is already included in a finalized calculation.");
  if (old && existing && existing._id !== old._id)
    throw new Error(
      "Another work record already exists for this employee/date.",
    );
  return save(ctx, args.societyId, "payrollWorkDays", fields, old ?? existing, {
    employeeId: args.employeeId,
    ...(old?.reversedCalculationIds
      ? { reversedCalculationIds: old.reversedCalculationIds }
      : {}),
  });
}
export async function saveOpeningBalancePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    employeeId: string;
    fields: OpeningBalanceFields;
  },
) {
  await payrollWrite(ctx, args.societyId);
  await getOwned(ctx, "employees", args.employeeId, args.societyId);
  const fields = cleanPayrollOpening(args.fields);
  if (!fields.sameEmployerConfirmed)
    throw new Error(
      "Confirm these balances belong to this exact legal employer; prior-employer CPP/EI cannot be applied.",
    );
  await representedRuns(
    ctx,
    args.societyId,
    fields.representedPayRunIds,
    fields.year,
    fields.coveredThroughDate,
    args.employeeId,
  );
  const existing = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollOpeningBalances")
      .withIndex("by_society_employee_year", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("employeeId", args.employeeId)
          .eq("year", fields.year),
      ),
    1,
    "Employee opening balance",
  );
  const old = args.id
    ? await getOwned<PayrollRow>(
        ctx,
        "payrollOpeningBalances",
        args.id,
        args.societyId,
      )
    : (existing[0] ?? null);
  if (old && (old.employeeId !== args.employeeId || old.year !== fields.year))
    throw new Error(
      "An opening balance cannot be moved to another employee/year.",
    );
  if (existing[0] && old && existing[0]._id !== old._id)
    throw new Error("That employee/year already has an opening balance.");
  return save(ctx, args.societyId, "payrollOpeningBalances", fields, old, {
    employeeId: args.employeeId,
    legalEmployerId: args.societyId,
  });
}

export async function payrollWorkVacationSource(
  ctx: PortableQueryCtx,
  societyId: string,
  employeeId: string,
  fields: WorkDayFields,
) {
  if (!fields.vacationRequestId) return null;
  const request = await getOwned<PayrollRow>(
    ctx,
    "payrollVacationRequests",
    fields.vacationRequestId,
    societyId,
  );
  if (request.payrollPayoutCalculationId)
    throw new Error(
      "This leave request is already funded by a retained vacation payout and cannot also be funded through salary leave.",
    );
  const day = request.days?.find((day: any) => day.date === fields.date);
  if (
    request.employeeId !== employeeId ||
    !["approved", "taken"].includes(request.status) ||
    !day ||
    day.minutes !== fields.paidVacationMinutes
  )
    throw new Error(
      "Link an owned approved/taken vacation request for the same employee, date and paid-leave minutes.",
    );
  return request;
}
