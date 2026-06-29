/**
 * Shared asset form fields + form-state utilities.
 *
 * Single source of truth for the asset create/edit schema. Every surface that
 * captures an asset (the global quick-create modal launched from the command
 * palette, the inline edit drawer on the Assets page, the edit drawer on the
 * Asset detail page) renders these same fields so the shape and parity are
 * guaranteed.
 *
 * Surfaces own their own form state and pass a `value` + `onChange` patch
 * callback — this component is presentational. Defaults and the dropdown-data
 * hook live here too so callers never re-declare them.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Field } from "../../components/ui";
import { ImageUploadField, type ImageValue } from "../../components/ImageUploadField";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Tabs } from "../../components/primitives";
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_CURRENCIES,
  ASSET_LABEL_TYPES,
  ASSET_STATUSES,
  CUSTODIAN_TYPES,
  money,
  nextAssetTag,
} from "./assetUtils";

export type AssetFormValue = {
  assetTag: string;
  preferredLabelType: string;
  name: string;
  category: string;
  serialNumber: string;
  supplier: string;
  purchaseDate: string;
  purchaseValue: string;
  quantityOnHand: string;
  quantityUnit: string;
  currency: string;
  fundingSource: string;
  grantRestrictions: string;
  retentionUntil: string;
  disposalRules: string;
  location: string;
  condition: string;
  status: string;
  custodianType: string;
  custodianName: string;
  responsiblePersonName: string;
  expectedReturnDate: string;
  insuranceNotes: string;
  capitalized: boolean;
  depreciationMethod: string;
  usefulLifeMonths: string;
  bookValue: string;
  image: ImageValue;
  purchaseTransactionId: string;
  receiptDocumentId: string;
  warrantyExpiresAt: string;
  nextMaintenanceDate: string;
  nextVerificationDate: string;
  notes: string;
};

export type AssetFormInitialValues = Partial<AssetFormValue>;

export function makeAssetFormDefaults(
  initial?: AssetFormInitialValues,
  existingAssets?: any[],
): AssetFormValue {
  return {
    assetTag: initial?.assetTag ?? (existingAssets ? nextAssetTag(existingAssets) : ""),
    preferredLabelType: initial?.preferredLabelType ?? "qr",
    name: initial?.name ?? "",
    category: initial?.category ?? "Program equipment",
    serialNumber: initial?.serialNumber ?? "",
    supplier: initial?.supplier ?? "",
    purchaseDate: initial?.purchaseDate ?? "",
    purchaseValue: initial?.purchaseValue ?? "",
    quantityOnHand: initial?.quantityOnHand ?? "",
    quantityUnit: initial?.quantityUnit ?? "",
    currency: initial?.currency ?? "CAD",
    fundingSource: initial?.fundingSource ?? "",
    grantRestrictions: initial?.grantRestrictions ?? "",
    retentionUntil: initial?.retentionUntil ?? "",
    disposalRules: initial?.disposalRules ?? "",
    location: initial?.location ?? "",
    condition: initial?.condition ?? "Good",
    status: initial?.status ?? "Available",
    custodianType: initial?.custodianType ?? "location",
    custodianName: initial?.custodianName ?? "",
    responsiblePersonName: initial?.responsiblePersonName ?? "",
    expectedReturnDate: initial?.expectedReturnDate ?? "",
    insuranceNotes: initial?.insuranceNotes ?? "",
    capitalized: initial?.capitalized ?? false,
    depreciationMethod: initial?.depreciationMethod ?? "",
    usefulLifeMonths: initial?.usefulLifeMonths ?? "",
    bookValue: initial?.bookValue ?? "",
    image: initial?.image ?? {},
    purchaseTransactionId: initial?.purchaseTransactionId ?? "",
    receiptDocumentId: initial?.receiptDocumentId ?? "",
    warrantyExpiresAt: initial?.warrantyExpiresAt ?? "",
    nextMaintenanceDate: initial?.nextMaintenanceDate ?? "",
    nextVerificationDate: initial?.nextVerificationDate ?? "",
    notes: initial?.notes ?? "",
  };
}

export type AssetFormData = {
  documents: any[] | undefined;
  transactions: any[] | undefined;
  assets: any[] | undefined;
};

/** Load every dropdown source the asset form needs (existing assets are used
 * to derive the next sequential tag). Accepts a nullable societyId so callers
 * can call this above an early-return for still-loading workspaces. */
export function useAssetFormData(societyId: Id<"societies"> | null | undefined): AssetFormData {
  const args = societyId ? { societyId } : "skip";
  const documents = useQuery(api.documents.list, args);
  const transactions = useQuery(
    api.financialHub.transactions,
    societyId ? { societyId, limit: 200 } : "skip",
  );
  const assets = useQuery(api.assets.list, args);
  return { documents, transactions, assets };
}

type NotesTabId = "notes" | "grant" | "insurance" | "disposal";

export function AssetFormFields({
  value,
  onChange,
  data,
  autoFocusName = true,
}: {
  value: AssetFormValue;
  onChange: (patch: Partial<AssetFormValue>) => void;
  data: AssetFormData;
  autoFocusName?: boolean;
}) {
  const { documents, transactions } = data;
  const [activeNotesTab, setActiveNotesTab] = useState<NotesTabId>("notes");
  const receiptDocuments = (documents ?? []).filter(
    (doc: any) =>
      doc.category === "Receipt" ||
      doc.category === "FinancialStatement" ||
      (doc.tags ?? []).some((tag: string) => /receipt|invoice|finance/i.test(tag)),
  );
  const purchaseTransactions = (transactions ?? []).filter((txn: any) => txn.amountCents < 0);

  return (
    <div className="form-grid">
      <div style={{ gridColumn: "1 / -1" }}>
        <ImageUploadField
          label="Photo"
          hint="Upload a picture of the asset, or paste an image URL."
          value={value.image}
          onChange={(image) => onChange({ image })}
        />
      </div>
      <Field label="Asset tag" required>
        <input
          className="input"
          value={value.assetTag}
          onChange={(e) => onChange({ assetTag: e.target.value })}
        />
      </Field>
      <Field label="Preferred label">
        <Select
          value={value.preferredLabelType}
          onChange={(v) => onChange({ preferredLabelType: v })}
          options={ASSET_LABEL_TYPES.map((type) => ({ value: type.value, label: type.label }))}
        />
      </Field>
      <Field label="Name" required>
        <input
          className="input"
          autoFocus={autoFocusName}
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <Field label="Category">
        <Select
          value={value.category}
          onChange={(v) => onChange({ category: v })}
          options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="Serial number">
        <input
          className="input"
          value={value.serialNumber}
          onChange={(e) => onChange({ serialNumber: e.target.value })}
        />
      </Field>
      <Field label="Status">
        <Select
          value={value.status}
          onChange={(v) => onChange({ status: v })}
          options={ASSET_STATUSES.map((s) => ({ value: s, label: s }))}
        />
      </Field>
      <Field label="Condition">
        <Select
          value={value.condition}
          onChange={(v) => onChange({ condition: v })}
          options={ASSET_CONDITIONS.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="Location">
        <input
          className="input"
          value={value.location}
          onChange={(e) => onChange({ location: e.target.value })}
        />
      </Field>
      <Field label="Custodian type">
        <Select
          value={value.custodianType}
          onChange={(v) => onChange({ custodianType: v })}
          options={CUSTODIAN_TYPES.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="Custodian">
        <input
          className="input"
          value={value.custodianName}
          onChange={(e) => onChange({ custodianName: e.target.value })}
        />
      </Field>
      <Field label="Responsible person">
        <input
          className="input"
          value={value.responsiblePersonName}
          onChange={(e) => onChange({ responsiblePersonName: e.target.value })}
        />
      </Field>
      <Field label="Expected return">
        <DatePicker
          value={value.expectedReturnDate}
          onChange={(v) => onChange({ expectedReturnDate: v })}
        />
      </Field>
      <Field label="Supplier">
        <input
          className="input"
          value={value.supplier}
          onChange={(e) => onChange({ supplier: e.target.value })}
        />
      </Field>
      <Field label="Purchase date">
        <DatePicker
          value={value.purchaseDate}
          onChange={(v) => onChange({ purchaseDate: v })}
        />
      </Field>
      <Field label="Purchase value">
        <input
          className="input"
          inputMode="decimal"
          value={value.purchaseValue}
          onChange={(e) => onChange({ purchaseValue: e.target.value })}
        />
      </Field>
      <Field label="Currency">
        <Select
          value={value.currency || "CAD"}
          onChange={(v) => onChange({ currency: v })}
          options={ASSET_CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      {value.category === "Consumable" && (
        <>
          <Field label="Quantity on hand" hint="Starting count for this consumable.">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={value.quantityOnHand}
              onChange={(e) => onChange({ quantityOnHand: e.target.value })}
            />
          </Field>
          <Field label="Unit" hint="e.g. box, each, litre.">
            <input
              className="input"
              value={value.quantityUnit}
              onChange={(e) => onChange({ quantityUnit: e.target.value })}
            />
          </Field>
        </>
      )}
      <Field label="Book value">
        <input
          className="input"
          inputMode="decimal"
          value={value.bookValue}
          onChange={(e) => onChange({ bookValue: e.target.value })}
        />
      </Field>
      <Field label="Purchase receipt">
        <Select
          value={value.receiptDocumentId}
          onChange={(v) => onChange({ receiptDocumentId: v })}
          clearable
          searchable
          clearLabel="No receipt linked"
          options={receiptDocuments.map((doc: any) => ({ value: doc._id, label: doc.title }))}
        />
      </Field>
      <Field label="Finance transaction">
        <Select
          value={value.purchaseTransactionId}
          onChange={(v) => onChange({ purchaseTransactionId: v })}
          clearable
          searchable
          clearLabel="No transaction linked"
          options={purchaseTransactions.map((txn: any) => ({
            value: txn._id,
            label: `${txn.date} · ${txn.description} · ${money(Math.abs(txn.amountCents))}`,
          }))}
        />
      </Field>
      <Field label="Capitalized">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(value.capitalized)}
            onChange={(e) => onChange({ capitalized: e.target.checked })}
          />{" "}
          Track as fixed asset
        </label>
      </Field>
      <Field label="Depreciation">
        <input
          className="input"
          value={value.depreciationMethod}
          onChange={(e) => onChange({ depreciationMethod: e.target.value })}
        />
      </Field>
      <Field label="Useful life months">
        <input
          className="input"
          inputMode="numeric"
          value={value.usefulLifeMonths}
          onChange={(e) => onChange({ usefulLifeMonths: e.target.value })}
        />
      </Field>
      <Field label="Funding source">
        <input
          className="input"
          value={value.fundingSource}
          onChange={(e) => onChange({ fundingSource: e.target.value })}
        />
      </Field>
      <Field label="Retention until">
        <DatePicker
          value={value.retentionUntil}
          onChange={(v) => onChange({ retentionUntil: v })}
        />
      </Field>
      <Field label="Warranty expires">
        <DatePicker
          value={value.warrantyExpiresAt}
          onChange={(v) => onChange({ warrantyExpiresAt: v })}
        />
      </Field>
      <Field label="Next maintenance">
        <DatePicker
          value={value.nextMaintenanceDate}
          onChange={(v) => onChange({ nextMaintenanceDate: v })}
        />
      </Field>
      <Field label="Next verification">
        <DatePicker
          value={value.nextVerificationDate}
          onChange={(v) => onChange({ nextVerificationDate: v })}
        />
      </Field>
      <div className="asset-form__notes">
        <Tabs<NotesTabId>
          value={activeNotesTab}
          onChange={setActiveNotesTab}
          items={[
            { id: "notes", label: "Notes", icon: filledDot(value.notes) },
            { id: "grant", label: "Grant restrictions", icon: filledDot(value.grantRestrictions) },
            { id: "insurance", label: "Insurance notes", icon: filledDot(value.insuranceNotes) },
            { id: "disposal", label: "Disposal rules", icon: filledDot(value.disposalRules) },
          ]}
        />
        <div className="asset-form__notes-panel">
          {activeNotesTab === "notes" && (
            <MarkdownEditor
              rows={3}
              value={value.notes}
              onChange={(markdown) => onChange({ notes: markdown })}
            />
          )}
          {activeNotesTab === "grant" && (
            <MarkdownEditor
              rows={3}
              value={value.grantRestrictions}
              onChange={(markdown) => onChange({ grantRestrictions: markdown })}
            />
          )}
          {activeNotesTab === "insurance" && (
            <MarkdownEditor
              rows={3}
              value={value.insuranceNotes}
              onChange={(markdown) => onChange({ insuranceNotes: markdown })}
            />
          )}
          {activeNotesTab === "disposal" && (
            <MarkdownEditor
              rows={3}
              value={value.disposalRules}
              onChange={(markdown) => onChange({ disposalRules: markdown })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function filledDot(content: string | undefined) {
  if (!content?.trim()) return undefined;
  return (
    <span
      aria-label="has content"
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--accent-9, #3b82f6)",
      }}
    />
  );
}
