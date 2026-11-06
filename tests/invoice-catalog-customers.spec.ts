import { test, expect, type Page } from "@playwright/test";

async function newItem(page: Page, name: string, price: string | null) {
  const form = page.getByRole("dialog").filter({ hasText: "New catalog item" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  if (price === null) await form.getByText("No set price", { exact: true }).click();
  else await form.getByLabel(/^Unit price/).fill(price);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).not.toBeVisible();
}

test("set, overridden and open prices share one item form across the catalog, invoices and repairs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now();
  const setItem = `Hall rental ${suffix}`, openItem = `One-time fee ${suffix}`, inlineItem = `Added on invoice ${suffix}`, typed = `Typed line ${suffix}`;

  await page.goto("/app/invoices?tab=catalog");
  await page.getByRole("button", { name: "New item", exact: true }).click();
  await newItem(page, setItem, "85.00");
  await page.getByRole("button", { name: "New item", exact: true }).click();
  await newItem(page, openItem, null);
  await expect(page.getByRole("row").filter({ hasText: openItem })).toContainText("Set on each invoice");

  await page.goto("/app/invoices?builder=new");
  const form = page.locator(".invoice-builder__form");
  await expect(form.locator(".invoice-builder__section").nth(1)).toContainText("Line items");
  const fromCatalog = form.getByRole("button", { name: "From catalog", exact: true });
  const line = (index: number) => form.locator(".line-editor__row").nth(index);
  const price = (index: number) => line(index).getByLabel("Price (CAD)", { exact: true });

  // A set price fills in and can be overridden, then put back.
  await fromCatalog.click();
  await page.getByRole("menuitem", { name: new RegExp(setItem) }).click();
  await expect(price(0)).toHaveValue("85.00");
  await expect(line(0)).toContainText("Set price. Change it here");
  await price(0).fill("70.00");
  await expect(line(0)).toContainText("The set price is $85.00");
  await line(0).getByRole("button", { name: "Use set price", exact: true }).click();
  await expect(price(0)).toHaveValue("85.00");
  await price(0).fill("70.00");

  // An open price starts empty, survives a quantity change and blocks sending until it's filled.
  await fromCatalog.click();
  await page.getByRole("menuitem", { name: new RegExp(openItem) }).click();
  await expect(price(1)).toHaveValue("");
  await expect(line(1)).toContainText("No set price. Enter the amount");
  await line(1).getByLabel("Qty", { exact: true }).fill("2");
  await expect(price(1)).toHaveValue("");

  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(`Pricing customer ${suffix}`);
  await page.getByRole("option", { name: /Create customer/ }).click();
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(form).toContainText(`${openItem} has no set price`);
  await price(1).fill("40.00");
  await expect(line(1)).not.toContainText("No set price");

  // The same form opens from the invoice and lands on the line.
  await fromCatalog.click();
  await page.getByRole("menuitem", { name: "New item or service", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Currency", { exact: true })).toBeDisabled();
  await newItem(page, inlineItem, "12.50");
  await expect(price(2)).toHaveValue("12.50");

  // A typed line is saved through that form too.
  await form.getByRole("button", { name: "Add line", exact: true }).click();
  await line(3).getByLabel("Item", { exact: true }).fill(typed);
  await price(3).fill("9.00");
  await line(3).getByRole("button", { name: "Save to catalog", exact: true }).click();
  const seeded = page.getByRole("dialog").last();
  await expect(seeded.getByLabel("Name", { exact: true })).toHaveValue(typed);
  await expect(seeded.getByLabel(/^Unit price/)).toHaveValue("9.00");
  await seeded.getByRole("button", { name: "Save", exact: true }).click();
  await expect(seeded).not.toBeVisible();
  await expect(line(3).getByRole("button", { name: "Save to catalog", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("builder")).not.toBe("new");
  await expect(price(1)).toHaveValue("40.00");
  await expect(line(0)).toContainText("The set price is $85.00");

  // A repair is inside a drawer, so the form stacks over it as a dialog.
  await page.goto("/app/invoices?tab=repairs");
  await page.getByRole("button", { name: "New repair", exact: true }).click();
  const repair = page.getByRole("dialog").filter({ hasText: "New repair" });
  await repair.getByRole("button", { name: "From catalog", exact: true }).click();
  await page.getByRole("menuitem", { name: "New item or service", exact: true }).click();
  await newItem(page, `From repair ${suffix}`, "30.00");
  await expect(repair.locator(".line-editor__field--price input").last()).toHaveValue("30.00");
  const amount = await repair.locator(".line-editor__amount").last().boundingBox(), card = await repair.locator(".line-editor__row").last().boundingBox();
  expect(amount!.x + amount!.width).toBeLessThanOrEqual(card!.x + card!.width);
  expect(errors).toEqual([]);
});

test("customers can be added, edited and renamed without rewriting what was issued", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now();
  const original = `Acme Sevices ${suffix}`, corrected = `Acme Services ${suffix}`, oneOff = `Walk-in ${suffix}`;

  await page.goto("/app/invoices?tab=customers");
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  let drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name", { exact: true }).fill(original);
  await drawer.getByLabel("Email", { exact: true }).fill("ap@acme.example");
  await drawer.getByLabel("Billing address", { exact: true }).fill("1 Main St");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const row = (name: string) => page.getByRole("row").filter({ hasText: name });
  await expect(row(original)).toContainText("ap@acme.example");

  // Details on the record fill in when the customer is billed, and the bill-to edits the same record.
  await row(original).getByRole("button", { name: "Invoice", exact: true }).click();
  const form = page.locator(".invoice-builder__form");
  await expect(form.locator(".billto__name")).toHaveText(original);
  await expect(form.locator(".billto__field--wide textarea")).toHaveValue("1 Main St");
  await form.locator(".line-editor__row").first().getByLabel("Item", { exact: true }).fill("Consulting");
  await form.locator(".line-editor__row").first().getByLabel("Price (CAD)", { exact: true }).fill("100.00");
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page.locator(".invoice-builder__form")).toHaveCount(0);

  // A rename shows straight away but leaves the sent invoice as issued.
  await page.goto("/app/invoices?tab=customers");
  await row(original).getByRole("button", { name: `Edit ${original}`, exact: true }).click();
  drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Billing address", { exact: true })).toHaveValue("1 Main St");
  await expect(drawer.getByText("Also change the name on sent invoices", { exact: true })).toHaveCount(0);
  await drawer.getByLabel("Name", { exact: true }).fill(corrected);
  await expect(drawer.getByText("Also change the name on sent invoices", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(row(corrected)).toBeVisible();
  await expect(row(corrected)).toContainText("$100.00");
  await page.goto("/app/invoices");
  await expect(page.getByRole("row").filter({ hasText: original })).toHaveCount(1);

  // Editing from the invoice bill-to updates the record and the open draft.
  await page.goto("/app/invoices?builder=new");
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(corrected);
  await page.getByRole("option", { name: new RegExp(corrected) }).click();
  await form.getByRole("button", { name: `Edit customer ${corrected}`, exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Email", { exact: true }).fill("billing@acme.example");
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(form.getByLabel("Email", { exact: true })).toHaveValue("billing@acme.example");

  // A one-off can be saved as a customer without leaving a duplicate behind.
  await page.goto("/app/invoices?builder=new");
  await form.getByRole("combobox", { name: "Bill to", exact: true }).fill(oneOff);
  await page.getByRole("option", { name: /once/ }).click();
  await form.locator(".line-editor__row").first().getByLabel("Item", { exact: true }).fill("Door sale");
  await form.locator(".line-editor__row").first().getByLabel("Price (CAD)", { exact: true }).fill("25.00");
  await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
  await expect(page.locator(".invoice-builder__form")).toHaveCount(0);
  await page.goto("/app/invoices?tab=customers");
  await expect(row(oneOff)).toContainText("One-off");
  await row(oneOff).getByRole("button", { name: `Edit ${oneOff}`, exact: true }).click();
  drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Save as customer" })).toBeVisible();
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(row(oneOff)).toHaveCount(1);
  await expect(row(oneOff)).not.toContainText("One-off");

  // A member's name belongs to their member record.
  await page.getByLabel("Search customers", { exact: true }).fill("Sam Nguyen");
  await expect(row("Sam Nguyen").getByRole("link", { name: "Edit member Sam Nguyen", exact: true })).toHaveAttribute("href", /\/app\/members\//);
  expect(errors).toEqual([]);
});
