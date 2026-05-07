import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
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
} from "lucide-react";
import { api } from "../lib/convexApi";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { useToast } from "./Toast";
import { maintenanceErrorMessage, seedDemoSociety } from "../lib/maintenanceApi";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { useUIStore } from "../lib/store";
import { useRegisteredCommands } from "../lib/commands";
import { ROUTE_IDENTITY, type RouteGroup } from "../lib/routeIdentity";

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

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const [metadataCommands, setMetadataCommands] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const society = useSociety();
  const toast = useToast();
  const seedSharedViews = useMutation(api.views.seedGovernanceDataTableViews);

  const actions = useMemo<CommandItem[]>(
    () => [
      {
        id: "action-create-meeting",
        label: "Create meeting",
        icon: Calendar,
        category: "Actions",
        run: () => navigate("/app/meetings?intent=create&type=Board"),
      },
      {
        id: "action-mark-filing-filed",
        label: "Mark filing filed",
        icon: FileCheck2,
        category: "Actions",
        run: () => navigate("/app/filings?intent=mark-filed"),
      },
      {
        id: "action-generate-agm-package",
        label: "Generate AGM package",
        icon: FileCog,
        category: "Actions",
        run: () => navigate("/app/meetings?intent=generate-agm-package&type=AGM"),
      },
      {
        id: "action-draft-minutes",
        label: "Draft minutes",
        icon: PenLine,
        category: "Actions",
        run: () => navigate("/app/minutes?intent=draft"),
      },
      {
        id: "action-request-director-attestation",
        label: "Request director attestation",
        icon: ShieldCheck,
        category: "Actions",
        module: "attestations",
        run: () => navigate("/app/attestations?intent=request"),
      },
      {
        id: "action-export-minute-book",
        label: "Export minute book",
        icon: Download,
        category: "Actions",
        run: () => navigate("/app/minute-book?intent=export"),
      },
      {
        id: "action-start-inspection-response",
        label: "Start inspection response",
        icon: Eye,
        category: "Actions",
        module: "recordsInspection",
        run: () => navigate("/app/inspections?intent=start-response"),
      },
      {
        id: "action-seed-demo",
        label: "Seed demo society",
        icon: Sparkles,
        category: "Actions",
        run: async () => {
          try {
            const result = await seedDemoSociety();
            setStoredSocietyId(result.societyId);
            toast.success("Demo society seeded");
          } catch (error) {
            toast.error(maintenanceErrorMessage(error));
          }
        },
      },
      ...(society
        ? [
            {
              id: "action-seed-shared-views",
              label: "Seed governance shared views",
              icon: Settings,
              category: "Actions" as const,
              run: async () => {
                const result = await seedSharedViews({ societyId: society._id });
                toast.success("Shared views seeded", `${result.created.length} created, ${result.skipped.length} skipped`);
              },
            },
          ]
        : []),
    ],
    [navigate, seedSharedViews, society, toast],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
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
                  return (
                    <button
                      type="button"
                      key={item.id}
                      id={`${listId}-${idx}`}
                      role="option"
                      aria-selected={idx === active}
                      className={`kbar__item${idx === active ? " is-active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(item)}
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
    </div>
  );
}
