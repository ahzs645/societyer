import { expect, type Page } from "@playwright/test";

/** Deny the real browser permission instead of replacing getUserMedia. */
export async function denyBrowserCamera(page: Page, baseURL: string) {
  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Browser.setPermission", {
    permission: { name: "camera" }, setting: "denied", origin: new URL(baseURL).origin,
  });
  await protocol.detach();
}

export async function assertScannerFallback(page: Page, code: string, title: string) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect(dialog.getByText("Camera access was blocked. Enter the asset tag below instead.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(() => dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= innerWidth + 1;
  })).toBe(true);
  await dialog.getByRole("textbox", { name: "Asset tag or code", exact: true }).fill(code);
  await dialog.getByRole("button", { name: "Look up", exact: true }).click();
}
