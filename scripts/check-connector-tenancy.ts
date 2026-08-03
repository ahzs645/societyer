import assert from "node:assert/strict";
import { deriveProfileIdentity } from "../services/connector-runner/src/profileKeys.js";
import { TenantSessionStore } from "../services/connector-runner/src/tenantSessions.js";

const tenantA = "ct1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tenantB = "ct1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const sessionId = "91de1ce2-1eef-49ad-83f5-e6496759527e";

const profilesA = deriveProfileIdentity(tenantA, "wave", "shared-label");
const profilesB = deriveProfileIdentity(tenantB, "wave", "shared-label");
const profilesAOtherConnector = deriveProfileIdentity(tenantA, "gcos", "shared-label");
assert.match(profilesA.profileKey, /^pk1_/, "raw profile labels must be replaced with opaque keys");
assert.notEqual(profilesA.profileKey, "shared-label", "legacy unnamespaced labels must not be reused");
assert.notEqual(profilesA.profileKey, profilesB.profileKey, "same profile label must differ across tenants");
assert.notEqual(profilesA.userDataId, profilesB.userDataId, "persisted profile IDs must differ across tenants");
assert.notEqual(profilesA.profileKey, profilesAOtherConnector.profileKey, "profile keys must also be connector-scoped");
assert.equal(
  deriveProfileIdentity(tenantA, "wave", profilesA.profileKey).userDataId,
  profilesA.userDataId,
  "an opaque profile key must resolve only inside its original namespace",
);
assert.throws(
  () => deriveProfileIdentity(tenantB, "wave", profilesA.profileKey),
  /does not belong/,
  "a leaked opaque profile key must not cross tenants",
);

type TestSession = { tenantKey: string; sessionId: string; marker: string };
const sessions = new TenantSessionStore<TestSession>();
sessions.set({ tenantKey: tenantA, sessionId, marker: "tenant-a" });
assert.equal(sessions.get(tenantA, sessionId)?.marker, "tenant-a");
assert.equal(sessions.get(tenantB, sessionId), undefined, "cross-tenant session access must be denied");
assert.equal(sessions.get(undefined, sessionId), undefined, "a raw UUID without a tenant namespace is insufficient");
assert.deepEqual(sessions.list(tenantB), [], "session lists must be tenant-filtered");

console.log("Connector tenant isolation checks passed.");
