import { expect, test } from "@playwright/test";

test("meeting history persists form edits, preserves source observations and protects adopted versions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/app", { waitUntil: "networkidle" });
  const fixture = await page.evaluate(async () => {
    const clientModule = "/src/lib/localDataClient.ts";
    const selectionModule = "/src/hooks/useSociety.ts";
    const { localDataClient: client } = await import(clientModule);
    const { setStoredSocietyId } = await import(selectionModule);
    const { societyId } = await client.mutation("society:createWorkspace", {
      name: "Meeting history browser review", jurisdictionCode: "CA-BC", entityType: "society",
    });
    setStoredSocietyId(societyId);
    const create = async (date: string, title: string) => {
      const meetingId = await client.mutation("meetings:create", { societyId, type: "Board", title, scheduledAt: `${date}T12:00:00.000Z`, electronic: false, status: "Held", attendeeIds: [] });
      let minutes = await client.query("minutes:getByMeeting", { meetingId });
      if (!minutes) {
        await client.mutation("minutes:create", { societyId, meetingId, heldAt: `${date}T12:00:00.000Z`, attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "Historical source review", decisions: [], actionItems: [], motions: [] });
        minutes = await client.query("minutes:getByMeeting", { meetingId });
      }
      return { meetingId, minutesId: minutes._id };
    };
    const source = await create("2024-01-10", "Prior source meeting");
    const target = await create("2024-02-14", "Current review meeting");
    await client.mutation("minutes:update", { id: source.minutesId, patch: { actionObservations: [{ entryId: "source-observation", actionKey: "committee:action-12", text: "Review monitoring plan", status: "on_hold", statusAsOf: "2024-01-10", sourceActionId: "12", sourceStatus: "On hold", assignee: "Coordinator", sourceExternalIds: ["source:fixture"] }] } });
    return { societyId, source, target };
  });
  await page.goto(`/app/meetings/${fixture.target.meetingId}?tab=minutes`);
  const panel = page.getByRole("region", { name: "Meeting history", exact: true });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByText("Carry an action forward from earlier minutes", { exact: true }).click();
  await panel.getByLabel("Previous minutes", { exact: true }).selectOption(fixture.source.minutesId);
  await panel.getByLabel("Prior action observation", { exact: true }).selectOption("source-observation");
  await panel.getByRole("button", { name: "Carry selected action forward", exact: true }).click();
  await expect(panel.getByLabel("Action", { exact: true })).toHaveValue("Review monitoring plan");
  await expect(panel.getByLabel("Observation status", { exact: true })).toHaveValue("unknown");
  await expect(panel.getByLabel("Status as of", { exact: true })).toHaveValue("");
  await panel.getByLabel("Observation status", { exact: true }).selectOption("in_progress");
  await panel.getByLabel("Status as of", { exact: true }).fill("2024-02-14");
  await panel.getByRole("button", { name: "Save history", exact: true }).click();
  await expect(panel.getByText("History saved.", { exact: true })).toBeVisible();

  const evidence = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Source decisions and meeting evidence' }) });
  await evidence.getByRole('button', { name: 'Edit evidence', exact: true }).click();
  await evidence.getByText('Decision-time quorum checkpoints (0)', { exact: true }).click();
  const checkpoints = evidence.locator('details').filter({ hasText: 'Decision-time quorum checkpoints' });
  await checkpoints.getByRole('button', { name: 'Add row', exact: true }).click();
  await checkpoints.getByLabel('Scope', { exact: true }).selectOption('session');
  await checkpoints.getByLabel('Session or agenda item', { exact: true }).fill('Board session');
  await checkpoints.getByLabel('Source time or agenda boundary', { exact: true }).fill('Board session, 14:35');
  await checkpoints.getByLabel('Source assertion', { exact: true }).selectOption('confirmed');
  await checkpoints.getByLabel('Time as recorded', { exact: true }).fill('14:35');
  await checkpoints.getByLabel('Present eligible count', { exact: true }).fill('0');
  await checkpoints.getByLabel('Source evidence', { exact: true }).fill('Chair recorded quorum; count requires review.');
  await checkpoints.getByLabel('External source IDs', { exact: true }).fill('source:fixture');
  await checkpoints.getByLabel('Page / section citation', { exact: true }).fill('Opening paragraph');
  await checkpoints.getByLabel('Review', { exact: true }).selectOption('pending');
  await evidence.getByRole('button', { name: 'Save evidence', exact: true }).click();

  await panel.getByRole("tab", { name: /^Imported source versions/ }).click();
  await panel.getByRole("button", { name: "Add source version", exact: true }).click();
  await panel.getByLabel("Version label", { exact: false }).fill("Draft from source document");
  await panel.getByLabel("Version status", { exact: true }).selectOption("draft");
  await panel.getByLabel("Source references (one per line)", { exact: false }).fill("source:draft-fixture");
  await panel.getByLabel("Source content text (optional)", { exact: true }).fill("Original wording | retained unchanged");
  await panel.getByRole("button", { name: "Save history", exact: true }).click();
  await expect(panel.getByText("History saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: /^Imported source versions/ }).click();
  await expect(panel.getByLabel("Source content text (optional)", { exact: true })).toHaveValue("Original wording | retained unchanged");
  await panel.getByLabel("Version status", { exact: true }).selectOption("adopted");
  await panel.getByLabel("Adoption date", { exact: false }).fill("2024-02-14");
  await panel.getByLabel("Adoption evidence", { exact: false }).fill("Explicit adoption recorded in signed source.");
  await panel.getByRole("button", { name: "Save history", exact: true }).click();
  await expect(panel.getByLabel("Version label", { exact: false })).toBeDisabled();
  await panel.getByRole("button", { name: "Append revision", exact: true }).click();
  await expect(panel.getByLabel("Version status", { exact: true }).nth(1)).toHaveValue("revised");
  await panel.getByLabel("Source references (one per line)", { exact: false }).nth(1).fill("source:revised-fixture");
  await panel.getByRole("button", { name: "Save history", exact: true }).click();
  await expect(panel.getByText("History saved.", { exact: true })).toBeVisible();

  const stored = await page.evaluate(async ({ source, target }) => {
    const modulePath = "/src/lib/localDataClient.ts";
    const { localDataClient: client } = await import(modulePath);
    return { prior: await client.query("minutes:getByMeeting", { meetingId: source.meetingId }), current: await client.query("minutes:getByMeeting", { meetingId: target.meetingId }) };
  }, fixture);
  expect(stored.prior.actionObservations[0].status).toBe("on_hold");
  expect(stored.current.actionObservations).toHaveLength(1);
  expect(stored.current.actionObservations[0]).toMatchObject({ status: "in_progress", statusAsOf: "2024-02-14", actionKey: "committee:action-12", carriedFromMinutesId: fixture.source.minutesId, carriedFromEntryId: "source-observation" });
  expect(stored.current.quorumStatus).toBe("not_recorded");
  expect(stored.current.quorumCheckpoints[0]).toMatchObject({ assertion: "confirmed", atTime: "14:35", scope: "session", scopeLabel: "Board session", eligibleCount: 0 });
  expect(stored.current.importedSourceVersions).toHaveLength(2);
  expect(stored.current.importedSourceVersions[1].supersedesVersionId).toBe(stored.current.importedSourceVersions[0].versionId);
  expect(errors).toEqual([]);
});
