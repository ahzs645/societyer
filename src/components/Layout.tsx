import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  Building2,
  Users,
  UserCog,
  CalendarCheck,
  FileText,
  FileJson,
  ClipboardList,
  AlertTriangle,
  PiggyBank,
  Shield,
  Settings,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  UsersRound,
  Target,
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
  Layers,
  Keyboard,
} from "lucide-react";
import {
  ComponentType,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { DemoBanner } from "./DemoBanner";
import { DraftMinutesPicker } from "./DraftMinutesPicker";
import { GlobalTaskCreate } from "@/features/tasks/GlobalTaskCreate";
import { GlobalAssetCreate } from "@/features/assets/GlobalAssetCreate";
import { GlobalMeetingCreate } from "@/features/meetings/components/GlobalMeetingCreate";
import { GlobalCommitmentCreate } from "@/features/commitments/GlobalCommitmentCreate";
import { ShortcutHelp } from "./ShortcutHelp";
import { NotificationBell } from "./NotificationBell";
import { openGlobalAiAssistant } from "../features/ai/aiAssistantEvents";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useLocalWorkspaceReady } from "../hooks/useLocalWorkspaceReady";
import { useDialogFocus } from "../lib/useDialogFocus";
import { useMediaQuery, useSheetDrag } from "../lib/useSheetDrag";
import { useKeyboardInsetTracking } from "../lib/useVisualViewportBottomInset";
import { backdropDismissProps } from "../lib/floatingLayer";
import { UserPicker } from "./UserPicker";
import { RouteAccessGate } from "./RouteAccessGate";
import { InspectorHost, InspectorProvider } from "./InspectorPanel";
import { MenuRow, MenuSectionLabel, Pill, TintedIconTile } from "./ui";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { getRouteIdentity, routeAllowedForEntityKind, routeLabelForOrganization, type IconTone, type LucideIcon } from "../lib/routeIdentity";
import { organizationKind } from "../../shared/organizationDomain";
import { useStaticCommands } from "../lib/useStaticCommands";
import { useTranslation } from "react-i18next";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { useThemePreference } from "../hooks/useThemePreference";
import { useOperationsDeskVisibility } from "../hooks/useOperationsDeskVisibility";
import { useAiChatVisibility } from "../hooks/useAiChatVisibility";
import type { ThemePreference } from "../lib/theme";
import { applyResolvedTheme } from "../lib/theme";
import { mobileMediaQuery, mobileSidebarMediaQuery } from "../lib/breakpoints";
import { DEFAULT_PINNED_ROUTES } from "../lib/navConfig";
import { useUIStore, type PinnedView } from "../lib/store";
import { getDesktopBridge } from "../lib/desktopBridge";
import { createDesktopBackup } from "../lib/desktopBackup";
import { useToast } from "./Toast";

import {
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
  NavCountLoadingPill,
  NavCountPill,
} from "./Layout.internal";
import type {
  NavItem,
  VisibleNavEntry,
  VisibleNavParent,
  SidebarMode,
  FavoriteRef,
  SidebarContextMenu,
} from "./Layout.internal";
import {
  SidebarAreaSwitcher,
  SidebarNavTree,
  SidebarRail,
  SidebarRailAreaButton,
  filterEntriesForArea,
  SidebarThemeCycleButton,
  handleSidebarNavKeyDown,
  type RailFavorite,
} from "./SidebarNav";
import { SetupPill } from "./SetupPill";
import { SetupReturnBanner } from "./SetupReturnBanner";
import { GroupBySpotlight } from "./GroupBySpotlight";
import { Tooltip } from "./Tooltip";
import { ShortcutHint } from "./ShortcutHint";
import { openShortcutHelp } from "./ShortcutHelp";
import { navParentForPath, navRouteForPath } from "../lib/navTree";
import { useGoToShortcuts } from "../hooks/useGoToShortcuts";
import { useAnchorReveal } from "../hooks/useAnchorReveal";
import { useNavAreaShell, useSwitchNavArea } from "../hooks/useNavArea";
import { todayDateOnly } from "../../shared/dateOnly";
import { BottomNavIndicator } from "./BottomNavIndicator";
import { PendingInvitations } from "./PendingInvitations";

export function Layout() {
  const { society, societies } = useSocietySelection();
  const { t } = useTranslation();
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [isMobileNav, setIsMobileNav] = useState(() =>
    window.matchMedia(mobileSidebarMediaQuery).matches,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Phones (<= 768px): "More" is a bottom sheet rather than the tablet's
  // left drawer. It opens at ~85% of the screen and drags up to full height.
  const isPhone = useMediaQuery(mobileMediaQuery);
  const [navSheetExpanded, setNavSheetExpanded] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  // Mobile "More" drawer: favorites management is behind an explicit Edit mode
  // (declutters rows), and the 90+-item nav catalog gets a local filter.
  const [favoritesEditing, setFavoritesEditing] = useState(false);
  const [navFilter, setNavFilter] = useState("");
  // Tracks a touch on the mobile drawer so a decisive left-swipe can dismiss it.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  // Desktop sidebar: full tree, a 56px icon rail, or hidden (focus mode).
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(readStoredSidebarMode);
  // Where "show sidebar" returns to after focus mode.
  const lastVisibleModeRef = useRef<Exclude<SidebarMode, "hidden">>(
    sidebarMode === "rail" ? "rail" : "expanded",
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
  // Expanded L1 parents. Desktop remembers the user's choice; the phone
  // drawer starts collapsed so the catalog reads as a short list of sections.
  // Either way the current page's parent is open.
  const [openParents, setOpenParents] = useState<Record<string, boolean>>(() =>
    getInitialOpenParents(window.location.pathname, isMobileNav),
  );
  const railFlyoutRef = useRef<((id: string, focusFirst: boolean) => void) | null>(null);
  useGoToShortcuts();
  // `#id` links and deep links open the fold hiding their target.
  useAnchorReveal();
  const { area: navArea, labels: navAreaLabels } = useNavAreaShell();
  const switchNavArea = useSwitchNavArea();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceAnchor, setWorkspaceAnchor] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  // Free-text filter for the entity switcher — shown once the list is long
  // enough to be worth narrowing (Corporify's "find any entity instantly").
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [navContextMenu, setNavContextMenu] = useState<SidebarContextMenu | null>(null);
  const { hidden: operationsDeskHidden, setHidden: setOperationsDeskHidden } =
    useOperationsDeskVisibility();
  const { hidden: aiChatHidden } = useAiChatVisibility();
  const [operationsDeskMenu, setOperationsDeskMenu] = useState<
    { top: number; left: number } | null
  >(null);
  // Open on phones/tablets, the drawer is a modal dialog: focus moves in,
  // Tab stays inside, Escape closes, and focus goes back to the More tab.
  const sidebarRef = useDialogFocus<HTMLElement>(isMobileNav && mobileSidebarOpen, () => setMobileSidebarOpen(false));
  const brandNameId = useId();
  const mainRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const workbenchContentRef = useRef<HTMLDivElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const navContextMenuRef = useRef<HTMLDivElement | null>(null);
  const operationsDeskMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const cleanupTheme = bridge.onNativeThemeChanged((state) => {
      const preference = localStorage.getItem("societyer:theme");
      if (preference && preference !== "system") return;
      applyResolvedTheme(state.shouldUseDarkColors ? "dark" : "light");
    });
    const cleanupMenu = bridge.onMenuAction((action) => {
      if (action === "create-backup") {
        void createDesktopBackup()
          .then((result) => {
            toast.success("Backup created", {
              description: result.path,
              action: {
                label: "Open",
                onClick: () => {
                  void bridge.openBackupFolder(result.path);
                },
              },
            });
          })
          .catch((error) => {
            toast.error("Backup failed", error instanceof Error ? error.message : undefined);
          });
      } else if (action === "open-settings") {
        navigate("/app/settings");
      } else if (action === "open-workspace") {
        void bridge.openWorkspaceFolder().catch((error) => {
          toast.error("Could not open workspace", error instanceof Error ? error.message : undefined);
        });
      } else if (action === "open-logs") {
        void bridge.openLogFolder().catch((error) => {
          toast.error("Could not open logs", error instanceof Error ? error.message : undefined);
        });
      } else if (action === "check-services") {
        void bridge
          .listServiceStatuses()
          .then((services) => {
            const available = services.filter((service) => service.ok).length;
            toast.info("Service check complete", `${available}/${services.length} optional services available.`);
          })
          .catch((error) => {
            toast.error("Service check failed", error instanceof Error ? error.message : undefined);
          });
      } else if (action === "check-for-updates") {
        void bridge
          .checkForUpdate()
          .then((state) => {
            if (state.status === "available") toast.success("Update available", state.availableVersion);
            else if (state.status === "error") toast.error("Update check failed", state.error);
            else toast.info("Update status checked", state.reason);
          })
          .catch((error) => {
            toast.error("Update check failed", error instanceof Error ? error.message : undefined);
          });
      } else if (action === "export-workspace") {
        import("../lib/localWorkspaceExport")
          .then(async ({ downloadLocalWorkspaceSnapshot }) => {
            await downloadLocalWorkspaceSnapshot(`societyer-workspace-${todayDateOnly()}.json`);
            toast.success("Workspace export started");
          })
          .catch((error) => {
            toast.error("Workspace export failed", error instanceof Error ? error.message : undefined);
        });
      }
    });
    const logError = (message: string, details: Record<string, unknown>) => {
      void bridge.logRendererEvent({ level: "error", message, details }).catch(() => {});
    };
    const handleError = (event: ErrorEvent) => {
      logError("renderer window error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      logError("renderer unhandled rejection", {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      cleanupTheme();
      cleanupMenu();
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [navigate, toast]);

  useEffect(() => {
    writeStoredSidebarMode(sidebarMode);
    if (sidebarMode !== "hidden") lastVisibleModeRef.current = sidebarMode;
  }, [sidebarMode]);

  // Keep the current page's parent open as the user navigates. We only
  // force-open — never auto-close — so user-collapsed parents stay that way.
  useEffect(() => {
    const activeParent = navParentForPath(loc.pathname);
    if (!activeParent) return;
    setOpenParents((prev) => (prev[activeParent.id] ? prev : { ...prev, [activeParent.id]: true }));
  }, [loc.pathname]);

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
  const unpinView = useUIStore((s) => s.unpinView);
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
      // Shift turns "\\" into "|" on most layouts; the physical key is the same.
      const isBackslash = e.key === "\\" || e.key === "|" || e.code === "Backslash";
      if ((e.metaKey || e.ctrlKey) && isBackslash) {
        e.preventDefault();
        if (isMobileNav) {
          setMobileSidebarOpen((v) => !v);
        } else if (e.shiftKey) {
          // Focus mode: hide the sidebar entirely, or bring it back as it was.
          setSidebarMode((mode) => (mode === "hidden" ? lastVisibleModeRef.current : "hidden"));
        } else {
          setSidebarMode((mode) => (mode === "expanded" ? "rail" : "expanded"));
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

  // Closing the drawer resets its transient UI (edit mode, nav filter) so it
  // reopens in the clean browse state.
  useEffect(() => {
    if (!mobileSidebarOpen) {
      setFavoritesEditing(false);
      setNavFilter("");
      setNavSheetExpanded(false);
    }
  }, [mobileSidebarOpen]);

  // The page behind the open drawer/sheet leaves the tab order and the AT
  // tree (focus trap, Escape and focus return: useDialogFocus above).
  useEffect(() => {
    if (!isMobileNav || !mobileSidebarOpen) return;
    const main = mainRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    main?.setAttribute("aria-hidden", "true");
    if (main) main.inert = true;
    return () => {
      main?.removeAttribute("aria-hidden");
      if (main) main.inert = false;
    };
  }, [isMobileNav, mobileSidebarOpen]);

  // Phone sheet: pull the grabber or header (or the list, once scrolled to
  // its top) down to dismiss; pull the grabber or header up for full height.
  const isNavSheet = isMobileNav && isPhone;
  useSheetDrag(sidebarRef, {
    enabled: isNavSheet && mobileSidebarOpen,
    onDismiss: () => setMobileSidebarOpen(false),
    expand: {
      expanded: navSheetExpanded,
      onExpandedChange: setNavSheetExpanded,
      handle: ".sheet-grabber, .sidebar__brand",
    },
  });
  // The sheet sits on the on-screen keyboard while the nav filter has focus
  // (--keyboard-inset / --visible-height on <html>).
  useKeyboardInsetTracking(isNavSheet && mobileSidebarOpen);

  // Opening the phone drawer brings the current page's section into view: its
  // heading sits just under the pinned filter, or, in a long section, the
  // current page sits near the bottom of the view. The section is already
  // expanded (openParents follows the route).
  useEffect(() => {
    if (!isMobileNav || !mobileSidebarOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const nav = sidebarRef.current?.querySelector<HTMLElement>(".sidebar__nav");
      const row = nav?.querySelector<HTMLElement>('.sidebar__tree [aria-current="page"]');
      if (!nav || !row) return;
      const navTop = nav.getBoundingClientRect().top;
      const toContent = (el: Element) => el.getBoundingClientRect().top - navTop + nav.scrollTop;
      const pinnedHeight = nav.querySelector<HTMLElement>(".sidebar__drawer-search")?.offsetHeight ?? 0;
      const heading = row.closest(".sidebar__parent")?.querySelector(".sidebar__group-toggle") ?? row;
      const rowBottom = toContent(row) + row.offsetHeight;
      const visibleTop = nav.scrollTop + pinnedHeight;
      const visibleBottom = nav.scrollTop + nav.clientHeight;
      if (toContent(heading) >= visibleTop && rowBottom <= visibleBottom) return;
      let target = toContent(heading) - pinnedHeight - 8;
      if (rowBottom - target > nav.clientHeight) target = rowBottom - nav.clientHeight + 16;
      nav.scrollTop = Math.max(0, target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobileNav, mobileSidebarOpen, sidebarRef]);

  // Keep the persistent mobile top bar out of the tab order + AT tree while a
  // drawer (sidebar or inspector) is open over it — mirrors the main/workbench
  // inert treatment. NotificationBell can't take a tabIndex prop, so inert is
  // the clean way to also cover the bell.
  useEffect(() => {
    const topbar = topbarRef.current as (HTMLElement & { inert?: boolean }) | null;
    if (!topbar) return;
    const hidden = isMobileNav && (mobileSidebarOpen || mobileInspectorOpen);
    if (hidden) topbar.setAttribute("aria-hidden", "true");
    else topbar.removeAttribute("aria-hidden");
    topbar.inert = hidden;
  }, [isMobileNav, mobileSidebarOpen, mobileInspectorOpen]);

  useEffect(() => {
    if (!isMobileNav || !mobileInspectorOpen) return;
    const content = workbenchContentRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    content?.setAttribute("aria-hidden", "true");
    if (content) content.inert = true;
    return () => {
      content?.removeAttribute("aria-hidden");
      if (content) content.inert = false;
    };
  }, [isMobileNav, mobileInspectorOpen]);

  useEffect(() => {
    if (!workspaceOpen) return;
    setWorkspaceFilter("");
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

  useEffect(() => {
    if (!operationsDeskMenu) return;
    const onDown = (event: MouseEvent) => {
      if (operationsDeskMenuRef.current?.contains(event.target as Node)) return;
      setOperationsDeskMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOperationsDeskMenu(null);
    };
    const close = () => setOperationsDeskMenu(null);
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
  }, [operationsDeskMenu]);

  const rawCounts = useQuery(api.dashboard.navCounts, society ? { societyId: society._id } : "skip");
  // Before the local workspace is read back from IndexedDB, queries answer
  // from the bundled seed: a restored workspace's counts read 0 (A5). Treat
  // them as loading until the workspace is ready.
  const localWorkspaceReady = useLocalWorkspaceReady();
  const counts = localWorkspaceReady ? rawCounts : undefined;
  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes]);
  const pinnedNav = useMemo(() => getPinnedNav(pinnedRoutes), [pinnedRoutes]);
  const entityKind = useMemo(() => (society ? organizationKind(society as any) : null), [society]);
  const { can } = usePermissions();
  // The firm-wide Portfolio rolls up multiple entities; with a single entity it
  // has nothing to aggregate, so hide its sidebar nav item (the switcher's
  // "All entities" row is gated the same way).
  const isMultiEntity = (societies?.length ?? 0) > 1;
  const navAllowedForEntityCount = (item: NavItem) =>
    item.to !== "/app/portfolio" || isMultiEntity;
  const visiblePinnedNav = useMemo(
    () =>
      pinnedNav.filter(
        (item) =>
          (!item.module || isModuleEnabled(society, item.module)) &&
          routeAllowedForEntityKind(item, entityKind) &&
          navAllowedForEntityCount(item) &&
          (!item.permission || can(item.permission)),
      ),
    [pinnedNav, society, entityKind, isMultiEntity, can],
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
  // The two-level tree, minus pages this organization can't use. A parent
  // whose children are all hidden disappears with them. A pinned top-level
  // page (Dashboard) already sits in Favorites, so it isn't repeated; pages
  // inside a section stay in place so the section reads complete.
  const visibleNavTree = useMemo(
    () =>
      filterNavTree(
        (item) =>
          (!item.module || isModuleEnabled(society, item.module)) &&
          routeAllowedForEntityKind(item, entityKind) &&
          navAllowedForEntityCount(item) &&
          (!item.permission || can(item.permission)),
      ).filter((entry) => entry.kind !== "item" || !pinnedRouteSet.has(entry.item.to)),
    [society, entityKind, isMultiEntity, can, pinnedRouteSet],
  );
  const getNavItemLabel = (item: NavItem) => {
    const label = routeLabelForOrganization(item, society as any);
    return t(NAV_ITEM_LABEL_KEYS[label] ?? label, label);
  };
  /** Label for a row inside the tree (e.g. Financials reads "Overview" under Finance). */
  const getTreeItemLabel = (item: NavItem) =>
    item.treeLabel ? t(`nav.tree.${item.treeLabel.toLowerCase()}`, item.treeLabel) : getNavItemLabel(item);
  const getParentLabel = (entry: VisibleNavParent) =>
    entry.i18nKey ? t(entry.i18nKey, entry.label) : entry.label;
  const activeNavRoute = navRouteForPath(loc.pathname);
  const isRail = !isMobileNav && sidebarMode === "rail";
  // Nav filter: matches L1 and L2 labels (translated, plus the page's own name
  // for relabelled rows). A matching parent keeps all its pages; otherwise only
  // the matching pages show, and every remaining parent renders expanded.
  const navFilterQuery = navFilter.trim().toLowerCase();
  // The area switcher narrows the tree; typing in the filter searches every area.
  const areaNavTree = filterEntriesForArea(visibleNavTree, navArea);
  // Phones: the bottom bar shows the first four pinned pages, so the More
  // drawer's Favorites leaves them out (they come back while editing, so the
  // order can still be changed).
  const bottomBarRoutes = new Set(isMobileNav ? visiblePinnedNav.slice(0, 4).map((item) => item.to) : []);
  // The Operations desk links Tasks and Deadlines with their counts. In the
  // drawer those pages already sit in the bottom bar, Favorites or the tree
  // with the same counts, so it only repeats them, unless it is carrying the
  // deadlines "Set up" hint.
  const drawerRoutes = new Set(visiblePinnedNav.map((item) => item.to));
  for (const entry of areaNavTree) {
    if (entry.kind === "item") drawerRoutes.add(entry.item.to);
    else for (const child of entry.children) drawerRoutes.add(child.to);
  }
  const deadlinesNeedSetup = Boolean(
    counts && counts.openDeadlines === 0 && society && (!society.incorporationDate || !society.fiscalYearEnd),
  );
  const operationsDeskRepeatsNav =
    isMobileNav && !deadlinesNeedSetup && drawerRoutes.has("/app/tasks") && drawerRoutes.has("/app/deadlines");
  const displayedNavTree: VisibleNavEntry[] = navFilterQuery
    ? visibleNavTree.flatMap<VisibleNavEntry>((entry) => {
        const matches = (item: NavItem) =>
          getTreeItemLabel(item).toLowerCase().includes(navFilterQuery) ||
          getNavItemLabel(item).toLowerCase().includes(navFilterQuery);
        if (entry.kind === "item") return matches(entry.item) ? [entry] : [];
        if (getParentLabel(entry).toLowerCase().includes(navFilterQuery)) return [entry];
        const children = entry.children.filter(matches);
        return children.length > 0 ? [{ ...entry, children }] : [];
      })
    : areaNavTree;
  const setParentOpen = (id: string, open: boolean) => {
    setOpenParents((prev) => {
      if (Boolean(prev[id]) === open) return prev;
      const next = { ...prev, [id]: open };
      if (!isMobileNav) writeStoredOpenParents(next);
      return next;
    });
  };
  const isSidebarCollapsed = isMobileNav ? !mobileSidebarOpen : sidebarMode === "hidden";
  const shellClassName = useMemo(() => {
    let value = "app-shell";
    if (isSidebarCollapsed) value += " is-collapsed";
    if (isRail) value += " is-rail";
    if (isMobileNav) value += " is-mobile";
    if (isMobileNav && mobileSidebarOpen) value += " is-mobile-nav-open";
    if (isMobileNav && favoritesEditing) value += " is-favorites-editing";
    return value;
  }, [isMobileNav, isSidebarCollapsed, isRail, mobileSidebarOpen, favoritesEditing]);

  const mobileOverlayOpen = isMobileNav && (mobileSidebarOpen || mobileInspectorOpen);

  const openSidebar = () => {
    if (isMobileNav) {
      setMobileSidebarOpen(true);
    } else {
      setSidebarMode(lastVisibleModeRef.current);
    }
  };

  const toggleSidebar = () => {
    if (isMobileNav) {
      setMobileSidebarOpen((v) => !v);
    } else {
      setSidebarMode((mode) => (mode === "expanded" ? "rail" : "expanded"));
    }
  };

  const togglePinnedFavorite = (ref: FavoriteRef) => {
    if (ref.kind === "route") {
      setPinnedRoutes((prev) => {
        if (prev.includes(ref.id)) return prev.filter((route) => route !== ref.id);
        return normalizePinnedRoutes([...prev, ref.id]);
      });
    } else if (ref.kind === "command") {
      // From this menu we only ever see already-pinned commands (the menu is
      // only triggered from the favorites bar), so this is effectively unpin.
      setPinnedCommandIds((prev) => prev.filter((id) => id !== ref.id));
    } else {
      unpinView(ref.viewsKey, ref.viewId);
    }
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

  // Move a favorite to an absolute target index (splice out, insert at target).
  // The mobile reorder controls use this to step OVER hidden favorites.
  const moveFavoriteToIndex = (fromIndex: number, toIndex: number) => {
    setFavoritesOrder((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  // A favorite row only renders when its target is currently visible (module /
  // permission / entity gating). Reorder eligibility and the disabled state must
  // be computed against the VISIBLE sequence — otherwise the arrows step onto a
  // hidden row and appear to do nothing.
  const isFavoriteVisible = (ref: FavoriteRef) => {
    if (ref.kind === "route") return visiblePinnedNav.some((nav) => nav.to === ref.id);
    if (ref.kind === "command") return visiblePinnedCommands.some((cmd) => cmd.id === ref.id);
    return pinnedViews.some((view) => view.viewsKey === ref.viewsKey && view.viewId === ref.viewId);
  };

  // The icon rail shows favorites as icons only (no drag, no controls).
  const railFavorites: RailFavorite[] = favoritesOrder.flatMap<RailFavorite>((ref) => {
    if (ref.kind === "route") {
      const item = visiblePinnedNav.find((nav) => nav.to === ref.id);
      if (!item) return [];
      const Icon = item.icon;
      return [{
        key: favoriteRefKey(ref),
        label: getNavItemLabel(item),
        icon: (
          <TintedIconTile tone={item.color} size="sm" className="sidebar__icon-chip">
            <Icon size={14} />
          </TintedIconTile>
        ),
        to: item.to,
        active: isNavItemActive(item, loc.pathname),
      }];
    }
    if (ref.kind === "view") {
      const view = pinnedViews.find((pv) => pv.viewsKey === ref.viewsKey && pv.viewId === ref.viewId);
      if (!view) return [];
      return [{
        key: favoriteRefKey(ref),
        label: view.label,
        icon: (
          <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
            <Pin size={12} />
          </TintedIconTile>
        ),
        to: `${view.to}?view=${view.viewId}`,
        active: loc.pathname === view.to,
      }];
    }
    const command = visiblePinnedCommands.find((cmd) => cmd.id === ref.id);
    if (!command) return [];
    const Icon = command.icon;
    return [{
      key: favoriteRefKey(ref),
      label: command.label,
      icon: (
        <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
          <Icon size={14} />
        </TintedIconTile>
      ),
      run: () => { void command.run(); },
      active: false,
    }];
  });

  // Touch has no drag-reorder or right-click, so each favorite row gets explicit
  // up/down/unpin controls on mobile. These are real <button>s rendered as a
  // SIBLING of the row (see the favorites map), never nested inside the row's
  // link/button — so they stay valid, focusable, independent controls.
  const renderFavoriteControls = (ref: FavoriteRef, index: number) => {
    const visibleIndices = favoritesOrder.reduce<number[]>((acc, favRef, i) => {
      if (isFavoriteVisible(favRef)) acc.push(i);
      return acc;
    }, []);
    const pos = visibleIndices.indexOf(index);
    const canMoveUp = pos > 0;
    const canMoveDown = pos >= 0 && pos < visibleIndices.length - 1;
    return (
      <span className="sidebar__fav-controls">
        <Tooltip content={t("sidebar.moveUp", "Move up")}>
          <button
            type="button"
            className="sidebar__fav-btn"
            aria-label={t("sidebar.moveUp", "Move up")}
            disabled={!canMoveUp}
            onClick={() => moveFavoriteToIndex(index, visibleIndices[pos - 1])}
          >
            <ChevronUp size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t("sidebar.moveDown", "Move down")}>
          <button
            type="button"
            className="sidebar__fav-btn"
            aria-label={t("sidebar.moveDown", "Move down")}
            disabled={!canMoveDown}
            onClick={() => moveFavoriteToIndex(index, visibleIndices[pos + 1])}
          >
            <ChevronDown size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t("sidebar.unpinFromFavorites")}>
          <button
            type="button"
            className="sidebar__fav-btn"
            aria-label={t("sidebar.unpinFromFavorites")}
            onClick={() => togglePinnedFavorite(ref)}
          >
            <PinOff size={14} />
          </button>
        </Tooltip>
      </span>
    );
  };

  const openFavoriteContextMenu = (
    ref: FavoriteRef,
    label: string,
    openInNewTabTarget: string | undefined,
    x: number,
    y: number,
  ) => {
    const position = getSidebarMenuPosition(x, y);
    setNavContextMenu({
      ref,
      label,
      top: position.top,
      left: position.left,
      openInNewTabTarget,
    });
    setWorkspaceOpen(false);
  };

  const isContextMenuKey = (event: ReactKeyboardEvent<HTMLElement>) =>
    event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

  const handleNavItemContextMenu = (event: ReactMouseEvent<HTMLElement>, item: NavItem) => {
    event.preventDefault();
    event.stopPropagation();
    openFavoriteContextMenu(
      { kind: "route", id: item.to },
      getNavItemLabel(item),
      item.to,
      event.clientX,
      event.clientY,
    );
  };

  const handleNavItemKeyDown = (event: ReactKeyboardEvent<HTMLElement>, item: NavItem) => {
    if (!isContextMenuKey(event)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openFavoriteContextMenu(
      { kind: "route", id: item.to },
      getNavItemLabel(item),
      item.to,
      rect.left + 28,
      rect.bottom - 2,
    );
  };

  const handleCommandContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    commandId: string,
    label: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openFavoriteContextMenu(
      { kind: "command", id: commandId },
      label,
      undefined,
      event.clientX,
      event.clientY,
    );
  };

  const handleCommandKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    commandId: string,
    label: string,
  ) => {
    if (!isContextMenuKey(event)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openFavoriteContextMenu(
      { kind: "command", id: commandId },
      label,
      undefined,
      rect.left + 28,
      rect.bottom - 2,
    );
  };

  const handleViewContextMenu = (event: ReactMouseEvent<HTMLElement>, view: PinnedView) => {
    event.preventDefault();
    event.stopPropagation();
    openFavoriteContextMenu(
      { kind: "view", viewsKey: view.viewsKey, viewId: view.viewId },
      view.label,
      `${view.to}?view=${view.viewId}`,
      event.clientX,
      event.clientY,
    );
  };

  const handleViewKeyDown = (event: ReactKeyboardEvent<HTMLElement>, view: PinnedView) => {
    if (!isContextMenuKey(event)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openFavoriteContextMenu(
      { kind: "view", viewsKey: view.viewsKey, viewId: view.viewId },
      view.label,
      `${view.to}?view=${view.viewId}`,
      rect.left + 28,
      rect.bottom - 2,
    );
  };

  const handleOperationsDeskContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOperationsDeskMenu(getSidebarMenuPosition(event.clientX, event.clientY));
    setWorkspaceOpen(false);
    setNavContextMenu(null);
  };

  // The Operations desk: under the brand on desktop; in the phone drawer it
  // sits under the nav filter (hidden while filtering) so the filter is the
  // first thing in the drawer.
  const operationsDesk =
    !operationsDeskHidden && !isRail && !operationsDeskRepeatsNav ? (
      <div className={`sidebar__spotlight${spotlightCollapsed ? " is-collapsed" : ""}`}>
        <button
          type="button"
          className="sidebar__spotlight-toggle"
          onClick={() => setSpotlightCollapsed((v) => !v)}
          onContextMenu={handleOperationsDeskContextMenu}
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
              {counts ? <NavCountPill to="/app/tasks" count={counts.openTasks} /> : <Pill size="sm"><span aria-label="Loading" className="muted">…</span></Pill>}
            </NavLink>
            <NavLink
              to="/app/deadlines"
              className={({ isActive }) =>
                `sidebar__spotlight-meta sidebar__spotlight-meta--link${isActive ? " is-active" : ""}`
              }
            >
              <span>{t("sidebar.upcomingDeadlines")}</span>
              {/* P20: "0" looked healthy for an unconfigured workspace;
                  say that deadlines are not computed yet instead. */}
              {!counts ? (
                <Pill size="sm"><span aria-label="Loading" className="muted">…</span></Pill>
              ) : counts.openDeadlines === 0 && society && (!society.incorporationDate || !society.fiscalYearEnd) ? (
                <span title="No deadlines are tracked yet. Add the incorporation date and fiscal year end on the organization profile and record held annual meetings to compute statutory deadlines.">
                  <Pill size="sm" tone="warn">Set up</Pill>
                </span>
              ) : (
                <NavCountPill to="/app/deadlines" count={counts.openDeadlines} />
              )}
            </NavLink>
          </>
        )}
      </div>
    ) : null;

  // While filtering on a phone only the matches show: Favorites, the section
  // headings, the area chips and the Operations desk step aside.
  const navFilterOnly = isMobileNav && Boolean(navFilterQuery);
  // With ~95 routes, type-to-jump beats scrolling. Matches L1 and L2 labels;
  // matching sections expand.
  const navFilterField = (
    <div className="sidebar__nav-filter">
      <Search size={isMobileNav ? 16 : 13} aria-hidden="true" />
      <input
        type="text"
        value={navFilter}
        onChange={(event) => {
          const value = event.target.value;
          setNavFilter(value);
          const box = event.currentTarget.parentElement;
          const nav = box?.closest<HTMLElement>(".sidebar__nav");
          if (!value || !box || !nav) return;
          // Phones: the filter is pinned at the top, so the matches start
          // right under it. Desktop: the filter sits below Favorites; lift it
          // (and the matches under it) to the top of the scrolling nav.
          if (isMobileNav) {
            nav.scrollTop = 0;
            return;
          }
          const offset = box.getBoundingClientRect().top - nav.getBoundingClientRect().top - 36;
          if (offset > 0) nav.scrollBy({ top: offset });
        }}
        // Phone sheet: typing raises the keyboard, so the sheet takes the
        // full height to keep the matches in view.
        onFocus={isNavSheet ? () => setNavSheetExpanded(true) : undefined}
        placeholder={t("sidebar.filterNav", "Filter navigation…")}
        aria-label={t("sidebar.filterNav", "Filter navigation…")}
      />
      {navFilter && (
        <button
          type="button"
          aria-label={t("common.clear", "Clear")}
          onClick={() => setNavFilter("")}
        >
          <X size={isMobileNav ? 16 : 12} />
        </button>
      )}
    </div>
  );

  return (
    <InspectorProvider>
      <CommandPaletteSafe />
      <DraftMinutesPicker />
      <GlobalTaskCreate />
      <GlobalAssetCreate />
      <GlobalMeetingCreate />
      <GlobalCommitmentCreate />
      <ShortcutHelp />
      <a
        className="skip-link"
        href="#main-content"
        aria-hidden={mobileOverlayOpen || undefined}
        tabIndex={mobileOverlayOpen ? -1 : undefined}
      >
        {t("sidebar.skipToMain", "Skip to main content")}
      </a>
      <div className={shellClassName}>
        {/* Phones: the sheet's scrim stays mounted so it can fade out with
          * the sheet (and with the drag). Tablets: the drawer's scrim button. */}
        {isNavSheet ? (
          <div
            className={`sidebar-backdrop sidebar-backdrop--sheet${mobileSidebarOpen ? " is-open" : ""}`}
            {...backdropDismissProps(() => setMobileSidebarOpen(false))}
          />
        ) : isMobileNav && mobileSidebarOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label={t("sidebar.closeNavigation")}
          />
        )}
        {!isMobileNav && (
          <Tooltip content={<>{t("sidebar.openSidebar")} <ShortcutHint id="hideSidebar" tone="inverse" /></>} placement="right">
            <button
              className="sidebar-peek"
              onClick={openSidebar}
              aria-label={t("sidebar.openSidebar")}
              tabIndex={sidebarMode === "hidden" ? undefined : -1}
            >
              <PanelLeftOpen size={14} />
            </button>
          </Tooltip>
        )}
        <aside
          className={`sidebar${isNavSheet && navSheetExpanded ? " is-expanded" : ""}`}
          ref={sidebarRef}
          role={isMobileNav && mobileSidebarOpen ? "dialog" : undefined}
          aria-modal={isMobileNav && mobileSidebarOpen || undefined}
          // The phone sheet is named after the workspace in its header.
          aria-labelledby={isNavSheet && mobileSidebarOpen && society?.name ? brandNameId : undefined}
          aria-label={isNavSheet && mobileSidebarOpen && society?.name ? undefined : t("sidebar.navigation")}
          tabIndex={isMobileNav && mobileSidebarOpen ? -1 : undefined}
          onTouchStart={isMobileNav && !isNavSheet ? (e) => {
            const touch = e.touches[0];
            swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
          } : undefined}
          onTouchEnd={isMobileNav && !isNavSheet ? (e) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (!start || !mobileSidebarOpen) return;
            const touch = e.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            // A decisive left-swipe (more horizontal than vertical) closes it.
            if (dx < -60 && Math.abs(dx) > Math.abs(dy)) setMobileSidebarOpen(false);
          } : undefined}
        >
          {isNavSheet && <div className="sheet-grabber" aria-hidden="true" />}
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
              {(() => {
                const lightSrc = society?.logoUrl;
                const darkSrc = society?.logoDarkUrl ?? society?.logoUrl;
                const darkNeedsInvert = !society?.logoDarkUrl && !!society?.logoInvertInDarkMode;
                const hasLogo = !!lightSrc;
                return (
                  <div className={`sidebar__brand-logo${hasLogo ? " sidebar__brand-logo--image" : ""}`}>
                    {hasLogo ? (
                      <>
                        <img
                          src={lightSrc}
                          alt=""
                          className="sidebar__brand-logo-img sidebar__brand-logo-img--light"
                        />
                        <img
                          src={darkSrc}
                          alt=""
                          className={`sidebar__brand-logo-img sidebar__brand-logo-img--dark${darkNeedsInvert ? " sidebar__brand-logo-img--invert" : ""}`}
                        />
                      </>
                    ) : (
                      (society?.name ?? "S")[0].toUpperCase()
                    )}
                  </div>
                );
              })()}
              <span className="sidebar__brand-name" id={brandNameId}>{society?.name ?? t("sidebar.selectWorkspace")}</span>
              <span className="sidebar__brand-workspace">
                <ChevronDown size={12} />
              </span>
            </button>
            <div className="sidebar__brand-actions">
              {/* On mobile the bell + search live in the persistent top bar; keep
               * them out of the drawer to avoid duplicate controls. */}
              {!isMobileNav && <NotificationBellSafe />}
              {/* Opens the AI assistant chat over the page. Not a duplicate of
                * the "AI agents" page (where agents are set up). */}
              {!aiChatHidden && (
                <Tooltip content="AI assistant">
                  <button
                    className="sidebar__icon-btn sidebar__ai-btn"
                    onClick={openGlobalAiAssistant}
                    aria-label="Open AI assistant"
                  >
                    <Bot size={14} />
                  </button>
                </Tooltip>
              )}
              {!isMobileNav && (
                <Tooltip content={<>{t("common.search")} <ShortcutHint id="commandPalette" tone="inverse" /></>} placement="bottom">
                  <button
                    className="sidebar__icon-btn"
                    data-command-palette-trigger=""
                    onClick={() => window.dispatchEvent(new Event("kbar:open"))}
                    aria-label={t("common.search")}
                  >
                    <Search size={14} />
                  </button>
                </Tooltip>
              )}
              {/* On mobile the drawer closes via the scrim, a left-swipe, or
                * Escape, so this collapse toggle is redundant — dropping it also
                * unclutters the cramped top bar. */}
              {!isMobileNav && (
                <Tooltip content={<>{t("sidebar.collapse")} {t("sidebar.sidebar")} <ShortcutHint id="toggleSidebar" tone="inverse" /></>} placement="bottom">
                  <button
                    className="sidebar__icon-btn sidebar__toggle"
                    onClick={toggleSidebar}
                    aria-label={`${t("sidebar.collapse")} ${t("sidebar.sidebar")}`}
                  >
                    <PanelLeftClose size={14} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          {/* Phones show the area choice as scope chips under the nav filter. */}
          {!isRail && !isMobileNav && <SidebarAreaSwitcher area={navArea} labels={navAreaLabels} onChange={switchNavArea} />}
          {!isMobileNav && !isRail && (
            <div className="sidebar__setup">
              <SetupPill variant="sidebar" />
            </div>
          )}
          {!isMobileNav && operationsDesk}

          <nav
            className="sidebar__nav"
            aria-label={t("sidebar.navigation")}
            onKeyDown={(event) =>
              handleSidebarNavKeyDown(event, setParentOpen, isRail ? railFlyoutRef.current ?? undefined : undefined)
            }
          >
            {isRail ? (
              <>
                <div className="sidebar-rail__tools">
                  <SidebarRailAreaButton area={navArea} labels={navAreaLabels} onChange={switchNavArea} />
                  <SetupPill variant="rail" />
                  <Tooltip content={<>{t("common.search")} <ShortcutHint id="commandPalette" tone="inverse" /></>} placement="right" delay={250}>
                    <button
                      type="button"
                      className="sidebar-rail__tool"
                      data-command-palette-trigger=""
                      onClick={() => window.dispatchEvent(new Event("kbar:open"))}
                      aria-label={t("common.search")}
                      data-nav-row=""
                    >
                      <Search size={14} />
                    </button>
                  </Tooltip>
                  {!aiChatHidden && (
                    <Tooltip content="AI assistant" placement="right" delay={250}>
                      <button
                        type="button"
                        className="sidebar-rail__tool"
                        onClick={openGlobalAiAssistant}
                        aria-label="AI assistant"
                        data-nav-row=""
                      >
                        <Bot size={14} />
                      </button>
                    </Tooltip>
                  )}
                  <span className="sidebar-rail__bell"><NotificationBellSafe /></span>
                </div>
                <SidebarRail
                  favorites={railFavorites}
                  entries={areaNavTree}
                  activeRoute={activeNavRoute}
                  getParentLabel={getParentLabel}
                  getItemLabel={getTreeItemLabel}
                  renderCount={(item) => {
                    const count = getCount(item.to, counts);
                    return count != null ? <NavCountPill to={item.to} count={count} /> : null;
                  }}
                  flyoutRef={railFlyoutRef}
                />
              </>
            ) : (
            <>
            {/* Phones: the filter leads the drawer and stays pinned while the
              * list scrolls; the area choice rides under it as scope chips. */}
            {isMobileNav && (
              <div className="sidebar__drawer-search">
                {navFilterField}
                {!navFilterQuery && <SidebarAreaSwitcher area={navArea} labels={navAreaLabels} onChange={switchNavArea} />}
              </div>
            )}
            {isMobileNav && !navFilterOnly && operationsDesk}
            {!navFilterOnly && (
            <>
            <div className="sidebar__section sidebar__section--compact sidebar__section--favorites">
              <span>{t("nav.favorites")}</span>
              {/* iOS-style list editing: view mode keeps rows clean; Edit
                * reveals the reorder/unpin (and browse pin) controls. Mobile
                * only — desktop manages favorites via drag + context menu. */}
              {isMobileNav && favoritesOrder.length > 0 && (
                <button
                  type="button"
                  className="sidebar__section-edit"
                  aria-pressed={favoritesEditing}
                  onClick={() => setFavoritesEditing((v) => !v)}
                >
                  {favoritesEditing ? t("common.done", "Done") : t("common.edit", "Edit")}
                </button>
              )}
            </div>
            {/* Phones browse Favorites as a two-column grid of tiles; Edit
              * mode returns to the list so the reorder controls have room.
              * Desktop: `display: contents`, the rows sit in the nav as before. */}
            <div
              className={`sidebar__favorites${isMobileNav && !favoritesEditing ? " sidebar__favorites--grid" : ""}`}
            >
            {favoritesOrder.map((ref, index) => {
              const isDragging = favoriteDragIndex === index;
              const showDropAbove = favoriteDropIndex === index;
              const dropClass = showDropAbove ? " is-drop-above" : "";
              const dragClass = isDragging ? " is-dragging" : "";

              if (ref.kind === "route") {
                const item = visiblePinnedNav.find((nav) => nav.to === ref.id);
                if (!item) return null;
                if (!favoritesEditing && bottomBarRoutes.has(item.to)) return null;
                const Icon = item.icon;
                const count = getCount(item.to, counts);
                const label = getNavItemLabel(item);
                // Rendered as div, not NavLink — Chrome's native link-drag
                // interferes with our HTML5 drag-to-reorder (it tries to drag
                // the URL as a draggable bookmark, sometimes preventing our
                // dragstart from firing or stamping the wrong drag image).
                const isActive = isNavItemActive(item, loc.pathname);
                return (
                  <div key={favoriteRefKey(ref)} className="sidebar__item-slot">
                    <div
                      role="link"
                      tabIndex={0}
                      aria-current={isActive ? "page" : undefined}
                      className={`sidebar__item${isActive ? " is-active" : ""}${dragClass}${dropClass}`}
                      data-pinned
                      data-nav-row=""
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
                      {count != null ? <NavCountPill to={item.to} count={count} /> : counts === undefined ? <NavCountLoadingPill to={item.to} /> : null}
                    </div>
                    {renderFavoriteControls(ref, index)}
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
                  <div key={favoriteRefKey(ref)} className="sidebar__item-slot">
                    <div
                      role="link"
                      tabIndex={0}
                      aria-current={isActive ? "page" : undefined}
                      className={`sidebar__nav-item sidebar__nav-item--view${isActive ? " is-active" : ""}${dragClass}${dropClass}`}
                      data-nav-row=""
                      draggable
                      onClick={() => navigate(target)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(target);
                          return;
                        }
                        handleViewKeyDown(event, view);
                      }}
                      onDragStart={onFavoriteDragStart(index)}
                      onDragOver={onFavoriteDragOver(index)}
                      onDrop={onFavoriteDrop}
                      onDragEnd={onFavoriteDragEnd}
                      onContextMenu={(event) => handleViewContextMenu(event, view)}
                    >
                      <span className="sidebar__nav-icon" aria-hidden="true">
                        <Pin size={12} />
                      </span>
                      <span className="sidebar__nav-label">{view.label}</span>
                    </div>
                    {renderFavoriteControls(ref, index)}
                  </div>
                );
              }

              const command = visiblePinnedCommands.find((cmd) => cmd.id === ref.id);
              if (!command) return null;
              const Icon = command.icon;
              return (
                <div key={favoriteRefKey(ref)} className="sidebar__item-slot">
                  <div
                    role="button"
                    tabIndex={0}
                    className={`sidebar__item sidebar__item--command${dragClass}${dropClass}`}
                    onClick={() => { void command.run(); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void command.run();
                        return;
                      }
                      handleCommandKeyDown(event, command.id, command.label);
                    }}
                    aria-label={command.label}
                    data-nav-row=""
                    draggable
                    onDragStart={onFavoriteDragStart(index)}
                    onDragOver={onFavoriteDragOver(index)}
                    onDrop={onFavoriteDrop}
                    onDragEnd={onFavoriteDragEnd}
                    onContextMenu={(event) => handleCommandContextMenu(event, command.id, command.label)}
                  >
                    <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                      <Icon size={14} />
                    </TintedIconTile>
                    <span className="sidebar__label">{command.label}</span>
                  </div>
                  {renderFavoriteControls(ref, index)}
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
            </div>
            <div className="sidebar__section sidebar__section--compact">
              <span>{navArea === "all" ? t("nav.allRecords") : navAreaLabels[navArea]}</span>
            </div>
            </>
            )}
            {!isMobileNav && navFilterField}
            {navFilterQuery && displayedNavTree.length === 0 && (
              <div className="sidebar__filter-empty">{t("sidebar.noNavMatches", "No matches")}</div>
            )}
            <SidebarNavTree
              entries={displayedNavTree}
              openParents={openParents}
              forceOpen={Boolean(navFilterQuery)}
              activeRoute={activeNavRoute}
              onToggleParent={setParentOpen}
              getParentLabel={getParentLabel}
              renderItem={(item, parentId) =>
                renderNavItem(item, {
                  counts,
                  label: parentId ? getTreeItemLabel(item) : getNavItemLabel(item),
                  isPinned: pinnedRouteSet.has(item.to),
                  isActive: activeNavRoute === item.to,
                  parentId,
                  onContextMenu: handleNavItemContextMenu,
                  onKeyDown: handleNavItemKeyDown,
                  onTogglePin: (navItem) => togglePinnedFavorite({ kind: "route", id: navItem.to }),
                  pinActionLabel: pinnedRouteSet.has(item.to)
                    ? t("sidebar.unpinFromFavorites")
                    : t("sidebar.pinToFavorites"),
                })
              }
            />
            {!navFilterOnly && (
            <>
            <div className="sidebar__section sidebar__section--compact">
              <span>{t("nav.resources")}</span>
            </div>
            <a
              className="sidebar__item"
              href="https://www2.gov.bc.ca/gov/content/employment-business/non-profits-sector/not-for-profit-organizations"
              target="_blank"
              rel="noreferrer"
            >
              <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                <HelpCircle size={14} />
              </TintedIconTile>
              <span className="sidebar__label">{t("nav.documentation")}</span>
            </a>
            {!isMobileNav && (
              <button
                type="button"
                className="sidebar__item sidebar__item--command"
                onClick={openShortcutHelp}
                data-nav-row=""
              >
                <TintedIconTile tone="gray" size="sm" className="sidebar__icon-chip">
                  <Keyboard size={14} />
                </TintedIconTile>
                <span className="sidebar__label">Keyboard shortcuts</span>
                <ShortcutHint id="help" className="sidebar__shortcut" />
              </button>
            )}
            </>
            )}
            </>
            )}
          </nav>
          <div className="sidebar__identity">
            <UserPickerSafe />
            {isRail ? <SidebarThemeCycleButton /> : <SidebarThemeToggle />}
            {isRail && (
              <Tooltip content={<>Expand sidebar <ShortcutHint id="toggleSidebar" tone="inverse" /></>} placement="right" delay={250}>
                <button
                  type="button"
                  className="sidebar-rail__tool"
                  onClick={() => setSidebarMode("expanded")}
                  aria-label={`${t("sidebar.expand")} ${t("sidebar.sidebar")}`}
                >
                  <PanelLeftOpen size={14} />
                </button>
              </Tooltip>
            )}
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
            {societies.length > 7 && (
              <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <input
                  type="text"
                  autoFocus
                  value={workspaceFilter}
                  onChange={(e) => setWorkspaceFilter(e.target.value)}
                  placeholder={t("sidebar.filterEntities")}
                  aria-label={t("sidebar.filterEntities")}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-sm)",
                    background: "var(--bg-subtle)",
                    color: "inherit",
                    fontSize: "var(--fs-sm)",
                  }}
                />
              </div>
            )}
            {societies.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setWorkspaceOpen(false);
                  navigate("/app/portfolio");
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "inherit",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-panel)"; }}
              >
                <Layers size={15} />
                <span style={{ flex: 1 }}>
                  <strong style={{ fontSize: "var(--fs-md)" }}>{t("sidebar.viewAllEntities")}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{t("sidebar.viewAllEntitiesHint")}</div>
                </span>
              </button>
            )}
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              {(() => {
                const wf = workspaceFilter.trim().toLowerCase();
                const list = wf
                  ? societies.filter(
                      (s: any) =>
                        String(s.name ?? "").toLowerCase().includes(wf) ||
                        String(s.incorporationNumber ?? "").toLowerCase().includes(wf),
                    )
                  : societies;
                if (societies.length > 0 && list.length === 0) {
                  return (
                    <div className="empty-state empty-state--sm empty-state--start">
                      {t("sidebar.noMatchingEntities")}
                    </div>
                  );
                }
                return list.map((s: any) => {
                const active = s._id === society?._id;
                return (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => {
                      setStoredSocietyId(s._id);
                      setWorkspaceOpen(false);
                      // The record URL belongs to the workspace being left.
                      navigate("/app");
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
                });
              })()}
              {(!societies || societies.length === 0) && (
                <div className="empty-state empty-state--sm empty-state--start">
                  {t("sidebar.noSocieties")}
                </div>
              )}
            </div>
            <div style={{ padding: 8, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <button
                type="button"
                className="btn btn--accent"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  setWorkspaceOpen(false);
                  navigate("/app/society/new");
                }}
              >
                <Plus size={14} /> {t("sidebar.addWorkspace")}
              </button>
            </div>
          </div>,
          document.body,
        )}

        {navContextMenu && createPortal(
          (() => {
            const ref = navContextMenu.ref;
            const isPinned =
              ref.kind === "route"
                ? pinnedRouteSet.has(ref.id)
                : ref.kind === "command"
                  ? pinnedCommandIds.includes(ref.id)
                  : pinnedViews.some((v) => v.viewsKey === ref.viewsKey && v.viewId === ref.viewId);
            const orderIndex = favoritesOrder.findIndex(
              (entry) => favoriteRefKey(entry) === favoriteRefKey(ref),
            );
            const canMoveUp = orderIndex > 0;
            const canMoveDown = orderIndex >= 0 && orderIndex < favoritesOrder.length - 1;
            const openTarget = navContextMenu.openInNewTabTarget;

            return (
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
                    icon={isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    label={
                      isPinned ? t("sidebar.unpinFromFavorites") : t("sidebar.pinToFavorites")
                    }
                    onClick={() => togglePinnedFavorite(ref)}
                  />
                  {(canMoveUp || canMoveDown) && (
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
                  )}
                  {openTarget && (
                    <>
                      <div className="menu__separator" />
                      <MenuRow
                        role="menuitem"
                        icon={<ExternalLink size={14} />}
                        label={t("sidebar.openInNewTab")}
                        onClick={() => {
                          window.open(openTarget, "_blank", "noopener,noreferrer");
                          setNavContextMenu(null);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })(),
          document.body,
        )}

        {operationsDeskMenu && createPortal(
          <div
            ref={operationsDeskMenuRef}
            className="menu menu--actions sidebar-context-menu"
            role="menu"
            style={{
              top: operationsDeskMenu.top,
              left: operationsDeskMenu.left,
              width: SIDEBAR_MENU_WIDTH,
            }}
          >
            <div className="menu__section">
              <MenuSectionLabel>{t("sidebar.operationsDesk")}</MenuSectionLabel>
              <MenuRow
                role="menuitem"
                icon={<EyeOff size={14} />}
                label={t("sidebar.hideOperationsDesk")}
                onClick={() => {
                  setOperationsDeskHidden(true);
                  setOperationsDeskMenu(null);
                }}
              />
            </div>
          </div>,
          document.body,
        )}

        {isMobileNav && (
          <header ref={topbarRef} className="mobile-topbar">
            <button
              type="button"
              className="mobile-topbar__search"
              onClick={() => window.dispatchEvent(new Event("kbar:open"))}
              aria-label={t("common.search")}
            >
              <Search size={16} />
              <span>{t("common.search")}</span>
            </button>
            <SetupPill variant="topbar" />
            <NotificationBellSafe />
          </header>
        )}

        <div className="main" id="main-content" role="main" ref={mainRef} tabIndex={-1}>
          <div className="workbench">
            <div className="workbench__panel">
              <DemoBanner />
              <SetupReturnBanner />
              <div className="workbench__body">
                <div className="workbench__content" ref={workbenchContentRef}>
                  <Suspense fallback={<WorkbenchPageLoader />}>
                    <PendingInvitations compact />
                    <RouteAccessGate><Outlet /></RouteAccessGate>
                  </Suspense>
                  <GroupBySpotlight />
                </div>
                <InspectorHost onOpenChange={setMobileInspectorOpen} />
              </div>
            </div>
          </div>
        </div>
        {!aiChatHidden && <GlobalAiAssistantSafe />}
        {isMobileNav && (
          <nav
            className="bottom-nav"
            aria-label={t("sidebar.navigation")}
            aria-hidden={mobileOverlayOpen || undefined}
          >
            {/* Icon size 16px matches twenty's icon.size.md — the CSS also
             * clamps to 16px, but passing it through to the SVG avoids the
             * initial over-render before styles kick in. */}
            {/* Every slot except "More" follows the user's pinned routes — the
             * same list that drives the sidebar, already filtered by module /
             * permission / entity, in their pin order. Nothing is hardcoded
             * (Dashboard included), so the bar is fully user-controlled. Capped
             * at 4 so it stays <= 5 with "More"; extra pins live in the More
             * drawer. Pinned *commands* are actions, not destinations, so they're
             * excluded from the nav bar. */}
            {/* While the More sheet/drawer is open, More is the active tab. */}
            <BottomNavIndicator activeKey={mobileSidebarOpen ? "more" : loc.pathname} />
            {visiblePinnedNav.slice(0, 4).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  tabIndex={mobileOverlayOpen ? -1 : undefined}
                  className={({ isActive }) => `bottom-nav__item${isActive && !mobileSidebarOpen ? " is-active" : ""}`}
                >
                  <Icon size={16} />
                  <span>{getNavItemLabel(item)}</span>
                </NavLink>
              );
            })}
            <button
              type="button"
              className={`bottom-nav__item${mobileSidebarOpen ? " is-active" : ""}`}
              tabIndex={mobileOverlayOpen ? -1 : undefined}
              aria-haspopup="dialog"
              aria-expanded={mobileSidebarOpen}
              onClick={(event) => {
                // iOS doesn't focus a tapped button; focus it so closing the
                // sheet hands focus back here.
                event.currentTarget.focus({ preventScroll: true });
                openSidebar();
              }}
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
