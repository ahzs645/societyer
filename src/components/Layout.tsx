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
  Pin,
  PinOff,
  ExternalLink,
  KeyRound,
  Workflow,
  History,
  Sliders,
  MonitorPlay,
  Bot,
  Plug,
} from "lucide-react";
import {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { DemoBanner } from "./DemoBanner";
import { CommandPalette } from "./CommandPalette";
import { ShortcutHelp } from "./ShortcutHelp";
import { NotificationBell } from "./NotificationBell";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { UserPicker } from "./UserPicker";
import { InspectorHost, InspectorProvider } from "./InspectorPanel";
import { MenuRow, MenuSectionLabel, Pill, TintedIconTile } from "./ui";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { useTranslation } from "react-i18next";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
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

function CommandPaletteSafe() {
  return (
    <ErrorBoundary label="CommandPalette" fallback={null}>
      <CommandPalette />
    </ErrorBoundary>
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
  icon: ComponentType<{ size?: number | string }>;
  color: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  end?: boolean;
  module?: ModuleKey;
};

type NavGroup = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    defaultOpen: true,
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard, color: "gray", end: true },
      { to: "/app/society", label: "Society", icon: Building2, color: "blue" },
      { to: "/app/organization-details", label: "Org details", icon: Building2, color: "blue" },
      { to: "/app/org-history", label: "Org history", icon: Newspaper, color: "purple" },
      { to: "/app/timeline", label: "Timeline", icon: CalendarClock, color: "purple" },
    ],
  },
  {
    id: "people",
    label: "People",
    defaultOpen: true,
    items: [
      { to: "/app/members", label: "Members", icon: Users, color: "blue" },
      { to: "/app/directors", label: "Directors", icon: UserCog, color: "blue" },
      { to: "/app/role-holders", label: "Role holders", icon: UsersRound, color: "blue" },
      { to: "/app/committees", label: "Committees", icon: UsersRound, color: "pink" },
      { to: "/app/volunteers", label: "Volunteers", icon: HandHeart, color: "pink", module: "volunteers" },
      { to: "/app/employees", label: "Employees", icon: Users, color: "blue", module: "employees" },
    ],
  },
  {
    id: "work",
    label: "Work",
    defaultOpen: true,
    items: [
      { to: "/app/goals", label: "Goals", icon: Target, color: "red" },
      { to: "/app/tasks", label: "Tasks", icon: ListTodo, color: "turquoise" },
      { to: "/app/deadlines", label: "Deadlines", icon: Calendar, color: "yellow" },
      { to: "/app/commitments", label: "Commitments", icon: ClipboardList, color: "green" },
      { to: "/app/documents", label: "Documents", icon: FolderOpen, color: "gray" },
      { to: "/app/library", label: "Library", icon: BookOpen, color: "purple" },
      { to: "/app/communications", label: "Communications", icon: Mail, color: "orange", module: "communications" },
      { to: "/app/outbox", label: "Outbox", icon: Inbox, color: "orange" },
    ],
  },
  {
    id: "meetings",
    label: "Meetings & votes",
    items: [
      { to: "/app/meetings", label: "Meetings", icon: Calendar, color: "orange" },
      { to: "/app/agendas", label: "Agendas", icon: ClipboardList, color: "orange" },
      { to: "/app/motion-backlog", label: "Motion backlog", icon: ClipboardList, color: "orange" },
      { to: "/app/motion-library", label: "Motion library", icon: BookOpen, color: "purple" },
      { to: "/app/minutes", label: "Minutes", icon: FileText, color: "turquoise" },
      { to: "/app/meeting-evidence", label: "Meeting evidence", icon: ClipboardList, color: "orange" },
      { to: "/app/proposals", label: "Member proposals", icon: Vote, color: "purple", module: "voting" },
      { to: "/app/elections", label: "Elections", icon: Vote, color: "purple", module: "voting" },
      { to: "/app/written-resolutions", label: "Written resolutions", icon: PenLine, color: "purple", module: "voting" },
      { to: "/app/proxies", label: "Proxies", icon: UserCheck, color: "purple", module: "voting" },
    ],
  },
  {
    id: "records",
    label: "Governance records",
    items: [
      { to: "/app/conflicts", label: "Conflicts of int.", icon: AlertTriangle, color: "red" },
      { to: "/app/attestations", label: "Director attestations", icon: ShieldCheck, color: "red", module: "attestations" },
      { to: "/app/auditors", label: "Auditors", icon: Calculator, color: "green", module: "auditors" },
      { to: "/app/court-orders", label: "Court orders", icon: Gavel, color: "red", module: "courtOrders" },
      { to: "/app/governance-registers", label: "Governance registers", icon: Scale, color: "blue" },
      { to: "/app/rights-ledger", label: "Rights ledger", icon: Scale, color: "purple" },
      { to: "/app/minute-book", label: "Minute book", icon: BookOpen, color: "purple" },
      { to: "/app/bylaw-rules", label: "Bylaw rules", icon: Scale, color: "purple" },
      { to: "/app/bylaw-diff", label: "Bylaw redline", icon: GitCompare, color: "purple" },
      { to: "/app/bylaws-history", label: "Bylaws history", icon: BookOpen, color: "purple" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { to: "/app/filings", label: "Filings", icon: ClipboardList, color: "orange" },
      { to: "/app/filings/prefill", label: "Filing pre-fill", icon: FileCog, color: "orange", module: "filingPrefill" },
      { to: "/app/annual-cycle", label: "Annual cycle", icon: CalendarCheck, color: "orange" },
      { to: "/app/formation-maintenance", label: "Formation & annual", icon: Gavel, color: "orange" },
      { to: "/app/policies", label: "Policies", icon: FileText, color: "green" },
      { to: "/app/retention", label: "Records retention", icon: Archive, color: "gray", module: "recordsInspection" },
      { to: "/app/records-archive", label: "Records archive", icon: Archive, color: "gray" },
      { to: "/app/inspections", label: "Records inspections", icon: Eye, color: "gray", module: "recordsInspection" },
      { to: "/app/privacy", label: "Privacy (PIPA)", icon: Shield, color: "green" },
      { to: "/app/pipa-training", label: "PIPA training", icon: ShieldCheck, color: "green", module: "pipaTraining" },
      { to: "/app/insurance", label: "Insurance", icon: Shield, color: "green", module: "insurance" },
      { to: "/app/access-custody", label: "Access custody", icon: KeyRound, color: "red", module: "secrets" },
      { to: "/app/transparency", label: "Public transparency", icon: Globe, color: "blue", module: "transparency" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { to: "/app/financials", label: "Financials", icon: PiggyBank, color: "green" },
      { to: "/app/finance-imports", label: "Finance imports", icon: PiggyBank, color: "green" },
      { to: "/app/treasurer", label: "Treasurer", icon: PiggyBank, color: "green" },
      { to: "/app/grants", label: "Grants", icon: BadgeDollarSign, color: "green", module: "grants" },
      { to: "/app/reconciliation", label: "Reconciliation", icon: Scale, color: "green", module: "reconciliation" },
      { to: "/app/receipts", label: "Donation receipts", icon: Receipt, color: "pink", module: "donationReceipts" },
      { to: "/app/membership", label: "Membership & billing", icon: CreditCard, color: "turquoise", module: "membershipBilling" },
    ],
  },
  {
    id: "workflows",
    label: "Workflows",
    items: [
      { to: "/app/integrations", label: "Integrations", icon: Plug, color: "purple", module: "workflows" },
      { to: "/app/browser-connectors", label: "Browser apps", icon: MonitorPlay, color: "orange", module: "browserConnectors" },
      { to: "/app/ai-agents", label: "AI agents", icon: Bot, color: "turquoise" },
      { to: "/app/workflows", label: "Workflows", icon: Workflow, color: "orange", module: "workflows" },
      { to: "/app/workflow-runs", label: "Workflow runs", icon: History, color: "gray", module: "workflows" },
      { to: "/app/workflow-packages", label: "Workflow packages", icon: FileJson, color: "orange", module: "workflows" },
      { to: "/app/template-engine", label: "Template engine", icon: FileCog, color: "green" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { to: "/app/notifications", label: "Notifications", icon: Bell, color: "orange" },
      { to: "/app/users", label: "Users & roles", icon: UserCog, color: "blue" },
      { to: "/app/custom-fields", label: "Custom fields", icon: Sliders, color: "purple" },
      { to: "/app/imports", label: "Import sessions", icon: FileJson, color: "purple" },
      { to: "/app/paperless", label: "Paperless-ngx", icon: Database, color: "gray", module: "paperless" },
      { to: "/app/settings", label: "Settings", icon: Settings, color: "gray" },
      { to: "/app/audit", label: "Audit log", icon: ShieldCheck, color: "red" },
      { to: "/app/exports", label: "Data export", icon: Download, color: "blue" },
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
  Policies: "nav.policies",
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => getInitialOpenGroups(window.location.pathname),
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceAnchor, setWorkspaceAnchor] = useState<{
    top: number;
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

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    localStorage.setItem(PINNED_ROUTES_KEY, JSON.stringify(pinnedRoutes));
  }, [pinnedRoutes]);

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
      const maxHeight = Math.min(
        360,
        Math.max(180, window.innerHeight - margin * 2),
      );
      let top = rect.bottom + gap;
      if (top + maxHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - maxHeight - margin);
      }
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
      if (left < margin) left = margin;
      setWorkspaceAnchor({ top, left, width, maxHeight });
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

  const counts = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes]);
  const pinnedNav = useMemo(() => getPinnedNav(pinnedRoutes), [pinnedRoutes]);
  const pinnedViews = useUIStore((s) => s.pinnedViews);
  const groupedNav = useMemo(() => getGroupedNav(pinnedRouteSet), [pinnedRouteSet]);
  const visiblePinnedNav = useMemo(
    () => pinnedNav.filter((item) => !item.module || isModuleEnabled(society, item.module)),
    [pinnedNav, society],
  );
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
  const activeSidebarMode = loc.pathname.startsWith("/app/workflows") ||
    loc.pathname.startsWith("/app/workflow-runs") ||
    loc.pathname.startsWith("/app/workflow-packages") ||
    loc.pathname.startsWith("/app/integrations") ||
    loc.pathname.startsWith("/app/browser-connectors") ||
    loc.pathname.startsWith("/app/template-engine")
      ? "workflows"
      : "workspace";
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
                onClick={() => window.dispatchEvent(new Event("kbar:open"))}
                title={`${t("common.search")} (⌘K)`}
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
          <div className="sidebar__mode-row" aria-label="Sidebar mode">
            <div className="sidebar__mode-pill" role="tablist" aria-label="Navigation mode">
              <button
                type="button"
                role="tab"
                aria-selected={activeSidebarMode === "workspace"}
                className={`sidebar__mode-tab${activeSidebarMode === "workspace" ? " is-active" : ""}`}
                title="Workspace"
                onClick={() => navigate("/app")}
              >
                <LayoutDashboard size={14} />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="sidebar__mode-tab"
                title={`${t("common.search")} (⌘K)`}
                onClick={() => window.dispatchEvent(new Event("kbar:open"))}
              >
                <Search size={14} />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSidebarMode === "workflows"}
                className={`sidebar__mode-tab${activeSidebarMode === "workflows" ? " is-active" : ""}`}
                title="Workflows"
                onClick={() => navigate("/app/workflows")}
              >
                <Workflow size={14} />
              </button>
            </div>
          </div>
          <div className="sidebar__identity">
            <UserPickerSafe />
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
                <div className="sidebar__spotlight-meta">
                  <span>{t("sidebar.openTasks")}</span>
                  <Pill size="sm">{counts?.counts.openTasks ?? 0}</Pill>
                </div>
                <div className="sidebar__spotlight-meta">
                  <span>{t("sidebar.upcomingDeadlines")}</span>
                  <Pill size="sm">{counts?.counts.openDeadlines ?? 0}</Pill>
                </div>
              </>
            )}
          </div>

          <nav className="sidebar__nav">
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.favorites")}</span>
            </div>
            {visiblePinnedNav.map((item) =>
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
            {pinnedViews.length > 0 && (
              <>
                {pinnedViews.map((pv) => (
                  <NavLink
                    key={`${pv.viewsKey}:${pv.viewId}`}
                    to={`${pv.to}?view=${pv.viewId}`}
                    className={({ isActive }) =>
                      `sidebar__nav-item sidebar__nav-item--view${isActive ? " is-active" : ""}`
                    }
                    title={collapsed ? pv.label : undefined}
                  >
                    <span className="sidebar__nav-icon" aria-hidden="true">
                      <Pin size={12} />
                    </span>
                    {!collapsed && <span className="sidebar__nav-label">{pv.label}</span>}
                  </NavLink>
                ))}
              </>
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
        </aside>

        {workspaceOpen && workspaceAnchor && societies && createPortal(
          <div
            ref={workspaceMenuRef}
            style={{
              position: "fixed",
              top: workspaceAnchor.top,
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
                  <Outlet />
                </div>
                <InspectorHost />
              </div>
            </div>
          </div>
        </div>
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
    case "/app/members": return counts.counts.members;
    case "/app/directors": return counts.counts.directors;
    case "/app/meetings": return counts.counts.meetingsThisYear;
    case "/app/filings": return counts.counts.overdueFilings || null;
    case "/app/deadlines": return counts.counts.openDeadlines;
    case "/app/conflicts": return counts.counts.openConflicts || null;
    case "/app/committees": return counts.counts.committees || null;
    case "/app/goals": return counts.counts.openGoals || null;
    case "/app/tasks": return counts.counts.openTasks || null;
    default: return null;
  }
}
