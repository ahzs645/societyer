import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * AI agent / chat / provider tables (agent runs, audit events, skills, logic functions, chat threads, messages, tool drafts, provider settings, model cache), extracted from convex/schema.ts. Spread back into defineSchema; byte-identical.
 */
export const aiTables = {
  aiAgentRuns: defineTable({
    societyId: v.id("societies"),
    agentKey: v.string(),
    agentName: v.string(),
    status: v.string(), // planned | completed | failed
    input: v.string(),
    inputHints: v.array(v.string()),
    scope: v.string(),
    allowedActions: v.array(v.string()),
    allowedTools: v.array(v.string()),
    plannedToolCalls: v.array(
      v.object({
        toolName: v.string(),
        purpose: v.string(),
        status: v.string(), // planned | skipped | completed
      }),
    ),
    output: v.string(),
    provider: v.string(), // deterministic_stub | configured_llm
    createdAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    triggeredByUserId: v.optional(v.id("users")),
    loadedSkillNames: v.optional(v.array(v.string())),
    toolCatalogSnapshot: v.optional(v.any()),
    unavailableTools: v.optional(v.array(v.string())),
  })
    .index("by_society", ["societyId"])
    .index("by_society_agent", ["societyId", "agentKey"]),

  aiAgentAuditEvents: defineTable({
    societyId: v.id("societies"),
    runId: v.optional(v.id("aiAgentRuns")),
    agentKey: v.string(),
    eventType: v.string(), // run_requested | skill_loaded | tool_learned | tool_planned | run_completed | run_failed
    toolName: v.optional(v.string()),
    summary: v.string(),
    metadata: v.optional(v.any()),
    createdAtISO: v.string(),
    actorUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_society_agent", ["societyId", "agentKey"]),

  aiSkills: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    content: v.string(),
    isCustom: v.boolean(),
    isActive: v.boolean(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "name"]),

  aiLogicFunctions: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // active | inactive | draft
    inputSchema: v.optional(v.any()),
    toolTriggerSettings: v.optional(v.any()),
    implementationKind: v.string(), // built_in | webhook | workflow | manual
    workflowId: v.optional(v.id("workflows")),
    webhookUrl: v.optional(v.string()),
    manualInstructions: v.optional(v.string()),
    requiredPermission: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "name"]),

  aiChatThreads: defineTable({
    societyId: v.id("societies"),
    title: v.string(),
    status: v.string(), // active | archived
    modelId: v.optional(v.string()),
    browsingContext: v.optional(v.any()),
    workspaceInstructions: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    lastMessageAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  aiMessages: defineTable({
    societyId: v.id("societies"),
    threadId: v.id("aiChatThreads"),
    role: v.string(), // user | assistant | system | tool
    content: v.string(),
    status: v.string(), // complete | error | streaming
    modelId: v.optional(v.string()),
    parts: v.optional(v.any()),
    toolCalls: v.optional(v.any()),
    usage: v.optional(v.any()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
  })
    .index("by_thread", ["threadId"])
    .index("by_society", ["societyId"]),

  aiToolDrafts: defineTable({
    societyId: v.id("societies"),
    threadId: v.optional(v.id("aiChatThreads")),
    runId: v.optional(v.id("aiAgentRuns")),
    agentKey: v.optional(v.string()),
    toolName: v.string(),
    title: v.optional(v.string()),
    payload: v.any(),
    status: v.string(), // draft | approved | rejected | executed
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_thread", ["threadId"])
    .index("by_run", ["runId"]),

  aiProviderSettings: defineTable({
    societyId: v.id("societies"),
    scope: v.string(), // personal | workspace
    userId: v.optional(v.id("users")),
    provider: v.string(), // openai | openrouter | openai-compatible
    label: v.string(),
    status: v.string(), // active | inactive | needs_validation
    modelId: v.string(),
    baseUrl: v.optional(v.string()),
    secretVaultItemId: v.optional(v.id("secretVaultItems")),
    temperature: v.optional(v.number()),
    maxSteps: v.optional(v.number()),
    validatedAtISO: v.optional(v.string()),
    validationStatus: v.optional(v.string()),
    validationMessage: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scope"])
    .index("by_society_user", ["societyId", "userId"])
    .index("by_society_status", ["societyId", "status"]),

  aiModelCatalogCache: defineTable({
    provider: v.string(),
    cacheKey: v.string(),
    models: v.any(),
    fetchedAtISO: v.string(),
    expiresAtISO: v.string(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_provider_cache", ["provider", "cacheKey"])
    .index("by_provider", ["provider"]),
};
