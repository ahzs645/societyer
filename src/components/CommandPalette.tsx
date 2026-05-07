import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConvex } from "convex/react";
import { useLocation, useNavigate } from "react-router-dom";
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
  Sparkles,
  UsersRound,
  Target,
  ListTodo,
  CalendarClock,
  Mail,
  HandHeart,
  BadgeDollarSign,
  Globe,
  Archive,
  BookOpen,
  Calculator,
  CreditCard,
  Download,
  Database,
  Eye,
  FileCog,
  FileCheck2,
  Gavel,
  PenLine,
  Receipt,
  ShieldCheck,
  UserCheck,
  Vote,
  Newspaper,
  KeyRound,
  Clock,
  Inbox,
  Workflow,
  Plug,
  Pin,
  PinOff,
} from "lucide-react";
import { api } from "../lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { useUIStore } from "../lib/store";
import { MenuRow } from "./ui";
import { useRegisteredCommands } from "../lib/commands";
import { useStaticCommands } from "../lib/useStaticCommands";
import { ROUTE_IDENTITY, groupToneCssVar, type RouteGroup } from "../lib/routeIdentity";
import type { CSSProperties } from "react";

type CommandCategory =
  | "Recent"
  | "Navigation"
  | "Governance"
  | "Finance"
  | "Compliance"
  | "System"
  | "Actions";

type CommandItem = {
  id: string;
  label: string;
  icon: any;
  category: CommandCategory;
  module?: ModuleKey;
  /** For navigation commands. */
  to?: string;
  /** For action commands; returns a Promise when work is async. */
  run?: () => void | Promise<void>;
  /** Optional keyboard hint shown as a <kbd>. */
  shortcut?: string;
  /** Registry group — drives the per-row icon tint. */
  group?: RouteGroup;
};

/**
 * Map registry route groups to the palette's coarser categories. Several
 * registry groups collapse into one palette category (workspace/people/work
 * all become "Navigation"), so we don't end up with a 9-section dropdown.
 */
const GROUP_TO_CATEGORY: Record<RouteGroup, CommandCategory> = {
  workspace: "Navigation",
  people: "Navigation",
  work: "Navigation",
  meetings: "Governance",
  records: "Governance",
  finance: "Finance",
  compliance: "Compliance",
  workflows: "System",
  administration: "System",
};

/**
 * Nav commands are derived from the same `ROUTE_IDENTITY` registry the sidebar
 * and PageHeader use, so the icon and label here always match what the user
 * sees in the sidebar — searching the visible sidebar label always finds the
 * matching nav entry.
 */
const NAV_ITEMS: CommandItem[] = Object.entries(ROUTE_IDENTITY).map(([path, identity]) => {
  const item: CommandItem = {
    id: `nav:${path}`,
    label: identity.label,
    icon: identity.icon,
    category: GROUP_TO_CATEGORY[identity.group],
    group: identity.group,
    to: path,
  };
  if (identity.module) item.module = identity.module;
  return item;
});

const CATEGORY_ORDER: CommandCategory[] = [
  "Recent",
  "Actions",
  "Navigation",
  "Governance",
  "Finance",
  "Compliance",
  "System",
];

const ENABLE_METADATA_COMMANDS = import.meta.env.VITE_ENABLE_METADATA_COMMANDS === "true";
const RECENTS_KEY = "societyer.kbar.recents";
const RECENTS_MAX = 5;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((r) => r !== id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

const COMMAND_ICONS: Record<string, any> = {
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
  Sparkles,
  UsersRound,
  Target,
  ListTodo,
  CalendarClock,
  Mail,
  HandHeart,
  BadgeDollarSign,
  Globe,
  Archive,
  BookOpen,
  Calculator,
  CreditCard,
  Download,
  Database,
  Eye,
  FileCog,
  FileCheck2,
  Gavel,
  PenLine,
  Receipt,
  ShieldCheck,
  UserCheck,
  Vote,
  Newspaper,
  KeyRound,
  Clock,
  Inbox,
  Workflow,
};

function commandFromMetadata(row: any, navigate: ReturnType<typeof useNavigate>): CommandItem | null {
  const payload = parseCommandPayload(row.payloadJson);
  const Icon = row.iconName ? COMMAND_ICONS[row.iconName] : undefined;
  const icon = Icon ?? Settings;
  const category = normalizeCommandCategory(row.category);
  const id = `metadata-command:${row._id}`;

  if (row.commandKey === "navigate") {
    const to = typeof payload.to === "string" ? payload.to : row.pagePath;
    if (!to) return null;
    return { id, label: row.label, icon, category, to };
  }

  if (row.commandKey === "open-url") {
    const href = typeof payload.href === "string" ? payload.href : "";
    if (!href) return null;
    return {
      id,
      label: row.label,
      icon,
      category,
      run: () => {
        window.open(href, "_blank", "noopener,noreferrer");
      },
    };
  }

  if (row.commandKey === "dispatch-event") {
    const eventName = typeof payload.eventName === "string" ? payload.eventName : "";
    if (!eventName) return null;
    return {
      id,
      label: row.label,
      icon,
      category,
      run: () => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: payload.detail }));
      },
    };
  }

  if (row.pagePath) {
    return { id, label: row.label, icon, category, to: row.pagePath };
  }

  return null;
}

function parseCommandPayload(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeCommandCategory(value: unknown): CommandCategory {
  return CATEGORY_ORDER.includes(value as CommandCategory) ? (value as CommandCategory) : "Actions";
}

function MetadataCommandsLoader({
  societyId,
  pagePath,
  onLoad,
}: {
  societyId: string;
  pagePath: string;
  onLoad: (rows: any[]) => void;
}) {
  const convex = useConvex();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await convex.query(api.commandMenuItems.listForScope, {
          societyId,
          scopeType: "page",
          pagePath,
        });
        if (!cancelled) onLoad(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) onLoad([]);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [convex, onLoad, pagePath, societyId]);

  return null;
}

const PINNED_COMMAND_IDS_KEY = "societyer.sidebar.pinnedCommandIds";
const PINNED_ROUTES_KEY = "societyer.sidebar.pinnedRoutes";

function readStringArray(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value: unknown): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Sync the sidebar in the same tab — `storage` events only fire across tabs.
    window.dispatchEvent(new Event("kbar:pinned-changed"));
  } catch {
    /* ignore quota */
  }
}

type PaletteContextMenu = {
  item: CommandItem;
  top: number;
  left: number;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const [metadataCommands, setMetadataCommands] = useState<any[]>([]);
  const [pinnedCommandIds, setPinnedCommandIds] = useState<string[]>(() => readStringArray(PINNED_COMMAND_IDS_KEY));
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>(() => readStringArray(PINNED_ROUTES_KEY));
  const [contextMenu, setContextMenu] = useState<PaletteContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const society = useSociety();
  const staticCommands = useStaticCommands();

  const actions = useMemo<CommandItem[]>(
    () =>
      staticCommands.map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        category: "Actions" as const,
        ...(command.module ? { module: command.module } : {}),
        run: command.run,
      })),
    [staticCommands],
  );

  const pinnedCommandSet = useMemo(() => new Set(pinnedCommandIds), [pinnedCommandIds]);
  const pinnedRouteSet = useMemo(() => new Set(pinnedRoutes), [pinnedRoutes]);

  // Anything the user can run from the palette can be pinned: navigation
  // entries (have `to`), action entries (have `run`). Recent rows preserve
  // both fields when they're spread, so they fall in here too.
  const canPinItem = (item: CommandItem): boolean => Boolean(item.to || item.run);

  const isItemPinned = (item: CommandItem): boolean => {
    if (item.to) return pinnedRouteSet.has(item.to);
    return pinnedCommandSet.has(item.id);
  };

  const togglePinned = (item: CommandItem) => {
    if (item.to) {
      setPinnedRoutes((prev) => {
        const next = prev.includes(item.to!) ? prev.filter((route) => route !== item.to) : [...prev, item.to!];
        writeStringArray(PINNED_ROUTES_KEY, next);
        return next;
      });
    } else {
      setPinnedCommandIds((prev) => {
        const next = prev.includes(item.id)
          ? prev.filter((id) => id !== item.id)
          : [...prev, item.id];
        writeStringArray(PINNED_COMMAND_IDS_KEY, next);
        return next;
      });
    }
    setContextMenu(null);
  };

  // When pinning happens elsewhere (the sidebar's own context menu, another
  // tab, etc.), pull the new values back into our state so the menu label
  // and isPinned check stay accurate.
  useEffect(() => {
    const onPinChange = () => {
      setPinnedCommandIds(readStringArray(PINNED_COMMAND_IDS_KEY));
      setPinnedRoutes(readStringArray(PINNED_ROUTES_KEY));
    };
    window.addEventListener("kbar:pinned-changed", onPinChange);
    return () => window.removeEventListener("kbar:pinned-changed", onPinChange);
  }, []);

  // Dismiss the right-click context menu on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // `/` opens the palette without modifiers — GitHub/Linear/Slack convention.
      // Skip when the user is typing in any text-entry surface so they can still
      // type literal slashes in agenda items, meeting titles, etc.
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target?.isContentEditable) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("kbar:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kbar:open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setMetadataCommands([]);
      setRecents(readRecents());
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const recentRecords = useUIStore((s) => s.recentRecords);
  const registeredCommands = useRegisteredCommands();

  const { flat, groups } = useMemo(() => {
    const dynamicActions: CommandItem[] = registeredCommands.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      category: a.category ?? "Actions",
      run: a.run,
      shortcut: a.shortcut,
    }));
    const metadataActions: CommandItem[] = (metadataCommands ?? [])
      .map((row: any) => commandFromMetadata(row, navigate))
      .filter((item): item is CommandItem => Boolean(item));
    const enabledActions = actions.filter((item) => !item.module || isModuleEnabled(society, item.module));
    const all = [
      ...NAV_ITEMS.filter((item) => !item.module || isModuleEnabled(society, item.module)),
      ...enabledActions,
      ...metadataActions,
      ...dynamicActions,
    ];
    const recordItems: CommandItem[] = recentRecords.map((r) => ({
      id: `recent-record:${r.entityType}:${r.id}`,
      label: r.label,
      icon: Clock,
      category: "Recent" as const,
      to: r.to,
    }));
    const ql = q.trim().toLowerCase();
    const searchable = [...all, ...recordItems];
    const matches = ql
      ? searchable.filter((i) => i.label.toLowerCase().includes(ql))
      : all;

    // When idle (no query), promote the last-used items into a "Recent" group.
    const recentItems: CommandItem[] = [];
    if (!ql) {
      for (const rec of recordItems) recentItems.push(rec);
      for (const id of recents) {
        if (recentItems.some((i) => i.id === id)) continue;
        const found = all.find((item) => item.id === id);
        if (found) recentItems.push({ ...found, category: "Recent" });
      }
    }

    // Bucket the remaining matches by category, preserving NAV_ITEMS order.
    const buckets = new Map<CommandCategory, CommandItem[]>();
    for (const cat of CATEGORY_ORDER) buckets.set(cat, []);
    if (recentItems.length > 0) buckets.set("Recent", recentItems);
    for (const item of matches) {
      // Don't duplicate recent entries in their original category when idle.
      if (!ql && recents.includes(item.id)) continue;
      buckets.get(item.category)?.push(item);
    }

    const flat: CommandItem[] = [];
    const groups: Array<{ category: CommandCategory; items: CommandItem[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = buckets.get(cat) ?? [];
      if (items.length === 0) continue;
      groups.push({ category: cat, items });
      flat.push(...items);
    }
    return { flat, groups };
  }, [q, society, actions, recents, recentRecords, registeredCommands, metadataCommands, navigate]);

  if (!open) return null;

  const run = async (item: CommandItem) => {
    pushRecent(item.id);
    if (item.run) {
      await item.run();
    } else if (item.to) {
      navigate(item.to);
    }
    setOpen(false);
  };

  const clampActive = (next: number) =>
    flat.length === 0 ? 0 : Math.max(0, Math.min(next, flat.length - 1));

  return (
    <div className="kbar-backdrop" onClick={() => setOpen(false)}>
      {ENABLE_METADATA_COMMANDS && society && (
        <MetadataCommandsLoader
          societyId={society._id}
          pagePath={location.pathname}
          onLoad={setMetadataCommands}
        />
      )}
      <div
        className="kbar"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">Command palette</h2>
        <input
          ref={inputRef}
          className="kbar__input"
          placeholder="Type a command or search…"
          aria-label="Command palette search"
          role="combobox"
          aria-controls={listId}
          aria-expanded
          aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => clampActive(a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => clampActive(a - 1));
            } else if (e.key === "Enter" && flat[active]) {
              e.preventDefault();
              run(flat[active]);
            }
          }}
        />
        <div className="kbar__list" id={listId} role="listbox" aria-label="Commands">
          {groups.length === 0 && (
            <div className="kbar__empty">No matches</div>
          )}
          {(() => {
            let runningIndex = 0;
            return groups.map((group) => (
              <div key={group.category} role="group" aria-label={group.category}>
                <div className="kbar__group-label">
                  {group.category === "Recent" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Clock size={10} /> Recent
                    </span>
                  ) : (
                    group.category
                  )}
                </div>
                {group.items.map((item) => {
                  const idx = runningIndex++;
                  const Icon = item.icon;
                  // Pull the tone straight from the registry — no per-group CSS
                  // class to keep in sync. Action/Recent items leave it unset
                  // and fall back to the muted default in the SCSS.
                  const itemStyle: CSSProperties | undefined = item.group
                    ? ({ "--kbar-item-tone": groupToneCssVar(item.group) } as CSSProperties)
                    : undefined;
                  // Pinnable when the row is something the user can run —
                  // navigation entries, action entries, and Recent rows
                  // (which preserve the underlying `to`/`run`).
                  const canPin = canPinItem(item);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      id={`${listId}-${idx}`}
                      role="option"
                      aria-selected={idx === active}
                      className={`kbar__item${idx === active ? " is-active" : ""}`}
                      style={itemStyle}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(item)}
                      onContextMenu={
                        canPin
                          ? (event) => {
                              event.preventDefault();
                              const x = Math.min(event.clientX, window.innerWidth - 220);
                              const y = Math.min(event.clientY, window.innerHeight - 80);
                              setContextMenu({ item, top: y, left: x });
                            }
                          : undefined
                      }
                    >
                      <Icon />
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <span className="kbar__hint">
                          <span className="kbar__kbd">{item.shortcut}</span>
                        </span>
                      ) : (
                        <span className="kbar__hint">{item.run ? "Action" : "Navigate"}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>
        <div className="kbar__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to run</span>
          <span><kbd>esc</kbd> to close</span>
          <span style={{ marginLeft: "auto" }}><kbd>alt</kbd>+<kbd>o</kbd> inspector</span>
        </div>
      </div>

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="menu menu--actions"
          role="menu"
          style={{ position: "fixed", top: contextMenu.top, left: contextMenu.left, width: 200, zIndex: 1100 }}
        >
          <div className="menu__section">
            <MenuRow
              role="menuitem"
              icon={isItemPinned(contextMenu.item) ? <PinOff size={14} /> : <Pin size={14} />}
              label={isItemPinned(contextMenu.item) ? "Unpin from Favorites" : "Pin to Favorites"}
              onClick={() => togglePinned(contextMenu.item)}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
