import { expect, test } from "@playwright/test";
import { assertLiveFits, signInLive } from "./helpers/liveInterface";

test("Owner global task dialog still creates a native task after conditional mounting", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInLive(page, "Owner");
  await page.goto("/app/tasks");
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("quickaction:add-task")));
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  await expect(dialog).toBeVisible();
  // Measure the settled layout after the dialog opening transform completes.
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  await assertLiveFits(page);
  const title = `Global creation ${testInfo.project.name} ${Date.now()}`;
  await dialog.locator("input").first().fill(title);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".page").getByText(title, { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Member can read the global assistant without a settings subscription or write controls", async ({ page }) => {
  const errors: string[] = [];
  const protectedQueries: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    // Keep only public function names; authentication frames are never recorded.
    try {
      const message = JSON.parse(String(frame.payload));
      if (message.type === "ModifyQuerySet") {
        for (const query of message.modifications ?? []) {
          if (query.type === "Add" && ["aiSettings:getEffective", "aiChat:listThreads", "aiChat:messagesForThread", "aiAgents:listRuns", "aiAgents:listToolDrafts"].includes(query.udfPath)) protectedQueries.push(query.udfPath);
        }
      }
    } catch { /* Binary/non-JSON transport frame. */ }
  }));
  await signInLive(page, "Member");
  await page.goto("/app/tasks");
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("societyer-ai:open")));
  const dialog = page.getByRole("dialog", { name: "Societyer AI assistant" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "AI settings", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "New chat", exact: true })).toBeDisabled();
  await expect(dialog.locator(".global-ai-thread-list__empty")).toHaveText("No chats yet");
  await expect(dialog.locator(".global-ai-thread")).toHaveCount(0);
  await expect(dialog.getByRole("status").filter({ hasText: "Private AI conversations require current AI chat write permission" })).toBeVisible();
  expect(protectedQueries).toEqual([]);
  expect(errors).toEqual([]);
});

test("Viewer meeting read routes do not seed meeting templates", async ({ page }) => {
  const mutations: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framesent", (frame) => {
    try {
      const message = JSON.parse(String(frame.payload));
      if (message.type === "Mutation" && message.udfPath === "meetingTemplates:seedDefaults") mutations.push(message.udfPath);
    } catch { /* Keep only public mutation names. */ }
  }));
  await signInLive(page, "Viewer");
  await page.goto("/app/meetings");
  await expect(page.getByRole("button", { name: "New meeting", exact: true })).toBeDisabled();
  await expect(page.locator(".page").first()).toBeVisible();
  await assertLiveFits(page);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});
