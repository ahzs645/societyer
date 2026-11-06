/** Real browser and provider checks against a disposable loopback deployment. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { chromium, expect, type Page } from "@playwright/test";
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
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await page.waitForURL(/\/login\?reset=1/);
    assert.equal((await signIn(page)).status(), 200);
  } else {
    await page.goto(origin + "/login?mode=sign-up&redirect=%2Faccount%2Fsecurity");
    await page.getByLabel("Full name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
  }
  await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();

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

  if (broker === "convex" && selector) {
    // Closing new enrollment must not turn off challenges for existing users.
    setConvexEnrollment(selector, false);
    enrollmentClosed = true;
  }
  const totpPage = await browser.newPage();
  await expectChallenge(totpPage);
  await totpPage.getByLabel("Authenticator code").fill(await authenticator.totp());
  await totpPage.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(totpPage.getByText("Two-factor authentication is on.")).toBeVisible();

  const recoveryPage = await browser.newPage();
  await expectChallenge(recoveryPage);
  await recoveryPage.getByRole("button", { name: "Use a backup code" }).click();
  await recoveryPage.getByLabel("Backup code").fill(backupCode);
  await recoveryPage.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(recoveryPage.getByText("Two-factor authentication is on.")).toBeVisible();

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
  if (enrollmentClosed) {
    await expect(page.getByText("Authenticator enrollment is closed for this instance.")).toBeVisible();
    const denied = await page.evaluate(async currentPassword => {
      const path = "/src/lib/convexAuthClient.ts";
      const { authClient } = await import(path);
      return (await authClient.twoFactor.enable({ password: currentPassword, method: "totp" })).error?.status;
    }, password);
    assert.equal(denied, 403);
  }
  console.log(`${broker}: QR enrollment, pre-MFA token denial, TOTP sign-in, single-use recovery, and disabling 2FA passed.`);
} finally {
  await browser.close();
  if (selector && enrollmentClosed) setConvexEnrollment(selector, true);
}
