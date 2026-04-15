import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, Archive, Award, BarChart, Bell, Bookmark, Briefcase, Building, Calendar,
  CheckCircle2, Clipboard, ClipboardList, Clock, Coffee, Compass, CreditCard, Database, DollarSign,
  FileText, Flag, Folder, Gift, Globe, Hammer, Hash, Heart, Home, Image, Inbox, Info, Key, Layers,
  LayoutGrid, Leaf, LifeBuoy, Link as LinkIcon, List, ListTodo, Lock, Mail, Map, MapPin, Megaphone,
  MessageSquare, Mic, Moon, Music, Package, Paperclip, Pencil, Phone, PieChart, Plane, Plus, Radio,
  Rocket, Save, Scale, School, Scissors, Search, Send, Settings, Share2, Shield, ShieldAlert,
  ShoppingBag, Sparkles, Star, Sun, Tag, Target, Thermometer, ThumbsUp, Ticket, Timer, Trash2,
  Truck, Tv, Umbrella, UserCog, Users, UsersRound, Video, Wallet, Watch, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { Search as SearchIcon } from "lucide-react";

const CATALOG: Record<string, LucideIcon> = {
  Activity, AlertTriangle, Archive, Award, BarChart, Bell, Bookmark, Briefcase, Building, Calendar,
  CheckCircle2, Clipboard, ClipboardList, Clock, Coffee, Compass, CreditCard, Database, DollarSign,
  FileText, Flag, Folder, Gift, Globe, Hammer, Hash, Heart, Home, Image, Inbox, Info, Key, Layers,
  LayoutGrid, Leaf, LifeBuoy, Link: LinkIcon, List, ListTodo, Lock, Mail, Map, MapPin, Megaphone,
  MessageSquare, Mic, Moon, Music, Package, Paperclip, Pencil, Phone, PieChart, Plane, Plus, Radio,
  Rocket, Save, Scale, School, Scissors, Search, Send, Settings, Share2, Shield, ShieldAlert,
  ShoppingBag, Sparkles, Star, Sun, Tag, Target, Thermometer, ThumbsUp, Ticket, Timer, Trash2,
  Truck, Tv, Umbrella, UserCog, Users, UsersRound, Video, Wallet, Watch, Wrench, Zap,
};

type Props = {
  value: string; // Icon name from CATALOG. Empty = none.
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "md" | "sm";
};

export function IconPicker({ value, onChange, placeholder = "Pick an icon", disabled, size = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const Icon = value ? CATALOG[value] : null;

  const entries = useMemo(() => Object.entries(CATALOG), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([name]) => name.toLowerCase().includes(q));
  }, [entries, query]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger${size === "sm" ? " select-trigger--sm" : ""}${open ? " is-open" : ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className="select-trigger__label">
          {Icon ? (
            <>
              <Icon size={14} className="select-trigger__icon" />
              {value}
            </>
          ) : (
            <span className="select-trigger__placeholder">{placeholder}</span>
          )}
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div ref={popRef} className="icon-picker" style={{ top: pos.top, left: pos.left }}>
              <div className="menu__search">
                <SearchIcon size={12} />
                <input
                  autoFocus
                  className="menu__search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search icons…"
                />
              </div>
              <div className="icon-picker__grid">
                {filtered.map(([name, IC]) => (
                  <button
                    key={name}
                    type="button"
                    className={`icon-picker__cell${name === value ? " is-selected" : ""}`}
                    title={name}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <IC size={16} />
                  </button>
                ))}
                {filtered.length === 0 && <div className="menu__empty">No icons match</div>}
              </div>
              {value && (
                <div className="icon-picker__foot">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Render an icon by its catalog name. Falls back to null if unknown. */
export function Icon({ name, size = 14 }: { name?: string | null; size?: number }) {
  if (!name) return null;
  const IC = CATALOG[name];
  return IC ? <IC size={size} /> : null;
}

export const ICON_CATALOG = CATALOG;
