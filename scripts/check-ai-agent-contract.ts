import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";

const client = new StaticConvexClient();
const [society] = await client.query("society:list", {});
assert.ok(society?._id, "static society is available");

const context = await client.query("aiAgents:getChatContext", {
  societyId: society._id,
  browsingContext: { route: "/app/ai-agents" },
});
assert.match(context.systemPrompt, /Plan -> Skill -> Learn -> Execute/);

const loaded = await client.query("aiAgents:loadSkills", {
  societyId: society._id,
  skillNames: ["compliance-review", "data-table-access"],
});
assert.deepEqual(
  loaded.skills.map((skill: any) => skill.name),
  ["compliance-review", "data-table-access"],
);

const learned = await client.query("aiAgents:learnTools", {
  societyId: society._id,
  toolNames: ["find_members", "draft_task"],
});
assert.deepEqual(
  learned.tools.map((tool: any) => tool.name),
  ["find_members", "draft_task"],
);

const draftResult = await client.mutation("aiAgents:executeTool", {
  societyId: society._id,
  toolName: "draft_task",
  arguments: {
    title: "Review AI draft approval flow",
    priority: "High",
    tags: ["ai", "approval"],
  },
});
assert.ok(draftResult.draftId, "draft_task creates a pending draft");

const drafts = await client.query("aiAgents:listToolDrafts", {
  societyId: society._id,
});
assert.equal(drafts[0]._id, draftResult.draftId);

const approval = await client.mutation("aiAgents:approveToolDraft", {
  societyId: society._id,
  id: draftResult.draftId,
});
assert.equal(approval.status, "executed");
assert.ok(approval.taskId, "approved draft creates a task");

const openRouterCatalog = await client.action("aiSettingsActions:listProviderModels", {
  societyId: society._id,
  provider: "openrouter",
});
assert.ok(openRouterCatalog.models.some((model: any) => model.id.startsWith("openai/")), "OpenRouter catalog exposes provider-prefixed model ids");
assert.ok(openRouterCatalog.categories.tools.length > 0, "OpenRouter catalog groups tool-capable models");

const run = await client.mutation("aiAgents:runAgent", {
  societyId: society._id,
  agentKey: "compliance_analyst",
  input: "Review this workflow variable set.",
});
assert.ok(run.runId, "agent run is logged");
assert.ok(run.learnedTools.some((tool: any) => tool.name === "draft_task"));

console.log("AI agent contract ok: skills, tool learning, OpenRouter model catalog, draft approval, and agent audit path.");
