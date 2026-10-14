import { useFinancePermissions } from "@/hooks/useFinancePermissions";
// Tab views for the Inventory page. Each is a thin presentational wrapper over
// a metadata-driven record table that receives its data + row callbacks from
// the orchestrator, so the page component stays focused on state and the
// tables stay independently readable. Rows are flattened here (joined names,
// roll-ups, computed flags) so search, filters, sorting, group-by, export and
// the preview sidebar all work from the same plain values.
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Boxes, ChevronDown, ChevronRight, ClipboardList, ExternalLink, History, Layers, Link2, MapPin, MoreHorizontal, Package, Pencil, QrCode, Trash2 } from "lucide-react";
import { Menu } from "../../components/Menu";
import { Segmented } from "../../components/primitives";
import { Badge } from "../../components/ui";
import { useSociety } from "../../hooks/useSociety";
import { ObjectRecordTable, RecordTableEmpty, type HydratedView } from "@/platform/record-engine";
import { formatDate, money } from "../../lib/format";
import { ItemThumb, LocationGlyph, ReceiptEvidence } from "./components";
import { EXPIRY_SOON_DAYS, daysUntil, formatQuantity, movementTone, receiptLinksForMovement, trackingLabel } from "./helpers";

type Maps = {
  itemById: Map<string, any>;
  locationById: Map<string, any>;
  onHandByItemId: Map<string, number>;
  receiptLinksByItemId: Map<string, any[]>;
  balancesByLocationId: Map<string, any[]>;
};

function receiptTitles(links: any[] | undefined) {
  return (links ?? []).map((link) => link.receiptDocument?.title ?? link.receiptDocumentId).filter(Boolean).join(", ");
}

export function StockTab({
  itemRows,
  balanceRows,
  movementRows,
  loading,
  maps,
  onPlace,
  onLink,
  onAddLot,
  onEdit,
  onArchive,
  onDelete,
}: {
  itemRows: any[];
  balanceRows: any[];
  movementRows: any[];
  loading: { items: boolean; balances: boolean; locations: boolean; movements: boolean };
  maps: Maps;
  onPlace: (item: any) => void;
  onLink: (item: any) => void;
  onAddLot: (itemId: string) => void;
  onEdit: (item: any) => void;
  onArchive: (item: any) => void;
  onDelete: (item: any) => void;
}) {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const { itemById, locationById, onHandByItemId, receiptLinksByItemId } = maps;
  const navigate = useNavigate();
  // Items, balances and the movement ledger are three different lists; show one at a time.
  const [view, setView] = useState<"items" | "balances" | "movements">("items");

  const itemRecords = useMemo(() => {
    // item id -> the location names it has any balance in ("Stored in" filter).
    const locationNamesByItemId = new Map<string, Set<string>>();
    for (const balance of balanceRows) {
      const name = locationById.get(balance.locationId)?.name;
      if (!name) continue;
      const set = locationNamesByItemId.get(String(balance.inventoryItemId)) ?? new Set<string>();
      set.add(name);
      locationNamesByItemId.set(String(balance.inventoryItemId), set);
    }
    return itemRows.map((row) => {
      const onHand = onHandByItemId.get(row._id) ?? 0;
      const links = receiptLinksByItemId.get(row._id) ?? [];
      return {
        ...row,
        onHand,
        isLowStock: row.reorderPoint != null && onHand <= row.reorderPoint,
        linkedPurchase: receiptTitles(links),
        storedIn: Array.from(locationNamesByItemId.get(String(row._id)) ?? []).sort().join(", "),
        tracking: trackingLabel(row).replace(/^ · /, ""),
        _searchText: [row.sku, row.category, row.itemType, receiptTitles(links)].filter(Boolean).join(" "),
      };
    });
  }, [itemRows, balanceRows, locationById, onHandByItemId, receiptLinksByItemId]);

  const balanceRecords = useMemo(() => balanceRows.map((row) => {
    const item = itemById.get(row.inventoryItemId);
    const location = locationById.get(row.locationId);
    return {
      ...row,
      itemName: item?.name ?? "Unknown item",
      sku: item?.sku ?? "",
      locationName: location?.name ?? "Unknown location",
      locationCode: location?.code ?? "",
      locationType: location?.locationType ?? "",
      receipt: receiptTitles(receiptLinksByItemId.get(row.inventoryItemId)),
    };
  }), [balanceRows, itemById, locationById, receiptLinksByItemId]);

  const movementRecords = useMemo(() => movementRows.map((row) => {
    const fromLocationName = row.fromLocationId ? locationById.get(row.fromLocationId)?.name ?? "Unknown" : "External";
    const toLocationName = row.toLocationId ? locationById.get(row.toLocationId)?.name ?? "Unknown" : "External";
    return {
      ...row,
      itemName: itemById.get(row.inventoryItemId)?.name ?? "Unknown item",
      fromLocationName,
      toLocationName,
      path: `${fromLocationName} -> ${toLocationName}`,
      reference: [row.reference, row.reason].filter(Boolean).join(" · "),
      receipt: receiptTitles(receiptLinksForMovement(row, receiptLinksByItemId)) || (row.receiptDocumentId ?? ""),
      sourceSystem: row.sourceSystem ?? "manual",
    };
  }), [movementRows, itemById, locationById, receiptLinksByItemId]);

  return (
    <>
      <div style={{ margin: "8px 0 12px" }}>
        <Segmented<"items" | "balances" | "movements">
          value={view}
          onChange={setView}
          items={[
            { id: "items", label: `Items (${itemRows.length})` },
            { id: "balances", label: `Balances (${balanceRows.length})` },
            { id: "movements", label: `Movements (${movementRows.length})` },
          ]}
        />
      </div>
      {view === "items" && (
        <ObjectRecordTable
          societyId={society?._id}
          nameSingular="inventoryItem"
          label="Item catalog"
          objectLabel="inventory item"
          icon={<Package size={14} />}
          records={itemRecords}
          loading={loading.items}
          onRecordClick={(_id, row) => onEdit(row)}
          emptyState={<RecordTableEmpty title="No items yet." description="Use New › Item to add a supply, consumable or tracked item." />}
          renderCell={({ record: row, field }) => {
            if (field.name === "name") return (
              <span className="row" style={{ gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
                <ItemThumb item={row} />
                <span className="record-table__identifier-lines">
                  <span className="record-table__identifier-primary">
                    <strong>{row.name}</strong>{row.status === "archived" && <Badge tone="neutral">archived</Badge>}
                  </span>
                  <span className="record-table__identifier-secondary muted mono">{row.sku ?? "No SKU"}</span>
                </span>
              </span>
            );
            if (field.name === "category") return <div><span>{row.category}</span><div className="muted">{row.itemType}{trackingLabel(row)}</div></div>;
            if (field.name === "onHand") return <span className="mono">{formatQuantity(row.onHand, row.unitOfMeasure)}</span>;
            if (field.name === "reorderPoint") return row.reorderPoint != null ? <span className="mono">{row.reorderPoint}</span> : <span className="muted">-</span>;
            if (field.name === "defaultCostCents") return row.defaultCostCents != null ? <span className="mono">{money(row.defaultCostCents)}</span> : <span className="muted">-</span>;
            if (field.name === "linkedPurchase") return <ReceiptEvidence links={receiptLinksByItemId.get(row._id) ?? []} />;
            return undefined;
          }}
          renderRowActions={(row) => (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => onPlace(row)} disabled={!canWrite}><MapPin size={12} /> Place / move</button>
              <Menu
                align="right"
                trigger={
                  <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${row.name}`}>
                    <MoreHorizontal size={14} />
                  </button>
                }
                sections={[{
                  id: "item",
                  items: [
                    { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => onEdit(row) },
                    { id: "link", label: "Link purchase", icon: <Link2 size={14} />, disabled: !canWrite, onSelect: () => onLink(row) },
                    ...(row.trackLot || row.trackSerial ? [{ id: "lot", label: "Add lot", icon: <Layers size={14} />, disabled: !canWrite, onSelect: () => onAddLot(row._id) }] : []),
                    ...(row.assetId ? [{ id: "asset", label: "Open asset", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/app/assets/${row.assetId}`) }] : []),
                    { id: "archive", label: row.status === "archived" ? "Restore" : "Archive", icon: <Archive size={14} />, disabled: !canWrite, onSelect: () => onArchive(row) },
                    { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite, onSelect: () => onDelete(row) },
                  ],
                }]}
              />
            </>
          )}
        />
      )}

      {view === "balances" && (
        <ObjectRecordTable
          societyId={society?._id}
          nameSingular="inventoryBalance"
          label="Stock balances"
          objectLabel="stock balance"
          icon={<Boxes size={14} />}
          records={balanceRecords}
          loading={loading.balances || loading.items || loading.locations}
          onRecordClick={(_id, row) => { const item = itemById.get(row.inventoryItemId); if (item) onEdit(item); }}
          emptyState={<RecordTableEmpty title="No stock balances yet." description="Place or receive stock to see what is held where." />}
          renderCell={({ record: row, field }) => {
            if (field.name === "itemName") return (
              <span className="record-table__identifier-lines">
                <strong className="record-table__identifier-primary">{row.itemName}</strong>
                <span className="record-table__identifier-secondary muted mono">{row.sku || "No SKU"}</span>
              </span>
            );
            if (field.name === "locationName") return (
              <div>
                <span>{row.locationName}</span>
                <div className="muted">{row.locationCode ? `${row.locationCode} · ` : ""}{row.locationType || "location"}</div>
              </div>
            );
            if (field.name === "quantityOnHand") return <span className="mono">{formatQuantity(row.quantityOnHand, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span>;
            if (field.name === "quantityAvailable") return <span className="mono">{formatQuantity(row.quantityAvailable, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span>;
            if (field.name === "receipt") return <ReceiptEvidence links={receiptLinksByItemId.get(row.inventoryItemId) ?? []} />;
            return undefined;
          }}
        />
      )}

      {view === "movements" && (
        <ObjectRecordTable
          societyId={society?._id}
          nameSingular="stockMovement"
          label="Movement ledger"
          objectLabel="stock movement"
          icon={<History size={14} />}
          records={movementRecords}
          loading={loading.movements || loading.items || loading.locations}
          emptyState={<RecordTableEmpty title="No stock movements yet." description="Receipts, transfers and adjustments are listed here once posted." />}
          renderCell={({ record: row, field }) => {
            if (field.name === "movementType") return <Badge tone={movementTone(row.movementType) as any}>{row.movementType}</Badge>;
            if (field.name === "quantity") return <span className="mono">{formatQuantity(row.quantity, row.unitOfMeasure)}</span>;
            if (field.name === "reference") return (
              <div>
                <span>{row.reference || <span className="muted">No reference</span>}</span>
              </div>
            );
            if (field.name === "receipt") return <ReceiptEvidence links={receiptLinksForMovement(row, receiptLinksByItemId)} receiptDocumentId={row.receiptDocumentId} />;
            if (field.name === "sourceSystem") return <span className="muted">{row.sourceSystem}</span>;
            return undefined;
          }}
        />
      )}
    </>
  );
}

// Order locations as a depth-first tree (parent immediately followed by its
// children) and record each row's depth so the name cell can indent. Locations
// whose parent is missing/filtered are treated as roots so nothing disappears.
function orderLocationTree(locations: any[], collapsedIds?: Set<string>, protectedRootIds?: Set<string>) {
  const byId = new Map(locations.map((row) => [String(row._id), row]));
  const children = new Map<string, any[]>();
  const roots: any[] = [];
  for (const row of locations) {
    const parentId = row.parentLocationId ? String(row.parentLocationId) : "";
    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? [];
      list.push(row);
      children.set(parentId, list);
    } else {
      roots.push(row);
    }
  }
  // When a single overarching location contains everything, it's just a wrapper —
  // infer it and show its children at the top level instead of nesting the whole
  // register under one row. Guarded: never hide a root that itself holds stock.
  let topLevel = roots;
  let inferredRoot: any = null;
  if (roots.length === 1) {
    const sole = roots[0];
    const kids = children.get(String(sole._id)) ?? [];
    if (kids.length > 0 && !protectedRootIds?.has(String(sole._id))) {
      topLevel = kids;
      inferredRoot = sole;
    }
  }
  const sortByName = (a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
  const ordered: any[] = [];
  const depthById = new Map<string, number>();
  const childCountById = new Map<string, number>();
  const visit = (row: any, depth: number) => {
    const kids = (children.get(String(row._id)) ?? []).slice().sort(sortByName);
    depthById.set(String(row._id), depth);
    childCountById.set(String(row._id), kids.length);
    ordered.push(row);
    // Stop descending when this node is collapsed so its subtree is hidden.
    if (collapsedIds?.has(String(row._id))) return;
    for (const child of kids) visit(child, depth + 1);
  };
  for (const root of topLevel.slice().sort(sortByName)) visit(root, 0);
  return { ordered, depthById, childCountById, inferredRoot };
}

export function LocationsTab({
  locations,
  loading,
  maps,
  onWhatsHere,
  onEdit,
  onDelete,
  onLabel,
  collapsedIds,
  onToggleCollapse,
}: {
  locations: any[];
  loading: boolean;
  maps: Pick<Maps, "locationById" | "balancesByLocationId">;
  onWhatsHere: (location: any) => void;
  onEdit: (location: any) => void;
  onDelete: (location: any) => void;
  onLabel: (location: any) => void;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const { canWrite, canExport } = useFinancePermissions();
  const society = useSociety();
  const { balancesByLocationId, locationById } = maps;
  const { records, inferredRoot } = useMemo(() => {
    // Locations that hold stock directly — a sole overarching root is only inferred
    // away when it isn't itself storing anything.
    const locationsWithDirectStock = new Set<string>();
    for (const [locId, rows] of balancesByLocationId) {
      if ((rows ?? []).some((b) => (b.quantityOnHand ?? 0) > 0)) locationsWithDirectStock.add(String(locId));
    }
    const tree = orderLocationTree(locations, collapsedIds, locationsWithDirectStock);
    // Roll child contents up into ancestors so a facility/room shows everything
    // stored beneath it, not just items placed directly on it. Walk the full
    // location set (not the collapse-filtered `ordered`) so totals stay correct.
    const childrenByParent = new Map<string, any[]>();
    for (const loc of locations) {
      if (!loc.parentLocationId) continue;
      const list = childrenByParent.get(String(loc.parentLocationId)) ?? [];
      list.push(loc);
      childrenByParent.set(String(loc.parentLocationId), list);
    }
    const rollupQty = (row: any): number => {
      const direct = (balancesByLocationId.get(row._id) ?? []).reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0);
      const kids = childrenByParent.get(String(row._id)) ?? [];
      return direct + kids.reduce((sum, kid) => sum + rollupQty(kid), 0);
    };
    return {
      inferredRoot: tree.inferredRoot,
      records: tree.ordered.map((row) => {
        const direct = balancesByLocationId.get(row._id) ?? [];
        return {
          ...row,
          depth: tree.depthById.get(String(row._id)) ?? 0,
          childCount: tree.childCountById.get(String(row._id)) ?? 0,
          contents: rollupQty(row),
          directQuantity: direct.reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0),
          itemCount: direct.length,
          parentName: row.parentLocationId ? locationById.get(row.parentLocationId)?.name ?? "" : "",
        };
      }),
    };
  }, [locations, collapsedIds, balancesByLocationId, locationById]);
  // Only show the custodian column when at least one location is in custody.
  const hasCustody = locations.some((l) => l.custodianName || l.locationType === "custody");
  const transformView = useCallback((view: HydratedView | null) => {
    if (!view || hasCustody) return view;
    return { ...view, columns: view.columns.map((column) => column.field?.name === "custodianName" ? { ...column, isVisible: false } : column) };
  }, [hasCustody]);
  return (
    <>
    {inferredRoot && (
      <div className="muted" style={{ display: "flex", gap: 6, alignItems: "center", margin: "0 0 6px", fontSize: 13 }}>
        <MapPin size={12} /> Within <strong style={{ color: "var(--text-secondary)" }}>{inferredRoot.name}</strong>
        <button className="btn btn--ghost btn--sm" style={{ padding: "0 4px" }} onClick={() => onEdit(inferredRoot)} disabled={!canWrite}><Pencil size={12} /> edit</button>
      </div>
    )}
    <ObjectRecordTable
      societyId={society?._id}
      nameSingular="inventoryLocation"
      label="Locations & bins"
      objectLabel="inventory location"
      icon={<MapPin size={14} />}
      records={records}
      loading={loading}
      transformView={transformView}
      onRecordClick={(_id, row) => onWhatsHere(row)}
      emptyState={<RecordTableEmpty title="No locations yet." description="Add a facility, room, shelf, or bin so you can say where things live." />}
      renderCell={({ record: row, field }) => {
        if (field.name === "name") {
          const collapsed = collapsedIds.has(String(row._id));
          return (
            <span className="row" style={{ gap: 6, alignItems: "center", flexWrap: "nowrap", paddingLeft: row.depth * 18 }}>
              {row.childCount > 0
                ? (collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />)
                : <span style={{ display: "inline-block", width: 14 }} aria-hidden />}
              <LocationGlyph type={row.locationType} />
              <span>
                <strong>{row.name}</strong>{!row.active && <Badge tone="neutral">inactive</Badge>}
                {row.childCount > 0 && <span className="muted"> · {row.childCount} sub-location{row.childCount === 1 ? "" : "s"}{collapsed ? " (collapsed)" : ""}</span>}
              </span>
            </span>
          );
        }
        if (field.name === "code") return row.code ? <span className="row" style={{ gap: 4 }}><QrCode size={12} /> <span className="mono">{row.code}</span></span> : <span className="muted">-</span>;
        if (field.name === "locationType") return <Badge tone="info">{row.locationType}</Badge>;
        if (field.name === "custodianName") return row.custodianName ? <span>{row.custodianName}</span> : <span className="muted">-</span>;
        if (field.name === "contents") {
          if (!row.itemCount && row.contents === 0) return <span className="muted">empty</span>;
          return <span className="mono">{row.itemCount} item{row.itemCount === 1 ? "" : "s"} · {row.directQuantity}{row.contents !== row.directQuantity ? ` (${row.contents} incl. sub)` : ""}</span>;
        }
        return undefined;
      }}
      renderRowActions={(row) => (
        <>
          {row.childCount > 0 && (
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={collapsedIds.has(String(row._id)) ? `Expand ${row.name}` : `Collapse ${row.name}`}
              onClick={() => onToggleCollapse(String(row._id))}
            >
              {collapsedIds.has(String(row._id)) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => onWhatsHere(row)}><Boxes size={12} /> What's here</button>
          {row.code && <button className="btn btn--ghost btn--sm" onClick={() => onLabel(row)} title="Show printable QR label" disabled={!canExport}><QrCode size={12} /> Label</button>}
          <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)} disabled={!canWrite}><Pencil size={12} /> Edit</button>
          <button className="btn btn--ghost btn--sm" aria-label={`Delete ${row.name}`} onClick={() => onDelete(row)} disabled={!canWrite}><Trash2 size={12} /></button>
        </>
      )}
    />
    </>
  );
}

export function LotsTab({
  lotRows,
  loading,
  maps,
  onEdit,
  onDelete,
}: {
  lotRows: any[];
  loading: boolean;
  maps: Pick<Maps, "itemById">;
  onEdit: (lot: any) => void;
  onDelete: (lot: any) => void;
}) {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const { itemById } = maps;
  const records = useMemo(() => lotRows.map((row) => {
    const item = itemById.get(row.inventoryItemId);
    const days = daysUntil(row.expiresAt);
    return {
      ...row,
      itemName: item?.name ?? "Unknown item",
      sku: item?.sku ?? "",
      isExpiringSoon: days != null && days <= EXPIRY_SOON_DAYS,
    };
  }), [lotRows, itemById]);
  return (
    <ObjectRecordTable
      societyId={society?._id}
      nameSingular="inventoryLot"
      label="Lots & serials"
      objectLabel="lot or serial"
      icon={<Layers size={14} />}
      records={records}
      loading={loading}
      onRecordClick={(_id, row) => onEdit(row)}
      emptyState={<RecordTableEmpty title="No lots or serials yet." description="Enable lot/serial tracking on an item, then add a lot." />}
      renderCell={({ record: row, field }) => {
        if (field.name === "itemName") return (
          <span className="record-table__identifier-lines">
            <strong className="record-table__identifier-primary">{row.itemName}</strong>
            <span className="record-table__identifier-secondary muted mono">{row.sku}</span>
          </span>
        );
        if (field.name === "lotNumber") return row.lotNumber ? <span className="mono">{row.lotNumber}</span> : <span className="muted">-</span>;
        if (field.name === "serialNumber") return row.serialNumber ? <span className="mono">{row.serialNumber}</span> : <span className="muted">-</span>;
        if (field.name === "expiresAt") {
          if (!row.expiresAt) return <span className="muted">-</span>;
          const d = daysUntil(row.expiresAt);
          return <span className="row" style={{ gap: 4 }}><span>{formatDate(row.expiresAt)}</span>{d != null && d <= EXPIRY_SOON_DAYS && <Badge tone="warn">{d < 0 ? "expired" : `${d}d`}</Badge>}</span>;
        }
        if (field.name === "manufacturer") return <span className="muted">{row.manufacturer || "-"}</span>;
        if (field.name === "status") return <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge>;
        return undefined;
      }}
      renderRowActions={(row) => (
        <>
          <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)} disabled={!canWrite}><Pencil size={12} /> Edit</button>
          <button className="btn btn--ghost btn--sm" aria-label={`Delete lot ${row.lotNumber || row.serialNumber || ""}`.trim()} onClick={() => onDelete(row)} disabled={!canWrite}><Trash2 size={12} /></button>
        </>
      )}
    />
  );
}

export function CountsTab({
  countRows,
  loading,
  onEnter,
  onVoid,
}: {
  countRows: any[];
  loading: boolean;
  onEnter: (count: any) => void;
  onVoid: (count: any) => void;
}) {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const records = useMemo(() => countRows.map((row) => {
    const lines = row.lines ?? [];
    const counted = lines.filter((l: any) => l.countedQuantity != null);
    return {
      ...row,
      reviewerName: row.reviewerName ?? "",
      scope: row.scope ?? "all",
      lineCount: lines.length,
      countedLines: counted.length,
      varianceLines: counted.filter((l: any) => (l.countedQuantity - (l.expectedQuantity ?? 0)) !== 0).length,
    };
  }), [countRows]);
  return (
    <ObjectRecordTable
      societyId={society?._id}
      nameSingular="inventoryCount"
      label="Physical counts"
      objectLabel="physical count"
      icon={<ClipboardList size={14} />}
      records={records}
      loading={loading}
      onRecordClick={(_id, row) => { if (row.status === "open" && canWrite) onEnter(row); }}
      emptyState={<RecordTableEmpty title="No physical counts yet." description="Start a count to verify what's actually on the shelf." />}
      renderCell={({ record: row, field }) => {
        if (field.name === "title") return (
          <span className="record-table__identifier-lines">
            <strong className="record-table__identifier-primary">{row.title}</strong>
            <span className="record-table__identifier-secondary muted">{row.reviewerName || "Unassigned"}</span>
          </span>
        );
        if (field.name === "scope") return <Badge tone="info">{row.scope}</Badge>;
        if (field.name === "status") return <Badge tone={row.status === "open" ? "warn" : row.status === "completed" ? "success" : "neutral"}>{row.status}</Badge>;
        if (field.name === "lineCount") return <span className="mono">{row.lineCount}</span>;
        if (field.name === "countedLines") return <span className="mono">{row.countedLines}/{row.lineCount}{row.varianceLines ? ` · ${row.varianceLines}Δ` : ""}</span>;
        return undefined;
      }}
      renderRowActions={(row) => (
        <>
          {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={() => onEnter(row)} disabled={!canWrite}><Pencil size={12} /> Enter counts</button>}
          {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={() => onVoid(row)} disabled={!canWrite}>Void</button>}
        </>
      )}
    />
  );
}
