import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./users";

type AgentDefinition = {
  key: string;
  name: string;
  summary: string;
  scope: string;
  allowedActions: string[];
  allowedTools: string[];
  requiredInputHints: string[];
  guidanceTemplate: string;
};

const AGENTS: AgentDefinition[] = [
  {
    key: "compliance_analyst",
    name: "Compliance analyst",
    summary: "Reviews governance posture against BC society obligations and produces a bounded issue list.",
    scope: "Compliance review only. May inspect workspace records and suggest next steps; cannot file, approve, or change records.",
    allowedActions: ["summarize_gaps", "prioritize_findings", "cite_workspace_evidence", "recommend_tasks"],
    allowedTools: ["society.read", "directors.read", "meetings.read", "filings.read", "policies.read", "activity.read"],
    requiredInputHints: ["Review period or event", "Compliance concern or obligation", "Records to include"],
    guidanceTemplate:
      "Check the requested period, list missing evidence, separate legal-risk items from housekeeping, and suggest tasks for human approval.",
  },
  {
    key: "minute_drafter",
    name: "Minute drafter",
    summary: "Turns meeting notes or transcript excerpts into structured draft minutes for secretary review.",
    scope: "Drafting support only. May transform provided meeting material; cannot approve minutes or record board decisions.",
    allowedActions: ["draft_minutes", "extract_motions", "extract_action_items", "flag_quorum_gaps"],
    allowedTools: ["meetings.read", "minutes.read", "transcripts.read", "documents.read"],
    requiredInputHints: ["Meeting date or title", "Transcript, notes, or agenda source", "Desired minute style"],
    guidanceTemplate:
      "Prepare a secretary-review draft with attendance, motions, decisions, action items, and gaps that need confirmation.",
  },
  {
    key: "filing_assistant",
    name: "Filing assistant",
    summary: "Plans registry filing packets and preflight checks without submitting anything externally.",
    scope: "Filing preparation only. May assemble filing data and checklist; cannot submit, sign, or represent completion.",
    allowedActions: ["preflight_filing", "prepare_packet_outline", "identify_missing_fields", "draft_operator_checklist"],
    allowedTools: ["society.read", "directors.read", "filings.read", "documents.read", "activity.read"],
    requiredInputHints: ["Filing type", "Effective date or filing period", "Known changed information"],
    guidanceTemplate:
      "Build a filing preflight checklist, identify missing source fields, and produce an operator handoff for manual submission.",
  },
  {
    key: "policy_reviewer",
    name: "Policy reviewer",
    summary: "Reviews internal policies for stale dates, missing owners, and implementation evidence.",
    scope: "Policy review only. May comment and recommend revisions; cannot adopt policies or alter approved text.",
    allowedActions: ["review_policy", "compare_to_template", "flag_review_dates", "suggest_revision_notes"],
    allowedTools: ["policies.read", "documents.read", "activity.read", "tasks.read"],
    requiredInputHints: ["Policy name or area", "Review reason", "Applicable template or requirement"],
    guidanceTemplate:
      "Evaluate the policy status, owner, review cadence, evidence of adoption, and specific revision notes for board approval.",
  },
  {
    key: "grant_reporting_assistant",
    name: "Grant reporting assistant",
    summary: "Plans grant report evidence, restricted-fund summaries, and missing deliverables.",
    scope: "Grant reporting support only. May summarize evidence and draft report structure; cannot certify, submit, or alter financials.",
    allowedActions: ["summarize_grant_progress", "map_evidence", "flag_restricted_fund_gaps", "draft_report_outline"],
    allowedTools: ["grants.read", "financials.read", "documents.read", "tasks.read", "activity.read"],
    requiredInputHints: ["Grant or funder name", "Reporting period", "Deliverables or budget categories"],
    guidanceTemplate:
      "Map deliverables to evidence, call out financial or narrative gaps, and draft a report outline for human review.",
  },
];

const AGENTS_BY_KEY = new Map(AGENTS.map((agent) => [agent.key, agent]));

export const listDefinitions = query({
  args: {},
  returns: v.any(),
  handler: async () => AGENTS,
});

export const listRuns = query({
  args: {
    societyId: v.id("societies"),
    agentKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, agentKey, limit }) => {
    if (agentKey) {
      return ctx.db
        .query("aiAgentRuns")
        .withIndex("by_society_agent", (q) => q.eq("societyId", societyId).eq("agentKey", agentKey))
        .order("desc")
        .take(limit ?? 20);
    }
    return ctx.db
      .query("aiAgentRuns")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 30);
  },
});

export const auditForRun = query({
  args: { runId: v.id("aiAgentRuns") },
  returns: v.any(),
  handler: async (ctx, { runId }) =>
    ctx.db
      .query("aiAgentAuditEvents")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect(),
});

export const runAgent = mutation({
  args: {
    societyId: v.id("societies"),
    agentKey: v.string(),
    input: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agent = AGENTS_BY_KEY.get(args.agentKey);
    if (!agent) throw new Error("Unknown AI agent.");
    const { user } = await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });

    const now = new Date().toISOString();
    const plannedToolCalls = agent.allowedTools.map((toolName) => ({
      toolName,
      purpose: purposeForTool(toolName),
      status: "planned",
    }));
    const output = deterministicOutput(agent, args.input);
    const runId = await ctx.db.insert("aiAgentRuns", {
      societyId: args.societyId,
      agentKey: agent.key,
      agentName: agent.name,
      status: "completed",
      input: args.input.trim(),
      inputHints: agent.requiredInputHints,
      scope: agent.scope,
      allowedActions: agent.allowedActions,
      allowedTools: agent.allowedTools,
      plannedToolCalls,
      output,
      provider: "deterministic_stub",
      createdAtISO: now,
      completedAtISO: now,
      triggeredByUserId: args.actingUserId,
    });

    await ctx.db.insert("aiAgentAuditEvents", {
      societyId: args.societyId,
      runId,
      agentKey: agent.key,
      eventType: "run_requested",
      summary: `${agent.name} requested by ${user?.displayName ?? "workspace user"}.`,
      metadata: { inputLength: args.input.trim().length },
      createdAtISO: now,
      actorUserId: args.actingUserId,
    });
    for (const toolCall of plannedToolCalls) {
      await ctx.db.insert("aiAgentAuditEvents", {
        societyId: args.societyId,
        runId,
        agentKey: agent.key,
        eventType: "tool_planned",
        toolName: toolCall.toolName,
        summary: `${agent.name} planned ${toolCall.toolName}: ${toolCall.purpose}`,
        createdAtISO: now,
        actorUserId: args.actingUserId,
      });
    }
    await ctx.db.insert("aiAgentAuditEvents", {
      societyId: args.societyId,
      runId,
      agentKey: agent.key,
      eventType: "run_completed",
      summary: `${agent.name} returned deterministic guidance for human review.`,
      metadata: { provider: "deterministic_stub" },
      createdAtISO: now,
      actorUserId: args.actingUserId,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: user?.displayName ?? "AI workspace tool",
      entityType: "aiAgentRun",
      entityId: String(runId),
      action: "completed",
      summary: `${agent.name} produced bounded guidance and logged ${plannedToolCalls.length} planned tool request(s).`,
      createdAtISO: now,
    });

    return { runId, output, plannedToolCalls };
  },
});

function deterministicOutput(agent: AgentDefinition, input: string): string {
  const trimmed = input.trim();
  const subject = trimmed.length > 0 ? trimmed : "No input supplied";
  return [
    `${agent.name} guidance`,
    "",
    `Scope: ${agent.scope}`,
    `Request: ${subject}`,
    "",
    "Planned approach:",
    `1. ${agent.guidanceTemplate}`,
    `2. Use only: ${agent.allowedTools.join(", ")}.`,
    "3. Return findings as draft guidance for a human owner to verify before any record changes or external action.",
    "",
    `Required input hints checked: ${agent.requiredInputHints.join("; ")}.`,
    "Provider status: no live AI provider is configured for this tool, so this deterministic stub logged the planned request.",
  ].join("\n");
}

function purposeForTool(toolName: string): string {
  const [area, access] = toolName.split(".");
  const readableArea = area.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${access === "read" ? "Read" : "Use"} ${readableArea} records within the agent scope.`;
}
