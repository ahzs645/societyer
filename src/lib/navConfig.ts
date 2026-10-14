/**
 * Navigation defaults. Kept in config (not hardcoded in Layout.tsx) so the
 * default pinned sidebar items can be tuned per-tenant without touching UI code.
 */
import {
  BookMarked,
  Building2,
  Calendar,
  FileCheck,
  FolderOpen,
  ListTodo,
  Package,
  PiggyBank,
  Scale,
  Settings,
  Shield,
  Users,
  Vote,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";

export const DEFAULT_PINNED_ROUTES: readonly string[] = [
  "/app",
  "/app/annual-cycle",
  "/app/compliance-obligations",
  "/app/tasks",
  "/app/deadlines",
  "/app/commitments",
  "/app/meetings",
  "/app/documents",
  "/app/assets",
  "/app/integrations",
  "/app/ai-agents",
  "/app/transparency",
];

type NavIcon = ComponentType<{ size?: number | string }>;

/** One child row of a nav parent: a route path, optionally relabelled inside the tree. */
export type NavChildConfig = string | { to: string; label?: string; end?: boolean };

/**
 * The sidebar's two-level structure. Top-level entries are either a single
 * route (`item`) or a parent that folds related pages under one row
 * (`parent`). Every route's icon, colour, label and module/permission/entity
 * gates still come from `ROUTE_IDENTITY`; this file only decides where a page
 * sits. Route paths never change here.
 */
export type NavTreeConfigEntry =
  | { kind: "item"; to: string; end?: boolean }
  | {
      kind: "parent";
      id: string;
      label: string;
      /** i18n key for the parent label; falls back to `label`. */
      i18nKey?: string;
      icon: NavIcon;
      children: NavChildConfig[];
      /** Expanded the first time the desktop sidebar renders. */
      defaultOpen?: boolean;
    };

/**
 * Routes that may not exist in every build. The sidebar skips them quietly
 * instead of failing at load.
 */
export const OPTIONAL_NAV_ROUTES: ReadonlySet<string> = new Set<string>([]);

export const NAV_TREE: readonly NavTreeConfigEntry[] = [
  { kind: "item", to: "/app", end: true },
  { kind: "item", to: "/app/portfolio" },
  {
    kind: "parent",
    id: "organization",
    label: "Organization",
    icon: Building2,
    children: ["/app/society", "/app/corporate-history", "/app/org-history", "/app/timeline"],
  },
  {
    kind: "parent",
    id: "people",
    label: "People",
    i18nKey: "nav.people",
    icon: Users,
    defaultOpen: true,
    children: [
      "/app/members",
      "/app/directors",
      "/app/role-holders",
      "/app/committees",
      "/app/people-directory",
      "/app/org-chart",
      "/app/point-in-time-register",
      "/app/people-history",
      "/app/volunteers",
      "/app/employees",
    ],
  },
  {
    kind: "parent",
    id: "work",
    label: "Work",
    i18nKey: "nav.work",
    icon: ListTodo,
    children: [
      "/app/tasks",
      "/app/goals",
      "/app/deadlines",
      "/app/commitments",
      "/app/post-incorporation",
      "/app/communications",
      "/app/outbox",
    ],
  },
  {
    kind: "parent",
    id: "documents",
    label: "Documents & records",
    icon: FolderOpen,
    children: [
      "/app/documents",
      "/app/document-catalog",
      "/app/library",
      "/app/minute-book",
      "/app/records-archive",
    ],
  },
  {
    kind: "parent",
    id: "meetings",
    label: "Meetings",
    i18nKey: "nav.meetingsItem",
    icon: Calendar,
    children: [
      "/app/meetings",
      "/app/agendas",
      "/app/minutes",
      "/app/motions",
      "/app/meeting-templates",
      "/app/meeting-evidence",
    ],
  },
  {
    kind: "parent",
    id: "votes",
    label: "Votes & resolutions",
    icon: Vote,
    children: ["/app/elections", "/app/written-resolutions", "/app/proxies", "/app/proposals"],
  },
  {
    kind: "parent",
    id: "records",
    label: "Governance records",
    i18nKey: "nav.records",
    icon: Scale,
    children: [
      "/app/governance-registers",
      "/app/rights-ledger",
      "/app/certificate-register",
      "/app/significant-individuals",
      "/app/conflicts",
      "/app/attestations",
      "/app/auditors",
      "/app/court-orders",
      "/app/service-providers",
    ],
  },
  {
    kind: "parent",
    id: "rules",
    label: "Governing rules",
    icon: BookMarked,
    children: ["/app/bylaw-rules", "/app/bylaw-diff", "/app/bylaws-history"],
  },
  {
    kind: "parent",
    id: "compliance",
    label: "Compliance",
    i18nKey: "nav.compliance",
    icon: FileCheck,
    children: [
      "/app/compliance-obligations",
      "/app/annual-cycle",
      "/app/filings",
      "/app/annual-filings",
      "/app/filings/prefill",
      "/app/formation-maintenance",
      "/app/compliance-settings",
      "/app/coverage",
      "/app/research-library",
    ],
  },
  {
    kind: "parent",
    id: "policies",
    label: "Policies & privacy",
    icon: Shield,
    children: [
      "/app/policies",
      "/app/privacy",
      "/app/pipa-training",
      "/app/retention",
      "/app/inspections",
      "/app/insurance",
      "/app/access-custody",
      "/app/transparency",
    ],
  },
  {
    kind: "parent",
    id: "finance",
    label: "Finance",
    i18nKey: "nav.finance",
    icon: PiggyBank,
    children: [
      { to: "/app/financials", label: "Overview", end: true },
      "/app/treasurer",
      "/app/invoices",
      "/app/financials/accounting",
      "/app/reconciliation",
      "/app/approvals",
      "/app/transaction-rules",
      "/app/financials/year-end",
      "/app/finance-imports",
      "/app/grants",
      "/app/receipts",
      "/app/membership",
      "/app/dividends",
      "/app/agreements",
    ],
  },
  {
    kind: "parent",
    id: "assets",
    label: "Assets",
    icon: Package,
    children: ["/app/assets", "/app/inventory"],
  },
  {
    kind: "parent",
    id: "automation",
    label: "Automation",
    icon: Workflow,
    children: [
      "/app/workflows",
      "/app/workflow-runs",
      "/app/calendar-sync",
      "/app/integrations",
      "/app/browser-connectors",
      "/app/ai-agents",
      "/app/workflow-packages",
      "/app/template-engine",
      "/app/paperless",
    ],
  },
  {
    kind: "parent",
    id: "administration",
    label: "Administration",
    i18nKey: "nav.administration",
    icon: Settings,
    children: [
      "/app/settings",
      "/app/users",
      "/app/notifications",
      "/app/custom-fields",
      "/app/imports",
      "/app/intake",
      "/app/settings/api-keys",
      "/app/webhooks",
      "/app/audit",
      "/app/exports",
    ],
  },
];

/** The parent that collects any registered finance page not placed above. */
export const FINANCE_PARENT_ID = "finance";
