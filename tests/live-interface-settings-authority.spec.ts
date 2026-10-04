import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { assertLiveFits, liveFixture, signInLive } from "./helpers/liveInterface";

// Run this focused file with one worker: Owner cases verify and restore the
// same workspace preferences, so parallel writes would manufacture a race.
for (const role of ["Owner", "Director", "Viewer"]) {
  test(`${role} live settings branding and workspace preferences honor their exact write authority`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signInLive(page, role);
    await page.goto("/app/settings?tab=workspace");
    const logo = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Organization logo", exact: true }) });
    const upload = logo.getByRole("button", { name: /^(?:Upload|Replace) logo$/ });
    const remove = logo.getByRole("button", { name: "Remove", exact: true });
    const dark = page.getByRole("switch", { name: /^Customize logo for dark mode/ });
    const letterhead = page.getByRole("switch", { name: /^Use a custom document letterhead/ });
    const prompt = page.getByRole("switch", { name: /^Prompt for current count when adding consumables/ });
    if (role !== "Owner") {
      for (const item of [upload, dark]) await expect(item).toBeDisabled();
      for (const item of await remove.all()) await expect(item).toBeDisabled();
      await expect(letterhead).toBeDisabled();
      for (const item of await logo.getByRole("radio").all()) await expect(item).toBeDisabled();
      await page.goto("/app/settings?tab=modules");
      await expect(prompt).toBeDisabled();
    } else {
      for (const item of [upload, dark]) await expect(item).toBeEnabled();
      await page.goto("/app/settings?tab=modules");
      await expect(prompt).toBeEnabled();
      const auth = await page.context().request.get("/api/auth/token");
      expect(auth.ok()).toBe(true);
      const { token } = await auth.json();
      const client = new ConvexHttpClient("http://127.0.0.1:43230", { logger: false });
      client.setAuth(token);
      const stored = () => client.query(makeFunctionReference("society:getById"), { id: liveFixture().societyId }) as Promise<any>;
      const previous = await prompt.isChecked();
      const originalRetention = Number((await stored()).notificationRetentionDays ?? 30);
      let restored = false;
      try {
      await page.getByText("Prompt for current count when adding consumables", { exact: true }).click();
      await expect.poll(async () => Boolean((await stored()).consumableIntakeCountPromptEnabled)).toBe(!previous);
      await page.reload();
      await expect(prompt).toBeChecked({ checked: !previous });
      await page.getByText("Prompt for current count when adding consumables", { exact: true }).click();
      await expect.poll(async () => Boolean((await stored()).consumableIntakeCountPromptEnabled)).toBe(previous);
      await page.goto("/app/settings?tab=runtime");
      const notifications = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Notifications", exact: true }) });
      const retention = notifications.getByRole("button");
      const priorLabel = (await retention.innerText()).trim();
      const target = priorLabel === "60 days" ? "30 days" : "60 days";
      await retention.click();
      await page.getByRole("option", { name: target, exact: true }).click();
      await expect.poll(async () => (await stored()).notificationRetentionDays).toBe(Number.parseInt(target));
      await page.reload();
      await expect(retention).toHaveText(target);
      await retention.click();
      await page.getByRole("option", { name: priorLabel, exact: true }).click();
      const originalDays = priorLabel === "Keep until deleted" ? 0 : Number.parseInt(priorLabel);
      await expect.poll(async () => (await stored()).notificationRetentionDays).toBe(originalDays);
      restored = true;
      } finally {
        if (!restored) {
          await client.mutation(makeFunctionReference("society:updateInventorySettings"), { societyId: liveFixture().societyId, consumableIntakeCountPromptEnabled: previous });
          await client.mutation(makeFunctionReference("society:updateNotificationSettings"), { societyId: liveFixture().societyId, notificationRetentionDays: originalRetention });
        }
      }
    }
    await assertLiveFits(page);
    await page.goto("/app/settings?tab=runtime");
    const notifications = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Notifications", exact: true }) });
    const shared = page.getByRole("button", { name: "Seed governance shared views", exact: true });
    if (role === "Owner") {
      await expect(notifications.getByRole("button")).toBeEnabled();
      await expect(shared).toBeEnabled();
    } else {
      await expect(notifications.getByRole("button")).toBeDisabled();
      await expect(shared).toBeDisabled();
    }
    await assertLiveFits(page);
    expect(errors).toEqual([]);
  });
}
