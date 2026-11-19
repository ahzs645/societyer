import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Landmark, Plus, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui";
import { TooltipCopyable } from "../../components/TooltipCopyable";
import { formatDate } from "../../lib/format";
import { optionLabel } from "../../lib/orgHubOptions";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import { jurisdictionModuleContract } from "../../../shared/jurisdictionWorkspace";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, isPreparingIncorporation } from "../../../shared/organizationDomain";
import { DetailSection, RowActions } from "./DetailDrawers";
import { isExtraProvincialRegistration, isHomeRegistration, monthDayLabel, SECRET_IDENTIFIER_KINDS } from "./detailRows";
import { detailOptions } from "./registerTables";
import { profileStatus } from "./status";
import type { DetailRecord, IdentifierRow, OrganizationDetail, OrganizationRecord, ProfileForm, RegistrationRow } from "./types";

const REGISTRATIONS_TABLE = staticRecordTable({
  id: "organization-details:registrations",
  nameSingular: "organizationRegistration",
  namePlural: "organizationRegistrations",
  labelSingular: "Registration",
  labelPlural: "Registrations",
  labelIdentifierFieldName: "jurisdiction",
  fields: [
    { name: "jurisdiction", label: "Jurisdiction", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "registration", label: "Registration", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "registrationDate", label: "Registered", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "activityCommencementDate", label: "Business started", fieldType: FIELD_TYPES.DATE, size: 140 },
    { name: "deRegistrationDate", label: "Ended", fieldType: FIELD_TYPES.DATE, size: 120, isVisible: false },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: detailOptions("registrationStatuses", (value) => (value === "active" ? "green" : "amber")) } },
  ],
});

type RegistrationsProps = {
  society: OrganizationRecord;
  form: ProfileForm;
  detail: OrganizationDetail | undefined;
  onAdd: () => void;
  onEdit: (row: RegistrationRow) => void;
  onRemove: (row: RegistrationRow) => void;
};

/** Registrations: the home registration, one card per extra-provincial registration, and a table for the rest. */
export function RegistrationsTab({ society, form, detail, onAdd, onEdit, onRemove }: RegistrationsProps) {
  const registrations = detail?.registrations ?? [];
  const identifiers = detail?.identifiers ?? [];
  const home = registrations.find(isHomeRegistration);
  const extraProvincial = registrations.filter(isExtraProvincialRegistration);
  const others = registrations.filter((row) => !isHomeRegistration(row) && !isExtraProvincialRegistration(row));
  return (
    <div className="org-profile-panel">
      <div className="org-profile-panel__actions">
        <button className="btn btn--sm" type="button" onClick={onAdd}><Plus size={12} /> Registration</button>
      </div>
      <div className="org-profile-grid">
        <HomeRegistrationCard society={society} form={form} row={home} identifiers={identifiers} onEdit={onEdit} />
        {extraProvincial.map((row) => (
          <ExtraProvincialCard key={row._id} row={row} identifiers={identifiers} onEdit={() => onEdit(row)} onRemove={() => onRemove(row)} />
        ))}
      </div>
      <OtherRegistrations rows={others} loading={detail === undefined} onAdd={onAdd} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function Missing({ children = "Not recorded" }: { children?: ReactNode }) {
  return <span className="muted">{children}</span>;
}

function sameJurisdiction(a?: string, b?: string) {
  return canonicalizeJurisdictionCode(a) === canonicalizeJurisdictionCode(b);
}

/** A registry key is a password: only whether one is stored shows, never its value. */
function KeyState({ stored, label }: { stored: boolean; label: string }) {
  return stored
    ? <span><span className="mono" aria-label={`${label} stored`}>••••••</span> stored · <Link to="/app/access-custody">Access custody</Link></span>
    : <span><span className="muted">Not stored</span> · <Link to="/app/access-custody">Store it in Access custody</Link></span>;
}

function HomeRegistrationCard({ society, form, row, identifiers, onEdit }: {
  society: OrganizationRecord;
  form: ProfileForm;
  row: RegistrationRow | undefined;
  identifiers: readonly IdentifierRow[];
  onEdit: (row: RegistrationRow) => void;
}) {
  const registry = jurisdictionModuleContract(form).registryPortalLabel;
  const status = profileStatus(society);
  const home = homeJurisdictionCode(society);
  const keyStored = Boolean(society.corporationKeyVaultItemId) || identifiers.some((identifier) =>
    identifier.kind === "corporation_key" || (SECRET_IDENTIFIER_KINDS.has(identifier.kind ?? "") && sameJurisdiction(identifier.jurisdiction, home)));
  const showKey = keyStored || (isCorporation(society) && !isPreparingIncorporation(society));
  const anniversary = society.anniversaryDate || society.incorporationDate;
  return (
    <section className="card" aria-labelledby="org-home-registration">
      <div className="card__head">
        <h2 className="card__title" id="org-home-registration">{registry}</h2>
        <Badge>Home</Badge>
        <Badge tone={status.tone}>{status.label}</Badge>
        {row && <button className="btn btn--ghost btn--sm org-profile-card-link" type="button" onClick={() => onEdit(row)}>Edit</button>}
      </div>
      <div className="card__body">
        <dl className="org-profile-kv">
          <Fact label="Corporation no.">{society.incorporationNumber ? <TooltipCopyable value={society.incorporationNumber} label="corporation number" /> : <Missing>Not assigned yet</Missing>}</Fact>
          <Fact label="Incorporated">{society.incorporationDate ? formatDate(society.incorporationDate) : <Missing>Not incorporated yet</Missing>}</Fact>
          <Fact label="Anniversary">{anniversary ? monthDayLabel(anniversary) : <Missing>Not set</Missing>}</Fact>
          {showKey && <Fact label="Corporation key"><KeyState stored={keyStored} label="Corporation key" /></Fact>}
          {row?.registrationNumber && row.registrationNumber !== society.incorporationNumber && <Fact label="Registration no."><TooltipCopyable value={row.registrationNumber} label="registration number" /></Fact>}
          {row?.registrationDate && row.registrationDate !== society.incorporationDate && <Fact label="Registered">{formatDate(row.registrationDate)}</Fact>}
          {row?.lastAnnualReturnFiledDate && <Fact label="Last annual return">{formatDate(row.lastAnnualReturnFiledDate)}</Fact>}
          {row?.annualReturnDueDate && <Fact label="Annual return due">{formatDate(row.annualReturnDueDate)}</Fact>}
        </dl>
        <p className="muted org-profile-card-note">The number, date and anniversary are edited on the Legal profile.</p>
      </div>
    </section>
  );
}

function ExtraProvincialCard({ row, identifiers, onEdit, onRemove }: {
  row: RegistrationRow;
  identifiers: readonly IdentifierRow[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const place = optionLabel("entityJurisdictions", row.jurisdiction);
  const headingId = `org-registration-${row._id}`;
  const keyStored = Boolean(row.companyKeyVaultItemId) || identifiers.some((identifier) =>
    identifier.kind !== "corporation_key" && SECRET_IDENTIFIER_KINDS.has(identifier.kind ?? "") && sameJurisdiction(identifier.jurisdiction, row.jurisdiction));
  const agent = [row.agentForServiceName, row.agentForServiceAddress].filter(Boolean).join(", ");
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card__head">
        <h2 className="card__title" id={headingId}>{place}</h2>
        <Badge>Extra-provincial</Badge>
        <Badge tone={row.status === "active" ? "success" : "warn"}>{optionLabel("registrationStatuses", row.status)}</Badge>
        <div className="row org-row-actions org-profile-card-link">
          <button className="btn btn--ghost btn--sm" type="button" onClick={onEdit}>Edit</button>
          <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`Remove the ${place} registration`} onClick={onRemove}><Trash2 size={12} /></button>
        </div>
      </div>
      <div className="card__body">
        <dl className="org-profile-kv">
          <Fact label="Registration no.">{row.registrationNumber ? <TooltipCopyable value={row.registrationNumber} label={`${place} registration number`} /> : <Missing />}</Fact>
          <Fact label="Registered">{row.registrationDate ? formatDate(row.registrationDate) : <Missing />}</Fact>
          <Fact label="Home jurisdiction">{row.homeJurisdiction ? optionLabel("entityJurisdictions", row.homeJurisdiction) : <Missing />}</Fact>
          {row.assumedName && <Fact label="Assumed name">{row.assumedName}</Fact>}
          <Fact label="Agent or attorney">{agent ? <span className="org-profile-kv__wrap">{agent}</span> : <Missing>None recorded</Missing>}</Fact>
          <Fact label="Principal office">{row.principalOfficeAddress ? <span className="org-profile-kv__wrap">{row.principalOfficeAddress}</span> : <Missing />}</Fact>
          <Fact label="Annual return due">{row.annualReturnDueDate ? formatDate(row.annualReturnDueDate) : <Missing>Not set</Missing>}</Fact>
          <Fact label="Last filed">{row.lastAnnualReturnFiledDate ? formatDate(row.lastAnnualReturnFiledDate) : <Missing>Not yet</Missing>}</Fact>
          {keyStored && <Fact label="Company key"><KeyState stored label="Company key" /></Fact>}
        </dl>
      </div>
    </section>
  );
}

function OtherRegistrations({ rows, loading, onAdd, onEdit, onRemove }: {
  rows: readonly RegistrationRow[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (row: RegistrationRow) => void;
  onRemove: (row: RegistrationRow) => void;
}) {
  const records = useMemo<DetailRecord<RegistrationRow>[]>(
    () => rows.map((row) => ({
      _id: row._id,
      row,
      jurisdiction: optionLabel("entityJurisdictions", row.jurisdiction),
      registration: [row.assumedName || "Legal name", row.registrationNumber, row.nuansNumber ? `NUANS ${row.nuansNumber}` : ""].filter(Boolean).join(" · "),
      registrationDate: row.registrationDate ?? null,
      activityCommencementDate: row.activityCommencementDate ?? null,
      deRegistrationDate: row.deRegistrationDate ?? null,
      status: row.status ?? "",
    })),
    [rows],
  );
  return (
    <DetailSection
      icon={<Landmark size={14} />}
      title="Business names, licences and branches"
      count={rows.length}
      action={<button className="btn-action btn-action--primary" type="button" onClick={onAdd}><Plus size={12} /> Registration</button>}
    >
      <RecordListTable<DetailRecord<RegistrationRow>>
        variant="card"
        table={REGISTRATIONS_TABLE}
        tableId="organization-registrations"
        label="Business names, licences and branches"
        records={records}
        loading={loading}
        onOpen={(record) => onEdit(record.row)}
        renderCell={({ record, field }) => {
          const { row } = record;
          if (field.name === "jurisdiction")
            return (
              <span className="record-table__identifier-lines">
                <strong className="record-table__identifier-primary">{optionLabel("entityJurisdictions", row.jurisdiction)}</strong>
                <span className="record-table__identifier-secondary">{optionLabel("registrationTypes", row.registrationType)}</span>
              </span>
            );
          if (field.name === "registration")
            return (
              <span className="record-table__identifier-lines">
                <strong className="record-table__identifier-primary">{row.assumedName || "Legal name"}</strong>
                <span className="record-table__identifier-secondary mono">{row.registrationNumber ? <TooltipCopyable value={row.registrationNumber} label="registration number" /> : "No number"}{row.nuansNumber ? ` · NUANS ${row.nuansNumber}` : ""}</span>
              </span>
            );
          if (field.name === "status") return <Badge tone={row.status === "active" ? "success" : "warn"}>{optionLabel("registrationStatuses", row.status)}</Badge>;
          return undefined;
        }}
        renderRowActions={(record) => <RowActions onEdit={() => onEdit(record.row)} onRemove={() => onRemove(record.row)} />}
        emptyState={<RecordTableEmpty title="No business names, licences or branches yet" />}
      />
    </DetailSection>
  );
}
