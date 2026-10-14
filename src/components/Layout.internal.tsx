// Private sub-components/helpers/consts/nav config for Layout.tsx (sidebar, nav groups, safe wrappers).

import { Link } from "react-router-dom";
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
import { DeferredCommandPalette, DeferredAiAssistant } from "./DeferredShellOverlays";
import { DraftMinutesPicker } from "./DraftMinutesPicker";
import { GlobalTaskCreate } from "@/features/tasks/GlobalTaskCreate";
import { GlobalAssetCreate } from "@/features/assets/GlobalAssetCreate";
import { ShortcutHelp } from "./ShortcutHelp";
import { NotificationBell } from "./NotificationBell";
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
import { NAV_ITEM_LABEL_KEYS } from "../i18n/navLabels";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { PageSkeleton } from "./PageSkeleton";
import { useThemePreference } from "../hooks/useThemePreference";
import { useOperationsDeskVisibility } from "../hooks/useOperationsDeskVisibility";
import { useAiChatVisibility } from "../hooks/useAiChatVisibility";
import type { ThemePreference } from "../lib/theme";
import { applyResolvedTheme } from "../lib/theme";
import { mobileSidebarMediaQuery } from "../lib/breakpoints";
import { DEFAULT_PINNED_ROUTES } from "../lib/navConfig";
import { RESOLVED_NAV_TREE, navParentForPath, navRouteForPath } from "../lib/navTree";
import { useUIStore, type PinnedView } from "../lib/store";
import { getDesktopBridge } from "../lib/desktopBridge";
import { useToast } from "./Toast";
import { Tooltip } from "./Tooltip";


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
  const { preference, setPreference } = useThemePreference();

  return (
    <div
      className="sidebar-theme-toggle"
      role="group"
      aria-label="Theme preference"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <Tooltip key={value} content={label}>
          <button
            type="button"
            className={`sidebar-theme-toggle__btn${preference === value ? " is-active" : ""}`}
            onClick={() => setPreference(value)}
            aria-label={label}
            aria-pressed={preference === value}
          >
            <Icon size={12} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}


function CommandPaletteSafe() {
  return (
    <ErrorBoundary label="CommandPalette" fallback={null}>
      <DeferredCommandPalette />
    </ErrorBoundary>
  );
}


function GlobalAiAssistantSafe() {
  return (
    <ErrorBoundary label="GlobalAiAssistant" fallback={null}>
      <DeferredAiAssistant />
    </ErrorBoundary>
  );
}


/** Route-loading fallback: the shared page skeleton (header, stat row, table). */
function WorkbenchPageLoader() {
  return (
    <div className="page">
      <PageSkeleton variant="table" />
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
  labelByEntityKind?: Partial<Record<"society" | "corporation", string>>;
  labelOutsideBc?: string;
  labelForBcCompany?: string;
  /** Privacy routes resolve their label from the privacy profile. */
  privacyMode?: "policy" | "training";
  icon: LucideIcon;
  color: IconTone;
  end?: boolean;
  module?: ModuleKey;
  entityKinds?: ("society" | "corporation")[];
  permission?: string;
  /** Label inside the tree only (e.g. "Overview" for Financials under Finance). */
  treeLabel?: string;
};


/** A visible L1 parent and the L2 items under it. */
type VisibleNavParent = {
  kind: "parent";
  id: string;
  label: string;
  i18nKey?: string;
  icon: LucideIcon;
  color: IconTone;
  defaultOpen?: boolean;
  children: NavItem[];
};

type VisibleNavEntry = { kind: "item"; item: NavItem } | VisibleNavParent;

/**
 * Resolve a route into a NavItem by reading icon/color/label/module from the
 * single-source-of-truth registry. The tree in `navConfig.ts` is validated at
 * module load (`navTree.ts`), so a typo fails before the sidebar renders.
 */

function navItem(to: string, end?: boolean): NavItem {
  const id = getRouteIdentity(to);
  if (!id) {
    throw new Error(`routeIdentity: no entry for ${to}. Add it to ROUTE_IDENTITY.`);
  }
  return {
    to,
    label: id.label,
    ...(id.labelByEntityKind ? { labelByEntityKind: id.labelByEntityKind } : {}),
    ...(id.labelOutsideBc ? { labelOutsideBc: id.labelOutsideBc } : {}),
    ...(id.labelForBcCompany ? { labelForBcCompany: id.labelForBcCompany } : {}),
    ...(id.privacyMode ? { privacyMode: id.privacyMode } : {}),
    icon: id.icon,
    color: id.color,
    ...(end ? { end } : {}),
    ...(id.module ? { module: id.module } : {}),
    ...(id.entityKinds ? { entityKinds: id.entityKinds } : {}),
    ...(id.permission ? { permission: id.permission } : {}),
  };
}

/** The sidebar tree with every route resolved to a NavItem (unfiltered). */
const NAV_TREE_ENTRIES: VisibleNavEntry[] = RESOLVED_NAV_TREE.map((node): VisibleNavEntry => {
  if (node.kind === "item") return { kind: "item", item: navItem(node.to, node.end) };
  return {
    kind: "parent",
    id: node.id,
    label: node.label,
    ...(node.i18nKey ? { i18nKey: node.i18nKey } : {}),
    icon: node.icon,
    color: node.tone,
    ...(node.defaultOpen ? { defaultOpen: true } : {}),
    children: node.children.map((child) => ({
      ...navItem(child.to, child.end),
      ...(child.treeLabel ? { treeLabel: child.treeLabel } : {}),
    })),
  };
});


const ALL_NAV_ITEMS = NAV_TREE_ENTRIES.flatMap((entry) => (entry.kind === "item" ? [entry.item] : entry.children));

const ALL_NAV_ITEM_ROUTES = new Set(ALL_NAV_ITEMS.map((item) => item.to));


/**
 * Exactly one nav route is active for a pathname — the most specific one —
 * so Accounting lights up on /app/financials/accounting, not Financials too.
 */
function isNavItemActive(item: NavItem, pathname: string) {
  return navRouteForPath(pathname) === item.to;
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


/** Filter the tree by a visibility predicate; a parent with no visible children disappears. */
function filterNavTree(predicate: (item: NavItem) => boolean): VisibleNavEntry[] {
  return NAV_TREE_ENTRIES.flatMap<VisibleNavEntry>((entry) => {
    if (entry.kind === "item") return predicate(entry.item) ? [entry] : [];
    const children = entry.children.filter(predicate);
    return children.length > 0 ? [{ ...entry, children }] : [];
  });
}


type SidebarMode = "expanded" | "rail" | "hidden";

const SIDEBAR_MODE_KEY = "societyer.sidebar.mode";

const OPEN_PARENTS_KEY = "societyer.sidebar.openParents";

/** Desktop sidebar state. Migrates the old boolean collapse flag to the rail. */
function readStoredSidebarMode(): SidebarMode {
  if (isStaticDemoRuntime()) return "expanded";
  try {
    const stored = localStorage.getItem(SIDEBAR_MODE_KEY);
    if (stored === "expanded" || stored === "rail" || stored === "hidden") return stored;
    return localStorage.getItem(COLLAPSE_KEY) === "1" ? "rail" : "expanded";
  } catch {
    return "expanded";
  }
}

function writeStoredSidebarMode(mode: SidebarMode) {
  if (isStaticDemoRuntime()) return;
  try {
    localStorage.setItem(SIDEBAR_MODE_KEY, mode);
    localStorage.removeItem(COLLAPSE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function readStoredOpenParents(): Record<string, boolean> | null {
  if (isStaticDemoRuntime()) return null;
  try {
    const stored = localStorage.getItem(OPEN_PARENTS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return null;
  }
}

function writeStoredOpenParents(value: Record<string, boolean>) {
  if (isStaticDemoRuntime()) return;
  try {
    localStorage.setItem(OPEN_PARENTS_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Which parents start expanded: the user's remembered choice on desktop (or
 * the defaults the first time), nothing on the phone drawer — and always the
 * parent of the current page.
 */
function getInitialOpenParents(pathname: string, isMobile: boolean): Record<string, boolean> {
  const stored = isMobile ? {} : readStoredOpenParents();
  const base: Record<string, boolean> = stored
    ? { ...stored }
    : Object.fromEntries(
        NAV_TREE_ENTRIES.flatMap((entry) =>
          entry.kind === "parent" && entry.defaultOpen ? [[entry.id, true]] : [],
        ),
      );
  const active = navParentForPath(pathname);
  if (active) base[active.id] = true;
  return base;
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


type RenderNavItemOptions = {
  counts: any;
  label: string;
  isPinned: boolean;
  isActive: boolean;
  /** Set for L2 rows: the parent they collapse into (keyboard ← goes there). */
  parentId?: string;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: NavItem) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>, item: NavItem) => void;
  onTogglePin: (item: NavItem) => void;
  pinActionLabel: string;
};

function renderNavItem(item: NavItem, options: RenderNavItemOptions) {
  const { counts, label, isPinned, isActive, parentId } = options;
  const Icon = item.icon;
  const count = getCount(item.to, counts);
  const isChild = Boolean(parentId);

  return (
    <div key={item.to} className={`sidebar__item-slot${isChild ? " sidebar__item-slot--child" : ""}`}>
      <Link
        to={item.to}
        className={`sidebar__item${isChild ? " sidebar__item--child" : ""}${isActive ? " is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        data-pinned={isPinned || undefined}
        data-nav-row=""
        data-nav-child-of={parentId}
        onContextMenu={(event) => options.onContextMenu(event, item)}
        onKeyDown={(event) => options.onKeyDown(event, item)}
      >
        {!isChild && (
          <TintedIconTile tone={item.color} size="sm" className="sidebar__icon-chip">
            <Icon size={14} />
          </TintedIconTile>
        )}
        <span className="sidebar__label">{label}</span>
        {count != null ? <NavCountPill to={item.to} count={count} /> : counts === undefined ? <NavCountLoadingPill to={item.to} /> : null}
      </Link>
      {/* Tap-to-pin, so pinning is discoverable in the mobile "More" drawer
       * without needing right-click (desktop) or the command palette. A real
       * <button> rendered as a SIBLING of the link — never nested inside the
       * <a> — so it stays a valid, independent, focusable control. */}
      <button
        type="button"
        className="sidebar__pin-toggle"
        aria-label={options.pinActionLabel}
        title={options.pinActionLabel}
        onClick={() => options.onTogglePin(item)}
      >
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
    </div>
  );
}


/** What a sidebar count means, for its tooltip and screen readers. */
function getCountDescription(to: string, count: number): string {
  const n = (one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  switch (to) {
    case "/app/members": return n("active member", "active members");
    case "/app/directors": return n("active director", "active directors");
    case "/app/meetings": return n("meeting this year", "meetings this year");
    case "/app/filings": return n("overdue filing", "overdue filings");
    case "/app/deadlines": return n("open deadline", "open deadlines");
    case "/app/conflicts": return n("open conflict", "open conflicts");
    case "/app/committees": return n("committee", "committees");
    case "/app/goals": return n("open goal", "open goals");
    case "/app/tasks": return n("open task", "open tasks");
    default: return count.toLocaleString();
  }
}

/** Sidebar count badge: the number is visual; the description is announced. */
function NavCountPill({ to, count }: { to: string; count: number }) {
  const description = getCountDescription(to, count);
  return (
    <Pill size="sm" className="sidebar__count" title={description}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">, {description}</span>
    </Pill>
  );
}

/** Routes whose sidebar entry carries a count badge. */
const COUNTED_NAV_ROUTES = new Set([
  "/app/members", "/app/directors", "/app/meetings", "/app/filings", "/app/deadlines",
  "/app/conflicts", "/app/committees", "/app/goals", "/app/tasks",
]);

/**
 * Placeholder while the counts load (A5): "0" before the workspace is read
 * back looked like an empty register.
 */
function NavCountLoadingPill({ to }: { to: string }) {
  if (!COUNTED_NAV_ROUTES.has(to)) return null;
  return (
    <Pill size="sm" className="sidebar__count sidebar__count--loading" title="Loading count">
      <span aria-hidden="true">…</span>
      <span className="sr-only">, loading count</span>
    </Pill>
  );
}

function getCount(to: string, counts: any): number | null {
  if (!counts) return null;
  switch (to) {
    case "/app/members": return counts.members;
    case "/app/directors": return counts.directors;
    // "Meetings 0" beside a register of 142 past meetings read as an empty
    // register; the badge only appears when meetings are scheduled this year.
    case "/app/meetings": return counts.meetingsThisYear || null;
    case "/app/filings": return counts.overdueFilings || null;
    case "/app/deadlines": return counts.openDeadlines || null;
    case "/app/conflicts": return counts.openConflicts || null;
    case "/app/committees": return counts.committees || null;
    case "/app/goals": return counts.openGoals || null;
    case "/app/tasks": return counts.openTasks || null;
    default: return null;
  }
}


export {
  NavCountLoadingPill,
  NotificationBellSafe,
  UserPickerSafe,
  THEME_OPTIONS,
  SidebarThemeToggle,
  CommandPaletteSafe,
  GlobalAiAssistantSafe,
  WorkbenchPageLoader,
  OfflineBellFallback,
  navItem,
  NAV_TREE_ENTRIES,
  ALL_NAV_ITEMS,
  ALL_NAV_ITEM_ROUTES,
  isNavItemActive,
  normalizePinnedRoutes,
  readStoredPinnedRoutes,
  getPinnedNav,
  filterNavTree,
  getInitialOpenParents,
  readStoredSidebarMode,
  writeStoredSidebarMode,
  writeStoredOpenParents,
  SIDEBAR_MODE_KEY,
  OPEN_PARENTS_KEY,
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
  NavCountPill,
};

export type {
  NavItem,
  VisibleNavEntry,
  VisibleNavParent,
  SidebarMode,
  FavoriteRef,
  SidebarContextMenu,
};
