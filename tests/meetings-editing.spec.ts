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

// Retest (meetings): a board meeting recorded from scratch through approved
// minutes — suggested title, mover typed at speed, officers from attendance,
// action with owner, approval. Synthetic data only.
test("record a new board meeting from scratch through approved minutes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", { name: "From scratch review", jurisdictionCode: "CA-BC", entityType: "society" });
    setStoredSocietyId(societyId);
    const nowISO = new Date().toISOString();
    for (const fullName of ["Alex Example", "Blair Sample", "Casey Demo"]) await client.mutation("peopleDirectory:upsert", { societyId, fullName, nowISO });
  });

  // A blank title takes the suggested "<Body> meeting — <date>".
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "New meeting" }).first().click();
  const modal = page.getByRole("dialog").last();
  const suggested = await modal.getByLabel("Title").first().getAttribute("placeholder");
  expect(suggested).toMatch(/^Board meeting — \d{4}-\d{2}-\d{2}$/);
  await modal.getByRole("button", { name: /^(Schedule|Record meeting)$/ }).last().click();
  await page.waitForURL(/\/app\/meetings\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: suggested! })).toBeVisible({ timeout: 60_000 });
  const meetingId = page.url().split("/").pop()!;

  // A meeting dated in the future asks before it is marked held.
  await page.getByRole("button", { name: "Mark held" }).click();
  await expect(page.getByRole("dialog", { name: "Mark a future meeting held?" })).toBeVisible();
  await page.getByRole("button", { name: "Mark held anyway" }).click();

  // It actually met last month: moving the date moves the dated title too.
  await page.getByTestId("edit-meeting").click();
  const drawer = page.getByRole("dialog", { name: "Edit meeting" });
  await drawer.locator(".date-trigger-wrap button").first().click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: /\b15, \d{4}$/ }).click();
  const retitled = await drawer.getByLabel("Meeting title").inputValue();
  expect(retitled).toMatch(/^Board meeting — \d{4}-\d{2}-15$/);
  await drawer.getByTestId("edit-meeting-save").click();
  await expect(page.getByRole("heading", { name: retitled })).toBeVisible();

  // Attendance with roles.
  await page.getByRole("tab", { name: /Agenda & minutes/ }).click();
  await page.getByTestId("attendance-edit").click();
  const grid = page.getByTestId("attendance-grid");
  await grid.getByRole("button", { name: /Paste names/ }).click();
  await grid.getByLabel("Names to add").fill("Alex Example (Chair)\nBlair Sample (Secretary)\nCasey Demo");
  await grid.getByRole("button", { name: "Add names" }).click();
  await page.getByTestId("attendance-save").click();
  await expect(grid).toBeHidden();

  // A motion whose mover is typed at speed keeps every character.
  await page.getByRole("tab", { name: /^Motions/ }).click();
  await page.getByRole("button", { name: "Add motion" }).first().click();
  await page.getByLabel("New motion name").fill("Approve the synthetic work plan");
  await page.getByLabel("Details", { exact: true }).first().fill("That the board approve the synthetic work plan.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const named = page.locator(".motion").filter({ has: page.locator('input[value="Approve the synthetic work plan"]') });
  await named.getByRole("button", { name: "Edit", exact: true }).click();
  const mover = page.getByLabel(/^Mover for Approve the synthetic work plan/);
  await mover.pressSequentially("Blair Sample", { delay: 20 });
  await expect(mover).toHaveValue("Blair Sample");
  await page.getByRole("radio", { name: "Carried" }).last().click();
  // No seconder or tally yet: the editor warns before recording the outcome.
  await page.getByRole("button", { name: "Record incomplete outcome" }).click();
  await expect.poll(async () => page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const minutes = await client.query("minutes:getByMeeting", { meetingId: id });
    const rows = await client.query("motions:listForMinutes", { minutesId: minutes._id });
    const row = rows.find((motion: any) => (motion.title ?? motion.name) === "Approve the synthetic work plan");
    return row ? `${row.movedBy}|${row.outcome}` : null;
  }, meetingId), { timeout: 15_000 }).toBe("Blair Sample|Carried");

  // Minutes details: chair and secretary come from the attendance roles.
  await page.getByRole("tab", { name: /Agenda & minutes/ }).click();
  await page.getByTestId("minutes-details-edit").click();
  await expect(page.getByLabel("Chair", { exact: true })).toHaveValue("Alex Example");
  await expect(page.getByLabel("Secretary", { exact: true })).toHaveValue("Blair Sample");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.locator("#main-content")).toContainText("Chair: Alex Example");

  // An action with an owner.
  const actions = page.getByTestId("action-items-card");
  await actions.getByTestId("add-action-item").click();
  const form = actions.getByTestId("add-action-form");
  await form.locator("input").first().fill("Circulate the approved work plan");
  await form.getByLabel("Action owner").fill("Casey Demo");
  await page.keyboard.press("Escape");
  await form.getByTestId("add-action-save").click();
  await expect(actions).toContainText("Circulate the approved work plan");
  await expect(actions).toContainText("Casey Demo");

  // Approve; approved minutes are read-only after a reload.
  await page.getByRole("tab", { name: /Overview/ }).click();
  await page.getByRole("button", { name: "Record approval" }).click();
  const approval = page.getByRole("dialog", { name: "Record minutes approval" });
  await approval.locator(".date-trigger-wrap button").first().click();
  await page.getByRole("button", { name: "Today" }).click();
  await approval.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#main-content")).toContainText(/Approved \w{3} \d{1,2}, \d{4}/);
  await page.reload();
  await page.getByRole("tab", { name: /^Motions/ }).click();
  await expect(page.getByRole("button", { name: "Add motion" }).first()).toBeDisabled({ timeout: 60_000 });

  expect(errors.filter((message) => !/ResizeObserver/.test(message))).toEqual([]);
});

// Polish retest (MA-1…MA-10) on a future scheduled meeting. Synthetic data only.
async function seedScheduled(page: Page) {
  await page.goto("/app", { waitUntil: "networkidle" });
  return page.evaluate(async () => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", { name: "Meetings polish review", jurisdictionCode: "CA-BC", entityType: "society" });
    setStoredSocietyId(societyId);
    const nowISO = new Date().toISOString();
    for (const fullName of ["Alex Example", "Blair Sample", "Casey Demo"]) await client.mutation("peopleDirectory:upsert", { societyId, fullName, nowISO });
    const scheduledAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const meetingId = await client.mutation("meetings:create", {
      societyId, type: "Board", title: "Synthetic scheduled board meeting", scheduledAt, electronic: false, status: "Scheduled", attendeeIds: [], quorumRequired: 2,
    });
    let minutes = await client.query("minutes:getByMeeting", { meetingId });
    if (!minutes) {
      await client.mutation("minutes:create", {
        societyId, meetingId, heldAt: scheduledAt, attendees: [], absent: [], quorumMet: false,
        quorumStatus: "not_recorded", discussion: "", decisions: [], actionItems: [], motions: [],
      });
      minutes = await client.query("minutes:getByMeeting", { meetingId });
    }
    await client.mutation("minutes:update", {
      id: minutes._id,
      patch: {
        attendees: ["Alex Example", "Blair Sample", "Casey Demo"],
        sections: [{ title: "Finance report", type: "report", discussion: "", decisions: [], actionItems: [] }],
        actionItems: [
          { text: "Circulate the synthetic budget", assignee: "Casey Demo", dueDate: "2026-10-20", done: false },
          { text: "Book the synthetic hall", dueDate: "before the AGM", done: false },
        ],
      },
    });
    return { meetingId, minutesId: minutes._id as string };
  });
}

test("motion and meeting polish: no default votes, labels, summary, debounced saves, escape guard, expected attendance", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await seedScheduled(page);
  await page.goto(`/app/meetings/${fixture.meetingId}`);
  const summary = page.locator(".meeting-detail-summary");
  await expect(summary).toBeVisible({ timeout: 60_000 });

  // MA-8: a scheduled meeting next month lists who is expected; quorum is not decided yet.
  await expect(summary).toContainText("Expected");
  await expect(summary).not.toContainText("Present");
  await page.getByRole("tab", { name: /Agenda & minutes/ }).click();
  await expect(page.locator("#meeting-attendance-card")).toContainText("Quorum: not yet determined");
  await expect(page.getByTestId("attendance-counts")).toContainText("3 expected");
  await expect(page.getByTestId("attendance-counts")).toContainText("determined at the meeting");

  // MA-7: ISO due dates use the app's date format; free text stays as written.
  const actions = page.getByTestId("action-items-card");
  await expect(actions).toContainText("Oct 20, 2026");
  await expect(actions).not.toContainText("2026-10-20");
  await expect(actions).toContainText("before the AGM");

  // MA-4: Escape in the section title asks before discarding the edit.
  await page.getByRole("button", { name: "Edit agenda item" }).first().click();
  const title = page.locator(".meeting-minutes-section-item__title-input");
  await title.fill("Finance report (revised)");
  await title.press("Escape");
  const discard = page.getByRole("dialog", { name: "Discard changes to this section?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(title).toHaveValue("Finance report (revised)");
  await title.press("Escape");
  await page.getByRole("dialog", { name: "Discard changes to this section?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(title).toBeHidden();

  // MA-1/MA-2: mover and seconder are not votes; outcome labels stay visible.
  await page.getByRole("tab", { name: /^Motions/ }).click();
  await page.getByRole("button", { name: "Add motion" }).first().click();
  await page.getByLabel("New motion name").fill("Approve the synthetic budget");
  await page.getByLabel("Details", { exact: true }).first().fill("That the board approve the synthetic budget as presented.");
  const draft = page.locator(".motion-draft");
  await draft.locator(".motion-draft__details-summary").click();
  await page.getByLabel("New motion mover").pressSequentially("Alex Example", { delay: 10 });
  await page.keyboard.press("Escape");
  await page.getByLabel("New motion seconder").pressSequentially("Blair Sample", { delay: 10 });
  await page.keyboard.press("Escape");
  await expect(draft.getByLabel("For", { exact: true })).toHaveValue("0");
  const carriedLabel = draft.locator(".motion-outcome-picker .btn-action__label").filter({ hasText: "Carried" });
  expect((await carriedLabel.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  await draft.getByRole("button", { name: "Add", exact: true }).click();

  // MA-3: the collapsed motion shows its wording and who moved and seconded it.
  const collapsed = page.getByTestId("motion-collapsed-summary").first();
  await expect(collapsed).toContainText("That the board approve the synthetic budget as presented.");
  await expect(collapsed).toContainText(/Moved by Alex Example, seconded by Blair Sample/);

  // MA-5: the resolution type the form showed is stored.
  await expect.poll(async () => page.evaluate(async (minutesId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const rows = await client.query("motions:listForMinutes", { minutesId });
    const row = rows.find((motion: any) => (motion.title ?? motion.name) === "Approve the synthetic budget");
    return row ? `${row.resolutionTypeLabel ?? row.resolutionType}|${row.votesFor ?? 0}` : null;
  }, fixture.minutesId), { timeout: 15_000 }).toBe("Ordinary|0");

  // MA-10: typing a motion name is one save after a pause, not one per key.
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const w = window as any;
    w.__motionWrites = 0;
    if (!w.__countingWrites) {
      w.__countingWrites = true;
      const original = client.mutation.bind(client);
      client.mutation = (fn: any, args: any) => {
        if (args?.patch && "motions" in args.patch) w.__motionWrites += 1;
        return original(fn, args);
      };
    }
  });
  // The input is labelled by the motion name, which changes as it is typed.
  const nameInput = page.locator("input.motion__name-input").first();
  await expect(nameInput).toHaveValue("Approve the synthetic budget");
  await nameInput.fill("");
  await nameInput.pressSequentially("Adopt the synthetic budget", { delay: 25 });
  await expect(nameInput).toHaveValue("Adopt the synthetic budget");
  await page.waitForTimeout(1500);
  const writes = await page.evaluate(() => (window as any).__motionWrites as number);
  expect(writes).toBeGreaterThan(0);
  expect(writes).toBeLessThanOrEqual(3);
  await expect.poll(async () => page.evaluate(async (minutesId) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const rows = await client.query("motions:listForMinutes", { minutesId });
    return rows.some((motion: any) => (motion.title ?? motion.name) === "Adopt the synthetic budget");
  }, fixture.minutesId), { timeout: 15_000 }).toBe(true);

  // MA-9: phone summary labels wrap instead of truncating.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /Overview/ }).click();
  const clipped = await page.locator(".meeting-detail-summary span").evaluateAll((spans) =>
    spans.filter((span) => span.scrollWidth > span.clientWidth + 1).map((span) => span.textContent));
  expect(clipped).toEqual([]);

  expect(errors.filter((message) => !/ResizeObserver/.test(message))).toEqual([]);
});
