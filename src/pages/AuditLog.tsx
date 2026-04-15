import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { formatDateTime } from "../lib/format";
import { Shield, Download, Tag } from "lucide-react";

const FIELDS: FilterField<any>[] = [
  {
    id: "entityType",
    label: "Entity",
    icon: <Tag size={14} />,
    match: (r, q) => r.entityType.toLowerCase().includes(q.toLowerCase()),
  },
  {
    id: "actor",
    label: "Actor",
    icon: <Tag size={14} />,
    match: (r, q) => r.actor.toLowerCase().includes(q.toLowerCase()),
  },
  {
    id: "action",
    label: "Action",
    icon: <Tag size={14} />,
    match: (r, q) => r.action.toLowerCase().includes(q.toLowerCase()),
  },
];

export function AuditLogPage() {
  const society = useSociety();
  const activity = useQuery(
    api.activity.list,
    society ? { societyId: society._id, limit: 500 } : "skip",
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const exportCsv = () => {
    const rows = activity ?? [];
    const header = ["Timestamp", "Actor", "Entity", "EntityId", "Action", "Summary"].join(",");
    const body = rows
      .map((r) =>
        [
          r.createdAtISO,
          csvEscape(r.actor),
          r.entityType,
          r.entityId ?? "",
          r.action,
          csvEscape(r.summary),
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `societyer-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        icon={<Shield size={16} />}
        iconColor="red"
        subtitle="Every create, update, signature and bot run is recorded here. Use for compliance evidence and incident review."
        actions={
          <button className="btn-action" onClick={exportCsv}>
            <Download size={12} /> Export CSV
          </button>
        }
      />

      <DataTable
        label="Activity"
        icon={<Shield size={14} />}
        data={(activity ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search actor, action, entity…"
        searchExtraFields={[(r) => r.summary, (r) => r.entityId ?? ""]}
        defaultSort={{ columnId: "createdAtISO", dir: "desc" }}
        columns={[
          {
            id: "createdAtISO",
            header: "When",
            sortable: true,
            accessor: (r) => r.createdAtISO,
            render: (r) => <span className="mono">{formatDateTime(r.createdAtISO)}</span>,
          },
          { id: "actor", header: "Actor", sortable: true, accessor: (r) => r.actor },
          {
            id: "entityType",
            header: "Entity",
            sortable: true,
            accessor: (r) => r.entityType,
            render: (r) => <Badge>{r.entityType}</Badge>,
          },
          { id: "action", header: "Action", sortable: true, accessor: (r) => r.action },
          {
            id: "summary",
            header: "Summary",
            render: (r) => <span className="muted">{r.summary}</span>,
          },
        ]}
      />
    </div>
  );
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
