import { expect, test } from "@playwright/test";

test("public records contain long stakeholder content and suppress unsafe legacy links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo/app/transparency");
  await expect(page.getByRole("heading", { name: "Public transparency", exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType("resource").map(entry => entry.name).find(url => new URL(url).pathname === "/src/lib/localDataClient.ts");
    if (!moduleUrl) throw new Error("The normal application client was not loaded.");
    const { localDataClient } = await import(moduleUrl);
    const societyId = "static_society_riverside";
    const marker = "Stakeholder".repeat(45);
    await localDataClient.mutation("transparency:upsertPublication", {
      societyId, title: marker, category: "Notice", status: "Published", reviewStatus: "Approved", url: "javascript:alert('legacy')",
    });
    const token = crypto.randomUUID();
    await localDataClient.mutation("partyPortals:create", {
      societyId, token, label: marker, scopes: ["publications"], allowDownload: false,
    });
    return { marker, token };
  });
  const navigate = async (path: string) => page.evaluate(url => {
    history.pushState({}, "", url); dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await navigate("/demo/public/riverside-community-society");
  await expect(page.getByText("Local public-page preview", { exact: true })).toBeVisible();
  const article = page.getByRole("article").filter({ hasText: fixture.marker });
  await expect(article).toBeVisible();
  await expect(article.getByRole("link")).toHaveCount(0);
  await expect(article.getByText("No file or public link attached yet.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 2);
  await navigate(`/demo/portal/${fixture.token}`);
  await expect(page.getByRole("heading", { name: "Publications", exact: true })).toBeVisible();
  const region = page.getByRole("region", { name: "Publications", exact: true });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 2);
  expect(errors).toEqual([]);
});

test("publication editor explains invalid public links before saving", async ({ page }) => {
  await page.goto("/demo/app/transparency");
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Publish item", exact: true });
  await drawer.getByLabel("Title", { exact: true }).fill("Unsafe public link regression");
  await drawer.getByLabel("External URL", { exact: true }).fill("data:text/html,<script>alert(1)</script>");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Use a valid HTTP or HTTPS public link.", { exact: true })).toBeVisible();
  await expect(drawer).toBeVisible();
});

test("public intake does not assign a visitor's membership from another workspace", async ({ page }) => {
  // This scenario creates a second real workspace and member, then submits
  // two forms. Individual field/assertion deadlines remain unchanged.
  test.setTimeout(90_000);
  await page.goto("/demo/app/users");
  await expect(page.getByRole("heading", { name: "Users & access", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType("resource").map(entry => entry.name);
    const clientUrl = resources.find(url => new URL(url).pathname === "/src/lib/localDataClient.ts");
    const actorUrl = resources.find(url => new URL(url).pathname === "/src/hooks/useCurrentUser.ts");
    if (!clientUrl || !actorUrl) throw new Error("The normal application modules were not loaded.");
    const { localDataClient } = await import(clientUrl);
    const foreign = await localDataClient.mutation("society:createWorkspace", { name: "Foreign applicant workspace" });
    const memberId = await localDataClient.mutation("members:create", {
      societyId: foreign.societyId, firstName: "Public", lastName: "Visitor", membershipClass: "Regular",
      status: "Active", joinedAt: "2026-01-01", votingRights: true,
    });
    const visitorId = await localDataClient.mutation("users:upsert", {
      societyId: foreign.societyId, displayName: "Public visitor", email: "visitor@example.test", role: "Member", status: "Active", memberId,
    });
    (window as any).__publicVisitorId = visitorId;
    // Capture the actual rendered form payload. Server intake authority is
    // tested separately; a trusted device principal is not a hosted visitor.
    const originalMutation = localDataClient.mutation.bind(localDataClient);
    (window as any).__publicIntakePayloads = [];
    (window as any).__foreignApplicantObserved = false;
    const originalWatch = localDataClient.watchQuery.bind(localDataClient);
    localDataClient.watchQuery = (reference: any, args: any) => {
      const watcher = originalWatch(reference, args);
      const name = typeof reference === "string" ? reference : reference?.[Symbol.for("functionName")];
      if (name !== "users:get" || args?.id !== visitorId) return watcher;
      return { ...watcher, localQueryResult() {
        const row = watcher.localQueryResult();
        if (row?.memberId === memberId && row?.societyId === foreign.societyId) (window as any).__foreignApplicantObserved = true;
        return row;
      } };
    };
    localDataClient.mutation = (reference: any, args: any) => {
      const name = typeof reference === "string" ? reference : reference?.[Symbol.for("functionName")];
      if (name === "volunteers:submitApplication" || name === "grants:submitApplication") {
        (window as any).__publicIntakePayloads.push({ name, args });
        return Promise.resolve("captured-ui-contract");
      }
      return originalMutation(reference, args);
    };
    history.pushState({}, "", "/demo/public/riverside-community-society/volunteer-apply");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  // Select the visitor after the public renderer mounts. The departing local
  // workspace UserPicker otherwise legitimately restores its own Owner.
  await expect(page.getByRole("textbox", { name: "First name", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const actorUrl = performance.getEntriesByType("resource").map(entry => entry.name).find(url => new URL(url).pathname === "/src/hooks/useCurrentUser.ts");
    if (!actorUrl) throw new Error("The normal actor module was not loaded.");
    const { setStoredUserId } = await import(actorUrl);
    setStoredUserId((window as any).__publicVisitorId);
  });
  await page.getByRole("textbox", { name: "First name", exact: true }).fill("Public");
  await page.getByRole("textbox", { name: "Last name", exact: true }).fill("Visitor");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("visitor@example.test");
  await page.getByRole("textbox", { name: "Role or area of interest", exact: true }).fill("Community helper");
  await expect.poll(() => page.evaluate(() => (window as any).__foreignApplicantObserved)).toBe(true);
  await page.getByRole("button", { name: /Submit application/i }).click();
  await expect(page.getByRole("heading", { name: "Application submitted", exact: true })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/demo/public/riverside-community-society/grant-apply");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("textbox", { name: "Applicant name", exact: true }).fill("Public Visitor");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("visitor@example.test");
  await page.getByRole("spinbutton", { name: "Requested amount", exact: true }).fill("50");
  await page.getByRole("textbox", { name: "Project title", exact: true }).fill("Community project");
  await page.getByRole("textbox", { name: "Project summary", exact: true }).fill("Public intake project summary.");
  await page.getByRole("button", { name: /Submit funding request/i }).click();
  await expect(page.getByRole("heading", { name: "Funding request submitted", exact: true })).toBeVisible();
  const payloads = await page.evaluate(() => (window as any).__publicIntakePayloads);
  expect(payloads).toHaveLength(2);
  for (const payload of payloads) {
    expect(payload.args.societyId).toBe("static_society_riverside");
    expect(payload.args.memberId).toBeUndefined();
    expect(payload.args.source).toBe("public");
  }
});
