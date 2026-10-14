/**
 * Record-table "Ask AI" server action (convex/aiFilterActions.ts) against a
 * stubbed provider (globalThis.fetch; no network). Proves the request carries
 * the column schema only — no rows, no workspace context, no chat thread —
 * that replies are validated against that schema, and that permissions,
 * the workspace provider switch and the rate limit hold.
 * Run: npm run test:ai-filter-action
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { AI_FILTER_LIMITS } from "../shared/nlFilterAi";

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./aiFilterActions.js": () => import("../convex/aiFilterActions"),
  "./aiFilter.js": () => import("../convex/aiFilter"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
  "./objectMetadata.js": () => import("../convex/objectMetadata"),
  "./secrets.js": () => import("../convex/secrets"),
});

const issuer = "https://ai-filter.test";
const PROVIDER_URL = "https://ai-filter.fixture.test/v1";
const SECRET_ROW_TEXT = "Zebediah Quuxworth";
const now = new Date().toISOString();

const fixture = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Filter society", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
    await ctx.db.insert("users", { societyId, email: `${role}@ai-filter.test`, displayName: role, role, status: "Active", authIssuer: issuer, authSubject: role, createdAtISO: now });
  }
  await ctx.db.insert("users", { societyId: foreignSocietyId, email: "foreign@ai-filter.test", displayName: "Foreign", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "foreign", createdAtISO: now });
  for (const id of [societyId, foreignSocietyId]) {
    await ctx.db.insert("objectMetadata", { societyId: id, nameSingular: "member", namePlural: "members", labelSingular: "Member", labelPlural: "Members", isSystem: true, isActive: true, createdAtISO: now, updatedAtISO: now });
  }
  // A real row the action must never read or send.
  await ctx.db.insert("members", { societyId, firstName: "Zebediah", lastName: "Quuxworth", email: "zeb@private.test", status: "Active", membershipClass: "Regular", joinedAt: "2026-02-01", votingRights: true } as any);
  const settingId = await ctx.db.insert("aiProviderSettings", {
    societyId, scope: "workspace", provider: "openai-compatible", label: "Fixture provider", status: "active",
    modelId: "fixture-model", baseUrl: PROVIDER_URL, createdAtISO: now, updatedAtISO: now,
  });
  return { societyId, foreignSocietyId, settingId };
});

const fields = [
  { id: "firstName", label: "First name", type: "TEXT", operators: ["contains", "eq", "neq", "startsWith", "endsWith", "isEmpty", "isNotEmpty", "notContains"] },
  { id: "status", label: "Status", type: "SELECT", operators: ["eq", "neq", "in", "notIn", "isEmpty", "isNotEmpty"], options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
  { id: "joinedAt", label: "Joined", type: "DATE", operators: ["between", "eq", "neq", "gt", "lt", "isEmpty", "isNotEmpty"] },
  { id: "duesCents", label: "Dues", type: "CURRENCY", operators: ["gte", "lte", "gt", "lt", "eq", "neq"], isCents: true },
];
const baseArgs = () => ({ societyId: fixture.societyId, objectNameSingular: "member", fields, today: "2026-10-14", fiscalYearEnd: "03-31", query: "active members who joined this year paying over $50" });

type Captured = { url: string; body: any; raw: string };
const captured: Captured[] = [];
let nextReply: { status?: number; content?: string } = {};
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const raw = typeof init?.body === "string" ? init.body : "";
  captured.push({ url, raw, body: raw ? JSON.parse(raw) : null });
  if (nextReply.status && nextReply.status >= 400) {
    return new Response(JSON.stringify({ error: { message: `Fixture provider failure echoing ${SECRET_ROW_TEXT}` } }), { status: nextReply.status, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({
    id: "chatcmpl-fixture", object: "chat.completion", created: 0, model: "fixture-model",
    choices: [{ index: 0, message: { role: "assistant", content: nextReply.content ?? "{}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const envKeys = ["AUTH_MODE", "VITE_AUTH_MODE", "BETTER_AUTH_BASE_URL", "CLERK_JWT_ISSUER_DOMAIN", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "SOCIETYER_AI_MODEL"];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const actor = (subject: string) => test.withIdentity({ issuer, subject });
const suggest = (subject: string, args: Record<string, unknown> = baseArgs()) => actor(subject).action((api as any).aiFilterActions.suggestRecordFilter, args);
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  checks += 1;
  try {
    await run();
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

try {
  process.env.AUTH_MODE = "clerk";
  process.env.VITE_AUTH_MODE = "clerk";
  process.env.BETTER_AUTH_BASE_URL = "https://other.test";
  process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SOCIETYER_AI_MODEL;

  await check("valid reply: schema-only request, validated filter, no chat thread", async () => {
    captured.length = 0;
    nextReply = {
      content: "```json\n" + JSON.stringify({
        operator: "and",
        conditions: [
          { field: "status", operator: "eq", value: "active" },
          { field: "joinedAt", operator: "between", value: { preset: "yearToDate" } },
          { field: "duesCents", operator: "gt", value: 50 },
          { field: "salary", operator: "gt", value: 1 },
          { field: "firstName", operator: "between", value: { preset: "today" } },
        ],
        unmatched: ["paying"],
      }) + "\n```",
    };
    const result = await suggest("Owner");
    assert.equal(result.ok, true);
    assert.deepEqual(result.filter, {
      operator: "and",
      conditions: [
        { field: "status", operator: "eq", value: "Active" },
        { field: "joinedAt", operator: "between", value: { preset: "yearToDate" } },
        { field: "duesCents", operator: "gt", value: 5000 },
      ],
      groups: [],
    });
    assert.equal(result.droppedCount, 2, "unknown field and wrong operator are dropped, counted");
    assert.deepEqual(result.unmatched, ["paying"]);
    assert.match(result.notes[0], /Left out 2/);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, `${PROVIDER_URL}/chat/completions`);
    assert.equal(captured[0].body.model, "fixture-model");
    assert.equal(captured[0].body.tools, undefined, "no tools are offered to the model");
    const messages = captured[0].body.messages;
    assert.deepEqual(messages.map((message: any) => message.role), ["system", "user"], "one system prompt and one request; no history");
    const payload = JSON.parse(typeof messages[1].content === "string" ? messages[1].content : messages[1].content[0].text);
    assert.deepEqual(Object.keys(payload).sort(), ["datePresets", "fields", "fiscalYearEnd", "request", "today"]);
    assert.equal(payload.today, "2026-10-14");
    assert.equal(payload.fiscalYearEnd, "03-31");
    for (const field of payload.fields) {
      assert.ok(Object.keys(field).every((key) => ["id", "label", "type", "operators", "options", "unit"].includes(key)), `schema keys only: ${Object.keys(field)}`);
    }
    for (const forbidden of [SECRET_ROW_TEXT, "Zebediah", "zeb@private.test", "Filter society", String(fixture.societyId), "records", "rows"]) {
      assert.ok(!captured[0].raw.includes(forbidden), `provider request must not contain ${forbidden}`);
    }
    await test.run(async (ctx) => {
      assert.equal((await ctx.db.query("aiChatThreads").collect()).length, 0, "no chat thread");
      assert.equal((await ctx.db.query("aiMessages").collect()).length, 0, "no chat messages");
      const events = await ctx.db.query("aiAgentAuditEvents").collect();
      assert.equal(events.length, 1);
      assert.equal(events[0].agentKey, "record_filter");
      assert.equal(events[0].eventType, "run_completed");
      assert.equal(events[0].metadata.outcome, "ok");
      assert.equal(events[0].metadata.inputTokens, 120);
      assert.equal(events[0].metadata.conditionCount, 3);
      assert.ok(!JSON.stringify(events[0]).includes("joined this year"), "usage log never stores the request text");
    });
  });

  await check("extra keys (row data) in the schema are refused by the argument validator", async () => {
    captured.length = 0;
    await assert.rejects(() => suggest("Owner", { ...baseArgs(), fields: [{ ...fields[0], sampleValues: [SECRET_ROW_TEXT] }] }), /(Unexpected|extra) field `sampleValues`/);
    await assert.rejects(() => suggest("Owner", { ...baseArgs(), rows: [{ firstName: SECRET_ROW_TEXT }] }), /(Unexpected|extra) field `rows`/);
    assert.equal(captured.length, 0);
  });

  await check("invalid JSON reply is a typed error", async () => {
    nextReply = { content: "I'm sorry, I can't help with that." };
    const result = await suggest("Admin");
    assert.deepEqual(result, { ok: false, error: "invalid_json", message: "The AI reply wasn't a filter. Try rephrasing the request." });
  });

  await check("a reply with nothing that fits returns an empty filter, all counted", async () => {
    nextReply = { content: JSON.stringify({ conditions: [{ field: "ssn", operator: "eq", value: "1" }, { field: "status", operator: "eq", value: "Platinum" }] }) };
    const result = await suggest("Admin");
    assert.equal(result.ok, true);
    assert.equal(result.filter, null);
    assert.equal(result.droppedCount, 2);
  });

  await check("provider failure is a typed error that does not echo the provider message", async () => {
    nextReply = { status: 500 };
    const result = await suggest("Admin");
    assert.equal(result.ok, false);
    assert.equal(result.error, "provider_error");
    assert.ok(!result.message.includes(SECRET_ROW_TEXT));
    const failed = await test.run(async (ctx) => (await ctx.db.query("aiAgentAuditEvents").collect()).filter((event: any) => event.metadata?.outcome === "provider_error"));
    assert.equal(failed.length, 1);
    nextReply = {};
  });

  await check("invalid requests are refused before the provider is contacted", async () => {
    captured.length = 0;
    for (const args of [
      { ...baseArgs(), query: "   " },
      { ...baseArgs(), query: "x".repeat(AI_FILTER_LIMITS.query + 1) },
      { ...baseArgs(), today: "today" },
      { ...baseArgs(), fields: [{ id: "x", label: "X", type: "TEXT", operators: ["explode"] }] },
    ]) {
      const result = await suggest("Owner", args);
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_request");
    }
    await assert.rejects(() => suggest("Owner", { ...baseArgs(), objectNameSingular: "nonexistentTable" }), /not found/i);
    assert.equal(captured.length, 0);
  });

  await check("Director, Member, Viewer, foreign and anonymous callers are denied before the provider", async () => {
    captured.length = 0;
    for (const subject of ["Director", "Member", "Viewer"]) {
      await assert.rejects(() => suggest(subject), /Permission tasks:write required/, subject);
    }
    await assert.rejects(() => suggest("foreign"), /membership|permission/i);
    await assert.rejects(() => suggest("Owner", { ...baseArgs(), societyId: fixture.foreignSocietyId }), /membership|permission/i);
    await assert.rejects(() => test.action((api as any).aiFilterActions.suggestRecordFilter, baseArgs()), /authentication/i);
    assert.equal(captured.length, 0, "denied callers never reach the provider");
  });

  await check("no workspace provider: typed error, even with an environment key", async () => {
    captured.length = 0;
    await test.run(async (ctx) => ctx.db.patch(fixture.settingId, { status: "inactive" }));
    assert.deepEqual(await suggest("Owner"), { ok: false, error: "no_provider", message: "No AI provider is set up for this workspace." });
    await test.run(async (ctx) => ctx.db.patch(fixture.settingId, { status: "active", scope: "personal" }));
    assert.equal((await suggest("Owner")).error, "no_provider", "a personal key is not the workspace provider");
    await test.run(async (ctx) => ctx.db.patch(fixture.settingId, { scope: "workspace" }));
    delete process.env.OPENAI_API_KEY;
    assert.equal((await suggest("Owner")).error, "no_provider", "a workspace setting with no key anywhere is not usable");
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    assert.equal(captured.length, 0);
  });

  await check("rate limit per person per minute", async () => {
    nextReply = { content: JSON.stringify({ conditions: [{ field: "status", operator: "eq", value: "Active" }] }) };
    let limited: any = null;
    for (let index = 0; index < 20 && !limited; index++) {
      const result = await suggest("Owner");
      if (!result.ok && result.error === "rate_limited") limited = result;
    }
    assert.ok(limited, "the limit engages");
    assert.equal((await suggest("Admin")).ok, true, "another person is not limited");
  });

  console.log(`ai-filter-action: ${checks} checks passed (schema-only payload, validation, typed errors, permissions, provider switch, rate limit)`);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}
