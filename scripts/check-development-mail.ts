import assert from "node:assert/strict";
import { developmentMailConfigured, DEVELOPMENT_MAIL_SITE } from "../shared/developmentMailConfiguration";

const config = { SOCIETYER_AUTH_DEVELOPMENT_MAIL: "1", CONVEX_SITE_URL: DEVELOPMENT_MAIL_SITE, SITE_URL: "http://127.0.0.1:5173,http://localhost:5173" };
assert.equal(developmentMailConfigured(config), true);
for (const update of [
  { CONVEX_SITE_URL: "https://industrious-cricket-610.convex.site" },
  { CONVEX_SITE_URL: DEVELOPMENT_MAIL_SITE + ".evil.test" },
  { SITE_URL: "https://societyer-ddcnorth.pages.dev" },
  { SITE_URL: "http://127.0.0.1:5173,https://example.test" },
  { SITE_URL: "http://127.0.0.1:5173/path" },
  { SITE_URL: "http://127.0.0.1:5173@evil.test" },
  { SITE_URL: "" }, { SOCIETYER_AUTH_DEVELOPMENT_MAIL: "0" },
]) assert.equal(developmentMailConfigured({ ...config, ...update }), false);

const keys = [...Object.keys(config), "AUTH_MODE", "BETTER_AUTH_SECRET", "SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS"];
const before = new Map(keys.map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, config, { AUTH_MODE: "convex", BETTER_AUTH_SECRET: "fixture-only-development-mail-test-secret-123456", SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "ddcnorth.com" });
  const { createAuth, hostedAuthEmailConfigured } = await import("../convex/hostedAuth");
  assert.equal(hostedAuthEmailConfigured(config), true);
  assert.equal(hostedAuthEmailConfigured({ ...config, CONVEX_SITE_URL: "https://industrious-cricket-610.convex.site", RESEND_API_KEY: "fixture", RESEND_FROM_EMAIL: "fixture@example.test" }), false);
  const writes: unknown[] = [];
  const auth = createAuth({ runMutation: async (_ref: unknown, args: unknown) => { writes.push(args); return "fixture-mail-id"; } } as never);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Development auth mail must make zero provider requests"); };
  try {
    assert.equal(auth.options.emailAndPassword?.disableSignUp, false);
    assert.equal(auth.options.emailAndPassword?.requireEmailVerification, true);
    await auth.options.emailVerification!.sendVerificationEmail!({ user: { email: "ahmad@ddcnorth.com" }, url: `${DEVELOPMENT_MAIL_SITE}/api/auth/verify-email?token=fixture` } as never);
    await auth.options.emailAndPassword!.sendResetPassword!({ user: { email: "ahmad@ddcnorth.com" }, url: "http://127.0.0.1:5173/reset-password?token=fixture" } as never);
    assert.equal(writes.length, 2);
    assert.equal((writes[0] as any).tag, "auth-verify-email");
    assert.equal((writes[1] as any).tag, "auth-reset-password");
    assert.match((writes[0] as any).text, /token=fixture/);
  } finally { globalThis.fetch = realFetch; }
  console.log("Development mail passed: exact dev-deployment pin, localhost-only origins, production denial even with a real sender, real verification/reset hooks captured with zero outbound mail, and verification still required.");
} finally { for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
