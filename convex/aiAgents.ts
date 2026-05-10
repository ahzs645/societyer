import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import { Id } from "./_generated/dataModel";
import { hasPermission, type Permission } from "./lib/permissions";
import { requireRole } from "./users";

type ToolCategory =
  | "DATABASE_CRUD"
  | "ACTION"
  | "WORKFLOW"
  | "METADATA"
  | "VIEW"
  | "DASHBOARD"
  | "LOGIC_FUNCTION";

type ToolDefinition = {
  name: string;
  label: string;
  category: ToolCategory;
  description: string;
  requiredPermission?: Permission;
  inputSchema: Record<string, unknown>;
  executionRef: {
    kind: "database_read" | "action" | "workflow" | "metadata" | "view" | "dashboard" | "logic_function";
    table?: string;
    operation?: string;
    logicFunctionKey?: string;
  };
};

type SkillDefinition = {
  _id?: Id<"aiSkills">;
  name: string;
  label: string;
  description: string;
  content: string;
  isCustom?: boolean;
  isActive?: boolean;
};

type AgentDefinition = {
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

const TOOL_CATEGORIES: ToolCategory[] = [
  "DATABASE_CRUD",
  "ACTION",
  "WORKFLOW",
  "METADATA",
  "VIEW",
  "DASHBOARD",
  "LOGIC_FUNCTION",
];

const SMALL_LIMIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: {
      type: "number",
      minimum: 1,
      maximum: 20,
      description: "Maximum rows to return. Use 5-10 for exploration.",
    },
    search: {
      type: "string",
      description: "Optional case-insensitive text search over common title/name fields.",
    },
  },
};

const EMPTY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const TASK_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
    dueDate: { type: "string", description: "ISO date, if known." },
    tags: { type: "array", items: { type: "string" } },
  },
};

const BUILT_IN_SKILLS: SkillDefinition[] = [
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

const BUILT_IN_LOGIC_FUNCTION_TOOLS: ToolDefinition[] = [
  {
    name: "app_prepare_filing_packet",
    label: "Prepare filing packet",
    category: "LOGIC_FUNCTION",
    description: "Produce a filing packet outline and missing-evidence checklist.",
    requiredPermission: "filings:read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["filingKind"],
      properties: {
        filingKind: { type: "string" },
        effectiveDate: { type: "string" },
        knownChanges: { type: "string" },
      },
    },
    executionRef: { kind: "logic_function", logicFunctionKey: "prepare_filing_packet" },
  },
  {
    name: "app_extract_minutes_action_items",
    label: "Extract minutes action items",
    category: "LOGIC_FUNCTION",
    description: "Extract secretary-reviewable action items from meeting notes or minutes text.",
    requiredPermission: "minutes:read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sourceText"],
      properties: {
        sourceText: { type: "string" },
        meetingTitle: { type: "string" },
      },
    },
    executionRef: { kind: "logic_function", logicFunctionKey: "extract_minutes_action_items" },
  },
];

const TOOL_DEFINITIONS: ToolDefinition[] = [
  databaseTool("find_society_profile", "Society profile", "society:read", "societies", "Read the society profile and governance settings."),
  databaseTool("find_members", "Members", "members:read", "members", "Search member records."),
  databaseTool("find_directors", "Directors", "directors:read", "directors", "Search director records."),
  databaseTool("find_meetings", "Meetings", "meetings:read", "meetings", "Search meetings and board/AGM schedule records."),
  databaseTool("find_minutes", "Minutes", "minutes:read", "minutes", "Search minutes records."),
  databaseTool("find_filings", "Filings", "filings:read", "filings", "Search registry and tax filing records."),
  databaseTool("find_documents", "Documents", "documents:read", "documents", "Search document library records."),
  databaseTool("find_policies", "Policies", "documents:read", "policies", "Search policies and policy review records."),
  databaseTool("find_tasks", "Tasks", "tasks:read", "tasks", "Search task records."),
  databaseTool("find_grants", "Grants", "grants:read", "grants", "Search grants and grant report records."),
  databaseTool("find_financials", "Financials", "financials:read", "financials", "Search financial statement records."),
  databaseTool("find_activity", "Activity", "audit:read", "activity", "Search audit/activity timeline records."),
  {
    name: "draft_task",
    label: "Draft task",
    category: "ACTION",
    description: "Draft a task recommendation. This does not create a task until a human confirms it.",
    requiredPermission: "tasks:write",
    inputSchema: TASK_DRAFT_SCHEMA,
    executionRef: { kind: "action", operation: "draft_task" },
  },
  {
    name: "navigate_app",
    label: "Navigate app",
    category: "ACTION",
    description: "Return the Societyer route for a section or record context.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["section"],
      properties: { section: { type: "string" } },
    },
    executionRef: { kind: "action", operation: "navigate_app" },
  },
  {
    name: "list_workflows",
    label: "List workflows",
    category: "WORKFLOW",
    description: "List workflow definitions for planning or handoff.",
    requiredPermission: "settings:read",
    inputSchema: SMALL_LIMIT_SCHEMA,
    executionRef: { kind: "workflow", table: "workflows", operation: "find" },
  },
  {
    name: "list_object_metadata",
    label: "List object metadata",
    category: "METADATA",
    description: "List configured record-table objects and routes.",
    requiredPermission: "settings:read",
    inputSchema: EMPTY_SCHEMA,
    executionRef: { kind: "metadata", table: "objectMetadata", operation: "find" },
  },
  {
    name: "list_views",
    label: "List views",
    category: "VIEW",
    description: "List record table views.",
    requiredPermission: "settings:read",
    inputSchema: SMALL_LIMIT_SCHEMA,
    executionRef: { kind: "view", table: "views", operation: "find" },
  },
  {
    name: "summarize_dashboard",
    label: "Summarize dashboard",
    category: "DASHBOARD",
    description: "Read dashboard-relevant compliance and task counters.",
    requiredPermission: "audit:read",
    inputSchema: EMPTY_SCHEMA,
    executionRef: { kind: "dashboard", operation: "summary" },
  },
  ...BUILT_IN_LOGIC_FUNCTION_TOOLS,
];

const AGENTS: AgentDefinition[] = [
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
      "Select agenda drafting, draft editing, or minutes generation; map supplied content into the existing meeting agendaJson and minutes fields; preserve uncertainty as review gaps.",
    workflowModes: [
      "Agenda from upload or spoken instructions",
      "Edit existing draft minutes without changing approval status",
      "Generate structured minutes from prompt, transcript, agenda, and meeting metadata",
    ],
    outputContract: [
      "agendaItems: ordered strings suitable for meeting.agendaJson",
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

const AGENTS_BY_KEY = new Map(AGENTS.map((agent) => [agent.key, agent]));

const SAFE_FIELD_ALLOWLIST: Record<string, string[]> = {
  societies: ["name", "legalName", "incorporationNumber", "registryNumber", "status", "jurisdiction", "timezone"],
  members: ["firstName", "lastName", "displayName", "name", "status", "membershipType", "joinedAtISO", "tags"],
  directors: ["name", "roleTitle", "status", "termStart", "termEnd", "appointedAtISO"],
  meetings: ["title", "type", "status", "scheduledAt", "location", "summary"],
  minutes: ["title", "status", "meetingId", "approvedAtISO", "sections", "motions", "decisions", "actionItems"],
  filings: ["kind", "title", "status", "dueDate", "filedAtISO", "periodStart", "periodEnd"],
  documents: ["title", "fileName", "mimeType", "category", "status", "tags", "createdAtISO", "updatedAtISO"],
  policies: ["title", "status", "owner", "reviewDate", "approvedAtISO", "category"],
  tasks: ["title", "status", "priority", "dueDate", "assignedTo", "tags", "createdAtISO"],
  grants: ["name", "title", "funder", "status", "amount", "deadline", "reportDueDate"],
  financials: ["title", "periodStart", "periodEnd", "status", "summary", "createdAtISO"],
  activity: ["actor", "entityType", "action", "summary", "createdAtISO"],
  workflows: ["name", "recipe", "status", "provider", "trigger", "lastRunAtISO", "nextRunAtISO"],
  objectMetadata: ["nameSingular", "namePlural", "labelSingular", "labelPlural", "routePath", "status"],
  views: ["name", "objectMetadataId", "type", "createdAtISO", "updatedAtISO"],
};

const SENSITIVE_FIELD_RE = /(password|secret|token|key|credential|sin|ssn|birth|dob|phone|email|address|signature|bank|account|routing|card|private|notes)/i;

export const listDefinitions = query({
  args: {},
  returns: v.any(),
  handler: async () => AGENTS,
});

export const listSkills = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => getActiveSkills(ctx, societyId),
});

export const listAllSkills = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.any(),
  handler: async (ctx, { societyId }) => getSkills(ctx, societyId, false),
});

export const loadSkills = query({
  args: {
    societyId: v.optional(v.id("societies")),
    skillNames: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, skillNames }) => {
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
  },
});

export const upsertSkill = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.optional(v.id("aiSkills")),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    content: v.string(),
    isActive: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const setSkillActive = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.id("aiSkills"),
    isActive: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.societyId !== args.societyId) throw new Error("Skill not found.");
    await ctx.db.patch(args.id, { isActive: args.isActive, updatedAtISO: new Date().toISOString() });
    return args.id;
  },
});

export const removeSkill = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.id("aiSkills"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Admin",
    });
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.societyId !== args.societyId) throw new Error("Skill not found.");
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const listLogicFunctions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("aiLogicFunctions")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const upsertLogicFunction = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.optional(v.id("aiLogicFunctions")),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    inputSchema: v.optional(v.any()),
    toolTriggerSettings: v.optional(v.any()),
    implementationKind: v.string(),
    workflowId: v.optional(v.id("workflows")),
    webhookUrl: v.optional(v.string()),
    manualInstructions: v.optional(v.string()),
    requiredPermission: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
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
  },
});

export const getToolCatalog = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    categories: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { role } = await resolveActorRole(ctx, args.societyId, args.actingUserId);
    const allowedTools = await getAvailableTools(ctx, args.societyId, role, args.categories);
    return {
      role,
      categories: TOOL_CATEGORIES,
      catalog: groupCatalog(allowedTools),
      tools: allowedTools.map(toCatalogEntry),
    };
  },
});

export const learnTools = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    toolNames: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { role } = await resolveActorRole(ctx, args.societyId, args.actingUserId);
    const availableTools = await getAvailableTools(ctx, args.societyId, role);
    const allowed = new Map(availableTools.map((tool) => [tool.name, tool]));
    const tools = args.toolNames
      .map((name) => allowed.get(name))
      .filter((tool): tool is ToolDefinition => !!tool)
      .map((tool) => ({
        ...toCatalogEntry(tool),
        inputSchema: tool.inputSchema,
        executionRef: tool.executionRef,
      }));
    return {
      tools,
      notFound: args.toolNames.filter((name) => !allowed.has(name)),
      message: `Learned ${tools.length} tool(s).`,
    };
  },
});

export const executeTool = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    toolName: v.string(),
    arguments: v.optional(v.any()),
    threadId: v.optional(v.id("aiChatThreads")),
    runId: v.optional(v.id("aiAgentRuns")),
    agentKey: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { role } = await resolveActorRole(ctx, args.societyId, args.actingUserId);
    const availableTools = await getAvailableTools(ctx, args.societyId, role);
    const tool = availableTools.find((entry) => entry.name === args.toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${args.toolName}" is not available for role ${role}.`,
      };
    }
    const result = await executeToolWithEffects(ctx, {
      societyId: args.societyId,
      actingUserId: args.actingUserId,
      role,
      tool,
      arguments: args.arguments ?? {},
      threadId: args.threadId,
      runId: args.runId,
      agentKey: args.agentKey,
    });
    if (args.runId || args.threadId || tool.category === "LOGIC_FUNCTION") {
      await insertAgentAudit(ctx, {
        societyId: args.societyId,
        runId: args.runId,
        agentKey: args.agentKey ?? "chat",
        eventType: "tool_executed",
        toolName: tool.name,
        summary: `Executed ${tool.name} for ${role}.`,
        metadata: {
          arguments: args.arguments ?? {},
          resultPreview: JSON.stringify(result).slice(0, 1200),
          threadId: args.threadId ? String(args.threadId) : undefined,
        },
        actorUserId: args.actingUserId,
      });
    }
    return result;
  },
});

export const getChatContext = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    browsingContext: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { role, user } = await resolveActorRole(ctx, args.societyId, args.actingUserId);
    const [society, skills, tools] = await Promise.all([
      ctx.db.get(args.societyId),
      getActiveSkills(ctx, args.societyId),
      getAvailableTools(ctx, args.societyId, role),
    ]);
    return {
      role,
      user: user ? { id: user._id, displayName: user.displayName, role: user.role } : null,
      skillCatalog: skills.map((skill) => ({
        name: skill.name,
        label: skill.label,
        description: skill.description,
      })),
      toolCatalog: groupCatalog(tools),
      browsingContext: args.browsingContext ?? null,
      systemPrompt: buildSystemPrompt({
        societyName: society?.name ?? "Societyer workspace",
        role,
        skills,
        tools,
        browsingContext: args.browsingContext,
      }),
    };
  },
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
        .withIndex("by_society_agent", (q: any) => q.eq("societyId", societyId).eq("agentKey", agentKey))
        .order("desc")
        .take(limit ?? 20);
    }
    return ctx.db
      .query("aiAgentRuns")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
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
      .withIndex("by_run", (q: any) => q.eq("runId", runId))
      .order("asc")
      .collect(),
});

export const runAgent = mutation({
  args: {
    societyId: v.id("societies"),
    agentKey: v.string(),
    input: v.string(),
    actingUserId: v.optional(v.id("users")),
    browsingContext: v.optional(v.any()),
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

    const role = user?.role ?? "Viewer";
    const availableTools = (await getAvailableTools(ctx, args.societyId, role)).filter((tool) => agent.allowedTools.includes(tool.name));
    const skills = await getActiveSkills(ctx, args.societyId);
    const loadedSkills = skills.filter((skill) => agent.skillNames.includes(skill.name));
    const learnedTools = availableTools.map((tool) => ({
      name: tool.name,
      category: tool.category,
      inputSchema: tool.inputSchema,
    }));
    const now = new Date().toISOString();
    const plannedToolCalls = availableTools.map((tool) => ({
      toolName: tool.name,
      purpose: tool.description,
      status: "planned",
    }));
    const unavailableTools = agent.allowedTools.filter(
      (toolName) => !availableTools.some((tool) => tool.name === toolName),
    );
    const output = deterministicOutput({
      agent,
      input: args.input,
      loadedSkills,
      availableTools,
      unavailableTools,
      browsingContext: args.browsingContext,
    });
    const runId = await ctx.db.insert("aiAgentRuns", {
      societyId: args.societyId,
      agentKey: agent.key,
      agentName: agent.name,
      status: "completed",
      input: args.input.trim(),
      inputHints: agent.requiredInputHints,
      scope: agent.scope,
      allowedActions: agent.allowedActions,
      allowedTools: availableTools.map((tool) => tool.name),
      plannedToolCalls,
      output,
      provider: "deterministic_skill_router",
      createdAtISO: now,
      completedAtISO: now,
      triggeredByUserId: args.actingUserId,
      loadedSkillNames: loadedSkills.map((skill) => skill.name),
      toolCatalogSnapshot: availableTools.map(toCatalogEntry),
      unavailableTools,
    } as any);

    await insertAgentAudit(ctx, {
      societyId: args.societyId,
      runId,
      agentKey: agent.key,
      eventType: "run_requested",
      summary: `${agent.name} requested by ${user?.displayName ?? "workspace user"}.`,
      metadata: { inputLength: args.input.trim().length, role },
      actorUserId: args.actingUserId,
    });
    for (const skill of loadedSkills) {
      await insertAgentAudit(ctx, {
        societyId: args.societyId,
        runId,
        agentKey: agent.key,
        eventType: "skill_loaded",
        summary: `${agent.name} loaded skill ${skill.name}.`,
        metadata: { label: skill.label },
        actorUserId: args.actingUserId,
      });
    }
    for (const tool of learnedTools) {
      await insertAgentAudit(ctx, {
        societyId: args.societyId,
        runId,
        agentKey: agent.key,
        eventType: "tool_learned",
        toolName: tool.name,
        summary: `${agent.name} learned ${tool.name} schema.`,
        metadata: { category: tool.category, inputSchema: tool.inputSchema },
        actorUserId: args.actingUserId,
      });
    }
    for (const toolCall of plannedToolCalls) {
      await insertAgentAudit(ctx, {
        societyId: args.societyId,
        runId,
        agentKey: agent.key,
        eventType: "tool_planned",
        toolName: toolCall.toolName,
        summary: `${agent.name} planned ${toolCall.toolName}: ${toolCall.purpose}`,
        actorUserId: args.actingUserId,
      });
    }
    await insertAgentAudit(ctx, {
      societyId: args.societyId,
      runId,
      agentKey: agent.key,
      eventType: "run_completed",
      summary: `${agent.name} returned deterministic skill-router guidance for human review.`,
      metadata: { provider: "deterministic_skill_router", unavailableTools },
      actorUserId: args.actingUserId,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: user?.displayName ?? "AI workspace tool",
      entityType: "aiAgentRun",
      entityId: String(runId),
      action: "completed",
      summary: `${agent.name} loaded ${loadedSkills.length} skill(s), learned ${learnedTools.length} tool schema(s), and planned ${plannedToolCalls.length} tool request(s).`,
      createdAtISO: now,
    });

    return {
      runId,
      output,
      plannedToolCalls,
      loadedSkills,
      learnedTools,
      unavailableTools,
    };
  },
});

function databaseTool(name: string, label: string, requiredPermission: Permission, table: string, description: string): ToolDefinition {
  return {
    name,
    label,
    category: "DATABASE_CRUD",
    description,
    requiredPermission,
    inputSchema: SMALL_LIMIT_SCHEMA,
    executionRef: { kind: "database_read", table, operation: "find" },
  };
}

async function getActiveSkills(ctx: any, societyId?: Id<"societies">): Promise<SkillDefinition[]> {
  return getSkills(ctx, societyId, true);
}

async function getSkills(ctx: any, societyId?: Id<"societies">, activeOnly = true): Promise<SkillDefinition[]> {
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

async function resolveActorRole(ctx: any, societyId: Id<"societies">, actingUserId?: Id<"users">) {
  if (!actingUserId) return { role: "Viewer", user: null };
  const user = await ctx.db.get(actingUserId);
  if (!user || user.societyId !== societyId) return { role: "Viewer", user: null };
  return { role: user.role as string, user };
}

async function getAvailableTools(ctx: any, societyId: Id<"societies">, role: string, categories?: string[]) {
  return filterToolsForRole(
    [...TOOL_DEFINITIONS, ...(await getCustomLogicFunctionTools(ctx, societyId))],
    role,
    categories,
  );
}

async function getCustomLogicFunctionTools(ctx: any, societyId: Id<"societies">): Promise<ToolDefinition[]> {
  const rows = await ctx.db
    .query("aiLogicFunctions")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect()
    .catch(() => []);
  return rows
    .filter((row: any) => row.status === "active" && row.toolTriggerSettings !== null)
    .map((row: any) => ({
      name: `app_${String(row.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      label: row.label,
      category: "LOGIC_FUNCTION" as ToolCategory,
      description: row.description ?? `Execute ${row.label}`,
      requiredPermission: row.requiredPermission as Permission | undefined,
      inputSchema: row.toolTriggerSettings?.inputSchema ?? row.inputSchema ?? EMPTY_SCHEMA,
      executionRef: { kind: "logic_function" as const, logicFunctionKey: row.name },
    }));
}

function filterToolsForRole(tools: ToolDefinition[], role: string, categories?: string[]) {
  const categorySet = categories?.length ? new Set(categories) : null;
  return tools.filter((tool) => {
    if (categorySet && !categorySet.has(tool.category)) return false;
    return !tool.requiredPermission || hasPermission(role, tool.requiredPermission);
  });
}

function groupCatalog(tools: ToolDefinition[]) {
  const grouped: Record<string, Array<{ name: string; label: string; description: string }>> = {};
  for (const tool of tools) {
    grouped[tool.category] ??= [];
    grouped[tool.category].push({
      name: tool.name,
      label: tool.label,
      description: tool.description,
    });
  }
  return grouped;
}

function toCatalogEntry(tool: ToolDefinition) {
  return {
    name: tool.name,
    label: tool.label,
    category: tool.category,
    description: tool.description,
    requiredPermission: tool.requiredPermission,
  };
}

async function executeToolWithEffects(
  ctx: any,
  {
    societyId,
    actingUserId,
    role,
    tool,
    arguments: args,
    threadId,
    runId,
    agentKey,
  }: {
    societyId: Id<"societies">;
    actingUserId?: Id<"users">;
    role: string;
    tool: ToolDefinition;
    arguments: any;
    threadId?: Id<"aiChatThreads">;
    runId?: Id<"aiAgentRuns">;
    agentKey?: string;
  },
) {
  if (tool.executionRef.kind === "database_read" || ["workflow", "metadata", "view"].includes(tool.executionRef.kind)) {
    const table = tool.executionRef.table;
    if (!table) return { success: false, error: "Tool has no table binding." };
    const limit = clampLimit(args?.limit);
    const rows =
      table === "societies"
        ? [await ctx.db.get(societyId)].filter(Boolean)
        : await ctx.db
            .query(table)
            .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
            .take(limit)
            .catch(async () => ctx.db.query(table).take(limit));
    const filteredRows = filterSearch(rows, args?.search).slice(0, limit);
    return {
      success: true,
      toolName: tool.name,
      rows: filteredRows.map((row) => sanitizeRecord(table, row, role)),
      recordReferences: filteredRows.map((row) => recordReferenceFor(table, row)).filter(Boolean),
      permission: {
        objectReadable: true,
        fieldPolicy: "export_safe_allowlist",
        publicSafeOutput: true,
      },
    };
  }
  if (tool.name === "navigate_app") {
    return { success: true, route: routeForSection(args?.section) };
  }
  if (tool.name === "draft_task") {
    const now = new Date().toISOString();
    const draft = { status: "draft", priority: "Medium", tags: [], ...args };
    const draftId = await ctx.db.insert("aiToolDrafts", {
      societyId,
      threadId,
      runId,
      agentKey,
      toolName: tool.name,
      title: args?.title ?? "AI drafted task",
      payload: draft,
      status: "draft",
      createdByUserId: actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
    });
    return { success: true, draftId, draft, message: "Draft task created for human approval." };
  }
  if (tool.category === "LOGIC_FUNCTION") {
    return executeLogicFunction(ctx, societyId, tool, args);
  }
  return { success: false, error: `Tool "${tool.name}" is not executable in read-only preview mode.` };
}

function buildSystemPrompt({
  societyName,
  role,
  skills,
  tools,
  browsingContext,
}: {
  societyName: string;
  role: string;
  skills: SkillDefinition[];
  tools: ToolDefinition[];
  browsingContext?: unknown;
}) {
  const skillCatalog = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  const toolCatalog = tools.map((tool) => `- ${tool.name} [${tool.category}]: ${tool.description}`).join("\n");
  return [
    `You are Societyer's AI assistant for ${societyName}.`,
    `Actor role: ${role}. Only use tools available to this role.`,
    "",
    "Follow Plan -> Skill -> Learn -> Execute for every non-trivial request.",
    "1. Plan the domain and risk.",
    "2. Load the relevant skill instructions.",
    "3. Learn the exact tool schemas.",
    "4. Execute only permissioned tools and return draft guidance for human confirmation.",
    "",
    "Available skills:",
    skillCatalog || "- none",
    "",
    "Available tools:",
    toolCatalog || "- none",
    browsingContext ? `\nBrowsing context:\n${JSON.stringify(browsingContext)}` : "",
  ].join("\n");
}

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 10;
  return Math.min(Math.max(parsed, 1), 20);
}

function filterSearch(rows: any[], search?: string) {
  const needle = search?.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    ["title", "name", "firstName", "lastName", "email", "kind", "status", "summary"]
      .map((key) => row?.[key])
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}

async function executeLogicFunction(ctx: any, societyId: Id<"societies">, tool: ToolDefinition, args: any) {
  const key = tool.executionRef.logicFunctionKey;
  if (key === "prepare_filing_packet") {
    const filings = await ctx.db
      .query("filings")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .take(10)
      .catch(() => []);
    return {
      success: true,
      mode: "built_in",
      result: {
        filingKind: args?.filingKind,
        checklist: [
          "Verify society profile and registered office.",
          "Confirm director/officer records match the supporting minutes.",
          "Attach resolutions, receipts, and effective-date evidence.",
          "Hold for human filing review before external submission.",
        ],
        knownFilings: filings.map((row: any) => sanitizeRecord("filings", row, "Admin")),
        recordReferences: filings.map((row: any) => recordReferenceFor("filings", row)).filter(Boolean),
      },
    };
  }
  if (key === "extract_minutes_action_items") {
    const source = String(args?.sourceText ?? "");
    const actionItems = source
      .split(/\n|\. /)
      .map((line) => line.trim())
      .filter((line) => /(action|follow up|to do|by\s+\w+)/i.test(line))
      .slice(0, 20)
      .map((line) => ({ text: line.replace(/^action item:\s*/i, ""), done: false }));
    return {
      success: true,
      mode: "built_in",
      result: {
        meetingTitle: args?.meetingTitle,
        actionItems,
        reviewRequired: true,
      },
    };
  }

  const custom = await ctx.db
    .query("aiLogicFunctions")
    .withIndex("by_society_name", (q: any) => q.eq("societyId", societyId).eq("name", key))
    .first()
    .catch(() => null);
  if (!custom) {
    return {
      success: true,
      mode: "manual",
      result: `Prepared ${tool.label} draft output. No custom function binding was found.`,
      arguments: args,
    };
  }
  if (custom.implementationKind === "workflow") {
    return {
      success: true,
      mode: "workflow",
      workflowId: custom.workflowId,
      result: "Workflow-backed logic function prepared. Run handoff is available for the workflow engine.",
      arguments: args,
    };
  }
  if (custom.implementationKind === "webhook") {
    return {
      success: true,
      mode: "webhook",
      webhookUrlConfigured: Boolean(custom.webhookUrl),
      result: "Webhook-backed logic function call was audited. Webhook dispatch should run from the action runtime.",
      arguments: args,
    };
  }
  return {
    success: true,
    mode: custom.implementationKind ?? "manual",
    result: custom.manualInstructions ?? `Manual function ${custom.label} queued for operator review.`,
    arguments: args,
  };
}

function sanitizeRecord(table: string, row: any, role: string) {
  if (!row || typeof row !== "object") return row;
  const allowlist = SAFE_FIELD_ALLOWLIST[table] ?? [];
  const out: Record<string, any> = {
    _id: row._id,
    _table: table,
  };
  for (const key of allowlist) {
    if (row[key] !== undefined && isFieldReadable(role, table, key)) out[key] = row[key];
  }
  if (!allowlist.length) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("_") || SENSITIVE_FIELD_RE.test(key)) continue;
      if (isFieldReadable(role, table, key)) out[key] = value;
    }
  }
  return out;
}

function isFieldReadable(role: string, _table: string, field: string) {
  if (SENSITIVE_FIELD_RE.test(field) && role !== "Admin") return false;
  return true;
}

function recordReferenceFor(table: string, row: any) {
  if (!row?._id) return null;
  const label =
    row.title ??
    row.name ??
    row.displayName ??
    [row.firstName, row.lastName].filter(Boolean).join(" ") ??
    row.kind ??
    String(row._id);
  return {
    table,
    id: String(row._id),
    label: String(label || row._id),
    href: routeForSection(table),
  };
}

function normalizeSkillName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAppName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function routeForSection(section: string | undefined) {
  const key = (section ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const map: Record<string, string> = {
    members: "/app/members",
    directors: "/app/directors",
    meetings: "/app/meetings",
    minutes: "/app/minutes",
    filings: "/app/filings",
    documents: "/app/documents",
    policies: "/app/policies",
    tasks: "/app/tasks",
    grants: "/app/grants",
    workflows: "/app/workflows",
    "ai-agents": "/app/ai-agents",
  };
  return map[key] ?? "/app";
}

async function insertAgentAudit(ctx: any, args: any) {
  await ctx.db.insert("aiAgentAuditEvents", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

function deterministicOutput({
  agent,
  input,
  loadedSkills,
  availableTools,
  unavailableTools,
  browsingContext,
}: {
  agent: AgentDefinition;
  input: string;
  loadedSkills: SkillDefinition[];
  availableTools: ToolDefinition[];
  unavailableTools: string[];
  browsingContext?: unknown;
}): string {
  const subject = input.trim() || "No input supplied";
  const lines = [
    `${agent.name} guidance`,
    "",
    `Scope: ${agent.scope}`,
    `Model: ${agent.modelId}`,
    `Request: ${subject}`,
    "",
    "Plan -> Skill -> Learn -> Execute",
    `1. Plan: ${agent.guidanceTemplate}`,
    `2. Load skills: ${loadedSkills.map((skill) => skill.name).join(", ") || "none available"}.`,
    `3. Learn tools: ${availableTools.map((tool) => tool.name).join(", ") || "none available"}.`,
    "4. Execute: run only the learned, permissioned tools and return draft guidance for human approval.",
  ];
  if (unavailableTools.length) {
    lines.push("", `Permission-filtered tools: ${unavailableTools.join(", ")}.`);
  }
  if (browsingContext) {
    lines.push("", `Browsing context supplied: ${JSON.stringify(browsingContext).slice(0, 500)}.`);
  }
  if (agent.workflowModes?.length) {
    lines.push("", "Supported workflow modes:", ...agent.workflowModes.map((mode) => `- ${mode}`));
  }
  if (agent.outputContract?.length) {
    lines.push("", "Expected output contract:", ...agent.outputContract.map((field) => `- ${field}`));
  }
  lines.push(
    "",
    `Required input hints checked: ${agent.requiredInputHints.join("; ")}.`,
    "Provider status: no live streaming model is wired here yet; this run exercised the skill router, tool catalog, permission filtering, and audit trail.",
  );
  return lines.join("\n");
}
