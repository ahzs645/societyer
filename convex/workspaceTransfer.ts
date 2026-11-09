/**
 * Destination side of the workspace transfer (scripts/workspace-transfer.ts).
 *
 * Internal only: the CLI calls these with the destination's admin key. Every
 * write re-applies the reviewed table policy, refuses rows outside the run's
 * society and records the source→destination id in the same transaction as
 * the write, so a retried batch finds its mapping instead of inserting twice.
 * The society stays quarantined (no bindings, cron jobs skip it) until
 * `finalize`, and `abort` removes exactly what the id map recorded.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { convexPortableDb } from "./lib/portable";
import { activePersonLinks, membershipsForIdentities, personLinkState } from "../shared/functions/identity";
import { IMPORTED_AUTH_BINDING_FIELDS } from "../shared/workspaceIdentity";
import { applyPolicy, QUARANTINE_FIELD, transferPolicy, type TransferRow } from "../shared/workspaceTransfer/policy";
import { normalizeSha256, schemaDigest, societyField, societyIndexes, tableValidators, visitIds } from "../shared/workspaceTransfer/validators";

const VALIDATORS = tableValidators(schema);
const SOCIETY_INDEXES = societyIndexes(schema);
let cachedSchemaDigest: Promise<string> | null = null;
const currentSchemaDigest = () => (cachedSchemaDigest ??= schemaDigest(VALIDATORS));

const runArg = { runId: v.id("workspaceTransferRuns") };
type Run = Doc<"workspaceTransferRuns">;
type Ctx = QueryCtx | MutationCtx;

async function loadRun(ctx: Ctx, runId: Id<"workspaceTransferRuns">): Promise<Run> {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Transfer run not found.");
  return run;
}

function requireWritable(run: Run): Id<"societies"> | undefined {
  if (run.status !== "applying" && run.status !== "applied" && run.status !== "verified") {
    throw new Error(`Transfer run is ${run.status}; it accepts no more writes.`);
  }
  return run.destSocietyId;
}

async function mappingBySource(ctx: Ctx, runId: Id<"workspaceTransferRuns">, sourceId: string) {
  return ctx.db.query("workspaceTransferIdMap").withIndex("by_run_source", (q) => q.eq("runId", runId).eq("sourceId", sourceId)).unique();
}

async function mappingByDest(ctx: Ctx, runId: Id<"workspaceTransferRuns">, destId: string) {
  return ctx.db.query("workspaceTransferIdMap").withIndex("by_run_dest", (q) => q.eq("runId", runId).eq("destId", destId)).unique();
}

/** The run's id map in source-id order, after `after` (a page cursor that survives deletes). */
function mapRowsAfter(ctx: Ctx, runId: Id<"workspaceTransferRuns">, after: string | undefined | null) {
  return ctx.db.query("workspaceTransferIdMap")
    .withIndex("by_run_source", (q) => after ? q.eq("runId", runId).gt("sourceId", after) : q.eq("runId", runId));
}

/** Bounds a page by rows and by bytes of documents read, so large rows stay inside one transaction's read limit. */
function pageBudget(maxRows = 100, maxBytes = 4_000_000) {
  let bytes = 0;
  const budget = {
    rows: 0,
    last: undefined as string | undefined,
    full: () => budget.rows >= maxRows || bytes >= maxBytes,
    take(sourceId: string, doc: unknown) {
      budget.rows += 1;
      budget.last = sourceId;
      bytes += doc ? JSON.stringify(doc).length : 64;
    },
  };
  return budget;
}

/** Any write invalidates an earlier verification. */
const reopened = { status: "applying" as const, verifyCursor: undefined, verifyCheckedRows: undefined, verifyIssues: undefined,
  serverVerifiedAtISO: undefined, clientVerifiedAtISO: undefined, verificationSummary: undefined };

/**
 * A transferred row may only reference rows this run wrote (or the run's own
 * society). Anything else would point into another workspace on this deployment.
 */
async function refProblems(ctx: Ctx, run: Run, table: string, doc: TransferRow): Promise<string[]> {
  const validator = VALIDATORS.get(table);
  if (!validator) return [`${table} is not in this deployment's schema`];
  const refs: Array<{ target: string; id: string; path: string }> = [];
  visitIds(validator, doc, (target, id, path) => refs.push({ target, id, path }));
  const problems: string[] = [];
  for (const ref of refs) {
    if (ref.target === "societies") {
      if (ref.id !== run.destSocietyId) problems.push(`${table}.${ref.path} references another workspace`);
      continue;
    }
    const mapping = await mappingByDest(ctx, run._id, ref.id);
    if (!mapping || mapping.sourceTable !== ref.target) problems.push(`${table}.${ref.path} references a ${ref.target} row this transfer did not write`);
  }
  const ownership = societyField(validator);
  if (table !== "societies" && ownership !== "none" && doc.societyId !== run.destSocietyId) problems.push(`${table}.societyId is not the transferred workspace`);
  return problems;
}

/** Policy, quarantine and ownership rules every destination write goes through. */
async function prepareDoc(ctx: MutationCtx, run: Run, table: string, incoming: TransferRow, existing: TransferRow | null) {
  const policy = transferPolicy(table);
  if (!policy || policy.mode === "skip") throw new Error(`Table ${table} is not copied by a workspace transfer.`);
  const doc = applyPolicy(table, incoming);
  let publicSlug: string | undefined;
  if (table === "societies") {
    if (typeof doc.publicSlug === "string") publicSlug = doc.publicSlug;
    delete doc.publicSlug;
    doc[QUARANTINE_FIELD] = typeof existing?.[QUARANTINE_FIELD] === "string" ? existing[QUARANTINE_FIELD] : new Date().toISOString();
  }
  if (table === "users") for (const field of IMPORTED_AUTH_BINDING_FIELDS) delete doc[field];
  const problems = await refProblems(ctx, run, table, doc);
  if (problems.length) throw new Error(`Refused ${table}: ${problems.slice(0, 3).join("; ")}.`);
  return { doc, publicSlug };
}

export const status = internalQuery({
  args: { label: v.string() },
  returns: v.any(),
  handler: async (ctx, { label }) => ctx.db.query("workspaceTransferRuns").withIndex("by_label", (q) => q.eq("label", label)).unique(),
});

export const begin = internalMutation({
  args: {
    label: v.string(), sourceDeployment: v.string(), sourceSocietyId: v.string(),
    planDigest: v.string(), exportDigest: v.string(), schemaDigest: v.string(),
    plannedRows: v.number(), plannedFiles: v.number(), note: v.optional(v.string()),
  },
  returns: v.id("workspaceTransferRuns"),
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(args.label)) throw new Error("Use a run label of letters, digits, '.', '_' or '-'.");
    if (args.schemaDigest !== await currentSchemaDigest()) {
      throw new Error("The destination runs a different schema than this CLI checkout. Deploy the same release first.");
    }
    const existing = await ctx.db.query("workspaceTransferRuns").withIndex("by_label", (q) => q.eq("label", args.label)).unique();
    if (existing) {
      if (existing.planDigest !== args.planDigest || existing.exportDigest !== args.exportDigest || existing.sourceSocietyId !== args.sourceSocietyId) {
        throw new Error(`Run ${args.label} was started from a different export or plan; use a new label.`);
      }
      if (existing.status === "finalized" || existing.status === "aborting" || existing.status === "aborted") {
        throw new Error(`Run ${args.label} is ${existing.status}.`);
      }
      return existing._id;
    }
    // A second live copy of the same workspace on one deployment is an operator mistake.
    const duplicate = (await ctx.db.query("workspaceTransferRuns").collect())
      .find((run) => run.sourceSocietyId === args.sourceSocietyId && run.status !== "aborted");
    if (duplicate) throw new Error(`Run ${duplicate.label} already transfers this workspace; abort it before starting another.`);
    const now = new Date().toISOString();
    return ctx.db.insert("workspaceTransferRuns", {
      label: args.label, sourceDeployment: args.sourceDeployment, sourceSocietyId: args.sourceSocietyId,
      status: "applying", planDigest: args.planDigest, exportDigest: args.exportDigest, schemaDigest: args.schemaDigest,
      plannedRows: args.plannedRows, plannedFiles: args.plannedFiles, insertedRows: 0, rewrittenRows: 0, uploadedFiles: 0, boundMemberships: 0,
      ...(args.note ? { note: args.note } : {}), createdAtISO: now, updatedAtISO: now,
    });
  },
});

export const idMapPage = internalQuery({
  args: { ...runArg, cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, { runId, cursor }) => {
    const page = await ctx.db.query("workspaceTransferIdMap").withIndex("by_run_source", (q) => q.eq("runId", runId))
      .paginate({ cursor, numItems: 1000 });
    return {
      page: page.page.map((row) => ({ sourceTable: row.sourceTable, sourceId: row.sourceId, destId: row.destId, rewritten: Boolean(row.rewrittenAtISO) })),
      isDone: page.isDone, continueCursor: page.continueCursor,
    };
  },
});

const item = v.object({ table: v.string(), sourceId: v.string(), doc: v.any() });

/** Pass 1. Rows arrive with required references already mapped and optional ones omitted. */
export const insertBatch = internalMutation({
  args: { ...runArg, items: v.array(item) },
  returns: v.array(v.object({ sourceId: v.string(), destId: v.string(), inserted: v.boolean() })),
  handler: async (ctx, { runId, items }) => {
    if (items.length > 200) throw new Error("Batch too large.");
    let run = await loadRun(ctx, runId);
    requireWritable(run);
    const db = convexPortableDb(ctx.db);
    const results: Array<{ sourceId: string; destId: string; inserted: boolean }> = [];
    let inserted = 0;
    for (const { table, sourceId, doc } of items) {
      const existing = await mappingBySource(ctx, runId, sourceId);
      if (existing) {
        if (existing.sourceTable !== table) throw new Error(`Source id ${sourceId} was mapped as ${existing.sourceTable}.`);
        results.push({ sourceId, destId: existing.destId, inserted: false });
        continue;
      }
      if (table === "societies") {
        if (run.destSocietyId) throw new Error("This run already created its workspace.");
        if (sourceId !== run.sourceSocietyId) throw new Error("Only the planned source workspace can be created.");
      } else if (!run.destSocietyId) throw new Error("Create the workspace before its rows.");
      const prepared = await prepareDoc(ctx, run, table, doc as TransferRow, null);
      const destId = await db.insert(table, prepared.doc);
      await ctx.db.insert("workspaceTransferIdMap", { runId, sourceTable: table, sourceId, destId });
      if (table === "societies") {
        await ctx.db.patch(runId, { destSocietyId: destId as Id<"societies">, ...(prepared.publicSlug ? { deferredPublicSlug: prepared.publicSlug } : {}) });
        run = await loadRun(ctx, runId);
      }
      inserted += 1;
      results.push({ sourceId, destId, inserted: true });
    }
    if (inserted) await ctx.db.patch(runId, { ...reopened, insertedRows: run.insertedRows + inserted, updatedAtISO: new Date().toISOString() });
    return results;
  },
});

export const generateUploadUrl = internalMutation({
  args: runArg,
  returns: v.string(),
  handler: async (ctx, { runId }) => {
    const run = await loadRun(ctx, runId);
    if (!requireWritable(run)) throw new Error("Create the workspace before uploading files.");
    return ctx.storage.generateUploadUrl();
  },
});

/** Maps an uploaded blob after checking the destination's own checksum, and claims it for the workspace. */
export const recordFile = internalMutation({
  args: { ...runArg, sourceId: v.string(), destStorageId: v.string(), sha256: v.string(), size: v.number() },
  returns: v.object({ destId: v.string(), recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await loadRun(ctx, args.runId);
    const societyId = requireWritable(run);
    if (!societyId) throw new Error("Create the workspace before uploading files.");
    const storageId = ctx.db.system.normalizeId("_storage", args.destStorageId);
    if (!storageId) throw new Error("Not a storage id.");
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw new Error("The uploaded file was not found.");
    const existing = await mappingBySource(ctx, args.runId, args.sourceId);
    if (existing) {
      // A retried upload after an ambiguous response: keep the first copy.
      if (existing.destId !== storageId) await ctx.storage.delete(storageId);
      return { destId: existing.destId, recorded: false };
    }
    if (normalizeSha256(meta.sha256) !== args.sha256.toLowerCase() || meta.size !== args.size) {
      await ctx.storage.delete(storageId);
      throw new Error(`File ${args.sourceId} arrived with a different checksum or size; it was deleted.`);
    }
    const claims = await ctx.db.query("storageOwnership").withIndex("by_storage", (q) => q.eq("storageId", storageId)).collect();
    if (claims.length) throw new Error("The uploaded file is already claimed.");
    const now = new Date().toISOString();
    await ctx.db.insert("storageOwnership", { storageId, societyId, createdAtISO: now });
    await ctx.db.insert("workspaceTransferIdMap", { runId: args.runId, sourceTable: "_storage", sourceId: args.sourceId, destId: storageId });
    await ctx.db.patch(args.runId, { ...reopened, uploadedFiles: run.uploadedFiles + 1, updatedAtISO: now });
    return { destId: storageId, recorded: true };
  },
});

/** Pass 2. Replaces each row with its final document: every typed and string-held reference rewritten. */
export const rewriteBatch = internalMutation({
  args: { ...runArg, items: v.array(item) },
  returns: v.number(),
  handler: async (ctx, { runId, items }) => {
    if (items.length > 200) throw new Error("Batch too large.");
    const run = await loadRun(ctx, runId);
    if (!requireWritable(run)) throw new Error("Create the workspace first.");
    const db = convexPortableDb(ctx.db);
    let rewritten = 0;
    const now = new Date().toISOString();
    for (const { table, sourceId, doc } of items) {
      const mapping = await mappingBySource(ctx, runId, sourceId);
      if (!mapping || mapping.sourceTable !== table) throw new Error(`No ${table} mapping for ${sourceId}.`);
      const current = await db.get(mapping.destId, table);
      if (!current) throw new Error(`The ${table} row for ${sourceId} is missing.`);
      const prepared = await prepareDoc(ctx, run, table, doc as TransferRow, current);
      await db.replace(mapping.destId, prepared.doc);
      if (table === "societies" && prepared.publicSlug !== run.deferredPublicSlug) await ctx.db.patch(runId, { deferredPublicSlug: prepared.publicSlug });
      if (!mapping.rewrittenAtISO) {
        await ctx.db.patch(mapping._id, { rewrittenAtISO: now });
        rewritten += 1;
      }
    }
    await ctx.db.patch(runId, { ...reopened, rewrittenRows: run.rewrittenRows + rewritten, updatedAtISO: now });
    return rewritten;
  },
});

export const completeApply = internalMutation({
  args: runArg,
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await loadRun(ctx, runId);
    requireWritable(run);
    if (run.insertedRows !== run.plannedRows || run.rewrittenRows !== run.plannedRows || run.uploadedFiles !== run.plannedFiles) {
      throw new Error(`Run is incomplete: ${run.insertedRows}/${run.plannedRows} rows inserted, ${run.rewrittenRows} rewritten, ${run.uploadedFiles}/${run.plannedFiles} files.`);
    }
    if (run.status === "applying") await ctx.db.patch(runId, { status: "applied", updatedAtISO: new Date().toISOString() });
    return null;
  },
});

/**
 * Server-side reference check, one page per call (progress kept on the run):
 * every row and file the run wrote exists, belongs to the workspace, and only
 * references rows this run wrote.
 */
export const verifyPage = internalMutation({
  args: { ...runArg, restart: v.boolean() },
  returns: v.object({ checked: v.number(), issues: v.array(v.string()), isDone: v.boolean(), totalIssues: v.number() }),
  handler: async (ctx, { runId, restart }) => {
    let run = await loadRun(ctx, runId);
    if (run.status !== "applied" && run.status !== "verified") throw new Error(`Run is ${run.status}; finish apply first.`);
    if (restart) {
      await ctx.db.patch(runId, { verifyCursor: undefined, verifyCheckedRows: 0, verifyIssues: 0, serverVerifiedAtISO: undefined, clientVerifiedAtISO: undefined });
      run = await loadRun(ctx, runId);
    }
    const issues: string[] = [];
    const society = run.destSocietyId ? await ctx.db.get(run.destSocietyId) : null;
    if (!society) issues.push("The transferred workspace is missing.");
    else if (!society.transferQuarantinedAtISO) issues.push("The transferred workspace is no longer quarantined.");
    const db = convexPortableDb(ctx.db);
    const budget = pageBudget();
    for await (const mapping of mapRowsAfter(ctx, runId, run.verifyCursor)) {
      if (budget.full()) break;
      if (mapping.sourceTable === "_storage") {
        const storageId = ctx.db.system.normalizeId("_storage", mapping.destId);
        const meta = storageId ? await ctx.db.system.get(storageId) : null;
        const claims = storageId ? await ctx.db.query("storageOwnership").withIndex("by_storage", (q) => q.eq("storageId", storageId)).collect() : [];
        budget.take(mapping.sourceId, meta);
        if (!meta) issues.push(`File ${mapping.sourceId} is missing.`);
        else if (claims.length !== 1 || claims[0].societyId !== run.destSocietyId) issues.push(`File ${mapping.sourceId} is not claimed by the workspace alone.`);
        continue;
      }
      const doc = await db.get(mapping.destId, mapping.sourceTable);
      budget.take(mapping.sourceId, doc);
      if (!doc) issues.push(`${mapping.sourceTable} ${mapping.sourceId} is missing.`);
      else for (const problem of await refProblems(ctx, run, mapping.sourceTable, doc)) issues.push(`${problem} (${mapping.sourceId})`);
    }
    const isDone = !budget.full();
    const totalIssues = (run.verifyIssues ?? 0) + issues.length;
    await ctx.db.patch(runId, {
      verifyCursor: isDone ? undefined : budget.last,
      verifyCheckedRows: (run.verifyCheckedRows ?? 0) + budget.rows,
      verifyIssues: totalIssues,
      ...(isDone && totalIssues === 0 ? { serverVerifiedAtISO: new Date().toISOString() } : {}),
    });
    return { checked: budget.rows, issues: issues.slice(0, 50), isDone, totalIssues };
  },
});

/** Rows of one table that carry the workspace's id, through a `societyId`-first index. */
export const countSocietyRows = internalQuery({
  args: { ...runArg, table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ indexed: v.boolean(), count: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { runId, table, cursor }) => {
    const run = await loadRun(ctx, runId);
    const index = SOCIETY_INDEXES.get(table);
    if (!index || !run.destSocietyId) return { indexed: false, count: 0, isDone: true, continueCursor: "" };
    const societyId = run.destSocietyId;
    const page = await convexPortableDb(ctx.db).query(table).withIndex(index, (q) => q.eq("societyId", societyId))
      .paginate({ cursor, numItems: 1000, maximumBytesRead: 4_000_000 });
    return { indexed: true, count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** The run's rows as stored, for the CLI's content comparison. `cursor` is the last source id returned. */
export const exportPage = internalQuery({
  args: { ...runArg, cursor: v.union(v.string(), v.null()) },
  returns: v.any(),
  handler: async (ctx, { runId, cursor }) => {
    const db = convexPortableDb(ctx.db);
    const budget = pageBudget(200);
    const rows: Array<Record<string, unknown>> = [];
    for await (const mapping of mapRowsAfter(ctx, runId, cursor)) {
      if (budget.full()) break;
      if (mapping.sourceTable === "_storage") {
        const storageId = ctx.db.system.normalizeId("_storage", mapping.destId);
        const meta = storageId ? await ctx.db.system.get(storageId) : null;
        budget.take(mapping.sourceId, meta);
        rows.push({ sourceTable: mapping.sourceTable, sourceId: mapping.sourceId, destId: mapping.destId,
          file: meta ? { sha256: normalizeSha256(meta.sha256), size: meta.size } : null });
      } else {
        const doc = await db.get(mapping.destId, mapping.sourceTable);
        budget.take(mapping.sourceId, doc);
        rows.push({ sourceTable: mapping.sourceTable, sourceId: mapping.sourceId, destId: mapping.destId, doc });
      }
    }
    return { page: rows, isDone: !budget.full(), continueCursor: budget.last ?? "" };
  },
});

export const recordVerification = internalMutation({
  args: { ...runArg, ok: v.boolean(), summary: v.string() },
  returns: v.string(),
  handler: async (ctx, { runId, ok, summary }) => {
    const run = await loadRun(ctx, runId);
    if (run.status !== "applied" && run.status !== "verified") throw new Error(`Run is ${run.status}.`);
    const passed = ok && Boolean(run.serverVerifiedAtISO);
    await ctx.db.patch(runId, {
      status: passed ? "verified" : "applied", clientVerifiedAtISO: passed ? new Date().toISOString() : undefined,
      verificationSummary: summary.slice(0, 20_000), updatedAtISO: new Date().toISOString(),
    });
    return passed ? "verified" : "applied";
  },
});

/** Opens the workspace: requires a passing verification and an unused public slug. */
export const finalize = internalMutation({
  args: { ...runArg, dropPublicSlug: v.optional(v.boolean()) },
  returns: v.object({ societyId: v.id("societies"), publicSlug: v.optional(v.string()) }),
  handler: async (ctx, { runId, dropPublicSlug }) => {
    const run = await loadRun(ctx, runId);
    if (run.status !== "verified" || !run.serverVerifiedAtISO || !run.clientVerifiedAtISO) throw new Error("Run a passing verify before finalize.");
    const societyId = run.destSocietyId;
    const society = societyId ? await ctx.db.get(societyId) : null;
    if (!societyId || !society?.transferQuarantinedAtISO) throw new Error("The transferred workspace is missing or already open.");
    const slug = dropPublicSlug ? undefined : run.deferredPublicSlug;
    if (slug) {
      const taken = await ctx.db.query("societies").withIndex("by_public_slug", (q) => q.eq("publicSlug", slug)).first();
      if (taken) throw new Error(`Public slug "${slug}" is already used on this deployment; finalize with --drop-public-slug and choose another later.`);
    }
    await ctx.db.patch(societyId, { transferQuarantinedAtISO: undefined, ...(slug ? { publicSlug: slug } : {}) });
    const now = new Date().toISOString();
    await ctx.db.patch(runId, { status: "finalized", finishedAtISO: now, updatedAtISO: now });
    return { societyId, ...(slug ? { publicSlug: slug } : {}) };
  },
});

/**
 * Binds one imported membership to an exact destination identity. Never by
 * email, never a second membership in the workspace, never an already bound
 * row, and only once the run is finalized (so nobody reaches a quarantined
 * workspace). Status is kept: a Disabled membership stays Disabled.
 */
export async function bindTransferredMembership(ctx: MutationCtx, args: {
  runId: Id<"workspaceTransferRuns">; userId: Id<"users">; authIssuer: string; authSubject: string; reason: string; actor: string;
}): Promise<{ userId: Id<"users">; role: string; status: string }> {
  const run = await loadRun(ctx, args.runId);
  if (run.status !== "finalized") throw new Error("Finalize the transfer before binding memberships.");
  const issuer = args.authIssuer.trim();
  const subject = args.authSubject.trim();
  const reason = args.reason.trim();
  if (!reason || reason.length > 500) throw new Error("Give a reason of at most 500 characters (who confirmed this person).");
  if (!process.env.CONVEX_SITE_URL || issuer !== process.env.CONVEX_SITE_URL) throw new Error("Bind only identities issued by this deployment (CONVEX_SITE_URL).");
  if (!subject) throw new Error("Auth subject is required.");
  const mapping = await mappingByDest(ctx, args.runId, args.userId);
  if (!mapping || mapping.sourceTable !== "users") throw new Error("That membership was not imported by this run.");
  const user = await ctx.db.get(args.userId);
  if (!user || user.societyId !== run.destSocietyId) throw new Error("That membership was not imported by this run.");
  if (user.authSubject || user.authIssuer || user.externalIdentityId) throw new Error("That membership is already bound.");
  const own = await ctx.db.query("users").withIndex("by_auth_identity", (q) => q.eq("authIssuer", issuer).eq("authSubject", subject)).take(500);
  if (own.some((row) => row.societyId === user.societyId)) throw new Error("That identity already has a membership in this workspace.");
  const portable = convexPortableDb(ctx.db);
  const link = await personLinkState(portable, { issuer, subject });
  if (link.kind === "blocked") throw new Error("That identity's linked logins are in conflict; resolve them first.");
  if (link.kind === "linked") {
    const linked = await membershipsForIdentities(portable, await activePersonLinks(portable, link.person._id));
    if (linked.some((row) => row.societyId === user.societyId)) throw new Error("That person already has a membership in this workspace through a linked login.");
  }
  const identities = await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", (q) => q.eq("issuer", issuer).eq("subject", subject)).collect();
  if (identities.length > 1 || (identities[0] && identities[0].status !== "Active")) throw new Error("That identity is disabled or ambiguous.");
  const now = new Date().toISOString();
  const externalIdentityId = identities[0]?._id ?? await ctx.db.insert("externalIdentities", { issuer, subject, status: "Active", createdAtISO: now });
  await ctx.db.patch(args.userId, { authIssuer: issuer, authSubject: subject, authProvider: "convex", externalIdentityId });
  await ctx.db.insert("activity", {
    societyId: user.societyId, actor: args.actor, entityType: "user", entityId: args.userId, subjectId: args.userId,
    action: "transfer-membership-bound", summary: `Bound a transferred membership to a login: ${reason}`, createdAtISO: now,
  });
  await ctx.db.patch(args.runId, { boundMemberships: run.boundMemberships + 1, updatedAtISO: now });
  return { userId: args.userId, role: user.role, status: user.status };
}

export const bindMembership = internalMutation({
  args: { ...runArg, userId: v.id("users"), authIssuer: v.string(), authSubject: v.string(), reason: v.string() },
  returns: v.object({ userId: v.id("users"), role: v.string(), status: v.string() }),
  handler: (ctx, args) => bindTransferredMembership(ctx, { ...args, actor: "Deployment operator (workspace transfer)" }),
});

/** Imported membership lookup for the bind CSV: by source id, or by exact imported email when unique. */
export const importedMembership = internalQuery({
  args: { ...runArg, sourceUserId: v.optional(v.string()), email: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { runId, sourceUserId, email }) => {
    const run = await loadRun(ctx, runId);
    if (sourceUserId) {
      const mapping = await mappingBySource(ctx, runId, sourceUserId);
      if (!mapping || mapping.sourceTable !== "users") return { status: "not-found" };
      const user = await ctx.db.get(mapping.destId as Id<"users">);
      return user ? { status: "found", userId: user._id, email: user.email, role: user.role, bound: Boolean(user.authSubject) } : { status: "not-found" };
    }
    if (!email || !run.destSocietyId) return { status: "not-found" };
    const wanted = email.trim().toLowerCase();
    const societyId = run.destSocietyId;
    const rows = (await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())
      .filter((row) => row.email.trim().toLowerCase() === wanted);
    if (rows.length !== 1) return { status: rows.length ? "ambiguous" : "not-found" };
    return { status: "found", userId: rows[0]._id, email: rows[0].email, role: rows[0].role, bound: Boolean(rows[0].authSubject) };
  },
});

/** Deletes one page (up to 100 rows or files) of what the run wrote, never another workspace's, the society last. Call until `done`. */
export const abort = internalMutation({
  args: runArg,
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, { runId }) => {
    const run = await loadRun(ctx, runId);
    if (run.status === "aborted") return { deleted: 0, done: true };
    if (run.status === "finalized") throw new Error("The workspace is open; members may have written to it. Abort is only for unfinalized runs.");
    if (run.status !== "aborting") await ctx.db.patch(runId, { status: "aborting", updatedAtISO: new Date().toISOString() });
    const db = convexPortableDb(ctx.db);
    const page = await ctx.db.query("workspaceTransferIdMap").withIndex("by_run_source", (q) => q.eq("runId", runId)).take(101);
    const rows = page.filter((mapping) => mapping.sourceTable !== "societies").slice(0, 100);
    const budget = pageBudget();
    for (const mapping of rows) {
      if (budget.full()) break;
      if (mapping.sourceTable === "_storage") {
        const storageId = ctx.db.system.normalizeId("_storage", mapping.destId);
        budget.take(mapping.sourceId, null);
        if (storageId) {
          const claims = await ctx.db.query("storageOwnership").withIndex("by_storage", (q) => q.eq("storageId", storageId)).collect();
          for (const claim of claims) if (claim.societyId === run.destSocietyId) await ctx.db.delete(claim._id);
          if (await ctx.db.system.get(storageId)) await ctx.storage.delete(storageId);
        }
      } else {
        const doc = await db.get(mapping.destId, mapping.sourceTable);
        budget.take(mapping.sourceId, doc);
        const owner = doc?.societyId;
        if (doc && (owner === undefined || owner === run.destSocietyId)) await db.delete(mapping.destId);
      }
      await ctx.db.delete(mapping._id);
    }
    let deleted = budget.rows;
    if (rows.length === 0) {
      for (const mapping of page) {
        if (await db.get(mapping.destId, "societies")) await db.delete(mapping.destId);
        await ctx.db.delete(mapping._id);
        deleted += 1;
      }
      const now = new Date().toISOString();
      await ctx.db.patch(runId, { status: "aborted", finishedAtISO: now, updatedAtISO: now });
      return { deleted, done: true };
    }
    return { deleted, done: false };
  },
});
