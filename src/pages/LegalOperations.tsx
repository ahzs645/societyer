import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { OptionMultiSelect, OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { BookTemplate, FileSignature, Landmark, Plus, Scale, Trash2, UsersRound } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";
import { StructuredAddressFields } from "../components/StructuredAddressFields";

export function RoleHoldersPage() {
  const society = useSociety();
  const rows = useQuery(api.legalOperations.listRoleHolders, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.legalOperations.upsertRoleHolder);
  const remove = useMutation(api.legalOperations.removeRoleHolder);
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => setDraft({ roleType: "authorized_representative", status: "current", fullName: "" });
  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      roleType: draft.roleType || "authorized_representative",
      status: draft.status || "current",
      fullName: draft.fullName || [draft.firstName, draft.lastName].filter(Boolean).join(" ") || "Unnamed role holder",
      firstName: empty(draft.firstName),
      middleName: empty(draft.middleName),
      lastName: empty(draft.lastName),
      email: empty(draft.email),
      phone: empty(draft.phone),
      signerTag: empty(draft.signerTag),
      membershipId: empty(draft.membershipId),
      membershipClassName: empty(draft.membershipClassName),
      officerTitle: empty(draft.officerTitle),
      directorTerm: empty(draft.directorTerm),
      startDate: empty(draft.startDate),
      endDate: empty(draft.endDate),
      referenceDate: empty(draft.referenceDate),
      street: empty(draft.street),
      unit: empty(draft.unit),
      city: empty(draft.city),
      provinceState: empty(draft.provinceState),
      postalCode: empty(draft.postalCode),
      country: empty(draft.country),
      serviceStreet: empty(draft.serviceStreet),
      serviceUnit: empty(draft.serviceUnit),
      serviceCity: empty(draft.serviceCity),
      serviceProvinceState: empty(draft.serviceProvinceState),
      servicePostalCode: empty(draft.servicePostalCode),
      serviceCountry: empty(draft.serviceCountry),
      ageOver18: draft.ageOver18,
      dateOfBirth: empty(draft.dateOfBirth),
      occupation: empty(draft.occupation),
      citizenshipResidency: empty(draft.citizenshipResidency),
      citizenshipCountries: csv(draft.citizenshipCountriesText ?? draft.citizenshipCountries),
      taxResidenceCountries: csv(draft.taxResidenceCountriesText ?? draft.taxResidenceCountries),
      nonNaturalPerson: draft.nonNaturalPerson,
      nonNaturalPersonType: empty(draft.nonNaturalPersonType),
      nonNaturalJurisdiction: empty(draft.nonNaturalJurisdiction),
      natureOfControl: empty(draft.natureOfControl),
      authorizedRepresentative: draft.authorizedRepresentative,
      relatedShareholderIds: csv(draft.relatedShareholderIdsText ?? draft.relatedShareholderIds),
      controllingIndividualIds: csv(draft.controllingIndividualIdsText ?? draft.controllingIndividualIds),
      sourceExternalIds: csv(draft.sourceExternalIdsText ?? draft.sourceExternalIds),
      notes: empty(draft.notes),
    });
    setDraft(null);
    toast.success("Role holder saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete role holder?",
      message: `"${row.fullName}" will be removed from the canonical role/control register.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Role holder deleted");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Role-holder register"
        icon={<UsersRound size={16} />}
        iconColor="blue"
        subtitle="Canonical register for directors, officers, incorporators, attorneys for service, authorized representatives, members, rightsholders, and control relationships."
        actions={<button className="btn-action btn-action--primary" onClick={openNew}><Plus size={12} /> New holder</button>}
      />

      <Section title="People and controllers" count={rows?.length ?? 0}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Contact</th>
                <th>Membership/control</th>
                <th>Dates</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row: any) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.fullName}</strong>
                    <div className="muted">{row.occupation || row.signerTag || "No occupation/signer tag"}</div>
                  </td>
                  <td>
                    <div>{optionLabel("representativeTypes", row.roleType)}</div>
                    <div className="muted">{row.officerTitle ? optionLabel("officerTitles", row.officerTitle) : row.directorTerm ? optionLabel("directorTerms", row.directorTerm) : "No title/term"}</div>
                  </td>
                  <td>
                    <div>{row.email || "No email"}</div>
                    <div className="muted">{row.phone || "No phone"}</div>
                  </td>
                  <td>
                    <div>{row.membershipId || row.membershipClassName || "No membership id"}</div>
                    <div className="muted">{row.natureOfControl || (row.authorizedRepresentative ? "Authorized representative" : "No control notes")}</div>
                  </td>
                  <td>
                    <div>{dateLabel(row.startDate)} to {dateLabel(row.endDate)}</div>
                    <div className="muted">{row.referenceDate ? `Ref ${formatDate(row.referenceDate)}` : "No reference date"}</div>
                  </td>
                  <td><Badge tone={toneForStatus(row.status)}>{optionLabel("roleHolderStatuses", row.status)}</Badge></td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => setDraft(editRoleHolder(row))}>Edit</button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Delete role holder" onClick={() => confirmDelete(row)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {(rows ?? []).length === 0 && <EmptyRow cols={7} label="No role holders yet." />}
            </tbody>
          </table>
        </div>
      </Section>

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?._id ? "Edit role holder" : "New role holder"}
        footer={<><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {draft && (
          <>
            <Field label="Full name"><input className="input" value={draft.fullName ?? ""} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} /></Field>
            <div className="grid two">
              <OptionSelect label="Role type" setName="representativeTypes" value={draft.roleType ?? ""} onChange={(value) => setDraft({ ...draft, roleType: value })} />
              <OptionSelect label="Status" setName="roleHolderStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
            </div>
            <div className="grid two">
              <Field label="First name"><input className="input" value={draft.firstName ?? ""} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={draft.lastName ?? ""} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} /></Field>
            </div>
            <div className="grid two">
              <Field label="Email"><input className="input" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
              <Field label="Phone"><input className="input" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
            </div>
            <div className="grid two">
              <OptionSelect label="Officer title" setName="officerTitles" value={draft.officerTitle ?? ""} emptyLabel="No title" onChange={(value) => setDraft({ ...draft, officerTitle: value })} />
              <OptionSelect label="Director term" setName="directorTerms" value={draft.directorTerm ?? ""} emptyLabel="No term" onChange={(value) => setDraft({ ...draft, directorTerm: value })} />
            </div>
            <div className="grid two">
              <Field label="Start date"><DatePicker value={draft.startDate ?? ""} onChange={(value) => setDraft({ ...draft, startDate: value })} /></Field>
              <Field label="End date"><DatePicker value={draft.endDate ?? ""} onChange={(value) => setDraft({ ...draft, endDate: value })} /></Field>
            </div>
            <div className="grid two">
              <Field label="Membership ID"><input className="input" value={draft.membershipId ?? ""} onChange={(e) => setDraft({ ...draft, membershipId: e.target.value })} /></Field>
              <Field label="Membership/right class"><input className="input" value={draft.membershipClassName ?? ""} onChange={(e) => setDraft({ ...draft, membershipClassName: e.target.value })} /></Field>
            </div>
            <Field label="Signer tag"><input className="input" value={draft.signerTag ?? ""} onChange={(e) => setDraft({ ...draft, signerTag: e.target.value })} /></Field>
            <div className="grid two">
              <Field label="Date of birth"><DatePicker value={draft.dateOfBirth ?? ""} onChange={(value) => setDraft({ ...draft, dateOfBirth: value })} /></Field>
              <Field label="Occupation"><input className="input" value={draft.occupation ?? ""} onChange={(e) => setDraft({ ...draft, occupation: e.target.value })} /></Field>
            </div>
            <OptionSelect label="Citizenship/residency" setName="citizenshipResidencies" value={draft.citizenshipResidency ?? ""} emptyLabel="No selection" onChange={(value) => setDraft({ ...draft, citizenshipResidency: value })} />
            <div className="grid two">
              <Field label="Citizenship countries"><input className="input" value={draft.citizenshipCountriesText ?? ""} onChange={(e) => setDraft({ ...draft, citizenshipCountriesText: e.target.value })} /></Field>
              <Field label="Tax residence countries"><input className="input" value={draft.taxResidenceCountriesText ?? ""} onChange={(e) => setDraft({ ...draft, taxResidenceCountriesText: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <label><input type="checkbox" checked={Boolean(draft.ageOver18)} onChange={(e) => setDraft({ ...draft, ageOver18: e.target.checked })} /> Age over 18</label>
              <label><input type="checkbox" checked={Boolean(draft.authorizedRepresentative)} onChange={(e) => setDraft({ ...draft, authorizedRepresentative: e.target.checked })} /> Authorized representative</label>
              <label><input type="checkbox" checked={Boolean(draft.nonNaturalPerson)} onChange={(e) => setDraft({ ...draft, nonNaturalPerson: e.target.checked })} /> Non-natural person</label>
            </div>
            <Field label="Nature of control"><textarea className="textarea" value={draft.natureOfControl ?? ""} onChange={(e) => setDraft({ ...draft, natureOfControl: e.target.value })} /></Field>
            <StructuredAddressFields value={draft} onChange={(address) => setDraft({ ...draft, ...address })} />
            <Field label="Service address"><input className="input" value={draft.serviceStreet ?? ""} onChange={(e) => setDraft({ ...draft, serviceStreet: e.target.value })} /></Field>
            <Field label="Related shareholder/controller IDs"><input className="input" value={draft.relatedShareholderIdsText ?? ""} onChange={(e) => setDraft({ ...draft, relatedShareholderIdsText: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

export function RightsLedgerPage() {
  const society = useSociety();
  const data = useQuery(api.legalOperations.rightsLedger, society ? { societyId: society._id } : "skip");
  const upsertClass = useMutation(api.legalOperations.upsertRightsClass);
  const upsertTransfer = useMutation(api.legalOperations.upsertRightsholdingTransfer);
  const removeClass = useMutation(api.legalOperations.removeRightsClass);
  const removeTransfer = useMutation(api.legalOperations.removeRightsholdingTransfer);
  const toast = useToast();
  const confirm = useConfirm();
  const [classDraft, setClassDraft] = useState<any>(null);
  const [transferDraft, setTransferDraft] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const saveClass = async () => {
    if (!classDraft) return;
    await upsertClass({
      id: classDraft._id,
      societyId: society._id,
      className: classDraft.className || "Unnamed class",
      classType: classDraft.classType || "membership",
      status: classDraft.status || "active",
      idPrefix: empty(classDraft.idPrefix),
      highestAssignedNumber: numberOrUndefined(classDraft.highestAssignedNumber),
      votingRights: empty(classDraft.votingRights),
      startDate: empty(classDraft.startDate),
      endDate: empty(classDraft.endDate),
      conditionsToHold: empty(classDraft.conditionsToHold),
      conditionsToTransfer: empty(classDraft.conditionsToTransfer),
      conditionsForRemoval: empty(classDraft.conditionsForRemoval),
      otherProvisions: empty(classDraft.otherProvisions),
      sourceExternalIds: csv(classDraft.sourceExternalIdsText ?? classDraft.sourceExternalIds),
      notes: empty(classDraft.notes),
    });
    setClassDraft(null);
    toast.success("Rights class saved");
  };

  const saveTransfer = async () => {
    if (!transferDraft) return;
    await upsertTransfer({
      id: transferDraft._id,
      societyId: society._id,
      transferType: transferDraft.transferType || "transfer",
      status: transferDraft.status || "draft",
      transferDate: empty(transferDraft.transferDate),
      rightsClassId: empty(transferDraft.rightsClassId) as any,
      sourceRoleHolderId: empty(transferDraft.sourceRoleHolderId) as any,
      destinationRoleHolderId: empty(transferDraft.destinationRoleHolderId) as any,
      sourceHolderName: empty(transferDraft.sourceHolderName),
      destinationHolderName: empty(transferDraft.destinationHolderName),
      quantity: numberOrUndefined(transferDraft.quantity),
      considerationType: empty(transferDraft.considerationType),
      considerationDescription: empty(transferDraft.considerationDescription),
      priceToOrganizationCents: cents(transferDraft.priceToOrganization),
      priceToOrganizationCurrency: empty(transferDraft.priceToOrganizationCurrency),
      priceToVendorCents: cents(transferDraft.priceToVendor),
      priceToVendorCurrency: empty(transferDraft.priceToVendorCurrency),
      sourceExternalIds: csv(transferDraft.sourceExternalIdsText ?? transferDraft.sourceExternalIds),
      notes: empty(transferDraft.notes),
    });
    setTransferDraft(null);
    toast.success("Ledger transfer saved");
  };

  const deleteRow = async (kind: "class" | "transfer", row: any) => {
    const ok = await confirm({
      title: kind === "class" ? "Delete rights class?" : "Delete ledger transfer?",
      message: `"${kind === "class" ? row.className : row.transferType}" will be removed from the rights ledger.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    if (kind === "class") await removeClass({ id: row._id });
    else await removeTransfer({ id: row._id });
    toast.success("Ledger row deleted");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Rights ledger"
        icon={<Scale size={16} />}
        iconColor="purple"
        subtitle="Membership/right classes plus issuance, transfer, redemption, cancellation, and adjustment history."
        actions={
          <div className="row">
            <button className="btn-action" onClick={() => setTransferDraft({ transferType: "transfer", status: "draft", priceToOrganizationCurrency: "cad", priceToVendorCurrency: "cad" })}><Plus size={12} /> Transfer</button>
            <button className="btn-action btn-action--primary" onClick={() => setClassDraft({ classType: "membership", status: "active" })}><Plus size={12} /> Class</button>
          </div>
        }
      />

      <Section title="Rights and membership classes" count={data?.classes?.length ?? 0}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Class</th><th>Type</th><th>Voting/conditions</th><th>Dates</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data?.classes ?? []).map((row: any) => (
                <tr key={row._id}>
                  <td><strong>{row.className}</strong><div className="muted">{row.idPrefix || "No ID prefix"}</div></td>
                  <td>{optionLabel("rightsClassTypes", row.classType)}</td>
                  <td><div>{row.votingRights || "No voting text"}</div><div className="muted">{row.conditionsToHold || row.conditionsToTransfer || "No conditions"}</div></td>
                  <td>{dateLabel(row.startDate)} to {dateLabel(row.endDate)}</td>
                  <td><Badge tone={toneForStatus(row.status)}>{optionLabel("rightsClassStatuses", row.status)}</Badge></td>
                  <td><RowActions onEdit={() => setClassDraft(editRightsClass(row))} onDelete={() => deleteRow("class", row)} label="rights class" /></td>
                </tr>
              ))}
              {(data?.classes ?? []).length === 0 && <EmptyRow cols={6} label="No rights classes yet." />}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Holding and transfer events" count={data?.transfers?.length ?? 0}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Class</th><th>From</th><th>To</th><th>Quantity</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data?.transfers ?? []).map((row: any) => {
                const rightsClass = data?.classes?.find((item: any) => item._id === row.rightsClassId);
                const source = data?.roleHolders?.find((item: any) => item._id === row.sourceRoleHolderId);
                const destination = data?.roleHolders?.find((item: any) => item._id === row.destinationRoleHolderId);
                return (
                  <tr key={row._id}>
                    <td>{dateLabel(row.transferDate)}</td>
                    <td>{optionLabel("rightsholdingTransferTypes", row.transferType)}</td>
                    <td>{rightsClass?.className || "Unlinked"}</td>
                    <td>{source?.fullName || row.sourceHolderName || "Treasury/new issue"}</td>
                    <td>{destination?.fullName || row.destinationHolderName || "No destination"}</td>
                    <td>{row.quantity ?? "-"}</td>
                    <td><Badge tone={toneForStatus(row.status)}>{optionLabel("rightsholdingTransferStatuses", row.status)}</Badge></td>
                    <td><RowActions onEdit={() => setTransferDraft(editTransfer(row))} onDelete={() => deleteRow("transfer", row)} label="ledger transfer" /></td>
                  </tr>
                );
              })}
              {(data?.transfers ?? []).length === 0 && <EmptyRow cols={8} label="No holding transfers yet." />}
            </tbody>
          </table>
        </div>
      </Section>

      <Drawer open={Boolean(classDraft)} onClose={() => setClassDraft(null)} title={classDraft?._id ? "Edit rights class" : "New rights class"} footer={<><button className="btn" onClick={() => setClassDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={saveClass}>Save</button></>}>
        {classDraft && (
          <>
            <Field label="Class name"><input className="input" value={classDraft.className ?? ""} onChange={(e) => setClassDraft({ ...classDraft, className: e.target.value })} /></Field>
            <div className="grid two">
              <OptionSelect label="Class type" setName="rightsClassTypes" value={classDraft.classType ?? ""} onChange={(value) => setClassDraft({ ...classDraft, classType: value })} />
              <OptionSelect label="Status" setName="rightsClassStatuses" value={classDraft.status ?? ""} onChange={(value) => setClassDraft({ ...classDraft, status: value })} />
            </div>
            <div className="grid two">
              <Field label="ID prefix"><input className="input" value={classDraft.idPrefix ?? ""} onChange={(e) => setClassDraft({ ...classDraft, idPrefix: e.target.value })} /></Field>
              <Field label="Highest assigned number"><input className="input" value={classDraft.highestAssignedNumber ?? ""} onChange={(e) => setClassDraft({ ...classDraft, highestAssignedNumber: e.target.value })} /></Field>
            </div>
            <Field label="Voting rights"><textarea className="textarea" value={classDraft.votingRights ?? ""} onChange={(e) => setClassDraft({ ...classDraft, votingRights: e.target.value })} /></Field>
            <Field label="Holding conditions"><textarea className="textarea" value={classDraft.conditionsToHold ?? ""} onChange={(e) => setClassDraft({ ...classDraft, conditionsToHold: e.target.value })} /></Field>
            <Field label="Transfer conditions"><textarea className="textarea" value={classDraft.conditionsToTransfer ?? ""} onChange={(e) => setClassDraft({ ...classDraft, conditionsToTransfer: e.target.value })} /></Field>
            <Field label="Other provisions"><textarea className="textarea" value={classDraft.otherProvisions ?? ""} onChange={(e) => setClassDraft({ ...classDraft, otherProvisions: e.target.value })} /></Field>
          </>
        )}
      </Drawer>

      <Drawer open={Boolean(transferDraft)} onClose={() => setTransferDraft(null)} title={transferDraft?._id ? "Edit ledger transfer" : "New ledger transfer"} footer={<><button className="btn" onClick={() => setTransferDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={saveTransfer}>Save</button></>}>
        {transferDraft && (
          <>
            <div className="grid two">
              <OptionSelect label="Transfer type" setName="rightsholdingTransferTypes" value={transferDraft.transferType ?? ""} onChange={(value) => setTransferDraft({ ...transferDraft, transferType: value })} />
              <OptionSelect label="Status" setName="rightsholdingTransferStatuses" value={transferDraft.status ?? ""} onChange={(value) => setTransferDraft({ ...transferDraft, status: value })} />
            </div>
            <Field label="Transfer date"><DatePicker value={transferDraft.transferDate ?? ""} onChange={(value) => setTransferDraft({ ...transferDraft, transferDate: value })} /></Field>
            <Field label="Rights class">
              <select className="input" value={transferDraft.rightsClassId ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, rightsClassId: e.target.value || undefined })}>
                <option value="">No class</option>
                {(data?.classes ?? []).map((row: any) => <option key={row._id} value={row._id}>{row.className}</option>)}
              </select>
            </Field>
            <div className="grid two">
              <Field label="Source holder"><input className="input" value={transferDraft.sourceHolderName ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, sourceHolderName: e.target.value })} /></Field>
              <Field label="Destination holder"><input className="input" value={transferDraft.destinationHolderName ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, destinationHolderName: e.target.value })} /></Field>
            </div>
            <div className="grid two">
              <Field label="Quantity"><input className="input" value={transferDraft.quantity ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, quantity: e.target.value })} /></Field>
              <Field label="Consideration type"><input className="input" value={transferDraft.considerationType ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, considerationType: e.target.value })} /></Field>
            </div>
            <Field label="Consideration description"><textarea className="textarea" value={transferDraft.considerationDescription ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, considerationDescription: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

export function TemplateEnginePage() {
  const society = useSociety();
  const data = useQuery(api.legalOperations.templateEngine, society ? { societyId: society._id } : "skip");
  const upsertField = useMutation(api.legalOperations.upsertTemplateDataField);
  const upsertTemplate = useMutation(api.legalOperations.upsertLegalTemplate);
  const upsertPrecedent = useMutation(api.legalOperations.upsertLegalPrecedent);
  const upsertRun = useMutation(api.legalOperations.upsertLegalPrecedentRun);
  const upsertDocument = useMutation(api.legalOperations.upsertGeneratedLegalDocument);
  const upsertSigner = useMutation(api.legalOperations.upsertLegalSigner);
  const seedStarterTemplates = useMutation(api.legalOperations.seedStarterPolicyTemplates);
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!draft) return;
    if (draft.kind === "field") {
      await upsertField({ id: draft._id, societyId: society._id, name: draft.name || "Unnamed field", label: empty(draft.label), fieldType: empty(draft.fieldType), required: draft.required, reviewRequired: draft.reviewRequired, notes: empty(draft.notes) });
    } else if (draft.kind === "template") {
      await upsertTemplate({
        id: draft._id,
        societyId: society._id,
        templateType: draft.templateType || "document",
        name: draft.name || "Untitled template",
        status: draft.status || "draft",
        owner: empty(draft.owner),
        signatureRequired: draft.signatureRequired,
        documentTag: empty(draft.documentTag),
        entityTypes: draft.entityTypes ?? [],
        jurisdictions: draft.jurisdictions ?? [],
        requiredSigners: draft.requiredSigners ?? [],
        requiredDataFields: csv(draft.requiredDataFieldsText ?? draft.requiredDataFields),
        optionalDataFields: csv(draft.optionalDataFieldsText ?? draft.optionalDataFields),
        reviewDataFields: csv(draft.reviewDataFieldsText ?? draft.reviewDataFields),
        timeline: empty(draft.timeline),
        deliverable: empty(draft.deliverable),
        terms: empty(draft.terms),
        filingType: empty(draft.filingType),
        priceItems: csv(draft.priceItemsText ?? draft.priceItems),
        notes: empty(draft.notes),
      });
    } else if (draft.kind === "precedent") {
      await upsertPrecedent({
        id: draft._id,
        societyId: society._id,
        packageName: draft.packageName || "Untitled precedent",
        partType: empty(draft.partType),
        status: draft.status || "draft",
        description: empty(draft.description),
        shortDescription: empty(draft.shortDescription),
        timeline: empty(draft.timeline),
        deliverables: empty(draft.deliverables),
        internalNotes: empty(draft.internalNotes),
        addOnTerms: empty(draft.addOnTerms),
        templateNames: csv(draft.templateNamesText ?? draft.templateNames),
        templateFilingNames: csv(draft.templateFilingNamesText ?? draft.templateFilingNames),
        templateSearchNames: csv(draft.templateSearchNamesText ?? draft.templateSearchNames),
        templateRegistrationNames: csv(draft.templateRegistrationNamesText ?? draft.templateRegistrationNames),
        requiresAmendmentRecord: draft.requiresAmendmentRecord,
        requiresAnnualMaintenanceRecord: draft.requiresAnnualMaintenanceRecord,
        priceItems: csv(draft.priceItemsText ?? draft.priceItems),
        entityTypes: draft.entityTypes ?? [],
        jurisdictions: draft.jurisdictions ?? [],
      });
    } else if (draft.kind === "run") {
      await upsertRun({
        id: draft._id,
        societyId: society._id,
        name: draft.name || "Untitled run",
        status: draft.status || "draft",
        eventId: empty(draft.eventId),
        dateTime: empty(draft.dateTime),
        dataJson: empty(draft.dataJson),
        dataReviewed: draft.dataReviewed,
        externalNotes: empty(draft.externalNotes),
        priceItems: csv(draft.priceItemsText ?? draft.priceItems),
        notes: empty(draft.notes),
      });
    } else if (draft.kind === "document") {
      await upsertDocument({
        id: draft._id,
        societyId: society._id,
        title: draft.title || "Untitled generated document",
        status: draft.status || "draft",
        draftFileUrl: empty(draft.draftFileUrl),
        sourceTemplateName: empty(draft.sourceTemplateName),
        eventId: empty(draft.eventId),
        effectiveDate: empty(draft.effectiveDate),
        documentTag: empty(draft.documentTag),
        dataJson: empty(draft.dataJson),
        syngrafiiFileId: empty(draft.syngrafiiFileId),
        syngrafiiDocumentId: empty(draft.syngrafiiDocumentId),
        syngrafiiPackageId: empty(draft.syngrafiiPackageId),
        signerTagsRequired: csv(draft.signerTagsRequiredText ?? draft.signerTagsRequired),
        signerTagsSigned: csv(draft.signerTagsSignedText ?? draft.signerTagsSigned),
        notes: empty(draft.notes),
      });
    } else if (draft.kind === "signer") {
      await upsertSigner({
        id: draft._id,
        societyId: society._id,
        status: draft.status || "unsigned",
        fullName: draft.fullName || draft.email || "Unnamed signer",
        firstName: empty(draft.firstName),
        lastName: empty(draft.lastName),
        email: empty(draft.email),
        phone: empty(draft.phone),
        signerId: empty(draft.signerId),
        signerTag: empty(draft.signerTag),
        eventId: empty(draft.eventId),
        notes: empty(draft.notes),
      });
    }
    setDraft(null);
    toast.success("Template engine record saved");
  };

  const addStarterTemplates = async () => {
    const result = await seedStarterTemplates({ societyId: society._id });
    toast.success(
      result.inserted || result.updated
        ? `Added ${result.inserted} and refreshed ${result.updated} starter templates`
        : "Starter templates already exist",
      result.skipped ? `${result.skipped} matching custom templates were left unchanged.` : `${result.total} source templates checked.`,
    );
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Template engine"
        icon={<BookTemplate size={16} />}
        iconColor="green"
        subtitle="Reusable OrgHub-style precedents, data fields, templates, generated drafts, signing state, package runs, timelines, deliverables, terms, and price items."
        actions={
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn-action" onClick={addStarterTemplates}><FileSignature size={12} /> Starter templates</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "field" })}><Plus size={12} /> Field</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "precedent", status: "draft" })}><Plus size={12} /> Precedent</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "run", status: "draft" })}><Plus size={12} /> Run</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "document", status: "draft" })}><Plus size={12} /> Draft</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "signer", status: "unsigned" })}><Plus size={12} /> Signer</button>
            <button className="btn-action btn-action--primary" onClick={() => setDraft({ kind: "template", templateType: "document", status: "draft" })}><Plus size={12} /> Template</button>
          </div>
        }
      />

      <Section title="Templates" count={data?.templates?.length ?? 0}>
        <SimpleTable
          cols={["Name", "Type", "Coverage", "Signing", "Status"]}
          rows={(data?.templates ?? []).map((row: any) => [
            <RecordTitle title={row.name} subtitle={row.owner || row.documentTag || "No owner/tag"} />,
            optionLabel("templateTypes", row.templateType),
            `${row.jurisdictions?.length || 0} jurisdictions / ${row.entityTypes?.length || 0} entity types`,
            row.signatureRequired ? `${row.requiredSigners?.length || 0} signer rules` : "No signature",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("templateStatuses", row.status)}</Badge>,
          ])}
          empty="No templates yet."
        />
      </Section>

      <Section title="Precedents and runs" count={(data?.precedents?.length ?? 0) + (data?.runs?.length ?? 0)}>
        <SimpleTable
          cols={["Package", "Timeline", "Deliverables", "Terms", "Status"]}
          rows={(data?.precedents ?? []).map((row: any) => [
            <RecordTitle title={row.packageName} subtitle={row.shortDescription || row.partType || "No short description"} />,
            row.timeline || "-",
            row.deliverables || "-",
            row.addOnTerms || "-",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("precedentStatuses", row.status)}</Badge>,
          ])}
          empty="No precedents yet."
        />
      </Section>

      <Section title="Generated documents and signers" count={(data?.generatedDocuments?.length ?? 0) + (data?.signers?.length ?? 0)}>
        <SimpleTable
          cols={["Document", "Template", "Signing package", "Signers", "Status"]}
          rows={(data?.generatedDocuments ?? []).map((row: any) => [
            <RecordTitle title={row.title} subtitle={dateLabel(row.effectiveDate)} />,
            row.sourceTemplateName || "-",
            row.syngrafiiPackageId || row.syngrafiiDocumentId || "-",
            `${row.signerTagsSigned?.length || 0}/${row.signerTagsRequired?.length || 0}`,
            <Badge tone={toneForStatus(row.status)}>{optionLabel("generatedDocumentStatuses", row.status)}</Badge>,
          ])}
          empty="No generated documents yet."
        />
      </Section>

      <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} title={draftTitle(draft)} footer={<><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}>
        {draft && <TemplateDraftForm draft={draft} setDraft={setDraft} />}
      </Drawer>
    </div>
  );
}

export function FormationMaintenancePage() {
  const society = useSociety();
  const data = useQuery(api.legalOperations.formationMaintenance, society ? { societyId: society._id } : "skip");
  const upsertFormation = useMutation(api.legalOperations.upsertFormationRecord);
  const upsertNameSearch = useMutation(api.legalOperations.upsertNameSearchItem);
  const upsertAmendment = useMutation(api.legalOperations.upsertEntityAmendment);
  const upsertAnnual = useMutation(api.legalOperations.upsertAnnualMaintenanceRecord);
  const upsertJurisdiction = useMutation(api.legalOperations.upsertJurisdictionMetadata);
  const upsertLog = useMutation(api.legalOperations.upsertSupportLog);
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);
  const latestJurisdictionByCode = useMemo(
    () => new Map((data?.jurisdictionMetadata ?? []).map((row: any) => [row.jurisdiction, row])),
    [data],
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!draft) return;
    if (draft.kind === "formation") {
      await upsertFormation({
        id: draft._id,
        societyId: society._id,
        status: draft.status || "draft",
        statusNumber: numberOrUndefined(draft.statusNumber),
        logStartDate: empty(draft.logStartDate),
        nuansDate: empty(draft.nuansDate),
        nuansNumber: empty(draft.nuansNumber),
        addressRental: draft.addressRental,
        stepDataInput: empty(draft.stepDataInput),
        assignedStaffIds: csv(draft.assignedStaffIdsText ?? draft.assignedStaffIds),
        signingPackageIds: csv(draft.signingPackageIdsText ?? draft.signingPackageIds),
        articlesRestrictionOnActivities: empty(draft.articlesRestrictionOnActivities),
        purposeStatement: empty(draft.purposeStatement),
        additionalProvisions: empty(draft.additionalProvisions),
        classesOfMembership: empty(draft.classesOfMembership),
        distributionOfProperty: empty(draft.distributionOfProperty),
        priceItems: csv(draft.priceItemsText ?? draft.priceItems),
        jurisdiction: empty(draft.jurisdiction),
        extraProvincialRegistrationJurisdiction: empty(draft.extraProvincialRegistrationJurisdiction),
        notes: empty(draft.notes),
      });
    } else if (draft.kind === "nameSearch") {
      await upsertNameSearch({ id: draft._id, societyId: society._id, name: draft.name || "Unnamed search", success: draft.success, errors: csv(draft.errorsText ?? draft.errors), reportUrl: empty(draft.reportUrl), rank: numberOrUndefined(draft.rank), expressService: draft.expressService, descriptiveElement: empty(draft.descriptiveElement), distinctiveElement: empty(draft.distinctiveElement), nuansReportNumber: empty(draft.nuansReportNumber), suffix: empty(draft.suffix), notes: empty(draft.notes) });
    } else if (draft.kind === "amendment") {
      await upsertAmendment({ id: draft._id, societyId: society._id, status: draft.status || "draft", effectiveDate: empty(draft.effectiveDate), entityNameNew: empty(draft.entityNameNew), directorsMinimum: numberOrUndefined(draft.directorsMinimum), directorsMaximum: numberOrUndefined(draft.directorsMaximum), shareClassAmendmentText: empty(draft.shareClassAmendmentText), jurisdictionNew: empty(draft.jurisdictionNew), notes: empty(draft.notes) });
    } else if (draft.kind === "annual") {
      await upsertAnnual({ id: draft._id, societyId: society._id, status: draft.status || "draft", yearFilingFor: empty(draft.yearFilingFor), lastAgmDate: empty(draft.lastAgmDate), filingDate: empty(draft.filingDate), authorizingPhone: empty(draft.authorizingPhone), fiscalYearEndDate: empty(draft.fiscalYearEndDate), incomeTaxReturnDate: empty(draft.incomeTaxReturnDate), annualFinancialStatementType: empty(draft.annualFinancialStatementType), financialStatementReportDate: empty(draft.financialStatementReportDate), financialStatementReportType: empty(draft.financialStatementReportType), auditedFinancialStatements: draft.auditedFinancialStatements, auditedFinancialStatementsNextYear: draft.auditedFinancialStatementsNextYear, annualFinancialsEngagementLevel: empty(draft.annualFinancialsEngagementLevel), annualFinancialStatementOption: empty(draft.annualFinancialStatementOption), notes: empty(draft.notes) });
    } else if (draft.kind === "jurisdiction") {
      await upsertJurisdiction({ id: draft._id, jurisdiction: draft.jurisdiction || "foreign", label: draft.label || draft.jurisdiction || "Jurisdiction", actFormedUnder: empty(draft.actFormedUnder), nuansJurisdictionNumber: empty(draft.nuansJurisdictionNumber), nuansReservationReportTypeId: empty(draft.nuansReservationReportTypeId), incorporationServiceEligible: draft.incorporationServiceEligible, sourceOptionId: empty(draft.sourceOptionId), notes: empty(draft.notes) });
    } else if (draft.kind === "log") {
      await upsertLog({ id: draft._id, societyId: society._id, logType: draft.logType || "edit", severity: draft.severity || "info", page: empty(draft.page), pageLocationUrl: empty(draft.pageLocationUrl), relatedEventId: empty(draft.relatedEventId), relatedSubscriptionId: empty(draft.relatedSubscriptionId), relatedIncorporationId: empty(draft.relatedIncorporationId), errorCode: empty(draft.errorCode), errorMessage: empty(draft.errorMessage), detailsHeading: empty(draft.detailsHeading), detailsBody: empty(draft.detailsBody), createdAtISO: empty(draft.createdAtISO) });
    }
    setDraft(null);
    toast.success("Formation and maintenance record saved");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Formation and maintenance"
        icon={<Landmark size={16} />}
        iconColor="orange"
        subtitle="Formation packages, NUANS/name-search artifacts, amendments, annual maintenance filings, jurisdiction attributes, and operational event logs."
        actions={
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn-action" onClick={() => setDraft({ kind: "nameSearch" })}><Plus size={12} /> Name search</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "amendment", status: "draft" })}><Plus size={12} /> Amendment</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "annual", status: "draft" })}><Plus size={12} /> Annual</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "jurisdiction" })}><Plus size={12} /> Jurisdiction</button>
            <button className="btn-action" onClick={() => setDraft({ kind: "log", logType: "edit", severity: "info" })}><Plus size={12} /> Log</button>
            <button className="btn-action btn-action--primary" onClick={() => setDraft({ kind: "formation", status: "draft" })}><Plus size={12} /> Formation</button>
          </div>
        }
      />

      <Section title="Formation records" count={data?.formations?.length ?? 0}>
        <SimpleTable
          cols={["NUANS", "Jurisdiction", "Purpose/classes", "Staff/signing", "Status"]}
          rows={(data?.formations ?? []).map((row: any) => [
            <RecordTitle title={row.nuansNumber || "No NUANS"} subtitle={dateLabel(row.nuansDate)} />,
            row.jurisdiction ? optionLabel("entityJurisdictions", row.jurisdiction) : "-",
            row.purposeStatement || row.classesOfMembership || "-",
            `${row.assignedStaffIds?.length || 0} staff / ${row.signingPackageIds?.length || 0} packages`,
            <Badge tone={toneForStatus(row.status)}>{optionLabel("formationStatuses", row.status)}</Badge>,
          ])}
          empty="No formation records yet."
        />
      </Section>

      <Section title="Annual maintenance" count={data?.annualRecords?.length ?? 0}>
        <SimpleTable
          cols={["Year", "AGM", "Filing", "Financial statement", "Status"]}
          rows={(data?.annualRecords ?? []).map((row: any) => [
            row.yearFilingFor || "-",
            dateLabel(row.lastAgmDate),
            dateLabel(row.filingDate),
            row.annualFinancialStatementOption ? optionLabel("annualFinancialStatementOptions", row.annualFinancialStatementOption) : row.financialStatementReportType || "-",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("annualMaintenanceStatuses", row.status)}</Badge>,
          ])}
          empty="No annual maintenance records yet."
        />
      </Section>

      <Section title="Jurisdiction metadata" count={data?.jurisdictionMetadata?.length ?? 0}>
        <SimpleTable
          cols={["Jurisdiction", "Act", "NUANS jurisdiction", "Reservation report", "Eligible"]}
          rows={(data?.jurisdictionMetadata ?? []).map((row: any) => [
            <RecordTitle title={row.label} subtitle={row.jurisdiction} />,
            row.actFormedUnder ? optionLabel("actsFormedUnder", row.actFormedUnder) : "-",
            row.nuansJurisdictionNumber || "-",
            row.nuansReservationReportTypeId || "-",
            row.incorporationServiceEligible ? "Yes" : "No",
          ])}
          empty="No jurisdiction metadata yet."
        />
      </Section>

      <Section title="Operational logs" count={data?.logs?.length ?? 0}>
        <SimpleTable
          cols={["When", "Type", "Page", "Details", "Severity"]}
          rows={(data?.logs ?? []).map((row: any) => [
            row.createdAtISO ? formatDate(row.createdAtISO) : "-",
            optionLabel("logTypes", row.logType),
            row.page || row.pageLocationUrl || "-",
            row.errorMessage || row.detailsHeading || "-",
            <Badge tone={row.severity === "error" || row.severity === "critical" ? "danger" : row.severity === "warning" ? "warn" : "neutral"}>{optionLabel("logSeverities", row.severity)}</Badge>,
          ])}
          empty="No operational logs yet."
        />
      </Section>

      <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} title={formationDraftTitle(draft)} footer={<><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}>
        {draft && <FormationDraftForm draft={draft} setDraft={setDraft} jurisdictionByCode={latestJurisdictionByCode} />}
      </Drawer>
    </div>
  );
}

function TemplateDraftForm({ draft, setDraft }: { draft: any; setDraft: (draft: any) => void }) {
  if (draft.kind === "field") {
    return (
      <>
        <Field label="Name"><input className="input" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Label"><input className="input" value={draft.label ?? ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
        <Field label="Field type"><input className="input" value={draft.fieldType ?? ""} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value })} /></Field>
        <div className="row" style={{ gap: 16 }}><label><input type="checkbox" checked={Boolean(draft.required)} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> Required</label><label><input type="checkbox" checked={Boolean(draft.reviewRequired)} onChange={(e) => setDraft({ ...draft, reviewRequired: e.target.checked })} /> Review required</label></div>
      </>
    );
  }
  if (draft.kind === "template") {
    return (
      <>
        <Field label="Name"><input className="input" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <div className="grid two"><OptionSelect label="Type" setName="templateTypes" value={draft.templateType ?? ""} onChange={(value) => setDraft({ ...draft, templateType: value })} /><OptionSelect label="Status" setName="templateStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} /></div>
        <OptionSelect label="Document tag" setName="documentTags" value={draft.documentTag ?? ""} emptyLabel="No tag" onChange={(value) => setDraft({ ...draft, documentTag: value })} />
        <OptionMultiSelect label="Jurisdictions" setName="entityJurisdictions" values={draft.jurisdictions ?? []} onChange={(values) => setDraft({ ...draft, jurisdictions: values })} />
        <OptionMultiSelect label="Entity types" setName="entityTypes" values={draft.entityTypes ?? []} onChange={(values) => setDraft({ ...draft, entityTypes: values })} />
        <OptionMultiSelect label="Required signers" setName="requiredSigners" values={draft.requiredSigners ?? []} onChange={(values) => setDraft({ ...draft, requiredSigners: values })} />
        <Field label="Required data fields"><input className="input" value={draft.requiredDataFieldsText ?? ""} onChange={(e) => setDraft({ ...draft, requiredDataFieldsText: e.target.value })} /></Field>
        <Field label="Optional data fields"><input className="input" value={draft.optionalDataFieldsText ?? ""} onChange={(e) => setDraft({ ...draft, optionalDataFieldsText: e.target.value })} /></Field>
        <Field label="Review-required data fields"><input className="input" value={draft.reviewDataFieldsText ?? ""} onChange={(e) => setDraft({ ...draft, reviewDataFieldsText: e.target.value })} /></Field>
        <Field label="Timeline"><input className="input" value={draft.timeline ?? ""} onChange={(e) => setDraft({ ...draft, timeline: e.target.value })} /></Field>
        <Field label="Deliverable"><input className="input" value={draft.deliverable ?? ""} onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })} /></Field>
        <Field label="Terms"><textarea className="textarea" value={draft.terms ?? ""} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} /></Field>
        <label><input type="checkbox" checked={Boolean(draft.signatureRequired)} onChange={(e) => setDraft({ ...draft, signatureRequired: e.target.checked })} /> Signature required</label>
      </>
    );
  }
  if (draft.kind === "precedent") {
    return (
      <>
        <Field label="Package name"><input className="input" value={draft.packageName ?? ""} onChange={(e) => setDraft({ ...draft, packageName: e.target.value })} /></Field>
        <div className="grid two"><OptionSelect label="Part type" setName="partTypes" value={draft.partType ?? ""} emptyLabel="No type" onChange={(value) => setDraft({ ...draft, partType: value })} /><OptionSelect label="Status" setName="precedentStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} /></div>
        <Field label="Short description"><input className="input" value={draft.shortDescription ?? ""} onChange={(e) => setDraft({ ...draft, shortDescription: e.target.value })} /></Field>
        <Field label="Description"><textarea className="textarea" value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        <Field label="Timeline"><input className="input" value={draft.timeline ?? ""} onChange={(e) => setDraft({ ...draft, timeline: e.target.value })} /></Field>
        <Field label="Deliverables"><textarea className="textarea" value={draft.deliverables ?? ""} onChange={(e) => setDraft({ ...draft, deliverables: e.target.value })} /></Field>
        <Field label="Price items"><input className="input" value={draft.priceItemsText ?? ""} onChange={(e) => setDraft({ ...draft, priceItemsText: e.target.value })} /></Field>
        <div className="row" style={{ gap: 16 }}><label><input type="checkbox" checked={Boolean(draft.requiresAmendmentRecord)} onChange={(e) => setDraft({ ...draft, requiresAmendmentRecord: e.target.checked })} /> Requires amendment</label><label><input type="checkbox" checked={Boolean(draft.requiresAnnualMaintenanceRecord)} onChange={(e) => setDraft({ ...draft, requiresAnnualMaintenanceRecord: e.target.checked })} /> Requires annual maintenance</label></div>
      </>
    );
  }
  if (draft.kind === "run") {
    return (
      <>
        <Field label="Run name"><input className="input" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <OptionSelect label="Status" setName="precedentRunStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
        <Field label="Event ID"><input className="input mono" value={draft.eventId ?? ""} onChange={(e) => setDraft({ ...draft, eventId: e.target.value })} /></Field>
        <Field label="Data JSON"><textarea className="textarea mono" value={draft.dataJson ?? ""} onChange={(e) => setDraft({ ...draft, dataJson: e.target.value })} /></Field>
        <label><input type="checkbox" checked={Boolean(draft.dataReviewed)} onChange={(e) => setDraft({ ...draft, dataReviewed: e.target.checked })} /> Data reviewed</label>
      </>
    );
  }
  if (draft.kind === "document") {
    return (
      <>
        <Field label="Title"><input className="input" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
        <div className="grid two"><OptionSelect label="Status" setName="generatedDocumentStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} /><OptionSelect label="Document tag" setName="documentTags" value={draft.documentTag ?? ""} emptyLabel="No tag" onChange={(value) => setDraft({ ...draft, documentTag: value })} /></div>
        <Field label="Draft URL"><input className="input" value={draft.draftFileUrl ?? ""} onChange={(e) => setDraft({ ...draft, draftFileUrl: e.target.value })} /></Field>
        <Field label="Source template name"><input className="input" value={draft.sourceTemplateName ?? ""} onChange={(e) => setDraft({ ...draft, sourceTemplateName: e.target.value })} /></Field>
        <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
        <Field label="Syngrafii package ID"><input className="input mono" value={draft.syngrafiiPackageId ?? ""} onChange={(e) => setDraft({ ...draft, syngrafiiPackageId: e.target.value })} /></Field>
        <Field label="Required signer tags"><input className="input" value={draft.signerTagsRequiredText ?? ""} onChange={(e) => setDraft({ ...draft, signerTagsRequiredText: e.target.value })} /></Field>
        <Field label="Signed signer tags"><input className="input" value={draft.signerTagsSignedText ?? ""} onChange={(e) => setDraft({ ...draft, signerTagsSignedText: e.target.value })} /></Field>
      </>
    );
  }
  return (
    <>
      <Field label="Full name"><input className="input" value={draft.fullName ?? ""} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} /></Field>
      <OptionSelect label="Status" setName="signerStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      <div className="grid two"><Field label="Email"><input className="input" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field><Field label="Phone"><input className="input" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field></div>
      <div className="grid two"><Field label="Signer ID"><input className="input mono" value={draft.signerId ?? ""} onChange={(e) => setDraft({ ...draft, signerId: e.target.value })} /></Field><Field label="Signer tag"><input className="input" value={draft.signerTag ?? ""} onChange={(e) => setDraft({ ...draft, signerTag: e.target.value })} /></Field></div>
    </>
  );
}

function FormationDraftForm({ draft, setDraft, jurisdictionByCode }: { draft: any; setDraft: (draft: any) => void; jurisdictionByCode: Map<any, any> }) {
  if (draft.kind === "formation") {
    return (
      <>
        <OptionSelect label="Status" setName="formationStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
        <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} emptyLabel="No jurisdiction" onChange={(value) => setDraft({ ...draft, jurisdiction: value })} />
        {draft.jurisdiction && jurisdictionByCode.get(draft.jurisdiction) && <div className="muted">Act: {optionLabel("actsFormedUnder", jurisdictionByCode.get(draft.jurisdiction)?.actFormedUnder)}</div>}
        <div className="grid two"><Field label="NUANS number"><input className="input" value={draft.nuansNumber ?? ""} onChange={(e) => setDraft({ ...draft, nuansNumber: e.target.value })} /></Field><Field label="NUANS date"><DatePicker value={draft.nuansDate ?? ""} onChange={(value) => setDraft({ ...draft, nuansDate: value })} /></Field></div>
        <Field label="Purpose statement"><textarea className="textarea" value={draft.purposeStatement ?? ""} onChange={(e) => setDraft({ ...draft, purposeStatement: e.target.value })} /></Field>
        <Field label="Classes of membership"><textarea className="textarea" value={draft.classesOfMembership ?? ""} onChange={(e) => setDraft({ ...draft, classesOfMembership: e.target.value })} /></Field>
        <Field label="Distribution of property"><textarea className="textarea" value={draft.distributionOfProperty ?? ""} onChange={(e) => setDraft({ ...draft, distributionOfProperty: e.target.value })} /></Field>
        <Field label="Assigned staff IDs"><input className="input" value={draft.assignedStaffIdsText ?? ""} onChange={(e) => setDraft({ ...draft, assignedStaffIdsText: e.target.value })} /></Field>
        <Field label="Signing package IDs"><input className="input mono" value={draft.signingPackageIdsText ?? ""} onChange={(e) => setDraft({ ...draft, signingPackageIdsText: e.target.value })} /></Field>
      </>
    );
  }
  if (draft.kind === "nameSearch") {
    return (
      <>
        <Field label="Name"><input className="input" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <OptionSelect label="Suffix" setName="suffixCompanyNames" value={draft.suffix ?? ""} emptyLabel="No suffix" onChange={(value) => setDraft({ ...draft, suffix: value })} />
        <div className="grid two"><Field label="Rank"><input className="input" value={draft.rank ?? ""} onChange={(e) => setDraft({ ...draft, rank: e.target.value })} /></Field><Field label="NUANS report number"><input className="input" value={draft.nuansReportNumber ?? ""} onChange={(e) => setDraft({ ...draft, nuansReportNumber: e.target.value })} /></Field></div>
        <Field label="Report URL"><input className="input" value={draft.reportUrl ?? ""} onChange={(e) => setDraft({ ...draft, reportUrl: e.target.value })} /></Field>
        <div className="row" style={{ gap: 16 }}><label><input type="checkbox" checked={Boolean(draft.success)} onChange={(e) => setDraft({ ...draft, success: e.target.checked })} /> Successful</label><label><input type="checkbox" checked={Boolean(draft.expressService)} onChange={(e) => setDraft({ ...draft, expressService: e.target.checked })} /> Express</label></div>
      </>
    );
  }
  if (draft.kind === "amendment") {
    return (
      <>
        <div className="grid two"><OptionSelect label="Status" setName="amendmentStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} /><Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field></div>
        <Field label="New entity name"><input className="input" value={draft.entityNameNew ?? ""} onChange={(e) => setDraft({ ...draft, entityNameNew: e.target.value })} /></Field>
        <div className="grid two"><Field label="Minimum directors"><input className="input" value={draft.directorsMinimum ?? ""} onChange={(e) => setDraft({ ...draft, directorsMinimum: e.target.value })} /></Field><Field label="Maximum directors"><input className="input" value={draft.directorsMaximum ?? ""} onChange={(e) => setDraft({ ...draft, directorsMaximum: e.target.value })} /></Field></div>
        <OptionSelect label="New jurisdiction" setName="entityJurisdictions" value={draft.jurisdictionNew ?? ""} emptyLabel="No jurisdiction" onChange={(value) => setDraft({ ...draft, jurisdictionNew: value })} />
        <Field label="Rights class amendment"><textarea className="textarea" value={draft.shareClassAmendmentText ?? ""} onChange={(e) => setDraft({ ...draft, shareClassAmendmentText: e.target.value })} /></Field>
      </>
    );
  }
  if (draft.kind === "annual") {
    return (
      <>
        <div className="grid two"><OptionSelect label="Status" setName="annualMaintenanceStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} /><Field label="Filing year"><input className="input" value={draft.yearFilingFor ?? ""} onChange={(e) => setDraft({ ...draft, yearFilingFor: e.target.value })} /></Field></div>
        <div className="grid two"><Field label="Last AGM date"><DatePicker value={draft.lastAgmDate ?? ""} onChange={(value) => setDraft({ ...draft, lastAgmDate: value })} /></Field><Field label="Filing date"><DatePicker value={draft.filingDate ?? ""} onChange={(value) => setDraft({ ...draft, filingDate: value })} /></Field></div>
        <OptionSelect label="Financial statement option" setName="annualFinancialStatementOptions" value={draft.annualFinancialStatementOption ?? ""} emptyLabel="No option" onChange={(value) => setDraft({ ...draft, annualFinancialStatementOption: value })} />
        <div className="grid two"><Field label="Fiscal year end"><DatePicker value={draft.fiscalYearEndDate ?? ""} onChange={(value) => setDraft({ ...draft, fiscalYearEndDate: value })} /></Field><Field label="Income tax return date"><DatePicker value={draft.incomeTaxReturnDate ?? ""} onChange={(value) => setDraft({ ...draft, incomeTaxReturnDate: value })} /></Field></div>
        <Field label="Authorizing phone"><input className="input" value={draft.authorizingPhone ?? ""} onChange={(e) => setDraft({ ...draft, authorizingPhone: e.target.value })} /></Field>
        <div className="row" style={{ gap: 16 }}><label><input type="checkbox" checked={Boolean(draft.auditedFinancialStatements)} onChange={(e) => setDraft({ ...draft, auditedFinancialStatements: e.target.checked })} /> Audited this year</label><label><input type="checkbox" checked={Boolean(draft.auditedFinancialStatementsNextYear)} onChange={(e) => setDraft({ ...draft, auditedFinancialStatementsNextYear: e.target.checked })} /> Audit next year</label></div>
      </>
    );
  }
  if (draft.kind === "jurisdiction") {
    return (
      <>
        <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} />
        <Field label="Label"><input className="input" value={draft.label ?? ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
        <OptionSelect label="Act formed under" setName="actsFormedUnder" value={draft.actFormedUnder ?? ""} emptyLabel="No act" onChange={(value) => setDraft({ ...draft, actFormedUnder: value })} />
        <div className="grid two"><Field label="NUANS jurisdiction number"><input className="input" value={draft.nuansJurisdictionNumber ?? ""} onChange={(e) => setDraft({ ...draft, nuansJurisdictionNumber: e.target.value })} /></Field><Field label="Reservation report type ID"><input className="input" value={draft.nuansReservationReportTypeId ?? ""} onChange={(e) => setDraft({ ...draft, nuansReservationReportTypeId: e.target.value })} /></Field></div>
        <label><input type="checkbox" checked={Boolean(draft.incorporationServiceEligible)} onChange={(e) => setDraft({ ...draft, incorporationServiceEligible: e.target.checked })} /> Incorporation-service eligible</label>
      </>
    );
  }
  return (
    <>
      <div className="grid two"><OptionSelect label="Log type" setName="logTypes" value={draft.logType ?? ""} onChange={(value) => setDraft({ ...draft, logType: value })} /><OptionSelect label="Severity" setName="logSeverities" value={draft.severity ?? ""} onChange={(value) => setDraft({ ...draft, severity: value })} /></div>
      <Field label="Page"><input className="input" value={draft.page ?? ""} onChange={(e) => setDraft({ ...draft, page: e.target.value })} /></Field>
      <Field label="URL"><input className="input" value={draft.pageLocationUrl ?? ""} onChange={(e) => setDraft({ ...draft, pageLocationUrl: e.target.value })} /></Field>
      <Field label="Error code"><input className="input" value={draft.errorCode ?? ""} onChange={(e) => setDraft({ ...draft, errorCode: e.target.value })} /></Field>
      <Field label="Error message"><textarea className="textarea" value={draft.errorMessage ?? ""} onChange={(e) => setDraft({ ...draft, errorMessage: e.target.value })} /></Field>
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card__head"><h2 className="card__title">{title}</h2><Badge>{count}</Badge></div>
      {children}
    </div>
  );
}

function SimpleTable({ cols, rows, empty }: { cols: string[]; rows: any[][]; empty: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{cols.map((col) => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
          {rows.length === 0 && <EmptyRow cols={cols.length} label={empty} />}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return <tr><td colSpan={cols} className="muted" style={{ textAlign: "center", padding: 24 }}>{label}</td></tr>;
}

function RecordTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <><strong>{title}</strong><div className="muted">{subtitle || "-"}</div></>;
}

function RowActions({ onEdit, onDelete, label }: { onEdit: () => void; onDelete: () => void; label: string }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn btn--ghost btn--sm" onClick={onEdit}>Edit</button>
      <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete ${label}`} onClick={onDelete}><Trash2 size={12} /></button>
    </div>
  );
}

function draftTitle(draft?: any) {
  if (!draft) return "";
  return {
    field: "Template data field",
    template: "Legal template",
    precedent: "Legal precedent",
    run: "Legal package run",
    document: "Generated document",
    signer: "Legal signer",
  }[draft.kind] ?? "Template engine record";
}

function formationDraftTitle(draft?: any) {
  if (!draft) return "";
  return {
    formation: "Formation record",
    nameSearch: "Name search",
    amendment: "Entity amendment",
    annual: "Annual maintenance",
    jurisdiction: "Jurisdiction metadata",
    log: "Operational log",
  }[draft.kind] ?? "Formation record";
}

function editRoleHolder(row: any) {
  return {
    ...row,
    citizenshipCountriesText: (row.citizenshipCountries ?? []).join(", "),
    taxResidenceCountriesText: (row.taxResidenceCountries ?? []).join(", "),
    relatedShareholderIdsText: (row.relatedShareholderIds ?? []).join(", "),
    controllingIndividualIdsText: (row.controllingIndividualIds ?? []).join(", "),
    sourceExternalIdsText: (row.sourceExternalIds ?? []).join(", "),
  };
}

function editRightsClass(row: any) {
  return { ...row, sourceExternalIdsText: (row.sourceExternalIds ?? []).join(", ") };
}

function editTransfer(row: any) {
  return {
    ...row,
    priceToOrganization: row.priceToOrganizationCents != null ? String(row.priceToOrganizationCents / 100) : "",
    priceToVendor: row.priceToVendorCents != null ? String(row.priceToVendorCents / 100) : "",
    sourceExternalIdsText: (row.sourceExternalIds ?? []).join(", "),
  };
}

function csv(value: any) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function empty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cents(value: unknown) {
  const number = numberOrUndefined(value);
  return number == null ? undefined : Math.round(number * 100);
}

function dateLabel(value?: string) {
  return value ? formatDate(value) : "-";
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (/(active|current|complete|final|signed|processed|posted|filed|ready|approved)/.test(value)) return "success" as const;
  if (/(draft|review|proposed|generating|signing|name_search|filing|organizing)/.test(value)) return "warn" as const;
  if (/(void|cancel|inactive|former|error|critical)/.test(value)) return "danger" as const;
  return "neutral" as const;
}
