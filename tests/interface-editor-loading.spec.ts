import { expect, test } from "@playwright/test";

// Typing while the rich editor is still downloading and starting up must not
// lose keystrokes: a plain field takes the text, then hands over to the rich
// editor with the caret at the end so typing simply continues.
test("text typed while the rich editor loads is kept and typing continues in it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route(/\/src\/components\/MarkdownEditorImpl\.tsx(?:\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.continue();
  });
  await page.goto("/demo/app/deadlines");
  await page.getByRole("button", { name: "New deadline", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Add deadline", exact: true });
  const loadingField = drawer.locator(".markdown-editor-loading textarea");
  await expect(loadingField).toBeEditable();
  await loadingField.click();
  await page.keyboard.type("Early words ");
  const editor = drawer.locator(".ProseMirror");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(loadingField).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.type("then more.");
  await expect(editor).toHaveText("Early words then more.");
});
