import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Plus, Pencil, Trash2, Circle, CheckCircle2, AlertTriangle, MessageSquare, ChevronDown } from "lucide-react";
import { ReactNode, useState } from "react";
import { formatDate, relative } from "../lib/format";
import { Avatar, EmptyState, Skeleton } from "./ui";

type ActivityRow = {
  _id: string;
  actor: string;
  entityType: string;
  entityId?: string;
  action: string;
  summary: string;
  createdAtISO: string;
};

function iconFor(action: string): ReactNode {
  const a = action.toLowerCase();
  if (a.includes("create") || a.includes("add")) return <Plus size={14} />;
  if (a.includes("update") || a.includes("edit") || a.includes("patch")) return <Pencil size={14} />;
  if (a.includes("delete") || a.includes("remove") || a.includes("archive")) return <Trash2 size={14} />;
  if (a.includes("complete") || a.includes("approve")) return <CheckCircle2 size={14} />;
  if (a.includes("warn") || a.includes("flag") || a.includes("risk")) return <AlertTriangle size={14} />;
  if (a.includes("comment") || a.includes("note")) return <MessageSquare size={14} />;
  return <Circle size={14} />;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function dayLabel(key: string): string {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  if (key === todayKey) return "Today";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const yesterdayKey = y.toISOString().slice(0, 10);
  if (key === yesterdayKey) return "Yesterday";
  return formatDate(key);
}

/** Chronological feed of activity events for one record. Groups by day. */
export function ActivityTimeline({
  entityType,
  entityId,
  limit = 100,
}: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  const society = useSociety();
  const rows = useQuery(
    api.activity.listForRecord,
    society ? { societyId: society._id, entityType, entityId, limit } : "skip",
  ) as ActivityRow[] | undefined;

  if (rows === undefined) {
    return (
      <div className="activity-timeline" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="activity-timeline__row">
            <Skeleton variant="circle" width={24} height={24} />
            <div style={{ flex: 1 }}>
              <Skeleton variant="line" width="60%" height={10} />
              <div style={{ height: 6 }} />
              <Skeleton variant="line" width="30%" height={8} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Circle size={18} />}
        title="No activity yet"
        description="Events on this record — edits, approvals, comments — will appear here."
      />
    );
  }

  const groups = new Map<string, ActivityRow[]>();
  for (const row of rows) {
    const key = dayKey(row.createdAtISO);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return <ActivityTimelineView groups={groups} />;
}

function ActivityTimelineView({ groups }: { groups: Map<string, ActivityRow[]> }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (day: string) =>
    setCollapsed((c) => ({ ...c, [day]: !c[day] }));

  return (
    <div className="activity-timeline">
      {Array.from(groups.entries()).map(([day, events]) => (
        <section key={day} className="activity-timeline__group">
          <button
            type="button"
            className={`activity-timeline__day${collapsed[day] ? " is-collapsed" : ""}`}
            onClick={() => toggle(day)}
            aria-expanded={!collapsed[day]}
          >
            <ChevronDown size={12} className="activity-timeline__chevron" />
            <span>{dayLabel(day)}</span>
            <span className="activity-timeline__day-count">{events.length}</span>
          </button>
          {!collapsed[day] && (
          <ul className="activity-timeline__list">
            {events.map((e) => (
              <li key={e._id} className="activity-timeline__row">
                <Avatar label={e.actor || "??"} />
                <span className="activity-timeline__icon" aria-hidden="true">
                  {iconFor(e.action)}
                </span>
                <div className="activity-timeline__content">
                  <div className="activity-timeline__summary">
                    <strong>{e.actor}</strong> {e.summary}
                  </div>
                  <div className="activity-timeline__meta">
                    <span>{e.action}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={e.createdAtISO}>{relative(e.createdAtISO)}</time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
    </div>
  );
}
