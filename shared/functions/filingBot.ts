/**
 * PORTABLE FUNCTIONS: the filing-bot run read surface.
 *
 * `listRuns`, `runsForFiling`, `getRun`, and `buildFilingPacket` read through the
 * portable `ctx.db` contract, so they run unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 *
 * The hosted run execution surface (`run` and the internal
 * `_createRun` / `_updateStep` / `_completeRun` / `_patchFiling` mutations) stays
 * on Convex: it depends on `ctx.scheduler`/`ctx.runQuery`/`ctx.runMutation`, the
 * notification fan-out, and the step catalog.
 */

import { bcSocietyBotKind } from "../filingPreparation";
import { minutesMotionsForDisplay } from "../minutesMotions";
import { resolveMinutesMotions } from "./minutes";
import type { PortableQueryCtx } from "../portable/ctx";
import { requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";

export async function listRunsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 20);
}

export async function runsForFilingPortable(ctx: PortableQueryCtx, { filingId }: { filingId: string }) {
  await requireOwnedRow(ctx, "filings", filingId);
  return ctx.db
    .query("filingBotRuns")
    .withIndex("by_filing", (q) => q.eq("filingId", filingId))
    .order("desc")
    .collect();
}

export async function getRunPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return requireOwnedRow(ctx, "filingBotRuns", id);
}

/** The same read-only packet is available locally and on hosted Convex. */
export async function buildFilingPacketPortable(ctx: PortableQueryCtx, { societyId, kind: requestedKind }: { societyId: string; kind: string }) {
  for (const permission of ["filings:read", "society:read", "directors:read", "members:read", "meetings:read", "minutes:read"] as const) {
    await requirePermissionPortable(ctx, societyId, permission);
  }
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const kind = bcSocietyBotKind(society, requestedKind);
  const [directors, members, minutes, meetings] = await Promise.all([
    ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const activeDirectors = directors.filter((d) => d.status === "Active");
  const lastAgm = meetings
    .filter((m) => m.type === "AGM" && m.status === "Held")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
  const lastAgmMinutesRaw = lastAgm
    ? minutes.find((mn) => mn.meetingId === lastAgm._id)
    : undefined;
  // Flip the filing-packet motion read onto the first-class table (Phase 2C):
  // attach resolved displayMotions so minutesMotionsForDisplay() below reads the
  // table. No-op on data without motionIds (falls back to the embedded array).
  const lastAgmMinutes = lastAgmMinutesRaw
    ? { ...lastAgmMinutesRaw, displayMotions: await resolveMinutesMotions(ctx, lastAgmMinutesRaw) }
    : undefined;

  if (kind === "AnnualReport") {
    return {
      form: "BC-Societies-Form-11",
      society: {
        name: society.name,
        incorporationNumber: society.incorporationNumber,
        incorporationDate: society.incorporationDate,
        registeredOfficeAddress: society.registeredOfficeAddress,
        mailingAddress: society.mailingAddress,
      },
      agmDate: lastAgm?.scheduledAt?.slice(0, 10),
      directors: activeDirectors.map((d) => ({
        name: `${d.firstName} ${d.lastName}`,
        position: d.position,
        bcResident: d.isBCResident,
        consentOnFile: d.consentOnFile,
        termStart: d.termStart,
      })),
      signatories: activeDirectors.slice(0, 2).map((d) => ({
        name: `${d.firstName} ${d.lastName}`,
        position: d.position,
      })),
      votingMembers: members.filter((m) => m.votingRights && m.status === "Active").length,
    };
  }
  if (kind === "BylawAmendment") {
    const specialResolutions = minutesMotionsForDisplay(lastAgmMinutes).filter((m) =>
      /special resolution|bylaw/i.test(m.text),
    );
    return {
      form: "BC-Societies-BylawAmendment",
      society: { name: society.name, incorporationNumber: society.incorporationNumber },
      approvedAt: lastAgm?.scheduledAt?.slice(0, 10),
      specialResolutions,
    };
  }
  if (kind === "ChangeOfDirectors") {
    return {
      form: "BC-Societies-ChangeOfDirectors",
      society: { name: society.name, incorporationNumber: society.incorporationNumber },
      directors: activeDirectors.map((d) => ({
        name: `${d.firstName} ${d.lastName}`,
        position: d.position,
        bcResident: d.isBCResident,
        termStart: d.termStart,
        termEnd: d.termEnd,
      })),
    };
  }
  throw new Error("Unsupported BC society preparation packet.");
}
