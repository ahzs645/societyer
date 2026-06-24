// Pure helpers, constants, and form factories for the Inventory module.
// Kept dependency-free so the page, tab views, and drawers can share them
// without pulling in React state.
import type { ImageValue } from "../../components/ImageUploadField";

export type TabKey = "stock" | "locations" | "lots" | "counts";

// "count" is intentionally excluded from manual movements — counting is done
// through the physical-count flow, which posts proper "adjustment" deltas. A
// manual "count" movement would add its quantity on top of the existing balance
// (double counting).
export const MOVEMENT_TYPES = ["receive", "consume", "transfer", "adjustment"];
export const ITEM_TYPES = ["asset", "consumable", "supply", "software", "service", "other"];
export const LOCATION_TYPES = ["facility", "room", "shelf", "bin", "custody", "in_transit", "vendor", "virtual"];
export const LOT_STATUSES = ["active", "depleted", "expired", "disposed", "needs_review"];
export const EXPIRY_SOON_DAYS = 60;

export function formatQuantity(value?: number | null, unit?: string | null) {
  if (value == null) return "-";
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)} ${unit ?? "each"}`;
}

export function movementTone(type: string) {
  if (["receive", "return"].includes(type)) return "success";
  if (["issue", "consume", "dispose"].includes(type)) return "warn";
  if (["transfer", "count"].includes(type)) return "info";
  return "neutral";
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function dollarsToCents(value: string): number | undefined {
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || value.trim() === "") return undefined;
  return Math.round(n * 100);
}

export function centsToDollars(value?: number | null): string {
  if (value == null) return "";
  return (value / 100).toFixed(2);
}

export function daysUntil(iso?: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function trackingLabel(item: any) {
  const flags = [item.trackLot && "lot", item.trackSerial && "serial", item.trackExpiry && "expiry"].filter(Boolean);
  return flags.length ? ` · ${flags.join("/")}` : "";
}

export function receiptLinksForMovement(row: any, linksByItemId: Map<string, any[]>) {
  const links = linksByItemId.get(row.inventoryItemId) ?? [];
  if (!row.receiptDocumentId) return links;
  const direct = links.filter((link) => link.receiptDocumentId === row.receiptDocumentId);
  return direct.length ? direct : links;
}

export function emptyItemForm() {
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

export function emptyLocationForm() {
  return { name: "", code: "", locationType: "facility", parentLocationId: "", address: "", notes: "", active: true };
}

export function emptyLotForm() {
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

export function emptyLinkForm() {
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

export function emptyMovementForm() {
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

export function emptyCountForm() {
  return { title: "", scopeType: "all", locationId: "", itemType: "", reviewerName: "", notes: "" };
}
