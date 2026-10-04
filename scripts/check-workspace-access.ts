import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { ROLES } from "../shared/functions/access";
import { myPermissionsPortable, hasPermission, listPermissionsForRole } from "../shared/functions/permissions";
import { updateModulesPortable } from "../shared/functions/society";
import { setRolePortable, userRemovePortable, userUpsertPortable } from "../shared/functions/users";
import {
  MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery,
  makeCapabilities, type PortablePrincipal,
} from "../shared/portable/index";

const issuer = betterAuthIssuer();
const db = new MemoryDb({ seed: {
  societies: [{ _id: "company" }, { _id: "other" }],
  users: [
    ...ROLES.map((role) => ({
      _id: role, societyId: "company", role, status: "Active",
      authSubject: role, authProvider: "better-auth", authIssuer: issuer,
    })),
    { _id: "foreign", societyId: "other", role: "Owner", status: "Active" },
    { _id: "disabled", societyId: "company", role: "Admin", status: "Disabled", authSubject: "disabled", authIssuer: issuer },
  ],
} });
const identity = (subject: string): PortablePrincipal => ({
  kind: "user", runtime: "test", assurance: "verified-jwt", subject, issuer,
  authProvider: "better-auth",
});
let principal = identity("Admin");
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal })
  .register(definePortableMutation({ name: "society:updateModules", handler: updateModulesPortable }))
  .register(definePortableMutation({ name: "users:setRole", handler: setRolePortable }))
  .register(definePortableMutation({ name: "users:upsert", handler: userUpsertPortable }))
  .register(definePortableMutation({ name: "users:remove", handler: userRemovePortable }))
  .register(definePortableQuery({ name: "permissions:myPermissions", handler: myPermissionsPortable }));

for (const role of ["Viewer", "Member", "Director"]) {
  principal = identity(role);
  await assert.rejects(() => runtime.runMutation("society:updateModules", {
    societyId: "company", disabledModules: ["grants"],
  }), /Role Admin required/);
  assert.equal((await db.get("company"))?.disabledModules, undefined, "Denied mutation must leave modules unchanged");
  assert.equal((await runtime.runQuery<any>("permissions:myPermissions", { societyId: "company", userId: role })).role, role);
  await assert.rejects(() => runtime.runQuery("permissions:myPermissions", { societyId: "company", userId: "Owner" }), /Role Admin required/);
}
for (const role of ["Admin", "Owner"]) {
  principal = identity(role);
  assert.equal(await runtime.runMutation("society:updateModules", { societyId: "company", disabledModules: ["grants"] }), "company");
  assert.equal((await runtime.runQuery<any>("permissions:myPermissions", { societyId: "company", userId: "Viewer" })).role, "Viewer");
}
await assert.rejects(() => runtime.runMutation("society:updateModules", { societyId: "other", disabledModules: [] }), /membership not found/);
await assert.rejects(() => runtime.runQuery("permissions:myPermissions", { societyId: "other", userId: "foreign" }), /membership not found/);
assert.deepEqual(await runtime.runQuery("permissions:myPermissions", { societyId: "company", userId: "foreign" }), { role: null, permissions: [] });
await assert.rejects(() => runtime.runMutation("users:setRole", { id: "Viewer", role: "Root" }), /Unknown workspace role/);
principal = identity("disabled");
await assert.rejects(() => runtime.runMutation("society:updateModules", { societyId: "company", disabledModules: [] }), /disabled/);
assert.equal(hasPermission("__proto__", "settings:write"), false);
assert.deepEqual(listPermissionsForRole("constructor"), []);

// Editing the profile must enforce the same Owner invariant as setRole/remove.
principal = identity("Admin");
const ownerDraft = { id: "Owner", societyId: "company", email: "owner@example.org", displayName: "Owner", role: "Owner", status: "Active" };
await db.insert("users", { societyId: "company", role: "Owner", status: "Disabled" });
await db.insert("users", { societyId: "company", role: "Owner", status: "Invited" });
for (const patch of [{ role: "Member" }, { status: "Disabled" }, { status: "Invited" }]) {
  await assert.rejects(() => runtime.runMutation("users:upsert", { ...ownerDraft, ...patch }), /last Owner/);
}
await assert.rejects(() => runtime.runMutation("users:setRole", { id: "Owner", role: "Member" }), /last Owner/);
await assert.rejects(() => runtime.runMutation("users:upsert", { ...ownerDraft, role: "Root" }), /Unknown workspace role/);
await assert.rejects(() => runtime.runMutation("users:upsert", { ...ownerDraft, status: "Unknown" }), /Unknown workspace user status/);
await assert.rejects(() => runtime.runMutation("users:upsert", { ...ownerDraft, id: "foreign" }), /users not found/);
await assert.rejects(() => runtime.runMutation("users:upsert", { ...ownerDraft, societyId: "other" }), /membership not found/);
principal = identity("Viewer");
await assert.rejects(() => runtime.runMutation("users:upsert", ownerDraft), /Role Admin required/);
principal = identity("Owner");
await assert.rejects(() => runtime.runMutation("users:remove", { id: "Owner" }), /last Owner/);
principal = identity("Admin");
await db.patch("Owner", { avatarColor: "purple" });
await runtime.runMutation("users:upsert", { ...ownerDraft, displayName: "Renamed Owner" });
assert.equal((await db.get("Owner"))?.avatarColor, "purple", "Profile edits preserve omitted optional fields");
await runtime.runMutation("users:upsert", { ...ownerDraft, authSubject: "forged-subject", authIssuer: "https://attacker.example", authProvider: "clerk" });
assert.equal((await db.get("Owner"))?.authSubject, "Owner", "Profile edit must not overwrite operator-only identity bindings");
const createdUser = await runtime.runMutation<string>("users:upsert", { ...ownerDraft, id: undefined, email: "new@example.org", role: "Member" });
assert.equal((await db.get(createdUser))?.role, "Member");
await runtime.runMutation("users:setRole", { id: "Admin", role: "Owner" });
await runtime.runMutation("users:upsert", { ...ownerDraft, status: "Disabled" });
assert.equal((await db.get("Owner"))?.status, "Disabled", "An active replacement Owner allows disabling another Owner");

const bootstrapDb = new MemoryDb({ seed: { societies: [{ _id: "empty" }] } });
const bootstrap = new PortableRuntime({
  db: bootstrapDb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: "local:empty" }),
}).register(definePortableMutation({ name: "users:upsert", handler: userUpsertPortable }));
const bootstrapId = await bootstrap.runMutation<string>("users:upsert", { societyId: "empty", email: "owner@local", displayName: "Local owner", role: "Member", status: "Disabled" });
assert.equal((await bootstrapDb.get(bootstrapId))?.role, "Owner");
assert.equal((await bootstrapDb.get(bootstrapId))?.status, "Active");

// Invoke the actual hosted endpoints to catch wrapper authentication regressions.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./permissions.js": () => import("../convex/permissions"),
  "./users.js": () => import("../convex/users"),
} as any);
const seeded = await native.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Company", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const otherSocietyId = await ctx.db.insert("societies", { name: "Other", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const ids: Record<string, any> = {};
  for (const role of ROLES) {
    ids[role] = await ctx.db.insert("users", {
      societyId, email: `${role.toLowerCase()}@example.org`, displayName: role, role,
      status: "Active", authSubject: role, authIssuer: issuer, authProvider: "better-auth",
      createdAtISO: new Date().toISOString(),
    });
  }
  return { societyId, otherSocietyId, ids };
});
for (const role of ["Viewer", "Member", "Director", "Admin", "Owner"]) {
  const actor = native.withIdentity({ subject: role, issuer });
  if (role === "Admin" || role === "Owner") {
    await actor.mutation(api.society.updateModules, { societyId: seeded.societyId, disabledModules: ["grants"] });
    assert.equal(await actor.query(api.permissions.check, { societyId: seeded.societyId, userId: seeded.ids.Owner, permission: "settings:manage" }), true);
  } else {
    await assert.rejects(() => actor.mutation(api.society.updateModules, { societyId: seeded.societyId, disabledModules: ["grants"] }), /Role Admin required/);
    await assert.rejects(() => actor.query(api.permissions.check, { societyId: seeded.societyId, userId: seeded.ids.Owner, permission: "settings:manage" }), /Role Admin required/);
  }
  assert.equal((await actor.query(api.permissions.myPermissions, { societyId: seeded.societyId, userId: seeded.ids[role] })).role, role);
  await assert.rejects(() => actor.mutation(api.society.updateModules, { societyId: seeded.otherSocietyId, disabledModules: [] }), /membership not found/);
}
await assert.rejects(() => native.query(api.permissions.check, { societyId: seeded.societyId, userId: seeded.ids.Owner, permission: "settings:manage" }), /membership not found/);
const admin = native.withIdentity({ subject: "Admin", issuer });
const nativeOwnerDraft = { ...ownerDraft, id: seeded.ids.Owner, societyId: seeded.societyId };
for (const patch of [{ role: "Member" }, { status: "Disabled" }, { status: "Invited" }]) {
  await assert.rejects(() => admin.mutation(api.users.upsert, { ...nativeOwnerDraft, ...patch }), /last Owner/);
}
await assert.rejects(() => admin.mutation(api.users.upsert, { ...nativeOwnerDraft, role: "Root" }), /Unknown workspace role/);
await assert.rejects(() => admin.mutation(api.users.upsert, { ...nativeOwnerDraft, societyId: seeded.otherSocietyId }), /membership not found/);
await admin.mutation(api.users.upsert, { ...nativeOwnerDraft, displayName: "Updated Owner" });
assert.equal((await native.run((ctx) => ctx.db.get(seeded.ids.Owner)))?.role, "Owner");
const nativeOwner = native.withIdentity({ subject: "Owner", issuer });
await assert.rejects(() => nativeOwner.mutation(api.users.remove, { id: seeded.ids.Owner }), /last Owner/);
await admin.mutation(api.users.setRole, { id: seeded.ids.Admin, role: "Owner" });
await admin.mutation(api.users.upsert, { ...nativeOwnerDraft, status: "Disabled" });
assert.equal((await native.run((ctx) => ctx.db.get(seeded.ids.Owner)))?.status, "Disabled");
console.log("Workspace access checks passed: module administration, self/admin policy inspection, disabled membership, role validation, active Owner preservation, local bootstrap, and tenant isolation across portable and hosted handlers.");
