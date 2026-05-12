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
import type { ThemePreference } from "../lib/theme";
import { mobileSidebarMediaQuery } from "../lib/breakpoints";
import { DEFAULT_PINNED_ROUTES } from "../lib/navConfig";
import { useUIStore } from "../lib/store";

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
  };
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    defaultOpen: true,
    items: [
      navItem("/app", true),
      navItem("/app/society"),
      navItem("/app/organization-details"),
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
      navItem("/app/motion-backlog"),
      navItem("/app/motion-library"),
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
      navItem("/app/finance-imports"),
      navItem("/app/treasurer"),
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
      navItem("/app/integrations"),
      navItem("/app/browser-connectors"),
      navItem("/app/ai-agents"),
      navItem("/app/workflows"),
      navItem("/app/workflow-runs"),
      navItem("/app/workflow-packages"),
      navItem("/app/template-engine"),
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
      navItem("/app/paperless"),
      navItem("/app/settings"),
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
  Treasurer: "nav.treasurer",
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
  item: NavItem;
  label: string;
  top: number;
  left: number;
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

export function Layout() {
  const { society, societies } = useSocietySelection();
  const { t } = useTranslation();
  const loc = useLocation();
  const navigate = useNavigate();
  const [isMobileNav, setIsMobileNav] = useState(() =>
    window.matchMedia(mobileSidebarMediaQuery).matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => !isStaticDemoRuntime() && localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const [spotlightCollapsed, setSpotlightCollapsed] = useState(
    () => !isStaticDemoRuntime() && localStorage.getItem(SPOTLIGHT_COLLAPSED_KEY) === "1",
  );
  const [pinnedRoutes, setPinnedRoutes] = useState(readStoredPinnedRoutes);
  const [pinnedCommandIds, setPinnedCommandIds] = useState(readStoredPinnedCommandIds);
  // Unified favorites order — single source of truth for sidebar ordering.
  // Lazy-initialized from the existing kind arrays the first time the user
  // loads after this feature ships (migration). Subsequent edits write here
  // directly; the kind arrays remain in sync for the existing isPinned
  // checks scattered through the codebase.
  const [favoritesOrder, setFavoritesOrder] = useState<FavoriteRef[]>(() => {
    const stored = readStoredFavoritesOrder();
    if (stored) return stored;
    return readStoredPinnedRoutes()
      .map<FavoriteRef>((id) => ({ kind: "route", id }))
      .concat(readStoredPinnedCommandIds().map<FavoriteRef>((id) => ({ kind: "command", id })));
    // Views aren't included in the initial migration because they live in
    // zustand and need to be appended once that store is read in render.
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => getInitialOpenGroups(window.location.pathname),
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceAnchor, setWorkspaceAnchor] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [navContextMenu, setNavContextMenu] = useState<SidebarContextMenu | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const navContextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Keep the active route's sidebar group open as the user navigates. We only
  // force-open — never auto-close — so user-collapsed groups stay that way.
  useEffect(() => {
    const groupedNav = getGroupedNav(new Set(pinnedRoutes));
    const activeGroup = groupedNav.find((group) =>
      group.items.some((item) => isNavItemActive(item, loc.pathname)),
    );
    if (!activeGroup) return;
    setOpenGroups((prev) => (prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }));
  }, [loc.pathname, pinnedRoutes]);

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    localStorage.setItem(SPOTLIGHT_COLLAPSED_KEY, spotlightCollapsed ? "1" : "0");
  }, [spotlightCollapsed]);

  // Persist + notify only on actual changes. The deduplicating check breaks
  // the ping-pong between sidebar and palette: when the palette writes a new
  // value and dispatches the sync event, the sidebar listener echoes the value
  // into state, which would otherwise re-fire this effect, write the same
  // value again, and dispatch another event — a loop.
  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    const serialized = JSON.stringify(pinnedRoutes);
    if (localStorage.getItem(PINNED_ROUTES_KEY) === serialized) return;
    localStorage.setItem(PINNED_ROUTES_KEY, serialized);
    window.dispatchEvent(new Event("kbar:pinned-changed"));
  }, [pinnedRoutes]);

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    const serialized = JSON.stringify(pinnedCommandIds);
    if (localStorage.getItem(PINNED_COMMAND_IDS_KEY) === serialized) return;
    localStorage.setItem(PINNED_COMMAND_IDS_KEY, serialized);
    window.dispatchEvent(new Event("kbar:pinned-changed"));
  }, [pinnedCommandIds]);

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    const serialized = JSON.stringify(favoritesOrder);
    if (localStorage.getItem(PINNED_FAVORITES_ORDER_KEY) === serialized) return;
    localStorage.setItem(PINNED_FAVORITES_ORDER_KEY, serialized);
  }, [favoritesOrder]);

  // Reconcile the unified order whenever any kind store changes. Add new
  // pins (e.g. ones created elsewhere), drop unpins, leave existing order
  // intact. Views are appended on first appearance and removed when they
  // disappear from the zustand store.
  const pinnedViews = useUIStore((s) => s.pinnedViews);
  useEffect(() => {
    setFavoritesOrder((prev) => {
      const seen = new Set(prev.map(favoriteRefKey));
      const filtered = prev.filter((ref) => {
        if (ref.kind === "route") return pinnedRoutes.includes(ref.id);
        if (ref.kind === "command") return pinnedCommandIds.includes(ref.id);
        return pinnedViews.some((v) => v.viewsKey === ref.viewsKey && v.viewId === ref.viewId);
      });
      const additions: FavoriteRef[] = [];
      for (const id of pinnedRoutes) {
        const ref: FavoriteRef = { kind: "route", id };
        if (!seen.has(favoriteRefKey(ref))) additions.push(ref);
      }
      for (const id of pinnedCommandIds) {
        const ref: FavoriteRef = { kind: "command", id };
        if (!seen.has(favoriteRefKey(ref))) additions.push(ref);
      }
      for (const view of pinnedViews) {
        const ref: FavoriteRef = { kind: "view", viewsKey: view.viewsKey, viewId: view.viewId };
        if (!seen.has(favoriteRefKey(ref))) additions.push(ref);
      }
      if (filtered.length === prev.length && additions.length === 0) return prev;
      return [...filtered, ...additions];
    });
  }, [pinnedRoutes, pinnedCommandIds, pinnedViews]);

  // Cross-component sync: if the palette pins/unpins from its own context
  // menu, the new localStorage value triggers a `storage` event in other tabs
  // but NOT in the same tab. We listen for our own custom event so the sidebar
  // reacts immediately. Both routes and commands can be pinned from the palette
  // now, so we re-read both stores on the same event.
  useEffect(() => {
    const onPinChange = () => {
      setPinnedCommandIds(readStoredPinnedCommandIds());
      setPinnedRoutes(readStoredPinnedRoutes());
    };
    window.addEventListener("kbar:pinned-changed", onPinChange);
    return () => window.removeEventListener("kbar:pinned-changed", onPinChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(mobileSidebarMediaQuery);
    const onChange = (event: MediaQueryListEvent) => setIsMobileNav(event.matches);
    setIsMobileNav(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (isMobileNav) {
          setMobileSidebarOpen((v) => !v);
        } else {
          setCollapsed((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileNav]);

  useEffect(() => {
    if (isMobileNav) {
      setMobileSidebarOpen(false);
    }
  }, [isMobileNav, loc.pathname]);

  useEffect(() => {
    if (!isMobileNav || !mobileSidebarOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const main = mainRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    main?.setAttribute("aria-hidden", "true");
    if (main) main.inert = true;
    setTimeout(() => {
      sidebarRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      main?.removeAttribute("aria-hidden");
      if (main) main.inert = false;
      previousFocus?.focus?.();
    };
  }, [isMobileNav, mobileSidebarOpen]);

  useEffect(() => {
    const groupedNav = getGroupedNav(new Set(pinnedRoutes));
    const activeGroup = groupedNav.find((group) =>
      group.items.some((item) => isNavItemActive(item, loc.pathname)),
    );
    if (!activeGroup) return;
    setOpenGroups((prev) => (prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }));
  }, [loc.pathname, pinnedRoutes]);

  useEffect(() => {
    if (!workspaceOpen) return;
    const place = () => {
      const rect = workspaceButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 6;
      const width = Math.min(320, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
      if (left < margin) left = margin;
      const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
      const spaceAbove = rect.top - margin - gap;
      const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
      if (openUpward) {
        const maxHeight = Math.max(180, Math.min(360, spaceAbove));
        setWorkspaceAnchor({ bottom: window.innerHeight - rect.top + gap, left, width, maxHeight });
      } else {
        const maxHeight = Math.max(180, Math.min(360, spaceBelow));
        setWorkspaceAnchor({ top: rect.bottom + gap, left, width, maxHeight });
      }
    };
    place();
    const onDown = (e: MouseEvent) => {
      if (workspaceMenuRef.current?.contains(e.target as Node)) return;
      if (workspaceButtonRef.current?.contains(e.target as Node)) return;
      setWorkspaceOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [workspaceOpen]);

  useEffect(() => {
    if (!navContextMenu) return;
    const onDown = (event: MouseEvent) => {
      if (navContextMenuRef.current?.contains(event.target as Node)) return;
      setNavContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavContextMenu(null);
    };
    const close = () => setNavContextMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [navContextMenu]);

  const counts = useQuery(api.dashboard.navCounts, society ? { societyId: society._id } : "skip");
  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes]);
  const pinnedNav = useMemo(() => getPinnedNav(pinnedRoutes), [pinnedRoutes]);
  const groupedNav = useMemo(() => getGroupedNav(pinnedRouteSet), [pinnedRouteSet]);
  const visiblePinnedNav = useMemo(
    () => pinnedNav.filter((item) => !item.module || isModuleEnabled(society, item.module)),
    [pinnedNav, society],
  );

  // Resolve pinned command IDs into runnable commands. Commands whose ID isn't
  // in the static registry (e.g. removed in a later release) are quietly
  // dropped — the pin stays in localStorage but renders as nothing.
  const staticCommands = useStaticCommands();
  const visiblePinnedCommands = useMemo(() => {
    const byId = new Map(staticCommands.map((command) => [command.id, command]));
    return pinnedCommandIds
      .map((id) => byId.get(id))
      .filter((command): command is NonNullable<typeof command> => Boolean(command))
      .filter((command) => !command.module || isModuleEnabled(society, command.module));
  }, [staticCommands, pinnedCommandIds, society]);
  const visibleGroupedNav = useMemo(
    () =>
      groupedNav.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.module || isModuleEnabled(society, item.module)),
      })).filter((group) => group.items.length > 0),
    [groupedNav, society],
  );
  const getNavItemLabel = (item: NavItem) => t(NAV_ITEM_LABEL_KEYS[item.label] ?? item.label, item.label);
  const isSidebarCollapsed = isMobileNav ? !mobileSidebarOpen : collapsed;
  const shellClassName = useMemo(() => {
    let value = "app-shell";
    if (isSidebarCollapsed) value += " is-collapsed";
    if (isMobileNav) value += " is-mobile";
    if (isMobileNav && mobileSidebarOpen) value += " is-mobile-nav-open";
    return value;
  }, [isMobileNav, isSidebarCollapsed, mobileSidebarOpen]);

  const openSidebar = () => {
    if (isMobileNav) {
      setMobileSidebarOpen(true);
    } else {
      setCollapsed(false);
    }
  };

  const toggleSidebar = () => {
    if (isMobileNav) {
      setMobileSidebarOpen((v) => !v);
    } else {
      setCollapsed((v) => !v);
    }
  };

  const togglePinnedRoute = (item: NavItem) => {
    setPinnedRoutes((prev) => {
      if (prev.includes(item.to)) return prev.filter((route) => route !== item.to);
      return normalizePinnedRoutes([...prev, item.to]);
    });
    setNavContextMenu(null);
  };

  // Index-based drag for favorites. Items intermingle across kinds; the drop
  // index is the insertion point in the unified `favoritesOrder` array
  // (0 = before the first row, `length` = after the last row).
  const [favoriteDragIndex, setFavoriteDragIndex] = useState<number | null>(null);
  const [favoriteDropIndex, setFavoriteDropIndex] = useState<number | null>(null);

  const updateDropIndex = (targetIndex: number) => {
    if (favoriteDragIndex === null) return;
    // Dropping back into the source slot or the slot immediately after it
    // is a no-op — clear the indicator so the user knows nothing happens.
    if (targetIndex === favoriteDragIndex || targetIndex === favoriteDragIndex + 1) {
      if (favoriteDropIndex !== null) setFavoriteDropIndex(null);
      return;
    }
    if (favoriteDropIndex !== targetIndex) setFavoriteDropIndex(targetIndex);
  };

  const onFavoriteDragStart = (index: number) => (event: ReactDragEvent) => {
    event.dataTransfer.effectAllowed = "move";
    // Required for Firefox to actually start the drag.
    event.dataTransfer.setData("text/plain", String(index));
    setFavoriteDragIndex(index);
  };

  const onFavoriteDragOver = (rowIndex: number) => (event: ReactDragEvent) => {
    if (favoriteDragIndex === null) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const isTopHalf = event.clientY < rect.top + rect.height / 2;
    updateDropIndex(isTopHalf ? rowIndex : rowIndex + 1);
  };

  const onFavoriteEndZoneDragOver = (event: ReactDragEvent) => {
    if (favoriteDragIndex === null) return;
    event.preventDefault();
    updateDropIndex(favoritesOrder.length);
  };

  const onFavoriteDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    const fromIndex = favoriteDragIndex;
    const dropIndex = favoriteDropIndex;
    setFavoriteDragIndex(null);
    setFavoriteDropIndex(null);
    if (fromIndex === null || dropIndex === null) return;
    setFavoritesOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      let toIndex = dropIndex;
      // Splice removes the source first, so any insertion point after it
      // shifts down by one.
      if (fromIndex < toIndex) toIndex -= 1;
      if (fromIndex === toIndex) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
      return next;
    });
  };

  const onFavoriteDragEnd = () => {
    setFavoriteDragIndex(null);
    setFavoriteDropIndex(null);
  };

  const moveFavoriteByIndex = (fromIndex: number, direction: -1 | 1) => {
    setFavoritesOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      const target = fromIndex + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const openNavContextMenu = (item: NavItem, x: number, y: number) => {
    const position = getSidebarMenuPosition(x, y);
    setNavContextMenu({
      item,
      label: getNavItemLabel(item),
      top: position.top,
      left: position.left,
    });
    setWorkspaceOpen(false);
  };

  const handleNavItemContextMenu = (event: ReactMouseEvent<HTMLElement>, item: NavItem) => {
    event.preventDefault();
    event.stopPropagation();
    openNavContextMenu(item, event.clientX, event.clientY);
  };

  const handleNavItemKeyDown = (event: ReactKeyboardEvent<HTMLElement>, item: NavItem) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openNavContextMenu(item, rect.left + 28, rect.bottom - 2);
  };

  const openNavItemInNewTab = (item: NavItem) => {
    window.open(item.to, "_blank", "noopener,noreferrer");
    setNavContextMenu(null);
  };

  return (
    <InspectorProvider>
      <CommandPaletteSafe />
      <DraftMinutesPicker />
      <ShortcutHelp />
      <div className={shellClassName}>
        {isMobileNav && mobileSidebarOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label={t("sidebar.closeNavigation")}
          />
        )}
        <button
          className="sidebar-peek"
          onClick={openSidebar}
          title={isMobileNav ? t("sidebar.openNavigation") : `${t("sidebar.openSidebar")} (⌘\\)`}
          aria-label={isMobileNav ? t("sidebar.openNavigation") : t("sidebar.openSidebar")}
        >
          <PanelLeftOpen size={14} />
        </button>
        <aside className="sidebar" ref={sidebarRef} aria-label={t("sidebar.navigation")}>
          <div className="sidebar__brand">
            <button
              ref={workspaceButtonRef}
              className="sidebar__workspace"
              type="button"
              title={society?.name ?? t("sidebar.selectWorkspace")}
              aria-label={society?.name ? `${t("sidebar.selectWorkspace")} — ${society.name}` : t("sidebar.selectWorkspace")}
              aria-haspopup="menu"
              aria-expanded={workspaceOpen}
              onClick={() => setWorkspaceOpen((v) => !v)}
            >
              <div className="sidebar__brand-logo">
                {(society?.name ?? "S")[0].toUpperCase()}
              </div>
              <span className="sidebar__brand-name">{society?.name ?? t("sidebar.selectWorkspace")}</span>
              <span className="sidebar__brand-workspace">
                <ChevronDown size={12} />
              </span>
            </button>
            <div className="sidebar__brand-actions">
              <NotificationBellSafe />
              <button
                className="sidebar__icon-btn"
                onClick={openGlobalAiAssistant}
                title="AI assistant"
                aria-label="AI assistant"
              >
                <Bot size={14} />
              </button>
              <button
                className="sidebar__icon-btn"
                onClick={() => window.dispatchEvent(new Event("kbar:open"))}
                title={`${t("common.search")} (/ or ⌘K)`}
                aria-label={t("common.search")}
              >
                <Search size={14} />
              </button>
              <button
                className="sidebar__icon-btn sidebar__toggle"
                onClick={toggleSidebar}
                title={`${isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${isMobileNav ? t("sidebar.navigation") : t("sidebar.sidebar")} (⌘\\)`}
                aria-label={`${isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${isMobileNav ? t("sidebar.navigation") : t("sidebar.sidebar")}`}
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>
          <div className={`sidebar__spotlight${spotlightCollapsed ? " is-collapsed" : ""}`}>
            <button
              type="button"
              className="sidebar__spotlight-toggle"
              onClick={() => setSpotlightCollapsed((v) => !v)}
              aria-expanded={!spotlightCollapsed}
            >
              <span className="sidebar__spotlight-label">{t("sidebar.operationsDesk")}</span>
              <ChevronDown size={12} className="sidebar__spotlight-chevron" />
            </button>
            {!spotlightCollapsed && (
              <>
                <NavLink
                  to="/app/tasks"
                  className={({ isActive }) =>
                    `sidebar__spotlight-meta sidebar__spotlight-meta--link${isActive ? " is-active" : ""}`
                  }
                >
                  <span>{t("sidebar.openTasks")}</span>
                  <Pill size="sm">{counts?.openTasks ?? 0}</Pill>
                </NavLink>
                <NavLink
                  to="/app/deadlines"
                  className={({ isActive }) =>
                    `sidebar__spotlight-meta sidebar__spotlight-meta--link${isActive ? " is-active" : ""}`
                  }
                >
                  <span>{t("sidebar.upcomingDeadlines")}</span>
                  <Pill size="sm">{counts?.openDeadlines ?? 0}</Pill>
                </NavLink>
              </>
            )}
          </div>

          <nav className="sidebar__nav">
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.favorites")}</span>
            </div>
            {favoritesOrder.map((ref, index) => {
              const isDragging = favoriteDragIndex === index;
              const showDropAbove = favoriteDropIndex === index;
              const dropClass = showDropAbove ? " is-drop-above" : "";
              const dragClass = isDragging ? " is-dragging" : "";

              if (ref.kind === "route") {
                const item = visiblePinnedNav.find((nav) => nav.to === ref.id);
                if (!item) return null;
                const Icon = item.icon;
                const count = getCount(item.to, counts);
                const label = getNavItemLabel(item);
                // Rendered as div, not NavLink — Chrome's native link-drag
                // interferes with our HTML5 drag-to-reorder (it tries to drag
                // the URL as a draggable bookmark, sometimes preventing our
                // dragstart from firing or stamping the wrong drag image).
                const isActive = isNavItemActive(item, loc.pathname);
                return (
                  <div
                    key={favoriteRefKey(ref)}
                    role="link"
                    tabIndex={0}
                    aria-current={isActive ? "page" : undefined}
                    className={`sidebar__item${isActive ? " is-active" : ""}${dragClass}${dropClass}`}
                    data-pinned
                    title={!isMobileNav && collapsed ? label : undefined}
                    draggable
                    onClick={() => navigate(item.to)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(item.to);
                        return;
                      }
                      handleNavItemKeyDown(event, item);
                    }}
                    onDragStart={onFavoriteDragStart(index)}
                    onDragOver={onFavoriteDragOver(index)}
                    onDrop={onFavoriteDrop}
                    onDragEnd={onFavoriteDragEnd}
                    onContextMenu={(event) => handleNavItemContextMenu(event, item)}
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
                  </div>
                );
              }

              if (ref.kind === "view") {
                const view = pinnedViews.find(
                  (pv) => pv.viewsKey === ref.viewsKey && pv.viewId === ref.viewId,
                );
                if (!view) return null;
                const target = `${view.to}?view=${view.viewId}`;
                const isActive =
                  loc.pathname === view.to || loc.pathname.startsWith(`${view.to}/`);
                return (
                  <div
                    key={favoriteRefKey(ref)}
                    role="link"
                    tabIndex={0}
                    aria-current={isActive ? "page" : undefined}
                    className={`sidebar__nav-item sidebar__nav-item--view${isActive ? " is-active" : ""}${dragClass}${dropClass}`}
                    title={collapsed ? view.label : undefined}
                    draggable
                    onClick={() => navigate(target)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(target);
                      }
                    }}
                    onDragStart={onFavoriteDragStart(index)}
                    onDragOver={onFavoriteDragOver(index)}
                    onDrop={onFavoriteDrop}
                    onDragEnd={onFavoriteDragEnd}
                  >
                    <span className="sidebar__nav-icon" aria-hidden="true">
                      <Pin size={12} />
                    </span>
                    {!collapsed && <span className="sidebar__nav-label">{view.label}</span>}
                  </div>
                );
              }

              const command = visiblePinnedCommands.find((cmd) => cmd.id === ref.id);
              if (!command) return null;
              const Icon = command.icon;
              return (
                <div
                  key={favoriteRefKey(ref)}
                  role="button"
                  tabIndex={0}
                  className={`sidebar__item sidebar__item--command${dragClass}${dropClass}`}
                  onClick={() => { void command.run(); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void command.run();
                    }
                  }}
                  title={collapsed ? command.label : undefined}
                  aria-label={command.label}
                  draggable
                  onDragStart={onFavoriteDragStart(index)}
                  onDragOver={onFavoriteDragOver(index)}
                  onDrop={onFavoriteDrop}
                  onDragEnd={onFavoriteDragEnd}
                >
                  <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                    <Icon size={14} />
                  </TintedIconTile>
                  {!collapsed && <span className="sidebar__label">{command.label}</span>}
                </div>
              );
            })}
            {/* Invisible end-of-favorites drop zone. Lets the user drop after
              * the last row without needing a "below" indicator on a real row.
              * Lights up with the same top hairline when targeted. */}
            {favoritesOrder.length > 0 && (
              <div
                className={`sidebar__favorite-end-zone${
                  favoriteDropIndex === favoritesOrder.length ? " is-drop-above" : ""
                }${favoriteDragIndex !== null ? " is-active" : ""}`}
                onDragOver={onFavoriteEndZoneDragOver}
                onDrop={onFavoriteDrop}
                onDragEnd={onFavoriteDragEnd}
                aria-hidden="true"
              />
            )}
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.allRecords")}</span>
            </div>
            {visibleGroupedNav.map((group) => {
              const isOpen = openGroups[group.id] ?? false;
              const hasActiveItem = group.items.some((item) => isNavItemActive(item, loc.pathname));

              return (
                <div className={`sidebar__group${isOpen ? " is-open" : ""}`} key={group.id}>
                  <button
                    type="button"
                    className={`sidebar__section sidebar__group-toggle${hasActiveItem ? " is-active" : ""}`}
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !isOpen }))}
                    aria-expanded={isOpen}
                  >
                    <span>{t(`nav.${group.id}`, group.label)}</span>
                    <span className="sidebar__group-trailing">
                      <span className="sidebar__group-meta">{group.items.length}</span>
                      <ChevronDown size={12} className="sidebar__group-chevron" />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="sidebar__group-items">
                      {group.items.map((item) =>
                        renderNavItem(
                          item,
                          counts,
                          collapsed,
                          isMobileNav,
                          getNavItemLabel,
                          pinnedRouteSet.has(item.to),
                          handleNavItemContextMenu,
                          handleNavItemKeyDown,
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.resources")}</span>
            </div>
            <a
              className="sidebar__item"
              href="https://www2.gov.bc.ca/gov/content/employment-business/non-profits-sector/not-for-profit-organizations"
              target="_blank"
              rel="noreferrer"
              title={!isMobileNav && collapsed ? t("nav.documentation") : undefined}
            >
              <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                <HelpCircle size={14} />
              </TintedIconTile>
              <span className="sidebar__label">{t("nav.documentation")}</span>
            </a>
          </nav>
          <div className="sidebar__identity">
            <UserPickerSafe />
            <SidebarThemeToggle />
          </div>
        </aside>

        {workspaceOpen && workspaceAnchor && societies && createPortal(
          <div
            ref={workspaceMenuRef}
            style={{
              position: "fixed",
              top: workspaceAnchor.top,
              bottom: workspaceAnchor.bottom,
              left: workspaceAnchor.left,
              width: workspaceAnchor.width,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-lg)",
              zIndex: "var(--z-dropdown)",
              overflow: "hidden",
              maxHeight: workspaceAnchor.maxHeight,
              color: "var(--text-primary)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <strong style={{ fontSize: "var(--fs-md)" }}>{t("sidebar.workspaces")}</strong>
            </div>
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              {societies.map((s: any) => {
                const active = s._id === society?._id;
                return (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => {
                      setStoredSocietyId(s._id);
                      setWorkspaceOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      background: active ? "var(--bg-subtle)" : "var(--bg-panel)",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = active ? "var(--bg-subtle)" : "var(--bg-panel)";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: "var(--fs-md)", flex: 1 }}>{s.name}</strong>
                      {active && <Pill size="sm">{t("sidebar.activeWorkspace")}</Pill>}
                    </div>
                    {s.incorporationNumber && (
                      <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                        {s.incorporationNumber}
                      </div>
                    )}
                  </button>
                );
              })}
              {(!societies || societies.length === 0) && (
                <div className="empty-state empty-state--sm empty-state--start">
                  {t("sidebar.noSocieties")}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

        {navContextMenu && createPortal(
          <div
            ref={navContextMenuRef}
            className="menu menu--actions sidebar-context-menu"
            role="menu"
            style={{
              top: navContextMenu.top,
              left: navContextMenu.left,
              width: SIDEBAR_MENU_WIDTH,
            }}
          >
            <div className="menu__section">
              <MenuSectionLabel>{navContextMenu.label}</MenuSectionLabel>
              <MenuRow
                role="menuitem"
                icon={pinnedRouteSet.has(navContextMenu.item.to) ? <PinOff size={14} /> : <Pin size={14} />}
                label={
                  pinnedRouteSet.has(navContextMenu.item.to)
                    ? t("sidebar.unpinFromFavorites")
                    : t("sidebar.pinToFavorites")
                }
                onClick={() => togglePinnedRoute(navContextMenu.item)}
              />
              {(() => {
                // Move up / Move down only show for pinned items, and only
                // in directions that lead somewhere. Resolved against the
                // unified favorites order so a pinned route can be moved
                // past a pinned action that's adjacent to it.
                const orderIndex = favoritesOrder.findIndex(
                  (ref) => ref.kind === "route" && ref.id === navContextMenu.item.to,
                );
                if (orderIndex < 0) return null;
                const canMoveUp = orderIndex > 0;
                const canMoveDown = orderIndex < favoritesOrder.length - 1;
                if (!canMoveUp && !canMoveDown) return null;
                return (
                  <>
                    <div className="menu__separator" />
                    {canMoveUp && (
                      <MenuRow
                        role="menuitem"
                        icon={<ArrowUp size={14} />}
                        label="Move up"
                        onClick={() => {
                          moveFavoriteByIndex(orderIndex, -1);
                          setNavContextMenu(null);
                        }}
                      />
                    )}
                    {canMoveDown && (
                      <MenuRow
                        role="menuitem"
                        icon={<ArrowDown size={14} />}
                        label="Move down"
                        onClick={() => {
                          moveFavoriteByIndex(orderIndex, 1);
                          setNavContextMenu(null);
                        }}
                      />
                    )}
                  </>
                );
              })()}
              <div className="menu__separator" />
              <MenuRow
                role="menuitem"
                icon={<ExternalLink size={14} />}
                label={t("sidebar.openInNewTab")}
                onClick={() => openNavItemInNewTab(navContextMenu.item)}
              />
            </div>
          </div>,
          document.body,
        )}

        <div className="main" ref={mainRef}>
          <div className="workbench">
            <div className="workbench__panel">
              <DemoBanner />
              <div className="workbench__body">
                <div className="workbench__content">
                  <Suspense fallback={<WorkbenchPageLoader />}>
                    <Outlet />
                  </Suspense>
                </div>
                <InspectorHost />
              </div>
            </div>
          </div>
        </div>
        <GlobalAiAssistant />
        {isMobileNav && (
          <nav className="bottom-nav" aria-label={t("sidebar.navigation")}>
            {/* Icon size 16px matches twenty's icon.size.md — the CSS also
             * clamps to 16px, but passing it through to the SVG avoids the
             * initial over-render before styles kick in. */}
            <NavLink to="/app" end className={({ isActive }) => `bottom-nav__item${isActive ? " is-active" : ""}`}>
              <LayoutDashboard size={16} strokeWidth={2} />
              <span>{t("nav.dashboard", "Dashboard")}</span>
            </NavLink>
            <NavLink to="/app/tasks" className={({ isActive }) => `bottom-nav__item${isActive ? " is-active" : ""}`}>
              <ListTodo size={16} strokeWidth={2} />
              <span>{t("nav.tasks", "Tasks")}</span>
            </NavLink>
            <NavLink to="/app/meetings" className={({ isActive }) => `bottom-nav__item${isActive ? " is-active" : ""}`}>
              <Calendar size={16} strokeWidth={2} />
              <span>{t("nav.meetingsItem", "Meetings")}</span>
            </NavLink>
            <NavLink to="/app/documents" className={({ isActive }) => `bottom-nav__item${isActive ? " is-active" : ""}`}>
              <FolderOpen size={16} strokeWidth={2} />
              <span>{t("nav.documents", "Docs")}</span>
            </NavLink>
            <button
              type="button"
              className="bottom-nav__item"
              onClick={openSidebar}
            >
              <Menu size={16} strokeWidth={2} />
              <span>{t("sidebar.more", "More")}</span>
            </button>
          </nav>
        )}
      </div>
    </InspectorProvider>
  );
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
