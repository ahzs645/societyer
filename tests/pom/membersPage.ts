import { type Page } from "@playwright/test";
import { RecordTablePage } from "./recordTablePage";

export class MembersPage {
  readonly table: RecordTablePage;

  constructor(private readonly page: Page) {
    this.table = new RecordTablePage(page);
  }

  async gotoDemo() {
    await this.page.goto("/demo/app/members", { waitUntil: "networkidle" });
    await this.table.expectTableOrEmptyState();
  }
}
