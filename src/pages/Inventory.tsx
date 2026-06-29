import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Layers,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react";
import { AssetScanner } from "../features/assets/AssetScanner";
import { AssetQrLabel } from "../features/assets/AssetQrLabel";
import { ASSET_LABEL_TYPES } from "../features/assets/assetUtils";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { ImageUploadField } from "../components/ImageUploadField";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { money } from "../lib/format";
import {
  CONNECTION_STATUSES,
  EXPIRY_SOON_DAYS,
  INVENTORY_PROVIDERS,
  ITEM_TYPES,
  LOCATION_TYPES,
  LOT_STATUSES,
  MOVEMENT_TYPES,
  type TabKey,
  centsToDollars,
  daysUntil,
  dollarsToCents,
  emptyConnectionForm,
  emptyCountForm,
  emptyItemForm,
  emptyLinkForm,
  emptyLocationForm,
  emptyLotForm,
  emptyMovementForm,
  formatQuantity,
  providerLabel,
  relativeSince,
  todayDate,
} from "./inventory/helpers";
import { CountEntry, Stat, TabButton } from "./inventory/components";
import { CountsTab, LocationsTab, LotsTab, StockTab } from "./inventory/tabs";
import { MoreActionsMenu } from "../components/MoreActionsMenu";

export function InventoryPage() {
  const society = useSociety();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const actingUserId = useCurrentUserId() ?? undefined;
  const connections = useQuery(api.inventoryHub.connections, society ? { societyId: society._id } : "skip");
  const items = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const locations = useQuery(api.inventoryHub.locations, society ? { societyId: society._id } : "skip");
  const balances = useQuery(api.inventoryHub.balances, society ? { societyId: society._id } : "skip");
  const movements = useQuery(api.inventoryHub.stockMovements, society ? { societyId: society._id, limit: 100 } : "skip");
  const lots = useQuery(api.inventoryHub.lots, society ? { societyId: society._id } : "skip");
  const counts = useQuery(api.inventoryHub.counts, society ? { societyId: society._id } : "skip");
  const receiptLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const pendingCandidates = useQuery(api.inventoryHub.candidates, society ? { societyId: society._id, status: "new" } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
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
  const addCountLine = useMutation(api.inventoryHub.addCountLine);
  const voidCount = useMutation(api.inventoryHub.voidCount);
  const linkReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkReceipt = useMutation(api.inventoryHub.unlinkReceipt);
  const promoteCandidate = useMutation(api.inventoryHub.promoteCandidateToMovement);
  const setCandidateStatus = useMutation(api.inventoryHub.setCandidateStatus);
  const upsertConnection = useMutation(api.inventoryHub.upsertConnection);
  const deleteConnection = useMutation(api.inventoryHub.deleteConnection);

  const [tab, setTab] = useState<TabKey>("stock");
  const [drawer, setDrawer] = useState<
    "movement" | "openboxes" | "item" | "location" | "link" | "lot" | "count-start" | "count-entry" | "location-detail" | "location-label" | "connection" | null
  >(null);
  const [connectionForm, setConnectionForm] = useState(emptyConnectionForm);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [syncConnectionId, setSyncConnectionId] = useState<string | null>(null);
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
  const [labelLocationId, setLabelLocationId] = useState<string | null>(null);
  const [labelType, setLabelType] = useState("qr");
  const [collapsedLocationIds, setCollapsedLocationIds] = useState<Set<string>>(new Set());
  const [scanOpen, setScanOpen] = useState(false);
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
  const labelLocation = labelLocationId ? locationById.get(labelLocationId) : null;

  const findLocationByCode = (code: string) => {
    const needle = code.trim().toLowerCase();
    if (!needle) return null;
    return ((locations ?? []) as any[]).find(
      (loc) => String(loc.code ?? "").toLowerCase() === needle || String(loc.name ?? "").toLowerCase() === needle,
    ) ?? null;
  };

  const onScanDetected = (code: string) => {
    const match = findLocationByCode(code);
    if (match) {
      setScanOpen(false);
      setDetailLocationId(match._id);
      setDrawer("location-detail");
    } else {
      toast.error("No bin matches that code", code);
    }
  };

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
      custodianName: location.custodianName ?? "",
      custodianMemberId: location.custodianMemberId ?? "",
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
      custodianName: locationForm.locationType === "custody" ? (locationForm.custodianName.trim() || undefined) : undefined,
      custodianMemberId: locationForm.locationType === "custody" && locationForm.custodianMemberId ? (locationForm.custodianMemberId as any) : undefined,
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
      const result = await importOpenBoxes({
        societyId: society._id,
        ...(syncConnectionId ? { connectionId: syncConnectionId as any } : {}),
        ...parsed,
      });
      toast.success(`OpenBoxes import: ${result.itemsUpserted ?? 0} items, ${result.movementsPosted ?? 0} movements`);
      setDrawer(null);
      setSyncConnectionId(null);
    } catch (error: any) {
      toast.error(error?.message ?? "OpenBoxes import failed.");
    }
  };

  const openNewConnection = () => {
    setEditingConnectionId(null);
    setConnectionForm(emptyConnectionForm());
    setDrawer("connection");
  };

  const openEditConnection = (connection: any) => {
    setEditingConnectionId(connection._id);
    setConnectionForm({
      provider: connection.provider ?? "manual",
      displayName: connection.displayName ?? "",
      status: connection.status ?? "active",
      externalOrganizationId: connection.externalOrganizationId ?? "",
      baseUrl: connection.baseUrl ?? "",
    });
    setDrawer("connection");
  };

  const saveConnection = async () => {
    if (!connectionForm.displayName.trim()) {
      toast.error("Give the library a name.");
      return;
    }
    try {
      await upsertConnection({
        id: editingConnectionId ? (editingConnectionId as any) : undefined,
        societyId: society._id,
        provider: connectionForm.provider,
        displayName: connectionForm.displayName.trim(),
        status: connectionForm.status,
        externalOrganizationId: connectionForm.externalOrganizationId.trim() || undefined,
        baseUrl: connectionForm.baseUrl.trim() || undefined,
      });
      toast.success(editingConnectionId ? "Library updated" : "Library added");
      setDrawer(null);
    } catch (error: any) {
      toast.error("Could not save library", error?.message);
    }
  };

  const removeConnection = async (connection: any) => {
    const ok = await confirm({
      title: "Remove library?",
      message: `Remove "${connection.displayName}"? Items it imported are kept but will no longer be linked to a library.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteConnection({ id: connection._id });
      toast.success("Library removed");
    } catch (error: any) {
      toast.error("Could not remove library", error?.message);
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
            <MoreActionsMenu
              items={[
                { id: "add-library", label: "Add library", icon: <Boxes size={14} />, onSelect: openNewConnection },
                { id: "backfill-assets", label: "Backfill assets", icon: <RefreshCw size={14} />, onSelect: runBackfill },
                { id: "openboxes-import", label: "OpenBoxes import", icon: <Boxes size={14} />, onSelect: () => { setSyncConnectionId(null); setDrawer("openboxes"); } },
                { id: "new-movement", label: "New movement", icon: <Plus size={14} />, onSelect: () => { setMovementForm(emptyMovementForm()); setDrawer("movement"); } },
                { id: "assets", label: "Assets", icon: <ArrowLeft size={14} />, onSelect: () => navigate("/app/assets") },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={openNewItem}><Plus size={12} /> New item</button>
          </div>
        }
      />

      {/* Compact KPI row — the actionable alerts (expiring lots, count
          variances) surface as callouts below rather than as zero-value tiles. */}
      <div className="stat-grid">
        <Stat label="Tracked records" value={(items ?? []).length} sub="assets, supplies, consumables" />
        <Stat label="Locations & bins" value={(locations ?? []).length} sub="rooms, bins, people, off-site" />
        <Stat label="On hand" value={formatQuantity(totalOnHand, "")} sub="posted balance total" />
        <Stat label="Low stock" value={lowStock.length} sub="at or below reorder point" tone={lowStock.length ? "warn" : undefined} />
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

      {(pendingCandidates ?? []).filter((c: any) => c.candidateType === "movement").length > 0 && (
        <div className="card" style={{ marginBottom: 8 }}>
          <div className="card__head">
            <h2 className="card__title">Pending imports</h2>
            <span className="card__subtitle">
              {(pendingCandidates ?? []).filter((c: any) => c.candidateType === "movement").length} movement candidate(s) awaiting review
            </span>
          </div>
          <div className="card__body col" style={{ gap: 6 }}>
            {(pendingCandidates ?? [])
              .filter((c: any) => c.candidateType === "movement")
              .map((c: any) => {
                const resolved = !!c.suggestedInventoryItemId && !!c.suggestedLocationId;
                return (
                  <div key={c._id} className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                      <strong>{c.itemName ?? c.sku ?? "Item"}</strong>
                      <span className="muted">
                        {" "}· qty {c.quantity ?? 0}{c.locationName ? ` → ${c.locationName}` : ""}{c.sourceSystem ? ` · ${c.sourceSystem}` : ""}
                      </span>
                      {!resolved && <span className="muted"> · needs item/location match</span>}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <button
                        className="btn btn--sm"
                        disabled={!resolved}
                        title={resolved ? "Post as a stock movement" : "Match an inventory item and location first"}
                        onClick={async () => {
                          try {
                            await promoteCandidate({ candidateId: c._id });
                            toast.success("Posted candidate as a stock movement");
                          } catch (err: any) {
                            toast.error(err?.message ?? "Could not post candidate");
                          }
                        }}
                      >
                        Post movement
                      </button>
                      <button
                        className="btn btn--sm btn--ghost"
                        onClick={async () => {
                          await setCandidateStatus({ candidateId: c._id, status: "ignored" });
                          toast.info("Candidate ignored");
                        }}
                      >
                        Ignore
                      </button>
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="row inv-libraries-bar" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 8px", fontSize: 13 }}>
        <span className="row" style={{ gap: 6, alignItems: "center", color: "var(--text-tertiary)" }}>
          <Boxes size={13} /> <span style={{ fontWeight: 500 }}>Libraries</span>
        </span>
        {connections === undefined ? (
          <span className="muted">Loading…</span>
        ) : connections.length === 0 ? (
          <span className="muted">None connected — add a source (OpenBoxes, CSV, or manual) to keep this register in sync.</span>
        ) : (
          connections.map((connection: any) => (
            <span
              key={connection._id}
              className="row inv-library-chip"
              style={{ gap: 6, alignItems: "center", padding: "2px 6px 2px 8px", border: "1px solid var(--border)", borderRadius: 999 }}
              title={`${providerLabel(connection.provider)} · synced ${relativeSince(connection.lastSyncedAtISO)}`}
            >
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 999, background: connection.status === "active" ? "var(--success)" : connection.status === "disabled" ? "var(--text-tertiary)" : "var(--warning, orange)" }}
              />
              <button className="btn btn--ghost btn--sm" style={{ padding: "0 2px" }} onClick={() => openEditConnection(connection)} title="Edit library">
                {connection.displayName}
              </button>
              {connection.provider === "openboxes" && (
                <button className="btn btn--ghost btn--sm btn--icon" onClick={() => { setSyncConnectionId(connection._id); setDrawer("openboxes"); }} aria-label={`Sync ${connection.displayName}`} title="Import an OpenBoxes snapshot">
                  <RefreshCw size={12} />
                </button>
              )}
              <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove ${connection.displayName}`} title="Remove library" onClick={() => removeConnection(connection)}>
                <Trash2 size={12} />
              </button>
            </span>
          ))
        )}
        <button className="btn btn--sm btn--ghost" style={{ marginLeft: "auto" }} onClick={openNewConnection}>
          <Plus size={12} /> Add library
        </button>
      </div>

      <div className="tab-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 4px", alignItems: "center" }}>
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")} icon={<Package size={13} />} label="Stock & items" />
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")} icon={<MapPin size={13} />} label={`Locations & bins (${(locations ?? []).length})`} />
        <TabButton active={tab === "lots"} onClick={() => setTab("lots")} icon={<Layers size={13} />} label={`Lots & serials (${lotRows.length})`} />
        <TabButton active={tab === "counts"} onClick={() => setTab("counts")} icon={<ClipboardList size={13} />} label={`Physical counts (${openCounts.length})`} />
        <div style={{ flex: 1 }} />
        {tab === "locations" && collapsedLocationIds.size > 0 && <button className="btn btn--sm" onClick={() => setCollapsedLocationIds(new Set())}>Expand all</button>}
        {tab === "locations" && <button className="btn btn--sm" onClick={() => setCollapsedLocationIds(new Set(((locations ?? []) as any[]).filter((l) => ((locations ?? []) as any[]).some((c) => String(c.parentLocationId) === String(l._id))).map((l) => String(l._id))))}>Collapse all</button>}
        {tab === "locations" && <button className="btn btn--sm" onClick={() => setScanOpen(true)}><ScanLine size={12} /> Scan bin</button>}
        {tab === "locations" && <button className="btn btn--sm btn--accent" onClick={openNewLocation}><Plus size={12} /> New location</button>}
        {tab === "lots" && <button className="btn btn--sm btn--accent" onClick={() => openNewLot()}><Plus size={12} /> New lot / serial</button>}
        {tab === "counts" && <button className="btn btn--sm btn--accent" onClick={() => { setCountForm(emptyCountForm()); setDrawer("count-start"); }}><Plus size={12} /> Start count</button>}
      </div>

      {tab === "stock" && (
        <StockTab
          itemRows={itemRows}
          balanceRows={balanceRows}
          movementRows={movementRows}
          loading={{ items: items === undefined, balances: balances === undefined, locations: locations === undefined, movements: movements === undefined }}
          maps={{ itemById, locationById, onHandByItemId, receiptLinksByItemId, balancesByLocationId }}
          onPlace={openPlaceStock}
          onLink={openLink}
          onAddLot={openNewLot}
          onEdit={openEditItem}
          onArchive={archiveItem}
          onDelete={removeItem}
        />
      )}

      {tab === "locations" && (
        <LocationsTab
          locations={(locations ?? []) as any[]}
          loading={locations === undefined}
          maps={{ locationById, balancesByLocationId }}
          onWhatsHere={(location) => { setDetailLocationId(location._id); setDrawer("location-detail"); }}
          onEdit={openEditLocation}
          onDelete={removeLocation}
          onLabel={(location) => { setLabelLocationId(location._id); setLabelType("qr"); setDrawer("location-label"); }}
          collapsedIds={collapsedLocationIds}
          onToggleCollapse={(id) => setCollapsedLocationIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
        />
      )}

      {tab === "lots" && (
        <LotsTab
          lotRows={lotRows}
          loading={lots === undefined}
          maps={{ itemById }}
          onEdit={openEditLot}
          onDelete={removeLot}
        />
      )}

      {tab === "counts" && (
        <CountsTab
          countRows={countRows}
          loading={counts === undefined}
          onEnter={(count) => { setActiveCountId(count._id); setDrawer("count-entry"); }}
          onVoid={async (count) => { await voidCount({ inventoryCountId: count._id }); toast.success("Count voided"); }}
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
            <Select value={movementForm.movementType} onChange={(value) => setMovementForm({ ...movementForm, movementType: value })}
              options={MOVEMENT_TYPES.map((type) => ({ value: type, label: type }))} />
          </Field>
          <Field label="Date">
            <DatePicker value={movementForm.movementDate} onChange={(value) => setMovementForm({ ...movementForm, movementDate: value })} />
          </Field>
          <Field label="Item">
            <Select value={movementForm.inventoryItemId} onChange={(value) => {
              const item = itemById.get(value);
              setMovementForm({ ...movementForm, inventoryItemId: value, inventoryLotId: "", reference: item?.sku ?? movementForm.reference });
            }}
              options={[{ value: "", label: "Select item" }, ...((items ?? []) as any[]).map((item) => ({ value: item._id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))]} />
          </Field>
          {movementItemLots.length > 0 && (
            <Field label="Lot / serial" hint="Optional — pick the specific batch or unit.">
              <Select value={movementForm.inventoryLotId} onChange={(value) => setMovementForm({ ...movementForm, inventoryLotId: value })}
                options={[{ value: "", label: "No specific lot" }, ...movementItemLots.map((lot: any) => ({ value: lot._id, label: `${lot.lotNumber || lot.serialNumber}${lot.expiresAt ? ` · exp ${lot.expiresAt}` : ""}` }))]} />
            </Field>
          )}
          <Field label="Quantity">
            <input className="input" inputMode="decimal" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} />
          </Field>
          <Field label="From location" hint="Where stock leaves (consume / transfer / adjust down).">
            <Select value={movementForm.fromLocationId} onChange={(value) => setMovementForm({ ...movementForm, fromLocationId: value })}
              options={[{ value: "", label: "External / not applicable" }, ...((locations ?? []) as any[]).map((location) => ({ value: location._id, label: `${location.name}${location.code ? ` (${location.code})` : ""}` }))]} />
          </Field>
          <Field label="To location" hint="Where stock lands (receive / transfer / adjust up).">
            <Select value={movementForm.toLocationId} onChange={(value) => setMovementForm({ ...movementForm, toLocationId: value })}
              options={[{ value: "", label: "External / not applicable" }, ...((locations ?? []) as any[]).map((location) => ({ value: location._id, label: `${location.name}${location.code ? ` (${location.code})` : ""}` }))]} />
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
        open={drawer === "connection"}
        onClose={() => setDrawer(null)}
        title={editingConnectionId ? "Edit library" : "Add library"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveConnection}>{editingConnectionId ? "Save library" : "Add library"}</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Name" required hint="A label for this inventory source, e.g. “Main warehouse” or “OpenBoxes clinic”.">
            <input className="input" value={connectionForm.displayName} onChange={(e) => setConnectionForm({ ...connectionForm, displayName: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select
              value={connectionForm.provider}
              onChange={(provider) => setConnectionForm({ ...connectionForm, provider })}
              options={INVENTORY_PROVIDERS.map((p) => ({ value: p, label: providerLabel(p) }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={connectionForm.status}
              onChange={(status) => setConnectionForm({ ...connectionForm, status })}
              options={CONNECTION_STATUSES.map((s) => ({ value: s, label: s === "needs_attention" ? "needs attention" : s }))}
            />
          </Field>
          <Field label="Base URL" hint="API or web address of the external system (optional).">
            <input className="input" value={connectionForm.baseUrl} placeholder="https://…" onChange={(e) => setConnectionForm({ ...connectionForm, baseUrl: e.target.value })} />
          </Field>
          <Field label="External organization ID" hint="Identifier for your org in the external system (optional).">
            <input className="input" value={connectionForm.externalOrganizationId} onChange={(e) => setConnectionForm({ ...connectionForm, externalOrganizationId: e.target.value })} />
          </Field>
        </div>
        <p className="muted">
          OpenBoxes libraries can pull a snapshot from the <strong>Sync</strong> action in the libraries list. CSV and manual
          libraries are kept up to date through imports and the item editor.
        </p>
      </Drawer>

      <Drawer
        open={drawer === "openboxes"}
        onClose={() => { setDrawer(null); setSyncConnectionId(null); }}
        title={syncConnectionId ? "Sync OpenBoxes library" : "Import OpenBoxes snapshot"}
        size="wide"
        footer={<button className="btn-action btn-action--primary" onClick={runOpenBoxesImport}>{syncConnectionId ? "Sync snapshot" : "Import snapshot"}</button>}
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
            <Select value={itemForm.itemType} onChange={(value) => setItemForm({ ...itemForm, itemType: value })}
              options={ITEM_TYPES.map((type) => ({ value: type, label: type }))} />
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
            <Select value={locationForm.locationType} onChange={(value) => setLocationForm({ ...locationForm, locationType: value })}
              options={LOCATION_TYPES.map((type) => ({ value: type, label: type }))} />
          </Field>
          <Field label="Inside (parent location)" hint="Nest a bin inside a room or facility.">
            <Select value={locationForm.parentLocationId} onChange={(value) => setLocationForm({ ...locationForm, parentLocationId: value })}
              options={[{ value: "", label: "Top level" }, ...((locations ?? []) as any[]).filter((l) => l._id !== editingLocationId).map((location) => ({ value: location._id, label: `${location.name}${location.code ? ` (${location.code})` : ""}` }))]} />
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
          {locationForm.locationType === "custody" && (
            <Field label="Custodian" hint="Who holds the items in custody. Links to the asset register's custodian.">
              <Select
                value={locationForm.custodianMemberId}
                onChange={(value) => {
                  const member = ((members ?? []) as any[]).find((m) => m._id === value);
                  setLocationForm({
                    ...locationForm,
                    custodianMemberId: value,
                    custodianName: member ? `${member.firstName} ${member.lastName}`.trim() : locationForm.custodianName,
                  });
                }}
                options={[{ value: "", label: "Not a member / enter name below" }, ...((members ?? []) as any[]).map((m) => ({ value: m._id, label: `${m.firstName} ${m.lastName}`.trim() }))]}
              />
              <input
                className="input"
                style={{ marginTop: 6 }}
                placeholder="Custodian name"
                value={locationForm.custodianName}
                onChange={(e) => setLocationForm({ ...locationForm, custodianName: e.target.value })}
              />
            </Field>
          )}
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
              {detailLocation.custodianName ? ` · custodian: ${detailLocation.custodianName}` : ""}
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
        open={drawer === "location-label"}
        onClose={() => { setDrawer(null); setLabelLocationId(null); }}
        title={labelLocation ? `Label — ${labelLocation.name}` : "Bin label"}
      >
        {labelLocation && (
          <div className="stack" style={{ gap: 12 }}>
            {labelLocation.code ? (
              <>
                <Field label="Label format">
                  <Select
                    value={labelType}
                    onChange={setLabelType}
                    options={ASSET_LABEL_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  />
                </Field>
                <AssetQrLabel assetTag={labelLocation.code} name={labelLocation.name} url={labelLocation.code} labelType={labelType} />
                <p className="muted">Print and stick this on the bin. Scanning it with <strong>Scan bin</strong> opens this location.</p>
                <button className="btn-action" onClick={() => window.print()}>Print label</button>
              </>
            ) : (
              <p className="muted">Add a bin code to this location to generate a scannable label.</p>
            )}
          </div>
        )}
      </Drawer>

      <AssetScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={onScanDetected}
        title="Scan bin"
        hint="Point the camera at a bin's QR code, or type its code below."
      />

      <Drawer
        open={drawer === "lot"}
        onClose={() => setDrawer(null)}
        title={editingLotId ? "Edit lot / serial" : "New lot / serial"}
        footer={<button className="btn-action btn-action--primary" onClick={saveLot}>{editingLotId ? "Save lot" : "Create lot"}</button>}
      >
        <div className="form-grid">
          <Field label="Item" required>
            <Select value={lotForm.inventoryItemId} onChange={(value) => setLotForm({ ...lotForm, inventoryItemId: value })}
              options={[{ value: "", label: "Select item" }, ...((items ?? []) as any[]).map((item) => ({ value: item._id, label: `${item.name} ${item.sku ? `(${item.sku})` : ""}` }))]} />
          </Field>
          <Field label="Lot / batch number">
            <input className="input" value={lotForm.lotNumber} onChange={(e) => setLotForm({ ...lotForm, lotNumber: e.target.value })} />
          </Field>
          <Field label="Serial number">
            <input className="input" value={lotForm.serialNumber} onChange={(e) => setLotForm({ ...lotForm, serialNumber: e.target.value })} />
          </Field>
          <Field label="Expires">
            <DatePicker value={lotForm.expiresAt} onChange={(value) => setLotForm({ ...lotForm, expiresAt: value })} />
          </Field>
          <Field label="Manufacturer">
            <input className="input" value={lotForm.manufacturer} onChange={(e) => setLotForm({ ...lotForm, manufacturer: e.target.value })} />
          </Field>
          <Field label="Manufactured">
            <DatePicker value={lotForm.manufacturedAt} onChange={(value) => setLotForm({ ...lotForm, manufacturedAt: value })} />
          </Field>
          <Field label="Condition">
            <input className="input" value={lotForm.condition} onChange={(e) => setLotForm({ ...lotForm, condition: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={lotForm.status} onChange={(value) => setLotForm({ ...lotForm, status: value })}
              options={LOT_STATUSES.map((s) => ({ value: s, label: s }))} />
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
            <Select value={countForm.scopeType} onChange={(value) => setCountForm({ ...countForm, scopeType: value })}
              options={[{ value: "all", label: "Everything on hand" }, { value: "location", label: "A single location / bin" }, { value: "itemType", label: "One item type" }]} />
          </Field>
          {countForm.scopeType === "location" && (
            <Field label="Location">
              <Select value={countForm.locationId} onChange={(value) => setCountForm({ ...countForm, locationId: value })}
                options={[{ value: "", label: "Select location" }, ...((locations ?? []) as any[]).map((location) => ({ value: location._id, label: `${location.name}${location.code ? ` (${location.code})` : ""}` }))]} />
            </Field>
          )}
          {countForm.scopeType === "itemType" && (
            <Field label="Item type">
              <Select value={countForm.itemType} onChange={(value) => setCountForm({ ...countForm, itemType: value })}
                options={[{ value: "", label: "Select type" }, ...ITEM_TYPES.map((type) => ({ value: type, label: type }))]} />
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
            items={(items ?? []) as any[]}
            locations={(locations ?? []) as any[]}
            itemById={itemById}
            locationById={locationById}
            onSaveLine={async (lineId, countedQuantity) => {
              await setCountLine({ id: lineId as any, countedQuantity });
            }}
            onAddLine={async ({ inventoryItemId, locationId, countedQuantity }) => {
              await addCountLine({
                inventoryCountId: activeCount._id,
                inventoryItemId: inventoryItemId as any,
                locationId: locationId as any,
                countedQuantity,
              });
              toast.success("Found item added to the count");
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
                <Select value={linkForm.financialTransactionId} onChange={(value) => setLinkForm({ ...linkForm, financialTransactionId: value })}
                  options={[{ value: "", label: "No transaction" }, ...((transactions ?? []) as any[]).filter((t) => t.amountCents < 0).map((t) => ({ value: t._id, label: `${t.date} · ${t.description} · ${money(Math.abs(t.amountCents))}` }))]} />
              </Field>
              <Field label="Receipt document">
                <Select value={linkForm.receiptDocumentId} onChange={(value) => setLinkForm({ ...linkForm, receiptDocumentId: value })}
                  options={[{ value: "", label: "No receipt document" }, ...((documents ?? []) as any[]).filter((d) => d.category === "Receipt" || d.category === "FinancialStatement" || (d.tags ?? []).some((tag: string) => /receipt|invoice|finance/i.test(tag))).map((d) => ({ value: d._id, label: d.title }))]} />
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
