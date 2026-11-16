import { expect, test, type Page } from "@playwright/test";
import { chromiumLaunchOptions } from "../playwright.chromium";

// Meeting notes on the local runtime: a general / working meeting from the
// Meetings page, the AI notes card, and action items with "Create task".
// The local runtime drafts with the on-device model, which these tests don't
// configure, so the draft is saved through meetings:saveNotesDraft as the
// on-device path would. Synthetic data only.

const SHOTS = process.env.MEETING_NOTES_SCREENSHOTS;

// A fake microphone for the recorder test (Chromium only).
test.use({
  permissions: ["microphone", "clipboard-read", "clipboard-write"],
  launchOptions: { ...(chromiumLaunchOptions() ?? {}), args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

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
  // A notes meeting opens on its notes: My notes, with action items below and the Ask bar.
  const views = page.getByRole("group", { name: "Notes view" });
  await expect(views.getByRole("button", { name: "My notes" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible();
  // AI agents are off in this workspace, so the Ask bar says how to turn them on.
  await expect(page.getByRole("link", { name: "turn on AI agents in Settings" })).toBeVisible();

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

  await views.getByRole("button", { name: "AI notes" }).click();
  await expect(page).toHaveURL(/view=ai/);
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
  await views.getByRole("button", { name: "My notes" }).click();
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
  // On a phone the action items are their own view.
  const views = page.getByRole("group", { name: "Notes view" });
  await expect(views.getByRole("button", { name: /Actions/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Action items" })).toHaveCount(0);
  await views.getByRole("button", { name: /Actions/ }).click();
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.getByRole("region", { name: "Action items" }).screenshot({ path: `${SHOTS}/notes-phone.png` });
});

test("AI notes suggestions: name diarized speakers, add attendees, see the people the AI knows", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const societyId = getStoredSocietyId();
    const people = await client.query("peopleDirectory:list", { societyId }) as any[];
    const sam = people.find((person) => person.fullName === "Sam Rivera");
    const id = await client.mutation("meetings:create", {
      societyId, type: "Working", title: "Partner call", scheduledAt: "2026-11-12T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes", workingNotes: "- Sam to send the budget",
    });
    await client.mutation("transcripts:importTimed", {
      societyId, meetingId: id, provider: "vtt", durationSeconds: 20,
      segments: [
        { speaker: "SPEAKER_00", text: "Hi, Sam Rivera here, I'll send the budget.", startSec: 0, endSec: 5 },
        { speaker: "SPEAKER_01", text: "Thanks Sam.", startSec: 6, endSec: 8 },
      ],
    });
    await client.mutation("meetings:saveNotesDraft", {
      id, template: "external_call",
      draft: { summary: "Budget follow-up.", actionItems: [{ text: "Send the budget", assignee: "Sam Rivera", assigneePersonId: sam._id }] },
      speakers: [{ label: "SPEAKER_00", name: "Sam Rivera", personId: sam._id, evidence: "Sam Rivera here" }],
      attendees: [{ name: "Sam Rivera", personId: sam._id }],
      generatedBy: "On-device: test model", usedNotes: true, usedTranscript: true,
    });
    return id;
  });
  // With a draft on file, the notes open on the AI notes.
  await page.goto(`/app/meetings/${meetingId}?tab=notes`);
  const aiNotes = page.getByRole("region", { name: "AI notes" });
  await expect(aiNotes.getByText("Budget follow-up.")).toBeVisible({ timeout: 60_000 });

  // The suggested owner is linked to the person in the directory.
  const actions = page.getByRole("region", { name: "Action items" });
  await expect(actions.getByRole("listitem").first().getByRole("combobox", { name: "Who" })).toHaveValue("Sam Rivera");

  const speakers = aiNotes.getByRole("region", { name: "Who's speaking" });
  await expect(speakers.getByText("“Sam Rivera here”")).toBeVisible();
  await speakers.getByRole("button", { name: "Name speaker" }).click();
  await expect(speakers.getByText("Named")).toBeVisible();

  const tookPart = aiNotes.getByRole("region", { name: "Took part" });
  await tookPart.getByRole("button", { name: "Add to attendees" }).click();
  await expect(tookPart.getByRole("button", { name: /Add/ })).toHaveCount(0);

  await page.getByText("People the AI knows").click();
  const roster = page.locator(".notes-roster");
  await expect(roster.getByText("Sam Rivera")).toBeVisible();
  await expect(roster.getByText("attending")).toBeVisible();
  if (SHOTS) await aiNotes.screenshot({ path: `${SHOTS}/ai-notes-suggestions.png` });

  const named = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const transcript = await client.query("transcripts:getByMeeting", { meetingId: id }) as any;
    return transcript.speakers;
  }, meetingId);
  expect(named.some((speaker: any) => speaker.label === "SPEAKER_00" && speaker.name === "Sam Rivera" && speaker.personId)).toBe(true);
  expect(errors).toEqual([]);
});

test("templates, export, Ask bar and recording on the notes surface", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    return client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Weekly check-in", scheduledAt: "2026-11-12T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: ["Sam Rivera"], recordKind: "notes",
    });
  });
  await page.goto(`/app/meetings/${meetingId}`);
  // No ?tab=: a notes meeting opens on its notes.
  const editor = page.locator(".meeting-notes-doc [contenteditable=\"true\"]");
  await expect(editor).toBeVisible({ timeout: 60_000 });

  // Empty notes offer templates that insert their headings.
  await page.getByRole("group", { name: "Start from a template" }).getByRole("button", { name: "Check-in / stand-up" }).click();
  await expect(editor.getByRole("heading", { name: "Progress since last time" })).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Blockers" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Start from a template" })).toHaveCount(0);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  // ••• exports the meeting as Markdown and copies a recap.
  await page.getByRole("button", { name: "More: export and recap" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Download Markdown/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("2026-11-12 Weekly check-in.md");
  const markdown = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  expect(markdown).toContain("# Weekly check-in");
  expect(markdown).toContain("**Attendees:** Sam Rivera");
  expect(markdown).toContain("### Progress since last time");

  // Without the AI agents module the Ask bar says how to turn it on.
  await expect(page.getByRole("link", { name: "turn on AI agents in Settings" })).toBeVisible();
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    await client.mutation("society:updateModules", { societyId: getStoredSocietyId(), disabledModules: ["+aiAgents"] });
  });
  // The Ask bar opens the assistant with the question and the meeting attached.
  await page.getByRole("button", { name: "What did we decide?" }).click();
  const assistant = page.locator(".global-ai-composer");
  await expect(assistant).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".global-ai-file-chip__name")).toHaveText("2026-11-12 Weekly check-in (meeting context).md");
  // No AI model is set up in this workspace, so the question waits in the composer.
  await expect(page.locator(".global-ai-composer textarea")).toHaveValue("What did we decide?");

  // Record with the (fake) microphone; the floating bar follows across pages.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Record/ }).click();
  await page.getByRole("menuitem", { name: /^Microphone/ }).first().click();
  const bar = page.getByRole("region", { name: "Meeting recording" });
  await expect(bar.getByText("Recording", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Stop · 0:0/ })).toBeVisible();
  // Moving around the app keeps recording (a reload would end it, and asks first).
  await page.getByRole("link", { name: "Meetings", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/meetings$/);
  await expect(bar.getByText("Weekly check-in")).toBeVisible();
  await page.waitForTimeout(2500);
  if (SHOTS) await bar.screenshot({ path: `${SHOTS}/recording-bar.png` });
  await bar.getByRole("button", { name: "Stop recording" }).click();
  // A browser-only workspace keeps no recordings: the bar offers the file instead.
  await expect(bar.getByText(/doesn't keep recordings/)).toBeVisible({ timeout: 15_000 });
  await expect(bar.getByRole("button", { name: "Download" })).toBeVisible();
  await bar.getByRole("link", { name: "Open transcript" }).click();
  // The recording opens in the Transcript view, ready to play or transcribe on this device.
  await expect(page.getByRole("group", { name: "Notes view" }).getByRole("button", { name: "Transcript" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Change recording/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Weekly check-in .*\.(webm|m4a|ogg)/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Meetings timeline groups meetings by day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const societyId = getStoredSocietyId();
    const day = (offset: number, hour: number) => { const date = new Date(); date.setDate(date.getDate() + offset); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
    const make = (title: string, scheduledAt: string, extra: Record<string, unknown> = {}) => client.mutation("meetings:create", {
      societyId, type: "Working", title, scheduledAt, electronic: true, status: "Scheduled", attendeeIds: [], recordKind: "notes", ...extra,
    });
    await make("Funder call", day(0, 15), { remoteUrl: "https://meet.example.org/funder" });
    await make("Staff stand-up", day(1, 9));
    await make("Volunteer debrief", day(-1, 18));
  });
  await page.goto("/app/meetings");
  await page.getByRole("group", { name: "Meetings layout" }).getByRole("button", { name: "Timeline" }).click();
  const timeline = page.getByLabel("Meetings by day");
  await expect(timeline.getByRole("region", { name: "Tomorrow" }).getByText("Staff stand-up")).toBeVisible({ timeout: 60_000 });
  const today = timeline.getByRole("region", { name: "Today" });
  await expect(today.getByText("Funder call")).toBeVisible();
  await expect(today.getByRole("button", { name: "Join & record" })).toBeVisible();
  await expect(timeline.getByRole("region", { name: "Yesterday" }).getByText("Volunteer debrief")).toBeVisible();
  // Coming up first, then today, then earlier days.
  const order = await timeline.locator(".meetings-timeline__label").allTextContents();
  expect(order.map((label) => label.replace(/Today$/, "").trim()).slice(0, 3)).toEqual(["Tomorrow", "Today", "Yesterday"]);
  if (SHOTS) await timeline.screenshot({ path: `${SHOTS}/timeline.png` });
  // The layout is remembered.
  await page.reload();
  await expect(page.getByLabel("Meetings by day")).toBeVisible({ timeout: 60_000 });
  await today.getByRole("link", { name: /Open notes: Funder call/ }).click();
  await expect(page.getByRole("group", { name: "Notes view" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("notes surface on a phone: one view at a time, ••• holds the rest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const id = await client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Partner call", scheduledAt: new Date().toISOString(),
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes", workingNotes: "## Context\n\n- Pilot funding",
    });
    await client.mutation("meetings:saveNotesDraft", {
      id, template: "external_call", draft: { summary: "They'll fund a pilot.", decisions: ["Apply"], actionItems: [{ text: "Send the budget" }] },
      generatedBy: "On-device: test model", usedNotes: true, usedTranscript: false,
    });
    return id;
  });
  await page.goto(`/app/meetings/${meetingId}`);
  const views = page.getByRole("group", { name: "Notes view" });
  await expect(views.getByRole("button", { name: "AI notes" })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(page.getByText("They'll fund a pilot.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-ai-notes.png` });
  await views.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("Pilot funding")).toBeVisible();
  await page.getByRole("button", { name: "More: export and recap" }).click();
  await expect(page.getByRole("menuitem", { name: /Meeting details/ })).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(400); // let the menu finish opening
    await page.screenshot({ path: `${SHOTS}/phone-more.png` });
  }
  await page.getByRole("menuitem", { name: /Meeting details/ }).click();
  await expect(page).toHaveURL(/tab=overview/);
  // And back: the Notes tab is the default for a notes meeting.
  await page.getByRole("tab", { name: /Notes/ }).first().click();
  await expect(page.getByRole("group", { name: "Notes view" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("quotes: Quote in notes from a transcript selection, and the AI notes' key quotes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const societyId = getStoredSocietyId();
    const id = await client.mutation("meetings:create", {
      societyId, type: "Working", title: "Partner call", scheduledAt: "2026-11-12T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes", workingNotes: "- Pilot",
    });
    await client.mutation("transcripts:importTimed", {
      societyId, meetingId: id, provider: "vtt", durationSeconds: 30,
      segments: [
        { speaker: "SPEAKER_00", text: "Hi, Sam Rivera here.", startSec: 0, endSec: 5 },
        { speaker: "SPEAKER_01", text: "Small pilots are where we learn the most.", startSec: 12, endSec: 18 },
      ],
    });
    await client.mutation("meetings:saveNotesDraft", {
      id, template: "external_call",
      draft: { summary: "They'll fund a pilot.", quotes: [{ text: "Small pilots are where we learn the most.", speaker: "SPEAKER_01", atSec: 12 }] },
      generatedBy: "On-device: test model", usedNotes: true, usedTranscript: true,
    });
    return id;
  });
  await page.goto(`/app/meetings/${meetingId}?tab=notes&view=ai`);
  const keyQuotes = page.getByRole("region", { name: "Key quotes" });
  await expect(keyQuotes.getByText("“Small pilots are where we learn the most.”")).toBeVisible({ timeout: 60_000 });
  // A quote's time opens the Transcript view at that moment.
  await keyQuotes.getByRole("link", { name: "Open the transcript at 0:12" }).click();
  await expect(page).toHaveURL(/view=transcript/);
  await expect(page).toHaveURL(/t=12/);
  const line = page.locator("[data-segment]", { hasText: "Small pilots are where we learn the most." });
  await expect(line).toBeVisible({ timeout: 15_000 });

  // Select the line and quote it into the notes.
  await line.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("toolbar", { name: "Selected transcript text" }).getByRole("button", { name: "Quote in notes" }).click();
  await expect(page.getByText("Quoted in your notes.")).toBeVisible();
  await page.getByRole("group", { name: "Notes view" }).getByRole("button", { name: "My notes" }).click();
  const editor = page.locator(".meeting-notes-doc [contenteditable=\"true\"]");
  await expect(editor.locator("blockquote")).toContainText("“Small pilots are where we learn the most.”");
  await expect(editor.locator("blockquote")).toContainText("— SPEAKER_01, 0:12");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  const saved = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return ((await client.query("meetings:get", { id })) as any)?.workingNotes as string;
  }, meetingId);
  // The editor saves standard Markdown escapes (SPEAKER\_01, \& in the link); the link still opens that moment.
  expect(saved).toMatch(/> “Small pilots are where we learn the most\.”\n>\n> — SPEAKER\\?_01, \[0:12\]\(\/app\/meetings\/[^)]*tab=notes\\?&view=transcript\\?&t=12-18\)/);
  expect(errors).toEqual([]);
});

test("recorder: Stop on the Notes tab keeps the file, closing asks first, an interrupted recording is offered back", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    return client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Board prep", scheduledAt: "2026-11-12T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes",
    });
  });
  await page.goto(`/app/meetings/${meetingId}?tab=notes&view=transcript`);
  await expect(page.getByRole("group", { name: "Notes view" })).toBeVisible({ timeout: 60_000 });
  const bar = page.getByRole("region", { name: "Meeting recording" });

  // Record with the Transcript view already open, and stop from the tab's own button.
  await page.getByRole("button", { name: /^Record/ }).click();
  await page.getByRole("menuitem", { name: /^Microphone/ }).first().click();
  await expect(bar.getByText("Recording", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: /^Stop · / }).click();
  await expect(bar.getByText(/doesn't keep recordings/)).toBeVisible({ timeout: 15_000 });
  await expect(bar.getByRole("button", { name: "Download" })).toBeVisible();
  // The Transcript view, opened before recording and kept mounted, picks the recording up.
  await page.getByRole("group", { name: "Notes view" }).getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".notes-surface__view--transcript").getByText(/Board prep .*\.(webm|m4a|ogg)/).first()).toBeVisible({ timeout: 15_000 });

  // Closing without keeping it asks first.
  await bar.getByRole("button", { name: "Close" }).click();
  const dialog = page.getByRole("dialog", { name: "Close without keeping the recording?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(bar.getByRole("button", { name: "Download" })).toBeVisible();
  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/^Board prep .*\.(webm|m4a|ogg)$/);
  await bar.getByRole("button", { name: "Close" }).click();
  await expect(bar).toHaveCount(0);

  // A recording cut off by a reload is kept in the browser and offered back.
  await page.getByRole("button", { name: /^Record/ }).click();
  await page.getByRole("menuitem", { name: /^Microphone/ }).first().click();
  await expect(bar.getByText("Recording", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6_000);
  await page.reload();
  // Not offered while it may still be running in another tab: age it as if the tab had closed a while ago.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("societyer-meeting-recordings");
    open.onsuccess = () => {
      const tx = open.result.transaction("recordings", "readwrite");
      const store = tx.objectStore("recordings");
      const all = store.getAll();
      all.onsuccess = () => { for (const row of all.result) store.put({ ...row, updatedAt: Date.now() - 120_000 }); };
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }));
  await page.reload();
  await expect(bar.getByText("A recording wasn't finished. Recover it?")).toBeVisible({ timeout: 60_000 });
  await bar.getByRole("button", { name: "Recover" }).click();
  await expect(bar.getByText(/Recovered · Board prep/)).toBeVisible({ timeout: 15_000 });
  await expect(bar.getByText(/doesn't keep recordings/)).toBeVisible();
  const recovered = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Download" }).click();
  const file = await recovered;
  const size = (await (await import("node:fs/promises")).stat(await file.path())).size;
  expect(size).toBeGreaterThan(1_000);
  await bar.getByRole("button", { name: "Close" }).click();
  await expect(bar).toHaveCount(0);
  // Closed: not offered again.
  await page.reload();
  await expect(page.getByRole("group", { name: "Notes view" })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await expect(bar).toHaveCount(0);
  expect(errors).toEqual([]);
});
