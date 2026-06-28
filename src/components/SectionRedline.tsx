import { type SectionDiff, type SectionStatus } from "../lib/bylawSections";
import { Badge } from "./ui";

// Renders a section-aware bylaw redline: one block per aligned section, with the
// body word-diff inline and a status badge. A relocated-but-unchanged section
// reads as "moved, unchanged" instead of a delete+add. Shared by the bylaw
// amendment editor and the filed-history timeline so both render identically.

const STATUS_TONE: Record<SectionStatus, "success" | "danger" | "warn" | "accent" | "neutral"> = {
  added: "success",
  removed: "danger",
  changed: "warn",
  moved: "accent",
  unchanged: "neutral",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  moved: "moved, unchanged",
  unchanged: "unchanged",
};

export function SectionRedline({
  diffs,
  showUnchanged = false,
}: {
  diffs: SectionDiff[];
  showUnchanged?: boolean;
}) {
  const visible = showUnchanged ? diffs : diffs.filter((d) => d.status !== "unchanged");
  if (visible.length === 0) {
    return <div className="muted">No section-level changes.</div>;
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      {visible.map((d) => (
        <div key={`${d.key}-${d.status}`} className="col" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <strong className={d.status === "unchanged" ? "muted" : undefined}>{d.heading}</strong>
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          </div>
          {d.status === "moved" ? (
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Relocated without textual changes.
            </div>
          ) : d.tooLarge ? (
            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Section too large for an inline redline.
            </div>
          ) : d.chunks.length > 0 ? (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "var(--fs-md)" }}>
              {d.chunks.map((c, i) => {
                if (c.kind === "same") return <span key={i}>{c.text}</span>;
                if (c.kind === "add")
                  return <span key={i} style={{ background: "#d4f4dd", color: "#0a5e32" }}>{c.text}</span>;
                return (
                  <span key={i} style={{ background: "#fde1e6", color: "#9b1c3a", textDecoration: "line-through" }}>
                    {c.text}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
