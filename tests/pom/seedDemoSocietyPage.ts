import { expect, type Page } from "@playwright/test";

export class SeedDemoSocietyPage {
  constructor(private readonly page: Page) {}

  async expectDemoBannerIfPresent() {
    const banner = this.page.locator(".demo-banner");
    if (await banner.isVisible()) {
      await expect(banner).toContainText(/demo/i);
    }
  }

  async seedFromBannerIfAvailable() {
    const seedButton = this.page.getByRole("button", { name: /seed demo society/i });
    if (await seedButton.isVisible()) {
      await seedButton.click();
    }
  }
}
