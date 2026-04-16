import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const indexHtml = resolve(distDir, "index.html");
const demoAppRoutes = [
  "app",
  "app/society",
  "app/members",
  "app/directors",
  "app/meetings",
  "app/minutes",
  "app/filings",
  "app/filings/prefill",
  "app/deadlines",
  "app/documents",
  "app/conflicts",
  "app/financials",
  "app/grants",
  "app/privacy",
  "app/communications",
  "app/committees",
  "app/volunteers",
  "app/goals",
  "app/tasks",
  "app/timeline",
  "app/notifications",
  "app/users",
  "app/audit",
  "app/exports",
  "app/agendas",
  "app/motion-library",
  "app/treasurer",
  "app/membership",
  "app/inspections",
  "app/attestations",
  "app/retention",
  "app/insurance",
  "app/pipa-training",
  "app/proxies",
  "app/auditors",
  "app/proposals",
  "app/receipts",
  "app/employees",
  "app/court-orders",
  "app/written-resolutions",
  "app/bylaw-diff",
  "app/bylaw-rules",
  "app/bylaws-history",
  "app/elections",
  "app/reconciliation",
  "app/transparency",
  "app/settings",
];

if (!existsSync(indexHtml)) {
  throw new Error(`Expected build output at ${indexHtml}`);
}

copyFileSync(indexHtml, resolve(distDir, "404.html"));
mkdirSync(resolve(distDir, "demo"), { recursive: true });
copyFileSync(indexHtml, resolve(distDir, "demo/index.html"));
for (const route of demoAppRoutes) {
  const routeDir = resolve(distDir, "demo", route);
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(indexHtml, resolve(routeDir, "index.html"));
}
writeFileSync(resolve(distDir, ".nojekyll"), "");
