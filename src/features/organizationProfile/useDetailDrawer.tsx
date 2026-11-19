import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer } from "../../components/ui";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { optionLabel } from "../../lib/orgHubOptions";
import { homeJurisdictionCode, isFederalCbca } from "../../../shared/organizationDomain";
import { AddressFields, drawerTitle, IdentifierFields, RegistrationFields, type DetailDraft } from "./DetailDrawers";
import { cleanPortalAccess } from "./PortalAccessEditor";
import { csv } from "./detailRows";
import { cbcaPublicRecordUrl } from "./registryFacts";
import type { TaxIdentifierKind } from "./TaxTab";
import type { AddressRow, DrawerKind, IdentifierRow, OrganizationRecord, ProfileDocument, RegistrationRow } from "./types";

const NEW_ADDRESS: DetailDraft = { type: "registered_office", status: "current", country: "Canada", street: "", city: "" };

/** A new identifier of a kind, prefilled the way its Tax tab row expects. */
function newIdentifierDraft(kind: TaxIdentifierKind | "other"): DetailDraft {
  if (kind === "other") return { kind, number: "", status: "active", accessLevel: "restricted" };
  // Invoices use only active GST/HST and PST registrations, so a new one starts as Needs review.
  const salesTax = kind === "gst" || kind === "pst";
  return { kind, number: "", status: salesTax ? "needs_review" : "active", accessLevel: "internal", jurisdiction: kind === "pst" ? "CA-BC" : "federal__canada_" };
}

/** `upsertRegistration`'s arguments from the drawer: blanks dropped, a time zone only with a time. */
function registrationArgs(draft: DetailDraft, societyId: string) {
  return {
    id: draft._id,
    societyId,
    registrationType: draft.registrationType || "extra_provincial",
    corporationClass: draft.corporationClass || undefined,
    licenceEvidenceDocumentId: draft.licenceEvidenceDocumentId || undefined,
    jurisdiction: draft.jurisdiction || "Needs review",
    homeJurisdiction: draft.homeJurisdiction || undefined,
    assumedName: draft.assumedName || undefined,
    registrationNumber: draft.registrationNumber || undefined,
    registrationDate: draft.registrationDate || undefined,
    activityCommencementDate: draft.activityCommencementDate || undefined,
    deRegistrationDate: draft.deRegistrationDate || undefined,
    nuansNumber: draft.nuansNumber || undefined,
    officialEmail: draft.officialEmail || undefined,
    annualReturnDueDate: draft.annualReturnDueDate || undefined,
    lastAnnualReturnFiledDate: draft.lastAnnualReturnFiledDate || undefined,
    registryProfileReportDate: draft.registryProfileReportDate || undefined,
    registryPortalKey: draft.registryPortalKey || undefined,
    agentForServiceName: draft.agentForServiceName || undefined,
    agentForServiceAddress: draft.agentForServiceAddress || undefined,
    principalOfficeAddress: draft.principalOfficeAddress || undefined,
    registrationTime: draft.registrationTime || undefined,
    registrationTimeZone: draft.registrationTime ? draft.registrationTimeZone || undefined : undefined,
    homeCorporationNumber: draft.homeCorporationNumber || undefined,
    nameInHomeJurisdiction: draft.nameInHomeJurisdiction || undefined,
    attorneyStatus: draft.attorneyStatus || undefined,
    attorneyNotRequiredReason: draft.attorneyStatus === "not_required" ? draft.attorneyNotRequiredReason || undefined : undefined,
    reminderEmailsSubscribed: draft.reminderEmailsSubscribed,
    publicRecordUrl: draft.publicRecordUrl?.trim() || undefined,
    certificateDocumentId: draft.certificateDocumentId || undefined,
    portalAccess: cleanPortalAccess(draft.portalAccess),
    representativeIds: csv(draft.representativeIdsText ?? draft.representativeIds),
    status: draft.status || "active",
    notes: draft.notes || undefined,
  };
}

/**
 * The address, registration and identifier drawer. Register rows save through
 * it, apart from the profile's "Save changes".
 */
export function useDetailDrawer(society: OrganizationRecord | null | undefined, canEdit: boolean, documents: readonly ProfileDocument[] | undefined) {
  const toast = useToast();
  const confirm = useConfirm();
  const upsertAddress = useMutation(api.organizationDetails.upsertAddress);
  const removeAddress = useMutation(api.organizationDetails.removeAddress);
  const upsertRegistration = useMutation(api.organizationDetails.upsertRegistration);
  const removeRegistration = useMutation(api.organizationDetails.removeRegistration);
  const upsertIdentifier = useMutation(api.organizationDetails.upsertIdentifier);
  const removeIdentifier = useMutation(api.organizationDetails.removeIdentifier);
  const [kind, setKind] = useState<DrawerKind | null>(null);
  const [draft, setDraft] = useState<DetailDraft | null>(null);

  const open = (next: DrawerKind, value: DetailDraft) => {
    setKind(next);
    setDraft(value);
  };
  const close = () => {
    setKind(null);
    setDraft(null);
  };

  const openAddress = (row?: AddressRow) => open("address", row ?? NEW_ADDRESS);
  /** An existing row, or a new one (extra-provincial unless `preset` says otherwise). */
  const openRegistration = (row?: RegistrationRow, preset?: DetailDraft) => open("registration", row
    ? { ...row, representativeIdsText: (row.representativeIds ?? []).join(", ") }
    : {
      registrationType: "extra_provincial",
      jurisdiction: homeJurisdictionCode(society),
      homeJurisdiction: homeJurisdictionCode(society),
      representativeIds: [],
      status: "active",
      ...preset,
    });
  /** The home registration row, prefilled from the profile's number and date. */
  const openHomeRegistration = () => openRegistration(undefined, {
    registrationType: "home",
    registrationNumber: society?.incorporationNumber,
    registrationDate: society?.incorporationDate,
    certificateDocumentId: society?.certificateEvidenceDocumentId,
  });
  const openIdentifier = (row: IdentifierRow | TaxIdentifierKind | "other") => open("identifier", typeof row === "string" ? newIdentifierDraft(row) : row);

  const save = async () => {
    if (!kind || !draft || !society) return;
    try {
      if (kind === "address") {
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
      if (kind === "registration") {
        await upsertRegistration(registrationArgs(draft, society._id));
      }
      if (kind === "identifier") {
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
      close();
    } catch (error) {
      toast.error("Could not save record", error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (target: DrawerKind, row: { _id: string; jurisdiction?: string; type?: string; kind?: string }) => {
    const name = target === "address" ? optionLabel("addressTypes", row.type)
      : target === "registration" ? optionLabel("entityJurisdictions", row.jurisdiction)
      : optionLabel("taxNumberTypes", row.kind);
    const ok = await confirm({
      title: "Remove record?",
      message: `"${name}" will be removed from the organization detail register.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (target === "address") await removeAddress({ id: row._id });
      if (target === "registration") await removeRegistration({ id: row._id });
      if (target === "identifier") await removeIdentifier({ id: row._id });
      toast.success("Removed");
    } catch (error) {
      toast.error("Could not remove record", error instanceof Error ? error.message : String(error));
    }
  };

  const element = (
    <Drawer
      open={!!kind}
      onClose={close}
      title={drawerTitle(kind, draft)}
      footer={
        <>
          <button className="btn" type="button" onClick={close}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={!canEdit} onClick={save}>Save</button>
        </>
      }
    >
      {kind === "address" && draft && <AddressFields draft={draft} setDraft={setDraft} />}
      {kind === "registration" && draft && (
        <RegistrationFields
          draft={draft}
          setDraft={setDraft}
          documents={documents ?? []}
          derivedPublicRecordUrl={draft.registrationType === "home" && isFederalCbca(society) ? cbcaPublicRecordUrl(draft.registrationNumber || society?.incorporationNumber) : undefined}
        />
      )}
      {kind === "identifier" && draft && <IdentifierFields draft={draft} setDraft={setDraft} />}
    </Drawer>
  );

  return { openAddress, openRegistration, openHomeRegistration, openIdentifier, remove, element };
}
