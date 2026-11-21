import { expect, test, type Page } from "@playwright/test";

// Meeting recordings kept on this computer (the desktop app's path), run in a
// browser with local-filesystem document storage and a stand-in desktop
// bridge that keeps files in memory. Covers the Recordings card, playing a
// kept recording in the Transcript tab, and the Settings choice. Synthetic data only.

const SHOTS = process.env.MEETING_RECORDINGS_SCREENSHOTS;

async function installBridge(page: Page) {
  await page.addInitScript(() => {
    const files = new Map<string, ArrayBuffer>();
    const known: Record<string, (input: any) => Promise<unknown>> = {
      async writeDocumentVersion(input) {
        const key = `${input.societyId}/documents/${input.documentId}/${files.size}-${input.fileName}`;
        files.set(key, input.bytes);
        return { provider: "local-filesystem", key, fileName: input.fileName, mimeType: input.mimeType, byteLength: input.bytes.byteLength };
      },
      async readDocumentVersion(input) {
        const bytes = files.get(input.key);
        if (!bytes) throw new Error("missing file");
        return bytes;
      },
      async openDocumentVersion() {
        (window as any).__opened = ((window as any).__opened ?? 0) + 1;
      },
    };
    // Anything else the app asks the desktop shell for answers "nothing".
    (window as any).societyerDesktop = new Proxy(known, {
      // Subscriptions (onThemeChanged, …) return their cleanup synchronously.
      get: (target, name: string) => target[name] ?? (/^(on[A-Z]|subscribe)/.test(name) ? () => () => undefined : async () => undefined),
    });
  });
}

/** A short valid WAV (silence) so the media element can load it. */
function silentWav(seconds = 1, rate = 8000) {
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  return Buffer.from(buffer);
}

test("keep a recording on this computer, play it in the Transcript tab, switch to transcripts only", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installBridge(page);
  await page.goto("/app", { waitUntil: "networkidle" });
  const meetingId = await page.evaluate(async () => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { societyId } = await client.mutation("society:createWorkspace", { name: "Recordings review", jurisdictionCode: "CA-BC", entityType: "society" });
    setStoredSocietyId(societyId);
    return client.mutation("meetings:create", {
      societyId, type: "Working", title: "Staff check-in", scheduledAt: new Date().toISOString(),
      electronic: true, status: "Held", attendeeIds: [], recordKind: "notes",
    });
  });

  // A notes meeting opens on Notes; recordings are kept on the Overview.
  await page.goto(`/app/meetings/${meetingId}?tab=overview`);
  const card = page.getByRole("region", { name: "Recordings" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("This computer")).toBeVisible();
  await card.locator('input[type="file"]').setInputFiles({ name: "check-in.wav", mimeType: "audio/wav", buffer: silentWav() });
  await expect(card.getByText("check-in.wav")).toBeVisible();
  await expect(card.getByText(/16 KB/)).toBeVisible();
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/recordings-card.png` });

  await card.getByRole("button", { name: "Open" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__opened ?? 0)).toBe(1);

  // Play in transcript opens Attached recordings (Notes → Transcript on a notes meeting), which reads the file back.
  await card.getByRole("button", { name: "Play in transcript" }).click();
  const attached = page.getByRole("region", { name: "Attached recordings" });
  await expect(attached).toBeVisible();
  await expect(attached.getByText(/Recordings kept for this meeting/)).toBeVisible();
  await attached.getByRole("button", { name: /Download and play check-in\.wav/ }).click();
  await expect(page.getByText("check-in.wav").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Change recording/ })).toBeVisible();

  // Settings: an administrator switches to transcripts only; the card disappears.
  await page.goto("/app/settings?tab=runtime");
  const settings = page.locator(".card", { has: page.getByRole("heading", { name: "Meeting recordings" }) });
  await expect(settings).toBeVisible({ timeout: 60_000 });
  await expect(settings.getByText("This computer", { exact: true })).toBeVisible();
  if (SHOTS) await settings.screenshot({ path: `${SHOTS}/recordings-settings.png` });
  await settings.getByText("Transcripts only", { exact: true }).click();
  await expect(settings.getByText("Transcripts only").first()).toBeVisible();
  await expect(settings.getByText(/never saved/)).toBeVisible();

  await page.goto(`/app/meetings/${meetingId}?tab=overview`);
  await expect(page.getByRole("heading", { name: /Staff check-in/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Recordings" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
