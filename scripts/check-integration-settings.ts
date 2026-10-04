import assert from "node:assert/strict";
import { defaultIntegrationSettings, sharePointReadiness, validateIntegrationSettings } from "../shared/integrationSettings";
import { updateIntegrationSettingsPortable } from "../shared/functions/society";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx, PortablePrincipal } from "../shared/portable/ctx";
import { forecastR2Cost } from "../shared/storage/costForecast";
import { StaticConvexClient } from "../src/lib/staticConvex";

const settings = { ...defaultIntegrationSettings(), preferredProvider: "sharepoint" as const, authorizationMode: "application" as const,
  tenantId: "tenant-canada", siteId: "selected-site", libraryId: "selected-library", consentStatus: "recorded" as const,
  resourceGrantStatus: "recorded" as const, permissionEvidence: "Audit evidence 45", offboardingPlan: "Export originals and version history before revocation" };
assert.deepEqual(validateIntegrationSettings(settings), settings);
assert.deepEqual(sharePointReadiness(settings), ["Graph access token has not been checked", "SharePoint deployment integration is not configured"]);
assert.throws(() => validateIntegrationSettings({ ...settings, tenantId: "" }), /tenant/);
assert.throws(() => validateIntegrationSettings({ ...settings, libraryId: "" }), /site and library/);
assert.throws(() => validateIntegrationSettings({ ...settings, clientSecret: "secret" }), /unsupported fields/);
assert.throws(() => validateIntegrationSettings({ ...settings, permissionEvidence: "Bearer abcdefghijklmnopqrstuvwxyz" }), /credentials/);
assert.throws(() => validateIntegrationSettings({ ...settings, offboardingPlan: "access_token=abcd" }), /credentials/);
assert.throws(() => validateIntegrationSettings({ ...settings, preferredProvider: "clerk" }), /supported storage/);
assert.throws(() => validateIntegrationSettings({ ...settings, canadianResidencyRequired: "yes" }), /boolean/);
assert.equal(validateIntegrationSettings({ ...settings, custodianContact: " Contact " }).custodianContact, "Contact");

const db = new MemoryDb({ seed: {
  societies: [{ _id: "society-a", name: "A" }, { _id: "society-b", name: "B" }],
  users: [{ _id: "owner-a", societyId: "society-a", role: "Owner", status: "Active", authSubject: "owner-a", authIssuer: "https://issuer.test" },
    { _id: "admin-a", societyId: "society-a", role: "Admin", status: "Active", authSubject: "admin-a", authIssuer: "https://issuer.test" },
    { _id: "disabled-a", societyId: "society-a", role: "Owner", status: "Disabled", authSubject: "disabled-a", authIssuer: "https://issuer.test" }],
} });
const principal = (userId: string): PortablePrincipal => ({ kind: "user", runtime: "test", assurance: "verified-jwt", subject: userId, issuer: "https://issuer.test", userId, societyId: "society-a" });
const context = (actor: PortablePrincipal): PortableMutationCtx => ({ db, principal: actor, capabilities: makeCapabilities({}), runQuery: async () => { throw new Error("Unused"); }, runMutation: async () => { throw new Error("Unused"); } });
await updateIntegrationSettingsPortable(context(principal("owner-a")), { societyId: "society-a", integrationSettings: settings });
assert.deepEqual((await db.get("society-a"))?.integrationSettings, settings);
await assert.rejects(updateIntegrationSettingsPortable(context(principal("admin-a")), { societyId: "society-a", integrationSettings: defaultIntegrationSettings() }), /Permission/);
await assert.rejects(updateIntegrationSettingsPortable(context(principal("disabled-a")), { societyId: "society-a", integrationSettings: settings }), /disabled/);
await assert.rejects(updateIntegrationSettingsPortable(context(principal("owner-a")), { societyId: "society-b", integrationSettings: settings }), /membership/);
await assert.rejects(updateIntegrationSettingsPortable(context({ kind: "service", runtime: "test", assurance: "trusted-internal", subject: "service", societyId: "society-a", actorUserId: "owner-a", scopes: ["documents:write"] }), { societyId: "society-a", integrationSettings: settings }), /Service scope/);
assert.deepEqual((await db.get("society-a"))?.integrationSettings, settings);
assert.equal((await db.get("society-b"))?.integrationSettings, undefined);

// Exercise the real offline dispatch registry and preserve immutable document references.
const client = new StaticConvexClient({ databaseName: `integration-policy-${Date.now()}`, seed: {
  societies: [{ _id: "society-offline", name: "Offline" }], users: [{ _id: "owner-offline", societyId: "society-offline", role: "Owner", status: "Active" }],
  documentVersions: [{ _id: "version-offline", societyId: "society-offline", documentId: "document-offline", storageProvider: "rustfs", storageKey: "old-object", contentHash: "original-hash" }],
} });
await client.mutation("society:updateIntegrationSettings", { societyId: "society-offline", integrationSettings: settings });
const saved = await client.query("society:getById", { id: "society-offline" });
assert.deepEqual(saved.integrationSettings, settings);
await assert.rejects(client.mutation("society:updateIntegrationSettings", { societyId: "society-offline", integrationSettings: { ...settings, secret: "leak" } }), /unsupported fields/);
const unchanged = await client.query("society:getById", { id: "society-offline" });
assert.deepEqual(unchanged.integrationSettings, settings);
const version = client.exportLocalWorkspaceSnapshot().tables.documentVersions?.[0];
assert.equal(version?.storageProvider, "rustfs");
assert.equal(version?.storageKey, "old-object");
assert.equal(version?.contentHash, "original-hash");
console.log("OK integration settings: administrator policy, tenant boundaries, secret rejection, blocked readiness and offline persistence");

const forecast = { storageClass: "standard" as const, gbMonths: 10, classAOperations: 1_000_000, classBOperations: 10_000_000, retrievalGb: 0,
  remainingFreeGbMonths: 10, remainingFreeClassAOperations: 1_000_000, remainingFreeClassBOperations: 10_000_000, additionalMonthlyUsd: 0 };
assert.equal(forecastR2Cost(forecast).totalUsd, 0);
assert.equal(forecastR2Cost({ ...forecast, classAOperations: 1_000_001 }).classAUsd, 4.5);
assert.equal(forecastR2Cost({ ...forecast, gbMonths: 10.01 }).storageUnits, 1);
assert.equal(forecastR2Cost({ ...forecast, storageClass: "infrequent" }).classAUsd, 9);
assert.equal(forecastR2Cost({ ...forecast, storageClass: "infrequent" }).classBUsd, 9);
assert.equal(forecastR2Cost({ ...forecast, storageClass: "infrequent", retrievalGb: 0.01 }).retrievalUsd, 0.01);
assert.throws(() => forecastR2Cost({ ...forecast, gbMonths: Infinity }), /finite/);
console.log("OK cost forecast: shared allowances, whole-unit rounding and IA retrieval");
