import { expect, test } from "@playwright/test";
import { assertLiveFits, liveFixture, signInLive } from "./helpers/liveInterface";

for (const role of ["Member", "Viewer"]) {
  test(`${role} reads each native meeting detail tab with matching readonly controls`, async ({ page }) => {
    const errors: string[] = [];
    const forbiddenQueries: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const blocked = role === "Member" ? new Set(["directors:list", "users:list", "committees:list", "committees:get", "conflicts:listForMeeting", "proxies:listForMeeting"]) : new Set<string>();
    page.on("websocket", socket => socket.on("framesent", frame => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.type === "ModifyQuerySet") for (const query of message.modifications ?? []) {
          if (query.type === "Add" && blocked.has(query.udfPath)) forbiddenQueries.push(query.udfPath);
        }
      } catch { /* Only public function names are retained. */ }
    }));
    await signInLive(page, role);
    const path = `/app/meetings/${liveFixture().ids.static_meeting_board_q2}`;
    for (const tab of ["overview", "minutes", "motions", "package", "export", "sources"]) {
      await page.goto(`${path}?tab=${tab}`);
      await expect(page.locator(".meeting-detail-summary")).toBeVisible();
      await assertLiveFits(page);
      if (tab === "minutes") {
        await expect(page.getByRole("button", { name: "Edit agenda", exact: true })).toBeDisabled();
        for (const button of await page.getByRole("button", { name: /^(Draft from saved transcript|Draft from pasted text|Choose audio|Transcribe & draft)$/ }).all()) await expect(button).toBeDisabled();
      }
      if (tab === "motions") await expect(page.getByRole("button", { name: "Add motion", exact: true })).toBeDisabled();
      if (tab === "overview") await expect(page.locator(".signature-form-row")).toHaveCount(0);
      if (tab === "sources") {
        for (const button of await page.getByRole("button", { name: /^(Edit transcript|Import VTT|Upload audio)$/ }).all()) await expect(button).toBeDisabled();
      }
    }
    expect(forbiddenQueries).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Director can persist native meeting agenda drafts while approval and backlog remain restricted", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await signInLive(page, "Director");
  await page.goto(`/app/meetings/${liveFixture().ids.static_meeting_board_q2}?tab=minutes`);
  await expect(page.getByRole("button", { name: "Edit agenda", exact: true })).toBeEnabled();
  await page.goto(`/app/meetings/${liveFixture().ids.static_meeting_board_q2}?tab=overview`);
  const approval = page.locator(".meeting-governance-strip__item").filter({ hasText: "Minutes approval" }).getByRole("button");
  await expect(approval).toBeDisabled();
  // Use an independently created native meeting so concurrent width runs do not overwrite each other's drafts.
  await page.locator(".meeting-governance-strip__item").filter({ hasText: "Next meeting" }).getByRole("button").click();
  const schedule = page.getByRole("dialog", { name: "Schedule next meeting", exact: true });
  await expect(schedule).toBeVisible();
  await schedule.getByLabel("Meeting title", { exact: true }).fill(`Director scoped meeting ${testInfo.project.name} ${Date.now()}`);
  const carry = schedule.getByRole("checkbox");
  if (await carry.count()) { await expect(carry).toBeDisabled(); await expect(carry).not.toBeChecked(); }
  await schedule.getByRole("button", { name: "Schedule meeting", exact: true }).click();
  await expect(schedule).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain(liveFixture().ids.static_meeting_board_q2);
  const ownMeetingPath = new URL(page.url()).pathname;
  await page.goto(`${ownMeetingPath}?tab=minutes`);
  await page.getByRole("button", { name: "Edit agenda", exact: true }).click();
  await page.locator(".meeting-minutes-agenda-editor").getByRole("button", { name: "Add item", exact: true }).click();
  const title = `Director native agenda ${testInfo.project.name} ${Date.now()}`;
  await page.locator(".meeting-minutes-agenda-editor input").last().fill(title);
  await page.getByRole("button", { name: "Save agenda", exact: true }).click();
  await expect(page.locator(".meeting-minutes-agenda-editor")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".meeting-minutes-agenda-card").getByText(title, { exact: false }).first()).toBeVisible();
  await assertLiveFits(page);
  await page.goto(`${ownMeetingPath}?tab=motions`);
  await expect(page.getByRole("button", { name: "Add motion", exact: true })).toBeEnabled();
  for (const button of await page.getByRole("button", { name: /backlog/i }).all()) await expect(button).toBeDisabled();
  expect(errors).toEqual([]);
});
