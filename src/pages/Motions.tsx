import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { CalendarPlus, ClipboardList, Gavel, Plus, Tag, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { isRoutineMotion } from "../lib/motionGovernance";

// Master list of every first-class motion (the referenceable record the society
// decisions live in). The "Default" view hides routine motions (adjournment,
// approve-previous-minutes, or anything tagged routine); switch to "All" to see
// them. Tags drive the filtering and are editable inline.
export function MotionsPage() {
  const society = useSociety();
  const toast = useToast();
  const [view, setView] = useState<"default" | "all">("default");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});

  const motions = useQuery(api.motions.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const setTags = useMutation(api.motions.setTags);

  const meetingById = useMemo(() => {
    const map = new Map<string, any>();
    (meetings ?? []).forEach((m: any) => map.set(String(m._id), m));
    return map;
  }, [meetings]);

  const allStatuses = useMemo<string[]>(
    () => {
      const set = new Set<string>();
      (motions ?? []).forEach((m: any) => {
        const s = String(m.status ?? "");
        if (s) set.add(s);
      });
      return Array.from(set).sort();
    },
    [motions],
  );
  const allTags = useMemo<string[]>(
    () => {
      const set = new Set<string>();
      (motions ?? []).forEach((m: any) => (m.tags ?? []).forEach((t: string) => set.add(String(t))));
      return Array.from(set).sort();
    },
    [motions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (motions ?? []).filter((m: any) => {
      if (view === "default" && isRoutineMotion(m)) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (tagFilter !== "all" && !(m.tags ?? []).map((t: string) => String(t)).includes(tagFilter)) {
        return false;
      }
      if (q) {
        const hay = `${m.title ?? ""} ${m.text ?? ""} ${m.movedBy ?? ""} ${m.secondedBy ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [motions, view, statusFilter, tagFilter, search]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const hiddenCount =
    view === "default" ? (motions ?? []).filter((m: any) => isRoutineMotion(m)).length : 0;

  const addTag = async (motion: any) => {
    const value = (tagDraft[String(motion._id)] ?? "").trim().toLowerCase();
    if (!value) return;
    const next = Array.from(new Set([...(motion.tags ?? []).map((t: string) => String(t)), value]));
    setTagDraft({ ...tagDraft, [String(motion._id)]: "" });
    try {
      await setTags({ motionId: motion._id, tags: next });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update tags");
    }
  };

  const removeTag = async (motion: any, tag: string) => {
    const next = (motion.tags ?? []).map((t: string) => String(t)).filter((t: string) => t !== tag);
    try {
      await setTags({ motionId: motion._id, tags: next });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update tags");
    }
  };

  return (
    <div className="page motions">
      <PageHeader
        title="Motions"
        icon={<Gavel size={16} />}
        iconColor="orange"
        subtitle="Every decision your society has moved — a referenceable record across all meetings."
        actions={(
          <>
            <Link className="btn-action" to="/app/motion-backlog">
              <ClipboardList size={12} /> Backlog
            </Link>
            <Link className="btn-action" to="/app/motion-library">
              <CalendarPlus size={12} /> Library
            </Link>
          </>
        )}
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">All motions</h2>
          <span className="card__subtitle">
            {filtered.length} shown{hiddenCount ? ` · ${hiddenCount} routine hidden` : ""}
          </span>
          <div className="row" style={{ gap: 8, marginLeft: "auto", flexWrap: "wrap", alignItems: "end" }}>
            <Field label="View">
              <Select
                value={view}
                onChange={(value) => setView(value as "default" | "all")}
                options={[
                  { value: "default", label: "Default (hide routine)" },
                  { value: "all", label: "All" },
                ]}
              />
            </Field>
            <Field label="Status">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "all", label: "All statuses" }, ...allStatuses.map((s) => ({ value: s, label: s }))]}
              />
            </Field>
            {allTags.length > 0 && (
              <Field label="Tag">
                <Select
                  value={tagFilter}
                  onChange={setTagFilter}
                  options={[{ value: "all", label: "All tags" }, ...allTags.map((t) => ({ value: t, label: t }))]}
                />
              </Field>
            )}
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search motions…"
              style={{ flex: "1 1 180px", minWidth: 0 }}
            />
          </div>
        </div>
        <div className="card__body">
          {(motions ?? []).length === 0 ? (
            <div className="empty-state empty-state--sm">
              <Gavel size={18} />
              <strong>No motions recorded yet.</strong>
              <span className="muted">
                Motions appear here as they are moved in meeting minutes, or after running the
                backfill.
              </span>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Motion</th>
                    <th>Status</th>
                    <th>Votes</th>
                    <th>Moved / seconded</th>
                    <th>Meeting</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m: any) => {
                    const meeting = m.primaryMeetingId ? meetingById.get(String(m.primaryMeetingId)) : null;
                    return (
                      <tr key={m._id}>
                        <td>
                          <strong>{m.title || truncate(m.text, 70)}</strong>
                          {m.title && <div className="muted">{truncate(m.text, 90)}</div>}
                        </td>
                        <td>
                          <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                          {m.outcome && <div className="muted">{m.outcome}</div>}
                        </td>
                        <td className="muted">
                          {m.votesFor != null || m.votesAgainst != null
                            ? `${m.votesFor ?? 0}/${m.votesAgainst ?? 0}/${m.abstentions ?? 0}`
                            : decidedByLabel(m.decidedBy)}
                        </td>
                        <td className="muted">
                          {m.movedBy || "—"}
                          {m.secondedBy ? ` · ${m.secondedBy}` : ""}
                        </td>
                        <td className="muted">
                          {meeting ? `${meeting.title} (${formatDate(meeting.scheduledAt)})` : "—"}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                            {(m.tags ?? []).map((tag: string) => (
                              <Badge key={tag} tone="neutral">
                                <span className="row" style={{ gap: 2, alignItems: "center" }}>
                                  <Tag size={10} /> {tag}
                                  <button
                                    className="btn btn--ghost btn--icon"
                                    style={{ padding: 0, height: 14 }}
                                    aria-label={`Remove tag ${tag}`}
                                    onClick={() => removeTag(m, tag)}
                                  >
                                    <X size={10} />
                                  </button>
                                </span>
                              </Badge>
                            ))}
                            <input
                              className="input"
                              style={{ width: 90, height: 24, fontSize: 12 }}
                              value={tagDraft[String(m._id)] ?? ""}
                              onChange={(e) => setTagDraft({ ...tagDraft, [String(m._id)]: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") addTag(m);
                              }}
                              placeholder="+ tag"
                              aria-label="Add tag"
                            />
                            <button
                              className="btn btn--ghost btn--icon"
                              aria-label="Add tag"
                              onClick={() => addTag(m)}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(value: string | undefined, max: number) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// A motion with no tally was either decided by general consent (the common case
// for adjournment / approving the previous minutes) or closed automatically.
function decidedByLabel(decidedBy: string | undefined): string {
  if (decidedBy === "consent") return "By consent";
  if (decidedBy === "automatic") return "Automatic";
  return "—";
}

function statusTone(status: string): "success" | "warn" | "info" | "neutral" {
  if (status === "Voted") return "success";
  if (status === "Agenda" || status === "Moved") return "info";
  if (status === "Tabled" || status === "Deferred") return "warn";
  return "neutral";
}
