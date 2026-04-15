import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { formatDate } from "../lib/format";
import { FileText, Calendar, Tag, CheckCircle2, ClipboardCheck, ListTodo } from "lucide-react";

type AugmentedMinutes = any & {
  _meetingTitle: string;
  _meetingType: string;
  _pendingActions: number;
};

const MINUTES_FIELDS: FilterField<AugmentedMinutes>[] = [
  { id: "meeting", label: "Meeting title", icon: <FileText size={14} />, match: (m, q) => (m._meetingTitle ?? "").toLowerCase().includes(q.toLowerCase()) },
  { id: "type", label: "Meeting type", icon: <Tag size={14} />, options: ["AGM", "SGM", "Board", "Committee"], match: (m, q) => m._meetingType === q },
  { id: "quorum", label: "Quorum", icon: <CheckCircle2 size={14} />, options: ["Met", "Not met"], match: (m, q) => (m.quorumMet ? "Met" : "Not met") === q },
  { id: "approved", label: "Approval status", icon: <ClipboardCheck size={14} />, options: ["Approved", "Pending"], match: (m, q) => (m.approvedAt ? "Approved" : "Pending") === q },
  { id: "actions", label: "Action items", icon: <ListTodo size={14} />, options: ["Has open", "All done"], match: (m, q) => q === "Has open" ? m._pendingActions > 0 : m._pendingActions === 0 },
  { id: "heldYear", label: "Held in year", icon: <Calendar size={14} />, match: (m, q) => (m.heldAt ?? "").startsWith(q) },
];

export function MinutesPage() {
  const society = useSociety();
  const minutes = useQuery(api.minutes.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const navigate = useNavigate();

  const byId = useMemo(() => new Map<string, any>((meetings ?? []).map((m: any) => [m._id, m])), [meetings]);
  const augmented: AugmentedMinutes[] = useMemo(() => {
    return (minutes ?? []).map((m: any) => {
      const meeting = byId.get(m.meetingId);
      return {
        ...m,
        _meetingTitle: meeting?.title ?? "",
        _meetingType: meeting?.type ?? "",
        _pendingActions: m.actionItems.filter((a: any) => !a.done).length,
      };
    });
  }, [minutes, byId]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Minutes"
        icon={<FileText size={16} />}
        iconColor="turquoise"
        subtitle="All meeting minutes on file. Minutes of general meetings (AGM/SGM) are accessible to members."
      />

      <DataTable<AugmentedMinutes>
        label="All minutes"
        icon={<FileText size={14} />}
        data={augmented}
        rowKey={(r) => r._id}
        filterFields={MINUTES_FIELDS}
        searchPlaceholder="Search meeting, discussion, decisions…"
        searchExtraFields={[(r) => r.discussion, (r) => r.decisions.join(" ")]}
        defaultSort={{ columnId: "heldAt", dir: "desc" }}
        onRowClick={(row) => navigate(`/app/meetings/${row.meetingId}`)}
        columns={[
          {
            id: "meeting", header: "Meeting", sortable: true,
            accessor: (r) => r._meetingTitle,
            render: (r) => (
              <>
                <Link to={`/app/meetings/${r.meetingId}`} className="cell-chip" onClick={(e) => e.stopPropagation()}>
                  <span className="cell-chip__avatar">{(r._meetingType || "MT").slice(0, 2).toUpperCase()}</span>
                  <span className="cell-chip__name"><strong>{r._meetingTitle || "Meeting"}</strong></span>
                </Link>{" "}
                <Badge tone={r._meetingType === "AGM" ? "accent" : "info"}>{r._meetingType}</Badge>
              </>
            ),
          },
          {
            id: "heldAt", header: "Held", sortable: true,
            accessor: (r) => r.heldAt,
            render: (r) => <span className="mono">{formatDate(r.heldAt)}</span>,
          },
          {
            id: "quorum", header: "Quorum", sortable: true,
            accessor: (r) => (r.quorumMet ? 1 : 0),
            render: (r) => r.quorumMet ? <Badge tone="success">Met</Badge> : <Badge tone="danger">Not met</Badge>,
          },
          { id: "motions", header: "Motions", sortable: true, accessor: (r) => r.motions.length },
          {
            id: "actions", header: "Actions", sortable: true,
            accessor: (r) => r._pendingActions,
            render: (r) => r._pendingActions > 0 ? <Badge tone="warn">{r._pendingActions} open</Badge> : <Badge tone="success">All done</Badge>,
          },
          {
            id: "approved", header: "Approved", sortable: true,
            accessor: (r) => r.approvedAt ?? "",
            render: (r) => r.approvedAt ? <Badge tone="success">{formatDate(r.approvedAt)}</Badge> : <Badge tone="warn">Pending</Badge>,
          },
        ]}
      />
    </div>
  );
}
