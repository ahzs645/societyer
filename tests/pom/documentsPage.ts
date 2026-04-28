import { expect, type Page } from "@playwright/test";
import { RecordTablePage } from "./recordTablePage";

export class DocumentsPage {
  readonly table: RecordTablePage;

  constructor(private readonly page: Page) {
    this.table = new RecordTablePage(page);
  }

  async gotoDemo() {
    await this.page.goto("/demo/app/documents", { waitUntil: "networkidle" });
    await expect(this.page.locator(".app-shell")).toBeVisible();
  }
}
