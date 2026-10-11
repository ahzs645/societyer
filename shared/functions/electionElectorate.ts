import type { PortableQueryCtx } from "../portable/ctx";
import { buildShareholderElectorate, validElectorateDate } from "../shareholderElectorate";
import { materializeRightsHoldings } from "../equityLedger";
import { getOwned } from "./access";

export type CorporateElectionReview = {
  recordDateISO: string;
  recordDateBasis: string;
  rightsBasis: string;
  ledgerBasis: string;
  votingMethod: "per_share" | "cumulative";
  classIds?: string[];
  representatives: { roleHolderId: string; userId: string; authorityBasis: string; authorityDocumentId?: string }[];
};

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

/** Current positions or a fully reconciled, posted transaction history. */
export async function corporateElectionPreview(ctx: PortableQueryCtx, societyId: string, review?: CorporateElectionReview) {
  const [classes, currentHoldings, roleHolders, transfers] = await Promise.all([
    register(ctx, "rightsClasses", societyId), register(ctx, "rightsHoldings", societyId),
    register(ctx, "roleHolders", societyId), register(ctx, "rightsholdingTransfers", societyId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const recordDateISO = review?.recordDateISO ?? today;
  const issues: string[] = [];
  if (!validElectorateDate(recordDateISO) || !/^\d{4}-\d{2}-\d{2}$/.test(recordDateISO)) issues.push("Record an actual calendar record date (YYYY-MM-DD).");
  if (recordDateISO > today) issues.push("The record date has not occurred yet; take the snapshot after that date.");
  let holdings = currentHoldings;
  const posted = transfers.filter((row) => String(row.status).toLowerCase() === "posted");
  if (recordDateISO < today) {
    if (!posted.length) issues.push("Historical eligibility requires posted share transactions that reconstruct the register at the record date.");
    if (posted.some((row) => !validElectorateDate(String(row.transferDate ?? "")))) issues.push("Every posted share transaction needs a valid effective date before a historical snapshot can be verified.");
    if (positions(materializeRightsHoldings(posted as any) as any) !== positions(currentHoldings)) issues.push("Posted share history does not reconcile to the current register; review missing or unposted transactions.");
    holdings = materializeRightsHoldings(posted.filter((row) => String(row.transferDate).slice(0, 10) <= recordDateISO) as any) as any;
  }
  const electorate = buildShareholderElectorate({ classes, holdings, roleHolders, recordDateISO, holdingsAsOfISO: recordDateISO, classIds: review?.classIds });
  return { ...electorate, issues: [...issues, ...electorate.issues], complete: issues.length === 0 && electorate.complete, classes: classes.map((row) => ({ _id: row._id, className: row.className, votesPerShare: row.votesPerShare, votingRights: row.votingRights })) };
}

export async function validateCorporateElectionReview(ctx: PortableQueryCtx, societyId: string, review: CorporateElectionReview) {
  if (!review || !["per_share", "cumulative"].includes(review.votingMethod)) throw new Error("Review the share voting method before opening this election.");
  for (const [label, value] of [["record-date authority", review.recordDateBasis], ["articles and class voting rights", review.rightsBasis], ["share register completeness", review.ledgerBasis]]) {
    if (!value || value.trim().length < 12) throw new Error(`Record the reviewed ${label}, including the supporting resolution or document reference.`);
  }
  if (!validElectorateDate(review.recordDateISO) || !/^\d{4}-\d{2}-\d{2}$/.test(review.recordDateISO)) throw new Error("Enter a valid calendar record date.");
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
