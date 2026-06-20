import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Boxes, ClipboardCheck, FileText, History, Image as ImageIcon, Link2, MapPin, Package, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { ImageUploadField, type ImageValue } from "../components/ImageUploadField";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { useToast } from "../components/Toast";
import { money } from "../lib/format";

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
const ITEM_TYPES = ["asset", "consumable", "supply", "software", "service", "other"];
const LOCATION_TYPES = ["facility", "room", "shelf", "bin", "custody", "in_transit", "vendor", "virtual"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function dollarsToCents(value: string): number | undefined {
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || value.trim() === "") return undefined;
  return Math.round(n * 100);
}

function centsToDollars(value?: number | null): string {
  if (value == null) return "";
  return (value / 100).toFixed(2);
}

function emptyItemForm() {
  return {
    name: "",
    sku: "",
    category: "Program supplies",
    itemType: "supply",
    unitOfMeasure: "each",
    reorderPoint: "",
    defaultCost: "",
    description: "",
    image: {} as ImageValue,
  };
}

function emptyLocationForm() {
  return { name: "", locationType: "facility", address: "" };
}

function emptyLinkForm() {
  return {
    receiptDocumentId: "",
    financialTransactionId: "",
    receiptLineLabel: "",
    quantity: "",
    unitOfMeasure: "each",
    unitCost: "",
    totalCost: "",
    notes: "",
  };
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
  const actingUserId = useCurrentUserId() ?? undefined;
  const items = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const locations = useQuery(api.inventoryHub.locations, society ? { societyId: society._id } : "skip");
  const balances = useQuery(api.inventoryHub.balances, society ? { societyId: society._id } : "skip");
  const movements = useQuery(api.inventoryHub.stockMovements, society ? { societyId: society._id, limit: 100 } : "skip");
  const counts = useQuery(api.inventoryHub.counts, society ? { societyId: society._id, status: "open" } : "skip");
  const receiptLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const transactions = useQuery(api.financialHub.transactions, society ? { societyId: society._id, limit: 200 } : "skip");
  const postMovement = useMutation(api.inventoryHub.postStockMovement);
  const backfillAssets = useMutation(api.inventoryHub.backfillAssets);
  const reconcileCount = useMutation(api.inventoryHub.postCountVarianceAdjustments);
  const importOpenBoxes = useMutation(api.inventoryHub.importOpenBoxesSnapshot);
  const upsertItem = useMutation(api.inventoryHub.upsertItem);
  const upsertLocation = useMutation(api.inventoryHub.upsertLocation);
  const linkReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkReceipt = useMutation(api.inventoryHub.unlinkReceipt);
  const [drawer, setDrawer] = useState<"movement" | "openboxes" | "item" | "location" | "link" | null>(null);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [linkItem, setLinkItem] = useState<any>(null);
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
  const itemRows = (items ?? []) as any[];
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of (balances ?? []) as any[]) {
      map.set(row.inventoryItemId, (map.get(row.inventoryItemId) ?? 0) + (row.quantityOnHand ?? 0));
    }
    return map;
  }, [balances]);
  const balanceRows = (balances ?? []) as any[];
  const movementRows = (movements ?? []) as any[];
  const totalOnHand = balanceRows.reduce((sum, row) => sum + (row.quantityOnHand ?? 0), 0);
  const lowStock = balanceRows.filter((row) => {
    const item = itemById.get(row.inventoryItemId);
    return item?.reorderPoint != null && row.quantityAvailable <= item.reorderPoint;
  });
  const openCounts = (counts ?? []) as any[];
  const varianceLines = openCounts.flatMap((count) => (count.lines ?? []).filter((line: any) => line.countedQuantity != null && (line.countedQuantity - (line.expectedQuantity ?? 0)) !== 0).map((line: any) => ({ count, line })));

  if (society === undefined) return <PageLoading />;
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

  const openNewItem = () => {
    setEditingItemId(null);
    setItemForm(emptyItemForm());
    setDrawer("item");
  };

  const openEditItem = (item: any) => {
    setEditingItemId(item._id);
    setItemForm({
      name: item.name ?? "",
      sku: item.sku ?? "",
      category: item.category ?? "Program supplies",
      itemType: item.itemType ?? "supply",
      unitOfMeasure: item.unitOfMeasure ?? "each",
      reorderPoint: item.reorderPoint != null ? String(item.reorderPoint) : "",
      defaultCost: centsToDollars(item.defaultCostCents),
      description: item.description ?? "",
      image: { imageStorageId: item.imageStorageId, imageUrl: item.imageUrl },
    });
    setDrawer("item");
  };

  const saveItem = async () => {
    if (!itemForm.name.trim()) {
      toast.error("Item name is required.");
      return;
    }
    await upsertItem({
      id: editingItemId ? (editingItemId as any) : undefined,
      societyId: society._id,
      name: itemForm.name.trim(),
      sku: itemForm.sku.trim() || undefined,
      category: itemForm.category.trim() || "Uncategorized",
      itemType: itemForm.itemType,
      unitOfMeasure: itemForm.unitOfMeasure.trim() || "each",
      reorderPoint: itemForm.reorderPoint.trim() ? Number(itemForm.reorderPoint) : undefined,
      defaultCostCents: dollarsToCents(itemForm.defaultCost),
      description: itemForm.description.trim() || undefined,
      imageStorageId: itemForm.image.imageStorageId as any,
      imageUrl: itemForm.image.imageUrl,
      clearImage: !itemForm.image.imageStorageId && !itemForm.image.imageUrl,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success(editingItemId ? "Item updated" : "Item created");
    setDrawer(null);
  };

  const saveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast.error("Location name is required.");
      return;
    }
    await upsertLocation({
      societyId: society._id,
      name: locationForm.name.trim(),
      locationType: locationForm.locationType,
      address: locationForm.address.trim() || undefined,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success("Location created");
    setLocationForm(emptyLocationForm());
    setDrawer(null);
  };

  const openLink = (item: any) => {
    setLinkItem(item);
    setLinkForm({
      ...emptyLinkForm(),
      receiptLineLabel: item.name ?? "",
      unitOfMeasure: item.unitOfMeasure ?? "each",
      unitCost: centsToDollars(item.defaultCostCents),
    });
    setDrawer("link");
  };

  const saveLink = async () => {
    if (!linkItem) return;
    if (!linkForm.receiptDocumentId && !linkForm.financialTransactionId) {
      toast.error("Choose a purchase transaction or a receipt document to link.");
      return;
    }
    await linkReceipt({
      societyId: society._id,
      inventoryItemId: linkItem._id,
      assetId: linkItem.assetId,
      receiptDocumentId: linkForm.receiptDocumentId ? (linkForm.receiptDocumentId as any) : undefined,
      financialTransactionId: linkForm.financialTransactionId ? (linkForm.financialTransactionId as any) : undefined,
      receiptLineLabel: linkForm.receiptLineLabel || undefined,
      quantity: linkForm.quantity ? Number(linkForm.quantity) : undefined,
      unitOfMeasure: linkForm.unitOfMeasure || undefined,
      unitCostCents: dollarsToCents(linkForm.unitCost),
      totalCostCents: dollarsToCents(linkForm.totalCost),
      notes: linkForm.notes || undefined,
      createdByUserId: actingUserId as any,
    } as any);
    toast.success("Purchase linked to item");
    setDrawer(null);
    setLinkItem(null);
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
            <button className="btn-action" onClick={() => setDrawer("location")}><MapPin size={12} /> New location</button>
            <button className="btn-action" onClick={() => setDrawer("movement")}><Plus size={12} /> New movement</button>
            <button className="btn-action btn-action--primary" onClick={openNewItem}><Plus size={12} /> New item</button>
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
        label="Item catalog"
        icon={<Package size={14} />}
        data={itemRows}
        rowKey={(row) => row._id}
        loading={items === undefined}
        viewsKey="inventory-items"
        searchPlaceholder="Search item, SKU, category..."
        searchExtraFields={[(row) => row.sku, (row) => row.category, (row) => row.itemType]}
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
                  <strong>{row.name}</strong>
                  <div className="muted mono">{row.sku ?? "No SKU"}</div>
                </div>
              </div>
            ),
          },
          { id: "category", header: "Category", sortable: true, accessor: (row) => row.category ?? "", render: (row) => <div><span>{row.category}</span><div className="muted">{row.itemType}</div></div> },
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
            <button className="btn btn--ghost btn--sm" onClick={() => openLink(row)}><Link2 size={12} /> Link purchase</button>
            <button className="btn btn--ghost btn--sm" onClick={() => openEditItem(row)}><Pencil size={12} /> Edit</button>
            {row.assetId && <Link className="btn btn--ghost btn--sm" to={`/app/assets/${row.assetId}`}>Asset</Link>}
          </>
        )}
      />

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

      <Drawer
        open={drawer === "item"}
        onClose={() => setDrawer(null)}
        title={editingItemId ? "Edit item" : "New item"}
        size="wide"
        footer={<button className="btn-action btn-action--primary" onClick={saveItem}>{editingItemId ? "Save item" : "Create item"}</button>}
      >
        <ImageUploadField
          label="Item photo"
          hint="Upload a picture of the item, or paste an image URL."
          value={itemForm.image}
          onChange={(image) => setItemForm({ ...itemForm, image })}
        />
        <div className="form-grid">
          <Field label="Name" required>
            <input className="input" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
          </Field>
          <Field label="SKU">
            <input className="input" value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} />
          </Field>
          <Field label="Category">
            <input className="input" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
          </Field>
          <Field label="Item type">
            <select className="input" value={itemForm.itemType} onChange={(e) => setItemForm({ ...itemForm, itemType: e.target.value })}>
              {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="Unit of measure">
            <input className="input" value={itemForm.unitOfMeasure} onChange={(e) => setItemForm({ ...itemForm, unitOfMeasure: e.target.value })} />
          </Field>
          <Field label="Reorder point">
            <input className="input" inputMode="decimal" value={itemForm.reorderPoint} onChange={(e) => setItemForm({ ...itemForm, reorderPoint: e.target.value })} />
          </Field>
          <Field label="Default unit cost">
            <input className="input" inputMode="decimal" value={itemForm.defaultCost} onChange={(e) => setItemForm({ ...itemForm, defaultCost: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className="input" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "location"}
        onClose={() => setDrawer(null)}
        title="New location"
        footer={<button className="btn-action btn-action--primary" onClick={saveLocation}>Create location</button>}
      >
        <div className="form-grid">
          <Field label="Name" required>
            <input className="input" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="input" value={locationForm.locationType} onChange={(e) => setLocationForm({ ...locationForm, locationType: e.target.value })}>
              {LOCATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="Address / notes">
            <input className="input" value={locationForm.address} onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "link"}
        onClose={() => setDrawer(null)}
        title={linkItem ? `Link purchase: ${linkItem.name}` : "Link purchase"}
        size="wide"
        footer={<button className="btn-action btn-action--primary" onClick={saveLink}>Link purchase</button>}
      >
        {linkItem && (
          <>
            {(receiptLinksByItemId.get(linkItem._id) ?? []).length > 0 && (
              <div className="stack stack--xs" style={{ marginBottom: 12 }}>
                <div className="muted">Existing links</div>
                {(receiptLinksByItemId.get(linkItem._id) ?? []).map((link: any) => (
                  <div key={link._id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <span className="row" style={{ gap: 6 }}>
                      <FileText size={12} />
                      {link.receiptDocument?.title ?? link.receiptLineLabel ?? "Linked purchase"}
                      {link.financialTransactionId && <Badge tone="info">transaction</Badge>}
                    </span>
                    <button className="btn btn--ghost btn--sm btn--icon" aria-label="Remove link" onClick={async () => { await unlinkReceipt({ id: link._id }); toast.success("Link removed"); }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="form-grid">
              <Field label="Purchase transaction" hint="Pick the financial transaction this item was bought on.">
                <select className="input" value={linkForm.financialTransactionId} onChange={(e) => setLinkForm({ ...linkForm, financialTransactionId: e.target.value })}>
                  <option value="">No transaction</option>
                  {((transactions ?? []) as any[]).filter((t) => t.amountCents < 0).map((t) => (
                    <option key={t._id} value={t._id}>{t.date} · {t.description} · {money(Math.abs(t.amountCents))}</option>
                  ))}
                </select>
              </Field>
              <Field label="Receipt document">
                <select className="input" value={linkForm.receiptDocumentId} onChange={(e) => setLinkForm({ ...linkForm, receiptDocumentId: e.target.value })}>
                  <option value="">No receipt document</option>
                  {((documents ?? []) as any[]).filter((d) => d.category === "Receipt" || d.category === "FinancialStatement" || (d.tags ?? []).some((tag: string) => /receipt|invoice|finance/i.test(tag))).map((d) => (
                    <option key={d._id} value={d._id}>{d.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Receipt line label">
                <input className="input" value={linkForm.receiptLineLabel} onChange={(e) => setLinkForm({ ...linkForm, receiptLineLabel: e.target.value })} />
              </Field>
              <Field label="Quantity">
                <input className="input" inputMode="decimal" value={linkForm.quantity} onChange={(e) => setLinkForm({ ...linkForm, quantity: e.target.value })} />
              </Field>
              <Field label="Unit cost">
                <input className="input" inputMode="decimal" value={linkForm.unitCost} onChange={(e) => setLinkForm({ ...linkForm, unitCost: e.target.value })} />
              </Field>
              <Field label="Total cost">
                <input className="input" inputMode="decimal" value={linkForm.totalCost} onChange={(e) => setLinkForm({ ...linkForm, totalCost: e.target.value })} />
              </Field>
              <Field label="Notes">
                <textarea className="input" value={linkForm.notes} onChange={(e) => setLinkForm({ ...linkForm, notes: e.target.value })} />
              </Field>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}

function ItemThumb({ item }: { item: any }) {
  if (!item.imageUrl) {
    return (
      <span style={{ width: 36, height: 36, flex: "0 0 auto", borderRadius: 6, background: "var(--surface-muted, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted, #8a8f98)" }}>
        <ImageIcon size={14} />
      </span>
    );
  }
  return <img src={item.imageUrl} alt="" style={{ width: 36, height: 36, flex: "0 0 auto", borderRadius: 6, objectFit: "cover", border: "1px solid var(--border, #d8dadf)" }} />;
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
