/**
 * Single source of truth for the icon, color, and group every nav route
 * belongs to. Both the sidebar (`Layout.tsx`) and the page-level headers
 * (`PageHeader`, `SettingsShell`) read from here, so a route's visual
 * identity is defined in exactly one place — no more sidebar/page drift.
 *
 * Color rule (Suggestion B): color = nav group identity. Every route in a
 * given group uses that group's tone, so the color tells you which area of
 * the app you're in. Add a new route by appending it to ROUTE_IDENTITY and
 * threading it into NAV_GROUPS in Layout.tsx; you don't choose a color.
 *
 * If a route legitimately shouldn't follow its group's tone (rare), pass an
 * `iconColor` override to PageHeader/SettingsShell explicitly.
 */
import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  BadgeDollarSign,
  Bell,
  BookKey,
  BookMarked,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Database,
  Download,
  Eye,
  FileCheck,
  FileCog,
  FileJson,
  FileText,
  FolderOpen,
  Gavel,
  GitCompare,
  Globe,
  HandHeart,
  History,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  Lightbulb,
  ListOrdered,
  ListTodo,
  Mail,
  MonitorPlay,
  Network,
  Newspaper,
  Paperclip,
  PenLine,
  PiggyBank,
  Plug,
  Receipt,
  Scale,
  Scroll,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Target,
  Timer,
  Umbrella,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  Vote,
  Workflow,
  Hourglass,
  Construction,
  FolderKanban,
  
} from "lucide-react";
import type { ComponentType } from "react";
import type { ModuleKey } from "./modules";

export type RouteGroup =
  | "workspace"
  | "people"
  | "work"
  | "meetings"
  | "records"
  | "compliance"
  | "finance"
  | "workflows"
  | "administration";

export type IconTone =
  | "blue"
  | "red"
  | "turquoise"
  | "gray"
  | "orange"
  | "purple"
  | "green"
  | "pink"
  | "yellow";

/** Color-per-group palette. 1:1 so the tone uniquely identifies the area. */
export const GROUP_TONES: Record<RouteGroup, IconTone> = {
  workspace: "blue",
  people: "pink",
  work: "turquoise",
  meetings: "orange",
  records: "purple",
  compliance: "green",
  finance: "yellow",
  workflows: "gray",
  administration: "red",
};

/**
 * Tone name → CSS color value. The single mapping from our `IconTone` strings
 * to the actual `--{tone}-11` design-token variables. Any component that needs
 * to apply a route's color in a non-class-based way (e.g. setting a CSS
 * custom property inline) should call this so we never duplicate the mapping
 * in SCSS files.
 */
export const TONE_CSS_VAR: Record<IconTone, string> = {
  blue: "var(--blue-11)",
  red: "var(--red-11)",
  turquoise: "var(--turquoise-11)",
  gray: "var(--gray-11)",
  orange: "var(--orange-11)",
  purple: "var(--purple-11)",
  green: "var(--green-11)",
  pink: "var(--pink-11)",
  yellow: "var(--yellow-11)",
};

/** Resolve a route group to the CSS variable expression for its tone. */
export function groupToneCssVar(group: RouteGroup): string {
  return TONE_CSS_VAR[GROUP_TONES[group]];
}

export type LucideIcon = ComponentType<{ size?: number | string }>;

export type RouteIdentity = {
  icon: LucideIcon;
  group: RouteGroup;
  /** Default label; sidebar may override via i18n. */
  label: string;
  /** Optional module gate; page is hidden when the module is disabled. */
  module?: ModuleKey;
};

/** Path → identity. Add new pages here. Keys are exact router paths. */
export const ROUTE_IDENTITY: Record<string, RouteIdentity> = {
  // ---- Workspace ----
  "/app": { icon: LayoutDashboard, group: "workspace", label: "Dashboard" },
  "/app/society": { icon: Building2, group: "workspace", label: "Society" },
  "/app/organization-details": { icon: Info, group: "workspace", label: "Org details" },
  "/app/org-history": { icon: Newspaper, group: "workspace", label: "Org history" },
  "/app/timeline": { icon: Hourglass, group: "workspace", label: "Timeline" },

  // ---- People ----
  "/app/members": { icon: Users, group: "people", label: "Members" },
  "/app/directors": { icon: UserCog, group: "people", label: "Directors" },
  "/app/org-chart": { icon: Network, group: "people", label: "Org chart" },
  "/app/role-holders": { icon: UsersRound, group: "people", label: "Role holders" },
  "/app/committees": { icon: Network, group: "people", label: "Committees" },
  "/app/volunteers": { icon: HandHeart, group: "people", label: "Volunteers", module: "volunteers" },
  "/app/employees": { icon: Briefcase, group: "people", label: "Employees", module: "employees" },

  // ---- Work ----
  "/app/goals": { icon: Target, group: "work", label: "Goals" },
  "/app/tasks": { icon: ListTodo, group: "work", label: "Tasks" },
  "/app/deadlines": { icon: CalendarClock, group: "work", label: "Deadlines" },
  "/app/commitments": { icon: ClipboardList, group: "work", label: "Commitments" },
  "/app/documents": { icon: FolderOpen, group: "work", label: "Documents" },
  "/app/library": { icon: BookOpen, group: "work", label: "Library" },
  "/app/communications": { icon: Mail, group: "work", label: "Communications", module: "communications" },
  "/app/outbox": { icon: Inbox, group: "work", label: "Outbox" },

  // ---- Meetings & votes ----
  "/app/meetings": { icon: Calendar, group: "meetings", label: "Meetings" },
  "/app/meeting-templates": { icon: BookMarked, group: "meetings", label: "Meeting templates" },
  "/app/agendas": { icon: ListOrdered, group: "meetings", label: "Agendas" },
  "/app/motion-backlog": { icon: Layers, group: "meetings", label: "Motion backlog" },
  "/app/motion-library": { icon: BookOpen, group: "meetings", label: "Motion library" },
  "/app/minutes": { icon: FileText, group: "meetings", label: "Minutes" },
  "/app/meeting-evidence": { icon: Paperclip, group: "meetings", label: "Meeting evidence" },
  "/app/proposals": { icon: Lightbulb, group: "meetings", label: "Member proposals", module: "voting" },
  "/app/elections": { icon: Vote, group: "meetings", label: "Elections", module: "voting" },
  "/app/written-resolutions": { icon: PenLine, group: "meetings", label: "Written resolutions", module: "voting" },
  "/app/proxies": { icon: UserCheck, group: "meetings", label: "Proxies", module: "voting" },

  // ---- Governance records ----
  "/app/conflicts": { icon: AlertTriangle, group: "records", label: "Conflicts of int." },
  "/app/attestations": { icon: ShieldCheck, group: "records", label: "Director attestations", module: "attestations" },
  "/app/auditors": { icon: Calculator, group: "records", label: "Auditors", module: "auditors" },
  "/app/court-orders": { icon: Gavel, group: "records", label: "Court orders", module: "courtOrders" },
  "/app/governance-registers": { icon: Scale, group: "records", label: "Governance registers" },
  "/app/rights-ledger": { icon: BookKey, group: "records", label: "Rights ledger" },
  "/app/minute-book": { icon: BookOpen, group: "records", label: "Minute book" },
  "/app/bylaw-rules": { icon: BookMarked, group: "records", label: "Bylaw rules" },
  "/app/bylaw-diff": { icon: GitCompare, group: "records", label: "Bylaw redline" },
  "/app/bylaws-history": { icon: Scroll, group: "records", label: "Bylaws history" },

  // ---- Compliance ----
  "/app/filings": { icon: FileCheck, group: "compliance", label: "Filings" },
  "/app/filings/prefill": { icon: FileCog, group: "compliance", label: "Filing pre-fill", module: "filingPrefill" },
  "/app/annual-cycle": { icon: CalendarCheck, group: "compliance", label: "Annual cycle" },
  "/app/formation-maintenance": { icon: Construction, group: "compliance", label: "Formation & annual" },
  "/app/policies": { icon: FileText, group: "compliance", label: "Policies" },
  "/app/retention": { icon: Timer, group: "compliance", label: "Records retention", module: "recordsInspection" },
  "/app/records-archive": { icon: Archive, group: "compliance", label: "Records archive" },
  "/app/inspections": { icon: Eye, group: "compliance", label: "Records inspections", module: "recordsInspection" },
  "/app/privacy": { icon: Shield, group: "compliance", label: "Privacy (PIPA)" },
  "/app/pipa-training": { icon: ShieldCheck, group: "compliance", label: "PIPA training", module: "pipaTraining" },
  "/app/insurance": { icon: Umbrella, group: "compliance", label: "Insurance", module: "insurance" },
  "/app/access-custody": { icon: KeyRound, group: "compliance", label: "Access custody", module: "secrets" },
  "/app/transparency": { icon: Globe, group: "compliance", label: "Public transparency", module: "transparency" },

  // ---- Finance ----
  "/app/financials": { icon: PiggyBank, group: "finance", label: "Financials" },
  "/app/finance-imports": { icon: ArrowDownToLine, group: "finance", label: "Finance imports" },
  "/app/treasurer": { icon: Landmark, group: "finance", label: "Treasurer" },
  "/app/grants": { icon: BadgeDollarSign, group: "finance", label: "Grants", module: "grants" },
  "/app/reconciliation": { icon: Scale, group: "finance", label: "Reconciliation", module: "reconciliation" },
  "/app/receipts": { icon: Receipt, group: "finance", label: "Donation receipts", module: "donationReceipts" },
  "/app/membership": { icon: CreditCard, group: "finance", label: "Membership & billing", module: "membershipBilling" },

  // ---- Workflows ----
  "/app/integrations": { icon: Plug, group: "workflows", label: "Integrations", module: "workflows" },
  "/app/browser-connectors": { icon: MonitorPlay, group: "workflows", label: "Browser apps", module: "browserConnectors" },
  "/app/ai-agents": { icon: Bot, group: "workflows", label: "AI agents" },
  "/app/workflows": { icon: Workflow, group: "workflows", label: "Workflows", module: "workflows" },
  "/app/workflow-runs": { icon: History, group: "workflows", label: "Workflow runs", module: "workflows" },
  "/app/workflow-packages": { icon: FolderKanban, group: "workflows", label: "Workflow packages", module: "workflows" },
  "/app/template-engine": { icon: FileCog, group: "workflows", label: "Template engine" },

  // ---- Administration ----
  "/app/notifications": { icon: Bell, group: "administration", label: "Notifications" },
  "/app/users": { icon: UserCog, group: "administration", label: "Users & roles" },
  "/app/custom-fields": { icon: Sliders, group: "administration", label: "Custom fields" },
  "/app/imports": { icon: FileJson, group: "administration", label: "Import sessions" },
  "/app/paperless": { icon: Database, group: "administration", label: "Paperless-ngx", module: "paperless" },
  "/app/settings": { icon: Settings, group: "administration", label: "Settings" },
  "/app/audit": { icon: ShieldCheck, group: "administration", label: "Audit log" },
  "/app/exports": { icon: Download, group: "administration", label: "Data export" },
};

export type ResolvedRouteIdentity = RouteIdentity & { color: IconTone };

/**
 * Look up a route's identity. Returns null for unknown paths so callers can
 * decide whether to fall back to manually-supplied props or skip rendering.
 */
export function getRouteIdentity(path: string): ResolvedRouteIdentity | null {
  const id = ROUTE_IDENTITY[path];
  if (!id) return null;
  return { ...id, color: GROUP_TONES[id.group] };
}

/**
 * Resolve a pathname to its identity, falling back to the nearest registered
 * ancestor route. So `/app/meetings/abc123/edit` resolves to `/app/meetings`
 * — which means detail pages and sub-routes inherit their parent section's
 * icon and color without needing their own registry entry.
 */
export function resolveRouteIdentity(pathname: string): ResolvedRouteIdentity | null {
  const direct = getRouteIdentity(pathname);
  if (direct) return direct;
  const segments = pathname.split("/").filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const candidate = "/" + segments.join("/");
    const ancestor = ROUTE_IDENTITY[candidate];
    if (ancestor) return { ...ancestor, color: GROUP_TONES[ancestor.group] };
  }
  return null;
}
