import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { History, Undo2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Modal";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";

/** One row of personHistory:mergeHistory. */
export type DirectoryMergeRow = {
  _id: string;
  createdAtISO: string;
  mergedName: string;
  survivorId: string;
  survivorName: string;
  movedReferences: number;
  rationale?: string;
  status: string;
  undoneAtISO?: string;
};

const MERGES_TABLE = staticRecordTable({
  id: "people-directory:merge-history",
  nameSingular: "personMerge",
  namePlural: "personMerges",
  labelSingular: "Merge",
  labelPlural: "Merges",
  labelIdentifierFieldName: "mergedName",
  sorts: [{ field: "createdAtISO", direction: "desc" }],
  fields: [
    { name: "mergedName", label: "Merged profile", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "survivorName", label: "Kept as", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "createdAtISO", label: "Merged", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "movedReferences", label: "Links moved", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false } },
    { name: "rationale", label: "Rationale", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: { options: [{ value: "applied", label: "Merged", color: "green" }, { value: "undone", label: "Undone", color: "gray" }] },
    },
  ],
});

/** The people directory's "Merge history" tab: every merge in the workspace, each one undoable. */
export function MergeHistoryTab({
  societyId,
  merges,
  loading,
  canManage,
}: {
  societyId: string;
  merges: DirectoryMergeRow[];
  loading: boolean;
  canManage: boolean;
}) {
  const unmerge = useMutation(api.personHistory.unmergePeople);
  const confirm = useConfirm();
  const toast = useToast();

  const undoMerge = async (row: DirectoryMergeRow) => {
    const ok = await confirm({
      title: `Undo merge of ${row.mergedName}?`,
      message: `${row.mergedName} becomes a separate profile again. The ${row.movedReferences} links moved into ${row.survivorName} by this merge go back, except any that were changed since.`,
      confirmLabel: "Undo merge",
      tone: "warn",
    });
    if (!ok) return;
    try {
      const result = (await unmerge({ societyId, mergeId: row._id })) as { restored: number; skipped: number };
      toast.success("Merge undone", `${result.restored} links restored${result.skipped ? `, ${result.skipped} left in place` : ""}`);
    } catch (error) {
      toast.error("Could not undo the merge", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">Merge history</h2>
        <span className="card__subtitle">Undoing a merge restores the separate profile and moves its links back.</span>
      </div>
      <RecordListTable<DirectoryMergeRow>
        variant="card"
        table={MERGES_TABLE}
        tableId="people-directory-merges"
        label="Merges"
        icon={<History size={14} />}
        records={merges}
        loading={loading}
        renderCell={({ record, field }) => {
          if (field.name === "mergedName") return <strong>{record.mergedName}</strong>;
          if (field.name === "survivorName") return <Link to={`/app/people-directory/${record.survivorId}`}>{record.survivorName}</Link>;
          if (field.name === "createdAtISO") return <span>{formatDate(record.createdAtISO)}</span>;
          if (field.name === "status") {
            return record.status === "undone"
              ? <Badge>Undone{record.undoneAtISO ? ` ${formatDate(record.undoneAtISO)}` : ""}</Badge>
              : <Badge tone="success">Merged</Badge>;
          }
          return undefined;
        }}
        renderRowActions={(row) =>
          row.status === "applied" ? (
            <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => void undoMerge(row)}>
              <Undo2 size={12} /> Undo
            </button>
          ) : null
        }
        emptyState={<RecordTableEmpty title="No merges yet" description="Merged profiles are listed here and can be undone." />}
      />
    </section>
  );
}
