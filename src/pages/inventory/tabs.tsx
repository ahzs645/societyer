// Tab views for the Inventory page. Each is a thin presentational wrapper over
// DataTable that receives its data + row callbacks from the orchestrator, so the
// page component stays focused on state and the tables stay independently
// readable.
import { Link } from "react-router-dom";
import { Boxes, ChevronDown, ChevronRight, ClipboardList, History, Layers, Link2, MapPin, Package, Pencil, QrCode, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui";
import { DataTable } from "../../components/DataTable";
import { money } from "../../lib/format";
import { ItemThumb, LocationGlyph, ReceiptEvidence } from "./components";
import { EXPIRY_SOON_DAYS, daysUntil, formatQuantity, movementTone, receiptLinksForMovement, trackingLabel } from "./helpers";

type Maps = {
  itemById: Map<string, any>;
  locationById: Map<string, any>;
  onHandByItemId: Map<string, number>;
  receiptLinksByItemId: Map<string, any[]>;
  balancesByLocationId: Map<string, any[]>;
};

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
  const { itemById, locationById, onHandByItemId, receiptLinksByItemId } = maps;
  // Locations that currently hold stock, used as preset options for the Location
  // filter on both tables.
  const locationOptions = Array.from(
    new Set(
      balanceRows
        .map((b) => locationById.get(b.locationId)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ).sort();
  // item id -> the location names it has any balance in, for the catalog filter.
  const locationNamesByItemId = new Map<string, Set<string>>();
  for (const b of balanceRows) {
    const name = locationById.get(b.locationId)?.name;
    if (!name) continue;
    const set = locationNamesByItemId.get(String(b.inventoryItemId)) ?? new Set<string>();
    set.add(name);
    locationNamesByItemId.set(String(b.inventoryItemId), set);
  }
  const categoryOptions = Array.from(new Set(itemRows.map((r) => r.category).filter(Boolean))).sort();
  return (
    <>
      <DataTable
        label="Item catalog"
        icon={<Package size={14} />}
        data={itemRows}
        rowKey={(row) => row._id}
        loading={loading.items}
        viewsKey="inventory-items"
        searchPlaceholder="Search item, SKU, category..."
        searchExtraFields={[(row) => row.sku, (row) => row.category, (row) => row.itemType]}
        filterFields={[
          { id: "category", label: "Category", options: categoryOptions, match: (row: any, q: string) => String(row.category ?? "").toLowerCase() === q.toLowerCase() },
          { id: "location", label: "Stored in", options: locationOptions, match: (row: any, q: string) => Array.from(locationNamesByItemId.get(String(row._id)) ?? new Set<string>()).some((n) => n.toLowerCase() === q.toLowerCase()) },
        ]}
        emptyMessage="No items yet. Add an item, backfill from the asset register, or import an OpenBoxes snapshot."
        columns={[
          {
            id: "item",
            header: "Item",
            sortable: true,
            accessor: (row) => row.name ?? "",
            render: (row) => (
              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
                <ItemThumb item={row} />
                <div>
                  <strong>{row.name}</strong>{row.status === "archived" && <Badge tone="neutral">archived</Badge>}
                  <div className="muted mono">{row.sku ?? "No SKU"}</div>
                </div>
              </div>
            ),
          },
          { id: "category", header: "Category", sortable: true, accessor: (row) => row.category ?? "", render: (row) => <div><span>{row.category}</span><div className="muted">{row.itemType}{trackingLabel(row)}</div></div> },
          { id: "onHand", header: "On hand", sortable: true, align: "right", accessor: (row) => onHandByItemId.get(row._id) ?? 0, render: (row) => <span className="mono">{formatQuantity(onHandByItemId.get(row._id) ?? 0, row.unitOfMeasure)}</span> },
          { id: "reorder", header: "Reorder", align: "right", accessor: (row) => row.reorderPoint ?? "", render: (row) => row.reorderPoint != null ? <span className="mono">{row.reorderPoint}</span> : <span className="muted">-</span> },
          { id: "cost", header: "Unit cost", align: "right", accessor: (row) => row.defaultCostCents ?? 0, render: (row) => row.defaultCostCents != null ? <span className="mono">{money(row.defaultCostCents)}</span> : <span className="muted">-</span> },
          {
            id: "purchase",
            header: "Linked purchase",
            accessor: (row) => receiptLinksByItemId.get(row._id)?.length ?? 0,
            render: (row) => <ReceiptEvidence links={receiptLinksByItemId.get(row._id) ?? []} />,
          },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => onPlace(row)}><MapPin size={12} /> Place / move</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onLink(row)}><Link2 size={12} /> Link purchase</button>
            {(row.trackLot || row.trackSerial) && <button className="btn btn--ghost btn--sm" onClick={() => onAddLot(row._id)}><Layers size={12} /> Lot</button>}
            <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)}><Pencil size={12} /> Edit</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onArchive(row)}>{row.status === "archived" ? "Restore" : "Archive"}</button>
            <button className="btn btn--ghost btn--sm" onClick={() => onDelete(row)}><Trash2 size={12} /></button>
            {row.assetId && <Link className="btn btn--ghost btn--sm" to={`/app/assets/${row.assetId}`}>Asset</Link>}
          </>
        )}
      />

      <DataTable
        label="Societyer stock balances"
        icon={<Boxes size={14} />}
        data={balanceRows}
        rowKey={(row) => row._id}
        loading={loading.balances || loading.items || loading.locations}
        viewsKey="inventory-balances"
        searchPlaceholder="Search item, SKU, location..."
        searchExtraFields={[
          (row) => itemById.get(row.inventoryItemId)?.name,
          (row) => itemById.get(row.inventoryItemId)?.sku,
          (row) => locationById.get(row.locationId)?.name,
          (row) => locationById.get(row.locationId)?.code,
          (row) => receiptLinksByItemId.get(row.inventoryItemId)?.map((link) => link.receiptDocument?.title).join(" "),
        ]}
        filterFields={[
          { id: "location", label: "Location", options: locationOptions, match: (row: any, q: string) => String(locationById.get(row.locationId)?.name ?? "").toLowerCase() === q.toLowerCase() },
        ]}
        emptyMessage="No stock balances yet. Backfill assets or post a receive movement to create the first ledger balance."
        columns={[
          {
            id: "item",
            header: "Item",
            sortable: true,
            accessor: (row) => itemById.get(row.inventoryItemId)?.name ?? "",
            render: (row) => {
              const item = itemById.get(row.inventoryItemId);
              return (
                <div>
                  <strong>{item?.name ?? "Unknown item"}</strong>
                  <div className="muted mono">{item?.sku ?? "No SKU"}</div>
                </div>
              );
            },
          },
          {
            id: "location",
            header: "Location",
            sortable: true,
            accessor: (row) => locationById.get(row.locationId)?.name ?? "",
            render: (row) => {
              const location = locationById.get(row.locationId);
              return (
                <div>
                  <span>{location?.name ?? "Unknown location"}</span>
                  <div className="muted">{location?.code ? `${location.code} · ` : ""}{location?.locationType ?? "location"}</div>
                </div>
              );
            },
          },
          { id: "onHand", header: "On hand", sortable: true, align: "right", accessor: (row) => row.quantityOnHand ?? 0, render: (row) => <span className="mono">{formatQuantity(row.quantityOnHand, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span> },
          { id: "available", header: "Available", sortable: true, align: "right", accessor: (row) => row.quantityAvailable ?? 0, render: (row) => <span className="mono">{formatQuantity(row.quantityAvailable, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span> },
          {
            id: "receipt",
            header: "Receipt",
            accessor: (row) => receiptLinksByItemId.get(row.inventoryItemId)?.map((link) => link.receiptDocument?.title).join(" ") ?? "",
            render: (row) => <ReceiptEvidence links={receiptLinksByItemId.get(row.inventoryItemId) ?? []} />,
          },
          { id: "lastCounted", header: "Last counted", sortable: true, accessor: (row) => row.lastCountedAtISO ?? "", render: (row) => row.lastCountedAtISO?.slice(0, 10) ?? <span className="muted">-</span> },
        ]}
      />

      <DataTable
        label="Inventory movement ledger"
        icon={<History size={14} />}
        data={movementRows}
        rowKey={(row) => row._id}
        loading={loading.movements || loading.items || loading.locations}
        viewsKey="stock-movements"
        searchPlaceholder="Search movement, item, reference, reason..."
        searchExtraFields={[
          (row) => itemById.get(row.inventoryItemId)?.name,
          (row) => row.reference,
          (row) => row.reason,
          (row) => row.sourceSystem,
          (row) => receiptLinksByItemId.get(row.inventoryItemId)?.map((link) => link.receiptDocument?.title).join(" "),
        ]}
        emptyMessage="No stock movements yet."
        columns={[
          { id: "date", header: "Date", sortable: true, accessor: (row) => row.movementDate, render: (row) => <span className="mono">{row.movementDate}</span> },
          { id: "type", header: "Type", sortable: true, accessor: (row) => row.movementType, render: (row) => <Badge tone={movementTone(row.movementType) as any}>{row.movementType}</Badge> },
          { id: "item", header: "Item", sortable: true, accessor: (row) => itemById.get(row.inventoryItemId)?.name ?? "", render: (row) => itemById.get(row.inventoryItemId)?.name ?? "Unknown item" },
          {
            id: "path",
            header: "From / to",
            accessor: (row) => `${row.fromLocationId ?? ""} ${row.toLocationId ?? ""}`,
            render: (row) => (
              <span>
                {row.fromLocationId ? locationById.get(row.fromLocationId)?.name ?? "Unknown" : "External"}
                {" -> "}
                {row.toLocationId ? locationById.get(row.toLocationId)?.name ?? "Unknown" : "External"}
              </span>
            ),
          },
          { id: "quantity", header: "Quantity", sortable: true, align: "right", accessor: (row) => row.quantity, render: (row) => <span className="mono">{formatQuantity(row.quantity, row.unitOfMeasure)}</span> },
          {
            id: "reference",
            header: "Reference / reason",
            accessor: (row) => `${row.reference ?? ""} ${row.reason ?? ""}`,
            render: (row) => (
              <div>
                <span>{row.reference ?? <span className="muted">No reference</span>}</span>
                {row.reason && <div className="muted">{row.reason}</div>}
              </div>
            ),
          },
          {
            id: "receipt",
            header: "Receipt",
            accessor: (row) => row.receiptDocumentId ?? receiptLinksByItemId.get(row.inventoryItemId)?.map((link) => link.receiptDocument?.title).join(" ") ?? "",
            render: (row) => <ReceiptEvidence links={receiptLinksForMovement(row, receiptLinksByItemId)} receiptDocumentId={row.receiptDocumentId} />,
          },
          { id: "source", header: "Source", sortable: true, accessor: (row) => row.sourceSystem ?? "", render: (row) => <span className="muted">{row.sourceSystem ?? "manual"}</span> },
        ]}
      />
    </>
  );
}

// Order locations as a depth-first tree (parent immediately followed by its
// children) and record each row's depth so the name cell can indent. Locations
// whose parent is missing/filtered are treated as roots so nothing disappears.
function orderLocationTree(locations: any[], collapsedIds?: Set<string>) {
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
  const sortByName = (a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
  const ordered: any[] = [];
  const depthById = new Map<string, number>();
  const childCountById = new Map<string, number>();
  const visit = (row: any, depth: number) => {
    const kids = (children.get(String(row._id)) ?? []).sort(sortByName);
    depthById.set(String(row._id), depth);
    childCountById.set(String(row._id), kids.length);
    ordered.push(row);
    // Stop descending when this node is collapsed so its subtree is hidden.
    if (collapsedIds?.has(String(row._id))) return;
    for (const child of kids) visit(child, depth + 1);
  };
  for (const root of roots.sort(sortByName)) visit(root, 0);
  return { ordered, depthById, childCountById };
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
  const { balancesByLocationId } = maps;
  const { ordered, depthById, childCountById } = orderLocationTree(locations, collapsedIds);
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
  return (
    <DataTable
      label="Locations & bins"
      icon={<MapPin size={14} />}
      data={ordered}
      rowKey={(row) => row._id}
      loading={loading}
      viewsKey="inventory-locations"
      searchPlaceholder="Search location, code, type..."
      searchExtraFields={[(row) => row.code, (row) => row.locationType, (row) => row.address]}
      emptyMessage="No locations yet. Add a facility, room, shelf, or bin so you can say where things live."
      columns={[
        {
          id: "name",
          header: "Location",
          sortable: true,
          accessor: (row) => row.name ?? "",
          render: (row) => {
            const depth = depthById.get(String(row._id)) ?? 0;
            const childCount = childCountById.get(String(row._id)) ?? 0;
            const collapsed = collapsedIds.has(String(row._id));
            return (
              <div className="row" style={{ gap: 6, alignItems: "center", paddingLeft: depth * 18 }}>
                {childCount > 0 ? (
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    style={{ marginLeft: depth > 0 ? -12 : 0 }}
                    aria-label={collapsed ? `Expand ${row.name}` : `Collapse ${row.name}`}
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(String(row._id)); }}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span style={{ display: "inline-block", width: depth > 0 ? 12 : 24 }} aria-hidden />
                )}
                <LocationGlyph type={row.locationType} />
                <div>
                  <strong>{row.name}</strong>{!row.active && <Badge tone="neutral">inactive</Badge>}
                  {childCount > 0 && <span className="muted"> · {childCount} sub-location{childCount === 1 ? "" : "s"}{collapsed ? " (collapsed)" : ""}</span>}
                </div>
              </div>
            );
          },
        },
        { id: "code", header: "Bin code", sortable: true, accessor: (row) => row.code ?? "", render: (row) => row.code ? <span className="row" style={{ gap: 4 }}><QrCode size={12} /> <span className="mono">{row.code}</span></span> : <span className="muted">-</span> },
        { id: "type", header: "Type", sortable: true, accessor: (row) => row.locationType ?? "", render: (row) => <Badge tone="info">{row.locationType}</Badge> },
        { id: "custodian", header: "Custodian", accessor: (row) => row.custodianName ?? "", render: (row) => row.custodianName ? <span>{row.custodianName}</span> : <span className="muted">-</span> },
        {
          id: "contents",
          header: "Contents",
          align: "right",
          accessor: (row) => rollupQty(row),
          render: (row) => {
            const rows = balancesByLocationId.get(row._id) ?? [];
            const qty = rows.reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0);
            const total = rollupQty(row);
            if (!rows.length && total === 0) return <span className="muted">empty</span>;
            return <span className="mono">{rows.length} item{rows.length === 1 ? "" : "s"} · {qty}{total !== qty ? ` (${total} incl. sub)` : ""}</span>;
          },
        },
      ]}
      renderRowActions={(row) => (
        <>
          <button className="btn btn--ghost btn--sm" onClick={() => onWhatsHere(row)}><Boxes size={12} /> What's here</button>
          {row.code && <button className="btn btn--ghost btn--sm" onClick={() => onLabel(row)} title="Show printable QR label"><QrCode size={12} /> Label</button>}
          <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)}><Pencil size={12} /> Edit</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDelete(row)}><Trash2 size={12} /></button>
        </>
      )}
    />
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
  const { itemById } = maps;
  return (
    <DataTable
      label="Lots & serials"
      icon={<Layers size={14} />}
      data={lotRows}
      rowKey={(row) => row._id}
      loading={loading}
      viewsKey="inventory-lots"
      searchPlaceholder="Search lot, serial, item, manufacturer..."
      searchExtraFields={[
        (row) => itemById.get(row.inventoryItemId)?.name,
        (row) => row.lotNumber,
        (row) => row.serialNumber,
        (row) => row.manufacturer,
      ]}
      emptyMessage="No lots or serials yet. Enable lot/serial tracking on an item, then add a lot."
      columns={[
        { id: "item", header: "Item", sortable: true, accessor: (row) => itemById.get(row.inventoryItemId)?.name ?? "", render: (row) => <div><strong>{itemById.get(row.inventoryItemId)?.name ?? "Unknown item"}</strong><div className="muted mono">{itemById.get(row.inventoryItemId)?.sku ?? ""}</div></div> },
        { id: "lot", header: "Lot #", sortable: true, accessor: (row) => row.lotNumber ?? "", render: (row) => row.lotNumber ? <span className="mono">{row.lotNumber}</span> : <span className="muted">-</span> },
        { id: "serial", header: "Serial #", sortable: true, accessor: (row) => row.serialNumber ?? "", render: (row) => row.serialNumber ? <span className="mono">{row.serialNumber}</span> : <span className="muted">-</span> },
        {
          id: "expiry",
          header: "Expires",
          sortable: true,
          accessor: (row) => row.expiresAt ?? "",
          render: (row) => {
            if (!row.expiresAt) return <span className="muted">-</span>;
            const d = daysUntil(row.expiresAt);
            const tone = d != null && d <= EXPIRY_SOON_DAYS ? "warn" : "neutral";
            return <span className="row" style={{ gap: 4 }}><span className="mono">{row.expiresAt}</span>{d != null && d <= EXPIRY_SOON_DAYS && <Badge tone={tone as any}>{d < 0 ? "expired" : `${d}d`}</Badge>}</span>;
          },
        },
        { id: "manufacturer", header: "Manufacturer", accessor: (row) => row.manufacturer ?? "", render: (row) => <span className="muted">{row.manufacturer || "-"}</span> },
        { id: "status", header: "Status", sortable: true, accessor: (row) => row.status ?? "", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
      ]}
      renderRowActions={(row) => (
        <>
          <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)}><Pencil size={12} /> Edit</button>
          <button className="btn btn--ghost btn--sm" onClick={() => onDelete(row)}><Trash2 size={12} /></button>
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
  return (
    <DataTable
      label="Physical counts"
      icon={<ClipboardList size={14} />}
      data={countRows}
      rowKey={(row) => row._id}
      loading={loading}
      viewsKey="inventory-counts"
      searchPlaceholder="Search count title, reviewer, scope..."
      searchExtraFields={[(row) => row.reviewerName, (row) => row.scope]}
      emptyMessage="No physical counts yet. Start a count to verify what's actually on the shelf."
      columns={[
        { id: "title", header: "Count", sortable: true, accessor: (row) => row.title ?? "", render: (row) => <div><strong>{row.title}</strong><div className="muted">{row.reviewerName ?? "Unassigned"}</div></div> },
        { id: "scope", header: "Scope", sortable: true, accessor: (row) => row.scope ?? "", render: (row) => <Badge tone="info">{row.scope ?? "all"}</Badge> },
        { id: "status", header: "Status", sortable: true, accessor: (row) => row.status ?? "", render: (row) => <Badge tone={row.status === "open" ? "warn" : row.status === "completed" ? "success" : "neutral"}>{row.status}</Badge> },
        { id: "lines", header: "Lines", align: "right", accessor: (row) => (row.lines ?? []).length, render: (row) => <span className="mono">{(row.lines ?? []).length}</span> },
        {
          id: "variance",
          header: "Counted / variance",
          align: "right",
          accessor: (row) => (row.lines ?? []).filter((l: any) => l.countedQuantity != null).length,
          render: (row) => {
            const lines = row.lines ?? [];
            const counted = lines.filter((l: any) => l.countedQuantity != null).length;
            const variances = lines.filter((l: any) => l.countedQuantity != null && (l.countedQuantity - (l.expectedQuantity ?? 0)) !== 0).length;
            return <span className="mono">{counted}/{lines.length}{variances ? ` · ${variances}Δ` : ""}</span>;
          },
        },
        { id: "started", header: "Started", sortable: true, accessor: (row) => row.startedAtISO ?? "", render: (row) => <span className="mono">{row.startedAtISO?.slice(0, 10)}</span> },
      ]}
      renderRowActions={(row) => (
        <>
          {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={() => onEnter(row)}><Pencil size={12} /> Enter counts</button>}
          {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={() => onVoid(row)}>Void</button>}
        </>
      )}
    />
  );
}
