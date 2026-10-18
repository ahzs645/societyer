/** Test the installed Better Auth engine, including renewal and server-side revocation. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { hostedSessionConfiguration } from "../shared/authConfiguration";

assert.deepEqual(hostedSessionConfiguration({}), { expiresIn: 28800, disableSessionRefresh: true });
assert.deepEqual(hostedSessionConfiguration({ AUTH_PERSISTENT_SESSION_DAYS: "7" }), { expiresIn: 604800, updateAge: 86400, disableSessionRefresh: false });
for (const value of ["0", "31", "1.5", "NaN", ""]) assert.throws(() => hostedSessionConfiguration({ AUTH_PERSISTENT_SESSION_DAYS: value }));
const database = new DatabaseSync(":memory:");
const auth = betterAuth({
  baseURL: "http://localhost:5134", secret: "synthetic-persistent-session-regression-secret-000000",
  database, emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true },
  session: hostedSessionConfiguration({ AUTH_PERSISTENT_SESSION_DAYS: "7" }),
});
try {
  const { runMigrations } = await getMigrations(auth.options); await runMigrations();
  const created = await auth.api.signUpEmail({ body: { name: "Synthetic", email: "session@example.invalid", password: "synthetic-regression-password" } });
  assert.ok(created.token);
  const context = await auth.$context;
  const before = await context.internalAdapter.findSession(created.token);
  assert.ok(before); assert.ok(before.session.expiresAt.getTime() - Date.now() > 6 * 86400_000);
  // Model a current, old eight-hour session during the rollout. Its next check
  // should renew it without changing its token or requiring another password.
  await context.internalAdapter.updateSession(created.token, { expiresAt: new Date(Date.now() + 8 * 3600_000), updatedAt: new Date(Date.now() - 86400_000) });
  const headers = new Headers({ cookie: `better-auth.session_token=${await signSessionCookie(created.token, context.secret)}` });
  const checked = await auth.api.getSession({ headers, returnHeaders: true });
  assert.ok(checked.response?.session);
  assert.ok(new Date(checked.response.session.expiresAt).getTime() - Date.now() > 6 * 86400_000, "Active sessions renew for seven days");
  assert.ok(checked.headers.get("set-cookie")?.includes("Max-Age=604800"), "Renewed cookie persists across browser restarts");
  await context.internalAdapter.deleteSession(created.token);
  assert.equal(await auth.api.getSession({ headers }), null, "Revocation still removes access");
  console.log("OK persistent hosted sessions: unchanged legacy default, bounded opt-in policy, seven-day persistence, renewal of an existing short session, and session revocation.");
} finally { database.close(); }

async function signSessionCookie(token: string, secret: string): Promise<string> {
  const { makeSignature } = await import("better-auth/crypto");
  return encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
}
