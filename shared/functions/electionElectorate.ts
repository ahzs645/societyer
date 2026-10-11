import type { PortableQueryCtx } from "../portable/ctx";
import { buildShareholderElectorate, recordDateLimitFor, recordDateWindow, validElectorateDate, type RecordDatePurpose, type RecordDateSource } from "../shareholderElectorate";
import { materializeRightsHoldings } from "../equityLedger";
import { meetingCalendarDate } from "../meetingDates";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import { getOwned } from "./access";

export type CorporateElectionReview = {
  recordDateISO: string;
  /** Omitted means fixed by the directors, so any statutory minimum interval applies. */
  recordDateSource?: RecordDateSource;
  recordDateBasis: string;
  rightsBasis: string;
  ledgerBasis: string;
  votingMethod: "per_share" | "cumulative";
  classIds?: string[];
  representatives: { roleHolderId: string; userId: string; authorityBasis: string; authorityDocumentId?: string }[];
};

/** The event a record date serves: the linked meeting, else when voting opens (or now, if later). */
export type RecordDateReference = { referenceDateISO: string; purpose: RecordDatePurpose; eventLabel: string };

const REGISTER_LIMIT = 5000;
async function register(ctx: PortableQueryCtx, table: string, societyId: string) {
  const rows = await ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).take(REGISTER_LIMIT + 1);
  if (rows.length > REGISTER_LIMIT) throw new Error(`The ${table} register exceeds the ${REGISTER_LIMIT}-row election snapshot limit. Use a reviewed batch import before opening this election.`);
  return rows;
}

function positions(rows: Record<string, any>[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (String(row.status ?? "current") !== "current") continue;
    const key = `${row.rightsClassId}:${row.holderRoleHolderId ? `roleHolder:${row.holderRoleHolderId}` : row.holderKey}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.quantity));
  }
  return JSON.stringify([...totals].filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b)));
}

/** Today's calendar date in the organization's own time zone (not the UTC date). */
export function organizationToday(organization: Record<string, any> | null | undefined, nowISO = new Date().toISOString()) {
  return resolutionCalendarDate(nowISO, resolutionTimeZone(organization)) ?? nowISO.slice(0, 10);
}

/** Record-date reference for an election: the meeting date, or the later of voting opening and today. */
export async function electionRecordDateReference(ctx: PortableQueryCtx, societyId: string, election: Record<string, any>): Promise<RecordDateReference> {
  const organization = await ctx.db.get(societyId, "societies");
  const timeZone = resolutionTimeZone(organization);
  if (election.meetingId) {
    const meeting = await getOwned(ctx, "meetings", election.meetingId, societyId);
    const meetingDate = meetingCalendarDate(meeting as any, timeZone);
    if (meetingDate) return { referenceDateISO: meetingDate, purpose: "meeting", eventLabel: "meeting" };
  }
  const today = organizationToday(organization);
  const opensAt = election.opensAtISO ? Date.parse(election.opensAtISO) : NaN;
  const opens = Number.isFinite(opensAt) ? resolutionCalendarDate(new Date(opensAt).toISOString(), timeZone) : undefined;
  return { referenceDateISO: opens && opens > today ? opens : today, purpose: "meeting", eventLabel: "opening of voting" };
}

/** Current positions or a fully reconciled, posted transaction history. */
export async function corporateElectionPreview(ctx: PortableQueryCtx, societyId: string, review?: CorporateElectionReview, reference?: RecordDateReference) {
  const [classes, currentHoldings, roleHolders, transfers, organization] = await Promise.all([
    register(ctx, "rightsClasses", societyId), register(ctx, "rightsHoldings", societyId),
    register(ctx, "roleHolders", societyId), register(ctx, "rightsholdingTransfers", societyId),
    ctx.db.get(societyId, "societies"),
  ]);
  // The organization's calendar, so an evening record date in BC is not "historical" in UTC.
  const today = organizationToday(organization);
  const recordDateISO = review?.recordDateISO ?? today;
  const issues: string[] = [];
  const reviewNotes: string[] = [];
  const validDate = validElectorateDate(recordDateISO) && /^\d{4}-\d{2}-\d{2}$/.test(recordDateISO);
  if (!validDate) issues.push("Record an actual calendar record date (YYYY-MM-DD).");
  if (recordDateISO > today) issues.push("The record date has not occurred yet; take the snapshot after that date.");
  if (validDate && reference) {
    const window = recordDateWindow(recordDateISO, reference.referenceDateISO, recordDateLimitFor(organization, reference.purpose), reference.eventLabel, review?.recordDateSource);
    if (window.issue) issues.push(window.issue);
    if (window.reviewNote) reviewNotes.push(window.reviewNote);
  }
  let holdings = currentHoldings;
  const posted = transfers.filter((row) => String(row.status).toLowerCase() === "posted");
  if (recordDateISO < today) {
    if (!posted.length) issues.push("Historical eligibility requires posted share transactions that reconstruct the register at the record date.");
    if (posted.some((row) => !validElectorateDate(String(row.transferDate ?? "")))) issues.push("Every posted share transaction needs a valid effective date before a historical snapshot can be verified.");
    if (positions(materializeRightsHoldings(posted as any) as any) !== positions(currentHoldings)) issues.push("Posted share history does not reconcile to the current register; review missing or unposted transactions.");
    holdings = materializeRightsHoldings(posted.filter((row) => String(row.transferDate).slice(0, 10) <= recordDateISO) as any) as any;
  }
  const electorate = buildShareholderElectorate({ classes, holdings, roleHolders, recordDateISO, holdingsAsOfISO: recordDateISO, classIds: review?.classIds });
  return { ...electorate, issues: [...issues, ...electorate.issues], reviewNotes, complete: issues.length === 0 && electorate.complete,
    // A record date of today uses the live register when the snapshot is taken, not the end of the day.
    registerBasis: recordDateISO === today ? "live_at_snapshot" as const : "reconstructed_end_of_day" as const,
    classes: classes.map((row) => ({ _id: row._id, className: row.className, votesPerShare: row.votesPerShare, votingRights: row.votingRights })) };
}

export async function validateCorporateElectionReview(ctx: PortableQueryCtx, societyId: string, review: CorporateElectionReview, reference?: RecordDateReference) {
  if (!review || !["per_share", "cumulative"].includes(review.votingMethod)) throw new Error("Review the share voting method before opening this election.");
  for (const [label, value] of [["record-date authority", review.recordDateBasis], ["articles and class voting rights", review.rightsBasis], ["share register completeness", review.ledgerBasis]]) {
    if (!value || value.trim().length < 12) throw new Error(`Record the reviewed ${label}, including the supporting resolution or document reference.`);
  }
  if (!validElectorateDate(review.recordDateISO) || !/^\d{4}-\d{2}-\d{2}$/.test(review.recordDateISO)) throw new Error("Enter a valid calendar record date.");
  if (review.recordDateSource !== undefined && review.recordDateSource !== "fixed" && review.recordDateSource !== "statutory_default") throw new Error("Record whether the directors fixed the record date or the statutory default applies.");
  if (reference) {
    const organization = await ctx.db.get(societyId, "societies");
    const window = recordDateWindow(review.recordDateISO, reference.referenceDateISO, recordDateLimitFor(organization, reference.purpose), reference.eventLabel, review.recordDateSource);
    if (window.issue) throw new Error(window.issue);
  }
  if (!Array.isArray(review.representatives)) throw new Error("Assign an authorized account to each shareholder.");
  if (new Set(review.representatives.map((row) => row.roleHolderId)).size !== review.representatives.length) throw new Error("A shareholder can have only one voting account in this snapshot.");
  for (const assignment of review.representatives) {
    await getOwned(ctx, "roleHolders", assignment.roleHolderId, societyId);
    const account = await getOwned(ctx, "users", assignment.userId, societyId);
    if (account.status !== "Active") throw new Error("Each shareholder's authorized voting account must be active.");
    if (!assignment.authorityBasis || assignment.authorityBasis.trim().length < 12) throw new Error("Record how each account's identity and authority to act for the shareholder were verified.");
    if (assignment.authorityDocumentId) await getOwned(ctx, "documents", assignment.authorityDocumentId, societyId);
  }
  for (const id of review.classIds ?? []) await getOwned(ctx, "rightsClasses", id, societyId);
}
