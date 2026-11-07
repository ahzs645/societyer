import { useEffect, useId, useRef, useState } from "react";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { assessTax, defaultTaxAnswers, resolveTaxPack, TAX_RULE_PACKS, taxAssessmentRates, taxAssessmentSummary, taxQuestionVisible, updateTaxAnswer, type TaxAnswers, type TaxAssessment } from "../../../shared/tax";
import type { InvoiceLineTaxes } from "../../../shared/invoiceMoney";
import type { InvoiceOrganization } from "./types";
import "./taxAssessment.css";

type Props = {
  value?: TaxAssessment;
  scope: "catalog" | "transaction";
  date: string;
  contextKey?: string;
  organization?: InvoiceOrganization;
  disabled?: boolean;
  onApply: (assessment: TaxAssessment, rates?: InvoiceLineTaxes) => void;
};

/** A shared question renderer; jurisdiction packs supply the questions, decisions and sources. */
export function TaxAssessmentEditor({ value, scope, date, contextKey, organization, disabled, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<TaxAnswers>(() => value?.answers ?? initialAnswers());
  const [error, setError] = useState("");
  const guideId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  function initialAnswers(): TaxAnswers {
    return defaultTaxAnswers(scope, date);
  }
  // A customer or item can change while this guide is open, even before the
  // first assessment has been saved. Never reapply answers from that old sale.
  useEffect(() => {
    setAnswers(value ? { ...value.answers, scope, supplyDate: date } : defaultTaxAnswers(scope, date));
    setError("");
    setOpen(false);
  }, [value, scope, date, contextKey]);
  const patch = (key: string, next: string) => { setError(""); setAnswers((current) => updateTaxAnswer(current, key, next)); };
  const effective = { ...answers, scope, supplyDate: date, ...(scope === "catalog" ? { customerRelief: "none", customerEvidence: "", purchaserPstNumber: "", pstReliefDocumentation: "unknown", pstReliefConditions: "unknown", pstCertificateType: "" } : {}) };
  let result: TaxAssessment | undefined;
  try { result = assessTax(effective); } catch { /* A partial date is shown as a validation message on save. */ }
  const pack = resolveTaxPack(effective.jurisdictionCode, date);
  const displayPack = pack ?? TAX_RULE_PACKS.find((candidate) => candidate.jurisdictionCode === effective.jurisdictionCode);
  const knownPlace = TAX_RULE_PACKS.some((candidate) => candidate.jurisdictionCode === effective.jurisdictionCode);
  const save = (confirm: boolean) => {
    try {
      const assessment = assessTax(effective, confirm);
      if (confirm && !assessment.confirmed) throw new Error("Resolve the review questions before applying tax treatment.");
      onApply(assessment, confirm ? taxAssessmentRates(assessment) : undefined);
      setOpen(false);
      toggleRef.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review the tax answers."); }
  };
  const openGuide = () => {
    setAnswers(value ? { ...value.answers, scope, supplyDate: date } : initialAnswers());
    setError(""); setOpen(true);
  };
  const authorityIds = new Set([...(result?.components.flatMap((component) => component.authorityIds) ?? []), "cra-nonprofits", "cra-charities"]);

  return <div className="tax-assessment">
    <div className="tax-assessment__summary">
      <span>{taxAssessmentSummary(value)}</span>
      {!disabled && <button ref={toggleRef} type="button" className="btn btn--ghost btn--sm" onClick={open ? () => setOpen(false) : openGuide} aria-controls={guideId} aria-expanded={open}>{open ? "Close tax guide" : value ? "Review tax assessment" : "Guide me through tax"}</button>}
    </div>
    {open && <section id={guideId} className="tax-assessment__guide" aria-label="Tax decision guide">
      <h3>Work out this item's taxes</h3>
      <p className="muted">Answer for the actual supply. Legal structure, charity status, supplier registration and item treatment are separate. Review both taxes before applying the result.</p>
      <p className="muted">Assessment date: {date}. {scope === "catalog" ? "Catalog guidance is checked again for each invoice and customer." : "Review delivery, use and any transitional rules if the supply date differs from the invoice date."}</p>
      {(organization?.gstNumber || organization?.pstNumber) && <p className="muted">Numbers on file: {[organization.gstNumber && `GST/HST ${organization.gstNumber}`, organization.pstNumber && `PST ${organization.pstNumber}`].filter(Boolean).join(" · ")}. Confirm registration and collection status below.</p>}
      <Field label="Place of supply" hint="Use the tax place-of-supply rules, including delivery/use. Do not select the incorporation address automatically.">
        <Select aria-label="Place of supply" value={knownPlace ? effective.jurisdictionCode : effective.jurisdictionCode === "unknown" ? "unknown" : "other"} onChange={(value) => patch("jurisdictionCode", value)} options={[
          { value: "unknown", label: "Not yet established" },
          ...[...new Map(TAX_RULE_PACKS.map((candidate) => [candidate.jurisdictionCode, { value: candidate.jurisdictionCode, label: candidate.label }])).values()],
          { value: "other", label: "Another province or country" },
        ]} />
      </Field>
      {!knownPlace && effective.jurisdictionCode !== "unknown" && <Field label="Country / region code" hint="For example, CA-ON, US-WA or GB. A local rule pack must be reviewed before this guide can recommend rates."><input className="input" maxLength={40} value={effective.jurisdictionCode === "other" ? "" : effective.jurisdictionCode} onChange={(event) => patch("jurisdictionCode", event.target.value.toUpperCase() || "other")} /></Field>}
      {pack && <div className="tax-assessment__questions">{pack.questions.filter((question) => taxQuestionVisible(question, effective)).map((question) => <Field key={question.id} label={question.label} hint={question.hint}>
        {question.kind === "choice" ? <Select aria-label={question.label} value={effective[question.id] ?? "unknown"} options={[...(question.options ?? [])]} onChange={(value) => patch(question.id, value)} /> : <textarea className="input textarea" aria-label={question.label} rows={2} maxLength={2000} value={effective[question.id] ?? ""} onChange={(event) => patch(question.id, event.target.value)} />}
      </Field>)}</div>}
      {result && <div className="tax-assessment__result" aria-live="polite">
        <h4>{result.status === "ready" ? "Proposed tax treatment" : "Review needed"}</h4>
        {result.components.map((component) => <p key={component.taxId}><strong>{component.label}: {component.collection === "collect" ? `${component.ratePercent}%` : component.treatment.replaceAll("_", " ")}</strong><br />{component.reason}</p>)}
        {result.issues.length > 0 && <ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </div>}
      {displayPack && <details className="tax-assessment__sources"><summary>Official sources · reviewed {displayPack.reviewedOn}</summary><p>Guidance applies from {displayPack.effectiveFrom}{displayPack.effectiveTo ? ` through ${displayPack.effectiveTo}` : ""}. It records your assessment; it does not verify eligibility with a tax authority.</p><ul>{displayPack.authorities.filter((source) => authorityIds.has(source.id)).map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details>}
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="btn-row tax-assessment__buttons">
        <button type="button" className="btn" onClick={() => save(false)}>Keep for review</button>
        <button type="button" className="btn btn--accent" disabled={result?.status !== "ready"} onClick={() => save(true)}>Confirm and apply tax treatment</button>
      </div>
      <p className="muted">Applying the result changes this item's tax rates. Review notes stay internal; the invoice shows the tax amounts and treatment.</p>
    </section>}
  </div>;
}
