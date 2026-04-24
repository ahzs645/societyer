import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { OptionSelect } from "../components/OptionSelect";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Building2, KeyRound, Landmark, MapPin, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";

type DrawerKind = "address" | "registration" | "identifier";
type LifecycleDateKey = "incorporationDate" | "continuanceDate" | "amalgamationDate" | "archivedAtISO" | "removedAtISO";

const LIFECYCLE_DATE_TYPES: { value: LifecycleDateKey; label: string }[] = [
  { value: "incorporationDate", label: "Incorporation date" },
  { value: "continuanceDate", label: "Continuance date" },
  { value: "amalgamationDate", label: "Amalgamation date" },
  { value: "archivedAtISO", label: "Archived date" },
  { value: "removedAtISO", label: "Removed date" },
];

export function OrganizationDetailsPage() {
  const society = useSociety();
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip");
  const upsertSociety = useMutation(api.society.upsert);
  const backfillRecords = useMutation(api.organizationDetails.backfillFromExistingRecords);
  const upsertAddress = useMutation(api.organizationDetails.upsertAddress);
  const removeAddress = useMutation(api.organizationDetails.removeAddress);
  const upsertRegistration = useMutation(api.organizationDetails.upsertRegistration);
  const removeRegistration = useMutation(api.organizationDetails.removeRegistration);
  const upsertIdentifier = useMutation(api.organizationDetails.upsertIdentifier);
  const removeIdentifier = useMutation(api.organizationDetails.removeIdentifier);
  const confirm = useConfirm();
  const toast = useToast();

  const [profile, setProfile] = useState<any>(null);
  const [drawerKind, setDrawerKind] = useState<DrawerKind | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [autoBackfilledSocietyId, setAutoBackfilledSocietyId] = useState<string | null>(null);
  const [addingLifecycleDate, setAddingLifecycleDate] = useState(false);
  const [lifecycleDateType, setLifecycleDateType] = useState<LifecycleDateKey | "">("");
  const [lifecycleDateValue, setLifecycleDateValue] = useState("");

  useEffect(() => {
    if (society && !profile) setProfile({ ...society });
  }, [society, profile]);

  useEffect(() => {
    if (!society || detail === undefined || autoBackfilledSocietyId === society._id) return;
    setAutoBackfilledSocietyId(society._id);
    void backfillRecords({ societyId: society._id }).catch((error) => {
      console.error("Organization detail backfill failed", error);
    });
  }, [autoBackfilledSocietyId, backfillRecords, detail, society]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (!profile) return null;

  const set = (key: string, value: any) => setProfile((current: any) => ({ ...current, [key]: value }));
  const lifecycleRows = LIFECYCLE_DATE_TYPES.filter((item) => Boolean(profile[item.value]));
  const missingLifecycleDateOptions = LIFECYCLE_DATE_TYPES.filter((item) => !profile[item.value]);
  const startAddingLifecycleDate = () => {
    const nextType = missingLifecycleDateOptions[0]?.value ?? "";
    setLifecycleDateType(nextType);
    setLifecycleDateValue("");
    setAddingLifecycleDate(Boolean(nextType));
  };
  const addLifecycleDate = () => {
    if (!lifecycleDateType || !lifecycleDateValue) return;
    set(lifecycleDateType, lifecycleDateValue);
    setLifecycleDateType("");
    setLifecycleDateValue("");
    setAddingLifecycleDate(false);
  };

  const saveProfile = async () => {
    await upsertSociety({
      id: society._id,
      name: profile.name,
      incorporationNumber: profile.incorporationNumber,
      incorporationDate: profile.incorporationDate,
      fiscalYearEnd: profile.fiscalYearEnd,
      jurisdictionCode: profile.jurisdictionCode ?? "CA-BC",
      entityType: profile.entityType,
      actFormedUnder: profile.actFormedUnder,
      officialEmail: profile.officialEmail,
      numbered: !!profile.numbered,
      distributing: !!profile.distributing,
      solicitingPublicBenefit: !!profile.solicitingPublicBenefit,
      organizationStatus: profile.organizationStatus,
      archivedAtISO: profile.archivedAtISO,
      removedAtISO: profile.removedAtISO,
      continuanceDate: profile.continuanceDate,
      amalgamationDate: profile.amalgamationDate,
      naicsCode: profile.naicsCode,
      niceClassification: profile.niceClassification,
      isCharity: !!profile.isCharity,
      isMemberFunded: !!profile.isMemberFunded,
      registeredOfficeAddress: profile.registeredOfficeAddress,
      mailingAddress: profile.mailingAddress,
      purposes: profile.purposes,
      privacyOfficerName: profile.privacyOfficerName,
      privacyOfficerEmail: profile.privacyOfficerEmail,
      privacyProgramStatus: profile.privacyProgramStatus,
      privacyProgramReviewedAtISO: profile.privacyProgramReviewedAtISO,
      privacyProgramNotes: profile.privacyProgramNotes,
      memberDataAccessStatus: profile.memberDataAccessStatus,
      memberDataGapDocumented: !!profile.memberDataGapDocumented,
      memberDataAccessReviewedAtISO: profile.memberDataAccessReviewedAtISO,
      memberDataAccessNotes: profile.memberDataAccessNotes,
      boardCadence: profile.boardCadence,
      boardCadenceDayOfWeek: profile.boardCadenceDayOfWeek,
      boardCadenceTime: profile.boardCadenceTime,
      boardCadenceNotes: profile.boardCadenceNotes,
      publicSlug: profile.publicSlug,
      publicSummary: profile.publicSummary,
      publicContactEmail: profile.publicContactEmail,
      publicTransparencyEnabled: profile.publicTransparencyEnabled,
      publicShowBoard: profile.publicShowBoard,
      publicShowBylaws: profile.publicShowBylaws,
      publicShowFinancials: profile.publicShowFinancials,
      publicVolunteerIntakeEnabled: profile.publicVolunteerIntakeEnabled,
      publicGrantIntakeEnabled: profile.publicGrantIntakeEnabled,
      demoMode: profile.demoMode,
    });
    toast.success("Organization dossier saved");
  };

  const backfillExistingRecords = async () => {
    const result = await backfillRecords({ societyId: society._id });
    const total = result.addressesCreated + result.minuteBookItemsCreated;
    toast.success(
      total ? "Backfill complete" : "No records added",
      `${result.addressesCreated} addresses, ${result.minuteBookItemsCreated} minute-book records`,
    );
  };

  const openNew = (kind: DrawerKind) => {
    setDrawerKind(kind);
    if (kind === "address") {
      setDraft({
        type: "registered_office",
        status: "current",
        country: "Canada",
        street: "",
        city: "",
      });
    }
    if (kind === "registration") {
      setDraft({
        jurisdiction: "british_columbia",
        representativeIds: [],
        status: "active",
      });
    }
    if (kind === "identifier") {
      setDraft({
        kind: "business_number",
        number: "",
        status: "active",
        accessLevel: "restricted",
      });
    }
  };

  const saveDrawer = async () => {
    if (!drawerKind || !draft) return;
    if (drawerKind === "address") {
      await upsertAddress({
        id: draft._id,
        societyId: society._id,
        type: draft.type,
        status: draft.status,
        effectiveFrom: draft.effectiveFrom || undefined,
        effectiveTo: draft.effectiveTo || undefined,
        street: draft.street || "Needs review",
        unit: draft.unit || undefined,
        city: draft.city || "Needs review",
        provinceState: draft.provinceState || undefined,
        postalCode: draft.postalCode || undefined,
        country: draft.country || "Canada",
        notes: draft.notes || undefined,
      });
    }
    if (drawerKind === "registration") {
      await upsertRegistration({
        id: draft._id,
        societyId: society._id,
        jurisdiction: draft.jurisdiction || "Needs review",
        assumedName: draft.assumedName || undefined,
        registrationNumber: draft.registrationNumber || undefined,
        registrationDate: draft.registrationDate || undefined,
        activityCommencementDate: draft.activityCommencementDate || undefined,
        deRegistrationDate: draft.deRegistrationDate || undefined,
        nuansNumber: draft.nuansNumber || undefined,
        officialEmail: draft.officialEmail || undefined,
        representativeIds: csv(draft.representativeIdsText ?? draft.representativeIds),
        status: draft.status || "active",
        notes: draft.notes || undefined,
      });
    }
    if (drawerKind === "identifier") {
      await upsertIdentifier({
        id: draft._id,
        societyId: society._id,
        kind: draft.kind || "other",
        number: draft.number || "Needs review",
        jurisdiction: draft.jurisdiction || undefined,
        foreignJurisdiction: draft.foreignJurisdiction || undefined,
        registeredAt: draft.registeredAt || undefined,
        status: draft.status || "active",
        accessLevel: draft.accessLevel || "restricted",
        notes: draft.notes || undefined,
      });
    }
    toast.success("Saved");
    setDrawerKind(null);
    setDraft(null);
  };

  const removeRow = async (kind: DrawerKind, row: any) => {
    const ok = await confirm({
      title: "Remove record?",
      message: `"${row.title ?? row.jurisdiction ?? row.type ?? row.kind}" will be removed from the organization detail register.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    if (kind === "address") await removeAddress({ id: row._id });
    if (kind === "registration") await removeRegistration({ id: row._id });
    if (kind === "identifier") await removeIdentifier({ id: row._id });
    toast.success("Removed");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Organization details"
        icon={<Building2 size={16} />}
        iconColor="blue"
        subtitle="Registry dossier, structured addresses, extra-provincial registrations, and restricted tax/account identifiers."
        actions={
          <>
            <button className="btn-action" onClick={backfillExistingRecords}>Backfill records</button>
            <button className="btn btn--accent" onClick={saveProfile}>Save dossier</button>
          </>
        }
      />

      <div className="org-details-top">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Registry profile</h2>
            <span className="card__subtitle">Stable facts used across filings and workflows.</span>
          </div>
          <div className="card__body">
            <div className="org-details-field-grid">
              <OptionSelect label="Entity type" setName="entityTypes" value={profile.entityType ?? ""} onChange={(value) => set("entityType", value)} emptyLabel="No entity type" />
              <OptionSelect label="Act formed under" setName="actsFormedUnder" value={profile.actFormedUnder ?? ""} onChange={(value) => set("actFormedUnder", value)} emptyLabel="No act selected" />
              <Field label="Official email">
                <input className="input" value={profile.officialEmail ?? ""} onChange={(e) => set("officialEmail", e.target.value)} />
              </Field>
              <OptionSelect label="Organization status" setName="organizationStatuses" value={profile.organizationStatus ?? ""} onChange={(value) => set("organizationStatus", value)} emptyLabel="No status" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Lifecycle dates</h2>
            <span className="card__subtitle">Primary incorporation plus registry events.</span>
            <button
              className="btn btn--sm"
              type="button"
              onClick={startAddingLifecycleDate}
              disabled={addingLifecycleDate || missingLifecycleDateOptions.length === 0}
              style={{ marginLeft: "auto" }}
            >
              <Plus size={12} />
              Add date
            </button>
          </div>
          <div className="card__body">
            <div className="org-details-date-list">
              {lifecycleRows.length === 0 && !addingLifecycleDate && (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No lifecycle dates recorded.</div>
              )}
              {lifecycleRows.map((item) => (
                <div className="org-details-date-row" key={item.value}>
                  <Field label={item.label}>
                    <DatePicker value={profile[item.value] ?? ""} onChange={(value) => set(item.value, value)} />
                  </Field>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    type="button"
                    aria-label={`Clear ${item.label}`}
                    onClick={() => set(item.value, "")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {addingLifecycleDate && (
                <div className="org-details-date-row org-details-date-row--draft">
                  <Field label="Date type">
                    <Select
                      value={lifecycleDateType}
                      onChange={(value) => setLifecycleDateType(value)}
                      options={missingLifecycleDateOptions}
                    />
                  </Field>
                  <Field label="Date">
                    <DatePicker value={lifecycleDateValue} onChange={setLifecycleDateValue} />
                  </Field>
                  <div className="org-details-date-row__actions">
                    <button className="btn btn--sm" type="button" onClick={() => setAddingLifecycleDate(false)}>Cancel</button>
                    <button className="btn btn--sm btn--accent" type="button" onClick={addLifecycleDate} disabled={!lifecycleDateType || !lifecycleDateValue}>Add</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card org-details-classification-card">
          <div className="card__head">
            <h2 className="card__title">Classification and flags</h2>
          </div>
          <div className="card__body">
            <div className="org-details-field-grid">
              <Field label="NAICS code">
                <input className="input" value={profile.naicsCode ?? ""} onChange={(e) => set("naicsCode", e.target.value)} />
              </Field>
              <Field label="Nice classification">
                <input className="input" value={profile.niceClassification ?? ""} onChange={(e) => set("niceClassification", e.target.value)} />
              </Field>
            </div>
            <div className="org-details-toggle-row">
              <Toggle checked={!!profile.numbered} onChange={(value) => set("numbered", value)} label="Numbered entity" />
              <Toggle checked={!!profile.distributing} onChange={(value) => set("distributing", value)} label="Distributing" />
              <Toggle checked={!!profile.solicitingPublicBenefit} onChange={(value) => set("solicitingPublicBenefit", value)} label="Soliciting / public benefit" />
            </div>
          </div>
        </div>
      </div>

      <div className="org-detail-registers">
        <DetailSection
          icon={<MapPin size={14} />}
          title="Structured addresses"
          count={detail?.addresses?.length ?? 0}
          action={<button className="btn-action btn-action--primary" onClick={() => openNew("address")}><Plus size={12} /> Address</button>}
        >
          <SimpleTable
            rows={detail?.addresses ?? []}
            empty="No structured addresses yet."
            columns={["Type", "Status", "Address", "Effective", ""]}
            tableClassName="org-address-table"
            render={(row: any) => [
              optionLabel("addressTypes", row.type),
              <Badge key="s" tone={row.status === "current" ? "success" : "neutral"}>{optionLabel("addressStatuses", row.status)}</Badge>,
              <span key="address" className="org-address-table__address">{addressLine(row)}</span>,
              dateRange(row.effectiveFrom, row.effectiveTo),
              <RowActions key="a" onEdit={() => { setDrawerKind("address"); setDraft(row); }} onRemove={() => removeRow("address", row)} />,
            ]}
          />
        </DetailSection>

        <div className="org-detail-registers__pair">
          <DetailSection
            icon={<Landmark size={14} />}
            title="Registration records"
            count={detail?.registrations?.length ?? 0}
            action={<button className="btn-action btn-action--primary" onClick={() => openNew("registration")}><Plus size={12} /> Registration</button>}
          >
            <SimpleTable
              rows={detail?.registrations ?? []}
              empty="No external or extra-provincial registrations yet."
              columns={["Jurisdiction", "Registration", "Dates", "Status", ""]}
              render={(row: any) => [
                optionLabel("entityJurisdictions", row.jurisdiction),
                <div key="r"><strong>{row.assumedName || "Legal name"}</strong><div className="mono muted">{row.registrationNumber ?? "No number"}{row.nuansNumber ? ` · NUANS ${row.nuansNumber}` : ""}</div></div>,
                dateRange(row.registrationDate, row.deRegistrationDate || row.activityCommencementDate),
                <Badge key="s" tone={row.status === "active" ? "success" : "warn"}>{optionLabel("registrationStatuses", row.status)}</Badge>,
                <RowActions key="a" onEdit={() => { setDrawerKind("registration"); setDraft({ ...row, representativeIdsText: (row.representativeIds ?? []).join(", ") }); }} onRemove={() => removeRow("registration", row)} />,
              ]}
            />
          </DetailSection>

          <DetailSection
            icon={<KeyRound size={14} />}
            title="Tax and registry identifiers"
            count={detail?.identifiers?.length ?? 0}
            action={<button className="btn-action btn-action--primary" onClick={() => openNew("identifier")}><Plus size={12} /> Identifier</button>}
          >
            <SimpleTable
              rows={detail?.identifiers ?? []}
              empty="No tax or registry identifiers yet."
              columns={["Kind", "Number", "Jurisdiction", "Status", ""]}
              render={(row: any) => [
                optionLabel("taxNumberTypes", row.kind),
                <span key="n" className="mono">{row.accessLevel === "restricted" ? mask(row.number) : row.number}</span>,
                row.foreignJurisdiction || row.jurisdiction || "-",
                <Badge key="s" tone={row.accessLevel === "restricted" ? "danger" : row.status === "active" ? "success" : "warn"}>{optionLabel("identifierStatuses", row.status)}</Badge>,
                <RowActions key="a" onEdit={() => { setDrawerKind("identifier"); setDraft(row); }} onRemove={() => removeRow("identifier", row)} />,
              ]}
            />
          </DetailSection>
        </div>
      </div>

      <Drawer
        open={!!drawerKind}
        onClose={() => { setDrawerKind(null); setDraft(null); }}
        title={drawerTitle(drawerKind, draft)}
        footer={
          <>
            <button className="btn" onClick={() => { setDrawerKind(null); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" onClick={saveDrawer}>Save</button>
          </>
        }
      >
        {drawerKind === "address" && draft && <AddressFields draft={draft} setDraft={setDraft} />}
        {drawerKind === "registration" && draft && <RegistrationFields draft={draft} setDraft={setDraft} />}
        {drawerKind === "identifier" && draft && <IdentifierFields draft={draft} setDraft={setDraft} />}
      </Drawer>
    </div>
  );
}

function DetailSection({ icon, title, count, action, children }: any) {
  return (
    <div className="card org-detail-section">
      <div className="card__head">
        <div className="row" style={{ gap: 8 }}>
          {icon}
          <h2 className="card__title">{title}</h2>
          <Badge>{count}</Badge>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SimpleTable({ rows, columns, render, empty, tableClassName }: any) {
  if (rows.length === 0) return <div className="card__body muted">{empty}</div>;
  const className = ["table", tableClassName].filter(Boolean).join(" ");
  return (
    <table className={className}>
      <thead><tr>{columns.map((column: string) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>
        {rows.map((row: any) => (
          <tr key={row._id}>{render(row).map((cell: any, index: number) => <td key={index}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function RowActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn btn--ghost btn--sm" onClick={onEdit}>Edit</button>
      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Remove" onClick={onRemove}><Trash2 size={12} /></button>
    </div>
  );
}

function AddressFields({ draft, setDraft }: any) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Type" setName="addressTypes" value={draft.type ?? ""} onChange={(value) => setDraft({ ...draft, type: value })} />
        <OptionSelect label="Status" setName="addressStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <Field label="Street"><input className="input" value={draft.street ?? ""} onChange={(e) => setDraft({ ...draft, street: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Unit"><input className="input" value={draft.unit ?? ""} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></Field>
        <Field label="City"><input className="input" value={draft.city ?? ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Province/state"><input className="input" value={draft.provinceState ?? ""} onChange={(e) => setDraft({ ...draft, provinceState: e.target.value })} /></Field>
        <Field label="Postal code"><input className="input" value={draft.postalCode ?? ""} onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })} /></Field>
        <Field label="Country"><input className="input" value={draft.country ?? ""} onChange={(e) => setDraft({ ...draft, country: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Effective from"><DatePicker value={draft.effectiveFrom ?? ""} onChange={(value) => setDraft({ ...draft, effectiveFrom: value })} /></Field>
        <Field label="Effective to"><DatePicker value={draft.effectiveTo ?? ""} onChange={(value) => setDraft({ ...draft, effectiveTo: value })} /></Field>
      </div>
      <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
    </>
  );
}

function RegistrationFields({ draft, setDraft }: any) {
  return (
    <>
      <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
      <Field label="Assumed name"><input className="input" value={draft.assumedName ?? ""} onChange={(e) => setDraft({ ...draft, assumedName: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registration number"><input className="input" value={draft.registrationNumber ?? ""} onChange={(e) => setDraft({ ...draft, registrationNumber: e.target.value })} /></Field>
        <Field label="NUANS number"><input className="input" value={draft.nuansNumber ?? ""} onChange={(e) => setDraft({ ...draft, nuansNumber: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registration date"><DatePicker value={draft.registrationDate ?? ""} onChange={(value) => setDraft({ ...draft, registrationDate: value })} /></Field>
        <Field label="Activity commenced"><DatePicker value={draft.activityCommencementDate ?? ""} onChange={(value) => setDraft({ ...draft, activityCommencementDate: value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="De-registration date"><DatePicker value={draft.deRegistrationDate ?? ""} onChange={(value) => setDraft({ ...draft, deRegistrationDate: value })} /></Field>
        <OptionSelect label="Status" setName="registrationStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <Field label="Official email"><input className="input" value={draft.officialEmail ?? ""} onChange={(e) => setDraft({ ...draft, officialEmail: e.target.value })} /></Field>
      <Field label="Representatives"><input className="input" value={draft.representativeIdsText ?? (draft.representativeIds ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, representativeIdsText: e.target.value })} placeholder="Name or record IDs, comma separated" /></Field>
      <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
    </>
  );
}

function IdentifierFields({ draft, setDraft }: any) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Kind" setName="taxNumberTypes" value={draft.kind ?? ""} onChange={(value) => setDraft({ ...draft, kind: value })} />
        <OptionSelect label="Status" setName="identifierStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <Field label="Number"><input className="input mono" value={draft.number ?? ""} onChange={(e) => setDraft({ ...draft, number: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
        <Field label="Foreign jurisdiction"><input className="input" value={draft.foreignJurisdiction ?? ""} onChange={(e) => setDraft({ ...draft, foreignJurisdiction: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registered at"><DatePicker value={draft.registeredAt ?? ""} onChange={(value) => setDraft({ ...draft, registeredAt: value })} /></Field>
        <OptionSelect label="Access level" setName="accessLevels" value={draft.accessLevel ?? ""} onChange={(value) => setDraft({ ...draft, accessLevel: value })} />
      </div>
      <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
    </>
  );
}

function drawerTitle(kind: DrawerKind | null, draft: any) {
  if (!kind) return "Organization detail";
  const prefix = draft?._id ? "Edit" : "New";
  return `${prefix} ${kind}`;
}

function csv(value: any) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function labelize(value?: string) {
  return String(value ?? "-").replace(/_/g, " ");
}

function addressLine(row: any) {
  return [row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country].filter(Boolean).join(", ");
}

function dateRange(start?: string, end?: string) {
  if (!start && !end) return "-";
  return `${start ? formatDate(start) : "?"} - ${end ? formatDate(end) : "current"}`;
}

function mask(value?: string) {
  const text = String(value ?? "");
  if (text.length <= 4) return "restricted";
  return `**** ${text.slice(-4)}`;
}
