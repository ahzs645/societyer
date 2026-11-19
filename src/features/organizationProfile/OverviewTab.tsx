import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Banner } from "../../components/ui";
import { IncorporationPreparation } from "../../components/IncorporationPreparation";
import { TooltipCopyable } from "../../components/TooltipCopyable";
import { formatDate } from "../../lib/format";
import { optionLabel } from "../../lib/orgHubOptions";
import { setupViewStepLink } from "../../lib/organizationSetupLinks";
import { isBcJurisdiction, isExtraProvincialRegistration, isSecretIdentifier, mask, monthDayLabel, primaryIdentifier, addressLine, findCurrentAddress } from "./detailRows";
import { organizationProfileAttention, type AttentionAction, type AttentionItem } from "./attention";
import { ComingUpCard, PeopleAndSharesCard, useOverviewRegisters } from "./OverviewRegisters";
import { actShortName, profileStatus } from "./status";
import type { OrganizationDetail, OrganizationRecord, ProfileForm, ProfileTab } from "./types";

/** Facts under the page title on every tab: status, entity and Act, and the registry numbers. */
export function ProfileHeaderFacts({ form, detail }: { form: ProfileForm; detail: OrganizationDetail | undefined }) {
  const status = profileStatus(form);
  const act = actShortName(form);
  const entity = form.entityType ? optionLabel("entityTypes", form.entityType) : "";
  const registrations = (detail?.registrations ?? []).filter((row) => isExtraProvincialRegistration(row) && row.registrationNumber && row.status !== "inactive");
  return (
    <div className="org-profile-facts" aria-label="Organization facts">
      <Badge tone={status.tone}>{status.label}</Badge>
      {(entity || act) && <span className="org-profile-facts__chip">{[entity, act].filter(Boolean).join(" · ")}</span>}
      {form.incorporationNumber && <span className="org-profile-facts__chip mono">{form.incorporationNumber}</span>}
      {registrations.map((row) => (
        <span key={row._id} className="org-profile-facts__chip">
          {isBcJurisdiction(row.jurisdiction) ? "BC" : optionLabel("entityJurisdictions", row.jurisdiction)} extra-provincial <span className="mono">{row.registrationNumber}</span>
        </span>
      ))}
    </div>
  );
}

type OverviewProps = {
  society: OrganizationRecord;
  form: ProfileForm;
  detail: OrganizationDetail | undefined;
  canEdit: boolean;
  /** Opens the "Record incorporation" drawer. */
  onRecordIncorporation: () => void;
  onOpenTab: (tab: ProfileTab, anchor?: string) => void;
  /** Opens a profile drawer named by an attention item. */
  onAction: (action: AttentionAction) => void;
};

export function OverviewTab({ society, form, detail, canEdit, onRecordIncorporation, onOpenTab, onAction }: OverviewProps) {
  const registers = useOverviewRegisters(society);
  const attention = useMemo(
    () => detail ? organizationProfileAttention(society, { ...detail, directors: registers.directors }) : undefined,
    [detail, registers.directors, society],
  );
  const awaitingCertificate = society.formationStatus === "preparing" || society.formationStatus === "submitted";
  return (
    <>
      {/* Spaced by their own margins, outside the panel's gap. */}
      {awaitingCertificate && (
        <>
          <Banner className="society-setup-link" title={society.formationStatus === "submitted" ? "Filed and waiting for the certificate" : "Getting ready to incorporate"}>
            <span className="org-profile-banner">
              <span>Track filing and the rest of setup on one page. <Link className="setup-inline-link" to={setupViewStepLink(society.formationStatus === "submitted" ? "certificate" : "file")}>Open setup</Link></span>
              {canEdit && <button className="btn btn--accent btn--sm" type="button" onClick={onRecordIncorporation}>Record incorporation</button>}
            </span>
          </Banner>
          <IncorporationPreparation organization={form} />
        </>
      )}
      <div className="org-profile-panel">
        <div className="org-profile-grid">
          <KeyFactsCard form={form} detail={detail} />
          <AttentionCard items={attention} canEdit={canEdit} onOpenTab={onOpenTab} onAction={onAction} />
          <ComingUpCard society={society} detail={detail} deadlines={registers.deadlines} deadlinesReadable={registers.settingsReadable} />
          <PeopleAndSharesCard society={society} registers={registers} />
        </div>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function KeyFactsCard({ form, detail }: { form: ProfileForm; detail: OrganizationDetail | undefined }) {
  const identifiers = detail?.identifiers ?? [];
  const bn = primaryIdentifier(identifiers, "business_number");
  const bcRegistration = (detail?.registrations ?? []).find((row) => isExtraProvincialRegistration(row) && isBcJurisdiction(row.jurisdiction) && row.registrationNumber);
  const office = findCurrentAddress(detail?.addresses ?? [], "registered_office");
  const officeLine = office ? addressLine(office) : form.registeredOfficeAddress ?? "";
  const act = actShortName(form);
  return (
    <section className="card" aria-labelledby="org-key-facts">
      <div className="card__head"><h2 className="card__title" id="org-key-facts">Key facts</h2></div>
      <div className="card__body">
        <dl className="org-profile-kv">
          <Fact label="Corporation no.">{form.incorporationNumber ? <TooltipCopyable value={form.incorporationNumber} label="corporation number" /> : <span className="muted">Not assigned yet</span>}</Fact>
          <Fact label="Incorporated">{form.incorporationDate ? `${formatDate(form.incorporationDate)}${act ? ` · ${act}` : ""}` : <span className="muted">Not incorporated yet</span>}</Fact>
          <Fact label="Business number">{!bn?.number ? <span className="muted">Not recorded</span>
            : bn.accessLevel === "restricted" || isSecretIdentifier(bn) ? <span className="mono">{mask(bn.number)}</span>
            : <TooltipCopyable value={bn.number} label="business number" />}</Fact>
          {bcRegistration?.registrationNumber && <Fact label="BC registration"><TooltipCopyable value={bcRegistration.registrationNumber} label="BC registration number" /></Fact>}
          <Fact label="Registered office">{officeLine ? <span className="org-profile-kv__wrap">{officeLine}</span> : <span className="muted">Not recorded</span>}</Fact>
          <Fact label="Fiscal year end">{form.fiscalYearEnd ? monthDayLabel(form.fiscalYearEnd) : <span className="muted">Not set</span>}</Fact>
          <Fact label="Anniversary">{form.anniversaryDate ? monthDayLabel(form.anniversaryDate) : form.incorporationDate ? monthDayLabel(form.incorporationDate) : <span className="muted">Not set</span>}</Fact>
        </dl>
      </div>
    </section>
  );
}

function AttentionCard({ items, canEdit, onOpenTab, onAction }: { items: AttentionItem[] | undefined; canEdit: boolean; onOpenTab: OverviewProps["onOpenTab"]; onAction: OverviewProps["onAction"] }) {
  return (
    <section className="card" aria-labelledby="org-needs-attention">
      <div className="card__head">
        <h2 className="card__title" id="org-needs-attention">Needs attention</h2>
        {items && items.length > 0 && <Badge tone="warn">{items.length}</Badge>}
      </div>
      <div className="card__body">
        {items === undefined ? <p className="muted org-profile-empty">Checking the profile…</p>
          : items.length === 0 ? <p className="muted org-profile-empty">Nothing outstanding on the profile.</p>
          : (
            <ul className="org-profile-todo">
              {items.map((item) => (
                <li key={item.id}>
                  <span className="org-profile-todo__text">{item.text}</span>
                  <AttentionButton item={item} canEdit={canEdit} onOpenTab={onOpenTab} onAction={onAction} />
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function AttentionButton({ item, canEdit, onOpenTab, onAction }: { item: AttentionItem; canEdit: boolean; onOpenTab: OverviewProps["onOpenTab"]; onAction: OverviewProps["onAction"] }) {
  const target = item.target;
  if ("href" in target) return <Link className="btn btn--sm" to={target.href}>{item.action}</Link>;
  if ("action" in target) return canEdit ? <button className="btn btn--sm" type="button" onClick={() => onAction(target.action)}>{item.action}</button> : null;
  return <button className="btn btn--sm" type="button" onClick={() => onOpenTab(target.tab, target.anchor)}>{item.action}</button>;
}
