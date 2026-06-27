import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { OptionMultiSelect, OptionSelect } from "../components/OptionSelect";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { BookTemplate, FileSignature, Landmark, Plus, Scale, Trash2, UserCheck, UsersRound } from "lucide-react";
import { formatDate } from "../lib/format";
import { optionLabel } from "../lib/orgHubOptions";
import { StructuredAddressFields } from "../components/StructuredAddressFields";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  homeJurisdictionCode,
  isCorporation,
  organizationLabel,
} from "../../shared/organizationDomain";
import { jurisdictionDisplayCopy } from "../../shared/jurisdictionWorkspace";
import { deriveCurrentHoldings } from "../lib/equity";

export function RoleHoldersPage() {
  const society = useSociety();
  const rows = useQuery(api.legalOperations.listRoleHolders, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.legalOperations.upsertRoleHolder);
  const remove = useMutation(api.legalOperations.removeRoleHolder);
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const history = useQuery(
    api.roleHolderHistory.revisionHistory,
    historyId ? { roleHolderId: historyId as any } : "skip",
  ) as any[] | undefined;
  const auditDiff = useQuery(
    api.roleHolderHistory.changesBetween,
    society && auditFrom && auditTo
      ? { societyId: society._id, fromISO: `${auditFrom}T00:00:00`, toISO: `${auditTo}T23:59:59` }
      : "skip",
  ) as Array<{ op: string; key: string; name: string }> | undefined;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const corporationWorkspace = isCorporation(society);
  const jurisdictionCopy = jurisdictionDisplayCopy(homeJurisdictionCode(society));
  const roleSummary = summarizeCorporationRoles(rows ?? []);
  const openNew = (roleType = corporationWorkspace ? "director" : "authorized_representative") =>
    setDraft(defaultRoleHolderDraft(roleType, corporationWorkspace));
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
      gender: empty(draft.gender),
      pronouns: empty(draft.pronouns),
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
        title={corporationWorkspace ? "Corporation people" : "Role-holder register"}
        icon={<UsersRound size={16} />}
        iconColor="blue"
        subtitle={
          corporationWorkspace
            ? `Directors, officers, shareholders, controllers, and authorized filers for ${organizationLabel(society)}.`
            : "Canonical register for directors, officers, incorporators, attorneys for service, authorized representatives, members, rightsholders, and control relationships."
        }
        actions={
          <div className="row" style={{ flexWrap: "wrap" }}>
            {corporationWorkspace && (
              <>
                <button className="btn-action" onClick={() => openNew("officer")}><Plus size={12} /> Officer</button>
                <button className="btn-action" onClick={() => openNew("shareholder")}><Plus size={12} /> Shareholder</button>
                <button className="btn-action" onClick={() => openNew("controller")}><Plus size={12} /> Controller</button>
              </>
            )}
            <button className="btn-action btn-action--primary" onClick={() => openNew()}>
              <Plus size={12} /> {corporationWorkspace ? "Director" : "New holder"}
            </button>
          </div>
        }
      />

      {corporationWorkspace && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <span className="stat-card__label">Directors</span>
              <strong>{roleSummary.directors}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Officers</span>
              <strong>{roleSummary.officers}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Shareholders</span>
              <strong>{roleSummary.shareholders}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Controllers</span>
              <strong>{roleSummary.controllers}</strong>
            </div>
          </div>

          <section className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <div>
                <h2 className="card__title">{jurisdictionCopy.entityLabel} register</h2>
                <span className="card__subtitle">
                  {homeJurisdictionCode(society)} people register. Link shareholders to the share register once shares are issued.
                </span>
              </div>
              <Link className="btn-action" to="/app/rights-ledger">
                <UserCheck size={12} /> Open share register
              </Link>
            </div>
            <div className="card__body">
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Badge tone={roleSummary.directors ? "success" : "warn"}>{roleSummary.directors ? "Directors recorded" : "Add directors"}</Badge>
                <Badge tone={roleSummary.officers ? "success" : "neutral"}>{roleSummary.officers ? "Officers recorded" : "Add officers"}</Badge>
                <Badge tone={roleSummary.shareholders ? "success" : "warn"}>{roleSummary.shareholders ? "Shareholders recorded" : "Add shareholders"}</Badge>
                <Badge tone={roleSummary.controllers ? "success" : "neutral"}>{roleSummary.controllers ? "Controllers recorded" : "Add controllers"}</Badge>
                <Badge tone={roleSummary.authorizedFilers ? "success" : "neutral"}>{roleSummary.authorizedFilers ? "Authorized filers recorded" : "Add authorized filers"}</Badge>
              </div>
            </div>
          </section>
        </>
      )}

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
                      <button className="btn btn--ghost btn--sm" onClick={() => setHistoryId(row._id)}>History</button>
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

      <Section title="Audit trail — changes between two dates" count={(auditDiff ?? []).filter((d) => d.op !== "unchanged").length}>
        <div className="card__body">
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="From"><DatePicker value={auditFrom} onChange={(value) => setAuditFrom(value)} /></Field>
            <Field label="To"><DatePicker value={auditTo} onChange={(value) => setAuditTo(value)} /></Field>
          </div>
          {auditFrom && auditTo && (
            <ul style={{ marginTop: 12 }}>
              {(auditDiff ?? []).filter((d) => d.op !== "unchanged").map((d) => (
                <li key={d.key}>
                  <Badge tone={d.op === "new" ? "success" : d.op === "delete" ? "danger" : "warn"}>{d.op}</Badge>{" "}
                  {d.name || d.key}
                </li>
              ))}
              {(auditDiff ?? []).filter((d) => d.op !== "unchanged").length === 0 && (
                <li className="muted">No changes to the register in this window.</li>
              )}
            </ul>
          )}
        </div>
      </Section>

      <Drawer
        open={Boolean(historyId)}
        onClose={() => setHistoryId(null)}
        title="Edit history"
      >
        {historyId && (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              Every edit appends a version. "Who" is client-asserted (this backend has no
              auth yet), so treat the actor as advisory until auth is added.
            </p>
            {(history ?? []).slice().reverse().map((version, idx) => (
              <div key={idx} className="card" style={{ marginBottom: 10, padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{formatDate(version.enteredAtISO)}</strong>
                  {version.isCurrent ? <Badge tone="success">current</Badge> : <Badge tone="neutral">superseded</Badge>}
                </div>
                <div className="muted">by {version.enteredByUserId || "unknown"}</div>
                <ul style={{ marginTop: 8, marginBottom: 0 }}>
                  {(version.changes ?? []).map((c: any) => (
                    <li key={c.field}>
                      <code>{c.field}</code>: {formatChangeValue(c.from)} → {formatChangeValue(c.to)}
                    </li>
                  ))}
                  {(version.changes ?? []).length === 0 && <li className="muted">No tracked field changes.</li>}
                </ul>
              </div>
            ))}
            {history && history.length === 0 && <p className="muted">No history recorded yet.</p>}
          </div>
        )}
      </Drawer>

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
              <Field label="Gender (for document grammar)">
                <Select value={draft.gender ?? ""} onChange={(value) => setDraft({ ...draft, gender: value })}
                  options={[{ value: "", label: "—" }, { value: "M", label: "Male (he/his)" }, { value: "F", label: "Female (she/her)" }, { value: "X", label: "Neutral (they/their)" }]} />
              </Field>
              <Field label="Stated pronouns (override gender)"><input className="input" placeholder="e.g. they/them, xe/xir" value={draft.pronouns ?? ""} onChange={(e) => setDraft({ ...draft, pronouns: e.target.value })} /></Field>
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
            <Field label="Nature of control"><MarkdownEditor rows={4} value={draft.natureOfControl ?? ""} onChange={(markdown) => setDraft({ ...draft, natureOfControl: markdown })} /></Field>
            <StructuredAddressFields value={draft} onChange={(address) => setDraft({ ...draft, ...address })} />
            <Field label="Service address"><input className="input" value={draft.serviceStreet ?? ""} onChange={(e) => setDraft({ ...draft, serviceStreet: e.target.value })} /></Field>
            <Field label="Related shareholder/controller IDs"><input className="input" value={draft.relatedShareholderIdsText ?? ""} onChange={(e) => setDraft({ ...draft, relatedShareholderIdsText: e.target.value })} /></Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

export function RightsLedgerPage() {
  const society = useSociety();
  // As-of date (YYYY-MM-DD); "" = live. Reconstructs the cap table at a past date.
  const [asOf, setAsOf] = useState<string>("");
  const [holderDrill, setHolderDrill] = useState<string | null>(null);
  const ledgerArgs = society ? { societyId: society._id, ...(asOf ? { asOf } : {}) } : "skip";
  const data = useQuery(api.legalOperations.rightsLedger, ledgerArgs);
  const voting = useQuery(api.legalOperations.votingPower, ledgerArgs) as
    | { voting: any[]; nonVoting: any[]; eligibleSigners: any[]; totalVotes: number }
    | undefined;
  const upsertClass = useMutation(api.legalOperations.upsertRightsClass);
  const upsertTransfer = useMutation(api.legalOperations.upsertRightsholdingTransfer);
  const stageShareIssuancePacket = useMutation(api.legalOperations.stageShareIssuancePacket);
  const stageShareSplit = useMutation(api.legalOperations.stageShareSplitPacket);
  const removeClass = useMutation(api.legalOperations.removeRightsClass);
  const removeTransfer = useMutation(api.legalOperations.removeRightsholdingTransfer);
  const toast = useToast();
  const confirm = useConfirm();
  const [classDraft, setClassDraft] = useState<any>(null);
  const [transferDraft, setTransferDraft] = useState<any>(null);
  const [splitDraft, setSplitDraft] = useState<any>(null);
  const currentHoldings = useMemo(() => deriveCurrentHoldings(data?.transfers ?? []), [data?.transfers]);
  const corporationWorkspace = society ? isCorporation(society) : false;

  if (society === undefined) return <PageLoading />;
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
      votesPerShare: numberOrUndefined(classDraft.votesPerShare),
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
      eventId: empty(transferDraft.eventId),
      precedentRunId: empty(transferDraft.precedentRunId) as any,
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
      sourceDocumentIds: transferDraft.sourceDocumentIds ?? [],
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

  const stageIssuancePacket = async (row: any) => {
    await stageShareIssuancePacket({
      societyId: society._id,
      transferId: row._id,
      notes: `Staged from share register issuance ${row._id}.`,
    });
    toast.success("Packet staged", "The share issuance packet is ready in Template Engine.");
  };

  const runSplit = async () => {
    if (!splitDraft) return;
    const numerator = Number(splitDraft.numerator);
    const denominator = Number(splitDraft.denominator);
    try {
      const result: any = await stageShareSplit({
        societyId: society._id,
        rightsClassId: splitDraft.rightsClassId,
        numerator,
        denominator,
      });
      setSplitDraft(null);
      toast.success(
        "Split staged",
        `${result.ratioLabel}: ${result.totalBefore} → ${result.totalAfter} shares.${
          result.sharesDropped ? ` ${result.sharesDropped} share(s) dropped to rounding.` : ""
        } Resolution ready in Template Engine.`,
      );
    } catch (err: any) {
      toast.error("Could not stage split", err?.message ?? String(err));
    }
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title={corporationWorkspace ? "Share register" : "Rights ledger"}
        icon={<Scale size={16} />}
        iconColor="purple"
        subtitle={
          corporationWorkspace
            ? "Share classes, current holdings, issuance, transfers, redemptions, cancellations, and supporting evidence."
            : "Membership/right classes plus current holdings, issuance, transfer, redemption, cancellation, and adjustment history."
        }
        actions={
          <div className="row" style={{ alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Reconstruct the register at a past date">
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>As of</span>
              <DatePicker value={asOf} onChange={(value) => setAsOf(value)} style={{ width: 150 }} />
              {asOf && <button className="btn btn--ghost btn--sm" onClick={() => setAsOf("")} title="Back to live">Live</button>}
            </label>
            <button className="btn-action" onClick={() => setTransferDraft({ transferType: corporationWorkspace ? "issuance" : "transfer", status: "draft", priceToOrganizationCurrency: "cad", priceToVendorCurrency: "cad" })}><Plus size={12} /> {corporationWorkspace ? "Issuance" : "Transfer"}</button>
            <button className="btn-action btn-action--primary" onClick={() => setClassDraft({ classType: corporationWorkspace ? "share" : "membership", status: "active" })}><Plus size={12} /> {corporationWorkspace ? "Share class" : "Class"}</button>
          </div>
        }
      />
      {asOf && (
        <div className="muted" style={{ marginBottom: 12 }}>
          Showing the register as it stood on <strong>{asOf}</strong>. Issuance, transfers, and holdings reflect that date.
        </div>
      )}

      <Section title={corporationWorkspace ? "Share classes" : "Rights and membership classes"} count={data?.classes?.length ?? 0}>
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
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {row.classType === "share" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => setSplitDraft({ rightsClassId: row._id, className: row.className, numerator: 2, denominator: 1 })}>Split</button>
                      )}
                      <RowActions onEdit={() => setClassDraft(editRightsClass(row))} onDelete={() => deleteRow("class", row)} label="rights class" />
                    </div>
                  </td>
                </tr>
              ))}
              {(data?.classes ?? []).length === 0 && <EmptyRow cols={6} label="No rights classes yet." />}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={corporationWorkspace ? "Current share holdings" : "Current holdings"} count={currentHoldings.length}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Holder</th><th>Class</th><th>Quantity</th><th>Source</th></tr></thead>
            <tbody>
              {currentHoldings.map((holding: any) => {
                const rightsClass = data?.classes?.find((item: any) => item._id === holding.rightsClassId);
                const holder = roleHolderForHolding(data?.roleHolders ?? [], holding.holderKey);
                return (
                  <tr key={`${holding.rightsClassId}:${holding.holderKey}`}>
                    <td>
                      <button className="btn-link" onClick={() => setHolderDrill(holding.holderKey)} style={{ font: "inherit" }}>
                        <strong>{holder?.fullName || holding.holderKey}</strong>
                      </button>
                      <div className="muted">{holder?.roleType ? optionLabel("representativeTypes", holder.roleType) : "Unlinked holder"}</div>
                    </td>
                    <td>{rightsClass?.className || holding.rightsClassId}<div className="muted">{rightsClass?.classType ? optionLabel("rightsClassTypes", rightsClass.classType) : "No class record"}</div></td>
                    <td>{holding.quantity}</td>
                    <td><Badge tone="success">Posted ledger</Badge></td>
                  </tr>
                );
              })}
              {currentHoldings.length === 0 && <EmptyRow cols={4} label={corporationWorkspace ? "No posted share holdings yet." : "No posted holdings yet."} />}
            </tbody>
          </table>
        </div>
      </Section>

      {corporationWorkspace && (
        <Section
          title="Voting power"
          count={voting?.voting?.length ?? 0}
        >
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Shareholder</th><th>Shares</th><th>% shares</th><th>Votes</th><th>% votes</th><th>Eligible to sign</th></tr></thead>
              <tbody>
                {(voting?.voting ?? []).map((h: any) => (
                  <tr key={h.holderKey}>
                    <td>
                      <button className="btn-link" onClick={() => setHolderDrill(h.holderKey)} style={{ font: "inherit" }}>
                        <strong>{h.holderName}</strong>
                      </button>
                    </td>
                    <td>{h.totalShares}</td>
                    <td>{(h.percentOfShares ?? 0).toFixed(1)}%</td>
                    <td>{h.totalVotes}</td>
                    <td>{(h.percentOfVotes ?? 0).toFixed(1)}%</td>
                    <td>{h.isEligibleSignatory ? <Badge tone="success">Eligible</Badge> : <Badge tone="warn">Not eligible</Badge>}</td>
                  </tr>
                ))}
                {(voting?.voting ?? []).length === 0 && <EmptyRow cols={6} label="No voting shareholders yet." />}
                {(voting?.nonVoting ?? []).map((h: any) => (
                  <tr key={h.holderKey} className="muted">
                    <td>{h.holderName}</td>
                    <td>{h.totalShares}</td>
                    <td>{(h.percentOfShares ?? 0).toFixed(1)}%</td>
                    <td>0 (non-voting)</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Total votes: {voting?.totalVotes ?? 0} · Eligible voting signatories:{" "}
            {voting?.eligibleSigners?.length ?? 0} (natural persons at the age of majority). Set a class's
            votes per share to weight the roll-up; otherwise it is inferred from the voting text.
          </div>
        </Section>
      )}

      <Section title="Holding and transfer events" count={data?.transfers?.length ?? 0}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Class</th><th>From</th><th>To</th><th>Quantity</th><th>Status</th><th>Evidence</th><th /></tr></thead>
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
                    <td>
                      {row.precedentRunId ? (
                        <Link className="btn btn--sm" to="/app/template-engine"><BookTemplate size={12} /> Packet</Link>
                      ) : corporationWorkspace && row.transferType === "issuance" ? (
                        <button className="btn btn--sm" onClick={() => stageIssuancePacket(row)}>
                          <BookTemplate size={12} /> Packet
                        </button>
                      ) : (
                        <span className="muted">No packet</span>
                      )}
                    </td>
                    <td><RowActions onEdit={() => setTransferDraft(editTransfer(row))} onDelete={() => deleteRow("transfer", row)} label="ledger transfer" /></td>
                  </tr>
                );
              })}
              {(data?.transfers ?? []).length === 0 && <EmptyRow cols={9} label="No holding transfers yet." />}
            </tbody>
          </table>
        </div>
      </Section>

      <Drawer
        open={Boolean(splitDraft)}
        onClose={() => setSplitDraft(null)}
        title={`Subdivide / consolidate ${splitDraft?.className ?? "shares"}`}
        footer={<><button className="btn" onClick={() => setSplitDraft(null)}>Cancel</button><button className="btn btn--accent" onClick={runSplit}>Stage split</button></>}
      >
        {splitDraft && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Each holder's count becomes <code>shares × numerator ÷ denominator</code> (rounded
              down). e.g. 2 / 1 = a 2-for-1 subdivision; 1 / 3 = a 1-for-3 consolidation. This posts
              adjusted holdings and stages an editable resolution with a before/after table.
            </p>
            <div className="grid two">
              <Field label="Numerator (new)"><input className="input" type="number" min={1} value={splitDraft.numerator} onChange={(e) => setSplitDraft({ ...splitDraft, numerator: e.target.value })} /></Field>
              <Field label="Denominator (old)"><input className="input" type="number" min={1} value={splitDraft.denominator} onChange={(e) => setSplitDraft({ ...splitDraft, denominator: e.target.value })} /></Field>
            </div>
          </>
        )}
      </Drawer>

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
              <Field label="Votes per share"><input className="input" type="number" min="0" value={classDraft.votesPerShare ?? ""} onChange={(e) => setClassDraft({ ...classDraft, votesPerShare: e.target.value })} placeholder="e.g. 1" /></Field>
            </div>
            <Field label="Voting rights"><MarkdownEditor rows={4} value={classDraft.votingRights ?? ""} onChange={(markdown) => setClassDraft({ ...classDraft, votingRights: markdown })} /></Field>
            <Field label="Holding conditions"><MarkdownEditor rows={4} value={classDraft.conditionsToHold ?? ""} onChange={(markdown) => setClassDraft({ ...classDraft, conditionsToHold: markdown })} /></Field>
            <Field label="Transfer conditions"><MarkdownEditor rows={4} value={classDraft.conditionsToTransfer ?? ""} onChange={(markdown) => setClassDraft({ ...classDraft, conditionsToTransfer: markdown })} /></Field>
            <Field label="Other provisions"><MarkdownEditor rows={4} value={classDraft.otherProvisions ?? ""} onChange={(markdown) => setClassDraft({ ...classDraft, otherProvisions: markdown })} /></Field>
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
              <Select value={transferDraft.rightsClassId ?? ""} onChange={(value) => setTransferDraft({ ...transferDraft, rightsClassId: value || undefined })}
                options={[{ value: "", label: "No class" }, ...(data?.classes ?? []).map((row: any) => ({ value: row._id, label: row.className }))]} />
            </Field>
            <div className="grid two">
              <Field label="Source holder"><input className="input" value={transferDraft.sourceHolderName ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, sourceHolderName: e.target.value })} /></Field>
              <Field label="Destination holder"><input className="input" value={transferDraft.destinationHolderName ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, destinationHolderName: e.target.value })} /></Field>
            </div>
            <div className="grid two">
              <Field label="Quantity"><input className="input" value={transferDraft.quantity ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, quantity: e.target.value })} /></Field>
              <Field label="Consideration type"><input className="input" value={transferDraft.considerationType ?? ""} onChange={(e) => setTransferDraft({ ...transferDraft, considerationType: e.target.value })} /></Field>
            </div>
            <Field label="Consideration description"><MarkdownEditor rows={4} value={transferDraft.considerationDescription ?? ""} onChange={(markdown) => setTransferDraft({ ...transferDraft, considerationDescription: markdown })} /></Field>
          </>
        )}
      </Drawer>

      <Drawer
        open={Boolean(holderDrill)}
        onClose={() => setHolderDrill(null)}
        title="Shareholder"
        footer={<button className="btn" onClick={() => setHolderDrill(null)}>Close</button>}
      >
        {holderDrill && (() => {
          const holder = roleHolderForHolding(data?.roleHolders ?? [], holderDrill);
          const holderName = holder?.fullName || holderDrill;
          const holdings = currentHoldings.filter((h: any) => h.holderKey === holderDrill);
          const votingRow = [...(voting?.voting ?? []), ...(voting?.nonVoting ?? [])]
            .find((h: any) => h.holderKey === holderDrill);
          const totalAll = currentHoldings.reduce((sum: number, h: any) => sum + (Number(h.quantity) || 0), 0);
          const holderShares = holdings.reduce((sum: number, h: any) => sum + (Number(h.quantity) || 0), 0);
          const pctShares = votingRow?.percentOfShares ?? (totalAll > 0 ? (holderShares / totalAll) * 100 : 0);
          const roleHolderId = holderDrill.startsWith("roleHolder:") ? holderDrill.slice("roleHolder:".length) : null;
          const holderTransfers = (data?.transfers ?? []).filter((t: any) =>
            (roleHolderId && (t.sourceRoleHolderId === roleHolderId || t.destinationRoleHolderId === roleHolderId)) ||
            t.sourceHolderName === holderName || t.destinationHolderName === holderName,
          );
          return (
            <div className="col" style={{ gap: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>{holderName}</h3>
                <div className="muted">
                  {holder?.roleType ? optionLabel("representativeTypes", holder.roleType) : "Unlinked holder"}
                  {asOf ? ` · as of ${asOf}` : ""}
                </div>
              </div>

              <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                <div><div className="muted" style={{ fontSize: "var(--fs-sm)" }}>Shares</div><strong style={{ fontSize: "var(--fs-lg)" }}>{holderShares}</strong></div>
                <div><div className="muted" style={{ fontSize: "var(--fs-sm)" }}>% shares</div><strong style={{ fontSize: "var(--fs-lg)" }}>{pctShares.toFixed(1)}%</strong></div>
                {votingRow && (
                  <>
                    <div><div className="muted" style={{ fontSize: "var(--fs-sm)" }}>Votes</div><strong style={{ fontSize: "var(--fs-lg)" }}>{votingRow.totalVotes}</strong></div>
                    <div><div className="muted" style={{ fontSize: "var(--fs-sm)" }}>% votes</div><strong style={{ fontSize: "var(--fs-lg)" }}>{(votingRow.percentOfVotes ?? 0).toFixed(1)}%</strong></div>
                  </>
                )}
              </div>

              <div>
                <h4 style={{ margin: "0 0 6px" }}>Holdings by class</h4>
                <table className="table">
                  <thead><tr><th>Class</th><th>Quantity</th></tr></thead>
                  <tbody>
                    {holdings.map((h: any) => {
                      const rc = data?.classes?.find((c: any) => c._id === h.rightsClassId);
                      return <tr key={h.rightsClassId}><td>{rc?.className || h.rightsClassId}</td><td>{h.quantity}</td></tr>;
                    })}
                    {holdings.length === 0 && <EmptyRow cols={2} label="No holdings on this date." />}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 style={{ margin: "0 0 6px" }}>Transfer history</h4>
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th>Class</th><th>From → To</th><th>Qty</th></tr></thead>
                  <tbody>
                    {holderTransfers.map((t: any) => {
                      const rc = data?.classes?.find((c: any) => c._id === t.rightsClassId);
                      const src = data?.roleHolders?.find((r: any) => r._id === t.sourceRoleHolderId);
                      const dst = data?.roleHolders?.find((r: any) => r._id === t.destinationRoleHolderId);
                      return (
                        <tr key={t._id}>
                          <td>{dateLabel(t.transferDate)}</td>
                          <td>{optionLabel("rightsholdingTransferTypes", t.transferType)}</td>
                          <td>{rc?.className || "—"}</td>
                          <td>{(src?.fullName || t.sourceHolderName || "Treasury")} → {(dst?.fullName || t.destinationHolderName || "—")}</td>
                          <td>{t.quantity ?? "—"}</td>
                        </tr>
                      );
                    })}
                    {holderTransfers.length === 0 && <EmptyRow cols={5} label="No transfers recorded for this holder." />}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
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
  const seedCorporationPackets = useMutation(api.legalOperations.seedCorporationDocumentPackets);
  const removeTemplate = useMutation(api.legalOperations.removeLegalTemplate);
  const removePrecedent = useMutation(api.legalOperations.removeLegalPrecedent);
  const removeDocument = useMutation(api.legalOperations.removeGeneratedLegalDocument);
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const del = async (remover: (args: { id: any }) => Promise<unknown>, id: any, label: string) => {
    const ok = await confirm({
      title: `Delete ${label}?`,
      message: `This permanently removes the ${label}. This can't be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remover({ id });
    toast.success(`${label[0].toUpperCase()}${label.slice(1)} deleted`);
  };

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

  const addCorporationPackets = async () => {
    const result = await seedCorporationPackets({ societyId: society._id });
    const changed = result.insertedTemplates + result.updatedTemplates + result.insertedPrecedents + result.updatedPrecedents;
    toast.success(
      changed
        ? `Seeded ${result.insertedTemplates} templates and ${result.insertedPrecedents} precedents`
        : "Corporation packets already exist",
      `${result.total} packet definitions checked.`,
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
            <button className="btn-action" onClick={addCorporationPackets}><FileSignature size={12} /> Corporation packets</button>
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
          cols={["Name", "Type", "Coverage", "Signing", "Status", ""]}
          rows={(data?.templates ?? []).map((row: any) => [
            <RecordTitle title={row.name} subtitle={row.owner || row.documentTag || "No owner/tag"} />,
            optionLabel("templateTypes", row.templateType),
            `${row.jurisdictions?.length || 0} jurisdictions / ${row.entityTypes?.length || 0} entity types`,
            row.signatureRequired ? `${row.requiredSigners?.length || 0} signer rules` : "No signature",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("templateStatuses", row.status)}</Badge>,
            <DeleteCell label="template" onDelete={() => del(removeTemplate, row._id, "template")} />,
          ])}
          empty="No templates yet."
        />
      </Section>

      <Section title="Precedents and runs" count={(data?.precedents?.length ?? 0) + (data?.runs?.length ?? 0)}>
        <SimpleTable
          cols={["Package", "Timeline", "Deliverables", "Terms", "Status", ""]}
          rows={(data?.precedents ?? []).map((row: any) => [
            <RecordTitle title={row.packageName} subtitle={row.shortDescription || row.partType || "No short description"} />,
            row.timeline || "-",
            row.deliverables || "-",
            row.addOnTerms || "-",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("precedentStatuses", row.status)}</Badge>,
            <DeleteCell label="precedent" onDelete={() => del(removePrecedent, row._id, "precedent")} />,
          ])}
          empty="No precedents yet."
        />
      </Section>

      <Section title="Generated documents and signers" count={(data?.generatedDocuments?.length ?? 0) + (data?.signers?.length ?? 0)}>
        <SimpleTable
          cols={["Document", "Template", "Signing package", "Signers", "Status", ""]}
          rows={(data?.generatedDocuments ?? []).map((row: any) => [
            <RecordTitle title={row.title} subtitle={dateLabel(row.effectiveDate)} />,
            row.sourceTemplateName || "-",
            row.syngrafiiPackageId || row.syngrafiiDocumentId || "-",
            `${row.signerTagsSigned?.length || 0}/${row.signerTagsRequired?.length || 0}`,
            <Badge tone={toneForStatus(row.status)}>{optionLabel("generatedDocumentStatuses", row.status)}</Badge>,
            <DeleteCell label="document" onDelete={() => del(removeDocument, row._id, "document")} />,
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
  const removeFormation = useMutation(api.legalOperations.removeFormationRecord);
  const removeAnnual = useMutation(api.legalOperations.removeAnnualMaintenanceRecord);
  const removeJurisdiction = useMutation(api.legalOperations.removeJurisdictionMetadata);
  const removeLog = useMutation(api.legalOperations.removeSupportLog);
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<any>(null);
  const del = async (remover: (args: { id: any }) => Promise<unknown>, id: any, label: string) => {
    const ok = await confirm({
      title: `Delete ${label}?`,
      message: `This permanently removes the ${label}. This can't be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remover({ id });
    toast.success(`${label[0].toUpperCase()}${label.slice(1)} deleted`);
  };
  const latestJurisdictionByCode = useMemo(
    () => new Map((data?.jurisdictionMetadata ?? []).map((row: any) => [row.jurisdiction, row])),
    [data],
  );

  if (society === undefined) return <PageLoading />;
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
          cols={["NUANS", "Jurisdiction", "Purpose/classes", "Staff/signing", "Status", ""]}
          rows={(data?.formations ?? []).map((row: any) => [
            <RecordTitle title={row.nuansNumber || "No NUANS"} subtitle={dateLabel(row.nuansDate)} />,
            row.jurisdiction ? optionLabel("entityJurisdictions", row.jurisdiction) : "-",
            row.purposeStatement || row.classesOfMembership || "-",
            `${row.assignedStaffIds?.length || 0} staff / ${row.signingPackageIds?.length || 0} packages`,
            <Badge tone={toneForStatus(row.status)}>{optionLabel("formationStatuses", row.status)}</Badge>,
            <DeleteCell label="formation record" onDelete={() => del(removeFormation, row._id, "formation record")} />,
          ])}
          empty="No formation records yet."
        />
      </Section>

      <Section title="Annual maintenance" count={data?.annualRecords?.length ?? 0}>
        <SimpleTable
          cols={["Year", "AGM", "Filing", "Financial statement", "Status", ""]}
          rows={(data?.annualRecords ?? []).map((row: any) => [
            row.yearFilingFor || "-",
            dateLabel(row.lastAgmDate),
            dateLabel(row.filingDate),
            row.annualFinancialStatementOption ? optionLabel("annualFinancialStatementOptions", row.annualFinancialStatementOption) : row.financialStatementReportType || "-",
            <Badge tone={toneForStatus(row.status)}>{optionLabel("annualMaintenanceStatuses", row.status)}</Badge>,
            <DeleteCell label="annual maintenance record" onDelete={() => del(removeAnnual, row._id, "annual maintenance record")} />,
          ])}
          empty="No annual maintenance records yet."
        />
      </Section>

      <Section title="Jurisdiction metadata" count={data?.jurisdictionMetadata?.length ?? 0}>
        <SimpleTable
          cols={["Jurisdiction", "Act", "NUANS jurisdiction", "Reservation report", "Eligible", ""]}
          rows={(data?.jurisdictionMetadata ?? []).map((row: any) => [
            <RecordTitle title={row.label} subtitle={row.jurisdiction} />,
            row.actFormedUnder ? optionLabel("actsFormedUnder", row.actFormedUnder) : "-",
            row.nuansJurisdictionNumber || "-",
            row.nuansReservationReportTypeId || "-",
            row.incorporationServiceEligible ? "Yes" : "No",
            <DeleteCell label="jurisdiction metadata" onDelete={() => del(removeJurisdiction, row._id, "jurisdiction metadata")} />,
          ])}
          empty="No jurisdiction metadata yet."
        />
      </Section>

      <Section title="Operational logs" count={data?.logs?.length ?? 0}>
        <SimpleTable
          cols={["When", "Type", "Page", "Details", "Severity", ""]}
          rows={(data?.logs ?? []).map((row: any) => [
            row.createdAtISO ? formatDate(row.createdAtISO) : "-",
            optionLabel("logTypes", row.logType),
            row.page || row.pageLocationUrl || "-",
            row.errorMessage || row.detailsHeading || "-",
            <Badge tone={row.severity === "error" || row.severity === "critical" ? "danger" : row.severity === "warning" ? "warn" : "neutral"}>{optionLabel("logSeverities", row.severity)}</Badge>,
            <DeleteCell label="log entry" onDelete={() => del(removeLog, row._id, "log entry")} />,
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
        <Field label="Terms"><MarkdownEditor rows={4} value={draft.terms ?? ""} onChange={(markdown) => setDraft({ ...draft, terms: markdown })} /></Field>
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
        <Field label="Description"><MarkdownEditor rows={4} value={draft.description ?? ""} onChange={(markdown) => setDraft({ ...draft, description: markdown })} /></Field>
        <Field label="Timeline"><input className="input" value={draft.timeline ?? ""} onChange={(e) => setDraft({ ...draft, timeline: e.target.value })} /></Field>
        <Field label="Deliverables"><MarkdownEditor rows={4} value={draft.deliverables ?? ""} onChange={(markdown) => setDraft({ ...draft, deliverables: markdown })} /></Field>
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
        <Field label="Purpose statement"><MarkdownEditor rows={4} value={draft.purposeStatement ?? ""} onChange={(markdown) => setDraft({ ...draft, purposeStatement: markdown })} /></Field>
        <Field label="Classes of membership"><MarkdownEditor rows={4} value={draft.classesOfMembership ?? ""} onChange={(markdown) => setDraft({ ...draft, classesOfMembership: markdown })} /></Field>
        <Field label="Distribution of property"><MarkdownEditor rows={4} value={draft.distributionOfProperty ?? ""} onChange={(markdown) => setDraft({ ...draft, distributionOfProperty: markdown })} /></Field>
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
        <Field label="Rights class amendment"><MarkdownEditor rows={4} value={draft.shareClassAmendmentText ?? ""} onChange={(markdown) => setDraft({ ...draft, shareClassAmendmentText: markdown })} /></Field>
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
      <Field label="Error message"><MarkdownEditor rows={4} value={draft.errorMessage ?? ""} onChange={(markdown) => setDraft({ ...draft, errorMessage: markdown })} /></Field>
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

function roleHolderForHolding(roleHolders: any[], holderKey: string) {
  const roleHolderId = holderKey.startsWith("roleHolder:") ? holderKey.slice("roleHolder:".length) : holderKey;
  return roleHolders.find((row) => row._id === roleHolderId);
}

function RowActions({ onEdit, onDelete, label }: { onEdit: () => void; onDelete: () => void; label: string }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn btn--ghost btn--sm" onClick={onEdit}>Edit</button>
      <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete ${label}`} onClick={onDelete}><Trash2 size={12} /></button>
    </div>
  );
}

function DeleteCell({ onDelete, label }: { onDelete: () => void; label: string }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
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

function defaultRoleHolderDraft(roleType: string, corporationWorkspace: boolean) {
  const base = { roleType, status: "current", fullName: "" };
  if (!corporationWorkspace) return base;
  if (roleType === "director") return { ...base, ageOver18: true, directorTerm: "none_specified" };
  if (roleType === "officer") return { ...base, officerTitle: "president" };
  if (roleType === "shareholder") return { ...base, membershipClassName: "Common shares" };
  if (roleType === "controller") return { ...base, natureOfControl: "Review and document significant-control basis." };
  if (roleType === "authorized_filer") return { ...base, authorizedRepresentative: true };
  return base;
}

function summarizeCorporationRoles(rows: any[]) {
  return {
    directors: countCurrentRoles(rows, ["director"]),
    officers: countCurrentRoles(rows, ["officer", "chief_officer___manager"]),
    shareholders: countCurrentRoles(rows, ["shareholder", "shareholder_representative"]),
    controllers: countCurrentRoles(rows, ["controller"]),
    authorizedFilers: countCurrentRoles(rows, ["authorized_filer", "authorized_contact_person", "authorized_representative"]),
  };
}

function countCurrentRoles(rows: any[], roleTypes: string[]) {
  return rows.filter((row) =>
    roleTypes.includes(row.roleType) &&
    row.status !== "former" &&
    row.status !== "inactive",
  ).length;
}

function formatChangeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
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
