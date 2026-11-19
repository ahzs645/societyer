import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Badge, Field } from "../../components/ui";
import { DatePicker } from "../../components/DatePicker";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { OptionSelect } from "../../components/OptionSelect";
import { Select } from "../../components/Select";
import { StructuredAddressFields } from "../../components/StructuredAddressFields";
import { CANADIAN_TIME_ZONES } from "../../../shared/timeZones";
import { DocumentSelect } from "./DocumentSelect";
import { PortalAccessEditor } from "./PortalAccessEditor";
import { ATTORNEY_STATUS_LABELS, defaultRegistrationTimeZone, registrationTimeLabel } from "./registryFacts";
import type { AttorneyStatus, DrawerKind, PortalAccessEntry, ProfileDocument } from "./types";

/**
 * The address, registration and identifier drawers' fields. Each register row
 * saves through its drawer, apart from the profile's "Save changes".
 */
export type DetailDraft = {
  _id?: string;
  notes?: string;
  status?: string;
  jurisdiction?: string;
  // Address
  type?: string;
  unit?: string;
  street?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  // Registration
  registrationType?: string;
  homeJurisdiction?: string;
  corporationClass?: string;
  licenceEvidenceDocumentId?: string;
  assumedName?: string;
  registrationNumber?: string;
  nuansNumber?: string;
  registrationDate?: string;
  activityCommencementDate?: string;
  deRegistrationDate?: string;
  officialEmail?: string;
  annualReturnDueDate?: string;
  lastAnnualReturnFiledDate?: string;
  registryProfileReportDate?: string;
  registryPortalKey?: string;
  agentForServiceName?: string;
  agentForServiceAddress?: string;
  principalOfficeAddress?: string;
  companyKeyVaultItemId?: string;
  representativeIds?: string[];
  representativeIdsText?: string;
  registrationTime?: string;
  registrationTimeZone?: string;
  homeCorporationNumber?: string;
  nameInHomeJurisdiction?: string;
  attorneyStatus?: AttorneyStatus;
  attorneyNotRequiredReason?: string;
  reminderEmailsSubscribed?: boolean;
  publicRecordUrl?: string;
  certificateDocumentId?: string;
  portalAccess?: PortalAccessEntry[];
  // Identifier
  kind?: string;
  number?: string;
  accessLevel?: string;
  foreignJurisdiction?: string;
  registeredAt?: string;
};

type DraftProps = { draft: DetailDraft; setDraft: (draft: DetailDraft) => void };

export function drawerTitle(kind: DrawerKind | null, draft: DetailDraft | null) {
  if (!kind) return "Organization detail";
  const prefix = draft?._id ? "Edit" : "New";
  return `${prefix} ${kind}`;
}

export function DetailSection({ id, icon, title, count, action, children }: {
  id?: string;
  icon?: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} className="card org-detail-section">
      <div className="card__head">
        <div className="row" style={{ gap: 8 }}>
          {icon}
          <h2 className="card__title">{title}</h2>
          {count !== undefined && <Badge>{count}</Badge>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function RowActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="row org-row-actions">
      <button className="btn btn--ghost btn--sm" type="button" onClick={onEdit}>Edit</button>
      <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label="Remove" onClick={onRemove}><Trash2 size={12} /></button>
    </div>
  );
}

export function AddressFields({ draft, setDraft }: DraftProps) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Type" setName="addressTypes" value={draft.type ?? ""} onChange={(value) => setDraft({ ...draft, type: value })} />
        <OptionSelect label="Status" setName="addressStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <StructuredAddressFields value={draft} onChange={(value) => setDraft({ ...draft, ...value })} />
      <div className="row" style={{ gap: 12 }}>
        <Field label="Effective from"><DatePicker value={draft.effectiveFrom ?? ""} onChange={(value) => setDraft({ ...draft, effectiveFrom: value })} /></Field>
        <Field label="Effective to"><DatePicker value={draft.effectiveTo ?? ""} onChange={(value) => setDraft({ ...draft, effectiveTo: value })} /></Field>
      </div>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}

const REMINDER_OPTIONS = [
  { value: "yes", label: "Subscribed" },
  { value: "no", label: "Not subscribed" },
];

export function RegistrationFields({ draft, setDraft, documents, derivedPublicRecordUrl }: DraftProps & {
  documents: readonly ProfileDocument[];
  /** The federal search page a CBCA home row links to when no URL is stored. */
  derivedPublicRecordUrl?: string;
}) {
  const home = draft.registrationType === "home";
  const zoneOptions = [
    ...CANADIAN_TIME_ZONES.map((choice) => ({ value: choice.zone, label: choice.label, hint: choice.place })),
    ...(draft.registrationTimeZone && !CANADIAN_TIME_ZONES.some((choice) => choice.zone === draft.registrationTimeZone) ? [{ value: draft.registrationTimeZone, label: draft.registrationTimeZone }] : []),
  ];
  const timeLabel = registrationTimeLabel(draft.registrationTime, draft.registrationTimeZone);
  const setTime = (value: string) => setDraft({
    ...draft,
    registrationTime: value,
    registrationTimeZone: value && !draft.registrationTimeZone ? defaultRegistrationTimeZone(draft.jurisdiction) : draft.registrationTimeZone,
  });
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Registration type" setName="registrationTypes" value={draft.registrationType ?? ""} onChange={(value) => setDraft({ ...draft, registrationType: value })} emptyLabel="No type" />
        <OptionSelect label="Registration jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Home jurisdiction" setName="entityJurisdictions" value={draft.homeJurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, homeJurisdiction: value })} emptyLabel="No home jurisdiction" />
      </div>
      {!home && (
        <div className="row" style={{ gap: 12 }}>
          <Field label="Home corporation number" hint="The number in the home jurisdiction."><input className="input mono" value={draft.homeCorporationNumber ?? ""} onChange={(e) => setDraft({ ...draft, homeCorporationNumber: e.target.value })} /></Field>
          <Field label="Name in home jurisdiction"><input className="input" value={draft.nameInHomeJurisdiction ?? ""} onChange={(e) => setDraft({ ...draft, nameInHomeJurisdiction: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Corporation registration class" hint="Ontario EPCA licence obligations apply to the licensed foreign class; ordinary federal corporations need a separate assessment."><Select value={draft.corporationClass ?? ""} onChange={(value) => setDraft({ ...draft, corporationClass: value })} options={[{ value: "", label: "Unclassified / needs review" }, { value: "federal_corporation", label: "Federal corporation" }, { value: "foreign_epca_licensed", label: "Ontario licensed foreign corporation (EPCA)" }, { value: "other", label: "Other — assess registry obligations" }]} /></Field>
      <Field label="Licence evidence document" hint="Required before selecting Ontario licensed foreign corporation."><Select value={draft.licenceEvidenceDocumentId ?? ""} onChange={(value) => setDraft({ ...draft, licenceEvidenceDocumentId: value })} options={[{ value: "", label: "Select an evidence document" }, ...documents.map((document) => ({ value: document._id, label: document.title ?? "Untitled document" }))]} /></Field>
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
        <Field label="Registration time" hint={timeLabel ? `Shows as ${timeLabel}` : "The registry's local time, from the certificate."}><input className="input" type="time" value={draft.registrationTime ?? ""} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Time zone"><Select value={draft.registrationTimeZone ?? ""} onChange={(value) => setDraft({ ...draft, registrationTimeZone: value || undefined })} options={zoneOptions} clearable placeholder="Choose a zone" /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="De-registration date"><DatePicker value={draft.deRegistrationDate ?? ""} onChange={(value) => setDraft({ ...draft, deRegistrationDate: value })} /></Field>
        <OptionSelect label="Status" setName="registrationStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Annual return due"><DatePicker value={draft.annualReturnDueDate ?? ""} onChange={(value) => setDraft({ ...draft, annualReturnDueDate: value })} /></Field>
        <Field label="Last annual return filed"><DatePicker value={draft.lastAnnualReturnFiledDate ?? ""} onChange={(value) => setDraft({ ...draft, lastAnnualReturnFiledDate: value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Profile report date"><DatePicker value={draft.registryProfileReportDate ?? ""} onChange={(value) => setDraft({ ...draft, registryProfileReportDate: value })} /></Field>
        <Field label="Registry portal key"><input className="input" value={draft.registryPortalKey ?? ""} onChange={(e) => setDraft({ ...draft, registryPortalKey: e.target.value })} /></Field>
      </div>
      <Field label="Certificate" hint="The registry's certificate for this registration, uploaded in Documents.">
        <DocumentSelect value={draft.certificateDocumentId} onChange={(value) => setDraft({ ...draft, certificateDocumentId: value })} documents={documents} preferredCategories={["CertificateOfIncorporation", "Filing"]} placeholder="Choose the certificate" />
      </Field>
      <Field label="Principal office"><input className="input" value={draft.principalOfficeAddress ?? ""} onChange={(e) => setDraft({ ...draft, principalOfficeAddress: e.target.value })} /></Field>
      {!home && (
        <div className="row" style={{ gap: 12 }}>
          <Field label="Attorney"><Select value={draft.attorneyStatus ?? ""} onChange={(value) => setDraft({ ...draft, attorneyStatus: (value || undefined) as AttorneyStatus | undefined })} options={(Object.keys(ATTORNEY_STATUS_LABELS) as AttorneyStatus[]).map((value) => ({ value, label: ATTORNEY_STATUS_LABELS[value] }))} clearable placeholder="No decision recorded" /></Field>
          {draft.attorneyStatus === "not_required" && <Field label="Why not required"><input className="input" value={draft.attorneyNotRequiredReason ?? ""} placeholder="e.g. Head office is in British Columbia" onChange={(e) => setDraft({ ...draft, attorneyNotRequiredReason: e.target.value })} /></Field>}
        </div>
      )}
      <div className="row" style={{ gap: 12 }}>
        <Field label="Agent for service"><input className="input" value={draft.agentForServiceName ?? ""} onChange={(e) => setDraft({ ...draft, agentForServiceName: e.target.value })} /></Field>
        <Field label="Agent address"><input className="input" value={draft.agentForServiceAddress ?? ""} onChange={(e) => setDraft({ ...draft, agentForServiceAddress: e.target.value })} /></Field>
      </div>
      <Field label="Official email"><input className="input" value={draft.officialEmail ?? ""} onChange={(e) => setDraft({ ...draft, officialEmail: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Reminder emails" hint="Annual filing reminders from the registry."><Select value={draft.reminderEmailsSubscribed === undefined ? "" : draft.reminderEmailsSubscribed ? "yes" : "no"} onChange={(value) => setDraft({ ...draft, reminderEmailsSubscribed: value ? value === "yes" : undefined })} options={REMINDER_OPTIONS} clearable placeholder="Not recorded" /></Field>
        <Field label="Public record" hint={!draft.publicRecordUrl && derivedPublicRecordUrl ? "Left blank, the profile links to the federal search page for this number." : "A link to the registry's public page."}><input className="input" type="url" inputMode="url" value={draft.publicRecordUrl ?? ""} placeholder={derivedPublicRecordUrl ?? "https://"} onChange={(e) => setDraft({ ...draft, publicRecordUrl: e.target.value })} /></Field>
      </div>
      <PortalAccessEditor value={draft.portalAccess ?? []} onChange={(portalAccess) => setDraft({ ...draft, portalAccess })} />
      <Field label="Representatives"><input className="input" value={draft.representativeIdsText ?? (draft.representativeIds ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, representativeIdsText: e.target.value })} placeholder="Name or record IDs, comma separated" /></Field>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}

export function IdentifierFields({ draft, setDraft }: DraftProps) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Kind" setName="taxNumberTypes" value={draft.kind ?? ""} onChange={(value) => setDraft({ ...draft, kind: value, ...(value === "pst" ? { jurisdiction: "CA-BC" } : {}) })} />
        <OptionSelect label="Status" setName="identifierStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <Field label="Number"><input className="input mono" value={draft.number ?? ""} onChange={(e) => setDraft({ ...draft, number: e.target.value })} /></Field>
      {["gst", "pst", "sales_tax"].includes(draft.kind ?? "") && <p className="muted" style={{ fontSize: 13 }}>
        {draft.kind === "gst" ? "Use the full GST/HST account number, such as 123456789RT0001. A nine-digit business number alone is not a GST/HST account." : draft.kind === "pst" ? "Use the BC PST number, such as PST-1234-5678." : "For invoice use, choose GST/HST registration or BC PST registration and save each number separately."}
        {" "}Only active registrations effective on the invoice date are used. New issued invoices save these numbers. Keep unconfirmed numbers marked Needs review.
      </p>}
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
        <Field label="Foreign jurisdiction"><input className="input" value={draft.foreignJurisdiction ?? ""} onChange={(e) => setDraft({ ...draft, foreignJurisdiction: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label={draft.kind === "gst" || draft.kind === "pst" ? "Registration effective date" : "Registered at"}><DatePicker value={draft.registeredAt ?? ""} onChange={(value) => setDraft({ ...draft, registeredAt: value })} /></Field>
        <OptionSelect label="Access level" setName="accessLevels" value={draft.accessLevel ?? ""} onChange={(value) => setDraft({ ...draft, accessLevel: value })} />
      </div>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}
