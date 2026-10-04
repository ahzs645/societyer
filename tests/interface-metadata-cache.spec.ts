import { expect, test } from "@playwright/test";

test("previous actor's persisted personal metadata never paints while the new actor awaits authorization", async ({ page }) => {
  await page.goto("/demo/app/users", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-shell")).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType("resource").map(entry => entry.name).find(url => new URL(url).pathname === "/src/lib/localDataClient.ts");
    if (!moduleUrl) throw new Error("Current app client module was not loaded.");
    const { localDataClient } = await import(moduleUrl);
    const societyId = "static_society_riverside";
    await localDataClient.mutation("seedRecordTableMetadata:ensureForSociety", { societyId });
    const object = await localDataClient.query("objectMetadata:getByNameSingular", { societyId, nameSingular: "member" });
    const viewId = await localDataClient.mutation("views:create", { societyId, objectMetadataId: object._id, name: "Actor A PRIVATE metadata marker", visibility: "personal", searchTerm: "Actor A PRIVATE filter" });
    const setup = await localDataClient.query("objectMetadata:getFullTableSetup", { societyId, nameSingular: "member", viewId });
    const actorB = await localDataClient.mutation("users:upsert", { societyId, displayName: "Metadata actor B", email: "actor-b@metadata.example", role: "Viewer", status: "Active" });
    localStorage.setItem(`societyer.record-table.v1.${societyId}.member`, JSON.stringify({ version: 1, cachedAt: Date.now(), setup }));
    const originalWatch = localDataClient.watchQuery.bind(localDataClient);
    const pendingCallbacks = new Set<() => void>();
    localDataClient.watchQuery = (reference: any, args: any) => {
      const name = typeof reference === "string" ? reference : reference?.[Symbol.for("functionName")];
      if (name === "objectMetadata:getFullTableSetup" && args?.nameSingular === "member" && (window as any).__metadataCacheAudit.blockMetadata) return {
        onUpdate(callback: () => void) { pendingCallbacks.add(callback); return () => pendingCallbacks.delete(callback); },
        localQueryResult: () => undefined,
        journal: () => undefined,
      };
      return originalWatch(reference, args);
    };
    (window as any).__metadataCacheAudit = { seen: [], actorB, pendingCallbacks, setup, blockMetadata: false };
    return { actorB };
  });
  await page.evaluate(() => {
    history.pushState(null, "", "/demo/app/members");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.locator(".record-table__view-button").click();
  await page.getByRole("button", { name: "Actor A PRIVATE metadata marker", exact: true }).click();
  await expect(page.locator(".record-table__view-button")).toContainText("Actor A PRIVATE metadata marker");
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType("resource").map(entry => entry.name).find(url => new URL(url).pathname === "/src/hooks/useCurrentUser.ts");
    if (!moduleUrl) throw new Error("Current actor module was not loaded.");
    const { setStoredUserId } = await import(moduleUrl);
    const audit = (window as any).__metadataCacheAudit;
    audit.blockMetadata = true;
    localStorage.setItem("societyer.record-table.v1.static_society_riverside.member", JSON.stringify({ version: 1, cachedAt: Date.now(), setup: audit.setup }));
    const observer = new MutationObserver(() => {
      const text = document.body.textContent ?? "";
      if (text.includes("Actor A PRIVATE metadata marker") || text.includes("Actor A PRIVATE filter")) audit.seen.push(text);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setStoredUserId(audit.actorB);
  });
  await expect(page.locator(".workbench__content")).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => (window as any).__metadataCacheAudit.pendingCallbacks.size)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__metadataCacheAudit.seen)).toEqual([]);
  expect(await page.evaluate(() => [...Array(localStorage.length)].map((_, index) => localStorage.key(index)).filter(key => key?.startsWith("societyer.record-table.v")))).toEqual([]);
  expect(await page.evaluate(() => (window as any).__metadataCacheAudit.actorB)).toBe(fixture.actorB);
  await expect(page.getByText("Actor A PRIVATE metadata marker", { exact: true })).toHaveCount(0);
});
