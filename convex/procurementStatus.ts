/** A paused catalog is distinguishable from an empty catalog without exposing partial rows. */
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { authorizedQuery } from "./lib/authorizedServer";
import { requireEnabledModule } from "./lib/moduleSettings";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { procurementPublicationFields } from "./tables/procurement";

const nullableText = v.union(v.string(), v.null());
/** Publisher/operator receipt only. This never writes serving rows or their read gate. */
export const reportSource = internalMutation({
  args: {
    schemaVersion:v.literal(1),societyId:v.id("societies"),folder:v.string(),publicationId:v.string(),sourceSnapshotId:v.string(),generation:v.optional(v.string()),
    publishedAt:v.string(),collectedAt:v.optional(v.string()),complete:v.boolean(),coverage:procurementPublicationFields.coverage,
    state:v.union(v.literal("published"),v.literal("failed"),v.literal("ready")),phase:v.string(),error:v.optional(v.string()),heartbeatAt:v.string(),
  },
  returns:v.object({accepted:v.boolean(),state:v.union(v.literal("published"),v.literal("failed"),v.literal("ready"))}),
  handler:async(ctx,args)=>{
    validateWorkspaceProcurementReviewFolder(args.societyId,args.folder);
    const society=await ctx.db.get(args.societyId);
    if(society?.integrationSettings?.procurementReviewFolder!==args.folder)throw new Error("Workspace folder changed; source announcement refused.");
    const publishedAtMs=Date.parse(args.publishedAt),heartbeatAt=Date.parse(args.heartbeatAt),generation=args.generation??args.publicationId+"-reader-v2";
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(args.publicationId)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(args.sourceSnapshotId)||!generation||generation.length>256||!args.phase||args.phase.length>150||![publishedAtMs,heartbeatAt].every(Number.isFinite)||publishedAtMs>Date.now()+300_000||heartbeatAt>Date.now()+300_000||(args.collectedAt!==undefined&&!Number.isFinite(Date.parse(args.collectedAt))))throw new Error("Invalid source-publication receipt.");
    if(args.coverage&&args.complete!==(args.coverage.complete&&args.coverage.sources.every(source=>source.complete)))throw new Error("Source completeness does not match its declared coverage.");
    const coverageJson=args.coverage?JSON.stringify(args.coverage,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value):undefined;
    const prior=await ctx.db.query("procurementSourcePublications").withIndex("by_identity",q=>q.eq("societyId",args.societyId).eq("folder",args.folder).eq("publicationId",args.publicationId)).unique();
    if(prior&&(prior.sourceSnapshotId!==args.sourceSnapshotId||prior.generation!==generation||prior.publishedAtMs!==publishedAtMs||prior.collectedAt!==args.collectedAt||prior.complete!==args.complete||prior.coverageJson!==coverageJson))throw new Error("Source publication identity or immutable metadata changed.");
    const active=await ctx.db.query("procurementCatalogs").withIndex("by_society",q=>q.eq("societyId",args.societyId)).unique();
    const serving=active?.folder===args.folder&&!active.syncRunId&&active.generation===generation&&(active.publicationId===args.publicationId||(!active.publicationId&&active.sourceSnapshotId===args.sourceSnapshotId));
    if(args.state==="ready"&&!serving&&prior?.state!=="ready")throw new Error("Cannot report a source publication ready before its catalog is serving.");
    const state=serving||prior?.state==="ready"?"ready" as const:args.state;
    const rank={published:0,failed:1,ready:2};
    if(prior&&(heartbeatAt<prior.heartbeatAt||(heartbeatAt===prior.heartbeatAt&&rank[state]<=rank[prior.state])))return{accepted:false,state:prior.state};
    const progress={state,phase:state==="ready"?"ready":args.phase,heartbeatAt,error:state==="ready"?undefined:args.error?.slice(0,2000)};
    if(prior)await ctx.db.patch(prior._id,progress);
    else await ctx.db.insert("procurementSourcePublications",{societyId:args.societyId,folder:args.folder,publicationId:args.publicationId,sourceSnapshotId:args.sourceSnapshotId,generation,publishedAt:args.publishedAt,publishedAtMs,...(args.collectedAt?{collectedAt:args.collectedAt}:{}),complete:args.complete,...(coverageJson?{coverageJson}:{}),announcedAt:Date.now(),...progress});
    return{accepted:true,state};
  },
});
export const get = authorizedQuery("procurementStatus:get", query)({
  args: { societyId: v.id("societies") },
  returns: v.object({
    state: v.union(v.literal("unconfigured"), v.literal("empty"), v.literal("ready"), v.literal("available"), v.literal("importing"), v.literal("stalled"), v.literal("failed")),
    lastSuccessful: v.union(v.null(), v.object({ generation: v.string(), publishedAt: v.string(), collectedAt: nullableText, activatedAt: v.union(v.number(), v.null()), counts: v.record(v.string(), v.number()) })),
    source: v.union(v.null(), v.object({ generation: v.string(), publishedAt: v.string(), collectedAt: nullableText, complete: v.boolean(), phase: v.string(), error: nullableText, heartbeatAt:v.union(v.number(),v.null()) })),
    run: v.union(v.null(), v.object({ id: v.string(), planHash: nullableText, baseHash: nullableText, targetHash: v.string(), applied: v.number(), operations: v.number(), nextBatch: v.number(), startedAt: v.number(), heartbeatAt: v.number(), error: nullableText })),
    recovery: nullableText,
  }),
  handler: async (ctx, { societyId }) => {
    if (!deploymentCapabilities(process.env).procurementReview) throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
    const society = await requireEnabledModule(ctx, societyId, "procurementReview");
    const folder = society.integrationSettings?.procurementReviewFolder;
    const empty = { lastSuccessful: null, source: null, run: null, recovery: null };
    if (!folder) return { state: "unconfigured" as const, ...empty };
    validateWorkspaceProcurementReviewFolder(societyId, folder);
    const catalog = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
    const active = catalog?.folder === folder ? catalog : null;
    const latestJob = await ctx.db.query("procurementImportJobs").withIndex("by_society_folder", q => q.eq("societyId", societyId).eq("folder",folder)).order("desc").first();
    const job = latestJob?.folder === folder ? latestJob : null;
    const latestSource=await ctx.db.query("procurementSourcePublications").withIndex("by_latest",q=>q.eq("societyId",societyId).eq("folder",folder)).order("desc").first();
    const announced=latestSource&&(!active||!Number.isFinite(Date.parse(active.publishedAt))||latestSource.publishedAtMs>=Date.parse(active.publishedAt))?latestSource:null;
    const run = active?.syncRunId ? await ctx.db.get(active.syncRunId) : null;
    const pending = !!run || (!!job && job.phase !== "ready");
    const heartbeatAt = run?.heartbeatAt ?? run?.changedAt ?? job?.heartbeatAt ?? 0;
    const error = run?.error ?? job?.error ?? null;
    const sourceServing=announced&&active&&!active.syncRunId&&active.generation===announced.generation;
    const available=announced&&!sourceServing&&announced.state!=="ready";
    const state = pending ? error ? "failed" as const : Date.now() - heartbeatAt > 5 * 60_000 ? "stalled" as const : "importing" as const : available ? announced.state==="failed"?"failed" as const:"available" as const : active ? "ready" as const : "empty" as const;
    return {
      state,
      lastSuccessful: active ? { generation: active.generation, publishedAt: active.publishedAt, collectedAt: active.collectedAt ?? null, activatedAt: active.activatedAt ?? null, counts: active.counts } : null,
      source: announced ? {generation:announced.generation,publishedAt:announced.publishedAt,collectedAt:announced.collectedAt??null,complete:announced.complete,phase:sourceServing?"ready":announced.phase,error:sourceServing?null:announced.error??null,heartbeatAt:announced.heartbeatAt} : job ? { generation: job.generation, publishedAt: job.publishedAt, collectedAt: job.collectedAt ?? null, complete: job.complete,phase:job.phase,error:job.error??null,heartbeatAt:job.heartbeatAt } : run ? { generation: run.targetGeneration ?? run.targetHash, publishedAt: run.publishedAt ?? "", collectedAt: run.collectedAt ?? null, complete: run.allowArchives ?? false,phase:"importing",error:run.error??null,heartbeatAt } : active ? { generation: active.generation, publishedAt: active.publishedAt, collectedAt: active.collectedAt ?? null, complete: active.coverage?.complete ?? false,phase:"ready",error:null,heartbeatAt:active.activatedAt??null } : null,
      run: run ? { id: run._id, planHash: run.planHash, baseHash: run.baseHash, targetHash: run.targetHash, applied: run.applied, operations: run.operations, nextBatch: run.nextBatch, startedAt: run.startedAt ?? run.changedAt, heartbeatAt, error } : pending && job ? { id: job._id, planHash: job.planHash ?? null, baseHash: null, targetHash: job.contentHash, applied: 0, operations: 0, nextBatch: 0, startedAt: job.startedAt, heartbeatAt, error } : null,
      recovery: pending ? run ? "Resume the exact verified export and its successful baseline with apply-convex.ts --input EXPORT --baseline BASELINE. The partially applied catalog remains paused until validation and activation finish." : "Retry the same verified export. If bulk import has already written rows, use --activate-only to verify and activate; never append the same generation twice." : available ? "A source publication is available in SharePoint. Retry its verified export and import workflow; the last completed catalog remains readable." : null,
    };
  },
});
