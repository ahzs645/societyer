// Private sub-components/helpers/consts/nav config for Layout.tsx (sidebar, nav groups, safe wrappers).

import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  Calendar,
  CalendarCheck,
  FileText,
  FileJson,
  ClipboardList,
  FolderOpen,
  AlertTriangle,
  PiggyBank,
  Shield,
  Settings,
  Search,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  UsersRound,
  Target,
  ListTodo,
  CalendarClock,
  HelpCircle,
  CreditCard,
  Bell,
  ShieldCheck,
  Eye,
  EyeOff,
  Archive,
  UserCheck,
  Calculator,
  Vote,
  Receipt,
  Gavel,
  PenLine,
  FileCog,
  GitCompare,
  BookOpen,
  Scale,
  Mail,
  Inbox,
  HandHeart,
  BadgeDollarSign,
  Globe,
  Download,
  Database,
  Menu,
  Newspaper,
  ArrowUp,
  ArrowDown,
  Pin,
  PinOff,
  ExternalLink,
  KeyRound,
  History,
  Sliders,
  MonitorPlay,
  Monitor,
  Moon,
  Sun,
  Bot,
  Plug,
  Plus,
} from "lucide-react";
import {
  ComponentType,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { DemoBanner } from "./DemoBanner";
import { CommandPalette } from "./CommandPalette";
import { DraftMinutesPicker } from "./DraftMinutesPicker";
import { GlobalTaskCreate } from "./GlobalTaskCreate";
import { GlobalAssetCreate } from "./GlobalAssetCreate";
import { ShortcutHelp } from "./ShortcutHelp";
import { NotificationBell } from "./NotificationBell";
import { GlobalAiAssistant, openGlobalAiAssistant } from "../features/ai/GlobalAiAssistant";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { UserPicker } from "./UserPicker";
import { InspectorHost, InspectorProvider } from "./InspectorPanel";
import { MenuRow, MenuSectionLabel, Pill, TintedIconTile } from "./ui";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { getRouteIdentity, type IconTone, type LucideIcon } from "../lib/routeIdentity";
import { useStaticCommands } from "../lib/useStaticCommands";
import { useTranslation } from "react-i18next";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { useThemePreference } from "../hooks/useThemePreference";
import { useOperationsDeskVisibility } from "../hooks/useOperationsDeskVisibility";
import { useAiChatVisibility } from "../hooks/useAiChatVisibility";
import type { ThemePreference } from "../lib/theme";
import { applyResolvedTheme } from "../lib/theme";
import { mobileSidebarMediaQuery } from "../lib/breakpoints";
import { DEFAULT_PINNED_ROUTES } from "../lib/navConfig";
import { useUIStore, type PinnedView } from "../lib/store";
import { getDesktopBridge } from "../lib/desktopBridge";
import { useToast } from "./Toast";


function NotificationBellSafe() {
  return (
    <ErrorBoundary label="NotificationBell" fallback={<OfflineBellFallback />}>
      <NotificationBell />
    </ErrorBoundary>
  );
}


function UserPickerSafe() {
  return (
    <ErrorBoundary label="UserPicker" fallback={null}>
      <UserPicker />
    </ErrorBoundary>
  );
}


const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: LucideIcon;
}> = [
  { value: "light", label: "Light mode", Icon: Sun },
  { value: "dark", label: "Dark mode", Icon: Moon },
  { value: "system", label: "System theme", Icon: Monitor },
];


function SidebarThemeToggle() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();

  return (
    <div
      className="sidebar-theme-toggle"
      role="group"
      aria-label="Theme preference"
      title={`Theme: ${preference}${preference === "system" ? ` (${resolvedTheme})` : ""}`}
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={`sidebar-theme-toggle__btn${preference === value ? " is-active" : ""}`}
          onClick={() => setPreference(value)}
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  );
}


function CommandPaletteSafe() {
  return (
    <ErrorBoundary label="CommandPalette" fallback={null}>
      <CommandPalette />
    </ErrorBoundary>
  );
}


function GlobalAiAssistantSafe() {
  return (
    <ErrorBoundary label="GlobalAiAssistant" fallback={null}>
      <GlobalAiAssistant />
    </ErrorBoundary>
  );
}


function WorkbenchPageLoader() {
  return (
    <div className="page" aria-busy="true">
      <div className="page-header">
        <div>
          <div className="skeleton skeleton--line" style={{ width: 180, height: 20, marginBottom: 10 }} />
          <div className="skeleton skeleton--line" style={{ width: 360, maxWidth: "70vw" }} />
        </div>
      </div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((index) => (
          <div className="stat-card" key={index}>
            <div className="skeleton skeleton--line" style={{ width: 88, marginBottom: 12 }} />
            <div className="skeleton skeleton--line" style={{ width: 56, height: 18 }} />
          </div>
        ))}
      </div>
      <div className="table-card">
        <div className="skeleton skeleton--line" style={{ width: 160, height: 18, marginBottom: 16 }} />
        <div className="skeleton skeleton--line" style={{ width: "100%", marginBottom: 10 }} />
        <div className="skeleton skeleton--line" style={{ width: "94%", marginBottom: 10 }} />
        <div className="skeleton skeleton--line" style={{ width: "88%" }} />
      </div>
    </div>
  );
}

// Shown when the notifications query fails (usually a backend that hasn't
// picked up the latest schema, or a stale localStorage userId). Tries to
// self-heal by clearing the stored userId — but does so in an effect, not in
// render, to avoid React's "setState during render" warning.

function OfflineBellFallback() {
  useEffect(() => {
    setStoredUserId(null);
  }, []);
  return (
    <span
      className="sidebar__icon-btn"
      title="Notifications unavailable — backend may be out of sync. Run `npx convex dev`."
      style={{ opacity: 0.4, cursor: "default" }}
    >
      <Bell size={14} />
    </span>
  );
}


type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  color: IconTone;
  end?: boolean;
  module?: ModuleKey;
  entityKinds?: ("society" | "corporation")[];
  permission?: string;
};


type NavGroup = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: NavItem[];
};

/**
 * Resolve a route into a NavItem by reading icon/color/label/module from the
 * single-source-of-truth registry. Throws at module load if a route is missing
 * from the registry — catches typos before the sidebar renders.
 */

function navItem(to: string, end?: boolean): NavItem {
  const id = getRouteIdentity(to);
  if (!id) {
    throw new Error(`routeIdentity: no entry for ${to}. Add it to ROUTE_IDENTITY.`);
  }
  return {
    to,
    label: id.label,
    icon: id.icon,
    color: id.color,
    ...(end ? { end } : {}),
    ...(id.module ? { module: id.module } : {}),
    ...(id.entityKinds ? { entityKinds: id.entityKinds } : {}),
    ...(id.permission ? { permission: id.permission } : {}),
  };
}


const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    defaultOpen: true,
    items: [
      navItem("/app", true),
      navItem("/app/portfolio"),
      navItem("/app/society"),
      navItem("/app/corporate-history"),
      navItem("/app/org-history"),
      navItem("/app/timeline"),
    ],
  },
  {
    id: "people",
    label: "People",
    defaultOpen: true,
    items: [
      navItem("/app/members"),
      navItem("/app/directors"),
      navItem("/app/org-chart"),
      navItem("/app/role-holders"),
      navItem("/app/point-in-time-register"),
      navItem("/app/people-directory"),
      navItem("/app/committees"),
      navItem("/app/volunteers"),
      navItem("/app/employees"),
    ],
  },
  {
    id: "work",
    label: "Work",
    defaultOpen: true,
    items: [
      navItem("/app/goals"),
      navItem("/app/tasks"),
      navItem("/app/deadlines"),
      navItem("/app/commitments"),
      navItem("/app/documents"),
      navItem("/app/document-catalog"),
      navItem("/app/post-incorporation"),
      navItem("/app/library"),
      navItem("/app/communications"),
      navItem("/app/outbox"),
    ],
  },
  {
    id: "meetings",
    label: "Meetings & votes",
    items: [
      navItem("/app/meetings"),
      navItem("/app/meeting-templates"),
      navItem("/app/agendas"),
      navItem("/app/motions"),
      navItem("/app/minutes"),
      navItem("/app/meeting-evidence"),
      navItem("/app/proposals"),
      navItem("/app/elections"),
      navItem("/app/written-resolutions"),
      navItem("/app/proxies"),
    ],
  },
  {
    id: "records",
    label: "Governance records",
    items: [
      navItem("/app/conflicts"),
      navItem("/app/attestations"),
      navItem("/app/auditors"),
      navItem("/app/court-orders"),
      navItem("/app/governance-registers"),
      navItem("/app/rights-ledger"),
      navItem("/app/certificate-register"),
      navItem("/app/dividends"),
      navItem("/app/significant-individuals"),
      navItem("/app/service-providers"),
      navItem("/app/annual-filings"),
      navItem("/app/compliance-settings"),
      navItem("/app/minute-book"),
      navItem("/app/bylaw-rules"),
      navItem("/app/bylaw-diff"),
      navItem("/app/bylaws-history"),
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      navItem("/app/filings"),
      navItem("/app/compliance-obligations"),
      navItem("/app/filings/prefill"),
      navItem("/app/annual-cycle"),
      navItem("/app/formation-maintenance"),
      navItem("/app/policies"),
      navItem("/app/retention"),
      navItem("/app/records-archive"),
      navItem("/app/inspections"),
      navItem("/app/privacy"),
      navItem("/app/pipa-training"),
      navItem("/app/insurance"),
      navItem("/app/access-custody"),
      navItem("/app/transparency"),
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      navItem("/app/financials"),
      navItem("/app/financials/accounting"),
      navItem("/app/financials/year-end"),
      navItem("/app/finance-imports"),
      navItem("/app/treasurer"),
      navItem("/app/assets"),
      navItem("/app/inventory"),
      navItem("/app/grants"),
      navItem("/app/reconciliation"),
      navItem("/app/receipts"),
      navItem("/app/membership"),
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    items: [
      navItem("/app/workflows"),
      navItem("/app/workflow-runs"),
      navItem("/app/calendar-sync"),
    ],
  },
  {
    id: "advanced",
    label: "Advanced setup",
    items: [
      navItem("/app/integrations"),
      navItem("/app/browser-connectors"),
      navItem("/app/ai-agents"),
      navItem("/app/workflow-packages"),
      navItem("/app/template-engine"),
      navItem("/app/paperless"),
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      navItem("/app/notifications"),
      navItem("/app/users"),
      navItem("/app/custom-fields"),
      navItem("/app/imports"),
      navItem("/app/settings"),
      navItem("/app/settings/api-keys"),
      navItem("/app/webhooks"),
      navItem("/app/audit"),
      navItem("/app/exports"),
    ],
  },
];


const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

const ALL_NAV_ITEM_ROUTES = new Set(ALL_NAV_ITEMS.map((item) => item.to));


function isNavItemActive(item: NavItem, pathname: string) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}


function normalizePinnedRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes)) return [...DEFAULT_PINNED_ROUTES];
  const seen = new Set<string>();
  return routes.filter((route): route is string => {
    if (typeof route !== "string") return false;
    if (!ALL_NAV_ITEM_ROUTES.has(route) || seen.has(route)) return false;
    seen.add(route);
    return true;
  });
}


function readStoredPinnedRoutes(): string[] {
  if (isStaticDemoRuntime()) return [...DEFAULT_PINNED_ROUTES];
  try {
    const stored = localStorage.getItem(PINNED_ROUTES_KEY);
    return stored ? normalizePinnedRoutes(JSON.parse(stored)) : [...DEFAULT_PINNED_ROUTES];
  } catch {
    return [...DEFAULT_PINNED_ROUTES];
  }
}


function getPinnedNav(pinnedRoutes: string[]) {
  return pinnedRoutes
    .map((route) => ALL_NAV_ITEMS.find((item) => item.to === route))
    .filter((item): item is NavItem => Boolean(item));
}


function getGroupedNav(pinnedRouteSet: Set<string>) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !pinnedRouteSet.has(item.to)),
    }))
    .filter((group) => group.items.length > 0);
}


function getInitialOpenGroups(pathname: string, pinnedRoutes: string[] = readStoredPinnedRoutes()) {
  const groupedNav = getGroupedNav(new Set(pinnedRoutes));
  return Object.fromEntries(
    groupedNav.map((group) => [
      group.id,
      Boolean(group.defaultOpen || group.items.some((item) => isNavItemActive(item, pathname))),
    ]),
  ) as Record<string, boolean>;
}


const COLLAPSE_KEY = "societyer.sidebar.collapsed";

const SPOTLIGHT_COLLAPSED_KEY = "societyer.sidebar.spotlight.collapsed";

const PINNED_ROUTES_KEY = "societyer.sidebar.pinnedRoutes";

const PINNED_COMMAND_IDS_KEY = "societyer.sidebar.pinnedCommandIds";

const PINNED_FAVORITES_ORDER_KEY = "societyer.sidebar.pinnedFavoritesOrder";

/** A single Favorites slot, regardless of what kind of thing it links to.
 * The unified order array stores these so the user can drag a route between
 * two actions (and vice versa) — kind is preserved per entry but not used
 * for grouping. */

type FavoriteRef =
  | { kind: "route"; id: string } // id = route path
  | { kind: "command"; id: string } // id = action id
  | { kind: "view"; viewsKey: string; viewId: string };


function favoriteRefKey(ref: FavoriteRef): string {
  if (ref.kind === "view") return `view::${ref.viewsKey}::${ref.viewId}`;
  return `${ref.kind}::${ref.id}`;
}


function readStoredPinnedCommandIds(): string[] {
  if (isStaticDemoRuntime()) return [];
  try {
    const stored = localStorage.getItem(PINNED_COMMAND_IDS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((id): id is string => {
      if (typeof id !== "string" || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return [];
  }
}


function readStoredFavoritesOrder(): FavoriteRef[] | null {
  if (isStaticDemoRuntime()) return null;
  try {
    const stored = localStorage.getItem(PINNED_FAVORITES_ORDER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<string>();
    const refs: FavoriteRef[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const kind = (entry as any).kind;
      if (kind === "route" || kind === "command") {
        const id = (entry as any).id;
        if (typeof id !== "string") continue;
        const ref: FavoriteRef = { kind, id };
        const key = favoriteRefKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      } else if (kind === "view") {
        const viewsKey = (entry as any).viewsKey;
        const viewId = (entry as any).viewId;
        if (typeof viewsKey !== "string" || typeof viewId !== "string") continue;
        const ref: FavoriteRef = { kind: "view", viewsKey, viewId };
        const key = favoriteRefKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      }
    }
    return refs;
  } catch {
    return null;
  }
}

const SIDEBAR_MENU_WIDTH = 220;

const SIDEBAR_MENU_HEIGHT = 116;

const NAV_ITEM_LABEL_KEYS: Record<string, string> = {
  Dashboard: "nav.dashboard",
  Society: "nav.society",
  "Org details": "nav.orgDetails",
  "Org history": "nav.orgHistory",
  Timeline: "nav.timeline",
  Members: "nav.members",
  Directors: "nav.directors",
  "Org chart": "nav.orgChart",
  Committees: "nav.committees",
  Volunteers: "nav.volunteers",
  Employees: "nav.employees",
  Goals: "nav.goals",
  Tasks: "nav.tasks",
  Deadlines: "nav.deadlines",
  Commitments: "nav.commitments",
  Documents: "nav.documents",
  Communications: "nav.communications",
  "Meetings": "nav.meetingsItem",
  "Meeting templates": "nav.meetingTemplates",
  "Agendas": "nav.agenda",
  "Motion library": "nav.motionLibrary",
  Minutes: "nav.minutes",
  "Member proposals": "nav.memberProposals",
  Elections: "nav.elections",
  "Written resolutions": "nav.writtenResolutions",
  Proxies: "nav.proxies",
  "Conflicts of int.": "nav.conflicts",
  "Director attestations": "nav.attestations",
  Auditors: "nav.auditors",
  "Court orders": "nav.courtOrders",
  "Minute book": "nav.minuteBook",
  "Bylaw rules": "nav.bylawRules",
  "Bylaw redline": "nav.bylawRedline",
  "Bylaws history": "nav.bylawsHistory",
  Filings: "nav.filings",
  "Filing pre-fill": "nav.filingPrefill",
  "Policy registry": "nav.policies",
  "Records retention": "nav.recordsRetention",
  "Records inspections": "nav.recordsInspections",
  "Privacy (PIPA)": "nav.privacy",
  "PIPA training": "nav.pipaTraining",
  Insurance: "nav.insurance",
  "Access custody": "nav.accessCustody",
  "Public transparency": "nav.transparency",
  Financials: "nav.financials",
  "Year-end reports": "nav.yearEndReports",
  Treasurer: "nav.treasurer",
  Assets: "nav.assets",
  Grants: "nav.grants",
  Reconciliation: "nav.reconciliation",
  "Donation receipts": "nav.donationReceipts",
  "Membership & billing": "nav.membership",
  "Browser apps": "nav.browserConnectors",
  Workflows: "nav.workflows",
  "Workflow runs": "nav.workflowRuns",
  "Workflow packages": "nav.workflowPackages",
  Notifications: "nav.notifications",
  "Users & roles": "nav.users",
  "Import sessions": "nav.importSessions",
  Settings: "nav.settings",
  "Audit log": "nav.auditLog",
  "Data export": "nav.dataExport",
};


type SidebarContextMenu = {
  ref: FavoriteRef;
  label: string;
  top: number;
  left: number;
  /** Target URL for "Open in new tab"; omitted for commands (which have no URL). */
  openInNewTabTarget?: string;
};


function getSidebarMenuPosition(x: number, y: number) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - SIDEBAR_MENU_WIDTH - margin);
  const maxTop = Math.max(margin, window.innerHeight - SIDEBAR_MENU_HEIGHT - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}


function renderNavItem(
  item: NavItem,
  counts: any,
  collapsed: boolean,
  isMobileNav: boolean,
  getLabel: (item: NavItem) => string,
  isPinned: boolean,
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: NavItem) => void,
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>, item: NavItem) => void,
) {
  const Icon = item.icon;
  const count = getCount(item.to, counts);
  const label = getLabel(item);

  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `sidebar__item${isActive ? " is-active" : ""}`}
      data-pinned={isPinned || undefined}
      title={!isMobileNav && collapsed ? label : undefined}
      onContextMenu={(event) => onContextMenu(event, item)}
      onKeyDown={(event) => onKeyDown(event, item)}
    >
      <TintedIconTile tone={item.color} size="sm" className="sidebar__icon-chip">
        <Icon size={14} />
      </TintedIconTile>
      <span className="sidebar__label">{label}</span>
      {count != null && (
        <Pill size="sm" className="sidebar__count">
          {count}
        </Pill>
      )}
    </NavLink>
  );
}


function getCount(to: string, counts: any): number | null {
  if (!counts) return null;
  switch (to) {
    case "/app/members": return counts.members;
    case "/app/directors": return counts.directors;
    case "/app/meetings": return counts.meetingsThisYear;
    case "/app/filings": return counts.overdueFilings || null;
    case "/app/deadlines": return counts.openDeadlines;
    case "/app/conflicts": return counts.openConflicts || null;
    case "/app/committees": return counts.committees || null;
    case "/app/goals": return counts.openGoals || null;
    case "/app/tasks": return counts.openTasks || null;
    default: return null;
  }
}


export {
  NotificationBellSafe,
  UserPickerSafe,
  THEME_OPTIONS,
  SidebarThemeToggle,
  CommandPaletteSafe,
  GlobalAiAssistantSafe,
  WorkbenchPageLoader,
  OfflineBellFallback,
  navItem,
  NAV_GROUPS,
  ALL_NAV_ITEMS,
  ALL_NAV_ITEM_ROUTES,
  isNavItemActive,
  normalizePinnedRoutes,
  readStoredPinnedRoutes,
  getPinnedNav,
  getGroupedNav,
  getInitialOpenGroups,
  COLLAPSE_KEY,
  SPOTLIGHT_COLLAPSED_KEY,
  PINNED_ROUTES_KEY,
  PINNED_COMMAND_IDS_KEY,
  PINNED_FAVORITES_ORDER_KEY,
  favoriteRefKey,
  readStoredPinnedCommandIds,
  readStoredFavoritesOrder,
  SIDEBAR_MENU_WIDTH,
  SIDEBAR_MENU_HEIGHT,
  NAV_ITEM_LABEL_KEYS,
  getSidebarMenuPosition,
  renderNavItem,
  getCount,
};

export type {
  NavItem,
  NavGroup,
  FavoriteRef,
  SidebarContextMenu,
};
