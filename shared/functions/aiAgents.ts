/**
 * PORTABLE FUNCTIONS: the AI agents domain — the pure `ctx.db` surface
 * (agent/skill catalogs, skill CRUD, logic-function CRUD, tool-draft review).
 *
 * Only the handlers that read/write exclusively through the portable `ctx.db`
 * contract (and `requireRolePortable`) live here, so they run unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle. The
 * permission-aware tool catalog, tool execution, agent runs, and chat-context
 * builders stay in convex/aiAgents.ts (they depend on convex-only permission
 * helpers and AI orchestration).
 *
 * Shared data/helpers used by BOTH the portable handlers here and the
 * convex-only handlers (AGENTS, BUILT_IN_SKILLS, EMPTY_SCHEMA, getSkills,
 * insertAgentAudit, …) are exported from this file; convex/aiAgents.ts imports
 * them back so live and offline share one source of truth.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

export type SkillDefinition = {
  _id?: string;
  name: string;
  label: string;
  description: string;
  content: string;
  isCustom?: boolean;
  isActive?: boolean;
};

export type AgentDefinition = {
  key: string;
  name: string;
  summary: string;
  scope: string;
  modelId: string;
  skillNames: string[];
  allowedActions: string[];
  allowedTools: string[];
  requiredInputHints: string[];
  guidanceTemplate: string;
  workflowModes?: string[];
  outputContract?: string[];
};

export const EMPTY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    name: "compliance-review",
    label: "Compliance Review",
    description: "Review governance records, missing evidence, filings, and board obligations.",
    content:
      "Plan first. Inspect only permissioned records. Separate legal-risk issues from housekeeping. Cite source records by title/name where possible. Recommend draft tasks for human approval instead of changing records directly.",
  },
  {
    name: "meeting-minutes",
    label: "Meeting Minutes",
    description: "Draft agendas and minutes from meetings, transcripts, documents, and prompts.",
    content:
      "Preserve uncertainty. Do not approve minutes or invent attendance, movers, seconders, votes, or quorum. Output structured sections, motions, decisions, action items, and review gaps that a secretary can verify.",
  },
  {
    name: "registry-filings",
    label: "Registry Filings",
    description: "Prepare filing packets and preflight checklists without submitting externally.",
    content:
      "Treat filing work as preparation only. Verify society profile, directors, addresses, due dates, supporting minutes/resolutions, receipts, and evidence. Produce an operator checklist and never mark a filing complete without explicit human action.",
  },
  {
    name: "policy-review",
    label: "Policy Review",
    description: "Review policies for stale dates, missing owners, and implementation evidence.",
    content:
      "Check status, owner, review cadence, adoption evidence, related documents, and open tasks. Draft revision notes and approval recommendations, but do not alter adopted policy text automatically.",
  },
  {
    name: "grant-reporting",
    label: "Grant Reporting",
    description: "Map grant deliverables, financial evidence, and missing report materials.",
    content:
      "Map deliverables to evidence and financial activity. Flag restricted-fund gaps separately from narrative gaps. Draft report outlines for review and do not certify or submit reports.",
  },
  {
    name: "workflow-building",
    label: "Workflow Building",
    description: "Plan Societyer workflow runs and workflow package handoffs.",
    content:
      "Use workflow tools for discovery and planning. Avoid recursive execution. When a workflow would change records or contact third parties, produce a staged plan and require human confirmation.",
  },
  {
    name: "data-table-access",
    label: "Data Table Access",
    description: "Use Societyer record tables safely through permissioned read tools.",
    content:
      "Use the smallest useful limit. Filter by society and search terms. Prefer read tools before drafting changes. Never expose restricted personal data in public-facing outputs.",
  },
];

export const AGENTS: AgentDefinition[] = [
  {
    key: "compliance_analyst",
    name: "Compliance analyst",
    summary: "Reviews governance posture against BC society obligations and produces a bounded issue list.",
    scope: "Compliance review only. May inspect permissioned records and suggest next steps; cannot file, approve, or change records.",
    modelId: "auto:societyer-smart",
    skillNames: ["compliance-review", "data-table-access"],
    allowedActions: ["summarize_gaps", "prioritize_findings", "cite_workspace_evidence", "recommend_tasks"],
    allowedTools: ["find_society_profile", "find_directors", "find_meetings", "find_filings", "find_policies", "find_activity", "draft_task"],
    requiredInputHints: ["Review period or event", "Compliance concern or obligation", "Records to include"],
    guidanceTemplate:
      "Check the requested period, list missing evidence, separate legal-risk items from housekeeping, and suggest tasks for human approval.",
  },
  {
    key: "minute_drafter",
    name: "Meeting minutes copilot",
    summary: "Drafts agendas, revises draft minutes, and turns uploaded content or spoken notes into structured minutes.",
    scope: "Meeting drafting support only. May draft agenda or minutes content for secretary review; cannot approve minutes, record final decisions, or overwrite source evidence.",
    modelId: "auto:societyer-smart",
    skillNames: ["meeting-minutes", "data-table-access"],
    allowedActions: ["draft_agenda", "revise_draft_minutes", "draft_minutes", "extract_motions", "extract_action_items", "flag_quorum_gaps", "flag_source_gaps"],
    allowedTools: ["find_meetings", "find_minutes", "find_documents", "find_members", "find_directors", "app_extract_minutes_action_items", "draft_task"],
    requiredInputHints: ["Meeting date or title", "Uploaded content, transcript, rough notes, or spoken instructions", "Agenda/minutes style", "Known chair, secretary, attendance, quorum, or approval constraints"],
    guidanceTemplate:
      "Select agenda drafting, draft editing, or minutes generation; map supplied content into the meeting's agenda items (agendas/agendaItems) and minutes fields; preserve uncertainty as review gaps.",
    workflowModes: [
      "Agenda from upload or spoken instructions",
      "Edit existing draft minutes without changing approval status",
      "Generate structured minutes from prompt, transcript, agenda, and meeting metadata",
    ],
    outputContract: [
      "agendaItems: ordered strings suitable for the meeting's agenda items",
      "sections: title/type/presenter/discussion/decisions/actionItems records suitable for minutes.sections",
      "motions: text/movedBy/secondedBy/outcome/vote fields suitable for minutes.motions",
      "reviewGaps: quorum, attendance, source, approval, or ambiguous-speaker items requiring human confirmation",
    ],
  },
  {
    key: "filing_assistant",
    name: "Filing assistant",
    summary: "Plans registry filing packets and preflight checks without submitting anything externally.",
    scope: "Filing preparation only. May assemble filing data and checklist; cannot submit, sign, or represent completion.",
    modelId: "auto:societyer-fast",
    skillNames: ["registry-filings", "workflow-building"],
    allowedActions: ["preflight_filing", "prepare_packet_outline", "identify_missing_fields", "draft_operator_checklist"],
    allowedTools: ["find_society_profile", "find_directors", "find_filings", "find_documents", "find_activity", "app_prepare_filing_packet", "draft_task"],
    requiredInputHints: ["Filing type", "Effective date or filing period", "Known changed information"],
    guidanceTemplate:
      "Build a filing preflight checklist, identify missing source fields, and produce an operator handoff for manual submission.",
  },
  {
    key: "policy_reviewer",
    name: "Policy reviewer",
    summary: "Reviews internal policies for stale dates, missing owners, and implementation evidence.",
    scope: "Policy review only. May comment and recommend revisions; cannot adopt policies or alter approved text.",
    modelId: "auto:societyer-fast",
    skillNames: ["policy-review", "data-table-access"],
    allowedActions: ["review_policy", "compare_to_template", "flag_review_dates", "suggest_revision_notes"],
    allowedTools: ["find_policies", "find_documents", "find_activity", "find_tasks", "draft_task"],
    requiredInputHints: ["Policy name or area", "Review reason", "Applicable template or requirement"],
    guidanceTemplate:
      "Evaluate the policy status, owner, review cadence, evidence of adoption, and specific revision notes for board approval.",
  },
  {
    key: "grant_reporting_assistant",
    name: "Grant reporting assistant",
    summary: "Plans grant report evidence, restricted-fund summaries, and missing deliverables.",
    scope: "Grant reporting support only. May summarize evidence and draft report structure; cannot certify, submit, or alter financials.",
    modelId: "auto:societyer-smart",
    skillNames: ["grant-reporting", "data-table-access"],
    allowedActions: ["summarize_grant_progress", "map_evidence", "flag_restricted_fund_gaps", "draft_report_outline"],
    allowedTools: ["find_grants", "find_financials", "find_documents", "find_tasks", "find_activity", "draft_task"],
    requiredInputHints: ["Grant or funder name", "Reporting period", "Deliverables or budget categories"],
    guidanceTemplate:
      "Map deliverables to evidence, call out financial or narrative gaps, and draft a report outline for human review.",
  },
];

export const AGENTS_BY_KEY = new Map(AGENTS.map((agent) => [agent.key, agent]));

export async function getActiveSkills(ctx: any, societyId?: string): Promise<SkillDefinition[]> {
  return getSkills(ctx, societyId, true);
}

export async function getSkills(ctx: any, societyId?: string, activeOnly = true): Promise<SkillDefinition[]> {
  const custom = societyId
    ? await ctx.db
        .query("aiSkills")
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .collect()
        .catch(() => [])
    : [];
  return [
    ...BUILT_IN_SKILLS,
    ...custom.map((skill: any) => ({
      name: skill.name,
      label: skill.label,
      description: skill.description,
      content: skill.content,
      _id: skill._id,
      isCustom: true,
      isActive: skill.isActive !== false,
    })),
  ].filter((skill) => !activeOnly || skill.isActive !== false);
}

export async function insertAgentAudit(ctx: any, args: any) {
  await ctx.db.insert("aiAgentAuditEvents", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

export function normalizeSkillName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeAppName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function listDefinitionsPortable(_ctx: PortableQueryCtx) {
  return AGENTS;
}

export async function listSkillsPortable(ctx: PortableQueryCtx, { societyId }: { societyId?: string }) {
  return getActiveSkills(ctx, societyId);
}

export async function listAllSkillsPortable(ctx: PortableQueryCtx, { societyId }: { societyId?: string }) {
  return getSkills(ctx, societyId, false);
}

export async function loadSkillsPortable(
  ctx: PortableQueryCtx,
  { societyId, skillNames }: { societyId?: string; skillNames: string[] },
) {
  const skills = await getActiveSkills(ctx, societyId);
  const requested = new Set(skillNames);
  const loaded = skills.filter((skill) => requested.has(skill.name));
  return {
    skills: loaded,
    missing: skillNames.filter((name) => !loaded.some((skill) => skill.name === name)),
    message:
      loaded.length > 0
        ? `Loaded ${loaded.map((skill) => skill.label).join(", ")}`
        : `No requested skills found. Available skills: ${skills.map((skill) => skill.name).join(", ")}`,
  };
}

export async function upsertSkillPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    actingUserId?: string;
    id?: string;
    name: string;
    label: string;
    description?: string;
    content: string;
    isActive?: boolean;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const now = new Date().toISOString();
  const name = normalizeSkillName(args.name);
  if (!name) throw new Error("Skill name is required.");
  if (BUILT_IN_SKILLS.some((skill) => skill.name === name)) {
    throw new Error("Built-in skills cannot be overwritten.");
  }

  if (args.id) {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.societyId !== args.societyId) throw new Error("Skill not found.");
    await ctx.db.patch(args.id, {
      name,
      label: args.label.trim() || name,
      description: args.description?.trim(),
      content: args.content.trim(),
      isActive: args.isActive !== false,
      updatedAtISO: now,
    });
    return args.id;
  }

  const existing = await ctx.db
    .query("aiSkills")
    .withIndex("by_society_name", (q: any) => q.eq("societyId", args.societyId).eq("name", name))
    .first();
  if (existing) throw new Error("A custom skill with that name already exists.");
  return await ctx.db.insert("aiSkills", {
    societyId: args.societyId,
    name,
    label: args.label.trim() || name,
    description: args.description?.trim(),
    content: args.content.trim(),
    isActive: args.isActive !== false,
    isCustom: true,
    createdByUserId: args.actingUserId,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function setSkillActivePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; actingUserId?: string; id: string; isActive: boolean },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const existing = await ctx.db.get(args.id);
  if (!existing || existing.societyId !== args.societyId) throw new Error("Skill not found.");
  await ctx.db.patch(args.id, { isActive: args.isActive, updatedAtISO: new Date().toISOString() });
  return args.id;
}

export async function removeSkillPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; actingUserId?: string; id: string },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const existing = await ctx.db.get(args.id);
  if (!existing || existing.societyId !== args.societyId) throw new Error("Skill not found.");
  await ctx.db.delete(args.id);
  return args.id;
}

export async function listLogicFunctionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("aiLogicFunctions")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
}

export async function listToolDraftsPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; status?: string; limit?: number },
) {
  const rows = await ctx.db
    .query("aiToolDrafts")
    .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
    .order("desc")
    .take(args.limit ?? 30);
  return args.status ? rows.filter((row: any) => row.status === args.status) : rows;
}

export async function approveToolDraftPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; actingUserId?: string; id: string },
) {
  const { user } = await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const draft = await ctx.db.get(args.id);
  if (!draft || draft.societyId !== args.societyId) throw new Error("Draft not found.");
  if (draft.status !== "draft" && draft.status !== "approved") throw new Error(`Draft is ${draft.status}.`);
  const now = new Date().toISOString();
  let result: any = { status: "approved" };
  if (draft.toolName === "draft_task") {
    const payload = draft.payload ?? {};
    const taskId = await ctx.db.insert("tasks", {
      societyId: args.societyId,
      title: String(payload.title ?? draft.title ?? "AI drafted task"),
      description: payload.description ? String(payload.description) : undefined,
      status: "Todo",
      priority: String(payload.priority ?? "Medium"),
      dueDate: payload.dueDate ? String(payload.dueDate) : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : ["ai-draft"],
      createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: user?.displayName ?? "AI approver",
      entityType: "task",
      subjectId: taskId,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: taskId,
      action: "created",
      summary: `Approved AI task draft "${payload.title ?? draft.title ?? "Untitled"}"`,
      createdAtISO: now,
    });
    result = { status: "executed", taskId };
  }
  await ctx.db.patch(args.id, {
    status: result.status,
    updatedAtISO: now,
    payload: { ...(draft.payload ?? {}), approval: { approvedByUserId: args.actingUserId, approvedAtISO: now, result } },
  });
  await insertAgentAudit(ctx, {
    societyId: args.societyId,
    runId: draft.runId,
    agentKey: draft.agentKey ?? "draft",
    eventType: "tool_draft_approved",
    toolName: draft.toolName,
    summary: `Approved AI tool draft ${String(args.id)}.`,
    metadata: result,
    actorUserId: args.actingUserId,
  });
  return result;
}

export async function rejectToolDraftPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; actingUserId?: string; id: string },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const draft = await ctx.db.get(args.id);
  if (!draft || draft.societyId !== args.societyId) throw new Error("Draft not found.");
  await ctx.db.patch(args.id, { status: "rejected", updatedAtISO: new Date().toISOString() });
  await insertAgentAudit(ctx, {
    societyId: args.societyId,
    runId: draft.runId,
    agentKey: draft.agentKey ?? "draft",
    eventType: "tool_draft_rejected",
    toolName: draft.toolName,
    summary: `Rejected AI tool draft ${String(args.id)}.`,
    actorUserId: args.actingUserId,
  });
  return args.id;
}

export async function upsertLogicFunctionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    actingUserId?: string;
    id?: string;
    name: string;
    label: string;
    description?: string;
    status?: string;
    inputSchema?: any;
    toolTriggerSettings?: any;
    implementationKind: string;
    workflowId?: string;
    webhookUrl?: string;
    manualInstructions?: string;
    requiredPermission?: string;
  },
) {
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Admin",
  });
  const now = new Date().toISOString();
  const name = normalizeAppName(args.name);
  if (!name) throw new Error("Logic function name is required.");
  const patch = {
    societyId: args.societyId,
    name,
    label: args.label.trim() || name,
    description: args.description?.trim(),
    status: args.status ?? "active",
    inputSchema: args.inputSchema,
    toolTriggerSettings: args.toolTriggerSettings ?? { inputSchema: args.inputSchema ?? EMPTY_SCHEMA },
    implementationKind: args.implementationKind,
    workflowId: args.workflowId,
    webhookUrl: args.webhookUrl?.trim(),
    manualInstructions: args.manualInstructions?.trim(),
    requiredPermission: args.requiredPermission,
    updatedAtISO: now,
  } as any;
  if (args.id) {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.societyId !== args.societyId) throw new Error("Logic function not found.");
    await ctx.db.patch(args.id, patch);
    return args.id;
  }
  const existing = await ctx.db
    .query("aiLogicFunctions")
    .withIndex("by_society_name", (q: any) => q.eq("societyId", args.societyId).eq("name", name))
    .first();
  if (existing) throw new Error("A logic function with that name already exists.");
  return await ctx.db.insert("aiLogicFunctions", {
    ...patch,
    createdByUserId: args.actingUserId,
    createdAtISO: now,
  });
}
