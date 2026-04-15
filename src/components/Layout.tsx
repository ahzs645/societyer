import { NavLink, Outlet, useLocation } from "react-router-dom";
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
} from "lucide-react";
import { ComponentType, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { DemoBanner } from "./DemoBanner";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { UserPicker } from "./UserPicker";

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
  | { to: string; label: string; icon: ComponentType<{ size?: number | string }>; color: string; end?: boolean };

const NAV: NavEntry[] = [
  { section: "Overview" },
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, color: "gray", end: true },
  { to: "/app/society", label: "Society", icon: Building2, color: "blue" },
  { to: "/app/timeline", label: "Timeline", icon: CalendarClock, color: "purple" },
  { section: "People" },
  { to: "/app/members", label: "Members", icon: Users, color: "blue" },
  { to: "/app/directors", label: "Directors", icon: UserCog, color: "blue" },
  { to: "/app/committees", label: "Committees", icon: UsersRound, color: "pink" },
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
  { to: "/app/reconciliation", label: "Reconciliation", icon: Scale, color: "green" },
  { to: "/app/receipts", label: "Donation receipts", icon: Receipt, color: "pink" },
  { to: "/app/employees", label: "Employees", icon: Users, color: "blue" },
  { to: "/app/membership", label: "Membership & billing", icon: CreditCard, color: "turquoise" },
  { section: "System" },
  { to: "/app/notifications", label: "Notifications", icon: Bell, color: "orange" },
  { to: "/app/users", label: "Users & roles", icon: UserCog, color: "blue" },
  { to: "/app/audit", label: "Audit log", icon: ShieldCheck, color: "red" },
];

const COLLAPSE_KEY = "societyer.sidebar.collapsed";

export function Layout() {
  const society = useQuery(api.society.get, {});
  const loc = useLocation();
  const [isMobileNav, setIsMobileNav] = useState(() =>
    window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );

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

  const counts = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
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
    <>
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
            <div className="sidebar__workspace" role="button" title={society?.name ?? "Society"}>
              <div className="sidebar__brand-logo">
                {(society?.name ?? "S")[0].toUpperCase()}
              </div>
              <span className="sidebar__brand-name">{society?.name ?? "Societyer"}</span>
              <span className="sidebar__brand-workspace">
                <ChevronDown size={12} />
              </span>
            </div>
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
          <div style={{ padding: "6px 12px 0" }}>
            <UserPickerSafe />
          </div>

          <nav className="sidebar__nav">
            {NAV.map((item, i) => {
              if ("section" in item) {
                return (
                  <div className="sidebar__section" key={`s-${i}`}>
                    {item.section}
                  </div>
                );
              }
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
                  <span className={`sidebar__icon-chip icon-chip-${item.color}`}>
                    <Icon size={14} />
                  </span>
                  <span className="sidebar__label">{item.label}</span>
                  {count != null && <span className="sidebar__count">{count}</span>}
                </NavLink>
              );
            })}
            <div className="sidebar__section">Other</div>
            <NavLink
              to="/app/settings"
              className={({ isActive }) => `sidebar__item${isActive ? " is-active" : ""}`}
              title={!isMobileNav && collapsed ? "Settings" : undefined}
            >
              <span className="sidebar__icon-chip icon-chip-gray">
                <Settings size={14} />
              </span>
              <span className="sidebar__label">Settings</span>
            </NavLink>
            <a
              className="sidebar__item"
              href="https://www2.gov.bc.ca/gov/content/employment-business/non-profits-sector/not-for-profit-organizations"
              target="_blank"
              rel="noreferrer"
              title={!isMobileNav && collapsed ? "Documentation" : undefined}
            >
              <span className="sidebar__icon-chip icon-chip-gray">
                <HelpCircle size={14} />
              </span>
              <span className="sidebar__label">Documentation</span>
            </a>
          </nav>
        </aside>

        <div className="main">
          <DemoBanner />
          <Outlet />
        </div>
      </div>
    </>
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
