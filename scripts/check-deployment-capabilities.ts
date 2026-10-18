/**
 * Optional services stay off until a deployment runs them: browser connectors
 * need SOCIETYER_BROWSER_CONNECTORS=1, n8n needs its webhook base and callback
 * secret, and neither exists with Convex-hosted sign-in (no gateway). Checks
 * the capability matrix, the module registry the UI reads, and the server
 * refusing n8n recipes it can't run.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { deploymentCapabilities } from "../shared/deploymentCapabilities";
import {
  isModuleEnabled, normalizeModuleSettings, setDeploymentUnavailableModules, settingsToDisabledModules,
  deploymentUnavailableReason,
} from "../src/lib/modules";
import { getModuleAccess } from "../src/lib/moduleAccess";

// 1. Which services each deployment shape offers.
const n8n = { N8N_WEBHOOK_BASE_URL: "https://n8n.example.org/webhook", SOCIETYER_WORKFLOW_CALLBACK_SECRET: "secret" };
assert.deepEqual(deploymentCapabilities({ AUTH_MODE: "better-auth" }), { gatewayApi: true, browserConnectors: false, n8nWorkflows: false, procurementReview: false }, "Off unless configured");
assert.equal(deploymentCapabilities({ AUTH_MODE: "clerk", SOCIETYER_BROWSER_CONNECTORS: "1" }).browserConnectors, true);
assert.equal(deploymentCapabilities({ AUTH_MODE: "clerk", SOCIETYER_BROWSER_CONNECTORS: "true" }).browserConnectors, false, "Only an explicit 1 enables the runner");
assert.equal(deploymentCapabilities({ AUTH_MODE: "none", ...n8n }).n8nWorkflows, true);
assert.equal(deploymentCapabilities({ AUTH_MODE: "better-auth", N8N_WEBHOOK_BASE_URL: n8n.N8N_WEBHOOK_BASE_URL }).n8nWorkflows, false, "n8n needs the callback secret too");
assert.deepEqual(deploymentCapabilities({ AUTH_MODE: "convex", SOCIETYER_BROWSER_CONNECTORS: "1", ...n8n }),
  { gatewayApi: false, browserConnectors: false, n8nWorkflows: false, procurementReview: false }, "Convex-hosted sign-in has no gateway, so neither service can work");

// 2. The UI's module checks hide an unavailable module without rewriting saved choices.
const workspace = { disabledModules: ["grants"] };
assert.equal(isModuleEnabled(workspace, "browserConnectors"), true);
setDeploymentUnavailableModules({ browserConnectors: "No connector runner here." });
assert.equal(isModuleEnabled(workspace, "browserConnectors"), false, "Unavailable reads as disabled");
assert.equal(isModuleEnabled(workspace, "grants"), false);
assert.equal(isModuleEnabled(workspace, "paperless"), true, "Other modules are unaffected");
assert.equal(normalizeModuleSettings(workspace).browserConnectors, true, "Saved choices stay as the workspace left them");
assert.deepEqual(settingsToDisabledModules(normalizeModuleSettings(workspace)), ["grants"], "Saving module settings never stores 'unavailable' as 'off'");
assert.equal(deploymentUnavailableReason("browserConnectors"), "No connector runner here.");
const accessRow = getModuleAccess("Owner", workspace).find((row) => row.key === "browserConnectors")!;
assert.equal(accessRow.enabled, false);
assert.ok(accessRow.notes.includes("No connector runner here."), "Module access explains why");
setDeploymentUnavailableModules({});
assert.equal(isModuleEnabled(workspace, "browserConnectors"), true, "Running the service brings the module back");

// 3. The server doesn't offer or create n8n workflows it can't run.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./authorization.js": () => import("../convex/authorization"),
  "./workflows.js": () => import("../convex/workflows"),
  "./http.js": () => import("../convex/http"),
} as any);
process.env.AUTH_MODE = "better-auth";
process.env.SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT = "1";
const issuer = betterAuthIssuer();
const societyId = await native.run(async (ctx) => {
  const id = await ctx.db.insert("societies", { name: "Capabilities", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert("users", { societyId: id, role: "Owner", displayName: "Owner", status: "Active", email: "owner@example.org", authIssuer: issuer, authSubject: "owner", createdAtISO: new Date().toISOString() });
  return id;
});
const owner = native.withIdentity({ issuer, subject: "owner" });
const n8nRecipes = (catalog: Array<{ provider: string }>) => catalog.filter((entry) => entry.provider === "n8n").length;

for (const key of ["N8N_WEBHOOK_BASE_URL", "SOCIETYER_WORKFLOW_CALLBACK_SECRET", "SOCIETYER_BROWSER_CONNECTORS"]) delete process.env[key];
assert.deepEqual(await native.query(api.http.deploymentCapabilities, {}), { gatewayApi: true, browserConnectors: false, n8nWorkflows: false, procurementReview: false }, "Anyone can read what the deployment runs");
const bare = await owner.query(api.workflows.listCatalog, {});
assert.equal(n8nRecipes(bare), 0, "n8n recipes aren't offered without n8n");
assert.ok(bare.length > 0, "Built-in recipes still are");
await assert.rejects(() => owner.mutation(api.workflows.create, { societyId, recipe: "agm_date_deadlines", name: "AGM deadlines", trigger: { kind: "manual" } }), /n8n workflows aren't set up/);
await assert.rejects(() => owner.mutation(api.workflows.setupGovernanceN8nRecipes, { societyId }), /n8n workflows aren't set up/);
await owner.mutation(api.workflows.create, { societyId, recipe: "insurance_renewal", name: "Insurance renewal", trigger: { kind: "manual" } });

Object.assign(process.env, n8n);
assert.ok(n8nRecipes(await owner.query(api.workflows.listCatalog, {})) > 0, "Configured n8n recipes are offered");
await owner.mutation(api.workflows.create, { societyId, recipe: "agm_date_deadlines", name: "AGM deadlines", trigger: { kind: "manual" } });

process.env.AUTH_MODE = "convex";
assert.equal((await native.query(api.http.deploymentCapabilities, {})).n8nWorkflows, false, "No gateway, no n8n callback");
for (const key of Object.keys(n8n)) delete process.env[key];

console.log("Deployment capability checks passed: off-by-default services, Convex-hosted sign-in, module registry without saved-setting changes, n8n recipe refusal.");
