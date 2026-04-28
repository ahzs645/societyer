import { expect, type Page } from "@playwright/test";

export class ImportWizardPage {
  constructor(private readonly page: Page) {}

  async expectOpen() {
    await expect(this.page.getByRole("dialog", { name: /import/i })).toBeVisible();
  }

  async uploadCsv(filePath: string) {
    await this.page.locator('input[type="file"]').setInputFiles(filePath);
    await expect(this.page.getByText(/map columns/i)).toBeVisible();
  }

  async continueToPreview() {
    await this.page.getByRole("button", { name: /continue/i }).click();
    await expect(this.page.getByText(/parsed/i)).toBeVisible();
  }

  async expectValidationIssue(message: RegExp | string) {
    await expect(this.page.getByText(message)).toBeVisible();
  }
}
