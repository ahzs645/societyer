import { expect, type Page } from "@playwright/test";

export class AppShell {
  constructor(private readonly page: Page) {}

  async gotoDemo(path = "/demo") {
    await this.page.goto(path, { waitUntil: "networkidle" });
    await expect(this.page.locator(".app-shell")).toBeVisible({ timeout: 10_000 });
  }

  async navigate(label: RegExp | string) {
    await this.page.getByRole("link", { name: label }).click();
    await expect(this.page.locator(".app-shell")).toBeVisible();
  }

  async openCommandPalette() {
    await this.page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(this.page.getByRole("dialog", { name: /command palette/i })).toBeVisible();
  }

  async runCommand(label: RegExp | string) {
    await this.openCommandPalette();
    await this.page.getByRole("option", { name: label }).click();
  }
}
