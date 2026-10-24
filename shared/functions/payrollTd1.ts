import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import type { PayrollDeductionInput } from "../payrollDeductions";
import type {
  PayrollTd1ApplyArgs,
  PayrollTd1Declaration,
  PayrollTd1ReviewedForm,
  PayrollTd1Resolved,
} from "../payrollTd1Settings";
import { payrollFingerprint } from "../payrollProvenance";
import {
  payrollDate,
  payrollInteger,
  payrollYear,
  payrollText,
} from "../payrollCalculationValidation";
import { getOwned, principalUserId } from "./access";
import {
  payrollBounded,
  payrollOrganization,
  payrollRead,
  payrollWrite,
  type PayrollRow,
} from "./payrollCalculationData";

function reference(
  raw: unknown,
  label: string,
  required = false,
): string | undefined {
  if ((raw === undefined || raw === "") && !required) return undefined;
  const result = payrollText(raw, label, 500);
  if (/\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/.test(result))
    throw new Error(
      `${label} must use an internal document reference, without a SIN or personal identifier.`,
    );
  return result;
}
function flag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(
      `Review ${name} explicitly; an unread or missing checkbox is not a confirmed false.`,
    );
  return value;
}
function cleanForm(
  raw: PayrollTd1ReviewedForm,
  applicableYear: number,
): PayrollTd1ReviewedForm {
  if (!raw || !["federal", "BC"].includes(raw.form))
    throw new Error("Choose a federal TD1 or B.C. TD1BC declaration.");
  const year = payrollYear(raw.year),
    sourceFormYear =
      raw.sourceFormYear == null ? year : payrollYear(raw.sourceFormYear);
  if (year !== applicableYear)
    throw new Error(
      "The reviewed claim amounts must belong to the withholding year of the effective payment date.",
    );
  if (sourceFormYear > year)
    throw new Error(
      "A later year's form cannot support an earlier year's withholding.",
    );
  const priorYearReviewed =
    sourceFormYear !== year
      ? flag(
          raw.priorYearReviewed,
          "the prior form's current-year indexed claims",
        )
      : undefined;
  if (sourceFormYear !== year && !priorYearReviewed)
    throw new Error(
      "Review the current-year indexed claims before carrying an older valid form forward. A new form is not required annually when the employee's circumstances have not changed.",
    );
  const priorYearReviewReference =
    sourceFormYear !== year
      ? reference(
          raw.priorYearReviewReference,
          "Current-year claim review reference",
          true,
        )
      : undefined;
  if (
    !flag(raw.signedFormReviewed, "the completed employee declaration") ||
    !flag(raw.fieldsReviewed, "all parsed claim amounts and checkboxes")
  )
    throw new Error(
      "A reviewer must verify the completed, signed employee form and every field before applying it.",
    );
  if (raw.residencyConfirmed !== "resident")
    throw new Error(
      "Non-resident TD1 treatment requires a separately reviewed payroll policy; do not infer residence from an unchecked form section.",
    );
  const totalClaimCents = payrollInteger(
    raw.totalClaimCents,
    "Reviewed total claim cents",
    1_000_000_000,
  );
  const multipleEmployers = flag(
    raw.multipleEmployers,
    "the multiple-employer declaration",
  );
  const totalIncomeLessThanClaims = flag(
    raw.totalIncomeLessThanClaims,
    "the total-income-below-claims declaration",
  );
  if (multipleEmployers && totalClaimCents !== 0)
    throw new Error(
      "The checked multiple-employer declaration requires a zero total claim. Reconcile the completed form before applying contradictory fields.",
    );
  if (totalIncomeLessThanClaims && (multipleEmployers || totalClaimCents === 0))
    throw new Error(
      "Reconcile the below-total-claims declaration with a positive total claim and the multiple-employer declaration.",
    );
  const source = raw.source;
  if (
    !source ||
    !["acroform", "text", "ocr", "manual"].includes(source.method) ||
    ![
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
    ].includes(source.mediaType)
  )
    throw new Error(
      "Record a supported local extraction or manual-review source.",
    );
  const pageCount = payrollInteger(source.pageCount, "Source page count", 20);
  if (!pageCount) throw new Error("Record the source's actual page count.");
  const sha256 = source.sha256?.toLowerCase();
  if (
    (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) ||
    (!sha256 && source.method !== "manual")
  )
    throw new Error(
      "Uploaded forms need the SHA-256 of the original file bytes. Manual records must not invent a file hash.",
    );
  const reviewReference = reference(
    raw.reviewReference,
    "Employer review reference",
    source.method === "manual",
  );
  const additionalTaxCents =
    raw.additionalTaxCents == null
      ? undefined
      : payrollInteger(
          raw.additionalTaxCents,
          "Additional federal withholding cents",
          100_000_000,
        );
  const annualZoneDeductionCents =
    raw.annualZoneDeductionCents == null
      ? undefined
      : payrollInteger(
          raw.annualZoneDeductionCents,
          "Reviewed annual prescribed-zone deduction cents",
          1_000_000_000,
        );
  if (
    raw.form === "BC" &&
    ((additionalTaxCents ?? 0) !== 0 || (annualZoneDeductionCents ?? 0) !== 0)
  )
    throw new Error(
      "Additional withholding and prescribed-zone deductions come from the federal form, not TD1BC.",
    );
  return {
    form: raw.form,
    year,
    sourceFormYear,
    totalClaimCents,
    multipleEmployers,
    totalIncomeLessThanClaims,
    source: {
      method: source.method,
      mediaType: source.mediaType,
      pageCount,
      ...(sha256 ? { sha256 } : {}),
    },
    signedFormReviewed: true,
    fieldsReviewed: true,
    residencyConfirmed: "resident",
    ...(reviewReference ? { reviewReference } : {}),
    ...(priorYearReviewed
      ? { priorYearReviewed, priorYearReviewReference }
      : {}),
    ...(raw.form === "federal"
      ? {
          additionalTaxCents: additionalTaxCents ?? 0,
          annualZoneDeductionCents: annualZoneDeductionCents ?? 0,
        }
      : {}),
  };
}

/** Latest reviewed declarations resolve on payment dates, independently of the
 * employee's wage-profile effective dates. Finalized snapshots are unchanged. */
export async function resolvePayrollTd1Portable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    employeeId: string;
    payDate: string;
    baseTd1: PayrollDeductionInput["td1"] & { declarationReference?: string };
    baseDeductions?: PayrollDeductionInput["deductions"];
  },
): Promise<PayrollTd1Resolved> {
  const payDate = payrollDate(args.payDate),
    year = Number(payDate.slice(0, 4));
  const sourceDeclarations: PayrollTd1Declaration[] = [];
  for (const form of ["federal", "BC"] as const) {
    const row = await ctx.db
      .query<PayrollTd1Declaration>("payrollTd1Declarations")
      .withIndex("by_society_employee_form_year_effective", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("employeeId", args.employeeId)
          .eq("form", form)
          .eq("year", year)
          .lte("effectiveFrom", payDate),
      )
      .order("desc")
      .first();
    if (row) {
      if (
        row.societyId !== args.societyId ||
        row.employeeId !== args.employeeId ||
        row.sourceKind !== "employer_reviewed_import" ||
        !row.fieldsReviewed ||
        !row.signedFormReviewed
      )
        throw new Error(
          "The retained TD1 declaration needs a source review before payroll.",
        );
      sourceDeclarations.push(row);
    }
  }
  const td1 = { ...args.baseTd1 },
    deductions = { ...args.baseDeductions };
  for (const row of sourceDeclarations) {
    if (row.form === "federal") {
      Object.assign(td1, {
        federalClaimCents: row.totalClaimCents,
        federalMultipleEmployers: row.multipleEmployers,
        federalTaxExempt: row.totalIncomeLessThanClaims,
        additionalTaxCents: row.additionalTaxCents ?? 0,
      });
      deductions.annualZoneDeductionCents = row.annualZoneDeductionCents ?? 0;
    } else
      Object.assign(td1, {
        provincialClaimCents: row.totalClaimCents,
        provincialMultipleEmployers: row.multipleEmployers,
        provincialTaxExempt: row.totalIncomeLessThanClaims,
      });
  }
  if (sourceDeclarations.length === 2) td1.confirmed = true;
  if (sourceDeclarations.length)
    td1.declarationReference = sourceDeclarations
      .map((row) => `${row.form} reviewed declaration ${row._id}`)
      .join("; ");
  return { asOf: payDate, td1, deductions, sourceDeclarations };
}

export async function workspacePortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; employeeId: string; cursor?: string | null },
) {
  await payrollRead(ctx, args.societyId);
  await getOwned(ctx, "employees", args.employeeId, args.societyId);
  const { today } = await payrollOrganization(ctx, args.societyId);
  const scope = JSON.stringify([args.societyId, args.employeeId]);
  let cursor: string | null = null;
  if (args.cursor) {
    let parsed: { scope: string; cursor: string };
    try {
      parsed = JSON.parse(args.cursor);
    } catch {
      throw new Error("Restart TD1 history from its first page.");
    }
    if (parsed.scope !== scope || typeof parsed.cursor !== "string")
      throw new Error("This TD1 history page belongs to another employee.");
    cursor = parsed.cursor;
  }
  const profiles = await payrollBounded(
    ctx.db
      .query<PayrollRow>("payrollEmployeeProfiles")
      .withIndex("by_society_employee_from", (q) =>
        q.eq("societyId", args.societyId).eq("employeeId", args.employeeId),
      ),
    100,
    "Effective payroll profiles",
  );
  const profile = profiles.find(
    (row) =>
      row.effectiveFrom <= today &&
      (!row.effectiveTo || row.effectiveTo >= today),
  );
  const page = await ctx.db
    .query<PayrollTd1Declaration>("payrollTd1Declarations")
    .withIndex("by_society_employee_effective", (q) =>
      q.eq("societyId", args.societyId).eq("employeeId", args.employeeId),
    )
    .order("desc")
    .paginate({ numItems: 25, cursor });
  return {
    today,
    page: page.page,
    isDone: page.isDone,
    continueCursor: page.isDone
      ? ""
      : JSON.stringify({ scope, cursor: page.continueCursor }),
    resolved: await resolvePayrollTd1Portable(ctx, {
      societyId: args.societyId,
      employeeId: args.employeeId,
      payDate: today,
      baseTd1: profile?.td1 ?? { confirmed: false },
      baseDeductions: profile?.deductions,
    }),
  };
}

export async function applyReviewedPortable(
  ctx: PortableMutationCtx,
  args: PayrollTd1ApplyArgs,
) {
  await payrollWrite(ctx, args.societyId);
  await getOwned(ctx, "employees", args.employeeId, args.societyId);
  const { today } = await payrollOrganization(ctx, args.societyId);
  const effectiveFrom = payrollDate(
      args.effectiveFrom,
      "TD1 effective payment date",
    ),
    receivedOn = payrollDate(args.receivedOn, "Actual date received");
  if (receivedOn > today || effectiveFrom < receivedOn)
    throw new Error(
      "Use an actual past/current receipt date and an effective payment date on or after receipt.",
    );
  if (
    !Array.isArray(args.forms) ||
    args.forms.length < 1 ||
    args.forms.length > 2 ||
    new Set(args.forms.map((row) => row?.form)).size !== args.forms.length
  )
    throw new Error(
      "Review one federal form, one B.C. form, or the pair without duplicates.",
    );
  const year = Number(effectiveFrom.slice(0, 4)),
    forms = args.forms.map((raw) => cleanForm(raw, year));
  const actor = await principalUserId(ctx, args.societyId),
    declarationIds: string[] = [];
  for (const form of forms) {
    const contentHash = await payrollFingerprint({
      societyId: args.societyId,
      employeeId: args.employeeId,
      effectiveFrom,
      receivedOn,
      form,
    });
    const existing = await ctx.db
      .query<PayrollTd1Declaration>("payrollTd1Declarations")
      .withIndex("by_society_employee_hash", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("employeeId", args.employeeId)
          .eq("contentHash", contentHash),
      )
      .first();
    if (existing) {
      declarationIds.push(String(existing._id));
      continue;
    }
    declarationIds.push(
      await ctx.db.insert("payrollTd1Declarations", {
        ...form,
        societyId: args.societyId,
        employeeId: args.employeeId,
        effectiveFrom,
        receivedOn,
        contentHash,
        recordedByUserId: actor,
        recordedAtISO: new Date().toISOString(),
        sourceKind: "employer_reviewed_import",
        originalStored: false,
        employeeElectronicSignatureCertified: false,
      }),
    );
  }
  return { declarationIds, effectiveFrom, year };
}
