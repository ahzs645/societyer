import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Boxes, ClipboardCheck, FileText, History, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { PageHeader, SeedPrompt } from "./_helpers";
import { useToast } from "../components/Toast";

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

const MOVEMENT_TYPES = ["receive", "consume", "transfer", "adjustment", "count"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function emptyMovementForm() {
  return {
    movementType: "receive",
    movementDate: todayDate(),
    inventoryItemId: "",
    fromLocationId: "",
    toLocationId: "",
    quantity: "",
    reason: "",
    reference: "",
  };
}

export function InventoryPage() {
  const society = useSociety();
  const toast = useToast();
  const items = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const locations = useQuery(api.inventoryHub.locations, society ? { societyId: society._id } : "skip");
  const balances = useQuery(api.inventoryHub.balances, society ? { societyId: society._id } : "skip");
  const movements = useQuery(api.inventoryHub.stockMovements, society ? { societyId: society._id, limit: 100 } : "skip");
  const counts = useQuery(api.inventoryHub.counts, society ? { societyId: society._id, status: "open" } : "skip");
  const receiptLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const postMovement = useMutation(api.inventoryHub.postStockMovement);
  const backfillAssets = useMutation(api.inventoryHub.backfillAssets);
  const reconcileCount = useMutation(api.inventoryHub.postCountVarianceAdjustments);
  const importOpenBoxes = useMutation(api.inventoryHub.importOpenBoxesSnapshot);
  const [drawer, setDrawer] = useState<"movement" | "openboxes" | null>(null);
  const [movementForm, setMovementForm] = useState(emptyMovementForm);
  const [openBoxesJson, setOpenBoxesJson] = useState(JSON.stringify({
    products: [
      { id: "demo-product-bandages", productCode: "MED-001", name: "First aid bandages", category: "Program supplies", unitOfMeasure: "boxes" },
    ],
    locations: [
      { id: "demo-location-supply-cabinet", name: "Supply cabinet", locationType: "bin" },
    ],
    movements: [
      { id: "demo-movement-bandages-receive", date: todayDate(), type: "receive", productId: "demo-product-bandages", destinationLocationId: "demo-location-supply-cabinet", quantity: 4, unitOfMeasure: "boxes", reason: "OpenBoxes demo import" },
    ],
  }, null, 2));

  const itemById = useMemo(() => new Map(((items ?? []) as any[]).map((row) => [row._id, row])), [items]);
  const locationById = useMemo(() => new Map(((locations ?? []) as any[]).map((row) => [row._id, row])), [locations]);
  const receiptLinksByItemId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const link of (receiptLinks ?? []) as any[]) {
      if (!link.inventoryItemId) continue;
      const rows = map.get(link.inventoryItemId) ?? [];
      rows.push(link);
      map.set(link.inventoryItemId, rows);
    }
    return map;
  }, [receiptLinks]);
  const balanceRows = (balances ?? []) as any[];
  const movementRows = (movements ?? []) as any[];
  const totalOnHand = balanceRows.reduce((sum, row) => sum + (row.quantityOnHand ?? 0), 0);
  const lowStock = balanceRows.filter((row) => {
    const item = itemById.get(row.inventoryItemId);
    return item?.reorderPoint != null && row.quantityAvailable <= item.reorderPoint;
  });
  const openCounts = (counts ?? []) as any[];
  const varianceLines = openCounts.flatMap((count) => (count.lines ?? []).filter((line: any) => line.countedQuantity != null && (line.countedQuantity - (line.expectedQuantity ?? 0)) !== 0).map((line: any) => ({ count, line })));

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const saveMovement = async () => {
    const item = itemById.get(movementForm.inventoryItemId);
    const quantity = Number(movementForm.quantity);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Select an item and enter a positive quantity.");
      return;
    }
    const movementType = movementForm.movementType;
    const needsFrom = ["consume", "transfer", "adjustment"].includes(movementType);
    const needsTo = ["receive", "transfer", "adjustment", "count"].includes(movementType);
    const fromLocationId = needsFrom ? movementForm.fromLocationId || undefined : undefined;
    const toLocationId = needsTo ? movementForm.toLocationId || undefined : undefined;
    if (movementType === "transfer" && (!fromLocationId || !toLocationId)) {
      toast.error("Transfers need both source and destination locations.");
      return;
    }
    if ((movementType === "consume" && !fromLocationId) || (movementType === "receive" && !toLocationId)) {
      toast.error("Select the required location for this movement.");
      return;
    }
    await postMovement({
      societyId: society._id,
      movementDate: movementForm.movementDate || todayDate(),
      movementType,
      inventoryItemId: item._id,
      fromLocationId: fromLocationId as any,
      toLocationId: toLocationId as any,
      quantity,
      unitOfMeasure: item.unitOfMeasure ?? "each",
      reason: movementForm.reason || undefined,
      reference: movementForm.reference || undefined,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success("Stock movement posted");
    setMovementForm(emptyMovementForm());
    setDrawer(null);
  };

  const runBackfill = async () => {
    const result = await backfillAssets({ societyId: society._id });
    toast.success(`Backfill complete: ${result.movementsCreated ?? 0} movement${result.movementsCreated === 1 ? "" : "s"} created`);
  };

  const runOpenBoxesImport = async () => {
    try {
      const parsed = JSON.parse(openBoxesJson);
      const result = await importOpenBoxes({ societyId: society._id, ...parsed });
      toast.success(`OpenBoxes import: ${result.itemsUpserted ?? 0} items, ${result.movementsPosted ?? 0} movements`);
      setDrawer(null);
    } catch (error: any) {
      toast.error(error?.message ?? "OpenBoxes import failed.");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Societyer-controlled supplies, consumables, grant-funded equipment, audit evidence, and OpenBoxes-compatible movement history."
        routeKey="/app/inventory"
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn-action" onClick={runBackfill}><RefreshCw size={12} /> Backfill assets</button>
            <button className="btn-action" onClick={() => setDrawer("openboxes")}><Boxes size={12} /> OpenBoxes import</button>
            <button className="btn-action btn-action--primary" onClick={() => setDrawer("movement")}><Plus size={12} /> New movement</button>
            <Link className="btn-action" to="/app/assets"><ArrowLeft size={12} /> Assets</Link>
          </div>
        }
      />

      <div className="stat-grid">
        <Stat label="Tracked records" value={(items ?? []).length} sub="assets, supplies, consumables" />
        <Stat label="Custody points" value={(locations ?? []).length} sub="rooms, bins, people, off-site" />
        <Stat label="On hand" value={formatQuantity(totalOnHand, "")} sub="posted balance total" />
        <Stat label="Count variances" value={varianceLines.length} sub="ready for adjustment" tone={varianceLines.length ? "warn" : undefined} />
      </div>

      {varianceLines.length > 0 && (
        <div className="callout callout--warn">
          <ClipboardCheck size={16} />
          <div>
            <strong>{varianceLines.length} physical count variance{varianceLines.length === 1 ? "" : "s"} need reconciliation</strong>
            <div className="muted">Posting adjustments will create stock movements and close the matching count run.</div>
          </div>
          <button
            className="btn btn--sm"
            onClick={async () => {
              for (const { count } of varianceLines) await reconcileCount({ inventoryCountId: count._id, reason: "Physical inventory reconciliation" });
              toast.success("Count variance adjustments posted");
            }}
          >
            Post adjustments
          </button>
        </div>
      )}

      <DataTable
        label="Societyer stock balances"
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
          (row) => receiptLinksByItemId.get(row.inventoryItemId)?.map((link) => link.receiptDocument?.title).join(" "),
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
        loading={movements === undefined || items === undefined || locations === undefined}
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

      <Drawer
        open={drawer === "movement"}
        onClose={() => setDrawer(null)}
        title="Post stock movement"
        footer={<button className="btn-action btn-action--primary" onClick={saveMovement}>Post movement</button>}
      >
        <div className="form-grid">
          <Field label="Movement type">
            <select className="input" value={movementForm.movementType} onChange={(e) => setMovementForm({ ...movementForm, movementType: e.target.value })}>
              {MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={movementForm.movementDate} onChange={(e) => setMovementForm({ ...movementForm, movementDate: e.target.value })} />
          </Field>
          <Field label="Item">
            <select className="input" value={movementForm.inventoryItemId} onChange={(e) => {
              const item = itemById.get(e.target.value);
              setMovementForm({ ...movementForm, inventoryItemId: e.target.value, reference: item?.sku ?? movementForm.reference });
            }}>
              <option value="">Select item</option>
              {((items ?? []) as any[]).map((item) => <option key={item._id} value={item._id}>{item.name} {item.sku ? `(${item.sku})` : ""}</option>)}
            </select>
          </Field>
          <Field label="Quantity">
            <input className="input" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} />
          </Field>
          <Field label="From location">
            <select className="input" value={movementForm.fromLocationId} onChange={(e) => setMovementForm({ ...movementForm, fromLocationId: e.target.value })}>
              <option value="">External / not applicable</option>
              {((locations ?? []) as any[]).map((location) => <option key={location._id} value={location._id}>{location.name}</option>)}
            </select>
          </Field>
          <Field label="To location">
            <select className="input" value={movementForm.toLocationId} onChange={(e) => setMovementForm({ ...movementForm, toLocationId: e.target.value })}>
              <option value="">External / not applicable</option>
              {((locations ?? []) as any[]).map((location) => <option key={location._id} value={location._id}>{location.name}</option>)}
            </select>
          </Field>
          <Field label="Reference">
            <input className="input" value={movementForm.reference} onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })} />
          </Field>
          <Field label="Reason">
            <textarea className="input" value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "openboxes"}
        onClose={() => setDrawer(null)}
        title="Import OpenBoxes snapshot"
        size="wide"
        footer={<button className="btn-action btn-action--primary" onClick={runOpenBoxesImport}>Import snapshot</button>}
      >
        <Field label="Normalized OpenBoxes JSON">
          <textarea
            className="input mono"
            style={{ minHeight: 360 }}
            value={openBoxesJson}
            onChange={(e) => setOpenBoxesJson(e.target.value)}
          />
        </Field>
      </Drawer>
    </div>
  );
}

function receiptLinksForMovement(row: any, linksByItemId: Map<string, any[]>) {
  const links = linksByItemId.get(row.inventoryItemId) ?? [];
  if (!row.receiptDocumentId) return links;
  const direct = links.filter((link) => link.receiptDocumentId === row.receiptDocumentId);
  return direct.length ? direct : links;
}

function ReceiptEvidence({ links, receiptDocumentId }: { links: any[]; receiptDocumentId?: string }) {
  if (links.length === 0) {
    return receiptDocumentId ? <span className="mono">{receiptDocumentId}</span> : <span className="muted">-</span>;
  }
  return (
    <div className="stack stack--xs">
      {links.slice(0, 2).map((link) => (
        <div key={link._id} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <FileText size={12} />
          {link.receiptDocument ? (
            <Link to={`/app/documents/${link.receiptDocument._id}`}>{link.receiptDocument.title}</Link>
          ) : (
            <span className="mono">{link.receiptDocumentId}</span>
          )}
          {link.receiptLineLabel && <span className="muted">· {link.receiptLineLabel}</span>}
        </div>
      ))}
      {links.length > 2 && <div className="muted">+{links.length - 2} more</div>}
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
