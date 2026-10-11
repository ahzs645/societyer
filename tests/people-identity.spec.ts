import { expect, test, type Page } from "@playwright/test";

/**
 * WP-H: people merge, members & representatives, historical source actions.
 * Synthetic data in a fresh local workspace.
 */
/** Seed synthetic rows into the local demo workspace the page has selected. */
async function freshWorkspace<T>(page: Page, _name: string, seed: (input: { societyId: string }) => Promise<T>): Promise<T & { societyId: string }> {
  await page.goto("/app", { waitUntil: "networkidle" });
  await expect(page.locator(".sidebar__spotlight-meta--link").first()).toContainText(/\d/, { timeout: 30_000 });
  const societyId = await page.evaluate(async () => {
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts" as string);
    return getStoredSocietyId() as string;
  });
  // The seed function is serialized by Playwright (no eval in the page: CSP).
  const seeded = await page.evaluate(seed, { societyId });
  return { societyId, ...(seeded as T) };
}

const tabCount = async (page: Page, name: RegExp) => Number((await page.getByRole("tab", { name }).innerText()).match(/\((\d+)\)/)?.[1]);


test("duplicate profiles are suggested, merged with history and undone", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await freshWorkspace(page, "Identity merge review", async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const keep = await client.mutation("personHistory:createContact", { societyId, fullName: "Jordan Fixture" });
    const duplicate = await client.mutation("personHistory:createContact", { societyId, fullName: "Jordon Fixture" });
    const meetingId = await client.mutation("meetings:create", { societyId, type: "Board", title: "Fixture board meeting", scheduledAt: "2019-03-01T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [] });
    await client.mutation("minutes:create", { societyId, meetingId, heldAt: "2019-03-01T12:00:00.000Z", attendees: ["Jordon Fixture"], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "Fixture", decisions: [], actionItems: [], motions: [] });
    const minutes = await client.query("minutes:getByMeeting", { meetingId });
    await client.mutation("personHistory:observe", { societyId, observation: { occurrenceKey: "fixture-attendance", recordTable: "minutes", recordId: minutes._id, personName: "Jordon Fixture", context: "Attendance (Present)", observedDate: "2019-03-01", meetingId, personId: duplicate, sourceUrl: "https://example.invalid/minutes", sourceReference: "Attendance list" } });
    return { keep, duplicate };
  });
  await page.goto("/app/people-directory");
  const suggestions = page.locator(".people-duplicates");
  await expect(suggestions).toContainText("Jordon Fixture", { timeout: 30_000 });
  await suggestions.locator(".people-duplicates__row", { hasText: "Jordon Fixture" }).getByRole("button", { name: /Merge/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Jordan Fixture", { exact: false }).first().check().catch(() => {});
  await dialog.getByPlaceholder(/same organization/).fill("Same person; spelling variant in one set of minutes");
  await dialog.getByRole("button", { name: /^Merge into/ }).click();
  await expect(page.getByRole("heading", { name: "Merge history" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".people-duplicates__row", { hasText: "Jordon Fixture" })).toHaveCount(0);

  await page.goto(`/app/people-directory/${fixture.duplicate}`);
  await expect(page.getByText("Jordon Fixture was merged")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Open Jordan Fixture" }).click();
  await expect(page.getByRole("heading", { name: /Meetings, roster observations/ })).toContainText("(1)", { timeout: 20_000 });

  await page.goto("/app/people-directory");
  await page.getByRole("button", { name: "Undo" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo merge" }).click();
  await expect(page.getByText(/· undone/).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/app/people-directory/${fixture.duplicate}`);
  await expect(page.getByRole("heading", { name: "Jordon Fixture" })).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("an organization member gets a representative change recorded as a new term", async ({ page }) => {
  await freshWorkspace(page, "Members and representatives review", async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    await client.mutation("memberGovernance:observeSeat", { societyId, seatKey: "Fictional Clinic / Board", organizationName: "Fictional Clinic", observation: { id: "seat-obs-1", kind: "contact", personName: "Casey Former", roleTitle: "Director", observedDate: "2020", reviewStatus: "pending", sourceUrl: "https://example.invalid/roster", sourceReference: "Board roster row 2" } });
    return {};
  });
  await page.goto("/app/members");
  const card = page.locator(".members-reps");
  await card.locator("summary").click();
  await expect(card).toContainText("Fictional Clinic", { timeout: 30_000 });
  await card.locator(".members-reps__org", { hasText: "Fictional Clinic" }).getByRole("button", { name: "Create member record" }).click();
  let drawer = page.getByRole("dialog").last();
  await drawer.getByLabel(/Joined/).fill("2015");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(card.locator(".members-reps__org", { hasText: "Fictional Clinic" })).toContainText("Member · Active", { timeout: 20_000 });
  await card.locator(".members-reps__org", { hasText: "Fictional Clinic" }).getByRole("button", { name: /Show seats/ }).click();
  await card.getByRole("button", { name: /Change representative/ }).first().click();
  drawer = page.getByRole("dialog").last();
  await drawer.getByLabel("Name as written in the source").fill("Robin Successor");
  await drawer.getByLabel(/Term starts/).fill("2021-09");
  await drawer.getByLabel("Source URL").fill("https://example.invalid/special-resolution");
  await drawer.getByLabel(/Citation/).fill("Special resolution 2021-3");
  await drawer.getByRole("button", { name: "Record representative" }).click();
  await expect(card.locator(".members-reps__seat").first()).toContainText("Robin Successor", { timeout: 20_000 });
  await card.locator(".members-reps__seat").first().getByRole("button", { name: /History/ }).click();
  await expect(card.getByText(/superseded/)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/Casey Former · Director · \? – 2021-09/)).toBeVisible();
});

test("historical source actions stay out of open work until converted", async ({ page }) => {
  await freshWorkspace(page, "Historical actions review", async ({ societyId }) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const base = { societyId, priority: "Medium", status: "Todo" };
    await client.mutation("tasks:create", { ...base, title: "Review historical action: Robin to book the hall", tags: ["historical-source-action"] });
    await client.mutation("tasks:create", { ...base, title: "Review historical action: Robin to book the hall.", tags: ["historical-source-action"] });
    await client.mutation("tasks:create", { ...base, title: "Prepare the annual report", tags: [] });
    return {};
  });
  await page.goto("/app/tasks");
  await expect(page.getByRole("tab", { name: /History \(2\)/ })).toBeVisible({ timeout: 30_000 });
  const current = await tabCount(page, /Current/);
  await page.getByRole("tab", { name: /History/ }).click();
  await page.getByRole("button", { name: /Tidy duplicates/ }).click();
  const preview = page.getByRole("dialog");
  await expect(preview).toContainText("1 carried-forward duplicate folded");
  await preview.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("tab", { name: /History \(1\)/ })).toBeVisible({ timeout: 20_000 });
  expect(await tabCount(page, /Current/)).toBe(current);
  const row = page.locator("tr", { hasText: "Robin to book the hall" }).first();
  await row.hover();
  await row.getByRole("button", { name: /Complete/ }).click();
  await expect(page.getByRole("dialog")).toContainText("you, today");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await row.hover();
  await row.getByRole("button", { name: /Make current/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Convert" }).click();
  await expect(page.getByRole("tab", { name: /History \(0\)/ })).toBeVisible({ timeout: 20_000 });
  expect(await tabCount(page, /Current/)).toBe(current + 1);
});
