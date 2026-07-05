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
  Layers,
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
import { GlobalMeetingCreate } from "./GlobalMeetingCreate";
import { GlobalCommitmentCreate } from "./GlobalCommitmentCreate";
import { ShortcutHelp } from "./ShortcutHelp";
import { NotificationBell } from "./NotificationBell";
import { GlobalAiAssistant, openGlobalAiAssistant } from "../features/ai/GlobalAiAssistant";
import { ErrorBoundary } from "./ErrorBoundary";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { UserPicker } from "./UserPicker";
import { InspectorHost, InspectorProvider } from "./InspectorPanel";
import { MenuRow, MenuSectionLabel, Pill, TintedIconTile } from "./ui";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { getRouteIdentity, routeAllowedForEntityKind, type IconTone, type LucideIcon } from "../lib/routeIdentity";
import { organizationKind } from "../../shared/organizationDomain";
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
} from "./Layout.internal";
import type {
  NavItem,
  NavGroup,
  FavoriteRef,
  SidebarContextMenu,
} from "./Layout.internal";

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
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
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
        void bridge
          .createBackup()
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
          .then(({ downloadLocalWorkspaceSnapshot }) => {
            downloadLocalWorkspaceSnapshot(`societyer-workspace-${new Date().toISOString().slice(0, 10)}.json`);
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

  const counts = useQuery(api.dashboard.navCounts, society ? { societyId: society._id } : "skip");
  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes]);
  const pinnedNav = useMemo(() => getPinnedNav(pinnedRoutes), [pinnedRoutes]);
  const groupedNav = useMemo(() => getGroupedNav(pinnedRouteSet), [pinnedRouteSet]);
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
  const visibleGroupedNav = useMemo(
    () =>
      groupedNav.map((group) => ({
        ...group,
        items: group.items.filter(
        (item) =>
          (!item.module || isModuleEnabled(society, item.module)) &&
          routeAllowedForEntityKind(item, entityKind) &&
          navAllowedForEntityCount(item) &&
          (!item.permission || can(item.permission)),
      ),
      })).filter((group) => group.items.length > 0),
    [groupedNav, society, entityKind, isMultiEntity, can],
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

  return (
    <InspectorProvider>
      <CommandPaletteSafe />
      <DraftMinutesPicker />
      <GlobalTaskCreate />
      <GlobalAssetCreate />
      <GlobalMeetingCreate />
      <GlobalCommitmentCreate />
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
              <span className="sidebar__brand-name">{society?.name ?? t("sidebar.selectWorkspace")}</span>
              <span className="sidebar__brand-workspace">
                <ChevronDown size={12} />
              </span>
            </button>
            <div className="sidebar__brand-actions">
              <NotificationBellSafe />
              {!aiChatHidden && (
                <button
                  className="sidebar__icon-btn"
                  onClick={openGlobalAiAssistant}
                  title="AI assistant"
                  aria-label="AI assistant"
                >
                  <Bot size={14} />
                </button>
              )}
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
          {!operationsDeskHidden && (
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
          )}

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
                      return;
                    }
                    handleCommandKeyDown(event, command.id, command.label);
                  }}
                  title={collapsed ? command.label : undefined}
                  aria-label={command.label}
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
                    background: "var(--bg-input, var(--bg-subtle))",
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
        {!aiChatHidden && <GlobalAiAssistantSafe />}
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

