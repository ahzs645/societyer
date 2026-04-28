import { expect, type Page } from "@playwright/test";

export class RecordTablePage {
  constructor(private readonly page: Page) {}

  async expectTableOrEmptyState() {
    const table = this.page.locator(".record-table").first();
    const empty = this.page.locator(".record-table__empty").first();
    await expect(table.or(empty)).toBeVisible({ timeout: 10_000 });
  }

  async search(term: string) {
    const input = this.page.locator(".record-table__search-input").first();
    await input.fill(term);
  }

  async openColumnsMenu() {
    await this.page.getByRole("button", { name: /columns/i }).first().click();
    await expect(this.page.locator(".record-table__menu").last()).toBeVisible();
  }

  async openSortPopover() {
    await this.page.getByRole("button", { name: /sort/i }).first().click();
    await expect(this.page.locator(".record-table__sort-popover")).toBeVisible();
  }

  async openFilterPopover() {
    await this.page.getByRole("button", { name: /filter/i }).first().click();
    await expect(this.page.locator(".record-table__filter-popover")).toBeVisible();
  }

  async applyView(name: RegExp | string) {
    await this.page.getByRole("button", { name: /view/i }).first().click();
    await this.page.getByRole("button", { name }).click();
  }

  async editCell(rowIndex: number, columnIndex: number, value: string) {
    const cell = this.page.locator(
      `.record-table__row[data-row-index="${rowIndex}"] .record-table__cell[data-column-index="${columnIndex}"]`,
    );
    await cell.click();
    await this.page.keyboard.press("Enter");
    const input = this.page.locator(".record-table__cell input, .record-table__cell textarea").first();
    await input.fill(value);
    await this.page.keyboard.press("Enter");
  }

  async focusFirstCell() {
    const firstCell = this.page.locator(".record-table__cell").first();
    await firstCell.click();
    await expect(firstCell).toHaveClass(/record-table__cell--focused/);
  }

  async expectFocusedCell(rowIndex: number, columnIndex: number) {
    await expect(
      this.page.locator(
        `.record-table__row[data-row-index="${rowIndex}"] .record-table__cell[data-column-index="${columnIndex}"]`,
      ),
    ).toHaveClass(/record-table__cell--focused/);
  }

  async expectNoFocusedCell() {
    await expect(this.page.locator(".record-table__cell--focused")).toHaveCount(0);
  }

  async enterEditMode() {
    await this.page.keyboard.press("Enter");
    await expect(this.page.locator(".record-table__cell input, .record-table__cell textarea, .record-table__cell select").first()).toBeVisible();
  }
}
