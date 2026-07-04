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
    const input = this.page.locator(".record-table__cell-editor-popover input, .record-table__cell-editor-popover textarea").first();
    await input.fill(value);
    await this.page.keyboard.press("Enter");
  }

  async focusCell(rowIndex: number, columnIndex: number) {
    const cell = this.page.locator(
      `.record-table__row[data-row-index="${rowIndex}"] .record-table__cell[data-column-index="${columnIndex}"]`,
    );
    await cell.click();
    await expect(cell).toHaveClass(/record-table__cell--focused/);
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
    await expect(this.page.locator(".record-table__cell-editor-popover input, .record-table__cell-editor-popover textarea, .record-table__cell-editor-popover select").first()).toBeVisible();
  }

  // --- Mobile-treatment helpers ---------------------------------------------
  // On a phone the record table drops its leading structural columns (the
  // selection checkbox and drag handle) and freezes the first data column.

  bodySelectionCheckboxes() {
    return this.page.locator(".record-table__tbody .record-table__checkbox-cell");
  }

  dragHandles() {
    return this.page.locator(".record-table__drag-cell");
  }

  firstBodyCell() {
    return this.page.locator(
      ".record-table__row[data-row-index='0'] .record-table__cell[data-column-index='0']",
    );
  }

  async firstBodyCellPosition() {
    return this.firstBodyCell().evaluate((el) => getComputedStyle(el).position);
  }

  scrollContainer() {
    return this.page.locator(".record-table__scroll").first();
  }

  async scrollContainerOverflowX() {
    return this.scrollContainer().evaluate((el) => getComputedStyle(el).overflowX);
  }
}
