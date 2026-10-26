/**
 * The scheduler's authority is a reviewed, expiring grant, not the workflow's
 * creator and not an invented user session. All supported effects and the tick
 * claim commit in one mutation. No action, external provider or public runner
 * is reachable through this executor.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { PortableMutationCtx } from "../../shared/portable/ctx";
import { makeCapabilities } from "../../shared/portable/capabilities";
import { ensureRenewalTasks } from "../../shared/functions/insurance";
import { hasPermission, requirePermissionPortable } from "../../shared/functions/permissions";
import { requireSocietyMembership } from "../../shared/functions/access";
import { organizationToday } from "../../shared/functions/electionElectorate";
import { assertExternalIdentityActive } from "../../shared/functions/identity";
import { scheduleDefinition, scheduleDefinitionFingerprint } from "../../shared/workflows/scheduleAuthorization";
import { nextScheduledRunAt, scheduledTriggerSupport } from "../../shared/workflows/scheduleTiming";
import { normalizeModuleSettings } from "../../src/lib/modules";
import { RECIPE_STEPS } from "../workflowRecipeData";
import { convexPortableDb, toPortableMutationCtx } from "./portable";

type Workflow = Doc<"workflows">;
type Reader = Pick<QueryCtx, "db">;
type Support = { supported: boolean; reason?: string };
export type ScheduleState = "not_authorized" | "authorized" | "expired" | "revoked" | "configuration_changed" | "paused" | "blocked";
type Authority = { state: ScheduleState; reason?: string; user?: Doc<"users"> };
const RECIPES = new Set(["agm_prep", "insurance_renewal", "annual_report_filing"]);
const MAX_GRANT_MS = 90 * 86_400_000;
const READ_LIMIT = 500;
const emptyObject = (value: unknown) => value === undefined || value === null ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

export function workflowScheduleSupport(workflow: Workflow): Support {
  const trigger = scheduledTriggerSupport(workflow.trigger);
  if (!trigger.supported) return trigger;
  if ((workflow.provider ?? "internal") !== "internal" || !RECIPES.has(workflow.recipe)) {
    return { supported: false, reason: "Automatic execution currently supports the standard internal AGM preparation, insurance renewal and annual report review recipes. External providers and input-driven recipes require a separate reviewed executor." };
  }
  if (!emptyObject(workflow.config) || !emptyObject(workflow.providerConfig)) {
    return { supported: false, reason: "Custom workflow or provider configuration is not supported by the automatic executor. Use the standard internal recipe or run this workflow manually." };
  }
  const expected = RECIPE_STEPS[workflow.recipe as keyof typeof RECIPE_STEPS];
  const nodes = workflow.nodePreview;
  if (nodes?.length && (nodes.length !== expected.length || nodes.some((node, index) =>
    node.key !== expected[index].key || node.type !== (index === 0 ? "manual_trigger" : "external_n8n") || !emptyObject(node.config)))) {
    return { supported: false, reason: "Custom workflow nodes, AI agents and external/email effects require a separate reviewed executor. Automatic runs support only the standard internal recipe steps." };
  }
  try { scheduleDefinition(workflow); }
  catch (error) { return { supported: false, reason: error instanceof Error ? error.message : "The workflow definition cannot be authorized for automatic execution." }; }
  return { supported: true };
}

async function currentAuthorizer(ctx: Reader, workflow: Workflow): Promise<Authority> {
  const grant = workflow.scheduleAuthorization;
  if (!grant) return { state: "not_authorized", reason: "Review and authorize this schedule before automatic execution." };
  const user = await ctx.db.get(grant.authorizerUserId);
  if (!user || user.societyId !== workflow.societyId || user.status !== "Active" ||
      user.authIssuer !== grant.authIssuer || user.authSubject !== grant.authSubject ||
      user.externalIdentityId !== grant.externalIdentityId || !hasPermission(user.role, "tasks:write")) {
    return { state: "blocked", reason: "The authorizer is no longer an active, permitted member with the original identity binding. Review and authorize the schedule again." };
  }
  try { await assertExternalIdentityActive(convexPortableDb(ctx.db), user); }
  catch { return { state: "blocked", reason: "The authorizer's external identity is disabled or changed. Review and authorize the schedule again." }; }
  const society = await ctx.db.get(workflow.societyId);
  const modules = normalizeModuleSettings(society);
  if (!society || society.removedAtISO || !modules.workflows) {
    return { state: "blocked", reason: "Workflow execution is disabled or this workspace is unavailable." };
  }
  if (workflow.recipe === "insurance_renewal" && (!modules.insurance || !hasPermission(user.role, "financials:read"))) {
    return { state: "blocked", reason: "Insurance review is disabled or the authorizer no longer has permission to read insurance records." };
  }
  return { state: "authorized", user };
}

/** Re-read all authority in the same transaction as every scheduled effect. */
export async function scheduledAuthority(ctx: Reader, workflow: Workflow, nowMs: number): Promise<Authority> {
  if (workflow.status !== "active") return { state: "paused", reason: "Activate the workflow, then review and authorize its schedule." };
  const grant = workflow.scheduleAuthorization;
  if (!grant) return { state: "not_authorized", reason: "Review and authorize this schedule before automatic execution." };
  if (grant.revokedAtISO) return {
    state: grant.revokedReason === "configuration_changed" ? "configuration_changed" : "revoked",
    reason: grant.revokedReason === "configuration_changed" ? "The workflow definition changed. Review and authorize the updated schedule." : "Automatic execution was revoked. Review and authorize the schedule to resume.",
  };
  const expires = Date.parse(grant.expiresAtISO);
  if (!Number.isFinite(expires) || expires <= nowMs) return { state: "expired", reason: "This schedule authorization expired. Review and authorize it again." };
  let matchesDefinition = false;
  try { matchesDefinition = await scheduleDefinitionFingerprint(workflow) === grant.definitionFingerprint; }
  catch { /* Invalid or oversized edits cannot retain a previously valid grant. */ }
  if (!matchesDefinition) {
    return { state: "configuration_changed", reason: "The workflow definition changed. Review and authorize the updated schedule." };
  }
  const support = workflowScheduleSupport(workflow);
  if (!support.supported) return { state: "blocked", reason: support.reason };
  if (workflow.scheduleBlockedReason) return { state: "blocked", reason: workflow.scheduleBlockedReason };
  if (workflow.scheduleEnabled !== true) return { state: "revoked", reason: "Automatic execution is disabled. Review and authorize the schedule to resume." };
  return currentAuthorizer(ctx, workflow);
}

export async function workflowScheduleStatus(ctx: Reader, workflow: Workflow) {
  const support = workflowScheduleSupport(workflow);
  const authority = await scheduledAuthority(ctx, workflow, Date.now());
  const grant = workflow.scheduleAuthorization;
  const authorizer = grant ? await ctx.db.get(grant.authorizerUserId) : null;
  return {
    supported: support.supported,
    state: authority.state,
    ...(support.reason || authority.reason ? { reason: support.reason ?? authority.reason } : {}),
    ...(support.supported ? {
      definitionFingerprint: await scheduleDefinitionFingerprint(workflow),
      definition: { name: workflow.name, recipe: workflow.recipe, cron: workflow.trigger.cron! },
    } : {}),
    ...(grant ? {
      authorizerUserId: grant.authorizerUserId,
      ...(authorizer?.societyId === workflow.societyId ? { authorizerName: authorizer.displayName } : {}),
      authorizedAtISO: grant.authorizedAtISO,
      expiresAtISO: grant.expiresAtISO,
    } : {}),
    ...(authority.state === "authorized" && workflow.nextRunAtISO ? { nextRunAtISO: workflow.nextRunAtISO } : {}),
  };
}

export async function authorizeWorkflowSchedule(ctx: MutationCtx, workflow: Workflow, expiresAtISO: string, expectedDefinitionFingerprint: string) {
  const identity = await ctx.auth.getUserIdentity();
  // The trusted API gateway can bridge an actor for scoped machine calls.
  // That bridge may use the same stored user binding, but cannot grant new
  // unattended authority on the person's behalf.
  if (identity && (Object.prototype.hasOwnProperty.call(identity, "societyer_auth_issuer") ||
      Object.prototype.hasOwnProperty.call(identity, "societyer_auth_provider"))) {
    throw new Error("Review and authorize this schedule in a signed-in browser session. API identity bridges cannot authorize automatic runs.");
  }
  const portable = await toPortableMutationCtx(ctx);
  if (portable.principal.kind !== "user" || portable.principal.assurance !== "verified-jwt" || !portable.principal.issuer) {
    throw new Error("A signed-in person must review and authorize an automatic schedule.");
  }
  const user = await requirePermissionPortable(portable, workflow.societyId, "tasks:write");
  if (user.status !== "Active") throw new Error("An active membership is required to authorize a schedule.");
  if (workflow.status !== "active") throw new Error("Activate the workflow before authorizing its schedule.");
  const support = workflowScheduleSupport(workflow);
  if (!support.supported) throw new Error(support.reason);
  const definitionFingerprint = await scheduleDefinitionFingerprint(workflow);
  if (expectedDefinitionFingerprint !== definitionFingerprint) throw new Error("The workflow changed since you reviewed it. Review the current definition and try again.");
  const now = Date.now();
  const expires = Date.parse(expiresAtISO);
  if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_GRANT_MS) {
    throw new Error("Choose an authorization expiry in the future, no more than 90 days from now.");
  }
  const scheduleAuthorization: NonNullable<Workflow["scheduleAuthorization"]> = {
    version: (workflow.scheduleAuthorization?.version ?? 0) + 1,
    authorizerUserId: user._id as Id<"users">,
    authIssuer: portable.principal.issuer,
    authSubject: portable.principal.subject,
    ...(user.externalIdentityId ? { externalIdentityId: user.externalIdentityId as Id<"externalIdentities"> } : {}),
    authorizedAtISO: new Date(now).toISOString(),
    expiresAtISO: new Date(expires).toISOString(),
    definitionFingerprint,
  };
  const next = { ...workflow, scheduleAuthorization, scheduleEnabled: true, scheduleBlockedReason: undefined, nextRunAtISO: nextScheduledRunAt(workflow.trigger, now) };
  const authority = await currentAuthorizer(ctx, next);
  if (authority.state !== "authorized") throw new Error(authority.reason);
  await ctx.db.patch(workflow._id, {
    scheduleAuthorization, scheduleEnabled: true, scheduleBlockedReason: undefined,
    scheduleLastAttemptAtISO: undefined, nextRunAtISO: next.nextRunAtISO,
  });
  return workflowScheduleStatus(ctx, next);
}

/** Direct domain invocation with exactly the capabilities required by this run. */
function insuranceEffectContext(ctx: MutationCtx, workflow: Workflow): PortableMutationCtx {
  const grant = workflow.scheduleAuthorization!;
  const db = convexPortableDb(ctx.db);
  return {
    principal: {
      kind: "service", runtime: "convex-hosted", assurance: "trusted-internal",
      subject: `workflowSchedule:${workflow._id}:${grant.version}`,
      societyId: workflow.societyId, actorUserId: grant.authorizerUserId,
      clientId: "workflow-schedule", scopes: ["financials:read", "tasks:write"],
    },
    capabilities: makeCapabilities({}),
    runQuery: async () => { throw new Error("Scheduled effects cannot dispatch nested public queries."); },
    runMutation: async () => { throw new Error("Scheduled effects cannot dispatch nested public mutations."); },
    db: {
      get: db.get.bind(db),
      query: (table) => {
        if (table !== "insurancePolicies" && table !== "tasks") throw new Error("Unsupported scheduled effect read.");
        const query = db.query(table);
        query.collect = async () => {
          const rows = await query.take(READ_LIMIT + 1);
          if (rows.length > READ_LIMIT) throw new Error("Scheduled insurance review exceeds the bounded batch limit.");
          return rows;
        };
        return query as any;
      },
      insert: (table, value) => {
        if (table !== "tasks" || value.societyId !== workflow.societyId ||
            !Array.isArray(value.responsibleUserIds) || value.responsibleUserIds.length !== 1 ||
            value.responsibleUserIds[0] !== grant.authorizerUserId) throw new Error("Unsupported scheduled effect write.");
        return db.insert(table, value);
      },
      patch: async () => { throw new Error("Scheduled insurance review cannot edit existing records."); },
      replace: async () => { throw new Error("Scheduled insurance review cannot replace records."); },
      delete: async () => { throw new Error("Scheduled insurance review cannot delete records."); },
    },
  };
}

async function blockSchedule(ctx: MutationCtx, workflow: Workflow, reason: string, nowISO: string) {
  await ctx.db.patch(workflow._id, {
    scheduleEnabled: false, nextRunAtISO: undefined,
    scheduleBlockedReason: reason, scheduleLastAttemptAtISO: nowISO,
  });
}

export async function runScheduledWorkflow(ctx: MutationCtx, workflowId: Id<"workflows">, dueAtISO: string) {
  const workflow = await ctx.db.get(workflowId);
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();
  if (!workflow || workflow.scheduleEnabled !== true || workflow.nextRunAtISO !== dueAtISO ||
      !Number.isFinite(Date.parse(dueAtISO)) || Date.parse(dueAtISO) > nowMs) return { state: "skipped" };
  const prior = await ctx.db.query("workflowRuns").withIndex("by_workflow_schedule_tick", q =>
    q.eq("workflowId", workflowId).eq("scheduleTickAtISO", dueAtISO)).first();
  if (prior) return { state: "already_claimed", runId: prior._id };
  const authority = await scheduledAuthority(ctx, workflow, nowMs);
  if (authority.state !== "authorized") {
    await blockSchedule(ctx, workflow, authority.reason ?? "Schedule authorization is unavailable.", nowISO);
    return { state: authority.state };
  }
  const grant = workflow.scheduleAuthorization!;
  const recipeSteps = RECIPE_STEPS[workflow.recipe as keyof typeof RECIPE_STEPS];
  const steps: Array<{ key: string; label: string; status: string; atISO: string; note: string; output?: unknown }> = recipeSteps.map(step => ({
    key: step.key, label: step.label, status: "skip", atISO: nowISO,
    note: "This step needs a person to review and complete it. Automatic execution did not send communications, file a report or confirm governance facts.",
  }));
  let insurance: (Awaited<ReturnType<typeof ensureRenewalTasks>> & { asOf: string }) | undefined;
  if (workflow.recipe === "insurance_renewal") {
    const effect = insuranceEffectContext(ctx, workflow);
    await requireSocietyMembership(effect, workflow.societyId);
    const asOf = organizationToday(await ctx.db.get(workflow.societyId), nowISO);
    insurance = { ...await ensureRenewalTasks(effect, { societyId: workflow.societyId, asOf }), asOf };
    steps[0] = { ...steps[0], status: "ok", note: `Reviewed current policies and created ${insurance.created} dated renewal review tasks. Coverage and notices still require a person.`, output: insurance };
  }
  const runId = await ctx.db.insert("workflowRuns", {
    societyId: workflow.societyId, workflowId, recipe: workflow.recipe,
    provider: "internal", status: "manual_required", startedAtISO: nowISO, completedAtISO: nowISO,
    steps, demo: false, triggeredBy: "cron", triggeredByUserId: grant.authorizerUserId,
    scheduleTickAtISO: dueAtISO, scheduleAuthorizationVersion: grant.version,
    output: { manualRequired: true, ...(insurance ? { insurance } : {}) },
  });
  await ctx.db.insert("notifications", {
    societyId: workflow.societyId, userId: grant.authorizerUserId, kind: "bot", severity: "warn",
    title: `${workflow.name}: review required`,
    body: insurance ? `${insurance.created} renewal review tasks were created. Review the remaining steps before taking action.` : "The scheduled review is ready. A person must complete the workflow steps.",
    linkHref: `/app/workflows/${workflowId}`, createdAtISO: nowISO,
  });
  await ctx.db.patch(workflowId, {
    lastRunAtISO: nowISO, scheduleLastAttemptAtISO: nowISO,
    // Coalesce missed occurrences; never replay an unbounded backlog.
    nextRunAtISO: nextScheduledRunAt(workflow.trigger, nowMs),
  });
  return { state: "manual_required", runId };
}

/** Called only after a failed transaction; a lost successful response is a no-op. */
export async function recordScheduledFailure(ctx: MutationCtx, workflowId: Id<"workflows">, dueAtISO: string) {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow || workflow.scheduleEnabled !== true || workflow.nextRunAtISO !== dueAtISO) return;
  const prior = await ctx.db.query("workflowRuns").withIndex("by_workflow_schedule_tick", q =>
    q.eq("workflowId", workflowId).eq("scheduleTickAtISO", dueAtISO)).first();
  if (prior) return;
  const nowISO = new Date().toISOString();
  const reason = "The scheduled run could not complete safely. No partial effects were committed. Review its records and supported batch size, then authorize the schedule again.";
  await blockSchedule(ctx, workflow, reason, nowISO);
  if (workflow.scheduleAuthorization) await ctx.db.insert("workflowRuns", {
    societyId: workflow.societyId, workflowId, recipe: workflow.recipe,
    provider: "internal", status: "failed", startedAtISO: nowISO, completedAtISO: nowISO,
    steps: [], output: { error: reason }, demo: false, triggeredBy: "cron",
    triggeredByUserId: workflow.scheduleAuthorization.authorizerUserId,
    scheduleTickAtISO: dueAtISO, scheduleAuthorizationVersion: workflow.scheduleAuthorization.version,
  });
}
