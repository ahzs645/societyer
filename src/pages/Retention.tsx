import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Archive } from "lucide-react";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Records-due-for-review page. The rows are entirely *derived* from
 * the `retention.expiredForSociety` query (each row flattens the doc
 * + overdue metadata). All six columns are read-only in the seed, so
 * the record table has no `onUpdate` handler — flag / archive stay
 * as row action buttons that call `documents.flagForDeletion` and
 * `documents.archive`.
 */
export function RetentionPage() {
  const society = useSociety();
  const expired = useQuery(
    api.retention.expiredForSociety,
    society ? { societyId: society._id } : "skip",
  );
  const flag = useMutation(api.documents.flagForDeletion);
  const archive = useMutation(api.documents.archive);
  const prompt = usePrompt();
  const toast = useToast();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "retentionRow",
    viewId: currentViewId,
  });

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

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Records due for review"
        icon={<Archive size={16} />}
        iconColor="gray"
        subtitle="Documents past their retention period. Default: 10 years for most records, 7 years for financial (CRA), indefinite for the constitution and bylaws. Review before purging."
      />

      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            retention-row object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="retention"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={rows}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Archive size={14} />}
            label="Expired records"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || expired === undefined}
            renderRowActions={(r) => (
              <>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    flag({ id: r._id as any, flagged: !r.flagged });
                  }}
                >
                  {r.flagged ? "Keep record" : "Flag for purge review"}
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Archive ${r.title}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const reason = await prompt({
                      title: "Archive retained document",
                      message: `"${r.title}" will stay in the audit trail as archived instead of being permanently deleted.`,
                      placeholder: "Reason (required)",
                      confirmLabel: "Archive",
                      required: true,
                    });
                    if (!reason) return;
                    await archive({ id: r._id as any, reason });
                    toast.success("Document archived");
                  }}
                >
                  <Archive size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}
    </div>
  );
}
