import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ErrorSummary, Field, InspectorNote, type ErrorSummaryItem } from "../components/ui";
import { PIPA_INTAKE_NOTICE } from "../lib/legalCopy";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";
import { Select } from "../components/Select";

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

  if (context === undefined) return <div className="page">Loading…</div>;
  if (!context) {
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
    setAttemptedSubmit(true);
    if (errors.length > 0) return;
    setSubmitting(true);
    try {
      await submitApplication({
      societyId: context.society._id,
      grantId: form.grantId ? (form.grantId as any) : undefined,
      memberId: currentUser?.memberId ?? undefined,
      applicantName: form.applicantName.trim(),
      organizationName: form.organizationName || undefined,
      email: form.email.trim(),
      phone: form.phone || undefined,
      amountRequestedCents: Math.round(Number(form.amountRequestedDollars) * 100),
      projectTitle: form.projectTitle.trim(),
      projectSummary: form.projectSummary.trim(),
      proposedUseOfFunds: form.proposedUseOfFunds || undefined,
      expectedOutcomes: form.expectedOutcomes || undefined,
      source: currentUser?.memberId ? "portal" : "public",
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
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ paddingTop: 72, paddingBottom: 56 }}>
        <div className="landing__container" style={{ maxWidth: 760 }}>
          <Link to={`/public/${context.society.publicSlug}`} className="row muted" style={{ marginBottom: 16, fontSize: 12 }}>
            <ArrowLeft size={12} /> Back to public center
          </Link>
          <div className="landing__eyebrow">
            <BadgeDollarSign size={12} /> Grant application
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>
            Funding intake for {context.society.name}
          </h1>
          <p className="landing__lede">
            Submit a project or funding request directly. It will land in the internal intake queue
            instead of being re-entered by hand later.
          </p>

          {completed ? (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card__body" style={{ display: "grid", gap: 10 }}>
                <h2 className="card__title" style={{ margin: 0 }}>Funding request submitted</h2>
                <div className="muted">
                  {context.society.name} received the request. Keep a copy of any follow-up messages you receive for your records.
                </div>
                <Link className="btn btn--accent" to={`/public/${context.society.publicSlug}`}>
                  Back to public center
                </Link>
              </div>
            </div>
          ) : (
          <form className="card" style={{ marginTop: 24 }} onSubmit={submit} noValidate>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              <ErrorSummary errors={visibleErrors} title="Complete these fields to submit" />
              <InspectorNote title={PIPA_INTAKE_NOTICE.title}>
                {PIPA_INTAKE_NOTICE.body} Published privacy records, when available, appear in the{" "}
                <Link to={`/public/${context.society.publicSlug}`}>public center</Link>.
              </InspectorNote>
              {context.grants.length > 0 && (
                <Field label="Program or opportunity">
                  <Select value={form.grantId} onChange={value => setForm({
  ...form,
  grantId: value
})} options={[{
  value: "",
  label: "General funding intake"
}, ...context.grants.map(grant => ({
  value: grant._id,
  label: grant.title
}))]} className="input" />
                </Field>
              )}
              {selectedGrant?.publicDescription && (
                <div className="muted" style={{ marginTop: -2 }}>
                  {selectedGrant.publicDescription}
                </div>
              )}
              {selectedGrant?.applicationInstructions && (
                <div className="muted" style={{ marginTop: -6 }}>
                  {selectedGrant.applicationInstructions}
                </div>
              )}
              <Field label="Applicant name" id={FIELD_IDS.applicantName} required error={fieldError(visibleErrors, "Applicant name")}>
                <input className="input" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} autoComplete="name" />
              </Field>
              <Field label="Organization name">
                <input className="input" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
              </Field>
              <Field label="Email" id={FIELD_IDS.email} required error={fieldError(visibleErrors, "Email")}>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
              </Field>
              <Field label="Requested amount" id={FIELD_IDS.amountRequestedDollars} required hint="Enter dollars, e.g. 2500.00. The app stores this as cents internally." error={fieldError(visibleErrors, "Requested amount")}>
                <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.amountRequestedDollars} onChange={(e) => setForm({ ...form, amountRequestedDollars: e.target.value })} />
              </Field>
              <Field label="Project title" id={FIELD_IDS.projectTitle} required error={fieldError(visibleErrors, "Project title")}>
                <input className="input" value={form.projectTitle} onChange={(e) => setForm({ ...form, projectTitle: e.target.value })} />
              </Field>
              <Field label="Project summary" id={FIELD_IDS.projectSummary} required error={fieldError(visibleErrors, "Project summary")}>
                <textarea className="textarea" rows={5} value={form.projectSummary} onChange={(e) => setForm({ ...form, projectSummary: e.target.value })} />
              </Field>
              <Field label="Proposed use of funds">
                <textarea className="textarea" rows={4} value={form.proposedUseOfFunds} onChange={(e) => setForm({ ...form, proposedUseOfFunds: e.target.value })} />
              </Field>
              <Field label="Expected outcomes">
                <textarea className="textarea" rows={4} value={form.expectedOutcomes} onChange={(e) => setForm({ ...form, expectedOutcomes: e.target.value })} />
              </Field>
              <button className="btn btn--accent" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit funding request"}
              </button>
            </div>
          </form>
          )}
        </div>
      </section>
    </div>
  );
}

function fieldError(errors: { label: string; message: string }[], label: string) {
  return errors.find((error) => error.label === label)?.message;
}
