import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft, Boxes, History } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { PageHeader, SeedPrompt } from "./_helpers";

function formatQuantity(value?: number | null, unit?: string | null) {
  if (value == null) return "-";
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)} ${unit ?? "each"}`;
}

function movementTone(type: string) {
  if (["receive", "return"].includes(type)) return "success";
  if (["issue", "consume", "dispose"].includes(type)) return "warn";
  if (["transfer", "count"].includes(type)) return "info";
  return "neutral";
}

export function InventoryPage() {
  const society = useSociety();
  const items = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const locations = useQuery(api.inventoryHub.locations, society ? { societyId: society._id } : "skip");
  const balances = useQuery(api.inventoryHub.balances, society ? { societyId: society._id } : "skip");
  const movements = useQuery(api.inventoryHub.stockMovements, society ? { societyId: society._id, limit: 100 } : "skip");

  const itemById = useMemo(() => new Map(((items ?? []) as any[]).map((row) => [row._id, row])), [items]);
  const locationById = useMemo(() => new Map(((locations ?? []) as any[]).map((row) => [row._id, row])), [locations]);
  const balanceRows = (balances ?? []) as any[];
  const movementRows = (movements ?? []) as any[];
  const totalOnHand = balanceRows.reduce((sum, row) => sum + (row.quantityOnHand ?? 0), 0);
  const lowStock = balanceRows.filter((row) => {
    const item = itemById.get(row.inventoryItemId);
    return item?.reorderPoint != null && row.quantityAvailable <= item.reorderPoint;
  });

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Stock ledger, item balances, locations, and OpenBoxes-compatible movement history for supplies and consumables."
        routeKey="/app/inventory"
        actions={<Link className="btn-action" to="/app/assets"><ArrowLeft size={12} /> Assets</Link>}
      />

      <div className="stat-grid">
        <Stat label="Items" value={(items ?? []).length} sub="catalog records" />
        <Stat label="Locations" value={(locations ?? []).length} sub="facilities, rooms, bins" />
        <Stat label="On hand" value={formatQuantity(totalOnHand, "")} sub="summed stock balance" />
        <Stat label="Low stock" value={lowStock.length} sub="at or below reorder point" tone={lowStock.length ? "warn" : undefined} />
      </div>

      <DataTable
        label="Current stock"
        icon={<Boxes size={14} />}
        data={balanceRows}
        rowKey={(row) => row._id}
        loading={balances === undefined || items === undefined || locations === undefined}
        viewsKey="inventory-balances"
        searchPlaceholder="Search item, SKU, location..."
        searchExtraFields={[
          (row) => itemById.get(row.inventoryItemId)?.name,
          (row) => itemById.get(row.inventoryItemId)?.sku,
          (row) => locationById.get(row.locationId)?.name,
        ]}
        emptyMessage="No inventory balances yet. Add consumable stock from Assets to create the first stock movement."
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
                  <div className="muted">{location?.locationType ?? "location"}</div>
                </div>
              );
            },
          },
          {
            id: "onHand",
            header: "On hand",
            sortable: true,
            align: "right",
            accessor: (row) => row.quantityOnHand ?? 0,
            render: (row) => <span className="mono">{formatQuantity(row.quantityOnHand, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span>,
          },
          {
            id: "available",
            header: "Available",
            sortable: true,
            align: "right",
            accessor: (row) => row.quantityAvailable ?? 0,
            render: (row) => <span className="mono">{formatQuantity(row.quantityAvailable, itemById.get(row.inventoryItemId)?.unitOfMeasure)}</span>,
          },
          { id: "lastCounted", header: "Last counted", sortable: true, accessor: (row) => row.lastCountedAtISO ?? "", render: (row) => row.lastCountedAtISO?.slice(0, 10) ?? <span className="muted">-</span> },
        ]}
      />

      <DataTable
        label="Stock movements"
        icon={<History size={14} />}
        data={movementRows}
        rowKey={(row) => row._id}
        loading={movements === undefined || items === undefined || locations === undefined}
        viewsKey="stock-movements"
        searchPlaceholder="Search movement, item, reference, reason..."
        searchExtraFields={[
          (row) => itemById.get(row.inventoryItemId)?.name,
          (row) => row.reference,
          (row) => row.reason,
          (row) => row.sourceSystem,
        ]}
        emptyMessage="No stock movements yet."
        columns={[
          { id: "date", header: "Date", sortable: true, accessor: (row) => row.movementDate, render: (row) => <span className="mono">{row.movementDate}</span> },
          {
            id: "type",
            header: "Type",
            sortable: true,
            accessor: (row) => row.movementType,
            render: (row) => <Badge tone={movementTone(row.movementType) as any}>{row.movementType}</Badge>,
          },
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
          { id: "source", header: "Source", sortable: true, accessor: (row) => row.sourceSystem ?? "", render: (row) => <span className="muted">{row.sourceSystem ?? "manual"}</span> },
        ]}
      />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: any; sub: string; tone?: "warn" | "info" }) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      <div className={tone ? `stat-card__sub stat-card__sub--${tone}` : "stat-card__sub"}>{sub}</div>
    </div>
  );
}
