import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Sparkles,
  UsersRound,
  Target,
  ListTodo,
  CalendarClock,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

const ITEMS = [
  { label: "Go to Dashboard", to: "/app", icon: LayoutDashboard, kind: "Navigate" },
  { label: "Timeline", to: "/app/timeline", icon: CalendarClock, kind: "Navigate" },
  { label: "Society profile", to: "/app/society", icon: Building2, kind: "Navigate" },
  { label: "Committees", to: "/app/committees", icon: UsersRound, kind: "Navigate" },
  { label: "Goals", to: "/app/goals", icon: Target, kind: "Navigate" },
  { label: "Tasks", to: "/app/tasks", icon: ListTodo, kind: "Navigate" },
  { label: "Members", to: "/app/members", icon: Users, kind: "Navigate" },
  { label: "Directors", to: "/app/directors", icon: UserCog, kind: "Navigate" },
  { label: "Meetings", to: "/app/meetings", icon: Calendar, kind: "Navigate" },
  { label: "Minutes", to: "/app/minutes", icon: FileText, kind: "Navigate" },
  { label: "Filings", to: "/app/filings", icon: ClipboardList, kind: "Navigate" },
  { label: "Deadlines", to: "/app/deadlines", icon: Calendar, kind: "Navigate" },
  { label: "Documents", to: "/app/documents", icon: FolderOpen, kind: "Navigate" },
  { label: "Conflicts of interest", to: "/app/conflicts", icon: AlertTriangle, kind: "Navigate" },
  { label: "Financials", to: "/app/financials", icon: PiggyBank, kind: "Navigate" },
  { label: "Privacy (PIPA)", to: "/app/privacy", icon: Shield, kind: "Navigate" },
  { label: "Settings", to: "/app/settings", icon: Settings, kind: "Navigate" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
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
      ...ITEMS,
      { label: "Seed demo society", to: "__seed__", icon: Sparkles, kind: "Action" },
    ];
    if (!q) return base;
    const ql = q.toLowerCase();
    return base.filter((i) => i.label.toLowerCase().includes(ql));
  }, [q]);

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
      <div className="kbar" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="kbar__input"
          placeholder="Type a command or search…"
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
        <div className="kbar__list">
          {items.map((it, idx) => {
            const Icon = it.icon;
            return (
              <div
                key={it.label}
                className={`kbar__item${idx === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => run(it)}
              >
                <Icon />
                <span>{it.label}</span>
                <span className="kbar__hint">{it.kind}</span>
              </div>
            );
          })}
          {items.length === 0 && <div className="kbar__item muted">No matches</div>}
        </div>
      </div>
    </div>
  );
}
