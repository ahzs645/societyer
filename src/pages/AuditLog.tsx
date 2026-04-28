import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Shield, Download } from "lucide-react";
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";
import { rowsToCsv } from "@/lib/csv";

/**
 * Append-only activity log. Migrated to RecordTable so it shares the
 * uniform search/filter/sort/column-visibility UX with the rest of the
 * app — but all fields are seeded as `isReadOnly` so the inline editor
 * stays out of reach (every row is machine-written).
 *
 * Views are intentionally *not* saveable here (a log doesn't need
 * per-user view config), so we use the plain `RecordTableToolbar`
 * rather than `RecordTableViewToolbar`.
 */
export function AuditLogPage() {
  const society = useSociety();
  const activity = useQuery(
    api.activity.list,
    society ? { societyId: society._id, limit: 500 } : "skip",
  );
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "auditLogEntry",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const records = (activity ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const exportCsv = () => {
    const rows = activity ?? [];
    const body = rowsToCsv([
      ["Timestamp", "Actor", "Entity", "EntityId", "Action", "Summary"],
      ...rows.map((r) => [
        r.createdAtISO,
        r.actor,
        r.entityType,
        r.entityId ?? "",
        r.action,
        r.summary,
      ]),
    ]);
    const blob = new Blob([body], { type: "text/csv" });
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

      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            audit log object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="audit-log"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableToolbar
            icon={<Shield size={14} />}
            label="Activity"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || activity === undefined}
            renderCell={({ field, value }) => {
              // Entity type renders as a Badge to match the old DataTable
              // look. Everything else falls through to the default
              // metadata-driven display.
              if (field.name === "entityType") {
                return value ? <Badge>{String(value)}</Badge> : null;
              }
              if (field.name === "summary") {
                return <span className="muted">{String(value ?? "")}</span>;
              }
              return undefined;
            }}
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
