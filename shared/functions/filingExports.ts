/**
 * PORTABLE FUNCTIONS: the filing-exports domain
 * (societiesOnlinePreFill / craPreFill).
 *
 * Read-only queries that derive filing-form JSON payloads from current data.
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. `monthsAfter` is a pure date helper.
 */

import { isMeetingHeld } from "../meetingStatus";
import type { PortableQueryCtx } from "../portable/ctx";
import { requirePermissionPortable } from "./permissions";
import { bcSocietyPreparationKind, CRA_PRE_FILL_KINDS, filingDueDateMonthsAfter } from "../filingPreparation";

/**
 * Returns JSON payloads matching the field shape of Societies Online filing
 * forms, derived from current data. The user reviews and copies these values
 * into the official form. No submission is made by this query.
 */
export async function societiesOnlinePreFillPortable(
  ctx: PortableQueryCtx,
  { societyId, kind: requestedKind }: { societyId: string; kind: string },
) {
  await requirePermissionPortable(ctx, societyId, "filings:read");
  await requirePermissionPortable(ctx, societyId, "society:read");
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found");
  const kind = bcSocietyPreparationKind(society, requestedKind);
  if (["AnnualReport", "ChangeOfDirectors"].includes(kind)) await requirePermissionPortable(ctx, societyId, "directors:read");
  if (kind === "AnnualReport") await requirePermissionPortable(ctx, societyId, "meetings:read");

  if (kind === "AnnualReport") {
    const directors = (
      await ctx.db
        .query("directors")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
    ).filter((d: Record<string, any>) => d.status === "Active");
    const latestAgm = (
      await ctx.db
        .query("meetings")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
    )
      .filter((m: Record<string, any>) => m.type === "AGM" && isMeetingHeld(m.status))
      .sort((a: any, b: any) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
    return {
      formName: "BC Societies Annual Report",
      societyName: society.name,
      incorporationNumber: society.incorporationNumber ?? "",
      agmHeldOn: latestAgm?.scheduledAt?.slice(0, 10) ?? "",
      registeredOffice: society.registeredOfficeAddress ?? "",
      mailingAddress: society.mailingAddress ?? "",
      directors: directors.map((d: Record<string, any>) => ({
        fullName: `${d.firstName} ${d.lastName}`,
        position: d.position,
        email: d.email ?? "",
        isBCResident: d.isBCResident,
        termStart: d.termStart,
      })),
      feeCad: 40,
    };
  }

  if (kind === "ChangeOfDirectors") {
    const directors = await ctx.db
      .query("directors")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return {
      formName: "BC Societies Change of Directors",
      societyName: society.name,
      incorporationNumber: society.incorporationNumber ?? "",
      active: directors
        .filter((d: Record<string, any>) => d.status === "Active")
        .map((d: Record<string, any>) => ({
          fullName: `${d.firstName} ${d.lastName}`,
          termStart: d.termStart,
          consentOnFile: d.consentOnFile,
        })),
      ceased: directors
        .filter((d: Record<string, any>) => d.status !== "Active")
        .map((d: Record<string, any>) => ({
          fullName: `${d.firstName} ${d.lastName}`,
          status: d.status,
          resignedAt: d.resignedAt ?? "",
        })),
      mustBeFiledWithin: "30 days of the change",
    };
  }

  if (kind === "ChangeOfAddress") {
    return {
      formName: "BC Societies Change of Address",
      societyName: society.name,
      incorporationNumber: society.incorporationNumber ?? "",
      newRegisteredOffice: society.registeredOfficeAddress ?? "",
      newMailingAddress: society.mailingAddress ?? "",
      feeCad: 15,
    };
  }

  if (kind === "BylawAmendment" || kind === "ConstitutionAlteration") {
    return {
      formName:
        kind === "BylawAmendment"
          ? "BC Societies Bylaw Amendment"
          : "BC Societies Constitution Alteration",
      societyName: society.name,
      incorporationNumber: society.incorporationNumber ?? "",
      specialResolutionRequired: true,
      thresholdPercent: 66.67,
      feeCad: 50,
      note: "Attach text of bylaws as altered and evidence of the special resolution.",
    };
  }

  return { formName: kind, societyName: society.name };
}

/** CRA form pre-fill summary. We surface the line numbers + totals we can
 * compute; the PDF form itself is filed by the user. */
export async function craPreFillPortable(
  ctx: PortableQueryCtx,
  { societyId, kind, fiscalYear }: { societyId: string; kind: string; fiscalYear: string },
) {
  await requirePermissionPortable(ctx, societyId, "filings:read");
  await requirePermissionPortable(ctx, societyId, "financials:read");
  await requirePermissionPortable(ctx, societyId, "society:read");
  if (!CRA_PRE_FILL_KINDS.some(option => option.id === kind)) throw new Error("Unsupported CRA pre-fill form.");
  if (!/^[1-9]\d{3}$/.test(fiscalYear)) throw new Error("A four-digit fiscal year is required.");
  const financials = (
    await ctx.db
      .query("financials")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect()
  ).find((f: Record<string, any>) => f.fiscalYear === fiscalYear);
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found");
  if (kind === "T3010" && !society.isCharity) return { kind, fiscalYear, error: "T3010 applies to registered charities. Confirm charity registration in entity settings first." };
  if (!financials) {
    return { kind, fiscalYear, error: "No financial statements on file for that year." };
  }

  if (kind === "T3010") {
    await requirePermissionPortable(ctx, societyId, "directors:read");
    return {
      form: "CRA T3010 Registered Charity Information Return",
      charityName: society.name,
      fiscalPeriodEnd: financials.periodEnd,
      totalRevenue: financials.revenueCents / 100,
      totalExpenditures: financials.expensesCents / 100,
      netAssets: financials.netAssetsCents / 100,
      directorCount: (
        await ctx.db
          .query("directors")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect()
      ).filter((d: Record<string, any>) => d.status === "Active").length,
      dueDate: filingDueDateMonthsAfter(financials.periodEnd, 6),
    };
  }

  if (kind === "T2" || kind === "T1044") {
    return {
      form: kind === "T2" ? "CRA T2 Corporation Income Tax" : "CRA T1044 NPO Information Return",
      corporationName: society.name,
      fiscalPeriodEnd: financials.periodEnd,
      totalRevenue: financials.revenueCents / 100,
      totalExpenses: financials.expensesCents / 100,
      netIncome: (financials.revenueCents - financials.expensesCents) / 100,
      dueDate: filingDueDateMonthsAfter(financials.periodEnd, 6),
      note:
        kind === "T1044"
          ? "File with T2 if investment income > $10k or assets > $200k, or previously required."
          : "This summary is not a completed T2. Confirm filing obligations and T2 Short eligibility using CRA guidance.",
    };
  }

  return { kind, fiscalYear };
}
