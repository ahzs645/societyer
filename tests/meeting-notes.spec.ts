import { expect, test, type Page } from "@playwright/test";

// Meeting notes on the local runtime: a general / working meeting from the
// Meetings page, the AI notes card, and action items with "Create task".
// The local runtime drafts with the on-device model, which these tests don't
// configure, so the draft is saved through meetings:saveNotesDraft as the
// on-device path would. Synthetic data only.

const SHOTS = process.env.MEETING_NOTES_SCREENSHOTS;

async function seed(page: Page) {
  await page.goto("/app", { waitUntil: "networkidle" });
  return page.evaluate(async () => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", {
      name: "Notes flow review", jurisdictionCode: "CA-BC", entityType: "society",
    });
    setStoredSocietyId(societyId);
    const nowISO = new Date().toISOString();
    await client.mutation("peopleDirectory:upsert", { societyId, fullName: "Sam Rivera", nowISO });
    await client.mutation("committees:create", { societyId, name: "Finance Committee", description: "Synthetic", cadence: "Monthly", color: "blue" });
    return { societyId };
  });
}

test("working meeting notes: AI notes, action items and a task", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);

  // "Meeting notes" opens a new general / working meeting that keeps notes.
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Meeting body" })).toContainText("General / working meeting");
  await expect(dialog.getByText("Quorum required")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Title" }).fill("Funder call — Example Foundation");
  await dialog.locator("button.btn--accent").click();

  await expect(page.getByRole("heading", { name: /Funder call — Example Foundation/ })).toBeVisible({ timeout: 60_000 });
  const meetingId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/app/meetings/${meetingId}?tab=notes`);
  await expect(page.getByRole("heading", { name: "AI notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible();

  const notesEditor = page.locator(".meeting-notes-doc [contenteditable=\"true\"]");
  await notesEditor.click();
  await page.keyboard.type("Foundation wants a pilot report. Sam to send the budget.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  // The on-device path saves its draft through the portable mutation.
  await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    await client.mutation("meetings:saveNotesDraft", {
      id,
      template: "external_call",
      draft: {
        summary: "Example Foundation is open to a pilot if we report quarterly.",
        sections: [{ heading: "What they asked or need", points: ["A one-page pilot report", "Quarterly updates"] }],
        decisions: ["Apply for the pilot stream"],
        openQuestions: ["Who signs the agreement?"],
        actionItems: [{ text: "Sam to send the budget", atSec: 125 }, { text: "Draft the pilot report", dueDate: "2026-12-01" }],
      },
      generatedBy: "On-device: test model",
      usedNotes: true,
      usedTranscript: true,
    });
  }, meetingId);

  const aiNotes = page.getByRole("region", { name: "AI notes" });
  await expect(aiNotes.getByText("Example Foundation is open to a pilot")).toBeVisible();
  await expect(aiNotes.getByText("Apply for the pilot stream")).toBeVisible();
  await expect(aiNotes.getByText(/External call · drafted .* by On-device: test model/)).toBeVisible();

  const actions = page.getByRole("region", { name: "Action items" });
  await expect(actions.getByText("2 open of 2")).toBeVisible();
  await expect(actions.getByText("Suggested")).toHaveCount(2);
  await expect(actions.getByRole("link", { name: /Open the transcript at 2:05/ })).toBeVisible();

  // Link a committee, add a manual item, then turn the first into a task.
  const first = actions.getByRole("listitem").first();
  await first.getByRole("button", { name: "Committee" }).click();
  await page.getByRole("option", { name: "Finance Committee" }).click();
  await expect(first.getByText("Suggested")).toHaveCount(0);
  await actions.getByRole("textbox", { name: "New action item" }).fill("Book a follow-up call");
  await actions.getByRole("button", { name: "Add" }).click();
  await expect(actions.getByText("3 open of 3")).toBeVisible();
  if (SHOTS) {
    await aiNotes.screenshot({ path: `${SHOTS}/ai-notes.png` });
    await actions.screenshot({ path: `${SHOTS}/action-items.png` });
  }

  await first.getByRole("button", { name: "Create task" }).click();
  await expect(first.getByRole("link", { name: /Task · To do/ })).toBeVisible();

  const task = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const tasks = await client.query("tasks:byMeeting", { meetingId: id }) as any[];
    return tasks.find((row) => row.title === "Sam to send the budget");
  }, meetingId);
  expect(task.meetingId).toBe(meetingId);
  expect(task.committeeId).toBeTruthy();
  expect(task.transcriptRef).toEqual({ startSec: 125, endSec: 140 });

  // "Add to my notes" appends the draft under the person's own notes.
  await aiNotes.getByRole("button", { name: "Add to my notes" }).click();
  await expect(notesEditor).toContainText("Foundation wants a pilot report");
  await expect(notesEditor.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(notesEditor).toContainText("Example Foundation is open to a pilot");

  // A working meeting keeps no quorum and stays out of the minute book.
  await page.goto("/app/meetings");
  await expect(page.getByText("Funder call — Example Foundation")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/meetings-page.png` });
  expect(errors).toEqual([]);
});

test("notes tab on a phone keeps controls inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const societyId = getStoredSocietyId();
    const id = await client.mutation("meetings:create", {
      societyId, type: "Working", title: "1:1 check-in", scheduledAt: new Date().toISOString(),
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes", workingNotes: "- Sam to finish onboarding",
    });
    await client.mutation("meetings:saveNotesDraft", {
      id, template: "one_on_one", draft: { summary: "Good week.", actionItems: [{ text: "Sam to finish onboarding by Friday", atSec: 30 }] },
      generatedBy: "On-device: test model", usedNotes: true, usedTranscript: false,
    });
    return id;
  });
  await page.goto(`/app/meetings/${meetingId}?tab=notes`);
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.getByRole("region", { name: "Action items" }).screenshot({ path: `${SHOTS}/notes-phone.png` });
});
