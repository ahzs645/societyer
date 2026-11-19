import { useMemo } from "react";
import { KeyRound, Plus } from "lucide-react";
import { Badge, type ToneVariant } from "../../components/ui";
import { TooltipCopyable } from "../../components/TooltipCopyable";
import { GstAccountReference } from "../../components/GstAccountReference";
import { TaxEvidenceFields, TaxStatusSelect, type TaxStatusField } from "../../components/EntitySetupFields";
import { optionLabel } from "../../lib/orgHubOptions";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import { homeJurisdictionCode } from "../../../shared/organizationDomain";
import { DetailSection, RowActions } from "./DetailDrawers";
import { isBcJurisdiction, isExtraProvincialRegistration, isSecretIdentifier, mask, primaryIdentifier, TAX_IDENTIFIER_KINDS } from "./detailRows";
import { detailOptions } from "./registerTables";
import type { DetailRecord, IdentifierRow, OrganizationDetail, ProfileForm, SetProfileField } from "./types";

const IDENTIFIERS_TABLE = staticRecordTable({
  id: "organization-details:identifiers",
  nameSingular: "organizationIdentifier",
  namePlural: "organizationIdentifiers",
  labelSingular: "Identifier",
  labelPlural: "Identifiers",
  labelIdentifierFieldName: "kind",
  fields: [
    { name: "kind", label: "Kind", fieldType: FIELD_TYPES.SELECT, size: 200, config: { options: detailOptions("taxNumberTypes") } },
    { name: "number", label: "Number", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "jurisdiction", label: "Jurisdiction", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "status", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: detailOptions("identifierStatuses", (value) => (value === "active" ? "green" : "amber")) } },
  ],
});

/** The kinds the Tax tab adds from its rows. */
export type TaxIdentifierKind = "business_number" | "income_tax" | "gst" | "pst" | "payroll";

type Program = { kind: TaxIdentifierKind; label: string; statusField?: TaxStatusField; bcOnly?: boolean };

/** One row per CRA program account, plus BC PST where BC is relevant. */
const PROGRAMS: readonly Program[] = [
  { kind: "income_tax", label: "Corporation income tax (RC)", statusField: "craRcStatus" },
  { kind: "gst", label: "GST/HST (RT)", statusField: "gstHstStatus" },
  { kind: "pst", label: "BC PST", bcOnly: true },
  { kind: "payroll", label: "Payroll (RP)", statusField: "payrollStatus" },
];

type TaxProps = {
  form: ProfileForm;
  set: SetProfileField;
  detail: OrganizationDetail | undefined;
  canEdit: boolean;
  /** Opens the identifier drawer for a new row of this kind. */
  onNewIdentifier: (kind: TaxIdentifierKind | "other") => void;
  onEditIdentifier: (row: IdentifierRow) => void;
  onRemoveIdentifier: (row: IdentifierRow) => void;
};

function IdentifierNumber({ row, label }: { row: IdentifierRow | undefined; label: string }) {
  if (!row?.number) return <span className="muted">—</span>;
  if (row.accessLevel === "restricted" || isSecretIdentifier(row)) return <span className="mono">{mask(row.number)}</span>;
  return <TooltipCopyable value={row.number} label={label} />;
}

/** PST has no status field: whether a registration is recorded is the status. */
function pstStatus(row: IdentifierRow | undefined): { label: string; tone: ToneVariant } {
  if (!row) return { label: "Not recorded", tone: "neutral" };
  if (row.status === "active") return { label: "Registered", tone: "success" };
  return { label: optionLabel("identifierStatuses", row.status), tone: "warn" };
}

/** Tax accounts: the BN, one row per program account, and the other identifiers. */
export function TaxTab({ form, set, detail, canEdit, onNewIdentifier, onEditIdentifier, onRemoveIdentifier }: TaxProps) {
  const identifiers = detail?.identifiers ?? [];
  const bcRelevant = isBcJurisdiction(homeJurisdictionCode(form))
    || (detail?.registrations ?? []).some((row) => isExtraProvincialRegistration(row) && row.status !== "inactive" && isBcJurisdiction(row.jurisdiction));
  const programs = PROGRAMS.filter((program) => !program.bcOnly || bcRelevant);
  const open = (kind: TaxIdentifierKind, row: IdentifierRow | undefined) => (row ? onEditIdentifier(row) : onNewIdentifier(kind));
  const bn = primaryIdentifier(identifiers, "business_number");
  return (
    <div className="org-profile-panel" id="tax-identifiers">
      <section className="card" aria-labelledby="org-business-number">
        <div className="card__head">
          <h2 className="card__title" id="org-business-number">CRA business number</h2>
        </div>
        <div className="card__body">
          <div className="org-tax-rows">
            <div className="org-tax-row">
              <span className="org-tax-row__label">Business number (BN)</span>
              <span className="org-tax-row__number"><IdentifierNumber row={bn} label="business number" /></span>
              <span className="org-tax-row__status"><TaxStatusSelect form={form} set={set} field="craBnStatus" ariaLabel="Business number status" /></span>
              <span className="org-tax-row__action"><button className="btn btn--sm" type="button" onClick={() => open("business_number", bn)}>{bn ? "Edit" : <><Plus size={12} /> Add</>}</button></span>
            </div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="org-program-accounts">
        <div className="card__head"><h2 className="card__title" id="org-program-accounts">Program accounts</h2></div>
        <div className="card__body">
          <div className="org-tax-rows">
            {programs.map((program) => {
              const row = primaryIdentifier(identifiers, program.kind);
              const derived = program.statusField ? undefined : pstStatus(row);
              return (
                <div className="org-tax-row" key={program.kind}>
                  <span className="org-tax-row__label">{program.label}</span>
                  <span className="org-tax-row__number"><IdentifierNumber row={row} label={`${program.label} number`} /></span>
                  <span className="org-tax-row__status">
                    {program.statusField
                      ? <TaxStatusSelect form={form} set={set} field={program.statusField} ariaLabel={`${program.label} status`} />
                      : derived && <Badge tone={derived.tone}>{derived.label}</Badge>}
                  </span>
                  <span className="org-tax-row__action"><button className="btn btn--sm" type="button" onClick={() => open(program.kind, row)}>{row ? "Edit" : <><Plus size={12} /> Add</>}</button></span>
                </div>
              );
            })}
          </div>
          <TaxEvidenceFields form={form} set={set} />
        </div>
      </section>

      <GstAccountReference identifiers={detail?.identifiers} actions={canEdit ? (
        <button className="btn-action btn-action--primary" type="button" onClick={() => onNewIdentifier("gst")}><Plus size={12} /> Add GST/HST account</button>
      ) : undefined} />

      <OtherIdentifiers identifiers={identifiers} loading={detail === undefined} onAdd={() => onNewIdentifier("other")} onEdit={onEditIdentifier} onRemove={onRemoveIdentifier} />
    </div>
  );
}

function OtherIdentifiers({ identifiers, loading, onAdd, onEdit, onRemove }: {
  identifiers: readonly IdentifierRow[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (row: IdentifierRow) => void;
  onRemove: (row: IdentifierRow) => void;
}) {
  // Registry keys are passwords: they never list here. Their registration card shows whether one is stored.
  const rows = useMemo(() => identifiers.filter((row) => !TAX_IDENTIFIER_KINDS.has(row.kind ?? "") && !isSecretIdentifier(row)), [identifiers]);
  const records = useMemo<DetailRecord<IdentifierRow>[]>(
    () => rows.map((row) => ({
      _id: row._id,
      row,
      kind: row.kind ?? "",
      // A restricted number is searched and sorted by its masked form only.
      number: row.accessLevel === "restricted" ? mask(row.number) : row.number ?? "",
      jurisdiction: row.foreignJurisdiction || row.jurisdiction || "",
      status: row.status ?? "",
    })),
    [rows],
  );
  return (
    <DetailSection
      icon={<KeyRound size={14} />}
      title="Other identifiers"
      count={rows.length}
      action={<button className="btn-action btn-action--primary" type="button" onClick={onAdd}><Plus size={12} /> Identifier</button>}
    >
      <RecordListTable<DetailRecord<IdentifierRow>>
        variant="card"
        table={IDENTIFIERS_TABLE}
        tableId="organization-identifiers"
        label="Other identifiers"
        records={records}
        loading={loading}
        onOpen={(record) => onEdit(record.row)}
        renderCell={({ record, field }) => {
          const { row } = record;
          if (field.name === "kind") return <span>{optionLabel("taxNumberTypes", row.kind)}</span>;
          if (field.name === "number")
            return row.accessLevel === "restricted" || !row.number
              ? <span className="mono">{row.accessLevel === "restricted" ? mask(row.number) : row.number}</span>
              : <TooltipCopyable value={row.number} label={`${optionLabel("taxNumberTypes", row.kind)} number`} />;
          if (field.name === "status") return <Badge tone={row.accessLevel === "restricted" ? "danger" : row.status === "active" ? "success" : "warn"}>{optionLabel("identifierStatuses", row.status)}</Badge>;
          return undefined;
        }}
        renderRowActions={(record) => <RowActions onEdit={() => onEdit(record.row)} onRemove={() => onRemove(record.row)} />}
        emptyState={<RecordTableEmpty title="No other identifiers" description="Charity, registry account and other numbers go here." />}
      />
    </DetailSection>
  );
}
