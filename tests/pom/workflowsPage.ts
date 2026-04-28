import { expect, type Page } from "@playwright/test";
import { RecordTablePage } from "./recordTablePage";

export class WorkflowsPage {
  readonly table: RecordTablePage;

  constructor(private readonly page: Page) {
    this.table = new RecordTablePage(page);
  }

  async gotoDemo() {
    await this.page.goto("/demo/app/workflows", { waitUntil: "networkidle" });
    await expect(this.page.locator(".app-shell")).toBeVisible();
  }

  async openNewWorkflow() {
    await this.page.getByRole("button", { name: /new workflow/i }).click();
    await expect(this.page.getByRole("dialog")).toBeVisible();
  }
}
