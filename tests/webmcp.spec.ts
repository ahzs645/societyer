import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, any>();
    const modelContext = {
      registerTool(tool: any, options: { signal?: AbortSignal } = {}) {
        if (tools.has(tool.name)) return Promise.reject(new DOMException("Duplicate tool", "InvalidStateError"));
        tools.set(tool.name, tool);
        options.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        return Promise.resolve();
      },
      getTools() {
        return Array.from(tools.values());
      },
      execute(name: string, input: unknown) {
        const tool = tools.get(name);
        if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
        return tool.execute(input, { signal: new AbortController().signal });
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    Object.defineProperty(window, "__societyerWebMcpTest", { configurable: true, value: modelContext });
  });
});

test("registers and executes the Societyer WebMCP contract", async ({ page }) => {
  await page.goto("/demo/app", { waitUntil: "networkidle" });
  await expect.poll(() => page.locator("html").getAttribute("data-webmcp-tools")).toContain("get_governance_snapshot");

  const catalog = await page.evaluate(() => {
    const context = (window as any).__societyerWebMcpTest;
    return context.getTools().map((tool: any) => ({
      name: tool.name,
      annotations: tool.annotations,
      schema: tool.inputSchema,
    }));
  });
  expect(catalog.map((tool: any) => tool.name)).toEqual([
    "get_governance_snapshot",
    "create_governance_tasks",
    "open_governance_view",
  ]);
  expect(catalog[0].annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
  expect(catalog[1].schema.properties.tasks.maxItems).toBe(8);

  const snapshot = await page.evaluate(async () =>
    (window as any).__societyerWebMcpTest.execute("get_governance_snapshot", {
      horizonDays: 60,
      maxItems: 5,
    }),
  );
  expect(snapshot.workspace.name).toBe("Riverside Community Society");
  expect(snapshot.attention.overdueDeadlines.length).toBeGreaterThan(0);
  expect(snapshot.collaboration.reviewViews).toContain("tasks");

  const taskCountBefore = snapshot.summaryCounts.openTasks;
  const invalidError = await page.evaluate(async () => {
    try {
      await (window as any).__societyerWebMcpTest.execute("create_governance_tasks", { tasks: [] });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalidError).toContain("between 1 and 8");

  const created = await page.evaluate(async () =>
    (window as any).__societyerWebMcpTest.execute("create_governance_tasks", {
      tasks: [
        {
          title: "Review annual report evidence",
          description: "Confirm the filing receipt and board-minute evidence before closing the overdue obligation.",
          dueDate: "2026-09-08",
          priority: "High",
          assignee: "Secretary",
          tags: ["annual-report", "evidence"],
        },
      ],
    }),
  );
  expect(created.count).toBe(1);
  await expect(page).toHaveURL(/\/demo\/app\/tasks$/);
  await expect(page.getByText("Review annual report evidence", { exact: true })).toBeVisible();

  const updatedSnapshot = await page.evaluate(async () =>
    (window as any).__societyerWebMcpTest.execute("get_governance_snapshot", {
      horizonDays: 60,
      maxItems: 20,
    }),
  );
  expect(updatedSnapshot.summaryCounts.openTasks).toBe(taskCountBefore + 1);
  expect(updatedSnapshot.attention.openTasks.some((task: any) => task.title === "Review annual report evidence")).toBe(true);

  const navigation = await page.evaluate(async () =>
    (window as any).__societyerWebMcpTest.execute("open_governance_view", { view: "deadlines" }),
  );
  expect(navigation.openedView).toBe("deadlines");
  await expect(page).toHaveURL(/\/demo\/app\/deadlines$/);
});
