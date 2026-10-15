import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, isActiveMembership } from "./access";
import { hasPermission, requirePermissionPortable, type Permission } from "./permissions";
import { requireDocumentAccess } from "./documents";
import { getPathway, resolvePathway } from "../pathways/registry";
import { activePipelineApprovals, canonicalPipelineJson, evaluatePipeline, pipelineAncestors, pipelineSha256, validatePipelineGraph, validatePipelineInputs, type PipelineGraph, type PipelineInputs, type PipelineNode, type PipelineStep } from "../pathways/pipeline";
import { effectivePathwayInputs, pathwayWorkspaceDefaults, readPathwayInputSources, type PathwayInputSource, type PathwayWorkspaceFacts } from "../pathways/workspaceDefaults";
import { organizationEntityType } from "../organizationDomain";
import { readOnboardingAnswersJson } from "../onboarding";

type Run = PortableDoc & {
  societyId: string; pathwayKey: string; pathwayVersion: string; pathwayTitle: string; graph: PipelineGraph; inputs: PipelineInputs; inputsFrozen: boolean; createdByUserId: string; status: string;
  inputSourcesJson?: string;
  /** Derived on load: what the user saved in an open run, and where each effective input came from. */
  savedInputs?: PipelineInputs; inputSources?: Record<string, PathwayInputSource>;
};
type Step = PortableDoc & PipelineStep;
const now = () => new Date().toISOString();

/** Roles that may record a preparation review. */
const REVIEWER_ROLES = ["Owner", "Admin", "Director"];
/** The statement a solo reviewer confirms; stored verbatim on the step and in the run history. */
export const SELF_REVIEW_CONFIRMATION = "No one else can review this; I've checked it myself";

async function canRead(ctx: PortableQueryCtx, societyId: string, permission: Permission) {
  try { await requirePermissionPortable(ctx, societyId, permission); return true; }
  catch (error) {
    if (error instanceof Error && /^(?:Permission|Service scope) [a-zA-Z]+:read required\.$/.test(error.message)) return false;
    throw error;
  }
}

/**
 * Workspace facts a pathway can use as input defaults, read only from this
 * workspace's rows and only from registers the viewer may read.
 */
async function workspaceFacts(ctx: PortableQueryCtx, societyId: string): Promise<PathwayWorkspaceFacts> {
  const society = await ctx.db.get(societyId, "societies");
  const isSociety = organizationEntityType(society).includes("society");
  if (!society) return { society: isSociety };
  const [profile, directors, controllers, records] = await Promise.all((["society:read", "directors:read", "settings:read", "documents:read"] as Permission[]).map((permission) => canRead(ctx, societyId, permission)));
  const own = (rows: Record<string, any>[]): any[] => rows.filter((row) => String(row.societyId) === String(societyId));
  const bySociety = async (table: string) => own(await ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect());
  const roles = async (roleType: string) => own(await ctx.db.query("roleHolders").withIndex("by_society_role", (q) => q.eq("societyId", societyId).eq("roleType", roleType)).collect());
  let setupClassDetails: string | undefined;
  try { setupClassDetails = readOnboardingAnswersJson(society.onboardingAnswersJson)?.classDetails; } catch { setupClassDetails = undefined; }
  return {
    society: isSociety,
    ...(profile ? {
      profile: { name: society.name, numbered: society.numbered, registeredOfficeAddress: society.registeredOfficeAddress, purposes: society.purposes },
      addresses: await bySociety("organizationAddresses"),
      setupClassDetails,
    } : {}),
    ...(records ? { recordsLocations: await bySociety("recordsLocation"), rightsClasses: await bySociety("rightsClasses") } : {}),
    ...(directors ? isSociety
      ? { societyDirectors: own(await ctx.db.query("directors").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "Active")).collect()) }
      : { roleHolders: await roles("director") } : {}),
    ...(controllers && !isSociety ? { controllers: await roles("controller") } : {}),
  };
}

/** An open run uses what the user saved, else the workspace default; a frozen run uses its snapshot. */
async function withEffectiveInputs(ctx: PortableQueryCtx, run: Run, facts?: PathwayWorkspaceFacts) {
  if (run.inputsFrozen) { run.inputSources = readPathwayInputSources(run.inputSourcesJson); return run; }
  run.savedInputs = run.inputs;
  const { inputs, sources } = effectivePathwayInputs(run.graph, run.inputs, pathwayWorkspaceDefaults(run.graph, facts ?? await workspaceFacts(ctx, run.societyId)));
  run.inputs = validatePipelineInputs(run.graph, inputs);
  run.inputSources = sources;
  return run;
}

/** The first recorded transition copies the effective inputs, with their sources, into the run. */
async function freezeInputs(ctx: PortableMutationCtx, run: Run, actorId: string) {
  if (run.inputsFrozen) return;
  const sources = run.inputSources ?? {};
  await ctx.db.patch(run._id, { inputs: run.inputs, inputsFrozen: true, inputSourcesJson: canonicalPipelineJson(sources) });
  const fromWorkspace = Object.fromEntries(Object.entries(sources).flatMap(([key, source]) => source.kind === "workspace" ? [[key, source.label]] : []));
  if (Object.keys(fromWorkspace).length) await audit(ctx, run, actorId, "inputs.frozen", { inputsSha256: await pipelineSha256(canonicalPipelineJson(run.inputs)), fromWorkspace });
  run.inputsFrozen = true;
}

/** Whether a membership could record this review: active, a reviewer role, the permission, and a live identity. */
async function eligibleReviewer(ctx: PortableQueryCtx, societyId: string, user: Record<string, any> | null | undefined, permission: Permission) {
  if (!user || String(user.societyId) !== String(societyId) || !isActiveMembership(user) || !REVIEWER_ROLES.includes(String(user.role)) || !hasPermission(String(user.role), permission)) return false;
  if (user.externalIdentityId) {
    const identity = await ctx.db.get(user.externalIdentityId, "externalIdentities");
    if (!identity || identity.status !== "Active") return false;
  }
  return true;
}

/** Other members of the run's workspace who could record the review instead of `userId`. */
async function otherEligibleReviewers(ctx: PortableQueryCtx, societyId: string, userId: string, permission: Permission) {
  const users = await ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  let count = 0;
  for (const user of users) if (String(user._id) !== String(userId) && await eligibleReviewer(ctx, societyId, user, permission)) count += 1;
  return count;
}

/**
 * Four-eyes by default. The person who started the run may review it only
 * when no one else in the workspace could, and (to approve) only after
 * confirming the self-review statement. Checked again at every review.
 */
async function requireReviewSeparation(ctx: PortableQueryCtx, run: Run, node: PipelineNode, actor: Record<string, any>, confirmSelfReview: boolean | undefined) {
  if (node.approval?.distinctInitiator === false || actor._id !== run.createdByUserId) return false;
  if (await otherEligibleReviewers(ctx, run.societyId, actor._id, node.approval?.permission ?? "documents:write") > 0) throw new Error("An independent reviewer must review this preparation; the initiator cannot self-approve while someone else in the workspace can review it.");
  if (confirmSelfReview !== true) throw new Error(`No one else in this workspace can review this preparation. To review it yourself, confirm: ${SELF_REVIEW_CONFIRMATION}.`);
  return true;
}

async function audit(ctx: PortableMutationCtx, run: Run, actorId: string, event: string, detail: unknown, nodeKey?: string) {
  await ctx.db.insert("pathwayAudit", { societyId: run.societyId, runId: run._id, event, ...(nodeKey ? { nodeKey } : {}), actorUserId: actorId, atISO: now(), detailJson: canonicalPipelineJson(detail) });
}

async function rowsForRun(ctx: PortableQueryCtx, run: Run) {
  const rows = await ctx.db.query<Step>("pathwaySteps").withIndex("by_run", q => q.eq("runId", run._id)).collect();
  if (rows.length !== run.graph.nodes.length || new Set(rows.map(row => row.nodeKey)).size !== rows.length || rows.some(row => row.societyId !== run.societyId || !run.graph.nodes.some(node => node.key === row.nodeKey))) throw new Error("Pipeline step snapshot is invalid.");
  return rows;
}

async function actorStillAuthorized(ctx: PortableQueryCtx, societyId: string, actorId: string, permission: Permission) {
  const actor = await ctx.db.get(actorId, "users");
  if (!actor || actor.societyId !== societyId || !isActiveMembership(actor) || !hasPermission(String(actor.role), permission)) throw new Error("Pipeline actor authority has been revoked.");
  if (actor.externalIdentityId) {
    const identity = await ctx.db.get(actor.externalIdentityId, "externalIdentities");
    if (!identity || identity.status !== "Active") throw new Error("Pipeline actor authority has been revoked.");
  }
  return actor;
}

async function loadRun(ctx: PortableQueryCtx, runId: string, permission: Permission = "tasks:write", facts?: PathwayWorkspaceFacts) {
  const candidate = await ctx.db.get<Run>(runId, "pathwayRuns");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("Pipeline run not found.");
  const actor = await requirePermissionPortable(ctx, candidate.societyId, permission);
  const run = await getOwned<Run>(ctx, "pathwayRuns", runId, candidate.societyId);
  if (run.status === "imported_readonly") throw new Error("Imported pipeline history is read-only. Start a new reviewed run.");
  run.graph = validatePipelineGraph(run.graph);
  run.inputs = validatePipelineInputs(run.graph, run.inputs);
  const society = await ctx.db.get(run.societyId, "societies");
  const selected = resolvePathway(society);
  if (!selected.allowed || selected.pathway?.key !== run.pathwayKey || getPathway(run.pathwayKey)?.version !== run.pathwayVersion || canonicalPipelineJson(run.graph) !== canonicalPipelineJson(getPathway(run.pathwayKey)?.pipeline)) throw new Error("The registered pathway or organization classification changed. Start a reviewed current run.");
  await actorStillAuthorized(ctx, run.societyId, run.createdByUserId, "tasks:write");
  await withEffectiveInputs(ctx, run, facts);
  return { run, actor, steps: await rowsForRun(ctx, run) };
}

async function evidenceSnapshot(ctx: PortableQueryCtx, run: Run, documentId: string) {
  const document = await requireDocumentAccess(ctx, documentId);
  if (document.societyId !== run.societyId || document.flaggedForDeletion || document.archivedAtISO) throw new Error("Evidence document is unavailable in this workspace.");
  const versions = await ctx.db.query("documentVersions").withIndex("by_document", q => q.eq("documentId", documentId)).collect();
  const version = versions.filter(row => row.societyId === run.societyId && row.isCurrent).sort((a, b) => b.version - a.version)[0];
  const snapshot = {
    documentId, ...(version ? { versionId: version._id, version: version.version, sha256: version.sha256 ?? null, storageProvider: version.storageProvider, storageKey: version.storageKey } : {}),
    contentSha256: await pipelineSha256(canonicalPipelineJson({ title: document.title, content: document.content ?? null, category: document.category, versionId: version?._id ?? null })),
  };
  return { document, version, snapshot, json: canonicalPipelineJson(snapshot) };
}

async function requireUploadedEvidence(ctx: PortableQueryCtx, run: Run, evidence: Awaited<ReturnType<typeof evidenceSnapshot>>) {
  const { document, version } = evidence;
  const generated = await ctx.db.query("generatedLegalDocuments").withIndex("by_society", q => q.eq("societyId", run.societyId)).collect();
  if (!version || !/^[a-f0-9]{64}$/i.test(version.sha256 ?? "") || !["convex", "local", "rustfs", "local-filesystem", "onedrive", "sharepoint", "s3", "r2"].includes(version.storageProvider) || !version.storageKey || version.storageKey.startsWith("demo:") || generated.some(row => row.draftDocumentId === document._id) || /editable draft/i.test(document.title ?? "") || document.category === "WorkflowGenerated") throw new Error("Attach actual uploaded official evidence with a verified checksum; generated drafts cannot serve as official evidence.");
  const handles = await ctx.db.query("documentUploadHandles").withIndex("by_document", q => q.eq("documentId", document._id)).collect();
  const verified = handles.some(handle => handle.societyId === run.societyId && handle.status === "consumed" && handle.provider === version.storageProvider && handle.storageKey === version.storageKey && handle.sha256 === version.sha256);
  if (!verified && !(ctx.principal.assurance === "trusted-workspace" && version.storageProvider === "local-filesystem")) throw new Error("The official evidence upload has no verified byte-ownership record.");
}

async function checkEvidence(ctx: PortableQueryCtx, run: Run, steps: Step[]) {
  for (const step of steps) if (step.documentId) {
    const current = await evidenceSnapshot(ctx, run, step.documentId);
    if (current.json !== step.documentSnapshotJson) throw new Error("Evidence changed after review. Start a new run with the revised document version.");
  }
}

function nodeAndState(run: Run, steps: Step[], nodeKey: string) {
  const node = run.graph.nodes.find(entry => entry.key === nodeKey);
  const step = steps.find(entry => entry.nodeKey === nodeKey);
  if (!node || !step) throw new Error("Pipeline node not found.");
  const derived = evaluatePipeline(run.graph, run.inputs, steps).find(entry => entry.key === nodeKey)!;
  return { node, step, derived };
}

function assertReady(run: Run, steps: Step[], nodeKey: string) {
  const selected = nodeAndState(run, steps, nodeKey);
  if (selected.derived.state !== "ready") throw new Error(selected.derived.blockedReason ?? `Pipeline step is ${selected.derived.state}.`);
  validatePipelineInputs(run.graph, run.inputs, true);
  return selected;
}

function payloadForSubmission(run: Run, steps: Step[], nodeKey: string) {
  const ancestors = pipelineAncestors(run.graph, nodeKey);
  return canonicalPipelineJson({
    pathwayKey: run.pathwayKey, pathwayVersion: run.pathwayVersion, graph: run.graph, inputs: run.inputs,
    evidence: ancestors.filter(node => ["manual", "document"].includes(node.kind)).map(node => {
      const step = steps.find(entry => entry.nodeKey === node.key)!;
      return { nodeKey: node.key, ...(step.documentSnapshotJson ? { document: JSON.parse(step.documentSnapshotJson) } : {}), ...(step.notes ? { notes: step.notes } : {}), ...(step.completedByUserId ? { recordedByUserId: step.completedByUserId } : {}) };
    }),
  });
}

export async function requireCurrentSubmissionApproval(ctx: PortableQueryCtx, run: Run, steps: Step[], submissionKey: string, digest: string) {
  const approvals = activePipelineApprovals(run.graph, run.inputs, steps, submissionKey);
  if (!approvals.length) throw new Error("Submission requires an independent preparation approval.");
  for (const node of approvals) {
    const step = steps.find(entry => entry.nodeKey === node.key)!;
    if (step.state !== "approved" || !step.approvedByUserId) throw new Error("Submission requires current preparation approval.");
    const approver = await actorStillAuthorized(ctx, run.societyId, step.approvedByUserId, node.approval?.permission ?? "documents:write");
    const recordedSelfReview = step.selfReviewedByUserId === step.approvedByUserId && step.selfReviewConfirmation === SELF_REVIEW_CONFIRMATION;
    if (!REVIEWER_ROLES.includes(String(approver.role)) || (node.approval?.distinctInitiator !== false && step.approvedByUserId === run.createdByUserId && !recordedSelfReview)) throw new Error("Submission approval authority is invalid.");
    const approved = JSON.parse(step.approvedPayloadsJson ?? "{}");
    if (approved[submissionKey] !== digest) throw new Error("The submitted payload differs from the approved snapshot.");
  }
}

async function refreshStatus(ctx: PortableMutationCtx, run: Run) {
  const states = evaluatePipeline(run.graph, run.inputs, await rowsForRun(ctx, run));
  const status = states.some(node => node.state === "rejected") ? "rejected"
    : states.every(node => ["completed", "approved", "submitted", "skipped"].includes(node.state)) ? "completed"
    : states.some(node => node.state === "manual_required") ? "manual_required"
    : states.some(node => node.state === "queued") ? "awaiting_submission"
    : states.some(node => node.kind === "approval" && node.state === "ready") ? "awaiting_approval" : "running";
  await ctx.db.patch(run._id, { status, updatedAtISO: now() });
}

export async function startPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  const actor = await requirePermissionPortable(ctx, societyId, "tasks:write");
  const society = await ctx.db.get(societyId, "societies");
  const resolved = resolvePathway(society);
  if (!resolved.allowed || !resolved.pathway?.pipeline) throw new Error(resolved.message);
  const graph = validatePipelineGraph(resolved.pathway.pipeline);
  const atISO = now();
  const runId = await ctx.db.insert("pathwayRuns", { societyId, pathwayKey: resolved.pathway.key, pathwayVersion: resolved.pathway.version, pathwayTitle: resolved.pathway.title, graph, inputs: {}, inputsFrozen: false, createdByUserId: actor._id, status: "running", createdAtISO: atISO, updatedAtISO: atISO });
  for (const node of graph.nodes) await ctx.db.insert("pathwaySteps", { societyId, runId, nodeKey: node.key, state: "pending", updatedAtISO: atISO });
  const run = await ctx.db.get<Run>(runId, "pathwayRuns");
  await audit(ctx, run!, actor._id, "run.started", { pathwayKey: resolved.pathway.key, pathwayVersion: resolved.pathway.version });
  return runId;
}

export async function saveInputPortable(ctx: PortableMutationCtx, { runId, inputs }: { runId: string; inputs: unknown }) {
  const { run, actor } = await loadRun(ctx, runId);
  if (run.inputsFrozen) throw new Error("Pipeline inputs are frozen after the first recorded transition. Start a new run to revise them.");
  const parsed = validatePipelineInputs(run.graph, inputs);
  await ctx.db.patch(runId, { inputs: parsed, updatedAtISO: now() });
  await audit(ctx, run, actor._id, "inputs.saved", { inputsSha256: await pipelineSha256(canonicalPipelineJson(parsed)) });
  return null;
}

export async function completeStepPortable(ctx: PortableMutationCtx, { runId, nodeKey, documentId, notes }: { runId: string; nodeKey: string; documentId?: string; notes?: string }) {
  const { run, actor, steps } = await loadRun(ctx, runId);
  await checkEvidence(ctx, run, steps);
  const { node, step } = assertReady(run, steps, nodeKey);
  if (!["manual", "document"].includes(node.kind)) throw new Error("Approval and submission steps have separate authorized transitions.");
  if ((node.kind === "document" || node.requiresEvidence) && !documentId) throw new Error("Attach an owned preparation evidence document before completing this step.");
  const evidence = documentId ? await evidenceSnapshot(ctx, run, documentId) : undefined;
  if (node.requiresUploadedEvidence) {
    if (!evidence) throw new Error("Actual uploaded official evidence is required.");
    await requireUploadedEvidence(ctx, run, evidence);
  }
  const cleanedNotes = notes?.trim();
  if (cleanedNotes && cleanedNotes.length > 10000) throw new Error("Evidence notes are too long.");
  await ctx.db.patch(step._id, { state: "completed", ...(cleanedNotes ? { notes: cleanedNotes } : {}), ...(evidence ? { documentId, documentSnapshotJson: evidence.json, ...(evidence.version ? { documentVersionId: evidence.version._id } : {}) } : {}), completedByUserId: actor._id, updatedAtISO: now() });
  await freezeInputs(ctx, run, actor._id);
  await audit(ctx, run, actor._id, "step.evidence-recorded", { documentId: documentId ?? null, notes: cleanedNotes ?? null }, nodeKey);
  await refreshStatus(ctx, run); return null;
}

export async function approvePortable(ctx: PortableMutationCtx, args: { runId: string; nodeKey: string; notes?: string; confirmSelfReview?: boolean }) {
  const { run, actor, steps } = await loadRun(ctx, args.runId, "documents:write");
  if (ctx.principal.kind !== "user") throw new Error("A human reviewer must record the preparation approval.");
  await checkEvidence(ctx, run, steps);
  const { node, step } = assertReady(run, steps, args.nodeKey);
  if (node.kind !== "approval") throw new Error("This step is not an approval gate.");
  await requirePermissionPortable(ctx, run.societyId, node.approval?.permission ?? "documents:write");
  if (!REVIEWER_ROLES.includes(String(actor.role))) throw new Error("A current authorized preparation reviewer is required.");
  const selfReview = await requireReviewSeparation(ctx, run, node, actor, args.confirmSelfReview);
  // Freeze first: the approved digest covers the inputs the run keeps.
  await freezeInputs(ctx, run, actor._id);
  const hashes: Record<string, string> = {};
  for (const submission of run.graph.nodes.filter(entry => entry.kind === "submission" && pipelineAncestors(run.graph, entry.key).some(ancestor => ancestor.key === node.key))) hashes[submission.key] = await pipelineSha256(payloadForSubmission(run, steps, submission.key));
  const atISO = now();
  const selfRecord = selfReview ? { selfReviewedByUserId: actor._id, selfReviewedAtISO: atISO, selfReviewConfirmation: SELF_REVIEW_CONFIRMATION } : {};
  await ctx.db.patch(step._id, { state: "approved", approvedByUserId: actor._id, approvedPayloadsJson: canonicalPipelineJson(hashes), ...selfRecord, ...(args.notes?.trim() ? { notes: args.notes.trim().slice(0, 10000) } : {}), updatedAtISO: atISO });
  await audit(ctx, run, actor._id, selfReview ? "review.self-approved" : "review.approved", { payloadHashes: hashes, notes: args.notes ?? null, ...(selfReview ? { selfReview: { byUserId: actor._id, atISO, confirmation: SELF_REVIEW_CONFIRMATION, otherEligibleReviewers: 0 } } : {}) }, node.key);
  await refreshStatus(ctx, run); return null;
}

export async function rejectPortable(ctx: PortableMutationCtx, args: { runId: string; nodeKey: string; notes?: string }) {
  const { run, actor, steps } = await loadRun(ctx, args.runId, "documents:write");
  if (ctx.principal.kind !== "user") throw new Error("A human reviewer must record the preparation review.");
  await checkEvidence(ctx, run, steps);
  const { node, step } = assertReady(run, steps, args.nodeKey);
  if (node.kind !== "approval") throw new Error("This step is not an approval gate.");
  await requirePermissionPortable(ctx, run.societyId, node.approval?.permission ?? "documents:write");
  if (!args.notes?.trim()) throw new Error("Record the reason for rejecting preparation.");
  if (!REVIEWER_ROLES.includes(String(actor.role))) throw new Error("An independent authorized reviewer is required.");
  // Sending your own preparation back needs no confirmation, but still only when no one else could review it.
  const selfReview = await requireReviewSeparation(ctx, run, node, actor, true);
  const atISO = now();
  await ctx.db.patch(step._id, { state: "rejected", approvedByUserId: actor._id, notes: args.notes.trim().slice(0, 10000), ...(selfReview ? { selfReviewedByUserId: actor._id, selfReviewedAtISO: atISO } : {}), updatedAtISO: atISO });
  await freezeInputs(ctx, run, actor._id);
  await audit(ctx, run, actor._id, selfReview ? "review.self-rejected" : "review.rejected", { notes: args.notes }, node.key);
  await refreshStatus(ctx, run); return null;
}

export async function requestSubmissionPortable(ctx: PortableMutationCtx, { runId, nodeKey }: { runId: string; nodeKey: string }) {
  const { run, actor, steps } = await loadRun(ctx, runId);
  await requirePermissionPortable(ctx, run.societyId, "filings:submit");
  await checkEvidence(ctx, run, steps);
  const { node, step, derived } = nodeAndState(run, steps, nodeKey);
  if (!["ready", "queued", "manual_required"].includes(derived.state)) throw new Error(derived.blockedReason ?? "Submission is not ready.");
  validatePipelineInputs(run.graph, run.inputs, true);
  if (node.kind !== "submission" || !node.submission) throw new Error("This step has no registered submission adapter.");
  const payloadJson = payloadForSubmission(run, steps, nodeKey);
  const approvedSha256 = await pipelineSha256(payloadJson);
  await requireCurrentSubmissionApproval(ctx, run, steps, nodeKey, approvedSha256);
  const idempotencyKey = `${runId}:${nodeKey}:${approvedSha256}`;
  const existing = await ctx.db.query("pathwaySubmissionOutbox").withIndex("by_idempotency", q => q.eq("idempotencyKey", idempotencyKey)).first();
  if (existing) { await authorizeSubmissionPortable(ctx, existing); return existing._id; }
  if (derived.state !== "ready") throw new Error("Submission ledger is invalid.");
  const manual = node.submission.adapterId === "official-portal";
  const documentIds = pipelineAncestors(run.graph, nodeKey).map(ancestor => steps.find(entry => entry.nodeKey === ancestor.key)?.documentId).filter((id): id is string => Boolean(id));
  const atISO = now();
  const submissionId = await ctx.db.insert("pathwaySubmissionOutbox", { societyId: run.societyId, runId, stepKey: nodeKey, adapterId: node.submission.adapterId, payloadJson, approvedSha256, idempotencyKey, actorId: actor._id, documentIds: [...new Set(documentIds)], status: manual ? "manual_required" : "queued", ...(node.submission.officialUrl ? { officialUrl: node.submission.officialUrl } : {}), createdAtISO: atISO, updatedAtISO: atISO });
  await ctx.db.patch(step._id, { state: manual ? "manual_required" : "queued", updatedAtISO: atISO });
  await freezeInputs(ctx, run, actor._id);
  await audit(ctx, run, actor._id, manual ? "submission.manual-handoff" : "submission.queued", { submissionId, approvedSha256, adapterId: node.submission.adapterId }, nodeKey);
  await refreshStatus(ctx, run); return submissionId;
}

export async function recordManualReceiptPortable(ctx: PortableMutationCtx, { runId, nodeKey, documentId, reference, notes }: { runId: string; nodeKey: string; documentId: string; reference: string; notes?: string }) {
  const { run, actor, steps } = await loadRun(ctx, runId);
  await requirePermissionPortable(ctx, run.societyId, "filings:submit");
  if (ctx.principal.kind !== "user") throw new Error("A human must attest to an external manual filing receipt.");
  await checkEvidence(ctx, run, steps);
  const { node, step } = nodeAndState(run, steps, nodeKey);
  if (node.kind !== "submission" || node.submission?.adapterId !== "official-portal" || step.state !== "manual_required") throw new Error("This run has no open manual filing handoff.");
  if (!reference.trim() || reference.length > 500) throw new Error("An official receipt or confirmation reference is required.");
  const outbox = (await ctx.db.query("pathwaySubmissionOutbox").withIndex("by_run", q => q.eq("runId", runId)).collect()).find(row => row.stepKey === nodeKey);
  if (!outbox || outbox.status !== "manual_required") throw new Error("Manual submission is not awaiting a receipt.");
  await authorizeSubmissionPortable(ctx, outbox);
  const receipt = await evidenceSnapshot(ctx, run, documentId);
  await requireUploadedEvidence(ctx, run, receipt);
  if ((notes?.length ?? 0) > 10000) throw new Error("Receipt notes are too long.");
  const receiptJson = canonicalPipelineJson({ kind: "human-attestation", document: receipt.snapshot, reference: reference.trim(), notes: notes?.trim() ?? null, attestedByUserId: actor._id, attestedAtISO: now() });
  await ctx.db.patch(outbox._id, { status: "attested", receiptJson, updatedAtISO: now() });
  await ctx.db.patch(step._id, { state: "submitted", documentId, documentVersionId: receipt.version._id, documentSnapshotJson: receipt.json, notes: `Manual registry receipt: ${reference.trim()}`, completedByUserId: actor._id, updatedAtISO: now() });
  await audit(ctx, run, actor._id, "submission.manual-receipt-attested", { submissionId: outbox._id, reference: reference.trim(), documentId }, nodeKey);
  await refreshStatus(ctx, run); return null;
}

export async function statusPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const actor = await requirePermissionPortable(ctx, societyId, "tasks:read");
  const society = await ctx.db.get(societyId, "societies");
  const resolved = resolvePathway(society);
  const runs = await ctx.db.query<Run>("pathwayRuns").withIndex("by_society", q => q.eq("societyId", societyId)).order("desc").take(30);
  const snapshots: any[] = [];
  let facts: PathwayWorkspaceFacts | undefined;
  const loadFacts = async () => (facts ??= await workspaceFacts(ctx, societyId));
  const reviewerCounts = new Map<string, Promise<number>>();
  const othersThan = (userId: string, permission: Permission) => {
    const key = `${userId}:${permission}`;
    if (!reviewerCounts.has(key)) reviewerCounts.set(key, otherEligibleReviewers(ctx, societyId, userId, permission));
    return reviewerCounts.get(key)!;
  };
  const memberName = async (userId: string) => {
    if (userId === actor._id) return "You";
    const user = await ctx.db.get(userId, "users");
    return user && String(user.societyId) === String(societyId) ? String(user.displayName ?? "").trim() || "A workspace member" : "A former member";
  };
  for (const run of runs) {
    let inaccessible = false, authorityError: string | undefined;
    run.graph = validatePipelineGraph(run.graph); run.inputs = validatePipelineInputs(run.graph, run.inputs);
    const steps = await rowsForRun(ctx, run);
    try { await checkEvidence(ctx, run, steps); } catch (error) { inaccessible = true; authorityError = (error as Error).message; }
    if (inaccessible) { snapshots.push({ _id: run._id, pathwayKey: run.pathwayKey, pathwayVersion: run.pathwayVersion, pathwayTitle: run.pathwayTitle, status: "restricted", nodes: [], inputs: {}, inputsFrozen: true, graph: { version: 1, inputFields: [], nodes: [] }, message: authorityError }); continue; }
    try { await loadRun(ctx, run._id, "tasks:read", run.inputsFrozen ? undefined : await loadFacts()); } catch (error) { authorityError = (error as Error).message; }
    await withEffectiveInputs(ctx, run, run.inputsFrozen ? undefined : await loadFacts());
    const workspaceDefaults = run.inputsFrozen ? undefined : pathwayWorkspaceDefaults(run.graph, await loadFacts());
    const submissions = await ctx.db.query("pathwaySubmissionOutbox").withIndex("by_run", q => q.eq("runId", run._id)).collect();
    const derived = evaluatePipeline(run.graph, run.inputs, steps);
    const nodes: any[] = [];
    for (const node of derived) {
      const step = steps.find(entry => entry.nodeKey === node.key)!;
      const reviewPermission = node.approval?.permission ?? "documents:write";
      const reviewerRole = ctx.principal.kind === "user" && REVIEWER_ROLES.includes(String(actor.role)) && hasPermission(String(actor.role), reviewPermission);
      const fourEyes = node.kind === "approval" && node.approval?.distinctInitiator !== false;
      const eligibleReviewer = !authorityError && reviewerRole && (!fourEyes || actor._id !== run.createdByUserId);
      // Solo workspaces: the initiator may review only when no one else could (re-checked by approve).
      const independentReviewers = fourEyes ? await othersThan(run.createdByUserId, reviewPermission) : undefined;
      const canSelfReview = !authorityError && reviewerRole && fourEyes && node.state === "ready" && actor._id === run.createdByUserId && independentReviewers === 0;
      let selfReview: Record<string, unknown> | undefined;
      if (step.selfReviewedByUserId) {
        const laterReviewers = await othersThan(String(step.selfReviewedByUserId), reviewPermission);
        selfReview = {
          byUserId: step.selfReviewedByUserId, byName: await memberName(String(step.selfReviewedByUserId)), atISO: step.selfReviewedAtISO,
          ...(step.selfReviewConfirmation ? { confirmation: step.selfReviewConfirmation } : {}),
          // A reviewer who joined later is a gentle suggestion, never a block.
          secondReviewerAvailable: laterReviewers > 0,
        };
      }
      let approvalError: string | undefined;
      if (node.kind === "submission" && node.state === "ready") try { await requireCurrentSubmissionApproval(ctx, run, steps, node.key, await pipelineSha256(payloadForSubmission(run, steps, node.key))); } catch (error) { approvalError = (error as Error).message; }
      nodes.push({ ...node, ...(step.notes ? { notes: step.notes } : {}), ...(step.documentId ? { documentId: step.documentId } : {}), ...(step.completedByUserId ? { completedByUserId: step.completedByUserId } : {}), ...(step.approvedByUserId ? { approvedByUserId: step.approvedByUserId } : {}), ...(selfReview ? { selfReview } : {}), ...(independentReviewers !== undefined ? { independentReviewerAvailable: independentReviewers > 0 } : {}), blockedReason: authorityError ?? approvalError ?? node.blockedReason, canComplete: !authorityError && node.state === "ready" && ["manual", "document"].includes(node.kind) && hasPermission(String(actor.role), "tasks:write"), canApprove: node.state === "ready" && node.kind === "approval" && eligibleReviewer, canSelfReview, canReject: node.state === "ready" && node.kind === "approval" && (eligibleReviewer || canSelfReview), canSubmit: !authorityError && !approvalError && node.state === "ready" && node.kind === "submission" && hasPermission(String(actor.role), "tasks:write") && hasPermission(String(actor.role), "filings:submit") });
    }
    const auditRows = await ctx.db.query("pathwayAudit").withIndex("by_run", q => q.eq("runId", run._id)).order("desc").take(100);
    const { inputSourcesJson: _storedSources, ...runFields } = run;
    snapshots.push({ ...runFields, ...(workspaceDefaults ? { workspaceDefaults } : {}), nodes, submissions: submissions.map(row => ({ _id: row._id, stepKey: row.stepKey, adapterId: row.adapterId, status: row.status, createdAtISO: row.createdAtISO, officialUrl: row.officialUrl, error: row.error, receipt: row.receiptJson ? JSON.parse(row.receiptJson) : undefined, canRecordReceipt: !authorityError && actor._id === row.actorId && row.status === "manual_required" && ctx.principal.kind === "user" && hasPermission(String(actor.role), "tasks:write") && hasPermission(String(actor.role), "filings:submit") })), audit: auditRows });
  }
  return { ...resolved, runs: snapshots, currentUserId: actor._id, selfReviewConfirmation: SELF_REVIEW_CONFIRMATION, canStart: resolved.allowed && Boolean(resolved.pathway?.pipeline) && hasPermission(String(actor.role), "tasks:write"), canAdvance: hasPermission(String(actor.role), "tasks:write"), canApprove: ctx.principal.kind === "user" && ["Owner", "Admin", "Director"].includes(String(actor.role)) && hasPermission(String(actor.role), "documents:write"), submissionCapabilities: [{ adapterId: "official-portal", available: false, mode: "manual", reason: "Official portal filing requires an authorized human. No automated filing is performed." }] };
}

/** Trusted dispatchers call this at claim time and immediately before sending. */
export async function authorizeSubmissionPortable(ctx: PortableQueryCtx, submission: PortableDoc) {
  const { run, actor, steps } = await loadRun(ctx, submission.runId, "filings:submit");
  if (submission.societyId !== run.societyId || submission.actorId !== actor._id) throw new Error("Submission actor or workspace does not match the run.");
  await requirePermissionPortable(ctx, run.societyId, "tasks:write");
  await actorStillAuthorized(ctx, run.societyId, submission.actorId, "filings:submit");
  await checkEvidence(ctx, run, steps);
  const node = run.graph.nodes.find(entry => entry.key === submission.stepKey);
  if (!node || node.submission?.adapterId !== submission.adapterId) throw new Error("Submission routing differs from the approved graph.");
  const payload = payloadForSubmission(run, steps, submission.stepKey);
  if (payload !== submission.payloadJson || await pipelineSha256(payload) !== submission.approvedSha256) throw new Error("Submission payload differs from the approved snapshot.");
  const documentIds = [...new Set(pipelineAncestors(run.graph, submission.stepKey).map(node => steps.find(step => step.nodeKey === node.key)?.documentId).filter((id): id is string => Boolean(id)))];
  if (canonicalPipelineJson(documentIds) !== canonicalPipelineJson(submission.documentIds) || submission.idempotencyKey !== `${run._id}:${submission.stepKey}:${submission.approvedSha256}`) throw new Error("Submission document scope or idempotency identity differs from the approved snapshot.");
  await requireCurrentSubmissionApproval(ctx, run, steps, submission.stepKey, submission.approvedSha256);
}
