import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { detectMentionTrigger, insertMention } from "../lib/mentions";

type Candidate = { id: string; label: string; hint?: string };

function useCandidates(): Candidate[] {
  const society = useSociety();
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  );
  const directors = useQuery(
    api.directors.list,
    society ? { societyId: society._id } : "skip",
  );
  return useMemo(() => {
    const mapped: Candidate[] = [];
    for (const m of (members ?? []) as any[]) {
      mapped.push({
        id: String(m._id),
        label: `${m.firstName} ${m.lastName}`.trim(),
        hint: m.email ?? "Member",
      });
    }
    for (const d of (directors ?? []) as any[]) {
      mapped.push({
        id: String(d._id),
        label: `${d.firstName} ${d.lastName}`.trim(),
        hint: d.position ?? "Director",
      });
    }
    return mapped;
  }, [members, directors]);
}

/** Plain textarea wrapper that autocompletes `@tokens` into `@[Name](id)`
 * tokens. Consumers receive/set the tokenized string through `value` / `onChange`. */
export function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const candidates = useCandidates();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!trigger || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setRect(r);
  }, [trigger]);

  const filtered = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return candidates
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [trigger, candidates]);

  const close = () => {
    setTrigger(null);
    setHighlight(0);
  };

  const apply = (candidate: Candidate) => {
    if (!ref.current || !trigger) return;
    const caret = ref.current.selectionStart ?? value.length;
    const { value: nextValue, caret: nextCaret } = insertMention(value, caret, trigger, candidate);
    onChange(nextValue);
    close();
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  return (
    <>
      <textarea
        ref={ref}
        className={className ?? "textarea"}
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          const caret = e.target.selectionStart ?? v.length;
          const next = detectMentionTrigger(v, caret);
          setTrigger(next);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (!trigger || filtered.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => (i + 1) % filtered.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => (i - 1 + filtered.length) % filtered.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); apply(filtered[highlight]); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
        onBlur={() => setTimeout(close, 120)}
      />
      {trigger && filtered.length > 0 && rect &&
        createPortal(
          <ul
            className="mention-popover"
            role="listbox"
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: Math.min(rect.width, 280),
            }}
          >
            {filtered.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === highlight}
                className={`mention-popover__item${i === highlight ? " is-active" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); apply(c); }}
              >
                <span className="mention-popover__label">{c.label}</span>
                {c.hint && <span className="mention-popover__hint">{c.hint}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
