import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { hasPermission, type Permission } from "../shared/functions/permissions";
import { interfaceRouteReadPermission } from "../shared/interfaceRouteAccess";
import { assertLiveFits, liveFixture, signInLive } from "./helpers/liveInterface";

type Surface = { path: string; actions: { name: RegExp; permission: Permission; optional?: boolean; blockedByText?: RegExp }[]; rows?: { name: RegExp; permission: Permission }[] };
const surfaces: Surface[] = [
  { path: "/app/committees/static_committee_finance", actions: [{ name: /^Delete$/, permission: "committees:write" }] },
  { path: "/app/elections/static_election", actions: [{ name: /^Save election settings$/, permission: "elections:write" }], rows: [{ name: /^(?:Close election|Publish results|Add to ballot|Approve nomination|Reject nomination)$/, permission: "elections:write" }] },
  { path: "/app/bylaws-history", actions: [{ name: /^New amendment$/, permission: "documents:write" }] },
  { path: "/app/ai-agents", actions: [], rows: [{ name: /^(?:Send chat message|Run this agent|Save skill)$/, permission: "tasks:write" }, { name: /^Save AI provider$/, permission: "settings:write" }] },
  { path: "/app/meeting-templates", actions: [{ name: /^New template$/, permission: "meetings:write" }], rows: [{ name: /^(?:Schedule meeting|Edit |Duplicate |Delete )/, permission: "meetings:write" }] },
  { path: "/app/agendas", actions: [{ name: /^Create$/, permission: "agendas:write" }] },
  { path: "/app/bylaw-rules", actions: [{ name: /^Save new version$/, permission: "documents:write" }] },
  { path: "/app/bylaw-diff", actions: [], rows: [{ name: /^(?:Start consultation|Record resolution|Mark filed|Save as sections)$/, permission: "documents:write" }] },
  { path: "/app/conflicts", actions: [{ name: /^New disclosure$/, permission: "conflicts:write" }], rows: [{ name: /^Resolve$/, permission: "conflicts:write" }] },
  { path: "/app/employees", actions: [{ name: /^New employee$/, permission: "employees:write" }], rows: [{ name: /^Delete employee /, permission: "employees:write" }] },
  { path: "/app/motion-backlog", actions: [{ name: /^New backlog motion$/, permission: "motions:write" }] },
  { path: "/app/deadlines", actions: [{ name: /^New deadline$/, permission: "deadlines:write" }], rows: [{ name: /^(?:Delete deadline |Mark deadline |Reopen deadline )/, permission: "deadlines:write" }] },
  { path: "/app/commitments", actions: [{ name: /^New commitment$/, permission: "commitments:write" }] },
  { path: "/app/filings", actions: [{ name: /^New filing$/, permission: "filings:write" }], rows: [{ name: /^(?:Import registry|Delete this filing|Mark filed)/, permission: "filings:write" }] },
  { path: "/app/annual-filings", actions: [{ name: /^Add filing$/, permission: "filings:write" }], rows: [{ name: /^Delete .* filing$/, permission: "filings:write" }] },
  { path: "/app/attestations", actions: [], rows: [{ name: /^(?:Sign|Re-sign)$/, permission: "attestations:write" }] },
  { path: "/app/pipa-training", actions: [{ name: /^Log training$/, permission: "attestations:write" }], rows: [{ name: /^Delete training record/, permission: "attestations:write" }] },
  { path: "/app/retention", actions: [], rows: [{ name: /^(?:Keep record|Flag for purge review|Archive )/, permission: "documents:write" }] },
  { path: "/app/privacy", actions: [{ name: /^(?:Create|Edit) policy draft$/, permission: "documents:write" }, { name: /^Save record$/, permission: "society:write" }, { name: /^Add setup motions$/, permission: "motions:write" }] },
  { path: "/app/corporate-history", actions: [{ name: /^Add name$/, permission: "settings:write" }, { name: /^Add event$/, permission: "documents:write" }] },
  { path: "/app/auditors", actions: [{ name: /^New appointment$/, permission: "auditors:write" }], rows: [{ name: /^Create portal$/, permission: "communications:write" }] },
  { path: "/app/proposals", actions: [{ name: /^New proposal$/, permission: "motions:write" }], rows: [{ name: /^(?:Include|Reject|Delete proposal )/, permission: "motions:write" }] },
  { path: "/app/written-resolutions", actions: [{ name: /^New resolution$/, permission: "motions:write" }], rows: [{ name: /^(?:Mark failed|Delete written resolution )/, permission: "motions:write" }] },
  { path: "/app/minute-book", actions: [{ name: /^New record$/, permission: "minutes:write" }] },
  { path: "/app/integrations", actions: [], rows: [{ name: /^Save setup checklist$/, permission: "settings:write" }, { name: /^Create board pack$/, permission: "tasks:write" }] },
  { path: "/app/policies", actions: [{ name: /^New policy$/, permission: "documents:write" }] },
  { path: "/app/proxies", actions: [{ name: /^New proxy$/, permission: "proxies:write", blockedByText: /disables proxy voting|proxies disabled/ }], rows: [{ name: /^Delete proxy/, permission: "proxies:write" }] },
  { path: "/app/court-orders", actions: [{ name: /^Record order$/, permission: "courtOrders:write" }], rows: [{ name: /^Delete court order/, permission: "courtOrders:write" }] },
  { path: "/app/inspections", actions: [{ name: /^Log inspection$/, permission: "documents:write" }], rows: [{ name: /^Delete inspection/, permission: "documents:write" }] },
  { path: "/app/membership", actions: [{ name: /^New plan$/, permission: "settings:write" }, { name: /^Add period$/, permission: "settings:write" }], rows: [{ name: /^Delete (?:membership plan|fee period)/, permission: "settings:write" }] },
  { path: "/app/committees", actions: [{ name: /^New committee$/, permission: "committees:write" }] },
  { path: "/app/service-providers", actions: [{ name: /^New provider$/, permission: "settings:write" }] },
  { path: "/app/significant-individuals", actions: [{ name: /^Record step$/, permission: "deadlines:write" }] },
  { path: "/app/access-custody", actions: [{ name: /^New access record$/, permission: "settings:write" }] },
  { path: "/app/post-incorporation", actions: [], rows: [{ name: /^(?:Generate packet|Regenerate)$/, permission: "documents:write" }] },
  { path: "/app/org-history", actions: [{ name: /^Add source$/, permission: "society:write" }, { name: /^Add fact$/, permission: "society:write" }] },
];

async function deniedControl(control: Locator) {
  // Hidden write controls are allowed; visible links must also stop navigation.
  if (!(await control.count())) return;
  for (const item of await control.all()) {
    if (!(await item.isVisible())) continue;
    const tag = await item.evaluate((node) => node.tagName.toLowerCase());
    if (tag === "button") await expect(item).toBeDisabled();
    else {
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).not.toHaveAttribute("href", /\S/);
    }
  }
}

for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
  for (let offset = 0; offset < surfaces.length; offset += 6) {
    const group = surfaces.slice(offset, offset + 6);
    test(`${role} native write gates ${offset + 1}-${offset + group.length}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
      await signInLive(page, role);
      const checks = [];
      for (const surface of group) {
        const path = surface.path.replace(/static_[^/]+/g, (alias) => {
          const id = liveFixture().ids[alias];
          if (!id) throw new Error(`Missing native write-gate fixture: ${alias}`);
          return id;
        });
        await page.goto(path, { waitUntil: "domcontentloaded" });
        const readPermission = interfaceRouteReadPermission(surface.path)!;
        if (!hasPermission(role, readPermission)) {
          await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
          checks.push({ path: surface.path, state: "route denied" });
          await assertLiveFits(page);
          continue;
        }
        await expect(page.locator(".page").first()).toBeVisible();
        await expect(page.locator(".page h1").first()).toBeVisible();
        await expect(page.locator(".record-table__loading")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: /^Something went wrong\.?$/ })).toHaveCount(0);
        for (const action of surface.actions) {
          const control = page.getByRole("button", { name: action.name }).or(page.getByRole("link", { name: action.name }));
          // The bylaw query hydrates separately from the table. This fixture's
          // actual bylaws prohibit new proxies even for authorized writers.
          if (action.blockedByText) await expect(page.getByText(action.blockedByText).first()).toBeAttached();
          const businessBlocked = action.blockedByText ? await page.getByText(action.blockedByText).count() > 0 : false;
          if (hasPermission(role, action.permission) && !businessBlocked) {
            if (!action.optional) {
              await expect(control.first()).toBeVisible();
              await expect(control.first()).toBeEnabled();
            }
          } else await deniedControl(control);
          checks.push({ path: surface.path, action: String(action.name), permission: action.permission, allowed: hasPermission(role, action.permission), businessBlocked, matched: await control.count() });
        }
        for (const row of surface.rows ?? []) {
          const controls = page.getByRole("button", { name: row.name });
          if (!hasPermission(role, row.permission)) await deniedControl(controls);
          checks.push({ path: surface.path, rows: String(row.name), permission: row.permission, allowed: hasPermission(role, row.permission), matched: await controls.count() });
        }
        await assertLiveFits(page);
      }
      await testInfo.attach("native-write-gates", { body: JSON.stringify(checks), contentType: "application/json" });
      expect(errors).toEqual([]);
    });
  }
}

test("Viewer native template editor cannot mutate a direct detail URL", async ({ page }) => {
  await signInLive(page, "Viewer");
  await page.goto(`/app/meeting-templates/${liveFixture().ids.static_meeting_template_board}`);
  await expect(page.getByRole("button", { name: "Save template", exact: true })).toBeDisabled();
  await assertLiveFits(page);
});

for (const role of ["Owner", "Admin", "Director", "Viewer"]) {
  test(`${role} native committee detail separates roster and task write gates`, async ({ page }) => {
    await signInLive(page, role);
    await page.goto(`/app/committees/${liveFixture().ids.static_committee_finance}`);
    const layout = page.getByRole("button", { name: "Layout", exact: true });
    if (hasPermission(role, "settings:write")) await expect(layout).toBeEnabled();
    else await expect(layout).toBeDisabled();
    await page.locator(".tabs").getByRole("button", { name: /^Members(?:\s|$)/ }).click();
    const addMember = page.getByRole("button", { name: "Add member", exact: true });
    if (hasPermission(role, "committees:write")) await expect(addMember).toBeEnabled();
    else await expect(addMember).toBeDisabled();
    await assertLiveFits(page);
    await page.locator(".tabs").getByRole("button", { name: /^Tasks(?:\s|$)/ }).click();
    const addTask = page.getByRole("button", { name: "Add task", exact: true });
    if (hasPermission(role, "tasks:write")) await expect(addTask).toBeEnabled();
    else await expect(addTask).toBeDisabled();
    await assertLiveFits(page);
  });
}

for (const role of ["Member", "Director", "Viewer"]) {
  test(`${role} native AI chat remains read-only with a filled request`, async ({ page }) => {
    await signInLive(page, role);
    await page.goto("/app/ai-agents");
    const message = page.getByLabel("Message", { exact: true });
    await expect(message).toBeVisible();
    if (await message.isEnabled()) await message.fill("An isolated qualification request which must never be sent to a provider.");
    await expect(page.getByRole("button", { name: "Send chat message", exact: true })).toBeDisabled();
    await assertLiveFits(page);
  });
}
