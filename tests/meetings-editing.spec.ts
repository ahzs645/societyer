import { expect, test, type Page } from "@playwright/test";

// WP-G: native editing of transposed meetings — edit meeting (body, date-only
// with local time text, venue), the attendance grid ("not a person"
// corrections, directory links) and motion person pickers. Synthetic data only.

async function seed(page: Page) {
  await page.goto("/app", { waitUntil: "networkidle" });
  return page.evaluate(async () => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", {
      name: "Meetings editing review", jurisdictionCode: "CA-BC", entityType: "society",
    });
    setStoredSocietyId(societyId);
    const nowISO = new Date().toISOString();
    const alexId = await client.mutation("peopleDirectory:upsert", { societyId, fullName: "Alex Example", nowISO });
    await client.mutation("peopleDirectory:upsert", { societyId, fullName: "Blair Sample", nowISO });
    const committeeId = await client.mutation("committees:create", { societyId, name: "Executive Committee", description: "Synthetic", cadence: "Monthly", color: "blue" });
    const meetingId = await client.mutation("meetings:create", {
      societyId, type: "Board", title: "2013-05-14 ExecMinutes DRAFT.docx", scheduledAt: "2013-05-14T12:00:00.000Z",
      electronic: false, status: "Held", attendeeIds: [],
    });
    let minutes = await client.query("minutes:getByMeeting", { meetingId });
    if (!minutes) {
      await client.mutation("minutes:create", {
        societyId, meetingId, heldAt: "2013-05-14T12:00:00.000Z", attendees: [], absent: [], quorumMet: false,
        quorumStatus: "not_recorded", discussion: "Synthetic source minutes", decisions: [], actionItems: [], motions: [],
      });
      minutes = await client.query("minutes:getByMeeting", { meetingId });
    }
    await client.mutation("minutes:update", {
      id: minutes._id,
      patch: {
        attendees: ["Alex Example", "Vice President", "Members", "Blair Sample, Ministry of Examples"],
        motions: [{ text: "To approve the synthetic work plan (Carried)", outcome: "Pending", resolutionType: "Ordinary" }],
      },
    });
    return { societyId, meetingId, minutesId: minutes._id, alexId, committeeId };
  });
}

test("edit meeting, attendance grid and motion person pickers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await seed(page);

  await page.goto(`/app/meetings/${fixture.meetingId}`);
  const subtitle = page.getByTestId("meeting-subtitle");
  await expect(subtitle).toContainText("May 14, 2013", { timeout: 60_000 });
  // A date-only meeting never shows the noon-UTC placeholder as a clock time.
  await expect(subtitle).not.toContainText(/\d:\d\d\s?[AP]\.?M/i);

  // Edit meeting: body picker, date-only with local time text, venue.
  await page.getByTestId("edit-meeting").click();
  const drawer = page.getByRole("dialog", { name: "Edit meeting" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("textbox", { name: "Meeting title" }).fill("Executive meeting — 2013-05-14");
  // Escape must not silently discard the edit.
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Meeting body" }).click();
  await page.getByRole("option", { name: /^Executive Committee/ }).click();
  await drawer.getByRole("textbox", { name: "Start time as written" }).fill("6:00 PM");
  await drawer.getByRole("textbox", { name: "End time as written" }).fill("7:30 PM");
  await drawer.getByRole("combobox", { name: "Venue or join link" }).fill("Example Hall");
  await expect(drawer.getByTestId("edit-meeting-date-preview")).toContainText("May 14, 2013 · 6:00 PM – 7:30 PM");
  await drawer.getByTestId("edit-meeting-save").click();
  await expect(drawer).toBeHidden();
  await expect(subtitle).toContainText("Executive Committee");
  await expect(subtitle).toContainText("6:00 PM – 7:30 PM");
  await expect(subtitle).toContainText("Example Hall");
  await expect(page.getByRole("heading", { name: /Executive meeting — 2013-05-14/ })).toBeVisible();
  const saved = await page.evaluate(async (meetingId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return client.query("meetings:get", { id: meetingId });
  }, fixture.meetingId);
  expect(saved.committeeId).toBe(fixture.committeeId);
  expect(saved.type).toBe("Committee");
  expect(saved.scheduledAt).toBe("2013-05-14T12:00:00.000Z");
  expect(saved.scheduledAtPrecision).toBe("date");
  expect(saved.localStartText).toBe("6:00 PM");

  // Attendance grid: role words and headings are flagged; correcting them
  // updates the counts immediately; names link to the people directory.
  await page.getByRole("tab", { name: /Agenda & minutes/ }).click();
  await page.getByTestId("attendance-edit").click();
  const grid = page.getByTestId("attendance-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId("attendance-counts")).toContainText("4 present");
  await expect(grid.getByTestId("attendance-counts")).toContainText("2 entries look like a role, organization or heading");
  await grid.getByTestId("attendance-mark-all-non-persons").click();
  await expect(grid.getByTestId("attendance-counts")).toContainText("2 present");
  await expect(grid.getByTestId("attendance-non-persons")).toContainText("Vice President");
  await grid.getByRole("button", { name: /^Split into “Blair Sample”/ }).click();
  await grid.getByTestId("attendance-link-all").click();
  await grid.getByRole("button", { name: "Status for Blair Sample" }).click();
  await page.getByRole("option", { name: /^Regrets/ }).click();
  await expect(grid.getByTestId("attendance-counts")).toContainText("1 present");
  await page.getByTestId("attendance-save").click();
  await expect(grid).toBeHidden();
  await expect(page.locator("#meeting-attendance-card")).toContainText("2 source entries kept as evidence");
  await expect(page.locator(".meeting-detail-summary")).toContainText(/Present\s*1/);
  // Read stored data through the page's own client after a reload (a dev
  // server may serve HMR-versioned module URLs to earlier imports).
  await page.reload();
  await expect(page.locator("#meeting-attendance-card")).toContainText("2 source entries kept as evidence", { timeout: 60_000 });
  const minutes = await page.evaluate(async (meetingId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return client.query("minutes:getByMeeting", { meetingId });
  }, fixture.meetingId);
  expect(minutes.attendees).toEqual(["Alex Example"]);
  expect(minutes.absent).toEqual(["Blair Sample"]);
  expect(minutes.detailedAttendance.find((row: any) => row.name === "Alex Example").personId).toBe(fixture.alexId);
  expect(minutes.detailedAttendance.find((row: any) => row.name === "Blair Sample").affiliation).toBe("Ministry of Examples");

  // Motions: accept the source wording, then link the mover to the directory.
  await page.getByRole("tab", { name: /^Motions/ }).click();
  await page.getByTestId("accept-source-outcomes").click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept source wording", exact: true }).click();
  await expect(page.getByText("1 carried", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel(/^Mover for/).fill("Alex Example");
  await page.keyboard.press("Escape");
  await expect(page.locator(".person-picker__link").filter({ hasText: "Alex Example" }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(".meeting-detail-summary")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async (minutesId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const rows = await client.query("motions:listForMinutes", { minutesId });
    return rows[0]?.movedByPersonId ?? null;
  }, fixture.minutesId)).toBe(fixture.alexId);

  expect(errors.filter((message) => !/ResizeObserver/.test(message))).toEqual([]);
});
