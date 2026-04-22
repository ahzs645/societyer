// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Returns JSON payloads matching the field shape of Societies Online filing
 * forms, derived from current data. The user copies values into the online
 * form; a future "FilingBot" can submit them directly.
 */
export const societiesOnlinePreFill = query({
  args: { societyId: v.id("societies"), kind: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, kind }) => {
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found");

    if (kind === "AnnualReport") {
      const directors = (
        await ctx.db
          .query("directors")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect()
      ).filter((d) => d.status === "Active");
      const latestAgm = (
        await ctx.db
          .query("meetings")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect()
      )
        .filter((m) => m.type === "AGM" && m.status === "Held")
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
      return {
        formName: "BC Societies Annual Report",
        societyName: society.name,
        incorporationNumber: society.incorporationNumber ?? "",
        agmHeldOn: latestAgm?.scheduledAt?.slice(0, 10) ?? "",
        registeredOffice: society.registeredOfficeAddress ?? "",
        mailingAddress: society.mailingAddress ?? "",
        directors: directors.map((d) => ({
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
          .filter((d) => d.status === "Active")
          .map((d) => ({
            fullName: `${d.firstName} ${d.lastName}`,
            termStart: d.termStart,
            consentOnFile: d.consentOnFile,
          })),
        ceased: directors
          .filter((d) => d.status !== "Active")
          .map((d) => ({
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
  },
});

/** CRA form pre-fill summary. We surface the line numbers + totals we can
 * compute; the PDF form itself is filed by the user. */
export const craPreFill = query({
  args: { societyId: v.id("societies"), kind: v.string(), fiscalYear: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, kind, fiscalYear }) => {
    const financials = (
      await ctx.db
        .query("financials")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
    ).find((f) => f.fiscalYear === fiscalYear);
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found");
    if (!financials) {
      return { kind, fiscalYear, error: "No financial statements on file for that year." };
    }

    if (kind === "T3010") {
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
        ).filter((d) => d.status === "Active").length,
        dueDate: monthsAfter(financials.periodEnd, 6),
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
        dueDate: monthsAfter(financials.periodEnd, 6),
        note:
          kind === "T1044"
            ? "File with T2 if investment income > $10k or assets > $200k, or previously required."
            : "Short-form T2 allowed if operating in a single province.",
      };
    }

    return { kind, fiscalYear };
  },
});

function monthsAfter(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
