import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { LocalStoreDb, MemoryDb, MemoryRowStore, makeCapabilities, type PortableMutationCtx } from "../shared/portable/index";
import { clearLogoPortable, setLogoPortable } from "../shared/functions/society";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

const states = ["draft", "issued", "sent", "void"] as const;
for (const backend of ["memory", "local"] as const) {
  const societyId = "invoice-logo-workspace";
  const seed = {
    ...portableTestSeed(societyId),
    invoices: states.map(status => ({
      _id: `${status}-invoice`, societyId, status,
      issuerSnapshot: { name: "Synthetic original issuer", logoStorageId: `${status}-logo` },
    })),
  };
  const db = backend === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const deleted: string[] = [];
  const ctx: PortableMutationCtx = {
    db, principal: portableTestPrincipal(),
    capabilities: makeCapabilities({ storage: { delete: async ({ storageKey }) => { deleted.push(storageKey); } } }),
    runQuery: async () => { throw new Error("Unexpected nested query"); },
    runMutation: async () => { throw new Error("Unexpected nested mutation"); },
  };
  await db.transaction(async () => {
    for (const status of states) {
      const logo = `${status}-logo`;
      await db.patch(societyId, { logoStorageId: logo });
      await clearLogoPortable(ctx, { societyId });
      assert.equal((await db.get(societyId))?.logoStorageId, undefined);
      assert.ok(!deleted.includes(logo), `${backend}: clearing branding retains ${status} invoice logo`);
      await db.patch(societyId, { logoStorageId: logo });
      await setLogoPortable(ctx, { societyId, storageId: `new-${status}-logo` });
      assert.equal((await db.get(societyId))?.logoStorageId, `new-${status}-logo`);
      assert.ok(!deleted.includes(logo), `${backend}: replacing branding retains ${status} invoice logo`);
      assert.equal((await db.get(`${status}-invoice`))?.issuerSnapshot.logoStorageId, logo);
    }
    await db.patch(societyId, { logoStorageId: "unreferenced-logo" });
    await clearLogoPortable(ctx, { societyId });
  });
  assert.ok(deleted.includes("unreferenced-logo"), `${backend}: ordinary unreferenced branding cleanup still runs`);
}

// Exercise the real nested schema index and native storage deletion, not only
// mocks. This covers a prepared snapshot, issued/sent records and void history.
const api: any = anyApi;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./invoices.js": () => import("../convex/invoices"),
} as any);
const issuer = betterAuthIssuer();
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic retained invoice issuer", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert("users", { societyId, email: "invoice-logo-owner@example.invalid", displayName: "Logo owner", role: "Owner", status: "Active", authSubject: "invoice-logo-owner", authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-11-01T00:00:00Z" });
  const invoices = [];
  for (const [index, status] of states.entries()) {
    const storageId = await ctx.storage.store(new Blob([`Synthetic retained ${status} logo`], { type: "image/png" }));
    const invoiceId = await ctx.db.insert("invoices", {
      societyId, sequence: index + 1, number: `SYN-${index + 1}`, status,
      partyKind: "custom", billToName: "Synthetic customer", issueDate: "2026-11-01", dueDate: "2026-12-01", terms: "net_30", currency: "CAD",
      lines: [{ key: "synthetic-service", item: "Synthetic service", quantity: 1, unitPriceCents: 10000 }],
      totalCents: 10000, paidCents: 0, payments: [], timeline: [],
      issuerSnapshot: { name: "Synthetic original issuer", logoStorageId: storageId },
      ...(status !== "draft" ? { issuedAtISO: "2026-11-01T00:00:00Z" } : {}),
      createdAtISO: "2026-11-01T00:00:00Z", updatedAtISO: "2026-11-01T00:00:00Z",
    });
    invoices.push({ status, storageId, invoiceId });
  }
  return { societyId, invoices };
});
const owner = t.withIdentity({ subject: "invoice-logo-owner", issuer });
for (const invoice of fixture.invoices) {
  const replacementId = await t.run(ctx => ctx.storage.store(new Blob([`Synthetic ${invoice.status} replacement logo`], { type: "image/png" })));
  await owner.mutation(api.society.setLogo, { societyId: fixture.societyId, storageId: invoice.storageId });
  await owner.mutation(api.society.setLogo, { societyId: fixture.societyId, storageId: replacementId });
  assert.equal(await t.run(async ctx => (await ctx.storage.get(invoice.storageId))?.text()), `Synthetic retained ${invoice.status} logo`, `${invoice.status}: replacing current logo preserves actual historical bytes`);
  await owner.mutation(api.society.setLogo, { societyId: fixture.societyId, storageId: invoice.storageId });
  await owner.mutation(api.society.clearLogo, { societyId: fixture.societyId });
  assert.equal(await t.run(async ctx => (await ctx.storage.get(invoice.storageId))?.text()), `Synthetic retained ${invoice.status} logo`, `${invoice.status}: clearing current logo preserves actual historical bytes`);
  const document = await owner.query(api.invoices.document, { id: invoice.invoiceId });
  assert.equal(document.issuerSnapshot.logoStorageId, invoice.storageId);
  assert.equal(typeof document.issuerLogoUrl, "string", `${invoice.status}: the invoice still resolves its own historical logo`);
}
const unreferenced = await t.run(ctx => ctx.storage.store(new Blob(["Synthetic disposable logo"], { type: "image/png" })));
await owner.mutation(api.society.setLogo, { societyId: fixture.societyId, storageId: unreferenced });
await owner.mutation(api.society.clearLogo, { societyId: fixture.societyId });
assert.equal(await t.run(ctx => ctx.storage.get(unreferenced)), null, "unreferenced native logo cleanup still deletes the blob");

console.log("Invoice logo retention passed: memory/local stores and hosted native storage preserve prepared, issued, sent and void invoice snapshots across branding replacement/removal; unreferenced cleanup still works.");
