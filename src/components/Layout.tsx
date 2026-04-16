import { NavLink, Outlet, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  Calendar,
  FileText,
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
  HandHeart,
  BadgeDollarSign,
  Globe,
  Download,
} from "lucide-react";
import { ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DemoBanner } from "./DemoBanner";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { UserPicker } from "./UserPicker";
import { InspectorHost, InspectorProvider } from "./InspectorPanel";
import { Pill, TintedIconTile } from "./ui";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { useTranslation } from "react-i18next";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

const MOBILE_SIDEBAR_BREAKPOINT = 980;

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
      { to: "/app/documents", label: "Documents", icon: FolderOpen, color: "gray" },
      { to: "/app/communications", label: "Communications", icon: Mail, color: "orange", module: "communications" },
    ],
  },
  {
    id: "meetings",
    label: "Meetings & votes",
    items: [
      { to: "/app/meetings", label: "Meetings", icon: Calendar, color: "orange" },
      { to: "/app/agendas", label: "Agendas", icon: ClipboardList, color: "orange" },
      { to: "/app/motion-library", label: "Motion library", icon: BookOpen, color: "purple" },
      { to: "/app/minutes", label: "Minutes", icon: FileText, color: "turquoise" },
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
      { to: "/app/conflicts", label: "Conflicts of interest", icon: AlertTriangle, color: "red" },
      { to: "/app/attestations", label: "Director attestations", icon: ShieldCheck, color: "red", module: "attestations" },
      { to: "/app/auditors", label: "Auditors", icon: Calculator, color: "green", module: "auditors" },
      { to: "/app/court-orders", label: "Court orders", icon: Gavel, color: "red", module: "courtOrders" },
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
      { to: "/app/retention", label: "Records retention", icon: Archive, color: "gray", module: "recordsInspection" },
      { to: "/app/inspections", label: "Records inspections", icon: Eye, color: "gray", module: "recordsInspection" },
      { to: "/app/privacy", label: "Privacy (PIPA)", icon: Shield, color: "green" },
      { to: "/app/pipa-training", label: "PIPA training", icon: ShieldCheck, color: "green", module: "pipaTraining" },
      { to: "/app/insurance", label: "Insurance", icon: Shield, color: "green", module: "insurance" },
      { to: "/app/transparency", label: "Public transparency", icon: Globe, color: "blue", module: "transparency" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { to: "/app/financials", label: "Financials", icon: PiggyBank, color: "green" },
      { to: "/app/treasurer", label: "Treasurer", icon: PiggyBank, color: "green" },
      { to: "/app/grants", label: "Grants", icon: BadgeDollarSign, color: "green", module: "grants" },
      { to: "/app/reconciliation", label: "Reconciliation", icon: Scale, color: "green", module: "reconciliation" },
      { to: "/app/receipts", label: "Donation receipts", icon: Receipt, color: "pink", module: "donationReceipts" },
      { to: "/app/membership", label: "Membership & billing", icon: CreditCard, color: "turquoise", module: "membershipBilling" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { to: "/app/notifications", label: "Notifications", icon: Bell, color: "orange" },
      { to: "/app/users", label: "Users & roles", icon: UserCog, color: "blue" },
      { to: "/app/audit", label: "Audit log", icon: ShieldCheck, color: "red" },
      { to: "/app/exports", label: "Data export", icon: Download, color: "blue" },
    ],
  },
];

const PINNED_ROUTES = ["/app", "/app/tasks", "/app/deadlines", "/app/meetings", "/app/documents"];
const PINNED_ROUTE_SET = new Set(PINNED_ROUTES);
const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const PINNED_NAV = PINNED_ROUTES
  .map((route) => ALL_NAV_ITEMS.find((item) => item.to === route))
  .filter((item): item is NavItem => Boolean(item));
const GROUPED_NAV = NAV_GROUPS
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => !PINNED_ROUTE_SET.has(item.to)),
  }))
  .filter((group) => group.items.length > 0);

function isNavItemActive(item: NavItem, pathname: string) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function getInitialOpenGroups(pathname: string) {
  return Object.fromEntries(
    GROUPED_NAV.map((group) => [
      group.id,
      Boolean(group.defaultOpen || group.items.some((item) => isNavItemActive(item, pathname))),
    ]),
  ) as Record<string, boolean>;
}

const COLLAPSE_KEY = "societyer.sidebar.collapsed";
const NAV_ITEM_LABEL_KEYS: Record<string, string> = {
  Dashboard: "nav.dashboard",
  Society: "nav.society",
  Timeline: "nav.timeline",
  Members: "nav.members",
  Directors: "nav.directors",
  Committees: "nav.committees",
  Volunteers: "nav.volunteers",
  Employees: "nav.employees",
  Goals: "nav.goals",
  Tasks: "nav.tasks",
  Deadlines: "nav.deadlines",
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
  "Conflicts of interest": "nav.conflicts",
  "Director attestations": "nav.attestations",
  Auditors: "nav.auditors",
  "Court orders": "nav.courtOrders",
  "Bylaw rules": "nav.bylawRules",
  "Bylaw redline": "nav.bylawRedline",
  "Bylaws history": "nav.bylawsHistory",
  Filings: "nav.filings",
  "Filing pre-fill": "nav.filingPrefill",
  "Records retention": "nav.recordsRetention",
  "Records inspections": "nav.recordsInspections",
  "Privacy (PIPA)": "nav.privacy",
  "PIPA training": "nav.pipaTraining",
  Insurance: "nav.insurance",
  "Public transparency": "nav.transparency",
  Financials: "nav.financials",
  Treasurer: "nav.treasurer",
  Grants: "nav.grants",
  Reconciliation: "nav.reconciliation",
  "Donation receipts": "nav.donationReceipts",
  "Membership & billing": "nav.membership",
  Notifications: "nav.notifications",
  "Users & roles": "nav.users",
  "Audit log": "nav.auditLog",
  "Data export": "nav.dataExport",
};

export function Layout() {
  const { society, societies } = useSocietySelection();
  const { t } = useTranslation();
  const loc = useLocation();
  const [isMobileNav, setIsMobileNav] = useState(() =>
    window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => !isStaticDemoRuntime() && localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => getInitialOpenGroups(window.location.pathname),
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceAnchor, setWorkspaceAnchor] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isStaticDemoRuntime()) return;
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`);
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
    const activeGroup = GROUPED_NAV.find((group) =>
      group.items.some((item) => isNavItemActive(item, loc.pathname)),
    );
    if (!activeGroup) return;
    setOpenGroups((prev) => (prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }));
  }, [loc.pathname]);

  useEffect(() => {
    if (!workspaceOpen) return;
    const place = () => {
      const rect = workspaceButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      setWorkspaceAnchor({ top: rect.bottom + 6, left, width });
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

  const counts = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
  const visiblePinnedNav = useMemo(
    () => PINNED_NAV.filter((item) => !item.module || isModuleEnabled(society, item.module)),
    [society],
  );
  const visibleGroupedNav = useMemo(
    () =>
      GROUPED_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.module || isModuleEnabled(society, item.module)),
      })).filter((group) => group.items.length > 0),
    [society],
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

  return (
    <InspectorProvider>
      <CommandPalette />
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
        <aside className="sidebar">
          <div className="sidebar__brand">
            <button
              ref={workspaceButtonRef}
              className="sidebar__workspace"
              type="button"
              title={society?.name ?? t("sidebar.selectWorkspace")}
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
              >
                <Search size={14} />
              </button>
              <button
                className="sidebar__icon-btn sidebar__toggle"
                onClick={toggleSidebar}
                title={`${isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${isMobileNav ? t("sidebar.navigation") : t("sidebar.sidebar")} (⌘\\)`}
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>
          <div className="sidebar__identity">
            <UserPickerSafe />
          </div>
          <div className="sidebar__spotlight">
            <div className="sidebar__spotlight-label">{t("sidebar.operationsDesk")}</div>
            <div className="sidebar__spotlight-title">{society?.name ?? t("sidebar.defaultWorkspace")}</div>
            <div className="sidebar__spotlight-meta">
              <span>{t("sidebar.openTasks")}</span>
              <Pill size="sm">{counts?.counts.openTasks ?? 0}</Pill>
            </div>
            <div className="sidebar__spotlight-meta">
              <span>{t("sidebar.upcomingDeadlines")}</span>
              <Pill size="sm">{counts?.counts.openDeadlines ?? 0}</Pill>
            </div>
          </div>

          <nav className="sidebar__nav">
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.favorites")}</span>
              <span className="sidebar__section-meta">{t("sidebar.pinned")}</span>
            </div>
            {visiblePinnedNav.map((item) => renderNavItem(item, counts, collapsed, isMobileNav, getNavItemLabel))}
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.allRecords")}</span>
              <span className="sidebar__section-meta">{t("sidebar.grouped")}</span>
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
                      {group.items.map((item) => renderNavItem(item, counts, collapsed, isMobileNav, getNavItemLabel))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.resources")}</span>
              <span className="sidebar__section-meta">{t("sidebar.reference")}</span>
            </div>
            <NavLink
              to="/app/settings"
              className={({ isActive }) => `sidebar__item${isActive ? " is-active" : ""}`}
              title={!isMobileNav && collapsed ? t("nav.settings") : undefined}
            >
              <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                <Settings size={14} />
              </TintedIconTile>
              <span className="sidebar__label">{t("nav.settings")}</span>
            </NavLink>
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
              zIndex: 1000,
              overflow: "hidden",
              color: "var(--text-primary)",
            }}
          >
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <strong style={{ fontSize: "var(--fs-md)" }}>{t("sidebar.workspaces")}</strong>
            </div>
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
              <div className="muted" style={{ padding: 12, fontSize: "var(--fs-sm)" }}>
                {t("sidebar.noSocieties")}
              </div>
            )}
          </div>,
          document.body,
        )}

        <div className="main">
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
      title={!isMobileNav && collapsed ? label : undefined}
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
