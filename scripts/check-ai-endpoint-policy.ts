/**
 * Where AI requests may go.
 *
 * Hosted / self-hosted server: a workspace-saved "OpenAI-compatible" address
 * is fetched by the server, so loopback, private, link-local, metadata and
 * internal hosts are refused (shared outbound URL policy), redirects are
 * refused, provider error bodies are never echoed, a saved key is only sent
 * to its own provider's address, and the deployment's environment key is
 * never sent to a workspace-chosen address.
 *
 * On device: loopback and LAN servers are accepted (Ollama, LM Studio,
 * llama.cpp); public servers need HTTPS. The device settings and key never
 * appear in a workspace export, and on-device chat turns are saved through the
 * portable aiChat:appendDeviceMessage with thread-author checks.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { checkDeviceAiBaseUrl, checkHostedAiBaseUrl, isLoopbackUrl } from "../shared/ai/endpointPolicy";
import { aiProviderErrorMessage, aiProviderStatusMessage } from "../shared/ai/providerErrors";
import { HOSTED_AI_ADDRESS_REJECTED, hostedAiFetch, isHostedAiUrlAllowed } from "../convex/lib/aiEndpointPolicy";
import { resolveAiRuntimeConfig } from "../convex/aiChatActions";
import { localAiBaseUrlProblem } from "../electron/localAiProxy";
import { MemoryDb, PortableRuntime, makeCapabilities, type PortablePrincipal } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { DEVICE_AI_CONFIG_KEY, parseDeviceAiConfig, saveDeviceAiConfig, storeDeviceAiKey } from "../src/lib/localAi/config";
import { PROVIDER_SECRET_MARKER } from "./fixtures/mock-openai-server";

// ---- 1. Hosted address policy ------------------------------------------------
const blocked = [
  "http://api.example.com/v1",
  "https://127.0.0.1:11434/v1",
  "https://127.8.9.10/v1",
  "https://10.1.2.3/v1",
  "https://172.16.0.5/v1",
  "https://172.31.255.1/v1",
  "https://192.168.1.10/v1",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/v1",
  "https://[fc00::1]/v1",
  "https://[fd12:3456::1]/v1",
  "https://localhost/v1",
  "https://ollama.localhost/v1",
  "https://metadata.google.internal/computeMetadata/v1",
  "https://llm/v1",
  "https://user:pw@api.example.com/v1",
];
for (const url of blocked) {
  assert.equal(checkHostedAiBaseUrl(url).ok, false, `hosted refuses ${url}`);
  assert.equal(isHostedAiUrlAllowed(url, "test"), false, `Convex policy refuses ${url}`);
}
for (const url of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1", "https://llm.example.com/v1"]) {
  assert.equal(checkHostedAiBaseUrl(url).ok, true, `hosted accepts ${url}`);
  assert.equal(isHostedAiUrlAllowed(url, "test"), true);
}

// The policy fetch refuses before connecting and never follows redirects.
const realFetch = globalThis.fetch;
const fetched: Array<{ url: string; redirect?: RequestRedirect; authorization?: string | null }> = [];
let replyStatus = 200;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push({ url, redirect: init?.redirect, authorization: new Headers(init?.headers).get("authorization") });
  return Response.json(replyStatus === 200 ? { data: [{ id: "m" }] } : { error: { message: `secret detail ${PROVIDER_SECRET_MARKER}` } }, { status: replyStatus });
};
try {
  const guarded = hostedAiFetch("test");
  await assert.rejects(() => guarded("https://169.254.169.254/v1/models"), /private or reserved/);
  assert.equal(fetched.length, 0, "a refused address is never contacted");
  await guarded("https://llm.example.com/v1/models");
  assert.equal(fetched.at(-1)?.redirect, "error", "redirects are refused (they could point a key at a private host)");

  // ---- 2. Provider errors map to plain messages ------------------------------
  assert.equal(aiProviderStatusMessage(401), "The AI provider rejected the API key.");
  assert.doesNotMatch(aiProviderErrorMessage(Object.assign(new Error(`Incorrect API key ${PROVIDER_SECRET_MARKER}`), { statusCode: 401 })), new RegExp(PROVIDER_SECRET_MARKER));
  assert.equal(aiProviderErrorMessage(new TypeError(`fetch failed ${PROVIDER_SECRET_MARKER}`)), "Could not reach the AI provider.");
  assert.equal(aiProviderErrorMessage({ name: "AI_RetryError", lastError: { statusCode: 429 } }), aiProviderStatusMessage(429));

  // ---- 3. Hosted actions: validate / list models ------------------------------
  const issuer = "https://endpoint-policy.test";
  process.env.AUTH_MODE = "better-auth";
  process.env.VITE_AUTH_MODE = "better-auth";
  process.env.BETTER_AUTH_BASE_URL = issuer;
  const test = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./authorization.js": () => import("../convex/authorization"),
    "./aiSettingsActions.js": () => import("../convex/aiSettingsActions"),
    "./aiSettings.js": () => import("../convex/aiSettings"),
    "./secrets.js": () => import("../convex/secrets"),
  });
  const societyId = await test.run(async (ctx) => {
    const id = await ctx.db.insert("societies", { name: "Endpoint policy", isCharity: false, isMemberFunded: false, updatedAt: 0 });
    await ctx.db.insert("users", { societyId: id, email: "owner@endpoint.test", displayName: "Owner", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "owner", createdAtISO: new Date().toISOString() });
    return id;
  });
  const owner = test.withIdentity({ issuer, subject: "owner" });

  fetched.length = 0;
  const privateResult = await owner.action(api.aiSettingsActions.validateProviderKey, { societyId, provider: "openai-compatible", apiKey: "k", baseUrl: "http://192.168.1.50:11434/v1" });
  assert.equal(privateResult.ok, false);
  assert.equal(privateResult.message, HOSTED_AI_ADDRESS_REJECTED);
  assert.equal(fetched.length, 0, "a private address is refused before any request");

  replyStatus = 401;
  const rejected = await owner.action(api.aiSettingsActions.validateProviderKey, { societyId, provider: "openai-compatible", apiKey: "k", baseUrl: "https://llm.example.com/v1" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.message, "The AI provider rejected the API key.");
  assert.doesNotMatch(JSON.stringify(rejected), new RegExp(PROVIDER_SECRET_MARKER), "provider bodies are not echoed");
  replyStatus = 200;

  // A saved key is only ever sent to the saved provider's address.
  const secretVaultItemId = await owner.mutation(api.secrets.create, { societyId, name: "AI key", service: "OpenAI-compatible", credentialType: "api_key", secretValue: "saved-workspace-key", custodianPersonName: "Owner" });
  await owner.mutation(api.aiSettings.upsert, { societyId, scope: "workspace", provider: "openai-compatible", label: "Saved", modelId: "m", baseUrl: "https://saved.example.com/v1", secretVaultItemId, validationStatus: "ok" });
  fetched.length = 0;
  await owner.action(api.aiSettingsActions.listProviderModels, { societyId, provider: "openai-compatible", baseUrl: "https://attacker.example.com/v1", forceRefresh: true });
  assert.ok(fetched.every((call) => call.authorization !== "Bearer saved-workspace-key"), "the saved key never goes to another address");
  await owner.action(api.aiSettingsActions.listProviderModels, { societyId, provider: "openai-compatible", baseUrl: "https://saved.example.com/v1", forceRefresh: true });
  assert.equal(fetched.at(-1)?.authorization, "Bearer saved-workspace-key", "the saved key is used for its own address");
  const privateList = await owner.action(api.aiSettingsActions.listProviderModels, { societyId, provider: "openai-compatible", baseUrl: "http://10.0.0.8/v1", forceRefresh: true });
  assert.equal(privateList.message, HOSTED_AI_ADDRESS_REJECTED);

  // ---- 4. Chat runtime config -------------------------------------------------
  process.env.OPENAI_API_KEY = "deployment-env-key";
  const fakeCtx = (effective: Record<string, unknown> | null, secret: string | null) => ({
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => ("id" in args ? (secret ? { value: secret } : null) : { effective }),
  });
  const blockedConfig = await resolveAiRuntimeConfig(fakeCtx({ provider: "openai-compatible", baseUrl: "http://169.254.169.254/v1", secretVaultItemId: "s", scope: "workspace" }, "saved"), "society", undefined);
  assert.equal(blockedConfig.model, null, "a metadata address gets no model");
  assert.equal(blockedConfig.configuredFrom, "blocked_address");
  const envOnly = await resolveAiRuntimeConfig(fakeCtx({ provider: "openai-compatible", baseUrl: "https://attacker.example.com/v1", scope: "workspace" }, null), "society", undefined);
  assert.equal(envOnly.model, null, "the deployment key is never sent to a workspace-chosen address");
  const envDefault = await resolveAiRuntimeConfig(fakeCtx(null, null), "society", undefined);
  assert.ok(envDefault.model, "the deployment key still serves the default provider");
  delete process.env.OPENAI_API_KEY;
} finally {
  globalThis.fetch = realFetch;
}

// ---- 5. On device: loopback and LAN servers are fine -------------------------
for (const url of ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://[::1]:8080/v1", "http://192.168.1.20:11434/v1", "http://mac-mini.local:1234/v1", "https://llm.example.com/v1"]) {
  assert.ok(checkDeviceAiBaseUrl(url).ok, `device accepts ${url}`);
  assert.equal(localAiBaseUrlProblem(url), null, `desktop proxy accepts ${url}`);
}
for (const url of ["http://llm.example.com/v1", "ftp://127.0.0.1/v1", "http://user:pw@127.0.0.1/v1"]) {
  assert.equal(checkDeviceAiBaseUrl(url).ok, false, `device refuses ${url}`);
  assert.notEqual(localAiBaseUrlProblem(url), null, `desktop proxy refuses ${url}`);
}
assert.equal(isLoopbackUrl("http://127.0.0.1:11434/v1"), true);
assert.equal(isLoopbackUrl("http://192.168.1.20/v1"), false);

// ---- 6. Device settings never reach the workspace or its export ---------------
class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();
Object.assign(globalThis, { window: { localStorage, sessionStorage } });
const DEVICE_URL = "http://127.0.0.1:11434/v1";
const DEVICE_KEY = "sk-device-only-7d1e";
await saveDeviceAiConfig(parseDeviceAiConfig({ kind: "ollama", baseUrl: DEVICE_URL, model: "llama3.1:8b" }));
await storeDeviceAiKey(DEVICE_KEY);
assert.match(localStorage.getItem(DEVICE_AI_CONFIG_KEY) ?? "", /127\.0\.0\.1:11434/, "settings live in this browser's storage");
assert.doesNotMatch(localStorage.getItem(DEVICE_AI_CONFIG_KEY) ?? "", new RegExp(DEVICE_KEY), "the key is not stored with the settings");
await saveDeviceAiConfig(parseDeviceAiConfig({ kind: "openai-compatible", baseUrl: "http://192.168.1.20:8080/v1", model: "x" }));
assert.equal(sessionStorage.getItem("societyer:intake:llm-key"), null, "moving to another server forgets the key");
await saveDeviceAiConfig(parseDeviceAiConfig({ kind: "ollama", baseUrl: DEVICE_URL, model: "llama3.1:8b" }));
await storeDeviceAiKey(DEVICE_KEY);

const workspace = "device-export";
const seed = {
  ...portableTestSeed(workspace),
  users: [...portableTestSeed(workspace).users, { _id: "other", societyId: workspace, role: "Admin", status: "Active", authSubject: "other-subject", email: "other@example.test", displayName: "Other" }],
};
let principal: PortablePrincipal = portableTestPrincipal();
const runtime = new PortableRuntime({ db: new MemoryDb({ seed }), capabilities: makeCapabilities({}), principalProvider: () => principal }).registerAll(PORTABLE_FUNCTIONS);
assert.equal(actionPermission("aiChat:appendDeviceMessage", "mutation"), "tasks:write");
const threadId = String(await runtime.runMutation("aiChat:createThread", { societyId: workspace, title: "Budget question", modelId: "llama3.1:8b" }));
await runtime.runMutation("aiChat:appendDeviceMessage", { societyId: workspace, threadId, role: "user", content: "What is quorum?", modelId: "llama3.1:8b" });
await runtime.runMutation("aiChat:appendDeviceMessage", { societyId: workspace, threadId, role: "assistant", content: "Quorum is the minimum attendance.", modelId: "llama3.1:8b" });
const saved = await runtime.runQuery<Array<Record<string, unknown>>>("aiChat:messagesForThread", { threadId });
assert.deepEqual(saved.map((row) => [row.role, row.content, (row.parts as { provider?: string } | undefined)?.provider]), [
  ["user", "What is quorum?", "on_device"],
  ["assistant", "Quorum is the minimum attendance.", "on_device"],
]);
await assert.rejects(() => runtime.runMutation("aiChat:appendDeviceMessage", { societyId: workspace, threadId, role: "system", content: "x" }), /questions and answers/);
await assert.rejects(() => runtime.runMutation("aiChat:appendDeviceMessage", { societyId: workspace, threadId, role: "user", content: "   " }), /empty/);
principal = { ...portableTestPrincipal(), subject: "other-subject" };
await assert.rejects(() => runtime.runMutation("aiChat:appendDeviceMessage", { societyId: workspace, threadId, role: "assistant", content: "forged" }), /not available to this account/, "only the thread's author can write to it");
principal = portableTestPrincipal();

const tables = await runtime.runQuery<Array<{ name: string }>>("exports:listExportableTables", { societyId: workspace });
const exported: Record<string, unknown> = {};
for (const { name } of tables) exported[name] = await runtime.runQuery("exports:exportTable", { societyId: workspace, table: name });
const dump = JSON.stringify(exported);
assert.match(dump, /What is quorum\?/, "the export does include the saved conversation");
for (const secret of [DEVICE_URL, "127.0.0.1:11434", DEVICE_KEY, DEVICE_AI_CONFIG_KEY, "societyer:intake:llm-key"]) {
  assert.ok(!dump.includes(secret), `the workspace export never contains ${secret}`);
}
Reflect.deleteProperty(globalThis, "window");

console.log("AI endpoint policy passed: hosted refuses loopback/private/link-local/metadata/internal addresses and redirects, never echoes provider bodies or misdirects keys; on-device accepts loopback and LAN servers; device settings and key stay out of the workspace and its export.");
