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

/** The notes bar's "Which notes" select: Team notes, My notes, shared notes, AI notes and Action items. */
const whichNotes = (page: Page) => page.getByRole("button", { name: "Which notes" });
async function showNotes(page: Page, name: string | RegExp) {
  await whichNotes(page).click();
  await page.getByRole("option", { name }).click();
}
const transcriptTab = (page: Page) => page.getByRole("tab", { name: /Transcript/ });

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

for (const surface of [
  { name: "desktop", viewport: { width: 1440, height: 900 }, phone: false },
  { name: "compact desktop", viewport: { width: 1024, height: 768 }, phone: false },
  { name: "phone", viewport: { width: 390, height: 844 }, phone: true },
]) {
  test.describe(`meeting task links on ${surface.name}`, () => {
    test.use({ viewport: surface.viewport, isMobile: surface.phone, hasTouch: surface.phone });

    test("restores the same task through Back and Forward from notes and minutes", async ({ page }) => {
      const { societyId } = await seed(page);
      const meetings = await page.evaluate(async (id) => {
        const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
        const scheduledAt = "2026-11-12T17:00:00.000Z";
        const draftMeeting = { societyId: id, scheduledAt, electronic: true, status: "Held", attendeeIds: [] };
        const notesId = await client.mutation("meetings:create", {
          ...draftMeeting, type: "Working", title: "Funder call", recordKind: "notes",
        });
        await client.mutation("meetings:saveNotesDraft", {
          id: notesId, template: "external_call", generatedBy: "Test", usedNotes: true, usedTranscript: true,
          draft: { summary: "Follow-up agreed.", actionItems: [{ text: "Send the funder the report", atSec: 30 }] },
        });

        const formalId = await client.mutation("meetings:create", {
          ...draftMeeting, type: "Board", title: "Board review", recordKind: "minutes",
        });
        const minutes = await client.query("minutes:getByMeeting", { meetingId: formalId });
        const formalActions = [{ text: "Circulate the approved budget", done: false, status: "open", transcriptRef: { startSec: 30, endSec: 45 } }];
        if (minutes) {
          await client.mutation("minutes:update", {
            id: minutes._id, patch: { discussion: "Budget follow-up agreed.", actionItems: formalActions },
          });
        } else {
          await client.mutation("minutes:create", {
            societyId: id, meetingId: formalId, heldAt: scheduledAt, attendees: [], absent: [], quorumMet: false,
            discussion: "Budget follow-up agreed.", decisions: [], motions: [], actionItems: formalActions,
          });
        }
        for (const meetingId of [notesId, formalId]) {
          await client.mutation("transcripts:importTimed", {
            societyId: id, meetingId, provider: "vtt", durationSeconds: 60,
            segments: [{ speaker: "Sam Rivera", text: "We agreed on the follow-up.", startSec: 30, endSec: 45 }],
          });
        }
        return [
          { id: notesId, title: "Funder call", action: "Send the funder the report", tab: "notes" },
          { id: formalId, title: "Board review", action: "Circulate the approved budget", tab: "minutes" },
        ];
      }, societyId);

      for (const meeting of meetings) {
        await test.step(meeting.tab, async () => {
          const notes = meeting.tab === "notes";
          await page.goto(`/app/meetings/${meeting.id}?tab=${meeting.tab}`);
          if (notes) {
            await showNotes(page, /Action items/);
          }
          const action = notes
            ? page.getByRole("region", { name: "Action items" }).getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: `Mark done: ${meeting.action}` }) })
            : page.getByTestId("action-item").filter({ hasText: meeting.action });
          if (notes) await expect(action.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
          await action.getByRole("button", { name: "Create task" }).click();
          const taskLink = action.getByTitle(`Task: ${meeting.action}`);
          await expect(taskLink).toHaveAttribute("href", /^\/app\/tasks\?task=.+/);
          const taskId = new URL((await taskLink.getAttribute("href"))!, page.url()).searchParams.get("task");
          await taskLink.click();

          const panel = page.getByRole("dialog", { name: "Edit task" });
          const title = panel.getByRole("textbox", { name: "Title", exact: true });
          await expect(title).toHaveValue(meeting.action, { timeout: 30_000 });
          if (notes) {
            await page.reload();
            await expect(title).toHaveValue(meeting.action, { timeout: 30_000 });
          }
          const source = panel.getByRole("region", { name: "Source of this task" });
          await expect(source.getByRole("link", { name: "Recording at 0:30" })).toBeVisible();
          await expect(source.getByRole("link", { name: meeting.title })).toBeInViewport();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(surface.viewport.width);

          await source.getByRole("link", { name: meeting.title }).click();
          await expect(page).toHaveURL((url) => url.searchParams.get("tab") === meeting.tab && url.searchParams.get("actionTask") === taskId);
          await expect(action).toBeFocused();
          await expect(action).toBeInViewport();

          await page.goBack();
          await expect(title).toHaveValue(meeting.action, { timeout: 30_000 });
          await page.goForward();
          await expect(action).toBeFocused();
          await page.goBack();
          await source.getByRole("link", { name: "Recording at 0:30" }).click({ timeout: 30_000 });
          await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "transcript" && url.searchParams.get("t") === "30-45");
          await expect(page.getByText("We agreed on the follow-up.", { exact: true })).toBeVisible();
          await page.goBack();
          await expect(title).toHaveValue(meeting.action, { timeout: 30_000 });
          await panel.getByRole("button", { name: "Close drawer", exact: true }).click();
          await expect(panel).toBeHidden();
          await expect(page).toHaveURL((url) => !url.searchParams.has("task"));
        });
      }
    });
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
  await expect(whichNotes(page)).toContainText("Team notes");
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible();
  // AI agents are off in this workspace, so there is no Ask bar.
  await expect(page.getByLabel("Ask about this meeting")).toHaveCount(0);

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

  await showNotes(page, /AI notes/);
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
  await first.getByRole("button", { name: "Details" }).click();
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

  // "Add to team notes" appends the draft under the team notes.
  await aiNotes.getByRole("button", { name: "Add to team notes" }).click();
  await showNotes(page, /Team notes/);
  await expect(notesEditor).toContainText("Foundation wants a pilot report");
  await expect(notesEditor.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(notesEditor).toContainText("Example Foundation is open to a pilot");

  // A working meeting keeps no quorum and stays out of the minute book.
  await page.goto("/app/meetings");
  await expect(page.getByRole("button", { name: "Funder call — Example Foundation", exact: true })).toBeVisible({ timeout: 30_000 });
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
  // On a phone the action items are their own entry in the notes select.
  await expect(whichNotes(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Action items" })).toHaveCount(0);
  await showNotes(page, /Action items/);
  await expect(page.getByRole("heading", { name: "Action items" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.getByRole("region", { name: "Action items" }).screenshot({ path: `${SHOTS}/notes-phone.png` });
});

test("AI notes suggestions: name diarized speakers, see the people the AI knows", async ({ page }) => {
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
      electronic: true, status: "Held", attendeeIds: ["Sam Rivera"], recordKind: "notes", workingNotes: "- Sam to send the budget",
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
  await expect(actions.getByRole("listitem").first().getByRole("button", { name: "Owner: Sam Rivera" })).toBeVisible();

  const speakers = aiNotes.getByRole("region", { name: "Who's speaking" });
  await expect(speakers.getByText("“Sam Rivera here”")).toBeVisible();
  await speakers.getByRole("button", { name: "Name speaker" }).click();
  await expect(speakers.getByText("Named")).toBeVisible();

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

  // Without the AI agents module there is no Ask bar; turning the module on brings it.
  await expect(page.getByLabel("Ask about this meeting")).toHaveCount(0);
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
  // The recording opens in the Transcript tab, ready to play or transcribe on this device.
  await expect(transcriptTab(page)).toHaveAttribute("aria-selected", "true");
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
  await expect(whichNotes(page)).toBeVisible();
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
  await expect(whichNotes(page)).toContainText("AI notes", { timeout: 60_000 });
  await expect(page.getByText("They'll fund a pilot.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-ai-notes.png` });
  await showNotes(page, /Team notes/);
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
  await expect(whichNotes(page)).toBeVisible();
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
  if (SHOTS) await keyQuotes.screenshot({ path: `${SHOTS}/key-quotes.png` });
  // A quote's time opens the Transcript tab at that moment.
  await keyQuotes.getByRole("link", { name: "Open the transcript at 0:12" }).click();
  await expect(page).toHaveURL(/tab=transcript/);
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
  await expect(page.getByText("Quoted in the team notes.")).toBeVisible();
  await page.getByRole("tab", { name: /Notes/ }).first().click();
  await showNotes(page, /Team notes/);
  const editor = page.locator(".meeting-notes-doc [contenteditable=\"true\"]");
  await expect(editor.locator("blockquote")).toContainText("“Small pilots are where we learn the most.”");
  await expect(editor.locator("blockquote")).toContainText("— SPEAKER_01, 0:12");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  const saved = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return ((await client.query("meetings:get", { id })) as any)?.workingNotes as string;
  }, meetingId);
  // The editor saves standard Markdown escapes (SPEAKER\_01, \& in the link); the link still opens that moment.
  expect(saved).toMatch(/> “Small pilots are where we learn the most\.”\n>\n> — SPEAKER\\?_01, \[0:12\]\(\/app\/meetings\/[^)]*tab=transcript\\?&t=12-18\)/);
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
  // An older link to the Transcript view inside Notes opens the Transcript tab.
  await page.goto(`/app/meetings/${meetingId}?tab=notes&view=transcript`);
  await expect(transcriptTab(page)).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  await expect(page).toHaveURL(/tab=transcript/);
  const bar = page.getByRole("region", { name: "Meeting recording" });

  // Record with the Transcript tab already open, and stop from the tab's own button.
  await page.getByRole("button", { name: /^Record/ }).click();
  await page.getByRole("menuitem", { name: /^Microphone/ }).first().click();
  await expect(bar.getByText("Recording", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: /^Stop · / }).click();
  await expect(bar.getByText(/doesn't keep recordings/)).toBeVisible({ timeout: 15_000 });
  await expect(bar.getByRole("button", { name: "Download" })).toBeVisible();
  // Recording moved you to the notes; the Transcript tab, opened before and kept mounted, picks the recording up.
  await transcriptTab(page).click();
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
  await expect(transcriptTab(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await expect(bar).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("use your own AI: import a VTT, copy the prompt, paste the JSON back, save the AI notes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    return client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Funder call", scheduledAt: "2026-11-16T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: ["Sam Rivera"], recordKind: "notes",
    });
  });
  // A Teams-style VTT export, imported in the Transcript view.
  await page.goto(`/app/meetings/${meetingId}?tab=transcript`);
  const vtt = [
    "WEBVTT", "",
    "a/1-0", "00:00:01.000 --> 00:00:05.000", "<v Sam Rivera>Thanks for joining. We'd like to fund a pilot in the spring.</v>", "",
    "a/2-0", "00:00:06.000 --> 00:00:10.000", "<v Priya Raman>Great. I'll send the budget by Friday.</v>", "",
  ].join("\n");
  await page.locator(".transcript-workspace input[type=file]").last().setInputFiles({ name: "Funder call.vtt", mimeType: "text/vtt", buffer: Buffer.from(vtt) });
  await expect(page.locator("[data-segment]", { hasText: "Great. I'll send the budget by Friday." })).toBeVisible({ timeout: 60_000 });
  // Speakers named in the file are matched to People: one click links them.
  await page.getByRole("button", { name: "Apply all suggestions" }).click();
  await expect.poll(async () => page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const transcript = await client.query("transcripts:getByMeeting", { meetingId: id }) as any;
    return transcript.speakers.filter((speaker: any) => speaker.personId).map((speaker: any) => speaker.name);
  }, meetingId), { timeout: 15_000 }).toEqual(["Sam Rivera"]);
  await page.getByRole("button", { name: "Done", exact: true }).last().click();

  // AI notes: built-in AI is off here, so draft with your own.
  await page.getByRole("tab", { name: /Notes/ }).first().click();
  await showNotes(page, /AI notes/);
  await page.getByRole("button", { name: "Use your own AI" }).click();
  const dialog = page.getByRole("dialog", { name: "Draft with your own AI" });
  await expect(dialog.getByText(/k characters/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/own-ai-copy.png`, fullPage: false });
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("Return ONLY one JSON object");
  expect(prompt).toContain("Great. I'll send the budget by Friday.");
  const sam = prompt.match(/(\S+) \| Sam Rivera \|/)?.[1];
  expect(sam, "Sam Rivera is in the People list with an id").toBeTruthy();

  // What the other AI returned, pasted back (wrapped in a code fence, as chats often do).
  const reply = { calls: [
    { tool: "write_summary", arguments: { summary: "The funder will back a spring pilot; a budget follows.", sections: [{ heading: "Pilot", points: ["Spring start"] }] } },
    { tool: "add_decision", arguments: { text: "Go ahead with the spring pilot" } },
    { tool: "add_action_item", arguments: { text: "Thank the funder", owner_person_id: sam } },
    { tool: "add_action_item", arguments: { text: "Send the budget", owner_name: "Priya Raman", due_date: "2026-11-20", at_seconds: 6 } },
    { tool: "add_quote", arguments: { text: "We'd like to fund a pilot in the spring." } },
    { tool: "add_quote", arguments: { text: "We will triple the grant." } },
    { tool: "finish", arguments: {} },
  ] };
  await dialog.getByRole("textbox", { name: "The JSON your AI returned" }).fill("```json\n" + JSON.stringify(reply, null, 2) + "\n```");
  // Checked as it's pasted.
  await expect(dialog.locator(".manual-draft__result")).toContainText("2 action items (1 assigned)");
  await expect(dialog.getByText("1 left out")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/own-ai-dialog.png`, fullPage: false });
  await dialog.getByRole("button", { name: "Save as AI notes" }).click();
  await expect(dialog).toHaveCount(0);

  const aiNotes = page.getByRole("region", { name: "AI notes" });
  await expect(aiNotes.getByText("The funder will back a spring pilot; a budget follows.")).toBeVisible();
  await expect(aiNotes.getByText(/by Your own AI \(pasted\)/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Key quotes" }).getByText("“We'd like to fund a pilot in the spring.”")).toBeVisible();
  const actions = page.getByRole("region", { name: "Action items" });
  await expect(actions.locator("[aria-label='Action item']").first()).toHaveValue("Thank the funder");
  await expect(actions.getByRole("button", { name: "Owner: Sam Rivera" }).first()).toBeVisible();

  // The next meeting's import remembers who "Sam Rivera" is; it can still be changed.
  const nextId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    return client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Funder follow-up", scheduledAt: "2026-11-23T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes",
    });
  });
  await page.goto(`/app/meetings/${nextId}?tab=transcript`);
  await page.locator(".transcript-workspace input[type=file]").last().setInputFiles({ name: "Follow-up.vtt", mimeType: "text/vtt", buffer: Buffer.from(vtt) });
  await expect(page.getByText(/1 speaker assigned as last time/)).toBeVisible({ timeout: 60_000 });
  const linked = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const transcript = await client.query("transcripts:getByMeeting", { meetingId: id }) as any;
    return transcript.speakers.map((speaker: any) => [speaker.label, speaker.name, Boolean(speaker.personId)]);
  }, nextId);
  expect(linked).toEqual([["Sam Rivera", "Sam Rivera", true]]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/remembered-speakers.png`, fullPage: false });
  // The player is one row, and speed and shortcuts stay inside it (measured together, once laid out).
  await page.getByRole("button", { name: "Done", exact: true }).last().click();
  for (const width of [1440, 1180, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => {
      const row = document.querySelector(".transcript-player__controls")!.getBoundingClientRect();
      return ["[aria-label='Play']", "[aria-label='Playback speed']", "[aria-label='Keyboard shortcuts']"].every((selector) => {
        const box = document.querySelector(`.transcript-player__controls ${selector}`)!.getBoundingClientRect();
        return box.right <= row.right + 1 && box.left >= row.left - 1 && Math.abs((box.top + box.bottom) / 2 - (row.top + row.bottom) / 2) < 8;
      });
    }), { message: `play, speed and shortcuts on the player's one row at ${width}px` }).toBe(true);
    if (SHOTS) await page.locator(".transcript-player__controls").screenshot({ path: `${SHOTS}/player-row-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test("team notes and my own notes: add, keep private, share, delete", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    return client.mutation("meetings:create", {
      societyId: getStoredSocietyId(), type: "Working", title: "Planning", scheduledAt: "2026-11-16T17:00:00.000Z",
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes", workingNotes: "- Shared agenda",
    });
  });
  await page.goto(`/app/meetings/${meetingId}?tab=notes&view=notes`);
  const team = page.getByRole("region", { name: "Team notes" });
  await expect(team).toBeVisible({ timeout: 60_000 });
  // No notes of your own yet: Team notes and AI notes to pick from, and a "My notes" button.
  await expect(whichNotes(page)).toContainText("Team notes");
  await whichNotes(page).click();
  await expect(page.getByRole("option", { name: /My notes/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "My notes", exact: true }).click();

  const mine = page.getByRole("region", { name: "My notes" });
  await expect(mine.getByText("Only you", { exact: true })).toBeVisible();
  const editor = mine.locator("[contenteditable=\"true\"]");
  await editor.click();
  await page.keyboard.type("Ask about the venue budget");
  const readMine = () => page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return client.query("meetingPersonalNotes:mine", { meetingId: id });
  }, meetingId) as Promise<any>;
  await expect.poll(async () => (await readMine())?.body ?? "", { timeout: 15_000 }).toContain("Ask about the venue budget");
  expect((await readMine()).shared).toBe(false);

  // Share them; the select now offers My notes too.
  await mine.getByText("Only you", { exact: true }).click();
  await expect(mine.getByText("Shared with the team", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Which notes" }).click();
  await page.getByRole("option", { name: /Team notes/ }).click();
  await expect(team.getByText("Shared agenda")).toBeVisible();
  const shared = await page.evaluate(async (id) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    return client.query("meetingPersonalNotes:shared", { meetingId: id });
  }, meetingId) as any[];
  expect(shared.map((row) => [row.body.includes("venue budget"), row.mine])).toEqual([[true, true]]);
  if (SHOTS) await team.screenshot({ path: `${SHOTS}/team-notes.png` });

  // Delete them: back to just the team notes.
  await page.getByRole("button", { name: "Which notes" }).click();
  await page.getByRole("option", { name: /My notes/ }).click();
  if (SHOTS) await mine.screenshot({ path: `${SHOTS}/my-notes.png` });
  await mine.getByRole("button", { name: "Delete my notes" }).click();
  await page.getByRole("dialog", { name: "Delete your notes?" }).getByRole("button", { name: "Delete" }).click();
  await expect(whichNotes(page)).toContainText("Team notes");
  await expect(page.getByRole("button", { name: "My notes", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("notes editor: @mentions link to the directory, typed addresses link, find and replace", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Editor check-in");
  await dialog.locator("button.btn--accent").click();
  await expect(page.getByRole("heading", { name: /Editor check-in/ })).toBeVisible({ timeout: 60_000 });

  const editor = page.locator(".meeting-notes-doc [contenteditable=\"true\"]");
  await editor.click();
  // "@Sa" offers Sam Rivera from the People directory; Enter links the name to their profile.
  await page.keyboard.type("Budget goes to @Sa");
  const list = page.getByRole("listbox", { name: "People" });
  await expect(list.getByRole("option", { name: "Sam Rivera" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("today. Details at example.org/budget then the budget.");
  const mention = editor.getByRole("link", { name: "@Sam Rivera" });
  await expect(mention).toHaveAttribute("href", /^\/app\/people-directory\//);
  await expect(list).toHaveCount(0);
  // A typed address becomes a link once a space follows it.
  await expect(editor.getByRole("link", { name: "example.org/budget" })).toHaveAttribute("href", "https://example.org/budget");

  // Ctrl/Cmd+F: find counts matches and replace all swaps them.
  await page.keyboard.press("ControlOrMeta+f");
  const find = page.getByRole("search", { name: "Find in text" });
  await find.getByLabel("Find", { exact: true }).fill("budget");
  await expect(find.getByText(/of 3$/)).toBeVisible();
  await find.getByLabel("Replace with").fill("plan");
  await find.getByRole("button", { name: "Replace all" }).click();
  await expect(find.getByText("No results")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(editor).toContainText("plan goes to @Sam Rivera today.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
