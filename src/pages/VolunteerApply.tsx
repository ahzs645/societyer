import { FormEvent, useMemo, useState } from "react";
import { PageLoading } from "./_helpers";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ErrorSummary, Field, type ErrorSummaryItem } from "../components/ui";
import { IntakePrivacyNotice } from "../components/IntakePrivacyNotice";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { ArrowLeft, HandHeart } from "lucide-react";

const FIELD_IDS = {
  firstName: "volunteer-first-name",
  lastName: "volunteer-last-name",
  email: "volunteer-email",
  roleWanted: "volunteer-role-wanted",
} as const;

export function VolunteerApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const context = useQuery(
    api.publicPortal.volunteerIntakeContext,
    slug ? { slug } : "skip",
  );
  const currentUser = useCurrentUser();
  const applicantMemberId = currentUser?.societyId === context?.society?._id ? currentUser?.memberId : undefined;
  const submitApplication = useMutation(api.volunteers.submitApplication);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: currentUser?.email ?? "",
    phone: "",
    roleWanted: "",
    availability: "",
    interests: "",
    notes: "",
  });
  const errors = useMemo(() => {
    const next: ErrorSummaryItem[] = [];
    if (!form.firstName.trim()) {
      next.push({ fieldId: FIELD_IDS.firstName, label: "First name", message: "Enter your first name." });
    }
    if (!form.lastName.trim()) {
      next.push({ fieldId: FIELD_IDS.lastName, label: "Last name", message: "Enter your last name." });
    }
    if (!form.email.trim()) {
      next.push({ fieldId: FIELD_IDS.email, label: "Email", message: "Enter an email address." });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.push({ fieldId: FIELD_IDS.email, label: "Email", message: "Enter a valid email address." });
    }
    if (!form.roleWanted.trim()) {
      next.push({ fieldId: FIELD_IDS.roleWanted, label: "Role or area of interest", message: "Tell the society where you would like to help." });
    }
    return next;
  }, [form.email, form.firstName, form.lastName, form.roleWanted]);

  if (context === undefined) return <PageLoading />;
  if (!context || !context.society) {
    return (
      <div className="landing" style={{ minHeight: "100vh", padding: "4rem 0" }}>
        <div className="landing__container">
          <h1 className="landing__h1">Volunteer intake is unavailable.</h1>
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
      memberId: applicantMemberId ?? undefined,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone || undefined,
      roleWanted: form.roleWanted || undefined,
      availability: form.availability || undefined,
      interests: form.interests
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      notes: form.notes || undefined,
      source: applicantMemberId ? "portal" : "public",
      });
      toast.success("Volunteer application submitted");
      setForm((current) => ({
        ...current,
        phone: "",
        roleWanted: "",
        availability: "",
        interests: "",
        notes: "",
      }));
      setCompleted(true);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not submit application");
    } finally {
      setSubmitting(false);
    }
  };
  const visibleErrors = attemptedSubmit ? errors : [];

  return (
    <div className="landing intake-page">
      <div className="intake">
        <header className="intake__head">
          <Link to={`/public/${context.society.publicSlug}`} className="intake__back">
            <ArrowLeft size={14} /> {context.society.name}
          </Link>
          <div className="landing__eyebrow">
            <HandHeart size={12} /> Volunteer application
          </div>
          <h1 className="intake__title">Volunteer with {context.society.name}</h1>
          <p className="intake__lede">Tell the society where you'd like to help. Someone will follow up by email.</p>
        </header>

        {completed ? (
          <div className="card intake__done">
            <h2 className="card__title">Application submitted</h2>
            <p className="muted">
              {context.society.name} received your application. Keep any follow-up messages for your records.
            </p>
            <Link className="btn btn--accent" to={`/public/${context.society.publicSlug}`}>
              Back to public center
            </Link>
          </div>
        ) : (
          <div className="intake__layout">
            <form className="intake__form" onSubmit={submit} noValidate>
              <ErrorSummary errors={visibleErrors} title="Complete these fields to submit" />
              <fieldset className="intake__section">
                <legend>About you</legend>
                <div className="intake__row">
                  <Field label="First name" id={FIELD_IDS.firstName} required error={fieldError(visibleErrors, "First name")}>
                    <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" />
                  </Field>
                  <Field label="Last name" id={FIELD_IDS.lastName} required error={fieldError(visibleErrors, "Last name")}>
                    <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" />
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
                <legend>How you'd like to help</legend>
                <Field label="Role or area of interest" id={FIELD_IDS.roleWanted} required error={fieldError(visibleErrors, "Role or area of interest")}>
                  <input className="input" value={form.roleWanted} onChange={(e) => setForm({ ...form, roleWanted: e.target.value })} placeholder="e.g. Event setup, bookkeeping, outreach" />
                </Field>
                <div className="intake__row intake__row--wide">
                  <Field label="Availability">
                    <input className="input" value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })} placeholder="e.g. Weekday evenings" />
                  </Field>
                  <Field label="Interests (comma-separated)">
                    <input className="input" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
                  </Field>
                </div>
                <Field label="Anything else the society should know?">
                  <MarkdownEditor rows={4} value={form.notes} onChange={(markdown) => setForm({ ...form, notes: markdown })} />
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
                  {submitting ? "Submitting…" : "Submit application"}
                </button>
              </div>
            </form>

            {context.committees.length > 0 && (
              <aside className="intake__aside" aria-labelledby="volunteer-committees">
                <h2 id="volunteer-committees">Current committees</h2>
                <ul>
                  {context.committees.map((committee) => (
                    <li key={committee._id}>
                      <strong>{committee.name}</strong>
                      {committee.summary && <span>{committee.summary}</span>}
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fieldError(errors: { label: string; message: string }[], label: string) {
  return errors.find((error) => error.label === label)?.message;
}
