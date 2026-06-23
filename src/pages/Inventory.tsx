import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  History,
  Image as ImageIcon,
  Layers,
  Link2,
  MapPin,
  Package,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Tag,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { ImageUploadField, type ImageValue } from "../components/ImageUploadField";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
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

// "count" is intentionally excluded — counting is done through the physical-count
// flow, which posts proper "adjustment" deltas. A manual "count" movement would
// add its quantity on top of the existing balance (double counting).
const MOVEMENT_TYPES = ["receive", "consume", "transfer", "adjustment"];
const ITEM_TYPES = ["asset", "consumable", "supply", "software", "service", "other"];
const LOCATION_TYPES = ["facility", "room", "shelf", "bin", "custody", "in_transit", "vendor", "virtual"];
const LOT_STATUSES = ["active", "depleted", "expired", "disposed", "needs_review"];
const EXPIRY_SOON_DAYS = 60;

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
    trackSerial: false,
    trackLot: false,
    trackExpiry: false,
    image: {} as ImageValue,
  };
}

function emptyLocationForm() {
  return { name: "", code: "", locationType: "facility", parentLocationId: "", address: "", notes: "", active: true };
}

function emptyLotForm() {
  return {
    inventoryItemId: "",
    lotNumber: "",
    serialNumber: "",
    expiresAt: "",
    manufacturer: "",
    manufacturedAt: "",
    condition: "",
    status: "active",
  };
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
    inventoryLotId: "",
    fromLocationId: "",
    toLocationId: "",
    quantity: "",
    reason: "",
    reference: "",
  };
}

function emptyCountForm() {
  return { title: "", scopeType: "all", locationId: "", itemType: "", reviewerName: "", notes: "" };
}

function daysUntil(iso?: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

type TabKey = "stock" | "locations" | "lots" | "counts";

export function InventoryPage() {
  const society = useSociety();
  const toast = useToast();
  const confirm = useConfirm();
  const actingUserId = useCurrentUserId() ?? undefined;
  const items = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const locations = useQuery(api.inventoryHub.locations, society ? { societyId: society._id } : "skip");
  const balances = useQuery(api.inventoryHub.balances, society ? { societyId: society._id } : "skip");
  const movements = useQuery(api.inventoryHub.stockMovements, society ? { societyId: society._id, limit: 100 } : "skip");
  const lots = useQuery(api.inventoryHub.lots, society ? { societyId: society._id } : "skip");
  const counts = useQuery(api.inventoryHub.counts, society ? { societyId: society._id } : "skip");
  const receiptLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const transactions = useQuery(api.financialHub.transactions, society ? { societyId: society._id, limit: 200 } : "skip");
  const postMovement = useMutation(api.inventoryHub.postStockMovement);
  const backfillAssets = useMutation(api.inventoryHub.backfillAssets);
  const reconcileCount = useMutation(api.inventoryHub.postCountVarianceAdjustments);
  const importOpenBoxes = useMutation(api.inventoryHub.importOpenBoxesSnapshot);
  const upsertItem = useMutation(api.inventoryHub.upsertItem);
  const deleteItem = useMutation(api.inventoryHub.deleteItem);
  const upsertLocation = useMutation(api.inventoryHub.upsertLocation);
  const deleteLocation = useMutation(api.inventoryHub.deleteLocation);
  const upsertLot = useMutation(api.inventoryHub.upsertLot);
  const deleteLot = useMutation(api.inventoryHub.deleteLot);
  const createCount = useMutation(api.inventoryHub.createCount);
  const setCountLine = useMutation(api.inventoryHub.setCountLine);
  const voidCount = useMutation(api.inventoryHub.voidCount);
  const linkReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkReceipt = useMutation(api.inventoryHub.unlinkReceipt);

  const [tab, setTab] = useState<TabKey>("stock");
  const [drawer, setDrawer] = useState<
    "movement" | "openboxes" | "item" | "location" | "link" | "lot" | "count-start" | "count-entry" | "location-detail" | null
  >(null);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [lotForm, setLotForm] = useState(emptyLotForm);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [linkItem, setLinkItem] = useState<any>(null);
  const [movementForm, setMovementForm] = useState(emptyMovementForm);
  const [countForm, setCountForm] = useState(emptyCountForm);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
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
  const lotsByItemId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const lot of (lots ?? []) as any[]) {
      const rows = map.get(lot.inventoryItemId) ?? [];
      rows.push(lot);
      map.set(lot.inventoryItemId, rows);
    }
    return map;
  }, [lots]);
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
  const balanceRows = (balances ?? []) as any[];
  const movementRows = (movements ?? []) as any[];
  const lotRows = (lots ?? []) as any[];
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balanceRows) {
      map.set(row.inventoryItemId, (map.get(row.inventoryItemId) ?? 0) + (row.quantityOnHand ?? 0));
    }
    return map;
  }, [balanceRows]);
  const balancesByLocationId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of balanceRows) {
      const rows = map.get(row.locationId) ?? [];
      rows.push(row);
      map.set(row.locationId, rows);
    }
    return map;
  }, [balanceRows]);
  const totalOnHand = balanceRows.reduce((sum, row) => sum + (row.quantityOnHand ?? 0), 0);
  const lowStock = useMemo(
    () =>
      itemRows
        .map((item) => ({ item, onHand: onHandByItemId.get(item._id) ?? 0 }))
        .filter(({ item, onHand }) => item.reorderPoint != null && onHand <= item.reorderPoint),
    [itemRows, onHandByItemId],
  );
  const expiringLots = useMemo(
    () =>
      lotRows
        .map((lot) => ({ lot, days: daysUntil(lot.expiresAt) }))
        .filter(({ lot, days }) => lot.status !== "disposed" && lot.status !== "depleted" && days != null && days <= EXPIRY_SOON_DAYS),
    [lotRows],
  );
  const countRows = ((counts ?? []) as any[]);
  const openCounts = countRows.filter((c) => c.status === "open");
  const varianceLines = openCounts.flatMap((count) =>
    (count.lines ?? [])
      .filter((line: any) => line.countedQuantity != null && (line.countedQuantity - (line.expectedQuantity ?? 0)) !== 0)
      .map((line: any) => ({ count, line })),
  );
  const activeCount = countRows.find((c) => c._id === activeCountId) ?? null;
  const detailLocation = detailLocationId ? locationById.get(detailLocationId) : null;

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
    const needsFrom = ["consume", "transfer"].includes(movementType);
    const needsTo = ["receive", "transfer"].includes(movementType);
    const fromLocationId = ["consume", "transfer", "adjustment"].includes(movementType) ? movementForm.fromLocationId || undefined : undefined;
    const toLocationId = ["receive", "transfer", "adjustment"].includes(movementType) ? movementForm.toLocationId || undefined : undefined;
    if (movementType === "transfer" && (!fromLocationId || !toLocationId)) {
      toast.error("Transfers need both source and destination locations.");
      return;
    }
    if (needsFrom && !fromLocationId) {
      toast.error("Select the source location for this movement.");
      return;
    }
    if (needsTo && !toLocationId) {
      toast.error("Select the destination location for this movement.");
      return;
    }
    if (movementType === "adjustment" && !fromLocationId && !toLocationId) {
      toast.error("Adjustments need a location to add to or remove from.");
      return;
    }
    await postMovement({
      societyId: society._id,
      movementDate: movementForm.movementDate || todayDate(),
      movementType,
      inventoryItemId: item._id,
      inventoryLotId: movementForm.inventoryLotId ? (movementForm.inventoryLotId as any) : undefined,
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
      trackSerial: Boolean(item.trackSerial),
      trackLot: Boolean(item.trackLot),
      trackExpiry: Boolean(item.trackExpiry),
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
      trackSerial: itemForm.trackSerial,
      trackLot: itemForm.trackLot,
      trackExpiry: itemForm.trackExpiry,
      imageStorageId: itemForm.image.imageStorageId as any,
      imageUrl: itemForm.image.imageUrl,
      clearImage: !itemForm.image.imageStorageId && !itemForm.image.imageUrl,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success(editingItemId ? "Item updated" : "Item created");
    setDrawer(null);
  };

  const removeItem = async (item: any) => {
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      message: "Items with stock movement history can't be deleted — archive them instead. This only removes items that were never used.",
      confirmLabel: "Delete item",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteItem({ id: item._id });
      toast.success("Item deleted");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not delete item");
    }
  };

  const archiveItem = async (item: any) => {
    await upsertItem({
      id: item._id,
      societyId: society._id,
      name: item.name,
      category: item.category,
      itemType: item.itemType,
      unitOfMeasure: item.unitOfMeasure ?? "each",
      status: item.status === "archived" ? "active" : "archived",
    } as any);
    toast.success(item.status === "archived" ? "Item restored" : "Item archived");
  };

  const openNewLocation = () => {
    setEditingLocationId(null);
    setLocationForm(emptyLocationForm());
    setDrawer("location");
  };

  const openEditLocation = (location: any) => {
    setEditingLocationId(location._id);
    setLocationForm({
      name: location.name ?? "",
      code: location.code ?? "",
      locationType: location.locationType ?? "facility",
      parentLocationId: location.parentLocationId ?? "",
      address: location.address ?? "",
      notes: location.notes ?? "",
      active: location.active ?? true,
    });
    setDrawer("location");
  };

  const saveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast.error("Location name is required.");
      return;
    }
    await upsertLocation({
      id: editingLocationId ? (editingLocationId as any) : undefined,
      societyId: society._id,
      name: locationForm.name.trim(),
      code: locationForm.code.trim() || undefined,
      locationType: locationForm.locationType,
      parentLocationId: locationForm.parentLocationId ? (locationForm.parentLocationId as any) : undefined,
      address: locationForm.address.trim() || undefined,
      notes: locationForm.notes.trim() || undefined,
      active: locationForm.active,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success(editingLocationId ? "Location updated" : "Location created");
    setLocationForm(emptyLocationForm());
    setEditingLocationId(null);
    setDrawer(null);
  };

  const removeLocation = async (location: any) => {
    const ok = await confirm({
      title: `Delete ${location.name}?`,
      message: "A location can only be deleted once it holds no stock and has no nested locations.",
      confirmLabel: "Delete location",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteLocation({ id: location._id });
      toast.success("Location deleted");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not delete location");
    }
  };

  const openNewLot = (presetItemId?: string) => {
    setEditingLotId(null);
    setLotForm({ ...emptyLotForm(), inventoryItemId: presetItemId ?? "" });
    setDrawer("lot");
  };

  const openEditLot = (lot: any) => {
    setEditingLotId(lot._id);
    setLotForm({
      inventoryItemId: lot.inventoryItemId ?? "",
      lotNumber: lot.lotNumber ?? "",
      serialNumber: lot.serialNumber ?? "",
      expiresAt: lot.expiresAt ?? "",
      manufacturer: lot.manufacturer ?? "",
      manufacturedAt: lot.manufacturedAt ?? "",
      condition: lot.condition ?? "",
      status: lot.status ?? "active",
    });
    setDrawer("lot");
  };

  const saveLot = async () => {
    if (!lotForm.inventoryItemId) {
      toast.error("Pick the item this lot or serial belongs to.");
      return;
    }
    if (!lotForm.lotNumber.trim() && !lotForm.serialNumber.trim()) {
      toast.error("Enter a lot number or a serial number.");
      return;
    }
    await upsertLot({
      id: editingLotId ? (editingLotId as any) : undefined,
      societyId: society._id,
      inventoryItemId: lotForm.inventoryItemId as any,
      lotNumber: lotForm.lotNumber.trim() || undefined,
      serialNumber: lotForm.serialNumber.trim() || undefined,
      expiresAt: lotForm.expiresAt || undefined,
      manufacturer: lotForm.manufacturer.trim() || undefined,
      manufacturedAt: lotForm.manufacturedAt || undefined,
      condition: lotForm.condition.trim() || undefined,
      status: lotForm.status,
      sourceSystem: "societyer_manual",
    } as any);
    toast.success(editingLotId ? "Lot updated" : "Lot created");
    setDrawer(null);
  };

  const removeLot = async (lot: any) => {
    const ok = await confirm({
      title: "Delete this lot/serial?",
      message: "Lots referenced by stock movements can't be deleted.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteLot({ id: lot._id });
      toast.success("Lot deleted");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not delete lot");
    }
  };

  const openPlaceStock = (item: any) => {
    setMovementForm({ ...emptyMovementForm(), inventoryItemId: item._id, reference: item.sku ?? "" });
    setDrawer("movement");
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

  const startCount = async () => {
    if (!countForm.title.trim()) {
      toast.error("Give this count a title.");
      return;
    }
    const result = await createCount({
      societyId: society._id,
      title: countForm.title.trim(),
      locationId: countForm.scopeType === "location" && countForm.locationId ? (countForm.locationId as any) : undefined,
      itemType: countForm.scopeType === "itemType" && countForm.itemType ? countForm.itemType : undefined,
      reviewerName: countForm.reviewerName.trim() || undefined,
      notes: countForm.notes.trim() || undefined,
    } as any);
    toast.success(`Count started with ${result?.lines ?? 0} line${result?.lines === 1 ? "" : "s"}`);
    setCountForm(emptyCountForm());
    setActiveCountId(result?.countId ?? null);
    setDrawer(result?.countId ? "count-entry" : null);
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

  const movementItem = itemById.get(movementForm.inventoryItemId);
  const movementItemLots = movementItem ? (lotsByItemId.get(movementItem._id) ?? []) : [];

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Societyer-controlled supplies, consumables, grant-funded equipment, bins and locations, audit evidence, and OpenBoxes-compatible movement history."
        routeKey="/app/inventory"
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn-action" onClick={runBackfill}><RefreshCw size={12} /> Backfill assets</button>
            <button className="btn-action" onClick={() => setDrawer("openboxes")}><Boxes size={12} /> OpenBoxes import</button>
            <button className="btn-action" onClick={() => { setMovementForm(emptyMovementForm()); setDrawer("movement"); }}><Plus size={12} /> New movement</button>
            <button className="btn-action btn-action--primary" onClick={openNewItem}><Plus size={12} /> New item</button>
            <Link className="btn-action" to="/app/assets"><ArrowLeft size={12} /> Assets</Link>
          </div>
        }
      />

      <div className="stat-grid">
        <Stat label="Tracked records" value={(items ?? []).length} sub="assets, supplies, consumables" />
        <Stat label="Locations & bins" value={(locations ?? []).length} sub="rooms, bins, people, off-site" />
        <Stat label="On hand" value={formatQuantity(totalOnHand, "")} sub="posted balance total" />
        <Stat label="Low stock" value={lowStock.length} sub="at or below reorder point" tone={lowStock.length ? "warn" : undefined} />
        <Stat label="Expiring lots" value={expiringLots.length} sub={`within ${EXPIRY_SOON_DAYS} days`} tone={expiringLots.length ? "warn" : undefined} />
        <Stat label="Count variances" value={varianceLines.length} sub="ready for adjustment" tone={varianceLines.length ? "warn" : undefined} />
      </div>

      {lowStock.length > 0 && (
        <div className="callout callout--warn">
          <AlertTriangle size={16} />
          <div>
            <strong>{lowStock.length} item{lowStock.length === 1 ? "" : "s"} at or below reorder point</strong>
            <div className="muted">{lowStock.slice(0, 4).map(({ item }) => item.name).join(", ")}{lowStock.length > 4 ? ` +${lowStock.length - 4} more` : ""}</div>
          </div>
        </div>
      )}

      {expiringLots.length > 0 && (
        <div className="callout callout--warn">
          <ClipboardCheck size={16} />
          <div>
            <strong>{expiringLots.length} lot{expiringLots.length === 1 ? "" : "s"} expiring soon or expired</strong>
            <div className="muted">
              {expiringLots.slice(0, 4).map(({ lot, days }) => `${itemById.get(lot.inventoryItemId)?.name ?? "Item"} (${days != null && days < 0 ? "expired" : `${days}d`})`).join(", ")}
            </div>
          </div>
        </div>
      )}

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

      <div className="tab-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 4px", alignItems: "center" }}>
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")} icon={<Package size={13} />} label="Stock & items" />
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")} icon={<MapPin size={13} />} label={`Locations & bins (${(locations ?? []).length})`} />
        <TabButton active={tab === "lots"} onClick={() => setTab("lots")} icon={<Layers size={13} />} label={`Lots & serials (${lotRows.length})`} />
        <TabButton active={tab === "counts"} onClick={() => setTab("counts")} icon={<ClipboardList size={13} />} label={`Physical counts (${openCounts.length})`} />
        <div style={{ flex: 1 }} />
        {tab === "locations" && <button className="btn btn--sm btn--accent" onClick={openNewLocation}><Plus size={12} /> New location</button>}
        {tab === "lots" && <button className="btn btn--sm btn--accent" onClick={() => openNewLot()}><Plus size={12} /> New lot / serial</button>}
        {tab === "counts" && <button className="btn btn--sm btn--accent" onClick={() => { setCountForm(emptyCountForm()); setDrawer("count-start"); }}><Plus size={12} /> Start count</button>}
      </div>

      {tab === "stock" && (
        <>
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
                <button className="btn btn--ghost btn--sm" onClick={() => openPlaceStock(row)}><MapPin size={12} /> Place / move</button>
                <button className="btn btn--ghost btn--sm" onClick={() => openLink(row)}><Link2 size={12} /> Link purchase</button>
                {(row.trackLot || row.trackSerial) && <button className="btn btn--ghost btn--sm" onClick={() => openNewLot(row._id)}><Layers size={12} /> Lot</button>}
                <button className="btn btn--ghost btn--sm" onClick={() => openEditItem(row)}><Pencil size={12} /> Edit</button>
                <button className="btn btn--ghost btn--sm" onClick={() => archiveItem(row)}>{row.status === "archived" ? "Restore" : "Archive"}</button>
                <button className="btn btn--ghost btn--sm" onClick={() => removeItem(row)}><Trash2 size={12} /></button>
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
              (row) => locationById.get(row.locationId)?.code,
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
                      <div className="muted">{location?.code ? `${location.code} · ` : ""}{location?.locationType ?? "location"}</div>
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
        </>
      )}

      {tab === "locations" && (
        <DataTable
          label="Locations & bins"
          icon={<MapPin size={14} />}
          data={(locations ?? []) as any[]}
          rowKey={(row) => row._id}
          loading={locations === undefined}
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
              render: (row) => (
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <LocationGlyph type={row.locationType} />
                  <div>
                    <strong>{row.name}</strong>{!row.active && <Badge tone="neutral">inactive</Badge>}
                    {row.parentLocationId && <div className="muted">in {locationById.get(row.parentLocationId)?.name ?? "—"}</div>}
                  </div>
                </div>
              ),
            },
            { id: "code", header: "Bin code", sortable: true, accessor: (row) => row.code ?? "", render: (row) => row.code ? <span className="row" style={{ gap: 4 }}><QrCode size={12} /> <span className="mono">{row.code}</span></span> : <span className="muted">-</span> },
            { id: "type", header: "Type", sortable: true, accessor: (row) => row.locationType ?? "", render: (row) => <Badge tone="info">{row.locationType}</Badge> },
            {
              id: "contents",
              header: "Contents",
              align: "right",
              accessor: (row) => (balancesByLocationId.get(row._id) ?? []).reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0),
              render: (row) => {
                const rows = balancesByLocationId.get(row._id) ?? [];
                const qty = rows.reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0);
                return rows.length ? <span className="mono">{rows.length} item{rows.length === 1 ? "" : "s"} · {qty}</span> : <span className="muted">empty</span>;
              },
            },
            { id: "address", header: "Address / notes", accessor: (row) => `${row.address ?? ""} ${row.notes ?? ""}`, render: (row) => <span className="muted">{row.address || row.notes || "-"}</span> },
          ]}
          renderRowActions={(row) => (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => { setDetailLocationId(row._id); setDrawer("location-detail"); }}><Boxes size={12} /> What's here</button>
              <button className="btn btn--ghost btn--sm" onClick={() => openEditLocation(row)}><Pencil size={12} /> Edit</button>
              <button className="btn btn--ghost btn--sm" onClick={() => removeLocation(row)}><Trash2 size={12} /></button>
            </>
          )}
        />
      )}

      {tab === "lots" && (
        <DataTable
          label="Lots & serials"
          icon={<Layers size={14} />}
          data={lotRows}
          rowKey={(row) => row._id}
          loading={lots === undefined}
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
                const tone = d != null && d < 0 ? "warn" : d != null && d <= EXPIRY_SOON_DAYS ? "warn" : "neutral";
                return <span className="row" style={{ gap: 4 }}><span className="mono">{row.expiresAt}</span>{d != null && d <= EXPIRY_SOON_DAYS && <Badge tone={tone as any}>{d < 0 ? "expired" : `${d}d`}</Badge>}</span>;
              },
            },
            { id: "manufacturer", header: "Manufacturer", accessor: (row) => row.manufacturer ?? "", render: (row) => <span className="muted">{row.manufacturer || "-"}</span> },
            { id: "status", header: "Status", sortable: true, accessor: (row) => row.status ?? "", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
          ]}
          renderRowActions={(row) => (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => openEditLot(row)}><Pencil size={12} /> Edit</button>
              <button className="btn btn--ghost btn--sm" onClick={() => removeLot(row)}><Trash2 size={12} /></button>
            </>
          )}
        />
      )}

      {tab === "counts" && (
        <DataTable
          label="Physical counts"
          icon={<ClipboardList size={14} />}
          data={countRows}
          rowKey={(row) => row._id}
          loading={counts === undefined}
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
              {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={() => { setActiveCountId(row._id); setDrawer("count-entry"); }}><Pencil size={12} /> Enter counts</button>}
              {row.status === "open" && <button className="btn btn--ghost btn--sm" onClick={async () => { await voidCount({ inventoryCountId: row._id }); toast.success("Count voided"); }}>Void</button>}
            </>
          )}
        />
      )}

      {/* ---- Drawers ---- */}
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
              setMovementForm({ ...movementForm, inventoryItemId: e.target.value, inventoryLotId: "", reference: item?.sku ?? movementForm.reference });
            }}>
              <option value="">Select item</option>
              {((items ?? []) as any[]).map((item) => <option key={item._id} value={item._id}>{item.name} {item.sku ? `(${item.sku})` : ""}</option>)}
            </select>
          </Field>
          {movementItemLots.length > 0 && (
            <Field label="Lot / serial" hint="Optional — pick the specific batch or unit.">
              <select className="input" value={movementForm.inventoryLotId} onChange={(e) => setMovementForm({ ...movementForm, inventoryLotId: e.target.value })}>
                <option value="">No specific lot</option>
                {movementItemLots.map((lot: any) => <option key={lot._id} value={lot._id}>{lot.lotNumber || lot.serialNumber}{lot.expiresAt ? ` · exp ${lot.expiresAt}` : ""}</option>)}
              </select>
            </Field>
          )}
          <Field label="Quantity">
            <input className="input" inputMode="decimal" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} />
          </Field>
          <Field label="From location" hint="Where stock leaves (consume / transfer / adjust down).">
            <select className="input" value={movementForm.fromLocationId} onChange={(e) => setMovementForm({ ...movementForm, fromLocationId: e.target.value })}>
              <option value="">External / not applicable</option>
              {((locations ?? []) as any[]).map((location) => <option key={location._id} value={location._id}>{location.name}{location.code ? ` (${location.code})` : ""}</option>)}
            </select>
          </Field>
          <Field label="To location" hint="Where stock lands (receive / transfer / adjust up).">
            <select className="input" value={movementForm.toLocationId} onChange={(e) => setMovementForm({ ...movementForm, toLocationId: e.target.value })}>
              <option value="">External / not applicable</option>
              {((locations ?? []) as any[]).map((location) => <option key={location._id} value={location._id}>{location.name}{location.code ? ` (${location.code})` : ""}</option>)}
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
        <Field label="Tracking" hint="Turn on to record lots, serial numbers, and expiry dates for this item.">
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={itemForm.trackLot} onChange={(e) => setItemForm({ ...itemForm, trackLot: e.target.checked })} /> Lots / batches</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={itemForm.trackSerial} onChange={(e) => setItemForm({ ...itemForm, trackSerial: e.target.checked })} /> Serial numbers</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={itemForm.trackExpiry} onChange={(e) => setItemForm({ ...itemForm, trackExpiry: e.target.checked })} /> Expiry dates</label>
          </div>
        </Field>
      </Drawer>

      <Drawer
        open={drawer === "location"}
        onClose={() => { setDrawer(null); setEditingLocationId(null); }}
        title={editingLocationId ? "Edit location" : "New location"}
        footer={<button className="btn-action btn-action--primary" onClick={saveLocation}>{editingLocationId ? "Save location" : "Create location"}</button>}
      >
        <div className="form-grid">
          <Field label="Name" required>
            <input className="input" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} />
          </Field>
          <Field label="Bin / shelf code" hint="A short scannable label you can stick on the bin, e.g. BIN-A3.">
            <input className="input" value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} placeholder="BIN-A3" />
          </Field>
          <Field label="Type">
            <select className="input" value={locationForm.locationType} onChange={(e) => setLocationForm({ ...locationForm, locationType: e.target.value })}>
              {LOCATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="Inside (parent location)" hint="Nest a bin inside a room or facility.">
            <select className="input" value={locationForm.parentLocationId} onChange={(e) => setLocationForm({ ...locationForm, parentLocationId: e.target.value })}>
              <option value="">Top level</option>
              {((locations ?? []) as any[]).filter((l) => l._id !== editingLocationId).map((location) => <option key={location._id} value={location._id}>{location.name}{location.code ? ` (${location.code})` : ""}</option>)}
            </select>
          </Field>
          <Field label="Address">
            <input className="input" value={locationForm.address} onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="input" value={locationForm.notes} onChange={(e) => setLocationForm({ ...locationForm, notes: e.target.value })} />
          </Field>
          <Field label="Active">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={locationForm.active} onChange={(e) => setLocationForm({ ...locationForm, active: e.target.checked })} /> Available for new movements</label>
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "location-detail"}
        onClose={() => { setDrawer(null); setDetailLocationId(null); }}
        title={detailLocation ? `What's in ${detailLocation.name}` : "Location contents"}
        size="wide"
      >
        {detailLocation && (
          <div className="stack">
            <div className="muted">
              {detailLocation.code ? <span className="mono">{detailLocation.code}</span> : null} {detailLocation.locationType}
              {detailLocation.parentLocationId ? ` · inside ${locationById.get(detailLocation.parentLocationId)?.name ?? "—"}` : ""}
            </div>
            <table className="table">
              <thead><tr><th>Item</th><th>SKU</th><th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Available</th></tr></thead>
              <tbody>
                {(balancesByLocationId.get(detailLocation._id) ?? []).length === 0 && (
                  <tr><td colSpan={4} className="muted">This location is empty.</td></tr>
                )}
                {(balancesByLocationId.get(detailLocation._id) ?? []).map((b) => {
                  const item = itemById.get(b.inventoryItemId);
                  return (
                    <tr key={b._id}>
                      <td>{item?.name ?? "Unknown item"}</td>
                      <td className="mono muted">{item?.sku ?? "-"}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{formatQuantity(b.quantityOnHand, item?.unitOfMeasure)}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{formatQuantity(b.quantityAvailable, item?.unitOfMeasure)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Drawer>

      <Drawer
        open={drawer === "lot"}
        onClose={() => setDrawer(null)}
        title={editingLotId ? "Edit lot / serial" : "New lot / serial"}
        footer={<button className="btn-action btn-action--primary" onClick={saveLot}>{editingLotId ? "Save lot" : "Create lot"}</button>}
      >
        <div className="form-grid">
          <Field label="Item" required>
            <select className="input" value={lotForm.inventoryItemId} onChange={(e) => setLotForm({ ...lotForm, inventoryItemId: e.target.value })}>
              <option value="">Select item</option>
              {((items ?? []) as any[]).map((item) => <option key={item._id} value={item._id}>{item.name} {item.sku ? `(${item.sku})` : ""}</option>)}
            </select>
          </Field>
          <Field label="Lot / batch number">
            <input className="input" value={lotForm.lotNumber} onChange={(e) => setLotForm({ ...lotForm, lotNumber: e.target.value })} />
          </Field>
          <Field label="Serial number">
            <input className="input" value={lotForm.serialNumber} onChange={(e) => setLotForm({ ...lotForm, serialNumber: e.target.value })} />
          </Field>
          <Field label="Expires">
            <input className="input" type="date" value={lotForm.expiresAt} onChange={(e) => setLotForm({ ...lotForm, expiresAt: e.target.value })} />
          </Field>
          <Field label="Manufacturer">
            <input className="input" value={lotForm.manufacturer} onChange={(e) => setLotForm({ ...lotForm, manufacturer: e.target.value })} />
          </Field>
          <Field label="Manufactured">
            <input className="input" type="date" value={lotForm.manufacturedAt} onChange={(e) => setLotForm({ ...lotForm, manufacturedAt: e.target.value })} />
          </Field>
          <Field label="Condition">
            <input className="input" value={lotForm.condition} onChange={(e) => setLotForm({ ...lotForm, condition: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className="input" value={lotForm.status} onChange={(e) => setLotForm({ ...lotForm, status: e.target.value })}>
              {LOT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "count-start"}
        onClose={() => setDrawer(null)}
        title="Start physical count"
        footer={<button className="btn-action btn-action--primary" onClick={startCount}>Start count</button>}
      >
        <div className="form-grid">
          <Field label="Title" required>
            <input className="input" value={countForm.title} onChange={(e) => setCountForm({ ...countForm, title: e.target.value })} placeholder="Q2 supply cabinet count" />
          </Field>
          <Field label="Scope" hint="Seeds count lines from current balances so you can record what's actually there.">
            <select className="input" value={countForm.scopeType} onChange={(e) => setCountForm({ ...countForm, scopeType: e.target.value })}>
              <option value="all">Everything on hand</option>
              <option value="location">A single location / bin</option>
              <option value="itemType">One item type</option>
            </select>
          </Field>
          {countForm.scopeType === "location" && (
            <Field label="Location">
              <select className="input" value={countForm.locationId} onChange={(e) => setCountForm({ ...countForm, locationId: e.target.value })}>
                <option value="">Select location</option>
                {((locations ?? []) as any[]).map((location) => <option key={location._id} value={location._id}>{location.name}{location.code ? ` (${location.code})` : ""}</option>)}
              </select>
            </Field>
          )}
          {countForm.scopeType === "itemType" && (
            <Field label="Item type">
              <select className="input" value={countForm.itemType} onChange={(e) => setCountForm({ ...countForm, itemType: e.target.value })}>
                <option value="">Select type</option>
                {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
          )}
          <Field label="Reviewer">
            <input className="input" value={countForm.reviewerName} onChange={(e) => setCountForm({ ...countForm, reviewerName: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="input" value={countForm.notes} onChange={(e) => setCountForm({ ...countForm, notes: e.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "count-entry"}
        onClose={() => setDrawer(null)}
        title={activeCount ? `Enter counts · ${activeCount.title}` : "Enter counts"}
        size="wide"
        footer={
          activeCount && activeCount.status === "open" ? (
            <button
              className="btn-action btn-action--primary"
              onClick={async () => {
                await reconcileCount({ inventoryCountId: activeCount._id, reason: `Physical count: ${activeCount.title}` });
                toast.success("Variances posted and count closed");
                setDrawer(null);
              }}
            >
              Post adjustments & close
            </button>
          ) : null
        }
      >
        {activeCount && (
          <CountEntry
            count={activeCount}
            itemById={itemById}
            locationById={locationById}
            onSaveLine={async (lineId, countedQuantity) => {
              await setCountLine({ id: lineId as any, countedQuantity });
            }}
          />
        )}
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

function trackingLabel(item: any) {
  const flags = [item.trackLot && "lot", item.trackSerial && "serial", item.trackExpiry && "expiry"].filter(Boolean);
  return flags.length ? ` · ${flags.join("/")}` : "";
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      className={active ? "btn btn--sm btn--accent" : "btn btn--sm btn--ghost"}
      onClick={onClick}
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      {icon} {label}
    </button>
  );
}

function LocationGlyph({ type }: { type?: string }) {
  if (type === "bin" || type === "shelf") return <Tag size={14} />;
  if (type === "custody") return <Package size={14} />;
  return <MapPin size={14} />;
}

function CountEntry({
  count,
  itemById,
  locationById,
  onSaveLine,
}: {
  count: any;
  itemById: Map<string, any>;
  locationById: Map<string, any>;
  onSaveLine: (lineId: string, countedQuantity: number) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const lines = (count.lines ?? []) as any[];
  if (lines.length === 0) return <div className="muted">No lines to count — this scope had no balances on hand.</div>;
  return (
    <table className="table">
      <thead>
        <tr><th>Item</th><th>Location</th><th style={{ textAlign: "right" }}>Expected</th><th style={{ textAlign: "right" }}>Counted</th><th style={{ textAlign: "right" }}>Δ</th></tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const item = itemById.get(line.inventoryItemId);
          const location = locationById.get(line.locationId);
          const draft = drafts[line._id] ?? (line.countedQuantity != null ? String(line.countedQuantity) : "");
          const counted = draft.trim() === "" ? null : Number(draft);
          const variance = counted != null ? counted - (line.expectedQuantity ?? 0) : null;
          return (
            <tr key={line._id}>
              <td>{item?.name ?? "Unknown"}<div className="muted mono">{item?.sku ?? ""}</div></td>
              <td>{location?.name ?? "—"}{location?.code ? <span className="muted"> ({location.code})</span> : null}</td>
              <td className="mono" style={{ textAlign: "right" }}>{line.expectedQuantity ?? 0}</td>
              <td style={{ textAlign: "right" }}>
                <input
                  className="input mono"
                  style={{ width: 90, textAlign: "right" }}
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDrafts({ ...drafts, [line._id]: e.target.value })}
                  onBlur={async () => {
                    if (draft.trim() === "") return;
                    const n = Number(draft);
                    if (Number.isFinite(n)) await onSaveLine(line._id, n);
                  }}
                  disabled={count.status !== "open"}
                />
              </td>
              <td className="mono" style={{ textAlign: "right", color: variance ? "var(--warn, #b45309)" : undefined }}>{variance == null ? "-" : variance > 0 ? `+${variance}` : variance}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
