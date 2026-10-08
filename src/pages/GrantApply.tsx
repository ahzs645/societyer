import { FormEvent, useMemo, useState } from "react";
import { PageLoading } from "./_helpers";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ErrorSummary, Field, type ErrorSummaryItem } from "../components/ui";
import { IntakePrivacyNotice } from "../components/IntakePrivacyNotice";
import { Select } from "../components/Select";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";

const FIELD_IDS = {
  applicantName: "grant-applicant-name",
  email: "grant-email",
  amountRequestedDollars: "grant-requested-amount",
  projectTitle: "grant-project-title",
  projectSummary: "grant-project-summary",
} as const;

export function GrantApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const context = useQuery(api.publicPortal.grantIntakeContext, slug ? { slug } : "skip");
  const currentUser = useCurrentUser();
  const applicantMemberId = currentUser?.societyId === context?.society?._id ? currentUser?.memberId : undefined;
  const submitApplication = useMutation(api.grants.submitApplication);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [form, setForm] = useState({
    grantId: "",
    applicantName: currentUser?.displayName ?? "",
    organizationName: "",
    email: currentUser?.email ?? "",
    phone: "",
    amountRequestedDollars: "",
    projectTitle: "",
    projectSummary: "",
    proposedUseOfFunds: "",
    expectedOutcomes: "",
  });

  const selectedGrant = useMemo(
    () => (context?.grants ?? []).find((grant) => String(grant._id) === form.grantId) ?? null,
    [context?.grants, form.grantId],
  );
  const errors = useMemo(() => {
    const next: ErrorSummaryItem[] = [];
    const amount = Number(form.amountRequestedDollars);
    if (!form.applicantName.trim()) {
      next.push({ fieldId: FIELD_IDS.applicantName, label: "Applicant name", message: "Enter the applicant name." });
    }
    if (!form.email.trim()) {
      next.push({ fieldId: FIELD_IDS.email, label: "Email", message: "Enter an email address." });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.push({ fieldId: FIELD_IDS.email, label: "Email", message: "Enter a valid email address." });
    }
    if (!form.amountRequestedDollars.trim()) {
      next.push({ fieldId: FIELD_IDS.amountRequestedDollars, label: "Requested amount", message: "Enter the amount requested in dollars." });
    } else if (!Number.isFinite(amount) || amount <= 0) {
      next.push({ fieldId: FIELD_IDS.amountRequestedDollars, label: "Requested amount", message: "Enter a positive dollar amount." });
    }
    if (!form.projectTitle.trim()) {
      next.push({ fieldId: FIELD_IDS.projectTitle, label: "Project title", message: "Enter a project title." });
    }
    if (!form.projectSummary.trim()) {
      next.push({ fieldId: FIELD_IDS.projectSummary, label: "Project summary", message: "Summarize the project." });
    }
    return next;
  }, [form.amountRequestedDollars, form.applicantName, form.email, form.projectSummary, form.projectTitle]);

  if (context === undefined) return <PageLoading />;
  if (!context || !context.society) {
    return (
      <div className="landing" style={{ minHeight: "100vh", padding: "4rem 0" }}>
        <div className="landing__container">
          <h1 className="landing__h1">Grant intake is unavailable.</h1>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { projectSummary, proposedUseOfFunds, expectedOutcomes } = form;
    setAttemptedSubmit(true);
    if (errors.length > 0) return;
    setSubmitting(true);
    try {
      await submitApplication({
      societyId: context.society._id,
      grantId: form.grantId ? (form.grantId as any) : undefined,
      memberId: applicantMemberId ?? undefined,
      applicantName: form.applicantName.trim(),
      organizationName: form.organizationName || undefined,
      email: form.email.trim(),
      phone: form.phone || undefined,
      amountRequestedCents: Math.round(Number(form.amountRequestedDollars) * 100),
      projectTitle: form.projectTitle.trim(),
      projectSummary: projectSummary.trim(),
      proposedUseOfFunds: proposedUseOfFunds || undefined,
      expectedOutcomes: expectedOutcomes || undefined,
      source: applicantMemberId ? "portal" : "public",
      });
      toast.success("Grant application submitted");
      setForm((current) => ({
        ...current,
        phone: "",
        amountRequestedDollars: "",
        projectTitle: "",
        projectSummary: "",
        proposedUseOfFunds: "",
        expectedOutcomes: "",
      }));
      setCompleted(true);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not submit funding request");
    } finally {
      setSubmitting(false);
    }
  };
  const visibleErrors = attemptedSubmit ? errors : [];

  return (
    <div className="landing intake-page">
      <div className="intake intake--single">
        <header className="intake__head">
          <Link to={`/public/${context.society.publicSlug}`} className="intake__back">
            <ArrowLeft size={14} /> {context.society.name}
          </Link>
          <div className="landing__eyebrow">
            <BadgeDollarSign size={12} /> Grant application
          </div>
          <h1 className="intake__title">Funding intake for {context.society.name}</h1>
          <p className="intake__lede">Request funding for a project. Your request goes straight to the society's review queue.</p>
        </header>

        {completed ? (
          <div className="card intake__done">
            <h2 className="card__title">Funding request submitted</h2>
            <p className="muted">
              {context.society.name} received the request. Keep any follow-up messages for your records.
            </p>
            <Link className="btn btn--accent" to={`/public/${context.society.publicSlug}`}>
              Back to public center
            </Link>
          </div>
        ) : (
          <div className="intake__layout intake__layout--single">
            <form className="intake__form" onSubmit={submit} noValidate>
              <ErrorSummary errors={visibleErrors} title="Complete these fields to submit" />
              <fieldset className="intake__section">
                <legend>Applicant</legend>
                <div className="intake__row intake__row--wide">
                  <Field label="Applicant name" id={FIELD_IDS.applicantName} required error={fieldError(visibleErrors, "Applicant name")}>
                    <input className="input" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} autoComplete="name" />
                  </Field>
                  <Field label="Organization name">
                    <input className="input" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} autoComplete="organization" />
                  </Field>
                </div>
                <div className="intake__row intake__row--wide">
                  <Field label="Email" id={FIELD_IDS.email} required error={fieldError(visibleErrors, "Email")}>
                    <input className="input" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
                  </Field>
                  <Field label="Phone">
                    <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="intake__section">
                <legend>Your request</legend>
                {context.grants.length > 0 && (
                  <Field label="Program or opportunity">
                    <Select
                      value={form.grantId}
                      onChange={(value) => setForm({ ...form, grantId: value })}
                      options={[
                        { value: "", label: "General funding intake" },
                        ...context.grants.map((grant) => ({ value: grant._id, label: grant.title })),
                      ]}
                    />
                  </Field>
                )}
                {(selectedGrant?.publicDescription || selectedGrant?.applicationInstructions) && (
                  <div className="intake__program-info">
                    {selectedGrant?.publicDescription && <p>{selectedGrant.publicDescription}</p>}
                    {selectedGrant?.applicationInstructions && <p>{selectedGrant.applicationInstructions}</p>}
                  </div>
                )}
                <div className="intake__row intake__row--amount">
                  <Field label="Requested amount" id={FIELD_IDS.amountRequestedDollars} required hint="Canadian dollars" error={fieldError(visibleErrors, "Requested amount")}>
                    <span className="intake__money">
                      <span aria-hidden="true">$</span>
                      <input className="input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 2,500" value={form.amountRequestedDollars} onChange={(e) => setForm({ ...form, amountRequestedDollars: e.target.value })} />
                    </span>
                  </Field>
                  <Field label="Project title" id={FIELD_IDS.projectTitle} required error={fieldError(visibleErrors, "Project title")}>
                    <input className="input" value={form.projectTitle} onChange={(e) => setForm({ ...form, projectTitle: e.target.value })} />
                  </Field>
                </div>
                <Field label="Project summary" id={FIELD_IDS.projectSummary} required error={fieldError(visibleErrors, "Project summary")}>
                  <textarea className="textarea" rows={4} value={form.projectSummary} onChange={(e) => setForm({ ...form, projectSummary: e.target.value })} />
                </Field>
                <Field label="Proposed use of funds">
                  <textarea className="textarea" rows={3} value={form.proposedUseOfFunds} onChange={(e) => setForm({ ...form, proposedUseOfFunds: e.target.value })} />
                </Field>
                <Field label="Expected outcomes">
                  <textarea className="textarea" rows={3} value={form.expectedOutcomes} onChange={(e) => setForm({ ...form, expectedOutcomes: e.target.value })} />
                </Field>
              </fieldset>
              <IntakePrivacyNotice
                societyName={context.society.name}
                customNotice={context.society.privacyNotice}
                publicSlug={context.society.publicSlug}
                privacyOfficerName={context.society.privacyOfficerName}
                contactEmail={context.society.publicContactEmail}
              />
              <div className="intake__submit">
                <button className="btn btn--accent" type="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit funding request"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function fieldError(errors: { label: string; message: string }[], label: string) {
  return errors.find((error) => error.label === label)?.message;
}
