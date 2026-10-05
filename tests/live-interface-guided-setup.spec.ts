import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";
import { assertLiveFits, liveFixture } from "./helpers/liveInterface";

// Fresh accounts and labelled workspaces belong only to the disposable lab.
// Neither identity nor membership transport is mocked; cookies/tokens stay in
// ignored Playwright output, never in committed qualification artifacts.
for (const existing of [false, true]) {
  test(`fresh hosted account can set up ${existing ? "an existing" : "a proposed"} organization with its own Owner boundary`, async ({ page }, info) => {
    const origin = new URL(info.project.use.baseURL ?? "http://127.0.0.1:43477").origin;
    expect(origin).toBe("http://127.0.0.1:43477");
    const marker = randomBytes(12).toString("hex");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/login");
    await page.getByRole("button", { name: "Need an account? Sign up", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill("Qualification setup user");
    await page.getByLabel("Email", { exact: true }).fill(`guided-${marker}@qualification.example.test`);
    await page.getByLabel("Password", { exact: true }).fill(`Pilot-${randomBytes(24).toString("hex")}`);
    const signupResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/sign-up/email");
    await page.getByRole("button", { name: "Create your account", exact: true }).click();
    const signup = await signupResponse;
    expect(signup.ok(), "Real Better Auth account creation must succeed").toBe(true);
    await expect(page.getByRole("heading", { name: "Set up your workspace", exact: true })).toBeVisible();
    await assertLiveFits(page);
    await page.getByRole("link", { name: "Set up an organization", exact: true }).click();
    const name = `Qualification guided ${existing ? "existing" : "proposed"} ${marker}`;
    await completeGuidedOrganizationSetup(page, name, existing);
    await page.reload();
    await expect(page.getByText("Workspace onboarding").first()).toBeVisible();
    await assertLiveFits(page);
    const auth = await page.context().request.get("/api/auth/token");
    expect(auth.ok()).toBe(true);
    const { token } = await auth.json();
    const client = new ConvexHttpClient("http://127.0.0.1:43230", { logger: false });
    client.setAuth(token);
    const memberships: any = await client.query(makeFunctionReference("http:currentPrincipalMemberships"), {});
    expect(memberships.status).toBe("bound");
    expect(memberships.memberships).toHaveLength(1);
    const membership = memberships.memberships[0];
    expect(membership.role).toBe("Owner");
    expect(membership.society.name).toBe(name);
    expect(membership.society.formationStatus).toBe(existing ? "unverified_existing" : "preparing");
    const answers = JSON.parse(membership.society.onboardingAnswersJson);
    expect(answers.organizationStage).toBe(existing ? "existing" : "preparing");
    expect(membership.society.certificateEvidenceDocumentId).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(membership.society._id);
    expect(membership.society._id).not.toBe(liveFixture().societyId);
    await expect(client.query(makeFunctionReference("society:getById"), { id: liveFixture().societyId })).rejects.toThrow();
    expect(errors).toEqual([]);
  });
}
