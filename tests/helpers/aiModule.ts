import { expect, type Page } from "@playwright/test";

/** AI is off by default; turn the workspace module on before exercising AI surfaces. */
export async function enableAiModule(page: Page, settingsPath = "/app/settings?tab=modules") {
  await page.goto(settingsPath);
  const moduleToggle = page.getByRole("switch", { name: /^AI assistant & agents\b/ });
  await expect(moduleToggle).toBeEnabled();
  if (!(await moduleToggle.isChecked())) {
    // Toggle's native input is visually hidden; its containing label is the click target.
    await page.locator("label.check-row").filter({ has: moduleToggle }).click();
    await expect(moduleToggle).toBeChecked();
    // The displayed choice is optimistic; wait for its mutation before navigating.
    await expect(moduleToggle).toBeEnabled();
  }
}
