import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MenuSection } from "../../../../components/Menu";
import { RecordTableMetadataEmpty } from "../../../../components/RecordTableMetadataEmpty";
import type { HydratedView } from "../../types";
import { useObjectRecordTableData } from "../hooks/useHydratedView";
import { RecordTable, type RecordTableCellRenderer } from "./RecordTable";
import { RecordTableFilterChips } from "./RecordTableFilterChips";
import { RecordTableFilterPopover } from "./RecordTableFilterPopover";
import { RecordTableScope } from "./RecordTableScope";
import { RecordTableViewToolbar } from "./RecordTableViewToolbar";

type ViewSummary = { _id: string; name: string; position: number; isSystem: boolean };

/** Workspaces (per object) this browser session already asked to top up. */
const requestedMetadataSeeds = new Set<string>();

/**
 * Workspaces created before an object (or one of its seeded views) existed get
 * it the same way other objects arrive: the idempotent seeder runs once, for
 * someone allowed to change settings. Everyone else sees the "Metadata not
 * seeded" state with its one-click button until then.
 */
function useEnsureRecordMetadata({
  societyId,
  nameSingular,
  loading,
  objectMissing,
  views,
  requiredViewNames,
}: {
  societyId: Id<"societies"> | undefined;
  nameSingular: string;
  loading: boolean;
  objectMissing: boolean;
  views: ViewSummary[];
  requiredViewNames?: readonly string[];
}) {
  const { loaded, can } = usePermissions();
  const ensure = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const canSeed = loaded && can("settings:write");
  const missingView = !objectMissing && (requiredViewNames ?? []).some((name) => !views.some((view) => view.name === name));
  useEffect(() => {
    if (!societyId || loading || !canSeed || (!objectMissing && !missingView)) return;
    const key = `${societyId}:${nameSingular}`;
    if (requestedMetadataSeeds.has(key)) return;
    requestedMetadataSeeds.add(key);
    void ensure({ societyId }).catch(() => undefined);
  }, [societyId, nameSingular, loading, canSeed, objectMissing, missingView, ensure]);
}

/**
 * A metadata-driven register: loads the object's fields and saved views,
 * wires the view toolbar (search, filters, sort, group by, export, saved
 * views), the filter chips and the preview sidebar around one RecordTable.
 *
 * Pages hand over display-ready records (joins and roll-ups already applied,
 * every field a plain value so sorting, filtering, export and the sidebar all
 * read the same thing) and keep composite cells through `renderCell`.
 */
export function ObjectRecordTable({
  societyId,
  nameSingular,
  tableId,
  label,
  icon,
  objectLabel,
  records,
  loading = false,
  renderCell,
  renderRowActions,
  rowMenuSections,
  emptyState,
  selectable,
  onRecordClick,
  toolbarActions,
  filterViews,
  transformView,
  requiredViewNames,
  children,
}: {
  societyId: Id<"societies"> | undefined;
  /** Object metadata name, e.g. "inventoryItem". */
  nameSingular: string;
  /** Distinguishes several tables of one object (scopes grouping/collapse memory). */
  tableId?: string;
  label: string;
  icon?: ReactNode;
  /** Used in the "Metadata not seeded" state, e.g. "inventory item". */
  objectLabel: string;
  records: any[];
  loading?: boolean;
  renderCell?: RecordTableCellRenderer;
  renderRowActions?: (record: any) => ReactNode;
  rowMenuSections?: (record: any) => MenuSection[];
  emptyState?: ReactNode;
  selectable?: boolean;
  /**
   * Opens the record's full surface (detail page or the page's own editor)
   * from the preview sidebar. Without it rows still open the preview.
   */
  onRecordClick?: (recordId: string, record: any) => void;
  toolbarActions?: ReactNode;
  /** Narrow the saved views offered by this page (e.g. route-specific ones). */
  filterViews?: (views: ViewSummary[]) => ViewSummary[];
  /** Page-level column adjustments (e.g. hide a column that never applies). */
  transformView?: (view: HydratedView | null) => HydratedView | null;
  /** Seeded views this page relies on; a workspace missing one is topped up. */
  requiredViewNames?: readonly string[];
  /** Rendered inside the table scope after the table (bulk bars, footers). */
  children?: ReactNode;
}) {
  const [viewId, setViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({ societyId, nameSingular, viewId });
  const objectMissing = !tableData.loading && !tableData.objectMetadata;
  useEnsureRecordMetadata({
    societyId,
    nameSingular,
    loading: tableData.loading,
    objectMissing,
    views: tableData.views,
    requiredViewNames,
  });
  const views = useMemo(
    () => (filterViews ? filterViews(tableData.views) : tableData.views),
    [filterViews, tableData.views],
  );
  const hydratedView = useMemo(
    () => (transformView ? transformView(tableData.hydratedView) : tableData.hydratedView),
    [transformView, tableData.hydratedView],
  );

  if (objectMissing) return <RecordTableMetadataEmpty societyId={societyId} objectLabel={objectLabel} />;
  if (!tableData.objectMetadata || !societyId) {
    return (
      <div className="record-table__loading" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="record-table__loading-row" />
        ))}
      </div>
    );
  }

  return (
    <RecordTableScope
      tableId={tableId ?? nameSingular}
      objectMetadata={tableData.objectMetadata}
      hydratedView={hydratedView}
      records={records}
      recordPreview
      onRecordClick={onRecordClick ? (recordId, record) => onRecordClick(recordId, record) : undefined}
    >
      <RecordTableViewToolbar
        societyId={societyId}
        objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
        icon={icon}
        label={label}
        views={views}
        currentViewId={viewId ?? views[0]?._id ?? null}
        onChangeView={(next) => setViewId(next as Id<"views">)}
        onOpenFilter={() => setFilterOpen((open) => !open)}
        actions={toolbarActions}
      />
      <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
      <RecordTableFilterChips />
      <RecordTable
        loading={loading || tableData.loading}
        selectable={selectable}
        emptyState={emptyState}
        renderCell={renderCell}
        renderRowActions={renderRowActions}
        rowMenuSections={rowMenuSections}
      />
      {children}
    </RecordTableScope>
  );
}
