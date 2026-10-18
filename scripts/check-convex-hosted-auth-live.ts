/**
 * Live check for the Convex-hosted session broker (AUTH_MODE=convex) against a
 * running deployment, using the same Better Auth client plugins as the app.
 *
 * Emails go to a local stand-in for the Resend API, so the deployment needs:
 *   AUTH_MODE=convex  SITE_URL=<LIVE_SITE_URL>  BETTER_AUTH_SECRET=<32+ chars>
 *   RESEND_API_KEY=test  RESEND_FROM_EMAIL=auth@example.org
 *   RESEND_API_BASE_URL=http://127.0.0.1:<MOCK_MAIL_PORT>/emails
 *
 * Run: LIVE_CONVEX_URL=http://127.0.0.1:3210 LIVE_CONVEX_SITE_URL=http://127.0.0.1:3211 \
 *      LIVE_SITE_URL=http://127.0.0.1:5173 MOCK_MAIL_PORT=4599 npx tsx scripts/check-convex-hosted-auth-live.ts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAuthClient } from "better-auth/client";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convexUrl = process.env.LIVE_CONVEX_URL;
const convexSiteUrl = process.env.LIVE_CONVEX_SITE_URL;
const siteUrl = process.env.LIVE_SITE_URL ?? "http://127.0.0.1:5173";
const mailPort = Number(process.env.MOCK_MAIL_PORT ?? 4599);
if (!convexUrl || !convexSiteUrl) {
  console.log("Skipped: set LIVE_CONVEX_URL and LIVE_CONVEX_SITE_URL to run the live Convex-hosted auth check.");
  process.exit(0);
}

type Mail = { to: string[]; subject: string; text: string };
const outbox: Mail[] = [];
const mailServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    outbox.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: `mock-${outbox.length}` }));
  });
});
await new Promise<void>((resolve) => mailServer.listen(mailPort, "127.0.0.1", resolve));

const run = Date.now().toString(36);
const linkTo = (address: string, subject: RegExp) => {
  const mail = [...outbox].reverse().find((m) => m.to.includes(address) && subject.test(m.subject));
  assert.ok(mail, `Expected a "${subject}" email to ${address}`);
  const url = mail.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(url, "Email contains a link");
  return url;
};

/** One browser: its own cookie storage, Better Auth client and Convex client. */
// A self-hosted backend with no proxy in front takes the client IP from
// X-Forwarded-For, so locally each simulated browser can have its own address.
// Convex Cloud sets the client IP itself and the per-IP step is skipped there.
const simulateIps = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(convexUrl);
// Fresh simulated addresses per run, so earlier runs' throttle buckets don't carry over.
const ipBlock = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let browsers = 0;
const ipHeaders = (ip: string) => (simulateIps ? { "x-forwarded-for": ip } : {});
function browser() {
  const ip = ipHeaders(`${ipBlock}.${++browsers % 250}`);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const auth = createAuthClient({
    baseURL: convexSiteUrl,
    plugins: [convexClient(), crossDomainClient({ storage })],
    fetchOptions: { headers: { origin: siteUrl, ...ip } },
  });
  const convex = new ConvexHttpClient(convexUrl!);
  return {
    auth,
    convex,
    async connect() {
      const { data } = await auth.convex.token();
      assert.ok(data?.token, "Signed-in browser receives a Convex token");
      convex.setAuth(data.token);
      return data.token;
    },
  };
}

async function signUpAndVerify(email: string, name: string, password: string) {
  const b = browser();
  const signUp = await b.auth.signUp.email({ email, name, password, callbackURL: `${siteUrl}/login?verified=1` });
  assert.equal(signUp.error, null, `sign-up for ${email}: ${JSON.stringify(signUp.error)}`);
  const early = await b.auth.signIn.email({ email, password, callbackURL: `${siteUrl}/login?verified=1` });
  assert.equal(early.error?.status, 403, "Unverified accounts cannot sign in while email delivery is configured");
  const verify = await fetch(linkTo(email, /Verify/), { redirect: "manual" });
  assert.equal(verify.status, 302, "Verification link redirects back to the app");
  assert.ok(verify.headers.get("location")?.startsWith(`${siteUrl}/login?verified=1`), `verify redirect: ${verify.headers.get("location")}`);
  const signIn = await b.auth.signIn.email({ email, password });
  assert.equal(signIn.error, null, `sign-in for ${email}: ${JSON.stringify(signIn.error)}`);
  await b.connect();
  return b;
}

try {
  // Deployment advertises the broker and email delivery.
  const anonymous = new ConvexHttpClient(convexUrl);
  // Instance name and support email are optional display settings the test deployment may carry.
  const { instanceName: _instanceName, supportEmail: _supportEmail, ...capabilities } = await anonymous.query(api.http.authCapabilities, {});
  assert.deepEqual(capabilities, { mode: "convex", emailDelivery: true, allowedEmailDomains: [], signUpEnabled: true });

  // 1. Sign up, verify, create a workspace as Owner.
  const aliceEmail = `alice-${run}@example.org`;
  const alice = await signUpAndVerify(aliceEmail, "Alice Owner", "correct-horse-battery");
  assert.deepEqual((await alice.convex.query(api.http.currentPrincipalMemberships, {})).memberships, []);
  assert.equal((await alice.convex.query(api.http.workspaceCreationAccess, {})).allowed, true);
  const { societyId } = await alice.convex.mutation(api.society.createWorkspace, { name: `Live Society ${run}`, seedDocumentPackets: false });
  const [aliceMembership] = (await alice.convex.query(api.http.currentPrincipalMemberships, {})).memberships;
  assert.equal(aliceMembership.society._id, societyId);
  assert.equal(aliceMembership.user.role, "Owner");
  assert.equal(aliceMembership.user.authIssuer, convexSiteUrl, "Membership is bound to this deployment's issuer");
  assert.equal(aliceMembership.user.email, aliceEmail);

  // 2. Sign out, then sign in from a new browser: same identity and membership.
  await alice.auth.signOut();
  assert.equal((await alice.auth.convex.token()).data?.token ?? null, null, "Signed-out browser gets no token");
  const aliceAgain = browser();
  assert.equal((await aliceAgain.auth.signIn.email({ email: aliceEmail, password: "correct-horse-battery" })).error, null);
  await aliceAgain.connect();
  assert.deepEqual(await aliceAgain.convex.mutation(api.users.ensureCurrentMembership, { societyId }),
    { status: "bound", societyId, userId: aliceMembership.userId }, "A new session resolves the same membership");
  const wrong = await browser().auth.signIn.email({ email: aliceEmail, password: "wrong-password-123" });
  assert.equal(wrong.error?.status, 401, "Wrong password is rejected");

  // 3. Invite a brand-new person; they sign up, verify and accept.
  const carolEmail = `carol-${run}@example.org`;
  const invite = await aliceAgain.convex.mutation(api.invitations.create, { societyId, email: carolEmail, role: "Director" });
  const carol = await signUpAndVerify(carolEmail, "Carol New", "carol-strong-password");
  const accepted = await carol.convex.mutation(api.invitations.accept, { token: invite.token });
  assert.equal(accepted.status, "invitation-accepted", "Verified email claim reaches Convex");
  const [carolMembership] = (await carol.convex.query(api.http.currentPrincipalMemberships, {})).memberships;
  assert.equal(carolMembership.user.role, "Director");
  await assert.rejects(() => carol.convex.query(api.invitations.list, { societyId }), /required/, "Director cannot manage invitations");

  // 4. Invite someone who already has an account and a workspace of their own.
  const bobEmail = `bob-${run}@example.org`;
  const bob = await signUpAndVerify(bobEmail, "Bob Existing", "bob-strong-password");
  const { societyId: bobSocietyId } = await bob.convex.mutation(api.society.createWorkspace, { name: `Bob Club ${run}`, seedDocumentPackets: false });
  const bobInvite = await aliceAgain.convex.mutation(api.invitations.create, { societyId, email: bobEmail, role: "Viewer" });
  assert.equal((await bob.convex.mutation(api.invitations.accept, { token: bobInvite.token })).status, "invitation-accepted");
  const bobRoles = Object.fromEntries((await bob.convex.query(api.http.currentPrincipalMemberships, {})).memberships
    .map((m: any) => [m.society._id, m.user.role]));
  assert.deepEqual(bobRoles, { [societyId]: "Viewer", [bobSocietyId]: "Owner" });

  // 5. Password reset by email, then sign in with the new password.
  const reset = await browser().auth.requestPasswordReset({ email: carolEmail, redirectTo: `${siteUrl}/reset-password` });
  assert.equal(reset.error, null);
  const resetLanding = await fetch(linkTo(carolEmail, /Reset/), { redirect: "manual" });
  const resetToken = new URL(resetLanding.headers.get("location")!).searchParams.get("token");
  assert.ok(resetToken, "Reset link hands the app a token");
  assert.equal((await browser().auth.resetPassword({ newPassword: "carol-new-password-1", token: resetToken })).error, null);
  assert.equal((await browser().auth.signIn.email({ email: carolEmail, password: "carol-strong-password" })).error?.status, 401, "Old password stops working");
  const carolAgain = browser();
  assert.equal((await carolAgain.auth.signIn.email({ email: carolEmail, password: "carol-new-password-1" })).error, null);
  await carolAgain.connect();
  assert.equal((await carolAgain.convex.query(api.http.currentPrincipalMemberships, {})).memberships[0].user.role, "Director");

  // 6. Disabling a membership blocks that workspace for the live session.
  const carolRow = carolMembership.user;
  await aliceAgain.convex.mutation(api.users.upsert, { id: carolMembership.userId, societyId, email: carolRow.email, displayName: carolRow.displayName, role: carolRow.role, status: "Disabled" });
  assert.equal((await carolAgain.convex.mutation(api.users.ensureCurrentMembership, { societyId })).status, "membership-disabled");

  // 7. Forged tokens are rejected by Convex.
  const forged = new ConvexHttpClient(convexUrl);
  forged.setAuth("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.invalid");
  await assert.rejects(() => forged.query(api.http.currentPrincipalMemberships, {}));

  // 8. Sign-in throttling, per account and per client IP.
  const attempt = (email: string, password: string, ip: string) => createAuthClient({
    baseURL: convexSiteUrl, plugins: [convexClient()],
    fetchOptions: { headers: { origin: siteUrl, ...ipHeaders(ip) } },
  }).signIn.email({ email, password });
  const lockEmail = `lockout-${run}@example.org`;
  await signUpAndVerify(lockEmail, "Lockout Target", "lockout-right-password");
  // A success refills the account's allowance, so only failures in a row add up.
  for (let i = 0; i < 5; i++) assert.equal((await attempt(lockEmail, "wrong-password-123", `${ipBlock}.${10 + i}`)).error?.status, 401);
  assert.equal((await attempt(lockEmail, "lockout-right-password", `${ipBlock}.20`)).error, null, "Correct password still works");
  const failures = [];
  for (let i = 0; i < 11; i++) failures.push((await attempt(lockEmail, "wrong-password-123", `${ipBlock}.${30 + i}`)).error?.status);
  assert.deepEqual(failures, [...Array(10).fill(401), 429], "11th failure in a row is throttled even from a new IP each time");
  const locked = await attempt(lockEmail, "lockout-right-password", `${ipBlock}.50`);
  assert.equal(locked.error?.status, 429, "While throttled, the account refuses even the right password");
  assert.match(locked.error?.message ?? "", /Try again in \d+ minute/);
  if (simulateIps) {
    // One address trying many accounts runs out after 30 attempts.
    const sprayIp = `${ipBlock}.251`;
    const spray = [];
    for (let i = 0; i < 31; i++) spray.push((await attempt(`spray-${i}-${run}@example.org`, "wrong-password-123", sprayIp)).error?.status);
    assert.deepEqual(spray, [...Array(30).fill(401), 429], "31st attempt from one IP is throttled");
    assert.equal((await attempt(`spray-x-${run}@example.org`, "wrong-password-123", `${ipBlock}.252`)).error?.status, 401, "Another IP keeps its own allowance");
  }

  console.log(`Live Convex-hosted auth checks passed: sign-up, email verification, Owner workspace, re-login, invites (new and existing accounts), password reset, disable, forged token, per-account throttling${simulateIps ? ", per-IP throttling" : ""}.`);
} finally {
  mailServer.close();
}
