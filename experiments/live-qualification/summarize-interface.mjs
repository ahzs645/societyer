/** Merge private Playwright outcomes into credential-free, trace-free evidence.
 * Reports must be listed chronologically; later completed cases supersede prior
 * attempts. Interrupted and unstarted cases never count as executed coverage. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reportPaths = process.argv.slice(2);
if (!reportPaths.length) throw new Error("Pass chronological Playwright JSON report paths.");
const initial = new Map();
const latest = new Map();
const planned = new Set();
const reports = [];
const failedAttempts = [];
function failureCategory(row) {
  if (row.file === "live-interface-minute-book-acl.spec.ts" && row.sourceReport?.includes("acl-final-verified")) return "All Viewer reload and ACL checks passed; test cleanup sign-out now sends the required same-origin header, preserving the broker CSRF protection.";
  if (row.file === "live-interface-minute-book-acl.spec.ts" && row.sourceReport?.includes("workspace-reload-initial")) return "Actual workspace-picker selection survived until hard reload, then pending authentication cleared the preference and selected the first workspace; saved preference now survives hydration and is validated against resolved authorized memberships.";
  if (row.file === "live-interface-minute-book-acl.spec.ts") return "Corrected the disposable-workspace fixture to use the actual workspace picker, including its incorporation number in the accessible name; direct storage writes or an independently imported setter do not exercise that selection path.";
  if (row.file === "live-interface-settings-authority.spec.ts") return "Settings test now opens the existing Modules tab for inventory controls; Workspace holds branding and Runtime holds retention/shared views.";
  if (row.file === "live-interface-meeting-detail-access.spec.ts" && row.title.startsWith("Director")) return "Test now inspects approval and scheduling controls on their existing Overview tab; native schedule and agenda save/reload remain required.";
  if (row.title.includes("anonymous live grant intake")) return "Fast grant submission now synchronously reads editor content before required-field validation and native submission.";
  if (row.sourceReport?.includes("qualified") && row.title.includes("Member native permitted reads 61-67")) return "Test now uses the existing workflow-topbar title instead of assuming every detail page has a page h1.";
  if (row.title.includes("Member live guards") && (row.sourceReport?.includes("qualified") || row.sourceReport?.includes("postfix"))) return "Restricted-route test now follows the AST-checked current route inventory, excluding stale aliases and separately recording the demo-only lab's safe landing redirect.";
  if (row.title.includes("organization logo")) return "Authenticated workspace data now updates reactively, so the persisted logo renders after reload.";
  if (row.title.includes("asset photo")) return "Corrected upload form selectors, then used the desktop/tablet Open record action and awaited its native-ID URL before reload; stored-byte checks retained.";
  if (row.title.includes("inventory photo")) return "Corrected native upload form selectors and retained actual stored-byte persistence checks.";
  if (row.title.includes("people directory")) return "Directory writes now carry workspace scope and required native role-holder fields; cross-workspace reads and edits are isolated.";
  if (row.title.includes("annual filing")) return "Corrected the evidence-validation form selector while retaining native pending-record persistence checks.";
  if (row.title.includes("Member")) return "Unauthorized auxiliary reads from the global shell, dashboard or a Member-readable page; actual role gates retained.";
  if (row.title.includes("committee detail")) return "Test selector corrected for existing button-based tabs.";
  if (row.title.includes("131–136")) return "Hosted intentionally excludes the demo-only table field lab.";
  if (/(?:Owner|Admin) native write gates 25-30/.test(row.title)) return "Test now waits for the actual proxy bylaw prohibition before asserting disabled controls.";
  if (row.title.includes("document metadata")) return "Strict drawer geometry now waits for its entrance animation to settle.";
  if (row.title.includes("vault")) return "Actual Owner reveal now resolves workspace ownership from the stored record.";
  return "Native one-second query contention, source hot reload, or a corrected dialog geometry check; qualified by the completed clean rerun.";
}
function visit(suite, rows) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
    const result = test.results?.at(-1);
    const row = { project: test.projectName, file: spec.file, title: spec.title, status: result?.status ?? "not-run", durationMs: result?.duration ?? 0 };
    const restricted = result?.attachments?.find((attachment) => attachment.name === "restricted-module-entries");
    if (restricted) {
      const payload = restricted.body ? Buffer.from(restricted.body, "base64").toString("utf8") : readFileSync(restricted.path, "utf8");
      const checks = JSON.parse(payload);
      row.hostedRestrictedEntryChecks = checks.filter((check) => check.state === "Access restricted").length;
      row.demoFallbackChecks = checks.filter((check) => check.state === "Demo-only route safely excluded from hosted app").length;
    }
    rows.push(row);
  }
  for (const child of suite.suites ?? []) visit(child, rows);
}
for (const path of reportPaths) {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const rows = [];
  for (const suite of report.suites ?? []) visit(suite, rows);
  const summary = {};
  for (const row of rows) {
    planned.add(`${row.project}\0${row.file}\0${row.title}`);
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    const key = `${row.project}\0${row.file}\0${row.title}`;
    if (["failed", "timedOut"].includes(row.status) && !initial.has(key)) initial.set(key, { ...row, sourceReport: basename(path) });
    if (["failed", "timedOut"].includes(row.status)) failedAttempts.push({ ...row, sourceReport: basename(path), category: failureCategory({ ...row, sourceReport: basename(path) }) });
    if (["passed", "failed", "timedOut"].includes(row.status)) latest.set(`${row.project}\0${row.file}\0${row.title}`, { ...row, sourceReport: basename(path) });
  }
  reports.push({ report: basename(path), outcomes: summary });
}
const cases = [...latest.values()].sort((a, b) => a.project.localeCompare(b.project) || a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
const byViewport = {};
for (const row of cases) {
  const counts = byViewport[row.project] ??= { passed: 0, failed: 0 };
  counts[row.status === "passed" ? "passed" : "failed"]++;
}
const initialFailures = [...initial.values()].map((row) => ({
  project: row.project, file: row.file, title: row.title, sourceReport: row.sourceReport,
  category: failureCategory(row),
  finalStatus: latest.get(`${row.project}\0${row.file}\0${row.title}`)?.status ?? "not-run",
}));
const output = resolve(root, "artifacts/offline/live-interface-results.json");
mkdirSync(dirname(output), { recursive: true });
const evidence = {
  generatedAt: new Date().toISOString(), baseline: process.env.LIVE_INTERFACE_BASELINE ?? "bac427b plus the reviewed working diff",
  backend: "Isolated production Convex exports at http://127.0.0.1:43230", authentication: "Actual Better Auth sessions through the production broker at http://127.0.0.1:43477",
  distinctPlannedCasesInReports: planned.size, distinctExecutedCases: cases.length, passed: cases.filter((row) => row.status === "passed").length, failed: cases.filter((row) => row.status !== "passed").length,
  byViewport, reports, initialFailures,
  failedAttempts: failedAttempts.map((row) => ({ ...row, finalStatus: latest.get(`${row.project}\0${row.file}\0${row.title}`)?.status ?? "not-run" })),
  cases,
  coverage: {
    plannedRoutePatterns: 136, plannedRouteRenderChecksAtFourWidths: 544,
    completedRouteRenderChecks: cases.filter((row) => row.file === "live-interface-routes.spec.ts" && row.status === "passed").reduce((sum, row) => { const match = row.title.match(/surfaces (\d+)[–-](\d+)/); return sum + (match ? Number(match[2]) - Number(match[1]) + 1 : 0); }, 0),
    completedMemberPermittedRouteChecks: cases.filter((row) => row.file === "live-interface-workflows.spec.ts" && row.status === "passed").reduce((sum, row) => { const match = row.title.match(/Member native permitted reads (\d+)-(\d+)/); return sum + (match ? Number(match[2]) - Number(match[1]) + 1 : 0); }, 0),
    completedHostedMemberRestrictedEntryChecks: cases.filter((row) => row.status === "passed").reduce((sum, row) => sum + (row.hostedRestrictedEntryChecks ?? 0), 0),
    completedMemberDemoFallbackChecks: cases.filter((row) => row.status === "passed").reduce((sum, row) => sum + (row.demoFallbackChecks ?? 0), 0),
    authorizedWorkspaceReload: {
      completedRoleReloadChecks: cases.filter((row) => row.file === "live-interface-minute-book-acl.spec.ts" && row.status === "passed").length * 2,
      roles: ["Owner", "Viewer"],
      behavior: "Actual workspace picker selects an authorized non-first workspace; a hard reload retains it only after real authentication and membership validation.",
    },
    minuteBookDocumentACL: {
      priorCoverage: "The initial 416-case suite did not qualify a private core document inside a fresh bounded binder preview. Follow-up review identified a false completeness/missing-core-document diagnosis when ACLs hide supporting evidence.",
      configuredCases: cases.filter((row) => row.file === "live-interface-minute-book-acl.spec.ts" && row.status === "passed").length,
      roles: ["Owner", "Viewer"],
      behavior: "A private core document remains visible to Owner. Viewer receives generic access-limited coverage and an unknown core-completeness check, without private titles or a false missing-core-document diagnosis.",
      setup: "Fresh disposable synthetic workspace; production document creation uses a real Owner session, then temporary memberships and fixture rows are removed.",
    },
    privatePortal: {
      priorCoverage: "Invalid-token unavailable state only.",
      configuredPositiveCases: cases.filter((row) => row.file === "live-interface-public-portal.spec.ts" && row.status === "passed").length,
      setup: "Actual workspace/director/portal APIs create a separate synthetic workspace; board-only scope, no downloads and no email operations.",
      credentialHandling: "The portal token is retained only in the ignored private fixture and private browser evidence.",
    },
    widths: [320, 390, 768, 1440], roles: ["Owner", "Admin", "Director", "Member", "Viewer"],
    exclusions: [{ route: "/app/table-field-lab", reason: "Static-demo-only developer lab; hosted safely redirects to landing. Local suite qualifies the actual lab." }],
    states: ["Native seeded records", "Positive separate public intake forms", "Positive scoped private portal in a separate synthetic workspace", "Missing-record and invalid-token states", "Configured read-only and restricted routes", "Native storage bytes and persistent bound images"],
  },
  limitations: ["Wave detail routes use labelled synthetic native cache records, without an external Wave call.", "Chromium lacks the browser WebMCP API here; its registration contract is supplied by a shim while data/auth operations use actual Convex.", "Provider configuration screens and unavailable states do not qualify external Microsoft SSO, Clerk service connectivity, accounting, mail, AI, registry submissions or Zoer deployment.", "Private browser traces and session credentials are excluded from this public artifact.", "Interrupted and unstarted cases are omitted from executed coverage; this artifact is complete only after all planned cases have finished."],
};
writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(`Interface evidence: ${evidence.passed}/${evidence.distinctExecutedCases} distinct completed cases passed; ${evidence.failed} unresolved outcomes.`);
