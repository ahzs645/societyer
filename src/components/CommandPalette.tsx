import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  Calendar,
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
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";
import { useUIStore } from "../lib/store";
import { useRegisteredCommands } from "../lib/commands";

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

const NAV_ITEMS: CommandItem[] = [
  // Navigation
  { id: "nav-dashboard", label: "Dashboard", to: "/app", icon: LayoutDashboard, category: "Navigation" },
  { id: "nav-timeline", label: "Timeline", to: "/app/timeline", icon: CalendarClock, category: "Navigation" },
  { id: "nav-society", label: "Society profile", to: "/app/society", icon: Building2, category: "Navigation" },
  { id: "nav-org-history", label: "Org history", to: "/app/org-history", icon: Newspaper, category: "Navigation" },
  { id: "nav-committees", label: "Committees", to: "/app/committees", icon: UsersRound, category: "Navigation" },
  { id: "nav-employees", label: "Employees", to: "/app/employees", icon: Users, category: "Navigation", module: "employees" },
  { id: "nav-goals", label: "Goals", to: "/app/goals", icon: Target, category: "Navigation" },
  { id: "nav-tasks", label: "Tasks", to: "/app/tasks", icon: ListTodo, category: "Navigation" },
  { id: "nav-members", label: "Members", to: "/app/members", icon: Users, category: "Navigation" },
  { id: "nav-directors", label: "Directors", to: "/app/directors", icon: UserCog, category: "Navigation" },
  { id: "nav-documents", label: "Documents", to: "/app/documents", icon: FolderOpen, category: "Navigation" },
  { id: "nav-deadlines", label: "Deadlines", to: "/app/deadlines", icon: Calendar, category: "Navigation" },
  { id: "nav-volunteers", label: "Volunteers", to: "/app/volunteers", icon: HandHeart, category: "Navigation", module: "volunteers" },
  { id: "nav-communications", label: "Communications", to: "/app/communications", icon: Mail, category: "Navigation", module: "communications" },
  { id: "nav-outbox", label: "Outbox", to: "/app/outbox", icon: Inbox, category: "Navigation" },
  { id: "nav-notifications", label: "Notifications", to: "/app/notifications", icon: Mail, category: "Navigation" },

  // Governance
  { id: "gov-meetings", label: "Meetings", to: "/app/meetings", icon: Calendar, category: "Governance" },
  { id: "gov-agendas", label: "Agendas", to: "/app/agendas", icon: ClipboardList, category: "Governance" },
  { id: "gov-motions", label: "Motion library", to: "/app/motion-library", icon: ClipboardList, category: "Governance" },
  { id: "gov-minutes", label: "Minutes", to: "/app/minutes", icon: FileText, category: "Governance" },
  { id: "gov-evidence", label: "Meeting evidence", to: "/app/meeting-evidence", icon: ClipboardList, category: "Governance" },
  { id: "gov-proposals", label: "Member proposals", to: "/app/proposals", icon: Vote, category: "Governance", module: "voting" },
  { id: "gov-elections", label: "Elections", to: "/app/elections", icon: Vote, category: "Governance", module: "voting" },
  { id: "gov-resolutions", label: "Written resolutions", to: "/app/written-resolutions", icon: PenLine, category: "Governance", module: "voting" },
  { id: "gov-proxies", label: "Proxies", to: "/app/proxies", icon: UserCheck, category: "Governance", module: "voting" },
  { id: "gov-bylaw-rules", label: "Bylaw rules", to: "/app/bylaw-rules", icon: ShieldCheck, category: "Governance" },
  { id: "gov-bylaw-redline", label: "Bylaw redline", to: "/app/bylaw-diff", icon: FileText, category: "Governance" },
  { id: "gov-bylaws-history", label: "Bylaws history", to: "/app/bylaws-history", icon: BookOpen, category: "Governance" },
  { id: "gov-conflicts", label: "Conflicts of interest", to: "/app/conflicts", icon: AlertTriangle, category: "Governance" },
  { id: "gov-attestations", label: "Director attestations", to: "/app/attestations", icon: ShieldCheck, category: "Governance", module: "attestations" },
  { id: "gov-auditors", label: "Auditors", to: "/app/auditors", icon: Calculator, category: "Governance", module: "auditors" },
  { id: "gov-court-orders", label: "Court orders", to: "/app/court-orders", icon: Gavel, category: "Governance", module: "courtOrders" },
  { id: "gov-registers", label: "Governance registers", to: "/app/governance-registers", icon: ShieldCheck, category: "Governance" },

  // Finance
  { id: "fin-financials", label: "Financials", to: "/app/financials", icon: PiggyBank, category: "Finance" },
  { id: "fin-imports", label: "Finance imports", to: "/app/finance-imports", icon: PiggyBank, category: "Finance" },
  { id: "fin-treasurer", label: "Treasurer", to: "/app/treasurer", icon: PiggyBank, category: "Finance" },
  { id: "fin-grants", label: "Grants", to: "/app/grants", icon: BadgeDollarSign, category: "Finance", module: "grants" },
  { id: "fin-reconciliation", label: "Reconciliation", to: "/app/reconciliation", icon: ShieldCheck, category: "Finance", module: "reconciliation" },
  { id: "fin-receipts", label: "Donation receipts", to: "/app/receipts", icon: Receipt, category: "Finance", module: "donationReceipts" },
  { id: "fin-membership", label: "Membership & billing", to: "/app/membership", icon: CreditCard, category: "Finance", module: "membershipBilling" },

  // Compliance
  { id: "comp-filings", label: "Filings", to: "/app/filings", icon: ClipboardList, category: "Compliance" },
  { id: "comp-filings-prefill", label: "Filing pre-fill", to: "/app/filings/prefill", icon: FileCog, category: "Compliance", module: "filingPrefill" },
  { id: "comp-transparency", label: "Public transparency", to: "/app/transparency", icon: Globe, category: "Compliance", module: "transparency" },
  { id: "comp-retention", label: "Records retention", to: "/app/retention", icon: Archive, category: "Compliance", module: "recordsInspection" },
  { id: "comp-records-archive", label: "Records archive", to: "/app/records-archive", icon: Archive, category: "Compliance" },
  { id: "comp-inspections", label: "Records inspections", to: "/app/inspections", icon: Eye, category: "Compliance", module: "recordsInspection" },
  { id: "comp-privacy", label: "Privacy (PIPA)", to: "/app/privacy", icon: Shield, category: "Compliance" },
  { id: "comp-pipa-training", label: "PIPA training", to: "/app/pipa-training", icon: ShieldCheck, category: "Compliance", module: "pipaTraining" },
  { id: "comp-insurance", label: "Insurance", to: "/app/insurance", icon: Shield, category: "Compliance", module: "insurance" },
  { id: "comp-access-custody", label: "Access custody", to: "/app/access-custody", icon: KeyRound, category: "Compliance", module: "secrets" },

  // System
  { id: "sys-users", label: "Users & roles", to: "/app/users", icon: UserCog, category: "System" },
  { id: "sys-custom-fields", label: "Custom fields", to: "/app/custom-fields", icon: Settings, category: "System" },
  { id: "sys-imports", label: "Import sessions", to: "/app/imports", icon: FileJson, category: "System" },
  { id: "sys-paperless", label: "Paperless-ngx", to: "/app/paperless", icon: Database, category: "System", module: "paperless" },
  { id: "sys-audit", label: "Audit log", to: "/app/audit", icon: ShieldCheck, category: "System" },
  { id: "sys-exports", label: "Data export", to: "/app/exports", icon: Download, category: "System" },
  { id: "sys-settings", label: "Settings", to: "/app/settings", icon: Settings, category: "System", shortcut: "," },
];

const CATEGORY_ORDER: CommandCategory[] = [
  "Recent",
  "Actions",
  "Navigation",
  "Governance",
  "Finance",
  "Compliance",
  "System",
];

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

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const navigate = useNavigate();
  const society = useSociety();
  const seed = useMutation(api.seed.run);

  const actions = useMemo<CommandItem[]>(
    () => [
      {
        id: "action-seed-demo",
        label: "Seed demo society",
        icon: Sparkles,
        category: "Actions",
        run: async () => {
          await seed({});
        },
      },
    ],
    [seed],
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
      category: "Actions",
      run: a.run,
      shortcut: a.shortcut,
    }));
    const all = [
      ...NAV_ITEMS.filter((item) => !item.module || isModuleEnabled(society, item.module)),
      ...actions,
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
  }, [q, society, actions, recents, recentRecords, registeredCommands]);

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
