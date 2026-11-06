/** Real browser and provider checks against a disposable loopback deployment. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { chromium, expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { decodeJwt } from "jose";
import { api } from "../convex/_generated/api";
import { chromiumLaunchOptions } from "../playwright.chromium";

function loopback(value: string | undefined) {
  const url = new URL(value ?? "");
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1", "Only use a disposable loopback deployment");
  return url.origin;
}

const broker = process.env.AUTHENTICATOR_TEST_BROKER ?? "convex";
assert.ok(broker === "convex" || broker === "better-auth");
const origin = loopback(process.env.AUTHENTICATOR_TEST_APP);
const selector = process.env.AUTHENTICATOR_TEST_ENV_FILE;
const email = `authenticator-${randomBytes(8).toString("hex")}@example.test`;
const name = "Authenticator qualification";
const password = `Test-${randomBytes(24).toString("hex")}`;
const browser = await chromium.launch(chromiumLaunchOptions());
expect.configure({ timeout: 15000 });
let enrollmentClosed = false;

function setConvexEnrollment(file: string, enabled: boolean) {
  execFileSync("./node_modules/.bin/convex", ["env", "set", "--env-file", file, "SOCIETYER_AUTH_TOTP_ENROLLMENT", enabled ? "1" : "0"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function verifyNoToken(page: Page) {
  const result = await page.evaluate(async (mode) => {
    const path = mode === "convex" ? "/src/lib/convexAuthClient.ts" : "/src/lib/authClient.ts";
    const { authClient, fetchConvexToken } = await import(path);
    return { session: Boolean((await authClient.getSession()).data), token: Boolean(await fetchConvexToken()) };
  }, broker);
  assert.deepEqual(result, { session: false, token: false });
}

async function workspaceSession(page: Page, verified: boolean) {
  const { url, token } = await page.evaluate(async (mode) => {
    const path = mode === "convex" ? "/src/lib/convexAuthClient.ts" : "/src/lib/authClient.ts";
    const runtimePath = "/src/lib/appRuntime.ts";
    const { fetchConvexToken } = await import(path);
    const { resolvedConvexUrl } = await import(runtimePath);
    return { url: resolvedConvexUrl(), token: await fetchConvexToken() };
  }, broker);
  assert.ok(token, "Expected a signed Convex token for the browser's current session");
  assert.equal(decodeJwt(token).societyer_mfa_verified === true, verified);
  const client = new ConvexHttpClient(loopback(url), { logger: false });
  client.setAuth(token);
  return client;
}

async function verifyChallenge(page: Page, path: "verify-totp" | "verify-backup-code") {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === `/api/auth/two-factor/${path}` && item.request().method() === "POST");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  const result = await response;
  assert.equal(result.status(), 200, result.ok() ? undefined : (await result.json().catch(() => ({}))).code);
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible({ timeout: 15000 });
}

async function signIn(page: Page) {
  await page.goto(origin + "/login?redirect=%2Faccount%2Fsecurity");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signInResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/sign-in/email" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return signInResponse;
}

async function expectChallenge(page: Page) {
  const response = await signIn(page);
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.twoFactorRedirect, true);
  assert.equal(Boolean(result.token || response.headers()["set-auth-jwt"]), false);
  await expect(page.getByRole("heading", { name: "Verify your sign-in" })).toBeVisible();
  await verifyNoToken(page);
}

try {
  const page = await browser.newPage();
  if (broker === "convex") {
    assert.ok(selector, "Provide a local self-hosted Convex selector");
    loopback(parseEnv(readFileSync(selector, "utf8")).CONVEX_SELF_HOSTED_URL);
    const link: string = JSON.parse(execFileSync("./node_modules/.bin/convex", [
      "run", "--env-file", selector, "hostedAuth:provisionAccount", JSON.stringify({ name, email }),
    ], { encoding: "utf8" }).trim());
    assert.equal(new URL(link).origin, origin);
    const resetToken = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    assert.ok(resetToken);
    const stalePage = await browser.newPage();
    await stalePage.goto(`${origin}/reset-password?${new URLSearchParams({ token: resetToken })}`);
    await expect(stalePage.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await page.waitForURL(/\/login\?reset=1/);

    // A link opened before the first reset still cannot be submitted twice.
    await stalePage.getByLabel("New password", { exact: true }).fill(`${password}-replay`);
    await stalePage.getByLabel("Confirm new password", { exact: true }).fill(`${password}-replay`);
    await stalePage.getByRole("button", { name: "Change password" }).click();
    await expect(stalePage.getByRole("heading", { name: "This reset link doesn't work" })).toBeVisible();
    await stalePage.goto(link);
    await expect(stalePage.getByRole("heading", { name: "This reset link doesn't work" })).toBeVisible();
    await expect(stalePage.getByLabel("New password", { exact: true })).toHaveCount(0);
    await stalePage.close();
    assert.equal((await signIn(page)).status(), 200);
    console.log("convex: setup link opened once, rejected a stale-tab replay, and hid the form on reopening.");
  } else {
    await page.goto(origin + "/login?mode=sign-up&redirect=%2Faccount%2Fsecurity");
    await page.getByLabel("Full name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
  }
  await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();
  const passwordOnly = await workspaceSession(page, false);
  const { societyId: primary } = await passwordOnly.mutation(api.society.createWorkspace, { name: `Protected ${email}`, seedDocumentPackets: false });
  const { societyId: secondary } = await passwordOnly.mutation(api.society.createWorkspace, { name: `Optional ${email}`, seedDocumentPackets: false });
  assert.equal(await passwordOnly.query(api.workspaceMfa.getPolicy, { societyId: primary }), "optional");
  await assert.rejects(passwordOnly.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "everyone" }), /Verify two-factor/);

  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
  const secret = await page.getByLabel("Authenticator setup key").textContent();
  assert.ok(secret);
  const authenticator = createOTP(base32.decode(secret));
  await page.getByLabel("Authenticator code").fill(await authenticator.totp());
  await page.getByRole("button", { name: "Verify and enable" }).click();
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
  const backupCode = await page.getByRole("list", { name: "Backup codes" }).getByRole("listitem").first().textContent();
  assert.ok(backupCode);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();
  const verified = await workspaceSession(page, true);
  await page.goto(origin + "/app/users");
  await expect(page.getByRole("heading", { name: "Require 2FA" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Require 2FA", exact: true }).click();
  await page.getByText("Owners and Admins", { exact: true }).click();
  await page.getByRole("button", { name: "Save 2FA policy" }).click();
  await expect(page.getByText("Workspace 2FA policy saved")).toBeVisible();
  const policies = await Promise.all([primary, secondary].map(societyId => verified.query(api.workspaceMfa.getPolicy, { societyId })));
  assert.deepEqual([...policies].sort(), ["optional", "owners-admins"]);
  const [protectedId, optionalId] = policies[0] === "owners-admins" ? [primary, secondary] : [secondary, primary];
  const access = await passwordOnly.query(api.http.currentPrincipalMemberships, {});
  assert.deepEqual(access.memberships.map((membership: any) => membership.society._id), [optionalId]);
  assert.deepEqual(access.lockedWorkspaces.map((workspace: any) => workspace.id), [protectedId]);
  await assert.rejects(passwordOnly.query(api.society.getById, { id: protectedId }), /two-factor|not found/i);
  await page.goto(origin + "/account/security");

  if (broker === "convex" && selector) {
    // Closing new enrollment must not turn off challenges for existing users.
    setConvexEnrollment(selector, false);
    enrollmentClosed = true;
  }
  const totpPage = await browser.newPage();
  await expectChallenge(totpPage);
  await totpPage.getByLabel("Authenticator code").fill(await authenticator.totp());
  await verifyChallenge(totpPage, "verify-totp");
  const totpSession = await workspaceSession(totpPage, true);
  assert.equal(await totpSession.query(api.workspaceMfa.getPolicy, { societyId: protectedId }), "owners-admins");

  const recoveryPage = await browser.newPage();
  await expectChallenge(recoveryPage);
  await recoveryPage.getByRole("button", { name: "Use a backup code" }).click();
  await recoveryPage.getByLabel("Backup code").fill(backupCode);
  await verifyChallenge(recoveryPage, "verify-backup-code");
  await workspaceSession(recoveryPage, true);

  const replayPage = await browser.newPage();
  await expectChallenge(replayPage);
  await replayPage.getByRole("button", { name: "Use a backup code" }).click();
  await replayPage.getByLabel("Backup code").fill(backupCode);
  await replayPage.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(replayPage.getByRole("alert")).toContainText(/invalid backup code/i);
  await verifyNoToken(replayPage);

  await page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Turn off two-factor authentication" }).click();
  await expect(page.getByText("Two-factor authentication is off.")).toBeVisible();
  const disabled = await workspaceSession(page, false);
  const afterDisabling = await disabled.query(api.http.currentPrincipalMemberships, {});
  assert.deepEqual(afterDisabling.memberships.map((membership: any) => membership.society._id), [optionalId]);
  assert.deepEqual(afterDisabling.lockedWorkspaces.map((workspace: any) => workspace.id), [protectedId]);
  if (enrollmentClosed) {
    await expect(page.getByText("Authenticator enrollment is closed for this instance.")).toBeVisible();
    const denied = await page.evaluate(async currentPassword => {
      const path = "/src/lib/convexAuthClient.ts";
      const { authClient } = await import(path);
      return (await authClient.twoFactor.enable({ password: currentPassword, method: "totp" })).error?.status;
    }, password);
    assert.equal(denied, 403);
  }
  await page.goto(origin + "/app/users");
  await expect(page.getByRole("heading", { name: "Require 2FA" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: new RegExp(`select workspace.*${afterDisabling.memberships[0].society.name}`, "i") }).click();
  const locked = page.getByRole("region", { name: "Workspaces requiring two-factor authentication" });
  await expect(locked).toContainText(`Two-factor authentication required for ${afterDisabling.lockedWorkspaces[0].name}.`);
  await expect(locked.getByRole("link", { name: "Manage account security" })).toBeVisible();
  console.log(`${broker}: QR enrollment, workspace policy, tenant isolation, TOTP sign-in, single-use recovery, and disabling 2FA passed.`);
} finally {
  await browser.close();
  if (selector && enrollmentClosed) setConvexEnrollment(selector, true);
}
