import { parseCsv, rowsToCsv } from "@/lib/csv";

export const ASSET_CATEGORIES = ["IT", "Program equipment", "Furniture", "Vehicle", "Facilities", "Software/license", "Other"];
export const ASSET_CONDITIONS = ["New", "Good", "Fair", "Needs repair", "Damaged", "Lost"];
export const ASSET_STATUSES = ["Available", "Checked out", "In maintenance", "Needs review", "Disposed", "Lost"];
export const CUSTODIAN_TYPES = ["member", "director", "employee", "volunteer", "committee", "location", "other"];
export const MAINTENANCE_KINDS = ["maintenance", "calibration", "insurance", "warranty", "inspection"];
export const ASSET_LABEL_TYPES = [
  { value: "qr", label: "QR code", payload: "Asset page URL" },
  { value: "code128", label: "Code 128", payload: "Asset tag text" },
  { value: "code39", label: "Code 39", payload: "Asset tag text" },
  { value: "datamatrix", label: "Data Matrix", payload: "Asset page URL" },
  { value: "pdf417", label: "PDF417", payload: "Asset page URL" },
  { value: "ean13", label: "EAN-13", payload: "12 or 13 numeric digits" },
  { value: "upca", label: "UPC-A", payload: "11 or 12 numeric digits" },
  { value: "itf14", label: "ITF-14", payload: "13 or 14 numeric digits" },
] as const;

export function centsToInput(cents?: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function inputToCents(value: unknown) {
  const text = String(value ?? "").trim().replace(/[$,]/g, "");
  if (!text) return undefined;
  const amount = Number(text);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * 100);
}

export function money(cents?: number | null, currency = "CAD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function oneYearFromToday() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export function nextAssetTag(rows: any[]) {
  const max = rows.reduce((highest, row) => {
    const match = String(row.assetTag ?? "").match(/(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `AST-${String(max + 1).padStart(4, "0")}`;
}

export function summarizeAssets(rows: any[], maintenance: any[], verificationRuns: any[]) {
  const active = rows.filter((row) => row.status !== "Disposed" && row.status !== "Lost");
  const checkedOut = rows.filter((row) => row.status === "Checked out");
  const needsReview = rows.filter((row) => row.status === "Needs review" || row.condition === "Needs repair" || row.condition === "Damaged");
  const valueCents = active.reduce((sum, row) => sum + (row.bookValueCents ?? row.purchaseValueCents ?? 0), 0);
  const dueMaintenance = maintenance.filter((row) => row.status !== "Completed" && isDue(row.dueDate, 30));
  const openRun = verificationRuns.find((run) => run.status === "Open");
  return {
    total: rows.length,
    active: active.length,
    checkedOut: checkedOut.length,
    needsReview: needsReview.length,
    valueCents,
    dueMaintenance: dueMaintenance.length,
    openRun,
  };
}

export function isDue(date?: string, days = 0) {
  if (!date) return false;
  const target = new Date(`${date}T00:00:00`);
  const now = new Date();
  const diff = Math.ceil((target.getTime() - now.getTime()) / 86400000);
  return diff <= days;
}

export function assetUrl(assetId: string) {
  if (typeof window === "undefined") return `/app/assets/${assetId}`;
  return new URL(`/app/assets/${assetId}`, window.location.origin).toString();
}

export function formFromAsset(row: any) {
  return {
    assetTag: row.assetTag ?? "",
    preferredLabelType: row.preferredLabelType ?? "qr",
    name: row.name ?? "",
    category: row.category ?? "Program equipment",
    serialNumber: row.serialNumber ?? "",
    supplier: row.supplier ?? "",
    purchaseDate: row.purchaseDate ?? "",
    purchaseValue: centsToInput(row.purchaseValueCents),
    currency: row.currency ?? "CAD",
    fundingSource: row.fundingSource ?? "",
    grantRestrictions: row.grantRestrictions ?? "",
    retentionUntil: row.retentionUntil ?? "",
    disposalRules: row.disposalRules ?? "",
    location: row.location ?? "",
    condition: row.condition ?? "Good",
    status: row.status ?? "Available",
    custodianType: row.custodianType ?? "location",
    custodianName: row.custodianName ?? "",
    responsiblePersonName: row.responsiblePersonName ?? "",
    expectedReturnDate: row.expectedReturnDate ?? "",
    insuranceNotes: row.insuranceNotes ?? "",
    capitalized: Boolean(row.capitalized),
    depreciationMethod: row.depreciationMethod ?? "",
    usefulLifeMonths: row.usefulLifeMonths?.toString?.() ?? "",
    bookValue: centsToInput(row.bookValueCents),
    purchaseTransactionId: row.purchaseTransactionId ?? "",
    receiptDocumentId: row.receiptDocumentId ?? "",
    warrantyExpiresAt: row.warrantyExpiresAt ?? "",
    nextMaintenanceDate: row.nextMaintenanceDate ?? "",
    nextVerificationDate: row.nextVerificationDate ?? "",
    notes: row.notes ?? "",
  };
}

export function normalizeAssetForm(form: any) {
  return {
    assetTag: clean(form.assetTag),
    preferredLabelType: clean(form.preferredLabelType) || "qr",
    name: clean(form.name),
    category: clean(form.category) || "Other",
    serialNumber: clean(form.serialNumber),
    supplier: clean(form.supplier),
    purchaseDate: clean(form.purchaseDate),
    purchaseValueCents: inputToCents(form.purchaseValue),
    currency: clean(form.currency) || "CAD",
    fundingSource: clean(form.fundingSource),
    grantRestrictions: clean(form.grantRestrictions),
    retentionUntil: clean(form.retentionUntil),
    disposalRules: clean(form.disposalRules),
    location: clean(form.location),
    condition: clean(form.condition) || "Good",
    status: clean(form.status) || "Available",
    custodianType: clean(form.custodianType),
    custodianName: clean(form.custodianName),
    responsiblePersonName: clean(form.responsiblePersonName),
    expectedReturnDate: clean(form.expectedReturnDate),
    insuranceNotes: clean(form.insuranceNotes),
    capitalized: Boolean(form.capitalized),
    depreciationMethod: clean(form.depreciationMethod),
    usefulLifeMonths: numberOrUndefined(form.usefulLifeMonths),
    bookValueCents: inputToCents(form.bookValue),
    purchaseTransactionId: clean(form.purchaseTransactionId),
    receiptDocumentId: clean(form.receiptDocumentId),
    warrantyExpiresAt: clean(form.warrantyExpiresAt),
    nextMaintenanceDate: clean(form.nextMaintenanceDate),
    nextVerificationDate: clean(form.nextVerificationDate),
    notes: clean(form.notes),
  };
}

export function assetsToCsv(rows: any[]) {
  return rowsToCsv([
    [
      "assetTag",
      "name",
      "category",
      "serialNumber",
      "status",
      "condition",
      "location",
      "custodianName",
      "responsiblePersonName",
      "purchaseDate",
      "purchaseValue",
      "fundingSource",
      "grantRestrictions",
      "insuranceNotes",
      "capitalized",
      "bookValue",
      "nextMaintenanceDate",
      "nextVerificationDate",
      "notes",
    ],
    ...rows.map((row) => [
      row.assetTag,
      row.name,
      row.category,
      row.serialNumber,
      row.status,
      row.condition,
      row.location,
      row.custodianName,
      row.responsiblePersonName,
      row.purchaseDate,
      centsToInput(row.purchaseValueCents),
      row.fundingSource,
      row.grantRestrictions,
      row.insuranceNotes,
      row.capitalized ? "yes" : "no",
      centsToInput(row.bookValueCents),
      row.nextMaintenanceDate,
      row.nextVerificationDate,
      row.notes,
    ]),
  ]);
}

export function parseAssetCsv(input: string) {
  const rows = parseCsv(input);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    return normalizeAssetForm({
      assetTag: record.assetTag,
      name: record.name,
      category: record.category,
      serialNumber: record.serialNumber,
      status: record.status,
      condition: record.condition,
      location: record.location,
      custodianName: record.custodianName,
      responsiblePersonName: record.responsiblePersonName,
      purchaseDate: record.purchaseDate,
      purchaseValue: record.purchaseValue,
      fundingSource: record.fundingSource,
      grantRestrictions: record.grantRestrictions,
      insuranceNotes: record.insuranceNotes,
      capitalized: /^(yes|true|1)$/i.test(record.capitalized ?? ""),
      bookValue: record.bookValue,
      nextMaintenanceDate: record.nextMaintenanceDate,
      nextVerificationDate: record.nextVerificationDate,
      notes: record.notes,
    });
  });
}

export function downloadText(filename: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && String(value ?? "").trim() ? number : undefined;
}
