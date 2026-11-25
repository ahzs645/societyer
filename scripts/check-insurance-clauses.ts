import assert from "node:assert/strict";
import {
  definePortableMutation,
  definePortableQuery,
  LocalStoreDb,
  makeCapabilities,
  MemoryDb,
  MemoryRowStore,
  PortableRuntime,
} from "../shared/portable";
import { confirmCheck, readChecks, saveCheck } from "../shared/functions/insuranceClauses";
import {
  candidateStatus,
  coverageCandidates,
  emptyClause,
  readClauseProposals,
  type Clause,
} from "../shared/insuranceClauses";
import { policyCellBadges } from "../shared/insuranceRegister";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { sourceChunks } from "../src/features/insurance/clauseSources";

const societyId = "org_fixture";
const org = "Society Fixture";
const term = {
  _id: "cgl",
  societyId,
  insurer: "Insurer",
  policyNumber: "CGL-1",
  namedInsured: org,
  currency: "CAD",
  startDate: "2026-11-01",
  endDate: "2027-11-01",
  status: "Active",
  sourceDocumentIds: ["declaration"],
  coverageItems: [
    {
      lineId: "occurrence",
      label: "General liability",
      coverageCode: "CGL",
      limitBasis: "Each occurrence",
      limitCents: 200000000,
    },
    {
      lineId: "aggregate",
      label: "General aggregate",
      coverageCode: "CGL",
      limitBasis: "Aggregate",
      limitCents: 500000000,
    },
  ],
};
const clause: Clause = {
  ...emptyClause,
  kind: "limit",
  quote: "Maintain CAD 1 million CGL per occurrence during the rental.",
  coverageCode: "CGL",
  minimumCents: 100000000,
  namedInsured: org,
  currency: "CAD",
  limitBasis: "Each occurrence",
  from: "2026-12-01",
  through: "2026-12-02",
  stage: "Before occupancy",
};
const source = { label: "Rental agreement", reference: "§6", version: "version-1" };
const origin = { societyId, origin: "procurement" as const, originKey: "bid-1" };
assert.deepEqual(
  policyCellBadges("NeedsReview", ["needs review", "Needs_Review", "restricted"]).map((x) => x.label),
  ["Needs review", "restricted"],
);
const [proposal] = readClauseProposals(JSON.stringify({ clauses: [clause] }), clause.quote);
assert.deepEqual(proposal, clause);
assert.throws(() => readClauseProposals(JSON.stringify({ clauses: [clause] }), "different wording"), /quote/);
assert.deepEqual(readClauseProposals('{"clauses":[]}', "No insurance language here."), []);
const pages = sourceChunks([
  { location: "p1", text: "abc" },
  { location: "p2", text: "xyz" },
])[0];
assert.deepEqual(
  pages.spans.map((s) => pages.text.slice(s.start, s.end)),
  ["abc", "xyz"],
);
function status(patch: Partial<Clause> = {}, policy = term) {
  return candidateStatus(coverageCandidates({ ...clause, ...patch }, [policy]));
}
assert.equal(status(), "Review policy evidence");
assert.equal(status({ minimumCents: 300000000 }), "Below required limit");
assert.equal(status({ currency: "USD" }), "Needs review");
assert.equal(status({ namedInsured: "Different Org" }), "Needs review");
assert.equal(status({ through: "2027-11-01" }), "Needs review");
assert.equal(status({ from: "" }), "Needs review");
assert.equal(status({ coverageCode: "ProfessionalLiability" }), "No matching coverage on file");
assert.equal(status({}, { ...term, status: "NeedsReview" }), "Needs review");
assert.equal(status({}, { ...term, status: "Lapsed" }), "No matching coverage on file");
const legacy = [{ ...term, kind: "GeneralLiability", coverageItems: [], coverageCents: 900000000 }];
const [unitemized] = coverageCandidates(clause, legacy);
assert.equal(candidateStatus([unitemized]), "Needs review");
assert.equal(unitemized.limitCents, undefined);
assert.deepEqual(coverageCandidates(clause, [{ ...legacy[0], kind: "PropertyCasualty" }]), []);
const seed = {
  ...portableTestSeed(societyId),
  insurancePolicies: [term],
  agreements: [
    { _id: "facility", societyId },
    { _id: "otherFacility", societyId: "foreign" },
  ],
  documents: [
    { _id: "declaration", societyId, title: "Declaration" },
    { _id: "unlinked", societyId },
  ],
  documentVersions: [{ _id: "original", documentId: "declaration", societyId, version: 1, isCurrent: true }],
};
for (const db of [new MemoryDb({ seed }), new LocalStoreDb(new MemoryRowStore(seed))]) {
  const runtime = new PortableRuntime({
    db,
    capabilities: makeCapabilities({}),
    principalProvider: portableTestPrincipal,
  }).registerAll([
    definePortableQuery({ name: "insurance:clauseChecksFor", applicationPolicy: true, handler: readChecks }),
    definePortableMutation({ name: "insurance:saveClause", applicationPolicy: true, handler: saveCheck }),
    definePortableMutation({ name: "insurance:confirmClause", applicationPolicy: true, handler: confirmCheck }),
  ]);
  const read = (target: Record<string, unknown> = origin) =>
    runtime.runQuery("insurance:clauseChecksFor", target) as Promise<any[]>;
  const save = (c: Clause, target: Record<string, unknown> = origin) =>
    runtime.runMutation("insurance:saveClause", { ...target, clause: c, source });
  const id = await save(clause);
  assert.equal(await save(clause), id);
  assert.equal((await read()).length, 1);
  const proof = {
    ...origin,
    id,
    revision: 1,
    policyId: "cgl",
    lineId: "occurrence",
    documentId: "declaration",
    versionId: "original",
    citation: "p. 2",
    wording: "Commercial general liability CAD 2,000,000 each occurrence.",
  };
  const confirm = (args: Record<string, unknown>) => runtime.runMutation("insurance:confirmClause", args);
  await assert.rejects(() => confirm({ ...proof, lineId: "aggregate" }), /match/);
  await assert.rejects(() => confirm({ ...proof, documentId: "unlinked" }), /linked/);
  await confirm(proof);
  assert.equal((await read())[0].status, "Evidence confirmed");
  await assert.rejects(() => confirm(proof), /changed/);
  // Reopen a pre-existing confirmation whose chosen original was actually a billing document.
  const hash = "1".repeat(64);
  const invoiceHash = "2".repeat(64);
  const invoice = await db.transaction(() => db.insert("documents", { societyId, title: "Invoice" }));
  const invoiceVersion = await db.transaction(() =>
    db.insert("documentVersions", { societyId, documentId: invoice, version: 1, isCurrent: true, sha256: invoiceHash }),
  );
  await db.transaction(async () => {
    const valid = await db.get("cgl", "insurancePolicies");
    await db.patch("original", { sha256: hash });
    await db.patch("cgl", {
      sourceDocumentIds: ["declaration", invoice],
      coverageItems: valid!.coverageItems.map((line: any) => ({
        ...line,
        sourceExternalIds: ["local:sha256:" + hash],
      })),
      moneyEntries: [{ kind: "invoice", id: "local:sha256:" + invoiceHash, sourceDocumentId: invoice }],
    });
  });
  const otherOriginal = { ...proof, revision: 2, documentId: invoice, versionId: invoiceVersion };
  await assert.rejects(() => confirm(otherOriginal), /invoice/);
  await confirm({ ...proof, revision: 2 });
  assert.equal((await read())[0].status, "Evidence confirmed");
  await db.transaction(async () => {
    const row = await db.get(id as string, "insuranceClauseChecks");
    await db.patch(id as string, { proof: { ...row!.proof, documentId: invoice, versionId: invoiceVersion } });
  });
  assert.equal((await read())[0].status, "Review evidence again");
  await db.transaction(() => db.patch("original", { sha256: "3".repeat(64) }));
  await assert.rejects(() => confirm({ ...proof, revision: 3 }), /original cited/);
  await db.transaction(() => db.patch("original", { sha256: hash }));
  await confirm({ ...proof, revision: 3 });
  const aiClause = {
    ...clause,
    kind: "additionalInsured" as const,
    beneficiary: "Facility Owner",
    quote: "Include Facility Owner as an additional insured.",
  };
  const agreementOrigin = { societyId, origin: "agreement", originKey: "facility" };
  const aiId = await save(aiClause, agreementOrigin);
  const aiProof = { ...proof, ...agreementOrigin, id: aiId };
  for (const wording of ["Certificate holder: Facility Owner", "Facility Owner is not an additional insured"])
    await assert.rejects(() => confirm({ ...aiProof, wording }), /endorsement/);
  await confirm({ ...aiProof, wording: "Facility Owner is included as an additional insured under this endorsement." });
  assert.equal((await read(agreementOrigin))[0].status, "Evidence confirmed");
  assert.deepEqual(await read({ ...origin, originKey: "bid-2" }), []);
  await assert.rejects(() => read({ ...agreementOrigin, originKey: "otherFacility" }), /not found|scope|workspace/i);
  await assert.rejects(() => read({ ...origin, societyId: "foreign" }));
  const certificate = {
    ...aiClause,
    kind: "certificate" as const,
    stage: "Award",
    quote: "Provide a certificate to Facility Owner upon award.",
  };
  await save(certificate);
  assert.equal((await read()).find((row) => row.clause.kind === "certificate").clause.stage, "Award");
  if (db instanceof MemoryDb)
    await db.transaction(async () => {
      await db.patch("cgl", { archivedAtISO: "2026-11-15" });
    });
  else
    await db.transaction(async () => {
      await db.patch("original", { isCurrent: false });
      await db.insert("documentVersions", { documentId: "declaration", societyId, version: 2, isCurrent: true });
    });
  assert.equal((await read()).find((row) => row._id === id).status, "Review evidence again");
}
console.log(
  "Insurance clauses passed on both portable stores, including source quotes, deduplication, scope, amounts, stage, ownership, evidence versions and archival.",
);

// Exercise the public hosted wrappers with the schema, permission gate and provider adapter.
const { convexTest } = await import("convex-test");
const { default: schema } = await import("../convex/schema");
const { api } = await import("../convex/_generated/api");
const hosted = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./insurance.js": () => import("../convex/insurance"),
  "./authorization.js": () => import("../convex/authorization"),
  "./aiFilter.js": () => import("../convex/aiFilter"),
  "./aiFilterActions.js": () => import("../convex/aiFilterActions"),
  "./aiSettings.js": () => import("../convex/aiSettings"),
});
const issuer = "https://insurance-clause.test";
const native = await hosted.run(async (ctx) => {
  const sid = await ctx.db.insert("societies", { name: org, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const now = "2026-11-01T00:00:00Z";
  for (const role of ["Owner", "Viewer"])
    await ctx.db.insert("users", {
      societyId: sid,
      email: role + "@test.invalid",
      displayName: role,
      role,
      status: "Active",
      authIssuer: issuer,
      authSubject: role,
      createdAtISO: now,
    });
  const doc = await ctx.db.insert("documents", {
    societyId: sid,
    title: "Declaration",
    tags: [],
    category: "Insurance",
    createdAtISO: now,
    flaggedForDeletion: false,
  });
  const versionId = await ctx.db.insert("documentVersions", {
    societyId: sid,
    documentId: doc,
    version: 1,
    storageProvider: "local",
    storageKey: "test",
    fileName: "Policy.pdf",
    uploadedAtISO: now,
    isCurrent: true,
  });
  const { _id, ...fields } = term;
  const policyId = await ctx.db.insert("insurancePolicies", {
    ...fields,
    kind: "GeneralLiability",
    societyId: sid,
    renewalDate: term.endDate,
    sourceDocumentIds: [doc],
  });
  return { societyId: sid, policyId, versionId, documentId: doc };
});
const actor = hosted.withIdentity({ issuer, subject: "Owner" });
const target = { ...origin, societyId: native.societyId };
const oldFetch = globalThis.fetch;
const envKeys = ["AUTH_MODE", "VITE_AUTH_MODE", "CLERK_JWT_ISSUER_DOMAIN", "OPENROUTER_API_KEY"];
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
try {
  process.env.AUTH_MODE = process.env.VITE_AUTH_MODE = "clerk";
  process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
  process.env.OPENROUTER_API_KEY = "synthetic-key";
  await actor.mutation(api.aiSettings.upsert, {
    societyId: native.societyId,
    scope: "workspace",
    provider: "openrouter",
    modelId: "fixture",
    label: "Test provider",
    validationStatus: "ok",
  });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.messages.at(-1).content, clause.quote);
    assert.ok(!JSON.stringify(payload).includes("CGL-1"));
    calls++;
    return Response.json({
      id: "fixture",
      object: "chat.completion",
      model: "fixture",
      created: 0,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify({ clauses: [clause] }) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  };
  const [label] = await actor.action(api.aiFilterActions.extractInsuranceClauses, { ...target, text: clause.quote });
  assert.deepEqual(label, clause);
  assert.equal(calls, 1);
  assert.deepEqual(await actor.query(api.insurance.clauseChecksFor, target), []);
  await assert.rejects(
    () =>
      hosted
        .withIdentity({ issuer, subject: "Viewer" })
        .mutation(api.insurance.saveClause, { ...target, clause, source }),
    /permission/i,
  );
  const id = await actor.mutation(api.insurance.saveClause, { ...target, clause: label, source });
  await actor.mutation(api.insurance.confirmClause, {
    ...target,
    id,
    revision: 1,
    policyId: native.policyId,
    lineId: "occurrence",
    documentId: native.documentId,
    versionId: native.versionId,
    citation: "p. 2",
    wording: "CAD 2,000,000 per occurrence",
  });
  const [result] = await actor.query(api.insurance.clauseChecksFor, target);
  assert.equal(result.status, "Evidence confirmed");
  console.log(
    "Hosted Convex schema, workspace provider adapter with simulated response, authorization, confirmation and versioned evidence passed.",
  );
} finally {
  globalThis.fetch = oldFetch;
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}
