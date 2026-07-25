import assert from "node:assert/strict";

import { toPortableMutationCtx, toPortableQueryCtx } from "../convex/lib/portable";
import { requirePrincipalRole, requireRolePortable } from "../shared/functions/access";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import {
  MemoryDb,
  PortableRuntime,
  definePortableMutation,
  definePortableQuery,
  makeCapabilities,
  type PortablePrincipal,
} from "../shared/portable/index";

const caps = makeCapabilities({});

// 1. A local invocation resolves its provider once and reuses the exact same
// principal object through nested query and mutation calls.
const configuredPrincipal: PortablePrincipal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: "test:owner",
  userId: "owner",
  societyId: "society",
};
let providerCalls = 0;
const seen: PortablePrincipal[] = [];
const runtime = new PortableRuntime({
  db: new MemoryDb(),
  capabilities: caps,
  principalProvider: () => {
    providerCalls += 1;
    return configuredPrincipal;
  },
})
  .register(definePortableQuery({
    name: "principal:leafQuery",
    handler: async (ctx) => {
      seen.push(ctx.principal);
      return ctx.principal.kind === "anonymous" ? "anonymous" : ctx.principal.subject;
    },
  }))
  .register(definePortableMutation({
    name: "principal:leafMutation",
    handler: async (ctx) => {
      seen.push(ctx.principal);
      return ctx.principal.kind === "anonymous" ? "anonymous" : ctx.principal.subject;
    },
  }))
  .register(definePortableMutation({
    name: "principal:rootMutation",
    handler: async (ctx) => {
      seen.push(ctx.principal);
      await ctx.runQuery("principal:leafQuery");
      await ctx.runMutation("principal:leafMutation");
      return ctx.principal.kind === "anonymous" ? "anonymous" : ctx.principal.subject;
    },
  }));

assert.equal(await runtime.runMutation("principal:rootMutation"), "test:owner");
assert.equal(providerCalls, 1, "nested calls must not resolve a second principal");
assert.equal(seen.length, 3);
assert.ok(seen.every((principal) => principal === configuredPrincipal));
seen.length = 0;
assert.equal(await runtime.runQuery("principal:leafQuery"), "test:owner");
assert.equal(providerCalls, 2, "a new top-level invocation resolves a new principal");
assert.equal(seen[0], configuredPrincipal);
console.log("✓ local runtime injects one principal per invocation chain");

// 2. Hosted adapters derive only the portable verified-identity fields and
// produce an explicit anonymous principal when Convex has no identity.
const identity = {
  subject: "auth0|user-7",
  issuer: "https://issuer.example/",
  tokenIdentifier: "https://issuer.example/|auth0|user-7",
  email: "member@example.org",
  emailVerified: true,
};
const hostedBase = {
  db: {},
  runQuery: async () => null,
  runMutation: async () => null,
};
const hostedQuery = await toPortableQueryCtx({
  ...hostedBase,
  auth: { getUserIdentity: async () => identity },
});
assert.deepEqual(hostedQuery.principal, {
  kind: "user",
  runtime: "convex-hosted",
  assurance: "verified-jwt",
  subject: identity.subject,
  issuer: identity.issuer,
  tokenIdentifier: identity.tokenIdentifier,
  email: identity.email,
  emailVerified: identity.emailVerified,
});
const hostedMutation = await toPortableMutationCtx({
  ...hostedBase,
  auth: { getUserIdentity: async () => null },
});
assert.deepEqual(hostedMutation.principal, {
  kind: "anonymous",
  runtime: "convex-hosted",
  assurance: "none",
});
console.log("✓ hosted adapters derive verified-JWT and anonymous principal shapes");

// 3. When the runtime principal resolves to a user row, caller-supplied legacy
// attribution cannot replace it.
const principalDb = new MemoryDb({
  seed: {
    users: [
      { _id: "owner", societyId: "society", role: "Owner", status: "Active", authSubject: "test:owner" },
      { _id: "forged-viewer", societyId: "society", role: "Viewer", status: "Active" },
    ],
  },
});
const principalRuntime = new PortableRuntime({
  db: principalDb,
  capabilities: caps,
  principalProvider: () => configuredPrincipal,
}).register(definePortableQuery({
  name: "principal:requireRole",
  handler: async (ctx) => {
    const { user } = await requirePrincipalRole(ctx, {
      societyId: "society",
      required: "Admin",
      actingUserId: "forged-viewer",
    });
    return user?._id;
  },
}));
assert.equal(await principalRuntime.runQuery("principal:requireRole"), "owner");
const compatibilityRuntime = new PortableRuntime({
  db: principalDb,
  capabilities: caps,
  principalProvider: () => configuredPrincipal,
}).register(definePortableQuery({
  name: "principal:legacyCompatibility",
  handler: (ctx) => requireRolePortable(ctx, {
    societyId: "society",
    required: "Admin",
    actingUserId: "forged-viewer",
  }),
}));
await assert.rejects(
  () => compatibilityRuntime.runQuery("principal:legacyCompatibility"),
  /Role Admin required — you have Viewer/,
  "the compatibility wrapper must retain the legacy actingUserId behavior",
);
console.log("✓ resolvable principal wins over a forged actingUserId");

// 4. Metadata is authenticated by default and the proposal's registered public
// allowlist is explicitly public. Stage 1 records but does not enforce it.
const metadataRuntime = new PortableRuntime({
  db: new MemoryDb(),
  capabilities: caps,
  principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }),
})
  .register(definePortableQuery({ name: "metadata:default", handler: async () => "still-runs" }))
  .registerAll(PORTABLE_FUNCTIONS);
assert.deepEqual(metadataRuntime.access("metadata:default"), { audience: "authenticated" });
assert.equal(await metadataRuntime.runQuery("metadata:default"), "still-runs");

const publicFunctions = [
  "transparency:publicCenter",
  "publicPortal:volunteerIntakeContext",
  "publicPortal:grantIntakeContext",
  "publicPortal:getSocietyBySlug",
  "volunteers:submitApplication",
  "grants:submitApplication",
  "partyPortals:center",
] as const;
for (const name of publicFunctions) {
  assert.deepEqual(metadataRuntime.access(name), { audience: "public" }, `${name} should be public`);
}
console.log("✓ access metadata defaults authenticated and marks all seven public functions");

console.log("\nPortable principal conformance passed.");
