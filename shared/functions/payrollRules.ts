import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireRolePortable } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  assertPayrollRuleApplicable,
  cleanPayrollRuleDraft,
  cloneOfficialPayrollRule,
  payrollRuleHash,
  stablePayrollRuleJson,
  type PayrollRuleDraft,
  type PayrollRuleEdition,
  type PayrollRuleProvenance,
  type PayrollRuleStatus,
} from "../payrollRules";

type Row = Omit<PayrollRuleEdition, "rateSet"> & {
  rateSetJson: string;
  _creationTime?: number;
};
async function read(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "financials:read");
}
async function write(ctx: PortableQueryCtx, societyId: string, admin = false) {
  await requirePermissionPortable(ctx, societyId, "financials:write");
  if (admin) await requireRolePortable(ctx, { societyId, required: "Admin" });
  return principalUserId(ctx, societyId);
}
export function hydratePayrollRule(row: Row): PayrollRuleEdition {
  const { rateSetJson, ...metadata } = row;
  return { ...metadata, rateSet: JSON.parse(rateSetJson) };
}
function draftOf(row: PayrollRuleEdition): PayrollRuleDraft {
  return {
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    rateSet: row.rateSet,
    sourceEvidence: row.sourceEvidence,
  };
}
function expected(row: Row, hash: string) {
  if (row.contentHash !== hash)
    throw new Error(
      "This rule edition changed. Reload and review the current content before continuing.",
    );
}
async function owned(ctx: PortableQueryCtx, societyId: string, id: string) {
  return getOwned<Row>(ctx, "payrollRuleEditions", id, societyId);
}
function status(value: unknown): PayrollRuleStatus | undefined {
  if (value === undefined) return undefined;
  if (!["draft", "reviewed", "published", "retired"].includes(String(value)))
    throw new Error("Choose a supported rule status.");
  return value as PayrollRuleStatus;
}
export async function workspacePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    cursor?: string | null;
    status?: PayrollRuleStatus;
    year?: number;
  },
) {
  await read(ctx, args.societyId);
  const selected = status(args.status);
  if (
    args.year !== undefined &&
    (!Number.isInteger(args.year) || args.year < 2026 || args.year > 2100)
  )
    throw new Error("Choose a supported rule year.");
  const scope = JSON.stringify([
    args.societyId,
    selected ?? "",
    args.year ?? "",
  ]);
  let cursor: string | null = null;
  if (args.cursor) {
    let decoded;
    try {
      decoded = JSON.parse(args.cursor);
    } catch {
      throw new Error("Invalid rules page.");
    }
    if (decoded.scope !== scope || typeof decoded.cursor !== "string")
      throw new Error("Rules page does not belong to this query.");
    cursor = decoded.cursor;
  }
  let query = ctx.db.query<Row>("payrollRuleEditions");
  if (args.year !== undefined && selected)
    query = query.withIndex("by_society_year_status", (q) =>
      q
        .eq("societyId", args.societyId)
        .eq("year", args.year)
        .eq("status", selected),
    );
  else if (args.year !== undefined)
    query = query.withIndex("by_society_year", (q) =>
      q.eq("societyId", args.societyId).eq("year", args.year),
    );
  else if (selected)
    query = query.withIndex("by_society_status", (q) =>
      q.eq("societyId", args.societyId).eq("status", selected),
    );
  else
    query = query.withIndex("by_society", (q) =>
      q.eq("societyId", args.societyId),
    );
  const page = await query.order("desc").paginate({ numItems: 40, cursor });
  return {
    ...page,
    page: page.page.map(hydratePayrollRule),
    continueCursor: page.isDone
      ? ""
      : JSON.stringify({ scope, cursor: page.continueCursor }),
  };
}
export async function getPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; id: string },
) {
  await read(ctx, args.societyId);
  return hydratePayrollRule(await owned(ctx, args.societyId, args.id));
}
export async function saveDraftPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    sourceId?: string;
    baseOfficialId?: string;
    expectedHash?: string;
    fields: PayrollRuleDraft;
  },
) {
  const actor = await write(ctx, args.societyId);
  if (args.id && args.sourceId)
    throw new Error("Edit a draft or create a revision, not both.");
  const fields = cleanPayrollRuleDraft(args.fields),
    now = new Date().toISOString();
  if (args.id) {
    const previous = await owned(ctx, args.societyId, args.id);
    if (previous.status !== "draft")
      throw new Error(
        "Reviewed, published and retired content is immutable. Create a new revision.",
      );
    if (!args.expectedHash)
      throw new Error("Reload the current draft before saving.");
    expected(previous, args.expectedHash);
    fields.rateSet.id = `manual:${previous.libraryId}:r${previous.revision}`;
    const contentHash = await payrollRuleHash(fields);
    await ctx.db.patch(args.id, {
      name: fields.name,
      description: fields.description,
      rateSetJson: JSON.stringify(fields.rateSet),
      sourceEvidence: fields.sourceEvidence,
      year: fields.rateSet.year,
      contentHash,
      updatedAtISO: now,
    });
    return args.id;
  }
  let libraryId = "",
    revision = 1,
    baseOfficialId = args.baseOfficialId ?? "";
  if (args.sourceId) {
    const source = await owned(ctx, args.societyId, args.sourceId);
    libraryId = source.libraryId;
    baseOfficialId = source.baseOfficialId;
    const latest = await ctx.db
      .query<Row>("payrollRuleEditions")
      .withIndex("by_society_library_revision", (q) =>
        q.eq("societyId", args.societyId).eq("libraryId", libraryId),
      )
      .order("desc")
      .take(1);
    revision = (latest[0]?.revision ?? 0) + 1;
  }
  cloneOfficialPayrollRule(baseOfficialId);
  const id = await ctx.db.insert("payrollRuleEditions", {
    societyId: args.societyId,
    libraryId,
    revision,
    status: "draft",
    baseOfficialId,
    name: fields.name,
    ...(fields.description ? { description: fields.description } : {}),
    rateSetJson: JSON.stringify(fields.rateSet),
    sourceEvidence: fields.sourceEvidence,
    contentHash: "pending",
    year: fields.rateSet.year,
    createdByUserId: actor,
    createdAtISO: now,
    updatedAtISO: now,
  });
  libraryId ||= id;
  fields.rateSet.id = `manual:${libraryId}:r${revision}`;
  await ctx.db.patch(id, {
    libraryId,
    rateSetJson: JSON.stringify(fields.rateSet),
    contentHash: await payrollRuleHash(fields),
  });
  return id;
}
export async function reviewPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    expectedHash: string;
    evidence: string;
    confirmed: boolean;
  },
) {
  const actor = await write(ctx, args.societyId, true),
    row = await owned(ctx, args.societyId, args.id);
  expected(row, args.expectedHash);
  if (row.status !== "draft") throw new Error("Only a draft can be reviewed.");
  if (!args.confirmed || !args.evidence.trim() || args.evidence.length > 8000)
    throw new Error(
      "Confirm the actual parameter, effective-date and source review and retain its evidence.",
    );
  const fields = cleanPayrollRuleDraft(draftOf(hydratePayrollRule(row)));
  if ((await payrollRuleHash(fields)) !== row.contentHash)
    throw new Error(
      "The stored rule content no longer matches its integrity hash.",
    );
  const today = new Date().toISOString().slice(0, 10);
  if (fields.sourceEvidence.some((source) => source.reviewedOn > today))
    throw new Error("A source review cannot be dated in the future.");
  const now = new Date().toISOString();
  await ctx.db.patch(row._id, {
    status: "reviewed",
    reviewedByUserId: actor,
    reviewedAtISO: now,
    reviewEvidence: args.evidence.trim(),
    updatedAtISO: now,
  });
  return row._id;
}
export async function publishPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string; expectedHash: string },
) {
  const actor = await write(ctx, args.societyId, true),
    row = await owned(ctx, args.societyId, args.id);
  expected(row, args.expectedHash);
  if (row.status !== "reviewed" || !row.reviewedByUserId || !row.reviewedAtISO)
    throw new Error(
      "Review the exact draft and its sources before publishing.",
    );
  if (
    (await payrollRuleHash(draftOf(hydratePayrollRule(row)))) !==
    row.contentHash
  )
    throw new Error(
      "The stored rule content no longer matches its integrity hash.",
    );
  const now = new Date().toISOString();
  await ctx.db.patch(row._id, {
    status: "published",
    publishedByUserId: actor,
    publishedAtISO: now,
    updatedAtISO: now,
  });
  return row._id;
}
export async function retirePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; id: string; reason: string },
) {
  const actor = await write(ctx, args.societyId, true);
  const row = await owned(ctx, args.societyId, args.id);
  if (!["published", "reviewed"].includes(row.status))
    throw new Error("Only a published or reviewed edition can be retired.");
  if (!args.reason.trim() || args.reason.length > 4000)
    throw new Error("Retain the reason for retirement.");
  const now = new Date().toISOString();
  await ctx.db.patch(row._id, {
    status: "retired",
    retiredByUserId: actor,
    retiredAtISO: now,
    retirementReason: args.reason.trim(),
    updatedAtISO: now,
  });
  return row._id;
}
export async function loadPublishedPayrollRulePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    id: string;
    payDate: string;
    province: string;
    method: string;
  },
): Promise<{
  rateSet: PayrollRuleDraft["rateSet"];
  provenance: PayrollRuleProvenance;
}> {
  await read(ctx, args.societyId);
  const row = await owned(ctx, args.societyId, args.id);
  if (
    row.status !== "published" ||
    !row.reviewedByUserId ||
    !row.reviewedAtISO ||
    !row.publishedAtISO
  )
    throw new Error(
      "Choose a reviewed and published payroll rule edition. Draft and retired editions cannot calculate new payroll.",
    );
  const draft = cleanPayrollRuleDraft(draftOf(hydratePayrollRule(row)));
  if ((await payrollRuleHash(draft)) !== row.contentHash)
    throw new Error("The published rule content failed its integrity check.");
  const rateSet = assertPayrollRuleApplicable(draft.rateSet, args);
  const provenance: PayrollRuleProvenance = {
    id: row._id,
    libraryId: row.libraryId,
    revision: row.revision,
    version: row.revision,
    name: row.name,
    status: "published",
    contentHash: row.contentHash,
    sourceEvidence: draft.sourceEvidence,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAtISO: row.reviewedAtISO,
    publishedAtISO: row.publishedAtISO,
    rateSet,
  };
  return JSON.parse(stablePayrollRuleJson({ rateSet, provenance }));
}
