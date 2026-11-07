/** Tax guidance is independent of the organization's incorporation jurisdiction. */
export type TaxAnswers = Record<string, string>;
export type TaxTreatment = "standard" | "zero_rated" | "exempt" | "out_of_scope" | "not_subject" | "relieved" | "review_required";
export type TaxComponentDecision = {
  taxId: string;
  label: string;
  treatment: TaxTreatment;
  collection: "collect" | "do_not_collect" | "review_required";
  ratePercent?: number;
  reason: string;
  authorityIds: string[];
};
export type TaxAuthority = { id: string; title: string; url: string };
export type TaxQuestion = {
  id: string;
  label: string;
  kind: "choice" | "text";
  hint?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  when?: Array<{ answer: string; oneOf: string[] }>;
};
export type TaxEvaluation = { components: TaxComponentDecision[]; issues: string[] };
export type TaxRulePack = {
  id: string;
  version: string;
  label: string;
  jurisdictionCode: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reviewedOn: string;
  authorities: TaxAuthority[];
  questions: TaxQuestion[];
  /** Clear dependent evidence when an answer changes within this jurisdiction. */
  updateAnswer?: (answers: TaxAnswers, key: string, value: string) => TaxAnswers;
  evaluate: (answers: TaxAnswers) => TaxEvaluation;
};
export type TaxAssessment = {
  schemaVersion: 1;
  rulePackId: string;
  rulePackVersion: string;
  rulesReviewedOn: string;
  answers: TaxAnswers;
  components: TaxComponentDecision[];
  issues: string[];
  status: "ready" | "review_required";
  confirmed: boolean;
};
