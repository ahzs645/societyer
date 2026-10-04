import { expect, test } from "@playwright/test";
import { assertLiveFits, signInLive } from "./helpers/liveInterface";

// Chromium does not expose WebMCP in this lab. Only the browser registration
// API is supplied; authentication, queries and mutations use actual Convex.
// This qualifies Societyer's tool contract, not external agent integration.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, any>();
    const modelContext = {
      registerTool(tool: any, options: { signal?: AbortSignal } = {}) {
        if (tools.has(tool.name)) return Promise.reject(new Error("Duplicate tool"));
        tools.set(tool.name, tool);
        options.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        return Promise.resolve();
      },
      names: () => Array.from(tools.keys()),
      execute(name: string, input: unknown) {
        const tool = tools.get(name);
        if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
        return tool.execute(input);
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    Object.defineProperty(window, "__liveWebMcp", { configurable: true, value: modelContext });
  });
});

for (const role of ["Owner", "Member", "Viewer"]) {
  test(`${role} live WebMCP contract respects resource reads and task writes`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signInLive(page, role);
    await expect.poll(() => page.locator("html").getAttribute("data-webmcp-tools")).toContain("get_governance_snapshot");
    await expect.poll(() => page.evaluate(async () => {
      try { return await (window as any).__liveWebMcp.execute("get_governance_snapshot", { maxItems: 20 }); }
      catch { return null; }
    })).not.toBeNull();
    const snapshot = await page.evaluate(() => (window as any).__liveWebMcp.execute("get_governance_snapshot", { maxItems: 20 }));
    const names = await page.evaluate(() => (window as any).__liveWebMcp.names());
    if (role === "Member") {
      expect(snapshot.restrictedResources).toEqual(expect.arrayContaining(["deadlines", "filings"]));
      expect(snapshot.attention.overdueDeadlines).toEqual([]);
      expect(snapshot.attention.overdueFilings).toEqual([]);
      const denied = await page.evaluate(async () => {
        try { await (window as any).__liveWebMcp.execute("open_governance_view", { view: "deadlines" }); return null; }
        catch (error) { return String(error); }
      });
      expect(denied).toContain("restricted");
    } else expect(snapshot.restrictedResources).toEqual([]);
    if (role === "Owner") {
      expect(names).toContain("create_governance_tasks");
      const title = `Live WebMCP ${testInfo.project.name} ${Date.now()}`;
      const created = await page.evaluate(async (title) => (window as any).__liveWebMcp.execute("create_governance_tasks", { tasks: [{ title }] }), title);
      expect(created.count).toBe(1);
      await expect(page).toHaveURL(/\/app\/tasks$/);
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    } else expect(names).not.toContain("create_governance_tasks");
    await assertLiveFits(page);
    expect(errors).toEqual([]);
  });
}
