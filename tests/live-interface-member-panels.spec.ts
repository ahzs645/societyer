import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { hasPermission } from "../shared/functions/permissions";
import { assertLiveFits, liveFixture, signInLive } from "./helpers/liveInterface";

for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
  test(`${role} live member detail nested panels enforce their own read and write permissions`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    await signInLive(page, role);
    const memberPath = `/app/members/${liveFixture().ids.static_member_mina}`;
    await page.goto(memberPath);
    const tabs = page.locator(".tabs");
    await tabs.getByRole("button", { name: "Fields", exact: true }).click();
    if (!hasPermission(role, "settings:read")) {
      await expect(page.getByText("Custom fields require additional access.", { exact: true })).toBeVisible();
      await expect(page.locator(".custom-fields-panel")).toHaveCount(0);
    } else {
      const width = testInfo.project.use.viewport!.width;
      const text = page.getByRole("textbox", { name: `Live qualification text ${width}`, exact: true });
      const boolean = page.getByRole("checkbox", { name: "Live qualification boolean", exact: true });
      const date = page.locator(".custom-fields-panel .date-trigger");
      await expect(text).toBeVisible();
      if (hasPermission(role, "settings:write")) {
        await expect(text).toBeEditable();
        await expect(boolean).toBeEnabled();
        await expect(date).toBeEnabled();
        if (role === "Owner") {
          const value = `Native ${testInfo.project.name} ${Date.now()}`;
          await text.fill(value);
          await text.blur();
          // The app mutates over Convex's WebSocket transport. Read the stored
          // result with the same actual session before reloading the panel.
          const response = await page.context().request.get("/api/auth/token");
          expect(response.ok()).toBe(true);
          const { token } = await response.json();
          const client = new ConvexHttpClient("http://127.0.0.1:43230", { logger: false });
          client.setAuth(token);
          const fields = await client.query(makeFunctionReference("customFields:listDefinitions"), { societyId: liveFixture().societyId, entityType: "members" }) as any[];
          const field = fields.find((definition) => definition.label === `Live qualification text ${width}`);
          expect(field).toBeDefined();
          await expect.poll(async () => {
            const values = await client.query(makeFunctionReference("customFields:listValues"), { entityType: "members", subjectId: liveFixture().ids.static_member_mina }) as any[];
            return values.find((row) => row.definitionId === field._id)?.value;
          }).toBe(value);
          await page.reload();
          await expect(text).toHaveValue(value);
        }
      } else {
        await expect(text).toHaveAttribute("readonly", "");
        await expect(text).not.toBeEditable();
        await expect(boolean).toBeDisabled();
        await expect(date).toBeDisabled();
      }
    }
    await assertLiveFits(page);
    await tabs.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByText("Live qualification authored Member note", { exact: true })).toBeVisible();
    if (!hasPermission(role, "tasks:write")) {
      await expect(page.getByRole("status").filter({ hasText: "Read-only notes." })).toBeVisible();
      await expect(page.locator(".notes-panel__compose")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(?:Post note|Edit note|Delete note)$/ })).toHaveCount(0);
    } else {
      const composer = page.locator(".notes-panel__compose textarea");
      await expect(composer).toBeEditable();
      if (role === "Owner") {
        const body = `Live native nested note ${testInfo.project.name} ${Date.now()}`;
        await composer.fill(body);
        await page.getByRole("button", { name: "Post note", exact: true }).click();
        const note = page.locator(".notes-panel__item").filter({ hasText: body });
        await expect(note).toBeVisible();
        await page.reload();
        await expect(note).toBeVisible();
        await note.getByRole("button", { name: "Delete note", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
        await expect(note).toHaveCount(0);
      }
    }
    await assertLiveFits(page);
    await tabs.getByRole("button", { name: "Activity", exact: true }).click();
    if (!hasPermission(role, "audit:read")) await expect(page.getByText("Activity history unavailable", { exact: true })).toBeVisible();
    else await expect(page.locator(".activity-timeline[aria-busy=true]")).toHaveCount(0);
    await assertLiveFits(page);
    expect(errors).toEqual([]);
  });
}
