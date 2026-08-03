import assert from "node:assert/strict";

import { toPortableMutationCtx, toPortableQueryCtx } from "../convex/lib/portable";
import {
  getOwned,
  getOwnedChild,
  principalUserId,
  requireOwnedRow,
  requirePrincipalRole,
  requireRolePortable,
  requireSocietyMembership,
} from "../shared/functions/access";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { setLogoPortable } from "../shared/functions/society";
import { DexieWorkspaceClient } from "../src/lib/dexieWorkspaceClient";
import { StaticConvexClient } from "../src/lib/staticConvexClient";
import { STATIC_DEMO_SOCIETY_ID, STATIC_DEMO_USER_ID } from "../src/lib/staticIds";
import {
  MemoryDb,
  PortableRuntime,
  definePortableMutation,
  definePortableQuery,
  makeCapabilities,
  type PortablePrincipal,
} from "../shared/portable/index";
import { PORTABLE_ACCESS_ENFORCEMENT } from "../shared/portable/define";

const caps = makeCapabilities({});
const accessMode = PORTABLE_ACCESS_ENFORCEMENT ? "enforced" : "shadow";

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
  shadowAccessDecisions: true,
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
assert.deepEqual(runtime.accessDecisions().map((decision) => ({
  functionName: decision.functionName,
  decision: decision.decision,
  mode: decision.mode,
  principalKind: decision.principalKind,
})), [
  { functionName: "principal:rootMutation", decision: "allow", mode: accessMode, principalKind: "user" },
  { functionName: "principal:leafQuery", decision: "allow", mode: accessMode, principalKind: "user" },
  { functionName: "principal:leafMutation", decision: "allow", mode: accessMode, principalKind: "user" },
  { functionName: "principal:leafQuery", decision: "allow", mode: accessMode, principalKind: "user" },
]);
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
  authProvider: "better-auth",
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
      actingUserId: "owner",
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
  /Authenticated actor does not match the current principal/,
  "a compatibility actor may deny but cannot replace the principal",
);

const unresolvedRuntime = new PortableRuntime({
  db: principalDb,
  capabilities: caps,
  principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }),
}).register(definePortableQuery({
  name: "principal:unresolvedCompatibility",
  handler: (ctx) => requireRolePortable(ctx, {
    societyId: "society",
    required: "Admin",
    actingUserId: "forged-viewer",
  }),
}));
if (PORTABLE_ACCESS_ENFORCEMENT) {
  await assert.rejects(
    () => unresolvedRuntime.runQuery("principal:unresolvedCompatibility"),
    /Access denied: valid authenticated principal required/,
    "enforcement must reject an anonymous principal before legacy compatibility",
  );
} else {
  await assert.rejects(
    () => unresolvedRuntime.runQuery("principal:unresolvedCompatibility"),
    /Role Admin required — you have Viewer/,
    "unresolved principals retain the pre-enforcement fallback",
  );
}
console.log("✓ resolvable principal wins over a forged actingUserId");

// 4. Membership and owned-row helpers resolve the principal, reject inactive
// memberships, and use indistinguishable errors for absent/foreign ownership.
const ownedDb = new MemoryDb({
  seed: {
    users: [
      { _id: "owner", societyId: "society", role: "Owner", status: "Active" },
      { _id: "disabled", societyId: "society", role: "Owner", status: "Disabled" },
    ],
    documents: [
      { _id: "document-a", societyId: "society", title: "A" },
      { _id: "document-b", societyId: "foreign-society", title: "B" },
    ],
    documentVersions: [
      { _id: "version-a", documentId: "document-a", label: "A1" },
      { _id: "version-b", documentId: "document-b", label: "B1" },
    ],
  },
});
const ownedRuntime = new PortableRuntime({
  db: ownedDb,
  capabilities: caps,
  principalProvider: () => configuredPrincipal,
})
  .register(definePortableQuery({
    name: "principal:owned",
    handler: async (ctx) => ({
      membershipId: (await requireSocietyMembership(ctx, "society"))._id,
      principalId: await principalUserId(ctx, "society"),
      documentId: (await getOwned(ctx, "documents", "document-a", "society"))._id,
      versionId: (await getOwnedChild(
        ctx,
        "documentVersions",
        "version-a",
        "documents",
        "documentId",
        "society",
      ))._id,
    }),
  }))
  .register(definePortableQuery({
    name: "principal:foreignOwned",
    handler: (ctx) => getOwned(ctx, "documents", "document-b", "society"),
  }))
  .register(definePortableQuery({
    name: "principal:missingOwned",
    handler: (ctx) => getOwned(ctx, "documents", "missing", "society"),
  }))
  .register(definePortableQuery({
    name: "principal:wrongTable",
    handler: (ctx) => getOwned(ctx, "documents", "owner", "society"),
  }))
  .register(definePortableQuery({
    name: "principal:foreignChild",
    handler: (ctx) => getOwnedChild(
      ctx,
      "documentVersions",
      "version-b",
      "documents",
      "documentId",
      "society",
    ),
  }));
assert.deepEqual(await ownedRuntime.runQuery("principal:owned"), {
  membershipId: "owner",
  principalId: "owner",
  documentId: "document-a",
  versionId: "version-a",
});
await assert.rejects(() => ownedRuntime.runQuery("principal:foreignOwned"), /^Error: documents not found\.$/);
await assert.rejects(() => ownedRuntime.runQuery("principal:missingOwned"), /^Error: documents not found\.$/);
await assert.rejects(() => ownedRuntime.runQuery("principal:wrongTable"), /^Error: documents not found\.$/);
await assert.rejects(() => ownedRuntime.runQuery("principal:foreignChild"), /^Error: documentVersions not found\.$/);
const disabledRuntime = new PortableRuntime({
  db: ownedDb,
  capabilities: caps,
  principalProvider: () => ({ ...configuredPrincipal, userId: "disabled" }),
}).register(definePortableQuery({
  name: "principal:disabledMembership",
  handler: (ctx) => requireSocietyMembership(ctx, "society"),
}));
await assert.rejects(() => disabledRuntime.runQuery("principal:disabledMembership"), /^Error: User is disabled\.$/);
console.log("✓ membership and owned-row helpers enforce status, table, tenant, and parent ownership");

// A claimed native storage id is tenant-bound at every attachment sink. The
// same society may re-attach its own id, while local inline data URLs remain
// claim-free.
const storageDb = new MemoryDb({
  seed: {
    societies: [
      { _id: "storage-society-a", name: "Storage A" },
      { _id: "storage-society-b", name: "Storage B" },
    ],
    users: [
      { _id: "storage-owner-a", societyId: "storage-society-a", role: "Owner", status: "Active" },
    ],
    storageOwnership: [
      {
        _id: "storage-claim-b",
        storageId: "storage-id-b",
        societyId: "storage-society-b",
        createdAtISO: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
});
const storageRuntime = new PortableRuntime({
  db: storageDb,
  capabilities: caps,
  principalProvider: () => ({
    kind: "user",
    runtime: "test",
    assurance: "trusted-workspace",
    subject: "storage-owner-a",
    userId: "storage-owner-a",
    societyId: "storage-society-a",
  }),
}).register(definePortableMutation({
  name: "storage:setLogo",
  handler: setLogoPortable,
}));
await assert.rejects(
  () => storageRuntime.runMutation("storage:setLogo", {
    societyId: "storage-society-a",
    storageId: "storage-id-b",
  }),
  /^Error: storageOwnership not found\.$/,
  "Society A must not attach Society B's claimed storage id",
);
for (let attempt = 0; attempt < 2; attempt += 1) {
  await storageRuntime.runMutation("storage:setLogo", {
    societyId: "storage-society-a",
    storageId: "storage-id-a",
  });
}
assert.equal(storageDb.dump("storageOwnership").length, 2, "re-attach must reuse one ownership claim");
await storageRuntime.runMutation("storage:setLogo", {
  societyId: "storage-society-a",
  storageId: "data:image/png;base64,LOCAL",
});
assert.equal(storageDb.dump("storageOwnership").length, 2, "inline local logos must not create ownership claims");
console.log("✓ storage claims reject foreign attachment, allow own re-attach, and skip inline local logos");

const hostedPrincipalRuntime = new PortableRuntime({
  db: new MemoryDb({
    seed: {
      users: [
        { _id: "hosted-owner", societyId: "hosted-society", role: "Owner", status: "Active", authSubject: "hosted:owner" },
      ],
      documents: [
        { _id: "hosted-document", societyId: "hosted-society", title: "Hosted" },
      ],
    },
  }),
  capabilities: caps,
  principalProvider: () => ({
    kind: "user",
    runtime: "convex-hosted",
    assurance: "verified-jwt",
    subject: "hosted:owner",
    issuer: "https://hosted.test",
  }),
}).register(definePortableQuery({
  name: "principal:hostedOwnedRow",
  handler: (ctx) => requireOwnedRow(ctx, "documents", "hosted-document"),
}));
assert.equal(
  (await hostedPrincipalRuntime.runQuery("principal:hostedOwnedRow"))._id,
  "hosted-document",
  "row-derived ownership must support hosted principals without a societyId",
);
console.log("✓ hosted principal without societyId can authorize a row-derived society");

// 5. Metadata is authenticated by default and the proposal's registered public
// allowlist is explicitly public. Enforcement is off, so opted-in shadow
// decisions are observable without changing behavior.
const metadataRuntime = new PortableRuntime({
  db: new MemoryDb(),
  capabilities: caps,
  principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }),
  shadowAccessDecisions: true,
})
  .register(definePortableQuery({ name: "metadata:default", handler: async () => "still-runs" }))
  .register(definePortableQuery({
    name: "metadata:public",
    access: { audience: "public" },
    handler: async () => "public-runs",
  }))
  .register(definePortableQuery({
    name: "metadata:service",
    access: { audience: "service", scopes: ["documents:read"] },
    handler: async () => "shadow-denied-but-runs",
  }))
  .registerAll(PORTABLE_FUNCTIONS);
assert.deepEqual(metadataRuntime.access("metadata:default"), { audience: "authenticated" });
if (PORTABLE_ACCESS_ENFORCEMENT) {
  await assert.rejects(
    () => metadataRuntime.runQuery("metadata:default"),
    /Access denied: valid authenticated principal required/,
  );
} else {
  assert.equal(await metadataRuntime.runQuery("metadata:default"), "still-runs");
}
assert.equal(await metadataRuntime.runQuery("metadata:public"), "public-runs");
if (PORTABLE_ACCESS_ENFORCEMENT) {
  await assert.rejects(
    () => metadataRuntime.runQuery("metadata:service"),
    /Access denied: service principal required/,
  );
} else {
  assert.equal(await metadataRuntime.runQuery("metadata:service"), "shadow-denied-but-runs");
}
assert.deepEqual(metadataRuntime.accessDecisions(), [
  {
    functionName: "metadata:default",
    audience: "authenticated",
    principalKind: "anonymous",
    decision: "deny",
    mode: accessMode,
    reason: "valid authenticated principal required",
  },
  {
    functionName: "metadata:public",
    audience: "public",
    principalKind: "anonymous",
    decision: "allow",
    mode: accessMode,
    reason: "public audience",
  },
  {
    functionName: "metadata:service",
    audience: "service",
    principalKind: "anonymous",
    decision: "deny",
    mode: accessMode,
    reason: "service principal required",
  },
]);

const scopedServiceRuntime = new PortableRuntime({
  db: new MemoryDb(),
  capabilities: caps,
  principalProvider: () => ({
    kind: "service",
    runtime: "test",
    assurance: "trusted-internal",
    subject: "principal-check-service",
    scopes: ["documents:read"],
  }),
  shadowAccessDecisions: true,
})
  .register(definePortableQuery({
    name: "metadata:serviceAllowed",
    access: { audience: "service", scopes: ["documents:read"] },
    handler: async () => true,
  }))
  .register(definePortableQuery({
    name: "metadata:serviceMissingScope",
    access: { audience: "service", scopes: ["documents:write"] },
    handler: async () => true,
  }));
assert.equal(await scopedServiceRuntime.runQuery("metadata:serviceAllowed"), true);
if (PORTABLE_ACCESS_ENFORCEMENT) {
  await assert.rejects(
    () => scopedServiceRuntime.runQuery("metadata:serviceMissingScope"),
    /Access denied: missing service scopes: documents:write/,
  );
} else {
  assert.equal(await scopedServiceRuntime.runQuery("metadata:serviceMissingScope"), true);
}
assert.deepEqual(scopedServiceRuntime.accessDecisions().map((decision) => ({
  functionName: decision.functionName,
  decision: decision.decision,
  mode: decision.mode,
  reason: decision.reason,
})), [
  {
    functionName: "metadata:serviceAllowed",
    decision: "allow",
    mode: accessMode,
    reason: "service scopes satisfied",
  },
  {
    functionName: "metadata:serviceMissingScope",
    decision: "deny",
    mode: accessMode,
    reason: "missing service scopes: documents:write",
  },
]);

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
console.log(`✓ access metadata defaults authenticated and exposes opt-in ${accessMode} decisions`);

// 6. Static-demo and desktop Dexie clients both resolve a concrete trusted
// workspace user, preserving matching local actor inputs on the principal path.
const localSeed = {
  societies: [{ _id: STATIC_DEMO_SOCIETY_ID, name: "Local principal check" }],
  users: [
    {
      _id: STATIC_DEMO_USER_ID,
      societyId: STATIC_DEMO_SOCIETY_ID,
      role: "Owner",
      status: "Active",
    },
    {
      _id: "local-viewer",
      societyId: STATIC_DEMO_SOCIETY_ID,
      role: "Viewer",
      status: "Active",
    },
  ],
};
const localClients = [
  new StaticConvexClient({
    databaseName: `principal-static-${Date.now()}`,
    seed: localSeed,
  }),
  new DexieWorkspaceClient({
    databaseName: `principal-dexie-${Date.now()}`,
    workspaceId: "principal-check",
    seed: localSeed,
  }),
];
for (const client of localClients) {
  const id = await client.mutation("recordLayouts:upsert", {
    societyId: STATIC_DEMO_SOCIETY_ID,
    scopeKey: "principal-check",
    actingUserId: STATIC_DEMO_USER_ID,
    layoutJson: JSON.stringify({ version: 1, sections: {} }),
  });
  assert.equal(typeof id, "string");
  await client.close();
}
console.log("✓ static-demo and desktop Dexie resolve concrete trusted-workspace principals");

// A local database holding several workspaces must stay fully reachable by its
// owner, including societies that have no `users` row yet (legacy/imported
// data). The §4 tenant binding briefly broke both by treating the principal's
// selected societyId as a membership restriction.
{
  const multiWorkspace = new PortableRuntime({
    db: new MemoryDb({
      seed: {
        societies: [
          { _id: "local-a", name: "Workspace A" },
          { _id: "local-b", name: "Workspace B" },
          { _id: "local-legacy", name: "Imported Legacy" },
        ],
        users: [
          { _id: "local-user-a", societyId: "local-a", role: "Owner", status: "Active" },
          { _id: "local-user-b", societyId: "local-b", role: "Owner", status: "Active" },
        ],
      },
    }),
    capabilities: caps,
    principalProvider: () => ({
      kind: "user",
      runtime: "browser-local",
      assurance: "trusted-workspace",
      subject: "local:workspace",
      userId: "local-user-a",
      societyId: "local-a",
    }),
  }).registerAll(PORTABLE_FUNCTIONS);

  const listed = await multiWorkspace.runQuery<Array<{ _id: string }>>("society:list", {});
  const listedIds = listed.map((row) => row._id).sort();
  assert.deepEqual(
    listedIds,
    ["local-a", "local-b", "local-legacy"],
    "a local principal must see every workspace in its own database, not just the selected one",
  );
  console.log("✓ trusted-workspace principal enumerates all local workspaces, including user-less legacy rows");
}

console.log("\nPortable principal conformance passed.");
