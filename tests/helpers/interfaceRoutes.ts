/** Explicit route coverage, checked against the JSX route tree by the AST drift checker.
 * Missing-record and invalid-token cases deliberately exercise safe unavailable states.
 * Live hosted identities/providers are covered separately and are not implied by this matrix.
 */
export type InterfaceRoute = {
  pattern: string;
  path: string;
  kind: "app" | "public" | "fallback";
  fixture: "seeded" | "missing-record" | "invalid-token" | "route";
  redirectTo?: string;
};
export const INTERFACE_ROUTES: InterfaceRoute[] = [
  { pattern: "/app/meetings/offline", path: "/demo/app/meetings/offline", kind: "app", fixture: "route" },
  {
    "pattern": "/",
    "path": "/",
    "kind": "public",
    "fixture": "route"
  },
  {
    "pattern": "/setup",
    "path": "/demo/setup",
    "kind": "public",
    "fixture": "route"
  },
  {
    "pattern": "/login",
    "path": "/demo/login",
    "kind": "public",
    "fixture": "route"
  },
  {
    "pattern": "/invite/:token",
    "path": "/demo/invite/interface-audit-missing",
    "kind": "public",
    "fixture": "invalid-token"
  },
  {
    "pattern": "/public",
    "path": "/demo/public",
    "kind": "public",
    "fixture": "route"
  },
  {
    "pattern": "/public/:slug",
    "path": "/demo/public/riverside-community-society",
    "kind": "public",
    "fixture": "seeded"
  },
  {
    "pattern": "/portal/:token",
    "path": "/demo/portal/interface-audit-missing",
    "kind": "public",
    "fixture": "invalid-token"
  },
  {
    "pattern": "/public/:slug/volunteer-apply",
    "path": "/demo/public/riverside-community-society/volunteer-apply",
    "kind": "public",
    "fixture": "seeded"
  },
  {
    "pattern": "/public/:slug/grant-apply",
    "path": "/demo/public/riverside-community-society/grant-apply",
    "kind": "public",
    "fixture": "seeded"
  },
  {
    "pattern": "/portal",
    "path": "/demo/portal",
    "kind": "public",
    "fixture": "route"
  },
  {
    "pattern": "/app/society/new",
    "path": "/demo/app/society/new",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app",
    "path": "/demo/app",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/setup",
    "path": "/demo/app/setup",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/society",
    "path": "/demo/app/society",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/organization-details",
    "path": "/demo/app/organization-details",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/role-holders",
    "path": "/demo/app/role-holders",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/point-in-time-register",
    "path": "/demo/app/point-in-time-register",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/significant-individuals",
    "path": "/demo/app/significant-individuals",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/people-directory",
    "path": "/demo/app/people-directory",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/people-history",
    "path": "/demo/app/people-history",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/people-directory/:id",
    "path": "/demo/app/people-directory/interface-audit-missing",
    "kind": "app",
    "fixture": "missing-record"
  },
  {
    "pattern": "/app/dividends",
    "path": "/demo/app/dividends",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/service-providers",
    "path": "/demo/app/service-providers",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/compliance-settings",
    "path": "/demo/app/compliance-settings",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/corporate-history",
    "path": "/demo/app/corporate-history",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/annual-filings",
    "path": "/demo/app/annual-filings",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/certificate-register",
    "path": "/demo/app/certificate-register",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/portfolio",
    "path": "/demo/app/portfolio",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/rights-ledger",
    "path": "/demo/app/rights-ledger",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/template-engine",
    "path": "/demo/app/template-engine",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/formation-maintenance",
    "path": "/demo/app/formation-maintenance",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/org-history",
    "path": "/demo/app/org-history",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/org-history/budgets/:budgetId",
    "path": "/demo/app/org-history/budgets/interface-audit-missing",
    "kind": "app",
    "fixture": "missing-record"
  },
  {
    "pattern": "/app/governance-registers",
    "path": "/demo/app/governance-registers",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meeting-evidence",
    "path": "/demo/app/meeting-evidence",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/finance-imports",
    "path": "/demo/app/finance-imports",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/records-archive",
    "path": "/demo/app/records-archive",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/imports",
    "path": "/demo/app/imports",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/intake",
    "path": "/demo/app/intake",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/intake/:runId/review",
    "path": "/demo/app/intake/interface-audit-missing/review",
    "kind": "app",
    "fixture": "missing-record"
  },
  {
    "pattern": "/app/members",
    "path": "/demo/app/members",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/members/:id",
    "path": "/demo/app/members/static_member_mina",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/directors",
    "path": "/demo/app/directors",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/org-chart",
    "path": "/demo/app/org-chart",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meetings",
    "path": "/demo/app/meetings",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meeting-templates",
    "path": "/demo/app/meeting-templates",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meeting-templates/new",
    "path": "/demo/app/meeting-templates/new",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meeting-templates/:templateId",
    "path": "/demo/app/meeting-templates/static_meeting_template_board",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/meetings/:id",
    "path": "/demo/app/meetings/static_meeting_board_q2",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/meetings/:id/preview",
    "path": "/demo/app/meetings/static_meeting_board_q2/preview",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/minutes",
    "path": "/demo/app/minutes",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/filings",
    "path": "/demo/app/filings",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/compliance-obligations",
    "path": "/demo/app/compliance-obligations",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/research-library",
    "path": "/demo/app/research-library",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/deadlines",
    "path": "/demo/app/deadlines",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/annual-cycle",
    "path": "/demo/app/annual-cycle",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/coverage",
    "path": "/demo/app/coverage",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/source-model-coverage",
    "path": "/demo/app/source-model-coverage",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/documents",
    "path": "/demo/app/documents",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/documents/:id",
    "path": "/demo/app/documents/static_document_bylaws",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/document-catalog",
    "path": "/demo/app/document-catalog",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/post-incorporation",
    "path": "/demo/app/post-incorporation",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/library",
    "path": "/demo/app/library",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/minute-book",
    "path": "/demo/app/minute-book",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/conflicts",
    "path": "/demo/app/conflicts",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/financials",
    "path": "/demo/app/financials",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/financials/accounting",
    "path": "/demo/app/financials/accounting",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/financials/year-end",
    "path": "/demo/app/financials/year-end",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/financials/fy/:fiscalYear",
    "path": "/demo/app/financials/fy/2025-2026",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/financials/wave/account/:resourceId",
    "path": "/demo/app/financials/wave/account/static_wave_account_operating",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/financials/wave/:resourceType/:resourceId",
    "path": "/demo/app/financials/wave/business/static_wave_business_resource",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/financials/wave/:resourceType",
    "path": "/demo/app/financials/wave/account",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/grants",
    "path": "/demo/app/grants",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/grants/sources",
    "path": "/demo/app/grants/sources",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/grants/sources/:libraryKey",
    "path": "/demo/app/grants/sources/cihr-researchnet",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/grants/:id",
    "path": "/demo/app/grants/static_grant",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/agreements",
    "path": "/demo/app/agreements",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/agreements/:id",
    "path": "/demo/app/agreements/static_agreement_lease",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/grants/:id/edit",
    "path": "/demo/app/grants/static_grant/edit",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/privacy",
    "path": "/demo/app/privacy",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/policies",
    "path": "/demo/app/policies",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/communications",
    "path": "/demo/app/communications",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/committees",
    "path": "/demo/app/committees",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/committees/:id",
    "path": "/demo/app/committees/static_committee_finance",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/volunteers",
    "path": "/demo/app/volunteers",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/goals",
    "path": "/demo/app/goals",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/goals/:id",
    "path": "/demo/app/goals/static_goal_agm",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/tasks",
    "path": "/demo/app/tasks",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/commitments",
    "path": "/demo/app/commitments",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/timeline",
    "path": "/demo/app/timeline",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/notifications",
    "path": "/demo/app/notifications",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/users",
    "path": "/demo/app/users",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/audit",
    "path": "/demo/app/audit",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/exports",
    "path": "/demo/app/exports",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/agendas",
    "path": "/demo/app/agendas",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/motions",
    "path": "/demo/app/motions",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/motion-backlog",
    "path": "/demo/app/motion-backlog",
    "kind": "app",
    "fixture": "route",
    "redirectTo": "/demo/app/motions?tab=tabled"
  },
  {
    "pattern": "/app/motion-library",
    "path": "/demo/app/motion-library",
    "kind": "app",
    "fixture": "route",
    "redirectTo": "/demo/app/motions?tab=templates"
  },
  {
    "pattern": "/app/treasurer",
    "path": "/demo/app/treasurer",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/assets",
    "path": "/demo/app/assets",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/inventory",
    "path": "/demo/app/inventory",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/assets/verification/:runId",
    "path": "/demo/app/assets/verification/interface-audit-missing",
    "kind": "app",
    "fixture": "missing-record"
  },
  {
    "pattern": "/app/assets/:id",
    "path": "/demo/app/assets/static_asset_projector",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/membership",
    "path": "/demo/app/membership",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/inspections",
    "path": "/demo/app/inspections",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/attestations",
    "path": "/demo/app/attestations",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/retention",
    "path": "/demo/app/retention",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/insurance",
    "path": "/demo/app/insurance",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/insurance/:id",
    "path": "/demo/app/insurance/static_insurance_do",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/access-custody",
    "path": "/demo/app/access-custody",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/secrets",
    "path": "/demo/app/secrets",
    "kind": "app",
    "fixture": "route",
    "redirectTo": "/demo/app/access-custody"
  },
  {
    "pattern": "/app/pipa-training",
    "path": "/demo/app/pipa-training",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/proxies",
    "path": "/demo/app/proxies",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/auditors",
    "path": "/demo/app/auditors",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/proposals",
    "path": "/demo/app/proposals",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/receipts",
    "path": "/demo/app/receipts",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/employees",
    "path": "/demo/app/employees",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/court-orders",
    "path": "/demo/app/court-orders",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/written-resolutions",
    "path": "/demo/app/written-resolutions",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/meetings/:id/agm",
    "path": "/demo/app/meetings/static_meeting_agm_2025/agm",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/filings/prefill",
    "path": "/demo/app/filings/prefill",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/bylaw-diff",
    "path": "/demo/app/bylaw-diff",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/bylaw-rules",
    "path": "/demo/app/bylaw-rules",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/bylaws-history",
    "path": "/demo/app/bylaws-history",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/elections",
    "path": "/demo/app/elections",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/elections/:id",
    "path": "/demo/app/elections/static_election",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/reconciliation",
    "path": "/demo/app/reconciliation",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/transparency",
    "path": "/demo/app/transparency",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/paperless",
    "path": "/demo/app/paperless",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/browser-connectors",
    "path": "/demo/app/browser-connectors",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/integrations",
    "path": "/demo/app/integrations",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/ai-agents",
    "path": "/demo/app/ai-agents",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/workflows",
    "path": "/demo/app/workflows",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/workflows/:id",
    "path": "/demo/app/workflows/static_workflow_unbc",
    "kind": "app",
    "fixture": "seeded"
  },
  {
    "pattern": "/app/workflow-runs",
    "path": "/demo/app/workflow-runs",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/workflow-packages",
    "path": "/demo/app/workflow-packages",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/calendar-sync",
    "path": "/demo/app/calendar-sync",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/outbox",
    "path": "/demo/app/outbox",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/custom-fields",
    "path": "/demo/app/custom-fields",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/table-field-lab",
    "path": "/demo/app/table-field-lab",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/settings",
    "path": "/demo/app/settings",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/settings/api-keys",
    "path": "/demo/app/settings/api-keys",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "/app/webhooks",
    "path": "/demo/app/webhooks",
    "kind": "app",
    "fixture": "route"
  },
  {
    "pattern": "*",
    "path": "/demo/interface-audit-unknown-route",
    "kind": "fallback",
    "fixture": "route",
    "redirectTo": "/demo"
  }
];
