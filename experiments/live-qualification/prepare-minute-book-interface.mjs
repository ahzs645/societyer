/** Private disposable ACL fixture for the four-width real-session browser proof. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
assert.equal(config.convexUrl, "http://127.0.0.1:43230");
assert.equal(config.authUrl, "http://127.0.0.1:43487");
const fixturePath = new URL("../../tmp/live-minute-book-interface-fixture.json", import.meta.url);
const ref = makeFunctionReference;
const operator = new ConvexHttpClient(config.convexUrl, { logger: false }); operator.setAdminAuth(config.adminKey);
if (process.argv[2] === "cleanup") {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  await operator.function(ref("projectionFixture:cleanup"), undefined, { societyId: fixture.societyId, ids: fixture.created });
  await operator.function(ref("roleFixture:cleanupBatchMemberships"), undefined, { societyId: fixture.societyId });
  const users = await operator.function(ref("roleFixture:inspect"), undefined, { societyId: fixture.societyId, table: "users" });
  assert.deepEqual(users, []);
  unlinkSync(fixturePath);
  console.log("Disposable MinuteBook fixture rows and memberships removed.");
} else {
  const batch = await operator.function(ref("roleFixture:seedBatchSociety"), undefined, {
    issuer: config.issuer,
    identities: config.accounts.filter(account => ["owner-a", "viewer-a"].includes(account.key)).map(({ subject, email, role, status }) => ({ subject, email, role, status })),
  });
  const marker = `qualification-${randomUUID()}`;
  const seed = await operator.function(ref("projectionFixture:seed"), undefined, { societyId: batch.societyId, marker });
  const fixture = { societyId: batch.societyId, created: seed.created, privateTitle: `${marker} private constitution` };
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
  try {
    const owner = config.accounts.find(account => account.key === "owner-a");
    const login = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: owner.email, password: owner.password }) });
    assert.equal(login.ok, true);
    const cookies = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const auth = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
    assert.equal(auth.ok, true); const { token } = await auth.json(); assert.ok(token);
    const client = new ConvexHttpClient(config.convexUrl, { logger: false }); client.setAuth(token);
    const id = await client.mutation(ref("documents:create"), { societyId: batch.societyId, title: fixture.privateTitle, category: "Constitution", tags: [] });
    fixture.created.push(id);
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    console.log("Disposable MinuteBook fixture prepared using actual Owner session and production document API.");
  } catch (error) {
    await operator.function(ref("projectionFixture:cleanup"), undefined, { societyId: fixture.societyId, ids: fixture.created });
    await operator.function(ref("roleFixture:cleanupBatchMemberships"), undefined, { societyId: fixture.societyId });
    throw error;
  }
}
