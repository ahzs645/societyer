import assert from "node:assert/strict";
import { allowedAuthEmailDomains, authEmailAllowed } from "../shared/authEmailPolicy";
import { hostedPrincipal } from "../convex/lib/authIdentity";

assert.deepEqual(allowedAuthEmailDomains({}), []);
assert.deepEqual(allowedAuthEmailDomains({ SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "DDCNORTH.com, ddcnorth.com" }), ["ddcnorth.com"]);
for (const invalid of ["", "@ddcnorth.com", "*.ddcnorth.com", "ddcnorth.com,", "ddcnorth.com/path"]) {
  assert.throws(() => allowedAuthEmailDomains({ SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: invalid }));
}
const domains = ["ddcnorth.com"];
assert.equal(authEmailAllowed(" Ahmad@DDCNORTH.com ", domains), true);
for (const invalid of [null, undefined, "@ddcnorth.com", "x@@ddcnorth.com", "x@sub.ddcnorth.com", "x@ddcnorth.com.evil.test", "x@evil-ddcnorth.com", "x y@ddcnorth.com", "x@example.com"]) {
  assert.equal(authEmailAllowed(invalid, domains), false, String(invalid));
}
assert.equal(authEmailAllowed("anyone@example.com", []), true);

process.env.AUTH_MODE = "convex";
process.env.CONVEX_SITE_URL = "https://policy-test.convex.site";
process.env.SITE_URL = "https://societyer-ddcnorth.pages.dev";
process.env.BETTER_AUTH_SECRET = "policy-test-only-not-for-deployment-0123456789";
process.env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS = "ddcnorth.com";
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.RESEND_FROM;
delete process.env.SOCIETYER_AUTH_DEVELOPMENT_MAIL;
for (const key of ["SOCIETYER_EMAIL_PROVIDER", "MICROSOFT_MAIL_TENANT_ID", "MICROSOFT_MAIL_CLIENT_ID", "MICROSOFT_MAIL_CLIENT_SECRET", "MICROSOFT_MAIL_SENDER"]) delete process.env[key];
const { createAuth } = await import("../convex/hostedAuth");

// Exercise the actual hosted broker's database hooks, including update paths
// that would otherwise let an existing account change to an external domain.
const auth = createAuth({} as never);
assert.equal(auth.options.emailAndPassword?.disableSignUp, true);
assert.equal(auth.options.emailAndPassword?.requireEmailVerification, true);
const userHooks = auth.options.databaseHooks!.user!;
await assert.rejects(() => userHooks.create!.before!({ email: "x@example.com" } as never, null), /verified email address/);
await assert.rejects(() => userHooks.update!.before!({ email: "x@sub.ddcnorth.com" } as never, null), /verified email address/);
await userHooks.create!.before!({ email: "Ahmad@ddcnorth.com" } as never, null);
await userHooks.update!.before!({ name: "Ahmad" } as never, null);

const identity = { subject: "existing-user", issuer: process.env.CONVEX_SITE_URL, tokenIdentifier: "policy-test|existing-user", email: "Ahmad@ddcnorth.com", emailVerified: true };
assert.equal(hostedPrincipal(identity).kind, "user");
assert.equal(hostedPrincipal({ ...identity, emailVerified: false }).kind, "anonymous");
assert.equal(hostedPrincipal({ ...identity, email: "x@example.com" }).kind, "anonymous");
assert.equal(hostedPrincipal({ ...identity, issuer: "https://foreign.convex.site" }).kind, "anonymous");

process.env.RESEND_API_KEY = "test-only-not-a-real-key";
process.env.RESEND_FROM_EMAIL = "Societyer <noreply@example.test>";
const withMail = createAuth({} as never);
assert.equal(withMail.options.emailAndPassword?.disableSignUp, false);
assert.equal(withMail.options.emailAndPassword?.requireEmailVerification, true);
process.env.SOCIETYER_EMAIL_PROVIDER = "microsoft365";
// Explicit incomplete Microsoft configuration must not inherit working Resend.
assert.equal(createAuth({} as never).options.emailAndPassword?.disableSignUp, true);
process.env.MICROSOFT_MAIL_TENANT_ID = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
process.env.MICROSOFT_MAIL_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
process.env.MICROSOFT_MAIL_CLIENT_SECRET = "fixture-only";
process.env.MICROSOFT_MAIL_SENDER = "societyer@ddcnorth.com";
const microsoftMail = createAuth({} as never);
assert.equal(microsoftMail.options.emailAndPassword?.disableSignUp, false);
assert.equal(microsoftMail.options.emailAndPassword?.requireEmailVerification, true);
assert.equal(typeof microsoftMail.options.emailVerification?.sendVerificationEmail, "function");
assert.equal(typeof microsoftMail.options.emailAndPassword?.sendResetPassword, "function");
for (const key of ["SOCIETYER_EMAIL_PROVIDER", "MICROSOFT_MAIL_TENANT_ID", "MICROSOFT_MAIL_CLIENT_ID", "MICROSOFT_MAIL_CLIENT_SECRET", "MICROSOFT_MAIL_SENDER"]) delete process.env[key];
delete process.env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
assert.equal(createAuth({} as never).options.emailAndPassword?.disableSignUp, false);
console.log("Email-domain policy passed: exact domains, account create/update guards, verified identity enforcement, and closed sign-up without mail.");
