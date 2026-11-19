import { useMemo } from "react";
import { Link } from "react-router-dom";
import { MapPin, Plus } from "lucide-react";
import { Badge, Field } from "../../components/ui";
import { InfoPopover } from "../../components/InfoPopover";
import { optionLabel } from "../../lib/orgHubOptions";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import { jurisdictionDisplayCopy } from "../../../shared/jurisdictionWorkspace";
import { DetailSection, RowActions } from "./DetailDrawers";
import { addressLine, findCurrentAddress } from "./detailRows";
import { detailOptions } from "./registerTables";
import type { AddressRow, DetailRecord, OrganizationDetail, ProfileForm, SetProfileField } from "./types";

const ADDRESSES_TABLE = staticRecordTable({
  id: "organization-details:addresses",
  nameSingular: "organizationAddress",
  namePlural: "organizationAddresses",
  labelSingular: "Address",
  labelPlural: "Addresses",
  labelIdentifierFieldName: "address",
  fields: [
    { name: "type", label: "Type", fieldType: FIELD_TYPES.SELECT, size: 150, config: { options: detailOptions("addressTypes") } },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 110, config: { options: detailOptions("addressStatuses", (value) => (value === "current" ? "green" : "gray")) } },
    { name: "address", label: "Address", fieldType: FIELD_TYPES.TEXT, size: 320, config: { groupable: false } },
    { name: "effectiveFrom", label: "Effective from", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "effectiveTo", label: "Until", fieldType: FIELD_TYPES.DATE, size: 120 },
  ],
});

type OfficesProps = {
  form: ProfileForm;
  set: SetProfileField;
  detail: OrganizationDetail | undefined;
  onAddAddress: () => void;
  onEditAddress: (row: AddressRow) => void;
  onRemoveAddress: (row: AddressRow) => void;
  onBackfill: () => void;
};

/** Offices & contacts: the addresses register and the profile's contact fields. */
export function OfficesTab({ form, set, detail, onAddAddress, onEditAddress, onRemoveAddress, onBackfill }: OfficesProps) {
  const jurisdictionCopy = jurisdictionDisplayCopy(form);
  const addresses = detail?.addresses ?? [];
  const records = useMemo<DetailRecord<AddressRow>[]>(
    () => (detail?.addresses ?? []).map((row) => ({
      _id: row._id,
      row,
      type: row.type ?? "",
      status: row.status ?? "",
      address: addressLine(row),
      effectiveFrom: row.effectiveFrom ?? null,
      effectiveTo: row.effectiveTo ?? null,
    })),
    [detail?.addresses],
  );
  // Older profiles kept these as plain text. Until the backfill copies them
  // into the register, show them so the page doesn't read as empty.
  const legacy = detail === undefined ? [] : [
    { label: "Registered office", text: form.registeredOfficeAddress, row: findCurrentAddress(addresses, "registered_office"), hint: jurisdictionCopy.registeredOfficeHint },
    { label: "Mailing address", text: form.mailingAddress, row: findCurrentAddress(addresses, "mailing"), hint: undefined },
  ].filter((item) => !item.row && item.text?.trim());
  return (
    <div className="org-profile-panel">
      <DetailSection
        id="registered-office"
        icon={<MapPin size={14} />}
        title="Addresses"
        count={addresses.length}
        action={<button className="btn-action btn-action--primary" type="button" onClick={onAddAddress}><Plus size={12} /> Address</button>}
      >
        {legacy.length > 0 && (
          <div className="society-address-list org-profile-legacy-addresses">
            {legacy.map((item) => (
              <div className="society-address-item" key={item.label}>
                <div className="society-address-item__head">
                  <strong>{item.label}</strong>
                  {item.hint && <InfoPopover label={`About the ${item.label.toLowerCase()}`}><p>{item.hint}</p></InfoPopover>}
                  <Badge tone="warn">Legacy</Badge>
                </div>
                <div className="society-address-item__line">{item.text}</div>
              </div>
            ))}
          </div>
        )}
        <RecordListTable<DetailRecord<AddressRow>>
          variant="card"
          table={ADDRESSES_TABLE}
          tableId="organization-addresses"
          label="Addresses"
          records={records}
          loading={detail === undefined}
          onOpen={(record) => onEditAddress(record.row)}
          renderCell={({ record, field }) => {
            const { row } = record;
            if (field.name === "type") return <span>{optionLabel("addressTypes", row.type)}</span>;
            if (field.name === "status") return <Badge tone={row.status === "current" ? "success" : "neutral"}>{optionLabel("addressStatuses", row.status)}</Badge>;
            return undefined;
          }}
          renderRowActions={(record) => <RowActions onEdit={() => onEditAddress(record.row)} onRemove={() => onRemoveAddress(record.row)} />}
          emptyState={<RecordTableEmpty title="No addresses yet" />}
        />
      </DetailSection>

      <section className="card" aria-labelledby="org-contacts">
        <div className="card__head"><h2 className="card__title" id="org-contacts">Contacts</h2></div>
        <div className="card__body">
          <Field label="Registry notification email" hint="Where registry emails and filing reminders go.">
            <input className="input" type="email" value={form.officialEmail ?? ""} onChange={(e) => set("officialEmail", e.target.value)} />
          </Field>
          <div className="society-field-grid">
            <Field label={jurisdictionCopy.privacyOfficerLabel}>
              <input className="input" value={form.privacyOfficerName ?? ""} onChange={(e) => set("privacyOfficerName", e.target.value)} />
            </Field>
            <Field label="Privacy officer email">
              <input className="input" type="email" value={form.privacyOfficerEmail ?? ""} onChange={(e) => set("privacyOfficerEmail", e.target.value)} />
            </Field>
          </div>
          <p className="muted org-profile-card-note">
            The filing contact and minute book location are kept in <Link to="/app/compliance-settings">Compliance settings</Link>.
          </p>
        </div>
      </section>

      <div className="org-details-backfill">
        <span className="muted">Older profiles kept addresses and minute-book items as plain fields. Copy them into the records above.</span>
        <button className="btn btn--sm" type="button" onClick={onBackfill}>Backfill records</button>
      </div>
    </div>
  );
}
