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

type NavEntry =
  | { section: string }
  | {
      to: string;
      label: string;
      icon: ComponentType<{ size?: number | string }>;
      color: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
      end?: boolean;
    };

const NAV: NavEntry[] = [
  { section: "Overview" },
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, color: "gray", end: true },
  { to: "/app/society", label: "Society", icon: Building2, color: "blue" },
  { to: "/app/timeline", label: "Timeline", icon: CalendarClock, color: "purple" },
  { section: "People" },
  { to: "/app/members", label: "Members", icon: Users, color: "blue" },
  { to: "/app/directors", label: "Directors", icon: UserCog, color: "blue" },
  { to: "/app/committees", label: "Committees", icon: UsersRound, color: "pink" },
  { to: "/app/volunteers", label: "Volunteers", icon: HandHeart, color: "pink" },
  { section: "Work" },
  { to: "/app/goals", label: "Goals", icon: Target, color: "red" },
  { to: "/app/tasks", label: "Tasks", icon: ListTodo, color: "turquoise" },
  { section: "Governance" },
  { to: "/app/meetings", label: "Meetings", icon: Calendar, color: "orange" },
  { to: "/app/minutes", label: "Minutes", icon: FileText, color: "turquoise" },
  { to: "/app/proposals", label: "Member proposals", icon: Vote, color: "purple" },
  { to: "/app/elections", label: "Elections", icon: Vote, color: "purple" },
  { to: "/app/written-resolutions", label: "Written resolutions", icon: PenLine, color: "purple" },
  { to: "/app/proxies", label: "Proxies", icon: UserCheck, color: "purple" },
  { to: "/app/conflicts", label: "Conflicts of interest", icon: AlertTriangle, color: "red" },
  { to: "/app/attestations", label: "Director attestations", icon: ShieldCheck, color: "red" },
  { to: "/app/auditors", label: "Auditors", icon: Calculator, color: "green" },
  { to: "/app/court-orders", label: "Court orders", icon: Gavel, color: "red" },
  { section: "Compliance" },
  { to: "/app/filings", label: "Filings", icon: ClipboardList, color: "orange" },
  { to: "/app/filings/prefill", label: "Filing pre-fill", icon: FileCog, color: "orange" },
  { to: "/app/deadlines", label: "Deadlines", icon: Calendar, color: "yellow" },
  { to: "/app/communications", label: "Communications", icon: Mail, color: "orange" },
  { to: "/app/documents", label: "Documents", icon: FolderOpen, color: "gray" },
  { to: "/app/retention", label: "Records retention", icon: Archive, color: "gray" },
  { to: "/app/inspections", label: "Records inspections", icon: Eye, color: "gray" },
  { to: "/app/privacy", label: "Privacy (PIPA)", icon: Shield, color: "green" },
  { to: "/app/pipa-training", label: "PIPA training", icon: ShieldCheck, color: "green" },
  { to: "/app/insurance", label: "Insurance", icon: Shield, color: "green" },
  { to: "/app/bylaw-rules", label: "Bylaw rules", icon: Scale, color: "purple" },
  { to: "/app/bylaw-diff", label: "Bylaw redline", icon: GitCompare, color: "purple" },
  { to: "/app/bylaws-history", label: "Bylaws history", icon: BookOpen, color: "purple" },
  { section: "Finance" },
  { to: "/app/financials", label: "Financials", icon: PiggyBank, color: "green" },
  { to: "/app/grants", label: "Grants", icon: BadgeDollarSign, color: "green" },
  { to: "/app/reconciliation", label: "Reconciliation", icon: Scale, color: "green" },
  { to: "/app/receipts", label: "Donation receipts", icon: Receipt, color: "pink" },
  { to: "/app/employees", label: "Employees", icon: Users, color: "blue" },
  { to: "/app/membership", label: "Membership & billing", icon: CreditCard, color: "turquoise" },
  { section: "System" },
  { to: "/app/transparency", label: "Public transparency", icon: Globe, color: "blue" },
  { to: "/app/notifications", label: "Notifications", icon: Bell, color: "orange" },
  { to: "/app/users", label: "Users & roles", icon: UserCog, color: "blue" },
  { to: "/app/audit", label: "Audit log", icon: ShieldCheck, color: "red" },
];

const PINNED_ROUTES = ["/app", "/app/tasks", "/app/deadlines", "/app/meetings", "/app/documents"];

const COLLAPSE_KEY = "societyer.sidebar.collapsed";

export function Layout() {
  const { society, societies } = useSocietySelection();
  const loc = useLocation();
  const [isMobileNav, setIsMobileNav] = useState(() =>
    window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
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
  const pinnedNav = useMemo(
    () =>
      PINNED_ROUTES.map((route) => NAV.find((item): item is Exclude<NavEntry, { section: string }> => "to" in item && item.to === route)).filter(
        (item): item is Exclude<NavEntry, { section: string }> => Boolean(item),
      ),
    [],
  );
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
            aria-label="Close navigation"
          />
        )}
        <button
          className="sidebar-peek"
          onClick={openSidebar}
          title={isMobileNav ? "Open navigation" : "Open sidebar (⌘\\)"}
          aria-label={isMobileNav ? "Open navigation" : "Open sidebar"}
        >
          <PanelLeftOpen size={14} />
        </button>
        <aside className="sidebar">
          <div className="sidebar__brand">
            <button
              ref={workspaceButtonRef}
              className="sidebar__workspace"
              type="button"
              title={society?.name ?? "Select workspace"}
              onClick={() => setWorkspaceOpen((v) => !v)}
            >
              <div className="sidebar__brand-logo">
                {(society?.name ?? "S")[0].toUpperCase()}
              </div>
              <span className="sidebar__brand-name">{society?.name ?? "Select workspace"}</span>
              <span className="sidebar__brand-workspace">
                <ChevronDown size={12} />
              </span>
            </button>
            <div className="sidebar__brand-actions">
              <NotificationBellSafe />
              <button
                className="sidebar__icon-btn"
                onClick={() => window.dispatchEvent(new Event("kbar:open"))}
                title="Search (⌘K)"
              >
                <Search size={14} />
              </button>
              <button
                className="sidebar__icon-btn sidebar__toggle"
                onClick={toggleSidebar}
                title={`${isSidebarCollapsed ? "Expand" : "Collapse"} ${isMobileNav ? "navigation" : "sidebar"} (⌘\\)`}
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>
          <div className="sidebar__identity">
            <UserPickerSafe />
          </div>
          <div className="sidebar__spotlight">
            <div className="sidebar__spotlight-label">Operations desk</div>
            <div className="sidebar__spotlight-title">{society?.name ?? "Societyer workspace"}</div>
            <div className="sidebar__spotlight-meta">
              <span>Open tasks</span>
              <Pill size="sm">{counts?.counts.openTasks ?? 0}</Pill>
            </div>
            <div className="sidebar__spotlight-meta">
              <span>Upcoming deadlines</span>
              <Pill size="sm">{counts?.counts.openDeadlines ?? 0}</Pill>
            </div>
          </div>

          <nav className="sidebar__nav">
            <div className="sidebar__section sidebar__section--compact">
              <span>Favorites</span>
              <span className="sidebar__section-meta">Pinned</span>
            </div>
            {pinnedNav.map((item) => renderNavItem(item, counts, collapsed, isMobileNav))}
            <div className="sidebar__section sidebar__section--compact">
              <span>All records</span>
              <span className="sidebar__section-meta">Workspace</span>
            </div>
            {NAV.map((item, i) => {
              if ("section" in item) {
                return (
                  <div className="sidebar__section" key={`s-${i}`}>
                    {item.section}
                  </div>
                );
              }
              return renderNavItem(item, counts, collapsed, isMobileNav);
            })}
            <div className="sidebar__section sidebar__section--compact">
              <span>Resources</span>
              <span className="sidebar__section-meta">Reference</span>
            </div>
            <NavLink
              to="/app/settings"
              className={({ isActive }) => `sidebar__item${isActive ? " is-active" : ""}`}
              title={!isMobileNav && collapsed ? "Settings" : undefined}
            >
              <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                <Settings size={14} />
              </TintedIconTile>
              <span className="sidebar__label">Settings</span>
            </NavLink>
            <a
              className="sidebar__item"
              href="https://www2.gov.bc.ca/gov/content/employment-business/non-profits-sector/not-for-profit-organizations"
              target="_blank"
              rel="noreferrer"
              title={!isMobileNav && collapsed ? "Documentation" : undefined}
            >
              <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                <HelpCircle size={14} />
              </TintedIconTile>
              <span className="sidebar__label">Documentation</span>
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
              borderRadius: 8,
              boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.25))",
              zIndex: 1000,
              overflow: "hidden",
              color: "var(--text-primary)",
            }}
          >
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <strong style={{ fontSize: 13 }}>Workspaces</strong>
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
                    <strong style={{ fontSize: 13, flex: 1 }}>{s.name}</strong>
                    {active && <Pill size="sm">Active</Pill>}
                  </div>
                  {s.incorporationNumber && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {s.incorporationNumber}
                    </div>
                  )}
                </button>
              );
            })}
            {(!societies || societies.length === 0) && (
              <div className="muted" style={{ padding: 12, fontSize: 12 }}>
                No societies available yet.
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
  item: Exclude<NavEntry, { section: string }>,
  counts: any,
  collapsed: boolean,
  isMobileNav: boolean,
) {
  const Icon = item.icon;
  const count = getCount(item.to, counts);

  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `sidebar__item${isActive ? " is-active" : ""}`}
      title={!isMobileNav && collapsed ? item.label : undefined}
    >
      <TintedIconTile tone={item.color} size="sm" className="sidebar__icon-chip">
        <Icon size={14} />
      </TintedIconTile>
      <span className="sidebar__label">{item.label}</span>
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
