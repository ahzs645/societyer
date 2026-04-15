import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { Trash2, Archive } from "lucide-react";
import { formatDate } from "../lib/format";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";

export function RetentionPage() {
  const society = useSociety();
  const expired = useQuery(
    api.retention.expiredForSociety,
    society ? { societyId: society._id } : "skip",
  );
  const flag = useMutation(api.documents.flagForDeletion);
  const remove = useMutation(api.documents.remove);
  const confirm = useConfirm();
  const toast = useToast();

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const rows = (expired ?? []).map((r: any) => ({
    _id: r.doc._id,
    title: r.doc.title,
    category: r.doc.category,
    createdAtISO: r.doc.createdAtISO,
    retentionYears: r.doc.retentionYears,
    daysOverdue: r.daysOverdue,
    flagged: r.doc.flaggedForDeletion,
    doc: r.doc,
  }));

  return (
    <div className="page">
      <PageHeader
        title="Records due for review"
        icon={<Archive size={16} />}
        iconColor="gray"
        subtitle="Documents past their retention period. Default: 10 years for most records, 7 years for financial (CRA), indefinite for the constitution and bylaws. Review before purging."
      />

      <DataTable
        label="Expired records"
        icon={<Archive size={14} />}
        data={rows}
        rowKey={(r) => String(r._id)}
        searchPlaceholder="Search title, category…"
        defaultSort={{ columnId: "daysOverdue", dir: "desc" }}
        emptyMessage="Nothing past retention. Records are reviewed weekly by a background job."
        columns={[
          { id: "title", header: "Title", sortable: true, accessor: (r) => r.title, render: (r) => <strong>{r.title}</strong> },
          { id: "category", header: "Category", sortable: true, accessor: (r) => r.category, render: (r) => <Badge>{r.category}</Badge> },
          { id: "createdAtISO", header: "Created", sortable: true, accessor: (r) => r.createdAtISO, render: (r) => <span className="mono">{formatDate(r.createdAtISO)}</span> },
          { id: "retentionYears", header: "Retention", sortable: true, accessor: (r) => r.retentionYears ?? 0, render: (r) => r.retentionYears ? `${r.retentionYears}y` : "—" },
          {
            id: "daysOverdue", header: "Overdue by", sortable: true, accessor: (r) => r.daysOverdue ?? 0,
            render: (r) => r.daysOverdue != null && r.daysOverdue >= 0 ? <Badge tone="danger">{r.daysOverdue}d</Badge> : <Badge tone="warn">Flagged</Badge>,
          },
        ]}
        renderRowActions={(r) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => flag({ id: r._id as any, flagged: !r.flagged })}>
              {r.flagged ? "Keep" : "Confirm purge"}
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete document?",
                  message: `"${r.title}" will be permanently removed. This cannot be undone.`,
                  confirmLabel: "Delete",
                  tone: "danger",
                });
                if (!ok) return;
                await remove({ id: r._id as any });
                toast.success("Document deleted");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />
    </div>
  );
}
