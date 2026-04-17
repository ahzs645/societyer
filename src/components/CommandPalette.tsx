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
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { isModuleEnabled, type ModuleKey } from "../lib/modules";

const ITEMS: Array<{
  label: string;
  to: string;
  icon: any;
  kind: "Navigate";
  module?: ModuleKey;
}> = [
  { label: "Go to Dashboard", to: "/app", icon: LayoutDashboard, kind: "Navigate" },
  { label: "Timeline", to: "/app/timeline", icon: CalendarClock, kind: "Navigate" },
  { label: "Society profile", to: "/app/society", icon: Building2, kind: "Navigate" },
  { label: "Org history", to: "/app/org-history", icon: Newspaper, kind: "Navigate" },
  { label: "Committees", to: "/app/committees", icon: UsersRound, kind: "Navigate" },
  { label: "Employees", to: "/app/employees", icon: Users, kind: "Navigate", module: "employees" },
  { label: "Goals", to: "/app/goals", icon: Target, kind: "Navigate" },
  { label: "Tasks", to: "/app/tasks", icon: ListTodo, kind: "Navigate" },
  { label: "Members", to: "/app/members", icon: Users, kind: "Navigate" },
  { label: "Directors", to: "/app/directors", icon: UserCog, kind: "Navigate" },
  { label: "Meetings", to: "/app/meetings", icon: Calendar, kind: "Navigate" },
  { label: "Agendas", to: "/app/agendas", icon: ClipboardList, kind: "Navigate" },
  { label: "Motion library", to: "/app/motion-library", icon: ClipboardList, kind: "Navigate" },
  { label: "Minutes", to: "/app/minutes", icon: FileText, kind: "Navigate" },
  { label: "Meeting evidence", to: "/app/meeting-evidence", icon: ClipboardList, kind: "Navigate" },
  { label: "Member proposals", to: "/app/proposals", icon: Vote, kind: "Navigate", module: "voting" },
  { label: "Elections", to: "/app/elections", icon: Vote, kind: "Navigate", module: "voting" },
  { label: "Written resolutions", to: "/app/written-resolutions", icon: PenLine, kind: "Navigate", module: "voting" },
  { label: "Proxies", to: "/app/proxies", icon: UserCheck, kind: "Navigate", module: "voting" },
  { label: "Filings", to: "/app/filings", icon: ClipboardList, kind: "Navigate" },
  { label: "Filing pre-fill", to: "/app/filings/prefill", icon: FileCog, kind: "Navigate", module: "filingPrefill" },
  { label: "Deadlines", to: "/app/deadlines", icon: Calendar, kind: "Navigate" },
  { label: "Communications", to: "/app/communications", icon: Mail, kind: "Navigate", module: "communications" },
  { label: "Documents", to: "/app/documents", icon: FolderOpen, kind: "Navigate" },
  { label: "Volunteers", to: "/app/volunteers", icon: HandHeart, kind: "Navigate", module: "volunteers" },
  { label: "Conflicts of interest", to: "/app/conflicts", icon: AlertTriangle, kind: "Navigate" },
  { label: "Director attestations", to: "/app/attestations", icon: ShieldCheck, kind: "Navigate", module: "attestations" },
  { label: "Auditors", to: "/app/auditors", icon: Calculator, kind: "Navigate", module: "auditors" },
  { label: "Court orders", to: "/app/court-orders", icon: Gavel, kind: "Navigate", module: "courtOrders" },
  { label: "Governance registers", to: "/app/governance-registers", icon: ShieldCheck, kind: "Navigate" },
  { label: "Bylaw rules", to: "/app/bylaw-rules", icon: ShieldCheck, kind: "Navigate" },
  { label: "Bylaw redline", to: "/app/bylaw-diff", icon: FileText, kind: "Navigate" },
  { label: "Bylaws history", to: "/app/bylaws-history", icon: BookOpen, kind: "Navigate" },
  { label: "Financials", to: "/app/financials", icon: PiggyBank, kind: "Navigate" },
  { label: "Finance imports", to: "/app/finance-imports", icon: PiggyBank, kind: "Navigate" },
  { label: "Treasurer", to: "/app/treasurer", icon: PiggyBank, kind: "Navigate" },
  { label: "Grants", to: "/app/grants", icon: BadgeDollarSign, kind: "Navigate", module: "grants" },
  { label: "Reconciliation", to: "/app/reconciliation", icon: ShieldCheck, kind: "Navigate", module: "reconciliation" },
  { label: "Donation receipts", to: "/app/receipts", icon: Receipt, kind: "Navigate", module: "donationReceipts" },
  { label: "Membership & billing", to: "/app/membership", icon: CreditCard, kind: "Navigate", module: "membershipBilling" },
  { label: "Public transparency", to: "/app/transparency", icon: Globe, kind: "Navigate", module: "transparency" },
  { label: "Records retention", to: "/app/retention", icon: Archive, kind: "Navigate", module: "recordsInspection" },
  { label: "Records archive", to: "/app/records-archive", icon: Archive, kind: "Navigate" },
  { label: "Records inspections", to: "/app/inspections", icon: Eye, kind: "Navigate", module: "recordsInspection" },
  { label: "Privacy (PIPA)", to: "/app/privacy", icon: Shield, kind: "Navigate" },
  { label: "PIPA training", to: "/app/pipa-training", icon: ShieldCheck, kind: "Navigate", module: "pipaTraining" },
  { label: "Insurance", to: "/app/insurance", icon: Shield, kind: "Navigate", module: "insurance" },
  { label: "Access custody", to: "/app/access-custody", icon: KeyRound, kind: "Navigate", module: "secrets" },
  { label: "Notifications", to: "/app/notifications", icon: Mail, kind: "Navigate" },
  { label: "Users & roles", to: "/app/users", icon: UserCog, kind: "Navigate" },
  { label: "Import sessions", to: "/app/imports", icon: FileJson, kind: "Navigate" },
  { label: "Paperless-ngx", to: "/app/paperless", icon: Database, kind: "Navigate", module: "paperless" },
  { label: "Audit log", to: "/app/audit", icon: ShieldCheck, kind: "Navigate" },
  { label: "Data export", to: "/app/exports", icon: Download, kind: "Navigate" },
  { label: "Settings", to: "/app/settings", icon: Settings, kind: "Navigate" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const navigate = useNavigate();
  const society = useSociety();
  const seed = useMutation(api.seed.run);

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
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    const base = [
      ...ITEMS.filter((item) => !item.module || isModuleEnabled(society, item.module)),
      { label: "Seed demo society", to: "__seed__", icon: Sparkles, kind: "Action" },
    ];
    if (!q) return base;
    const ql = q.toLowerCase();
    return base.filter((i) => i.label.toLowerCase().includes(ql));
  }, [q, society]);

  if (!open) return null;

  const run = async (i: (typeof items)[number]) => {
    if (i.to === "__seed__") {
      await seed({});
    } else {
      navigate(i.to);
    }
    setOpen(false);
  };

  return (
    <div className="kbar-backdrop" onClick={() => setOpen(false)}>
      <div className="kbar" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="sr-only">Command palette</h2>
        <input
          ref={inputRef}
          className="kbar__input"
          placeholder="Type a command or search…"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            if (e.key === "Enter" && items[active]) run(items[active]);
          }}
        />
        <div className="kbar__list" id={listId} role="listbox" aria-label="Commands">
          {items.map((it, idx) => {
            const Icon = it.icon;
            return (
              <button
                type="button"
                key={it.label}
                id={`${listId}-${idx}`}
                role="option"
                aria-selected={idx === active}
                className={`kbar__item${idx === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => run(it)}
              >
                <Icon />
                <span>{it.label}</span>
                <span className="kbar__hint">{it.kind}</span>
              </button>
            );
          })}
          {items.length === 0 && <div className="kbar__item muted">No matches</div>}
        </div>
      </div>
    </div>
  );
}
