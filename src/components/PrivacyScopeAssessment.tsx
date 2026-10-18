import { useState } from "react";
import { ClipboardCheck, ExternalLink, MapPin, Save } from "lucide-react";
import { Badge, Banner, Field } from "./ui";
import { Checkbox } from "./Controls";
import { Select } from "./Select";
import { LegalGuideBadge } from "./LegalGuide";
import { Modal } from "./Modal";
import { useIsMobile } from "../lib/useIsMobile";
import { getPrivacyLegalGuideRules } from "../lib/jurisdictionGuideTracks";
import { PRIVACY_CITATIONS, PRIVACY_LAWS, PRIVACY_OPERATING_JURISDICTIONS, resolvePrivacyProfile, type PrivacyAssessmentInput, type ResolvedPrivacyProfile } from "../../shared/privacyRuleProfiles";

/** "BC, AB +2" from the checked jurisdiction codes, in the list's order. */
export function privacyJurisdictionSummary(locations: readonly string[], shown = 2) {
  const codes = PRIVACY_OPERATING_JURISDICTIONS.filter(([code]) => locations.includes(code)).map(([code]) => code.replace(/^CA-/, ""));
  if (!codes.length) return "None recorded";
  return codes.length > shown ? `${codes.slice(0, shown).join(", ")} +${codes.length - shown}` : codes.join(", ");
}

/** "BC PIPA applies (assumed) — confirm": the law the saved facts point to, in plain words. */
export function privacyStatusText(profile: ResolvedPrivacyProfile) {
  const laws = profile.applicableLawIds.map((id) => PRIVACY_LAWS[id].label).join(" and ");
  if (profile.status === "presumed") return { text: `${laws} applies (assumed)`, confirm: true };
  if (profile.status === "no-general-law-identified") return { text: "No general privacy Act identified", confirm: false };
  if (!laws) return { text: "Which privacy law applies isn't assessed yet", confirm: true };
  if (profile.presumedLawIds.length || profile.status === "conditional") return { text: `${laws} ${profile.applicableLawIds.length > 1 ? "apply" : "applies"}, with facts to confirm`, confirm: true };
  return { text: `${laws} ${profile.applicableLawIds.length > 1 ? "apply" : "applies"}`, confirm: false };
}

const ANSWERS = [{ value: "unknown", label: "Not assessed" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];

type Props = {
  organization: PrivacyAssessmentInput;
  canEdit: boolean;
  saving: boolean;
  onChange: (key: string, value: any) => void;
  onSave: () => void;
};

/** Scope is an explicit assessment. Saved location/activity facts drive the
 * policy and citations; unsaved choices are labelled as a preview. */
export function PrivacyScopeAssessment({ organization, canEdit, saving, onChange, onSave }: Props) {
  const profile = resolvePrivacyProfile(organization);
  const locations = organization.privacyOperatingJurisdictions ?? [];
  const guides = new Map(getPrivacyLegalGuideRules({ organization }).map((rule) => [rule.id, rule]));
  const isMobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const toggleLocation = (code: string, checked: boolean) =>
    onChange("privacyOperatingJurisdictions", checked ? [...locations, code] : locations.filter((item) => item !== code));
  const locationChecks = (
    <div className="privacy-scope__locations">
      {PRIVACY_OPERATING_JURISDICTIONS.map(([code, label]) => <Checkbox key={code} label={label} checked={locations.includes(code)} disabled={!canEdit} onChange={(checked) => toggleLocation(code, checked)} />)}
    </div>
  );
  return (
    <section className="card privacy-scope-assessment" aria-labelledby="privacy-scope-title">
      <div className="card__head">
        <h2 className="card__title" id="privacy-scope-title"><ClipboardCheck size={14} /> Privacy-law scope</h2>
        <button className="btn btn--accent btn--sm" style={{ marginLeft: "auto" }} disabled={!canEdit || saving} onClick={onSave}><Save size={12} /> {saving ? "Saving..." : "Save assessment"}</button>
      </div>
      <div className="card__body">
        <p>Record where personal information is handled and which activities it supports. Save the assessment before creating a policy. Multiple laws can apply to different records or transactions.</p>
        {isMobile ? (
          // Phones: the 13 checkboxes live in a sheet; the page shows the selection.
          <div className="privacy-scope__picker">
            <div className="privacy-scope__picker-text">
              <span className="privacy-scope__picker-label">Operating provinces and territories</span>
              <strong>{locations.length ? `Applies in: ${privacyJurisdictionSummary(locations)}` : "None recorded yet"}</strong>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setPickerOpen(true)}>
              <MapPin size={12} /> {canEdit ? "Choose" : "View"}
            </button>
          </div>
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: "16px 0" }}>
            <legend style={{ marginBottom: 8, fontWeight: 600 }}>Operating provinces and territories</legend>
            {locationChecks}
          </fieldset>
        )}
        {isMobile && (
          <Modal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title="Operating provinces and territories"
            size="sm"
            footer={<button type="button" className="btn btn--accent" onClick={() => setPickerOpen(false)}>Done</button>}
          >
            <p className="muted" style={{ marginTop: 0 }}>Where the organization handles personal information. Save the assessment to keep the change.</p>
            {locationChecks}
          </Modal>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
          <Field label="Personal information used in commercial activity">
            <Select value={organization.privacyCommercialActivity ?? "unknown"} options={ANSWERS} disabled={!canEdit} onChange={(value) => onChange("privacyCommercialActivity", value)} />
          </Field>
          <Field label="Federal work, undertaking or business">
            <Select value={organization.privacyFederalWork ?? "unknown"} options={ANSWERS} disabled={!canEdit} onChange={(value) => onChange("privacyFederalWork", value)} />
            <small>For example, banking, telecommunications or interprovincial transportation. Federal incorporation alone is insufficient.</small>
          </Field>
          <Field label="Commercial information crosses provincial or national borders">
            <Select value={organization.privacyCrossBorderCommercial ?? "unknown"} options={ANSWERS} disabled={!canEdit} onChange={(value) => onChange("privacyCrossBorderCommercial", value)} />
          </Field>
          <Field label="Sector-specific privacy regime for these records">
            <Select value={organization.privacySectorSpecific ?? "unknown"} disabled={!canEdit} onChange={(value) => onChange("privacySectorSpecific", value)} options={[
              { value: "unknown", label: "Not assessed" }, { value: "none", label: "General private-sector records" }, { value: "health", label: "Health-sector regime — assess separately" }, { value: "public", label: "Public-sector regime — assess separately" },
            ]} />
          </Field>
          {locations.includes("CA-AB") && <Field label="Alberta PIPA nonprofit classification">
            <Select value={organization.privacyAlbertaNonprofitClass ?? "unknown"} disabled={!canEdit} onChange={(value) => onChange("privacyAlbertaNonprofitClass", value)} options={[
              { value: "unknown", label: "Not assessed" }, { value: "section-56", label: "Defined nonprofit under s. 56" }, { value: "other", label: "Outside the defined nonprofit class" },
            ]} />
            <small>The limited exception covers the defined class, including Alberta Societies Act and Agricultural Societies Act entities and Part 9 Companies Act registrations.</small>
          </Field>}
          {locations.includes("CA-QC") && <Field label="Québec enterprise under Civil Code art. 1525">
            <Select value={organization.privacyQuebecEnterprise ?? "unknown"} options={ANSWERS} disabled={!canEdit} onChange={(value) => onChange("privacyQuebecEnterprise", value)} />
            <small>An organized economic activity may be noncommercial. Assess nonprofit organizations on their actual activities.</small>
          </Field>}
        </div>
        <div style={{ marginTop: 16 }} aria-live="polite">
          <Banner tone={profile.status === "assessed" ? "info" : "warn"} title={`Assessment preview: ${privacyStatusText(profile).text}`}>
            {profile.unresolvedFacts.length ? <ul>{profile.unresolvedFacts.map((item) => <li key={item}>{item}</li>)}</ul> : profile.status === "no-general-law-identified" ? "The recorded facts identify no general private-sector Act for this handling. Other privacy, contractual, governance and sector duties can still apply." : "These requirements depend on the accuracy and scope of the recorded facts. Completion of app tasks records evidence, not a legal certification."}
          </Banner>
        </div>
        {profile.assessments.map((assessment) => {
          const law = PRIVACY_LAWS[assessment.lawId];
          const definite = assessment.applicability === "applies";
          const presumed = assessment.basis === "presumed";
          return <details key={law.id} open={definite && !isMobile} style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{law.label} <Badge tone={definite && !presumed ? "info" : "warn"}>{presumed ? "Assumed: confirm" : definite ? "Assessed as applicable" : "Conditional"}</Badge></summary>
            <p>{assessment.reason}</p>
            <ul className="privacy-bullet-list">
              {law.rules.map((rule) => {
                const guide = guides.get(`privacy-${law.id}-${rule.key}`);
                return <li key={rule.key}>
                  <strong>{rule.title}:</strong> {rule.body}{rule.obligation === "recommended" && " Recommended practice."}
                  {guide && <> <LegalGuideBadge rule={guide} /></>}
                  {rule.citationIds.filter((_, index) => !guide || index > 0).map((id) => <span key={id}> <a href={PRIVACY_CITATIONS[id].url} target="_blank" rel="noreferrer">{PRIVACY_CITATIONS[id].fullCitation} <ExternalLink size={10} /></a></span>)}
                </li>;
              })}
            </ul>
            {law.id === "ab_pipa" && <p><small>Alberta rules were checked against official regulator guidance on 2026-10-11. The current King's Printer consolidation date remains unverified.</small></p>}
          </details>;
        })}
      </div>
    </section>
  );
}
