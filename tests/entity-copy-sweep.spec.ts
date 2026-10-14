/**
 * Entity copy sweep.
 *
 * Builds five workspaces through the real guided setup (no seed shortcut):
 *   bc-corp   BC business corporation (existing)
 *   cbca-corp Federal CBCA corporation (preparing a new incorporation)
 *   obca-corp Ontario OBCA corporation (existing)
 *   custom    "Another organization or Act": a Quebec business corporation
 *   bc-society BC society (control)
 * and opens the three populated corporation demos through the demo banner's
 * "Try another organization type" (bc-demo, cbca-demo, obca-demo: share
 * register, resolutions, dividends, filings; shared/demoData/corporations.ts),
 * then visits every in-app route in each, collects the rendered text (main
 * content, app chrome, the fully expanded sidebar, page info popovers and
 * checkbox/switch labels) and flags society-only copy.
 *
 * Runs only under playwright.entity-sweep.config.ts:
 *   SOCIETYER_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:entity-sweep
 *
 * Verdict (the "report" test):
 *   - any match for a non-society workspace that is neither allow-listed
 *     (tests/fixtures/entity-copy-allowlist.json "allow") nor in the
 *     KNOWN_LEAKS baseline ("knownLeaks" in the same file) fails the run;
 *   - the BC society must still show Societies Act content on the dashboard
 *     or the Members page;
 *   - baseline entries that no longer reproduce are reported as stale, so the
 *     baseline can be tightened. ENTITY_SWEEP_STRICT=1 ignores the baseline
 *     and fails on every non-allow-listed match.
 *
 * Findings land in tmp/entity-sweep/findings.json (and .md) for
 * docs/entity-copy-audit.md.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { INTERFACE_ROUTES } from "./helpers/interfaceRoutes";

test.skip(!process.env.SOCIETYER_ENTITY_SWEEP, "Runs only under playwright.entity-sweep.config.ts");

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

type WorkspaceKey = "bc-corp" | "cbca-corp" | "obca-corp" | "custom" | "bc-society" | "bc-demo" | "cbca-demo" | "obca-demo";
type Workspace = {
  key: WorkspaceKey;
  name: string;
  stage: "existing" | "preparing";
  act: RegExp;
  /** Opened from the in-browser demo's persona menu instead of guided setup; routes live under /demo. */
  demoPersona?: string;
  custom?: { jurisdiction: string; entityType: string; act: string };
  society: boolean;
  /** BC workspaces may legitimately mention BC PIPA. */
  bc: boolean;
};

const ALL_WORKSPACES: Workspace[] = [
  { key: "bc-corp", name: "Sweep Cedar Holdings Ltd.", stage: "existing", act: /^BC business corporation \(provincial\)/, society: false, bc: true },
  { key: "cbca-corp", name: "Sweep Maple Federal Inc.", stage: "preparing", act: /^Federal business corporation \(CBCA\)/, society: false, bc: false },
  { key: "obca-corp", name: "Sweep Lakeshore Ontario Inc.", stage: "existing", act: /^Ontario business corporation \(OBCA\)/, society: false, bc: false },
  {
    key: "custom",
    name: "Sweep Fleuve Quebec Inc.",
    stage: "existing",
    act: /^Another organization or Act/,
    custom: { jurisdiction: "Quebec", entityType: "Business Corporation", act: "Business Corporations Act (Quebec)" },
    society: false,
    bc: false,
  },
  { key: "bc-society", name: "Sweep Harbour Community Society", stage: "existing", act: /^BC society \(nonprofit\)/, society: true, bc: true },
  { key: "bc-demo", name: "Cedar Demo Holdings Ltd.", stage: "existing", act: /^$/, demoPersona: "BC company", society: false, bc: true },
  { key: "cbca-demo", name: "Maple Demo Federal Inc.", stage: "existing", act: /^$/, demoPersona: "Federal CBCA corporation", society: false, bc: false },
  { key: "obca-demo", name: "Lakeshore Demo Ontario Inc.", stage: "existing", act: /^$/, demoPersona: "Ontario OBCA corporation", society: false, bc: false },
];
// ENTITY_SWEEP_WORKSPACES=bc-demo,cbca-demo narrows a local run; the full sweep is the default.
const ONLY_WORKSPACES = process.env.ENTITY_SWEEP_WORKSPACES?.split(",").map((key) => key.trim()).filter(Boolean);
export const WORKSPACES: Workspace[] = ONLY_WORKSPACES ? ALL_WORKSPACES.filter((workspace) => ONLY_WORKSPACES.includes(workspace.key)) : ALL_WORKSPACES;

/** The route as the workspace serves it: populated demos live under /demo. */
const routeFor = (workspace: Workspace, route: string) => (workspace.demoPersona ? `/demo${route}` : route);

const OUT_DIR = path.resolve(process.env.ENTITY_SWEEP_DATA ?? "tmp/entity-sweep");
const stateFile = (key: WorkspaceKey) => path.join(OUT_DIR, `${key}.storage.json`);
const shardFile = (key: WorkspaceKey, shard: number) => path.join(OUT_DIR, `${key}.shard-${shard}.json`);
const ALLOWLIST_FILE = path.resolve("tests/fixtures/entity-copy-allowlist.json");

// ---------------------------------------------------------------------------
// Routes: every static in-app route from the interface route matrix, which
// the AST drift checker keeps in step with src/main.tsx. Parameterised routes
// need records the fresh workspaces do not have, so they are left out (the
// demo they point at is a society). A guard below re-reads src/main.tsx so a
// new static route cannot silently escape the sweep.
// ---------------------------------------------------------------------------

const EXCLUDED_ROUTES = new Set([
  "/app/society/new", // the setup wizard itself
  "/app/table-field-lab", // static-demo-only lab
]);

export const SWEEP_ROUTES: string[] = Array.from(
  new Set(
    INTERFACE_ROUTES.filter((route) => route.kind === "app" && route.fixture === "route")
      .map((route) => route.path.replace(/^\/demo\/app/, "/app"))
      .filter((route) => !route.includes(":") && !EXCLUDED_ROUTES.has(route)),
  ),
).sort((a, b) => (a === "/app" ? -1 : b === "/app" ? 1 : a.localeCompare(b)));

const SHARDS = Number(process.env.ENTITY_SWEEP_SHARDS ?? 3);
const ONLY_ROUTES = process.env.ENTITY_SWEEP_ROUTES?.split(",").map((route) => route.trim()).filter(Boolean);
const routesForShard = (shard: number) =>
  (ONLY_ROUTES ?? SWEEP_ROUTES).filter((_, index) => index % SHARDS === shard);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

type PatternKey =
  | "societies-act"
  | "societies-online"
  | "bc-soc"
  | "societies-section"
  | "society"
  | "members"
  | "agm"
  | "bylaws"
  | "constitution"
  | "pipa"
  | "charity-toggle";

type Pattern = {
  key: PatternKey;
  regex: RegExp;
  /** Skip the match when the surrounding line also matches this. */
  unless?: RegExp;
  applies?: (workspace: Workspace) => boolean;
  /** Only applied to the checkbox/switch label channel. */
  toggleOnly?: boolean;
};

const PATTERNS: Pattern[] = [
  { key: "societies-act", regex: /Societies Act/g },
  { key: "societies-online", regex: /Societies Online/g },
  { key: "bc-soc", regex: /BC-SOC-/g },
  { key: "societies-section", regex: /Societies[^\n]{0,40}?\bs\.\s?\d+|\bs\.\s?\d+[^\n]{0,40}?Societies/g },
  { key: "society", regex: /\bsociety\b/gi },
  // "members" as voters/owners; board/committee/team membership is fine.
  { key: "members", regex: /(?<!\b(?:board|committee|team|staff|family|council|panel|crew|commission)\s)\bmembers?\b/gi, unless: /\b(?:board|committee|team|staff) members?\b/i },
  { key: "agm", regex: /\bAGMs?\b|annual general meeting/gi },
  // A BC company has articles only, so any by-law wording is a leak there.
  // Federal, Ontario and other corporations do have by-laws (hyphenated, the
  // statutory spelling); only the society spelling "bylaws" is flagged.
  { key: "bylaws", regex: /\bby-?laws?\b/gi, unless: /articles/i, applies: (workspace) => workspace.bc },
  { key: "bylaws", regex: /\bbylaws?\b/gi, unless: /articles/i, applies: (workspace) => !workspace.bc },
  { key: "constitution", regex: /\bconstitution(?:s|al)?\b/gi },
  { key: "pipa", regex: /\bPIPA\b/g, applies: (workspace) => !workspace.bc },
  { key: "charity-toggle", regex: /charit(?:y|ies|able)/gi, toggleOnly: true, applies: (workspace) => !workspace.society },
];

type Channel = "main" | "chrome" | "sidebar" | "popover" | "toggle" | "title";
type Finding = {
  workspace: WorkspaceKey;
  route: string;
  channel: Channel;
  pattern: PatternKey;
  match: string;
  snippet: string;
  inNav: boolean;
};

const normalise = (text: string) => text.replace(/[ \t ]+/g, " ").replace(/\n{2,}/g, "\n");

function scan(workspace: Workspace, route: string, channel: Channel, rawText: string, inNav: boolean): Finding[] {
  const text = normalise(rawText.split(workspace.name).join("‹workspace›"));
  const findings: Finding[] = [];
  for (const pattern of PATTERNS) {
    if (pattern.applies && !pattern.applies(workspace)) continue;
    if (pattern.toggleOnly !== (channel === "toggle")) {
      if (pattern.toggleOnly || channel === "toggle") continue;
    }
    for (const match of text.matchAll(pattern.regex)) {
      const index = match.index ?? 0;
      const lineStart = text.lastIndexOf("\n", index) + 1;
      const lineEndRaw = text.indexOf("\n", index);
      const line = text.slice(lineStart, lineEndRaw === -1 ? undefined : lineEndRaw);
      if (pattern.unless && pattern.unless.test(line)) continue;
      const start = Math.max(lineStart, index - 70);
      const end = Math.min(lineEndRaw === -1 ? text.length : lineEndRaw, index + match[0].length + 70);
      const snippet = `${start > lineStart ? "…" : ""}${text.slice(start, end).trim()}${end < (lineEndRaw === -1 ? text.length : lineEndRaw) ? "…" : ""}`;
      findings.push({ workspace: workspace.key, route, channel, pattern: pattern.key, match: match[0], snippet, inNav });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Allow-list and baseline
// ---------------------------------------------------------------------------

type AllowEntry = {
  pattern: PatternKey | "*";
  /** Exact route, "*" for any, or a route prefix ending in "*". */
  route?: string;
  workspaces?: WorkspaceKey[];
  channel?: Channel;
  /** Regex (source) tested against the snippet. */
  snippet: string;
  reason: string;
};
type AllowList = { allow: AllowEntry[]; knownLeaks: string[] };

function loadAllowList(): AllowList {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"));
  for (const entry of raw.allow ?? []) {
    if (!entry.reason || !String(entry.reason).trim()) throw new Error(`Allow-list entry without a reason: ${JSON.stringify(entry)}`);
  }
  return { allow: raw.allow ?? [], knownLeaks: raw.knownLeaks ?? [] };
}

const routeMatches = (rule: string | undefined, route: string) =>
  !rule || rule === "*" || (rule.endsWith("*") ? route.startsWith(rule.slice(0, -1)) : rule === route);

export function isAllowed(finding: Finding, allow: AllowEntry[]): AllowEntry | undefined {
  return allow.find(
    (entry) =>
      (entry.pattern === "*" || entry.pattern === finding.pattern) &&
      routeMatches(entry.route, finding.route) &&
      (!entry.workspaces || entry.workspaces.includes(finding.workspace)) &&
      (!entry.channel || entry.channel === finding.channel) &&
      new RegExp(entry.snippet, "i").test(finding.snippet),
  );
}

/** Baseline key: workspace | route | pattern. Coarse on purpose, so dates and counts in snippets do not churn it. */
const leakKey = (finding: Pick<Finding, "workspace" | "route" | "pattern">) => `${finding.workspace} | ${finding.route} | ${finding.pattern}`;

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function pickOption(page: Page, label: string, option: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" ? true : undefined }).first().click();
}

async function openDemoPersona(page: Page, workspace: Workspace) {
  await page.goto("/demo/app");
  const trigger = page.getByRole("button", { name: /Try another organization type/ });
  // The first visit compiles the demo bundle on a cold dev server.
  await expect(trigger).toBeVisible({ timeout: 300_000 });
  await trigger.click();
  await page.getByRole("menuitem", { name: new RegExp(`^${workspace.demoPersona}`) }).click();
  await expect(page.locator(".demo-banner")).toContainText(workspace.name, { timeout: 120_000 });
}

async function guidedSetup(page: Page, workspace: Workspace) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  const existing = workspace.stage === "existing";
  await page.getByRole("button", { name: existing ? "Yes, set up an existing organization" : "No, prepare a new incorporation", exact: true }).click();
  await pickOption(page, existing ? "Act the organization was formed under" : "Act you plan to incorporate under", workspace.act);
  if (workspace.custom) {
    await pickOption(page, "Legal jurisdiction", workspace.custom.jurisdiction);
    await pickOption(page, "Entity type", workspace.custom.entityType);
    await pickOption(page, "Act formed under", workspace.custom.act);
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: existing ? "Recorded legal name" : "Proposed name / working name", exact: true }).fill(workspace.name);
  if (existing) {
    await page.getByRole("textbox", { name: "Incorporation #", exact: true }).fill("SWEEP-0001");
    await page.getByLabel("Incorporation date", { exact: true }).fill("2021-04-12");
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\?welcome=/);
}

const workspaceButton = (page: Page, workspace: Workspace) =>
  page.getByRole("button", { name: new RegExp(`Select workspace.*${workspace.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first();

async function settle(page: Page) {
  // Let local queries answer and lazy chunks mount; loading placeholders
  // ("Loading…", skeletons) should be gone before text is read.
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("#main-content");
        if (!main) return false;
        const text = (main as HTMLElement).innerText;
        return text.trim().length > 0 && !/^\s*Loading/.test(text) && !main.querySelector('.skeleton, [aria-busy="true"]');
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

async function expandSidebar(page: Page) {
  // Workspace identity can resolve before the permission/module navigation.
  // A zero-link sidebar is not evidence that an entity has no member register.
  await expect(page.locator(".sidebar a[href]").first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 25; i += 1) {
    const closed = page.locator('.sidebar__group-toggle[aria-expanded="false"]').first();
    if (!(await closed.count())) break;
    await closed.click().catch(() => undefined);
  }
}

async function assertPrivacyScope(page: Page, workspace: Workspace) {
  // Fresh guided-setup fixtures deliberately contain no privacy activity facts.
  const assessment = page.getByRole("region", { name: "Privacy-law scope", exact: true });
  await expect(assessment).toBeVisible();
  await expect(assessment).toContainText("Record where personal information is handled and which activities it supports.");
  await expect(assessment).toContainText("Multiple laws can apply to different records or transactions.");
  await expect(assessment).toContainText("Record the provinces or territories where personal information is handled.");
  await expect(assessment).not.toContainText("Assessed as applicable");
  if (workspace.bc) {
    // BC PIPA s. 3(1) applies to every organization (including not-for-profits)
    // unless federal law governs, so a BC-home workspace presumes it and labels
    // the presumption for confirmation. No other provincial law is listed.
    await expect(assessment.locator("summary").filter({ hasText: /^BC PIPA Presumed: confirm facts$/ })).toHaveCount(1);
    await expect(assessment.locator("summary").filter({ hasText: /^(?:Alberta PIPA|Québec private-sector privacy law) / })).toHaveCount(0);
    await expect(assessment).toContainText("federal work, undertaking or business");
    await expect(page.locator(".sidebar").getByRole("link", { name: "Privacy (PIPA)", exact: true })).toBeVisible();
    await expect(page.locator("#main-content h1")).toHaveText("Privacy (BC PIPA — presumed: confirm facts)");
  } else {
    // Possible laws belong inside the scope assessment, never in operative nav
    // or policy claims based solely on incorporation.
    await expect(assessment).toContainText("applicability needs assessment");
    await expect(assessment.locator("summary").filter({ hasText: /^(?:BC|Alberta) PIPA Conditional$/ })).toHaveCount(2);
    await expect(assessment.locator("details[open]")).toHaveCount(0);
    await expect(page.locator(".sidebar")).not.toContainText(/\bPIPA\b/);
    await expect(page.locator("#main-content h1")).toHaveText("Privacy — applicability needs assessment");
  }
  if (!workspace.society) {
    await expect(page.locator("#main-content")).not.toContainText("Members may inspect the member register");
    await expect(page.locator("#main-content")).not.toContainText("Members may inspect the director register");
  }
}

/** Text the page shows, split into channels. */
async function collect(page: Page) {
  return await page.evaluate(() => {
    const visibleText = (element: Element | null) => (element ? (element as HTMLElement).innerText ?? "" : "");
    const main = document.querySelector("#main-content");
    const sidebar = document.querySelector(".sidebar");
    // Chrome: everything outside the sidebar and the routed content.
    const hidden: Array<[HTMLElement, string]> = [];
    for (const element of [main, sidebar]) {
      if (element instanceof HTMLElement) {
        hidden.push([element, element.style.display]);
        element.style.display = "none";
      }
    }
    const chrome = document.body.innerText;
    for (const [element, display] of hidden) element.style.display = display;

    const labelOf = (input: Element) => {
      const parts: string[] = [];
      const aria = input.getAttribute("aria-label");
      if (aria) parts.push(aria);
      const labelledBy = input.getAttribute("aria-labelledby");
      if (labelledBy) for (const id of labelledBy.split(/\s+/)) parts.push(visibleText(document.getElementById(id)));
      const id = input.getAttribute("id");
      if (id) for (const label of Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`))) parts.push(visibleText(label));
      const wrapping = input.closest("label");
      if (wrapping) parts.push(visibleText(wrapping));
      return parts.join(" ").trim();
    };
    const toggles = Array.from(
      document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="switch"], [role="checkbox"], [role="radio"]'),
    )
      .map(labelOf)
      .filter(Boolean);
    const titles = Array.from(document.querySelectorAll("#main-content [title], .sidebar [title]"))
      .map((element) => element.getAttribute("title") ?? "")
      .filter((title) => title.length > 3);
    const navHrefs = Array.from(document.querySelectorAll(".sidebar a[href]")).map((anchor) => new URL((anchor as HTMLAnchorElement).href).pathname);
    return { main: visibleText(main), chrome, sidebar: visibleText(sidebar), toggles: toggles.join("\n"), titles: titles.join("\n"), navHrefs };
  });
}

async function collectPopovers(page: Page) {
  const texts: string[] = [];
  const triggers = page.locator("#main-content .info-popover__trigger");
  const count = Math.min(await triggers.count(), 6);
  for (let i = 0; i < count; i += 1) {
    const trigger = triggers.nth(i);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    await trigger.click({ timeout: 2_000 }).catch(() => undefined);
    const popover = page.locator(".info-popover").last();
    if (await popover.isVisible({ timeout: 1_000 }).catch(() => false)) texts.push(await popover.innerText().catch(() => ""));
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  return texts.join("\n");
}

/**
 * In-app navigation without a reload, so the workspace is not re-hydrated
 * from IndexedDB on every route. BrowserRouter (react-router v6) reacts to a
 * popstate whose history state carries the next `idx`; a bare pushState
 * would change the URL without re-rendering. Falls back to a full load if the
 * router did not pick the route up. ENTITY_SWEEP_RELOAD=1 always reloads.
 */
async function visit(page: Page, route: string) {
  if (process.env.ENTITY_SWEEP_RELOAD !== "1") {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.evaluate((target) => {
      // Mark the current page's headings; the new route replaces them.
      for (const heading of Array.from(document.querySelectorAll("#main-content h1"))) (heading as HTMLElement).dataset.sweepStale = "1";
      const idx = Number((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
      const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx };
      window.history.pushState(state, "", target);
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    }, route);
    const rendered = await page
      .waitForFunction(() => Boolean(document.querySelector("#main-content")) && !document.querySelector("[data-sweep-stale]"), undefined, {
        timeout: 5_000,
      })
      .then(() => true)
      .catch(() => false);
    if (rendered) return;
  }
  await page.goto(route, { waitUntil: "domcontentloaded" });
}

async function openWorkspace(browser: Browser, baseURL: string, workspace: Workspace) {
  const context = await browser.newContext({ baseURL, storageState: stateFile(workspace.key), viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  return { context, page };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("entity copy sweep", () => {
  test("every static route in src/main.tsx is swept @setup", async () => {
    const source = fs.readFileSync(path.resolve("src/main.tsx"), "utf8");
    const appBlock = source.slice(source.indexOf('path="/app"'));
    const nested = Array.from(appBlock.matchAll(/path="([^"/*][^"]*)"/g)).map((match) => `/app/${match[1]}`);
    const missing = nested.filter((route) => !route.includes(":") && !EXCLUDED_ROUTES.has(route) && !SWEEP_ROUTES.includes(route));
    expect(missing, "Static routes in src/main.tsx missing from the sweep (add them to tests/helpers/interfaceRoutes.ts)").toEqual([]);
  });

  for (const workspace of WORKSPACES) {
    test(`set up ${workspace.key} ${workspace.demoPersona ? "from the demo banner" : "through the guided setup"} @setup`, async ({ page }) => {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      if (workspace.demoPersona) await openDemoPersona(page, workspace);
      else await guidedSetup(page, workspace);
      await page.goto(routeFor(workspace, "/app"));
      await expect(workspaceButton(page, workspace)).toBeVisible({ timeout: 180_000 });
      await settle(page);
      await page.context().storageState({ path: stateFile(workspace.key), indexedDB: true });
    });
  }

  for (const workspace of WORKSPACES) {
    for (let shard = 0; shard < SHARDS; shard += 1) {
      test(`sweep ${workspace.key} shard ${shard + 1}/${SHARDS} @shard`, async ({ browser }, testInfo) => {
        const baseURL = String(testInfo.project.use.baseURL);
        const { context, page } = await openWorkspace(browser, baseURL, workspace);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(`${new URL(page.url()).pathname}: ${error.message}\n${error.stack ?? ""}`));
        const findings: Finding[] = [];
        const visited: Array<{ route: string; finalPath: string; chars: number; ms: number }> = [];
        let navHrefs = new Set<string>();

        // The sidebar is the same on every route; read it once, fully expanded.
        await page.goto(routeFor(workspace, "/app"), { waitUntil: "domcontentloaded" });
        await expect(workspaceButton(page, workspace)).toBeVisible({ timeout: 180_000 });
        await settle(page);
        await expandSidebar(page);
        const shell = await collect(page);
        navHrefs = new Set(shell.navHrefs.map((href) => href.replace(/^\/demo(?=\/)/, "")));
        if (shard === 0) {
          findings.push(...scan(workspace, "(sidebar)", "sidebar", shell.sidebar, true));
          findings.push(...scan(workspace, "(sidebar)", "title", shell.titles, true));
        }

        for (const route of routesForShard(shard)) {
          const started = Date.now();
          await visit(page, routeFor(workspace, route));
          await workspaceButton(page, workspace).waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
          await settle(page);
          // The fresh guided-setup workspaces have no privacy facts; the demos record theirs.
          if (route === "/app/privacy" && !workspace.demoPersona) {
            await assertPrivacyScope(page, workspace);
            if (workspace.key === "cbca-corp") await page.screenshot({ path: path.join(OUT_DIR, "cbca-corp-privacy.png") });
          }
          const text = await collect(page);
          const popovers = await collectPopovers(page);
          const finalPath = new URL(page.url()).pathname.replace(/^\/demo(?=\/)/, "");
          const inNav = navHrefs.has(route) || navHrefs.has(finalPath);
          findings.push(...scan(workspace, route, "main", text.main, inNav));
          findings.push(...scan(workspace, route, "chrome", text.chrome, inNav));
          findings.push(...scan(workspace, route, "popover", popovers, inNav));
          findings.push(...scan(workspace, route, "toggle", text.toggles, inNav));
          findings.push(...scan(workspace, route, "title", text.titles.split("\n").filter((title) => !shell.titles.includes(title)).join("\n"), inNav));
          visited.push({ route, finalPath, chars: text.main.length, ms: Date.now() - started });
        }

        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(
          shardFile(workspace.key, shard),
          JSON.stringify({ workspace: workspace.key, shard, visited, findings, errors, navHrefs: Array.from(navHrefs) }, null, 2),
        );
        await context.close();
        // Only crashes fail a shard; the verdict lives in the report test so it
        // always sees every shard.
        expect(visited.length).toBe(routesForShard(shard).length);
      });
    }
  }
});

test.describe("entity copy verdict", () => {
  test("report @verdict", async ({}, testInfo) => {
    const { allow, knownLeaks } = loadAllowList();
    const strict = process.env.ENTITY_SWEEP_STRICT === "1";
    const all: Finding[] = [];
    const visited: Record<string, Array<{ route: string; finalPath: string; chars: number; ms: number }>> = {};
    const pageErrors: Record<string, string[]> = {};
    const missingShards: string[] = [];
    const navByWorkspace: Record<string, Set<string>> = {};
    for (const workspace of WORKSPACES) {
      for (let shard = 0; shard < SHARDS; shard += 1) {
        const file = shardFile(workspace.key, shard);
        if (!fs.existsSync(file)) {
          missingShards.push(file);
          continue;
        }
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        all.push(...data.findings);
        (visited[workspace.key] ??= []).push(...data.visited);
        (pageErrors[workspace.key] ??= []).push(...data.errors);
        (navByWorkspace[workspace.key] ??= new Set()).add(data.navHrefs.includes("/app/members") ? "members" : "no-members");
      }
    }
    expect(missingShards, "Every sweep shard must have written its findings").toEqual([]);

    // Sanity: the sweep read real pages, and each workspace got its entity kind
    // (the society member register is only in a society's sidebar).
    for (const workspace of WORKSPACES) {
      const routes = visited[workspace.key] ?? [];
      const blank = routes.filter((route) => route.chars < 40).map((route) => route.route);
      expect(blank.length, `${workspace.key}: routes that rendered almost nothing: ${blank.join(", ")}`).toBeLessThanOrEqual(Math.ceil(routes.length * 0.1));
      expect(Array.from(navByWorkspace[workspace.key] ?? []), `${workspace.key}: sidebar Members link`).toEqual([workspace.society ? "members" : "no-members"]);
    }

    // Collapse identical snippets per workspace/route/pattern/channel.
    const unique = new Map<string, Finding & { count: number }>();
    for (const finding of all) {
      const key = `${finding.workspace}|${finding.route}|${finding.channel}|${finding.pattern}|${finding.snippet}`;
      const current = unique.get(key);
      if (current) current.count += 1;
      else unique.set(key, { ...finding, count: 1 });
    }
    // Chrome text repeats on every route: report it once under "(chrome)".
    const findings = Array.from(unique.values());
    const chromeSeen = new Set<string>();
    const deduped = findings.filter((finding) => {
      if (finding.channel !== "chrome") return true;
      const key = `${finding.workspace}|${finding.pattern}|${finding.snippet}`;
      if (chromeSeen.has(key)) return false;
      chromeSeen.add(key);
      finding.route = "(chrome)";
      return true;
    });

    const nonSociety = new Set(WORKSPACES.filter((workspace) => !workspace.society).map((workspace) => workspace.key));
    const leaks = deduped.filter((finding) => nonSociety.has(finding.workspace) && !isAllowed(finding, allow));
    const allowed = deduped.filter((finding) => nonSociety.has(finding.workspace) && isAllowed(finding, allow));
    const baseline = new Set(strict ? [] : knownLeaks);
    const leakKeys = new Set(leaks.map(leakKey));
    const newLeaks = leaks.filter((finding) => !baseline.has(leakKey(finding)));
    const sweptRoutes = new Set(ONLY_ROUTES ?? [...SWEEP_ROUTES, "(sidebar)", "(chrome)"]);
    const stale = Array.from(baseline).filter((key) => !leakKeys.has(key) && sweptRoutes.has(key.split(" | ")[1]));

    const perWorkspace = Object.fromEntries(
      WORKSPACES.map((workspace) => [
        workspace.key,
        {
          matches: deduped.filter((finding) => finding.workspace === workspace.key).length,
          leaks: leaks.filter((finding) => finding.workspace === workspace.key).length,
          leakRoutes: new Set(leaks.filter((finding) => finding.workspace === workspace.key).map((finding) => finding.route)).size,
          routesVisited: visited[workspace.key]?.length ?? 0,
          pageErrors: pageErrors[workspace.key]?.length ?? 0,
        },
      ]),
    );

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "findings.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), strict, perWorkspace, leaks, allowed, society: deduped.filter((finding) => !nonSociety.has(finding.workspace)), newLeaks, stale, visited, pageErrors }, null, 2),
    );
    const md = [
      "| Workspace | Route | In nav | Channel | Pattern | Snippet |",
      "| --- | --- | --- | --- | --- | --- |",
      ...leaks
        .sort((a, b) => a.route.localeCompare(b.route) || a.workspace.localeCompare(b.workspace) || a.pattern.localeCompare(b.pattern))
        .map((finding) => `| ${finding.workspace} | \`${finding.route}\` | ${finding.inNav ? "yes" : "no"} | ${finding.channel} | ${finding.pattern} | ${finding.snippet.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    ].join("\n");
    fs.writeFileSync(path.join(OUT_DIR, "findings.md"), md);
    await testInfo.attach("entity-copy-findings.json", { path: path.join(OUT_DIR, "findings.json"), contentType: "application/json" });

    console.log(`Entity copy sweep: ${JSON.stringify(perWorkspace, null, 2)}`);
    console.log(`Known leaks tolerated: ${leaks.length - newLeaks.length}; new: ${newLeaks.length}; stale baseline entries: ${stale.length}`);
    if (stale.length) {
      testInfo.annotations.push({ type: "stale-baseline", description: stale.join("\n") });
      console.log(`Baseline entries that no longer reproduce (remove them from knownLeaks):\n  ${stale.join("\n  ")}`);
    }

    // Control: the society still gets its Societies Act copy.
    const controlSwept = WORKSPACES.some((workspace) => workspace.key === "bc-society");
    const societyActOnExpectedRoute = all.some(
      (finding) => finding.workspace === "bc-society" && finding.pattern === "societies-act" && ["/app", "/app/members"].includes(finding.route),
    );
    if (controlSwept) expect(societyActOnExpectedRoute, "The BC society control must still show Societies Act copy on the dashboard or Members page").toBe(true);
    const societyMembersInNav = all.some((finding) => finding.workspace === "bc-society" && finding.route === "(sidebar)" && finding.pattern === "members");
    if (controlSwept) expect(societyMembersInNav, "The BC society control must still list Members in the sidebar").toBe(true);

    expect(
      newLeaks.map((finding) => `${leakKey(finding)} [${finding.channel}] ${finding.snippet}`),
      "Society-only copy in a non-society workspace. Fix the source, or add a justified entry to tests/fixtures/entity-copy-allowlist.json",
    ).toEqual([]);
    expect(
      Object.entries(pageErrors).flatMap(([workspace, errors]) => errors.map((error) => `${workspace}: ${error}`)),
      "Every route must render without an uncaught browser error; see findings.json for route and stack details",
    ).toEqual([]);
  });
});
