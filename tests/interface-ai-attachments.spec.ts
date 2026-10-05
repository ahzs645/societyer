import { expect, test } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

test("local AI text attachments are extracted and reviewed without uploads; drafts persist at every viewport", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const calls: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/ai-chat\/stream|\/api\/action/.test(request.url())) calls.push(request.url()); });
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, `AI draft ${testInfo.project.name}`, true);
  await page.goto("/app/ai-agents");
  await expect(page.getByRole("status").filter({ hasText: "Live AI chat, agents and provider keys require a connected workspace" })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant", exact: true });
  const composer = assistant.locator("textarea");
  await composer.fill("Offline draft: summarize the synthetic minutes when connected.");
  const picker = assistant.locator('input[type="file"]');
  await picker.setInputFiles({ name: "synthetic-minutes.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic minutes: adopt the community garden budget.") });
  await assistant.getByText("Review extracted text: synthetic-minutes.txt", { exact: true }).click();
  await expect(assistant.locator("pre")).toHaveText("Synthetic minutes: adopt the community garden budget.");
  await expect(assistant.getByText(/Sending includes extracted file contents/)).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await picker.setInputFiles({ name: "unsupported.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-synthetic") });
  await expect(assistant.getByText(/Attach a UTF-8 TXT, Markdown, CSV or JSON file/)).toBeVisible();
  await expect(assistant.getByText("Review extracted text: synthetic-minutes.txt", { exact: true })).toBeVisible();
  await picker.setInputFiles({ name: "large.txt", mimeType: "text/plain", buffer: Buffer.alloc(32769, 65) });
  await expect(assistant.getByText("Each text file must be between 1 byte and 32 KiB.", { exact: true })).toBeVisible();
  await picker.setInputFiles({ name: "malformed.json", mimeType: "application/json", buffer: Buffer.from("{invalid}") });
  await expect(assistant.getByText("The attached JSON file is malformed.", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Remove synthetic-minutes.txt", exact: true }).click();
  await expect(assistant.getByText("Review extracted text: synthetic-minutes.txt", { exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Live AI chat, agents and provider keys require a connected workspace" })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  await expect(composer).toHaveValue("Offline draft: summarize the synthetic minutes when connected.");
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test("pending attachment extraction cannot follow a user into another local workspace", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, `AI source ${testInfo.project.name}`, true);
  const firstId = await page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"));
  await page.goto("/app/society/new");
  await completeGuidedOrganizationSetup(page, `AI destination ${testInfo.project.name}`, true);
  const secondId = await page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"));
  expect(firstId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
  await page.goto("/app/ai-agents");
  await expect(page.getByRole("status").filter({ hasText: "Live AI chat, agents and provider keys require a connected workspace" })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant", exact: true });
  await expect(assistant).toBeVisible();
  await page.evaluate(async (id) => {
    const hooks = await import(/* @vite-ignore */ "/src/hooks/useSociety.ts");
    hooks.setStoredSocietyId(id);
  }, firstId);
  await expect(assistant.getByText(`AI source ${testInfo.project.name}`, { exact: true })).toBeVisible();
  await assistant.locator("textarea").fill("Private source workspace draft");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "pending-source.txt") return original.call(this);
      return new Promise<ArrayBuffer>(resolve => { (window as any).__resolveAiFixtureFile = () => resolve(new TextEncoder().encode("Source workspace attachment").buffer); });
    };
  });
  await assistant.locator('input[type="file"]').setInputFiles({ name: "pending-source.txt", mimeType: "text/plain", buffer: Buffer.from("Source workspace attachment") });
  await expect(assistant.getByText("Reading text files on this device…", { exact: true })).toBeVisible();
  await page.evaluate(async (id) => {
    const hooks = await import(/* @vite-ignore */ "/src/hooks/useSociety.ts");
    hooks.setStoredSocietyId(id);
  }, secondId);
  await expect(assistant.locator("textarea")).toHaveValue("");
  await expect(assistant.getByText("Reading text files on this device…", { exact: true })).toBeHidden();
  await page.evaluate(() => (window as any).__resolveAiFixtureFile());
  await expect(assistant.getByText("Review extracted text: pending-source.txt", { exact: true })).toBeHidden();
  await expect(assistant.locator("textarea")).toHaveValue("");
  await page.evaluate(async (id) => {
    const hooks = await import(/* @vite-ignore */ "/src/hooks/useSociety.ts");
    hooks.setStoredSocietyId(id);
  }, firstId);
  await expect(assistant.locator("textarea")).toHaveValue("Private source workspace draft");
});

test("demo chat saves creator-scoped source text and renders image syntax without automatic external requests", async ({ page }) => {
  const externalImages: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("ai-image-fixture.invalid")) externalImages.push(request.url()); });
  await page.goto("/demo/app/ai-agents");
  await expect(page.getByRole("status").filter({ hasText: "AI actions in this demo use simulated responses" })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  const assistant = page.getByRole("dialog", { name: "Societyer AI assistant", exact: true });
  await assistant.locator("textarea").fill("Keep this synthetic source in a simulated private conversation.");
  await assistant.locator('input[type="file"]').setInputFiles({ name: "synthetic-image.md", mimeType: "text/markdown", buffer: Buffer.from("![Synthetic image](https://ai-image-fixture.invalid/tracker)") });
  await expect(assistant.getByText("Review extracted text: synthetic-image.md", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(assistant.getByText(/Simulated demo reply\. No AI provider was contacted/)).toBeVisible();
  await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ "/tests/helpers/aiMarkdownFixture.tsx");
    fixture.mountAiMarkdownFixture("![Synthetic image](https://ai-image-fixture.invalid/tracker)");
  });
  await expect(page.getByTestId("ai-markdown-fixture").getByRole("link", { name: "View image: Synthetic image", exact: true })).toHaveAttribute("href", "https://ai-image-fixture.invalid/tracker");
  await expect(assistant.locator('img[src*="ai-image-fixture.invalid"]')).toHaveCount(0);
  expect(externalImages).toEqual([]);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "AI actions in this demo use simulated responses" })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("societyer-ai:open")));
  await expect(assistant.getByText(/Simulated demo reply\. No AI provider was contacted/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  expect(externalImages).toEqual([]);
  expect(errors).toEqual([]);
});
