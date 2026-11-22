import { useMemo, useState } from "react";
import { KeyRound, Plus, X } from "lucide-react";
import { Menu } from "@/components/Menu";
import { Badge, type ToneVariant } from "../../components/ui";
import { TooltipCopyable } from "../../components/TooltipCopyable";
import { TaxEvidenceFields, TaxStatusSelect, type TaxStatusField } from "../../components/EntitySetupFields";
import { optionLabel } from "../../lib/orgHubOptions";
import { calendarDateKey } from "../../lib/calendarDates";
import { organizationGstAccountReference } from "../../../shared/gstAccountReference";
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

type Program = { kind: TaxIdentifierKind; label: string; copyLabel: string; statusField?: TaxStatusField; bcOnly?: boolean; optional?: boolean; hint?: string };

/**
 * The business number, one row per CRA program account, and BC PST where BC
 * is relevant. Optional accounts show once added, recorded or registered:
 * an organization with no employees never sees a Payroll row.
 */
const PROGRAMS: readonly Program[] = [
  { kind: "business_number", label: "Business number (BN)", copyLabel: "business number", statusField: "craBnStatus" },
  { kind: "income_tax", label: "Corporation income tax (RC)", copyLabel: "corporation income tax account", statusField: "craRcStatus" },
  { kind: "gst", label: "GST/HST (RT)", copyLabel: "organization GST/HST account", statusField: "gstHstStatus", optional: true, hint: "Once taxable sales pass $30,000 in four quarters" },
  { kind: "pst", label: "BC PST", copyLabel: "BC PST number", bcOnly: true, optional: true, hint: "Selling or leasing taxable goods or services in BC" },
  { kind: "payroll", label: "Payroll (RP)", copyLabel: "payroll account", statusField: "payrollStatus", optional: true, hint: "Before the first payday for employees" },
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

/** Tax accounts: one card for the BN and program accounts, and the other identifiers. */
export function TaxTab({ form, set, detail, canEdit, onNewIdentifier, onEditIdentifier, onRemoveIdentifier }: TaxProps) {
  const identifiers = detail?.identifiers ?? [];
  const bcRelevant = isBcJurisdiction(homeJurisdictionCode(form))
    || (detail?.registrations ?? []).some((row) => isExtraProvincialRegistration(row) && row.status !== "inactive" && isBcJurisdiction(row.jurisdiction));
  const applicable = PROGRAMS.filter((program) => !program.bcOnly || bcRelevant);
  // Optional accounts added this visit, before a number or status is saved.
  const [added, setAdded] = useState<ReadonlySet<TaxIdentifierKind>>(() => new Set());
  const statusOf = (program: Program) => (program.statusField ? form[program.statusField] : undefined);
  const inUse = (program: Program) => !program.optional
    || added.has(program.kind)
    || Boolean(primaryIdentifier(identifiers, program.kind))
    || statusOf(program) === "pending" || statusOf(program) === "confirmed";
  const programs = applicable.filter(inUse);
  const addable = applicable.filter((program) => !inUse(program));
  const notNeeded = addable.filter((program) => statusOf(program) === "not_required");
  const addProgram = (program: Program) => {
    setAdded((current) => new Set([...current, program.kind]));
    if (program.statusField && statusOf(program) === "not_required") set(program.statusField, "unknown");
  };
  const removeProgram = (program: Program) => {
    setAdded((current) => new Set([...current].filter((kind) => kind !== program.kind)));
    if (program.statusField) set(program.statusField, "not_required");
  };
  const open = (kind: TaxIdentifierKind, row: IdentifierRow | undefined) => (row ? onEditIdentifier(row) : onNewIdentifier(kind));
  const gstReference = detail ? organizationGstAccountReference(identifiers, calendarDateKey(new Date())) : undefined;
  // The GST row shows the number; only a problem with the account needs words under it.
  const gstWarning = gstReference && gstReference.status !== "ready" && gstReference.status !== "missing" ? gstReference.message : undefined;
  return (
    <div className="org-profile-panel" id="tax-identifiers">
      <section className="card" aria-labelledby="org-cra-accounts">
        <div className="card__head">
          <h2 className="card__title" id="org-cra-accounts">CRA accounts</h2>
          {canEdit && addable.length > 0 && (
            <Menu
              align="right"
              described
              sheetTitle="Add a tax account"
              trigger={<button className="btn btn--sm org-profile-card-link" type="button"><Plus size={12} /> Account</button>}
              sections={[{ id: "accounts", items: addable.map((program) => ({ id: program.kind, label: program.label, hint: program.hint, onSelect: () => addProgram(program) })) }]}
            />
          )}
        </div>
        <div className="card__body">
          <div className="org-tax-rows">
            {programs.map((program) => {
              const row = primaryIdentifier(identifiers, program.kind);
              const derived = program.statusField ? undefined : pstStatus(row);
              return (
                <div className="org-tax-row" key={program.kind} data-testid={program.kind === "gst" ? "gst-account-reference" : undefined}>
                  <span className="org-tax-row__label">{program.label}</span>
                  <span className="org-tax-row__number"><IdentifierNumber row={row} label={program.copyLabel} /></span>
                  <span className="org-tax-row__status">
                    {program.statusField
                      ? <TaxStatusSelect form={form} set={set} field={program.statusField} ariaLabel={`${program.label} status`} />
                      : derived && <Badge tone={derived.tone}>{derived.label}</Badge>}
                  </span>
                  <span className="org-tax-row__action">
                    {canEdit && (
                      <button className="btn btn--sm" type="button" aria-label={`${row ? "Edit" : "Add"} ${program.label}`} onClick={() => open(program.kind, row)}>
                        {row ? "Edit" : <><Plus size={12} /> Add</>}
                      </button>
                    )}
                    {/* An optional account with nothing recorded can go: it is marked not needed. */}
                    {canEdit && program.optional && !row && (
                      <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`Not needed: remove ${program.label}`} title="Not needed" onClick={() => removeProgram(program)}>
                        <X size={12} />
                      </button>
                    )}
                  </span>
                  {program.kind === "gst" && gstWarning && <p className="org-tax-row__note muted" role="status">{gstWarning}</p>}
                </div>
              );
            })}
          </div>
          {notNeeded.length > 0 && <p className="muted org-tax-not-needed">Not needed: {notNeeded.map((program) => program.label).join(", ")}.</p>}
          <TaxEvidenceFields form={form} set={set} />
        </div>
      </section>

      <OtherIdentifiers identifiers={identifiers} loading={detail === undefined} canEdit={canEdit} onAdd={() => onNewIdentifier("other")} onEdit={onEditIdentifier} onRemove={onRemoveIdentifier} />
    </div>
  );
}

function OtherIdentifiers({ identifiers, loading, canEdit, onAdd, onEdit, onRemove }: {
  identifiers: readonly IdentifierRow[];
  loading: boolean;
  canEdit: boolean;
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
      action={canEdit ? <button className="btn-action btn-action--primary" type="button" onClick={onAdd}><Plus size={12} /> Identifier</button> : undefined}
    >
      {/* An empty table with its toolbar is a lot of page for nothing: one line says it. */}
      {!loading && rows.length === 0 ? (
        <div className="card__body"><p className="muted org-profile-empty">None recorded. Charity, registry account and other numbers go here.</p></div>
      ) : <RecordListTable<DetailRecord<IdentifierRow>>
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
      />}
    </DetailSection>
  );
}
