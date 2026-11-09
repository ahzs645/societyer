import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const brandFixture = path.resolve("scripts/fixtures/brandkit/ddcnorth.json");
const workspaceName = "DDC North — live test workspace — synthetic Brandkit browser qualification";

async function createWorkspace(page: Page, name = workspaceName) {
  await page.goto("/app/settings");
  await expect(page.locator(".settings-shell")).toBeVisible();
  return page.evaluate(async name => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
      name, jurisdictionCode: "CA-BC", seedDocumentPackets: false,
      isCharity: false, isMemberFunded: false,
    });
    const societyId = created.societyId;
    const users = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(users.find((row: any) => row.role === "Owner")._id);
    return societyId;
  }, name);
}

async function savedBrandId(page: Page, societyId: string) {
  return page.evaluate(async id => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const society = await client.query("society:getById", { id });
    return society?.workspaceBrand?.id ?? null;
  }, societyId);
}

async function assertContained(page: Page, location: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    containers: [...document.querySelectorAll<HTMLElement>(
      "[role=main] .page, .settings-shell, .settings-shell__content, .workspace-brand-settings, .workspace-brand-settings .card__body, .workspace-brand-settings__previews, .workspace-brand-settings__tools, .workspace-brand-settings__footer, .workspace-menu",
    )].filter(element => element.getClientRects().length).map(element => {
      // Phone settings cards deliberately bleed through the page gutter.
      // Their shell may include that scroll area, while the card and every
      // brand control must still fit their own box and the viewport.
      const containsFullBleedCard = element.matches(".settings-shell, .settings-shell__content")
        && [...element.querySelectorAll(".card")].some(card => {
          const style = getComputedStyle(card);
          return parseFloat(style.marginInlineStart) < 0 && parseFloat(style.marginInlineEnd) < 0;
        });
      return {
        className: element.className, width: element.clientWidth, scroll: element.scrollWidth,
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
        containsFullBleedCard,
      };
    }),
  }));
  expect(dimensions.document, `${location}: document ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, `${location}: body ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  for (const size of dimensions.containers) {
    const message = `${location}: ${size.className} ${JSON.stringify(size)}`;
    const availableWidth = size.containsFullBleedCard
      ? Math.max(size.width, dimensions.viewport - size.left)
      : size.width;
    expect(size.scroll, message).toBeLessThanOrEqual(availableWidth + 1);
    expect(size.left, message).toBeGreaterThanOrEqual(-1);
    expect(size.right, message).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
}

test("Brandkit preview applies explicitly and persists across desktop themes and mobile widths", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const societyId = await createWorkspace(page);
  await page.reload();
  const settings = page.getByRole("region", { name: "Workspace Brandkit", exact: true });
  const sidebar = page.locator(".sidebar__workspace");
  await expect(settings).toBeVisible();
  await expect(sidebar).toContainText(workspaceName);
  await expect(sidebar.locator("[data-brand-id]")).toHaveCount(0);

  await settings.getByLabel("Import workspace Brandkit", { exact: true }).setInputFiles(brandFixture);
  await expect(settings.getByRole("status")).toContainText("Preview only");
  await expect(settings.locator('[data-brand-id="ddcnorth"]')).toHaveCount(2);
  await expect(sidebar.locator("[data-brand-id]")).toHaveCount(0);
  expect(await savedBrandId(page, societyId)).toBeNull();
  await settings.getByRole("button", { name: "Cancel brand preview", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Apply workspace brand", exact: true })).toHaveCount(0);
  expect(await savedBrandId(page, societyId)).toBeNull();

  await settings.getByLabel("Import workspace Brandkit", { exact: true }).setInputFiles(brandFixture);
  await settings.getByRole("button", { name: "Apply workspace brand", exact: true }).click();
  await expect(sidebar.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await expect(settings.getByRole("button", { name: "Remove workspace brand", exact: true })).toBeVisible();
  expect(await savedBrandId(page, societyId)).toBe("ddcnorth");
  await page.reload();
  await expect(sidebar.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Use brand accent in the interface/ })).toBeChecked();

  await page.goto("/app");
  const banner = page.getByRole("region", { name: "Current workspace", exact: true });
  await expect(banner).toContainText(workspaceName);
  await expect(banner.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await assertContained(page, "desktop light");
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop-light.png"), fullPage: true });
  const lightLogo = sidebar.locator(".workspace-logo__light img");
  const darkLogo = sidebar.locator(".workspace-logo__dark img");
  await expect(lightLogo).toBeVisible();
  expect(await lightLogo.getAttribute("src")).not.toBe(await darkLogo.getAttribute("src"));

  await page.evaluate(() => localStorage.setItem("societyer:theme", "dark"));
  await page.reload();
  await expect(darkLogo).toBeVisible();
  await expect(lightLogo).toBeHidden();
  await assertContained(page, "desktop dark");
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop-dark.png"), fullPage: true });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const mobile = page.locator(".mobile-topbar__workspace");
    await expect(mobile.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
    await expect(mobile).toHaveAttribute("title", workspaceName);
    await assertContained(page, `mobile ${width} dashboard`);
    await page.screenshot({ path: testInfo.outputPath(`workspace-phone-${width}.png`), fullPage: true });
    await page.goto("/app/settings");
    await expect(settings).toBeVisible();
    await assertContained(page, `mobile ${width} settings`);
    await page.screenshot({ path: testInfo.outputPath(`workspace-settings-phone-${width}.png`), fullPage: true });
    await page.goto("/app");
  }
  expect(errors).toEqual([]);
});

test("workspace brands stay isolated; template adoption, unsafe import and removal preserve saved identities", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => {
    errors.push(`Unexpected dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  const firstName = "Synthetic DDC workspace with uploaded logo";
  const secondName = "Synthetic Northwind workspace";
  const firstId = await createWorkspace(page, firstName);
  const secondId = await createWorkspace(page, secondName);
  const ddcnorth = JSON.parse(await readFile(brandFixture, "utf8"));
  const northwind = JSON.parse(await readFile(path.resolve("scripts/fixtures/brandkit/northwind.json"), "utf8"));
  const legacyLogo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#713F92"/></svg>')}`;
  const templateId = await page.evaluate(async ({ firstId, secondId, ddcnorth, northwind, legacyLogo }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const { importInvoiceBrand } = await import("/shared/invoiceBranding.ts");
    const { DEFAULT_INVOICE_TEMPLATE, applyDocumentBrand } = await import("/shared/invoiceCommerce.ts");
    await client.mutation("society:setLogo", { societyId: firstId, storageId: legacyLogo });
    const templateId = await client.mutation("invoices:upsertTemplate", {
      societyId: firstId, makeDefault: true,
      config: applyDocumentBrand({ ...DEFAULT_INVOICE_TEMPLATE, name: "Saved DDC document design" }, importInvoiceBrand(ddcnorth)),
    });
    await client.mutation("society:setWorkspaceBrand", { societyId: secondId, brand: importInvoiceBrand(northwind), useAccent: true });
    const users = await client.query("users:list", { societyId: firstId });
    setStoredSocietyId(firstId);
    setStoredUserId(users.find((row: any) => row.role === "Owner")._id);
    return templateId;
  }, { firstId, secondId, ddcnorth, northwind, legacyLogo });
  await page.reload();
  const settings = page.getByRole("region", { name: "Workspace Brandkit", exact: true });
  const sidebar = page.locator(".sidebar__workspace");
  const accent = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-primary"));
  await expect(settings).toBeVisible();
  await expect(sidebar).toContainText(firstName);
  await expect(sidebar.locator(".workspace-logo__light img")).toHaveAttribute("src", legacyLogo);
  expect(await accent()).toBe("");

  await settings.getByRole("button", { name: "Use document template brand", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Preview only");
  expect(await savedBrandId(page, firstId)).toBeNull();
  await expect(sidebar.locator(".workspace-logo__light img")).toHaveAttribute("src", legacyLogo);
  await settings.getByRole("button", { name: "Apply workspace brand", exact: true }).click();
  await expect(sidebar.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await expect.poll(accent).not.toBe("");

  const appliedAccent = await accent();
  const hostile = structuredClone(ddcnorth);
  hostile.logos.primary.svg = hostile.logos.primary.svg.replace("<svg", '<svg onload="alert(1)"');
  await settings.getByLabel("Import workspace Brandkit", { exact: true }).setInputFiles({
    name: "unsafe-workspace-brand.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(hostile)),
  });
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Apply workspace brand", exact: true })).toHaveCount(0);
  await expect(sidebar.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  expect(await savedBrandId(page, firstId)).toBe("ddcnorth");
  expect(await accent()).toBe(appliedAccent);

  const useAccent = settings.getByRole("switch", { name: /Use brand accent in the interface/ });
  const useAccentLabel = settings.getByText("Use brand accent in the interface", { exact: true });
  await expect(useAccent).toBeChecked();
  await useAccentLabel.click();
  await expect(useAccent).not.toBeChecked();
  expect(await accent()).toBe(appliedAccent);
  await settings.getByRole("button", { name: "Apply workspace brand", exact: true }).click();
  await expect.poll(accent).toBe("");
  await expect(sidebar.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await useAccentLabel.click();
  await expect(useAccent).toBeChecked();
  await settings.getByRole("button", { name: "Apply workspace brand", exact: true }).click();
  await expect.poll(accent).not.toBe("");

  // Leave an uncommitted preview before switching; it must never follow the active workspace.
  await settings.getByLabel("Import workspace Brandkit", { exact: true }).setInputFiles({
    name: "northwind.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(northwind)),
  });
  await expect(settings.getByRole("status")).toContainText("Preview only");
  await sidebar.click();
  const menu = page.getByRole("menu");
  const firstOption = menu.getByRole("menuitemradio", { name: new RegExp(firstName) });
  const secondOption = menu.getByRole("menuitemradio", { name: secondName, exact: true });
  await expect(firstOption).toHaveAttribute("aria-checked", "true");
  await expect(firstOption.locator('[data-brand-id="ddcnorth"]')).toBeVisible();
  await expect(secondOption.locator('[data-brand-id="northwind"]')).toBeVisible();
  await secondOption.click();
  await expect(sidebar).toContainText(secondName);
  await expect(sidebar.locator('[data-brand-id="northwind"]')).toBeVisible();
  expect(await savedBrandId(page, firstId)).toBe("ddcnorth");
  expect(await savedBrandId(page, secondId)).toBe("northwind");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-topbar__workspace").click();
  await expect(menu).toBeVisible();
  await assertContained(page, "mobile workspace menu");
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile-switcher.png"), fullPage: true });
  await firstOption.click();
  await expect(page.locator('.mobile-topbar__workspace [data-brand-id="ddcnorth"]')).toBeVisible();
  await page.goto("/app/settings");
  await expect(settings.getByRole("button", { name: "Remove workspace brand", exact: true })).toBeVisible();
  await expect(settings.getByRole("status")).toHaveCount(0);
  await settings.getByRole("button", { name: "Remove workspace brand", exact: true }).click();
  await expect(page.locator(".mobile-topbar__workspace [data-brand-id]")).toHaveCount(0);
  await expect(page.locator(".mobile-topbar__workspace .workspace-logo__light img")).toHaveAttribute("src", legacyLogo);
  await expect.poll(accent).toBe("");
  expect(await savedBrandId(page, firstId)).toBeNull();
  expect(await savedBrandId(page, secondId)).toBe("northwind");
  await page.reload();
  await expect(page.locator(".mobile-topbar__workspace .workspace-logo__light img")).toHaveAttribute("src", legacyLogo);
  await expect(settings.locator("[data-brand-id]")).toHaveCount(0);
  const savedTemplate = await page.evaluate(async societyId => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const data = await client.query("invoices:documentTemplates", { societyId });
    return { id: data.defaultTemplateId, brandId: data.templates.find((template: any) => template._id === data.defaultTemplateId)?.config.brand?.id };
  }, firstId);
  expect(savedTemplate).toEqual({ id: templateId, brandId: "ddcnorth" });
  expect(errors).toEqual([]);
});
