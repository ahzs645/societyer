import assert from "node:assert/strict";
import { sendEmail } from "../convex/providers/email";
import { emailProviderConfiguration } from "../shared/emailConfiguration";

const keys = ["SOCIETYER_EMAIL_PROVIDER", "MICROSOFT_MAIL_TENANT_ID", "MICROSOFT_MAIL_CLIENT_ID", "MICROSOFT_MAIL_CLIENT_SECRET", "MICROSOFT_MAIL_SENDER", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_FROM", "RESEND_API_BASE_URL"];
const original = new Map(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit }[] = [];
const tenant = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
let tokenStatus = 200;
let graphStatus = 202;
let malformedToken = false;
const message = { to: "Ahmad@ddcnorth.com", subject: "Fixture verification", html: '<p><a href="https://app.example.test/verify?token=fixture">Verify</a></p>', text: "Fixture verification" };

try {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    SOCIETYER_EMAIL_PROVIDER: "microsoft365", MICROSOFT_MAIL_TENANT_ID: tenant,
    MICROSOFT_MAIL_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
    MICROSOFT_MAIL_CLIENT_SECRET: "fixture-secret", MICROSOFT_MAIL_SENDER: "societyer@ddcnorth.com",
    RESEND_API_KEY: "fixture-resend-key", RESEND_FROM_EMAIL: "Societyer <fixture@example.test>",
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init! });
    assert.equal(init?.redirect, "error");
    if (url === `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(String(init!.body));
      assert.equal(form.get("scope"), "https://graph.microsoft.com/.default");
      assert.equal(form.get("grant_type"), "client_credentials");
      assert.equal(form.get("client_secret"), "fixture-secret");
      return Response.json(malformedToken ? {} : { access_token: "fixture-access-token", token_type: "Bearer" }, { status: tokenStatus });
    }
    if (url === "https://graph.microsoft.com/v1.0/users/societyer%40ddcnorth.com/sendMail") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer fixture-access-token");
      assert.match(headers.get("client-request-id")!, /^[0-9a-f-]{36}$/);
      const body = JSON.parse(String(init!.body));
      assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: message.to } }]);
      assert.deepEqual(body.message.body, { contentType: "HTML", content: message.html });
      assert.equal(body.saveToSentItems, true);
      return new Response(graphStatus === 202 ? null : "provider-private-error-must-not-leak", { status: graphStatus });
    }
    if (url === "https://api.resend.com/emails") return Response.json({ id: "fixture-resend-id" });
    throw new Error("Unexpected outbound URL in fixture");
  };
  const sent = await sendEmail(message);
  assert.equal(sent.provider, "microsoft365");
  assert.equal(sent.accepted, true);
  assert.match(sent.id, /^microsoft365:/);
  assert.equal(calls.length, 2);
  calls.length = 0;
  graphStatus = 403;
  await assert.rejects(sendEmail(message), error => error instanceof Error && /status 403/.test(error.message) && !error.message.includes("private-error"));
  assert.equal(calls.length, 2, "No fallback or second send after Graph rejects access");
  calls.length = 0;
  tokenStatus = 401;
  await assert.rejects(sendEmail(message), /authentication failed with status 401/);
  assert.equal(calls.length, 1);
  calls.length = 0;
  tokenStatus = 200; malformedToken = true;
  await assert.rejects(sendEmail(message), /invalid token response/);
  assert.equal(calls.length, 1);
  calls.length = 0;
  delete process.env.MICROSOFT_MAIL_CLIENT_SECRET;
  assert.equal(emailProviderConfiguration(process.env).live, false);
  await assert.rejects(sendEmail(message), /configured provider/);
  assert.equal(calls.length, 0, "Incomplete Microsoft configuration cannot silently send with Resend");
  assert.equal((await sendEmail({ ...message, demo: true })).provider, "demo");
  assert.equal(calls.length, 0);
  process.env.SOCIETYER_EMAIL_PROVIDER = "resend";
  const resend = await sendEmail(message);
  assert.equal(resend.id, "fixture-resend-id");
  assert.equal(resend.provider, "resend");
  assert.equal(calls.length, 1);
  assert.throws(() => emailProviderConfiguration({ SOCIETYER_EMAIL_PROVIDER: "unknown" }), /must be/);
  assert.equal(emailProviderConfiguration({ SOCIETYER_EMAIL_PROVIDER: "microsoft365", MICROSOFT_MAIL_TENANT_ID: "../common", MICROSOFT_MAIL_CLIENT_ID: "invalid", MICROSOFT_MAIL_CLIENT_SECRET: "fixture", MICROSOFT_MAIL_SENDER: "x@example.test" }).live, false);
  console.log("Email providers passed: Microsoft Graph acceptance, scoped sender request, token and access failures, no secret leakage or automatic failover, explicit demo, Resend selection, and fail-closed configuration. No external email sent.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
