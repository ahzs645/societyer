import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { InterfaceRoute } from "./interfaceRoutes";

export type LiveInterfaceFixture = {
  societyId: string;
  identities: Record<string, { email: string; password: string }>;
  ids: Record<string, string>;
  routePaths?: Record<string, string>;
  publicIntake: { slug: string; societyId: string; publicGrantId: string };
  partyPortal: { societyId: string; portalId: string; token: string; societyName: string; label: string };
};

export function liveFixture(): LiveInterfaceFixture {
  return JSON.parse(readFileSync(process.env.LIVE_INTERFACE_FIXTURE ?? "tmp/live-interface-fixture.json", "utf8"));
}

export function livePath(route: InterfaceRoute): string {
  const fixture = liveFixture();
  if (fixture.routePaths?.[route.pattern]) return fixture.routePaths[route.pattern];
  return route.path.replace(/^\/demo(?=\/|$)/, "").replace(/static_[^/]+/g, (id) => {
    if (!fixture.ids[id]) throw new Error(`Live fixture is missing a native ID for ${id}`);
    return fixture.ids[id];
  });
}

export async function signInLive(page: Page, role = "Owner", throughForm = false) {
  const fixture = liveFixture();
  const credentials = fixture.identities[role];
  if (!credentials) throw new Error(`Live fixture is missing credentials for ${role}`);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (throughForm) {
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.getByLabel("Password", { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } else {
    const response = await page.context().request.post("/api/auth/sign-in/email", {
      data: credentials,
      headers: { origin: new URL(page.url()).origin },
    });
    expect(response.ok(), "Actual Better Auth sign-in must succeed").toBe(true);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
  }
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("Checking workspace access…", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(fixture.societyId);
  // A successful shell must belong to the real server runtime; /demo opts into
  // a synthetic actor and would invalidate live authorization evidence.
  expect(page.url()).not.toContain("/demo/");
  expect(await page.evaluate(() => {
    const stored = localStorage.getItem("societyer:app-runtime");
    return stored ? JSON.parse(stored).mode : null;
  })).not.toBe("local");
}

export async function assertLiveFits(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const overflow = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll<HTMLElement>(".page")]
    .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
    .map((element) => ({ selector: element === document.documentElement ? "html" : element.className, width: element.clientWidth, scroll: element.scrollWidth })));
  expect(overflow, `Uncontained overflow at ${page.url()}`).toEqual([]);
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible()) {
    await expect.poll(() => dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const handles = Array.from(element.querySelectorAll<HTMLElement>(".modal__resize"))
        .filter((handle) => handle.getClientRects().length > 0);
      const parts = Array.from(element.querySelectorAll<HTMLElement>(".modal__head, .modal__body, .modal__foot, .drawer__head, .drawer__body, .drawer__footer"))
        .filter((part) => part.clientWidth > 0);
      const overflowingContent = parts.filter((part) => part.scrollWidth > part.clientWidth + 2)
        .map((part) => ({ part: part.className, clientWidth: part.clientWidth, scrollWidth: part.scrollWidth }));
      const outsideHandles = handles.filter((handle) => {
        const bounds = handle.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > innerWidth + 1;
      }).map((handle) => handle.className);
      return {
        frameInside: rect.left >= -1 && rect.right <= innerWidth + 1,
        // Resizer grips deliberately extend beyond the frame. Inspect content
        // directly instead of treating those positioned grips as text overflow.
        frameContentInside: handles.length > 0 || element.scrollWidth <= rect.width + 2,
        overflowingContent, outsideHandles,
      };
    }), { message: "Dialog content and resize controls must remain inside the viewport" }).toEqual({
      frameInside: true, frameContentInside: true, overflowingContent: [], outsideHandles: [],
    });
  }
}
