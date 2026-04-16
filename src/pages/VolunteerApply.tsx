import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ErrorSummary, Field, InspectorNote, type ErrorSummaryItem } from "../components/ui";
import { PIPA_INTAKE_NOTICE } from "../lib/legalCopy";
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
  const submitApplication = useMutation(api.volunteers.submitApplication);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
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

  if (context === undefined) return <div className="page">Loading…</div>;
  if (!context) {
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
    if (errors.length > 0) return;
    setSubmitting(true);
    try {
      await submitApplication({
      societyId: context.society._id,
      memberId: currentUser?.memberId ?? undefined,
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
      source: currentUser?.memberId ? "portal" : "public",
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
    } catch (error: any) {
      toast.error(error?.message ?? "Could not submit application");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ paddingTop: 72, paddingBottom: 56 }}>
        <div className="landing__container" style={{ maxWidth: 760 }}>
          <Link to={`/public/${context.society.publicSlug}`} className="row muted" style={{ marginBottom: 16, fontSize: 12 }}>
            <ArrowLeft size={12} /> Back to public center
          </Link>
          <div className="landing__eyebrow">
            <HandHeart size={12} /> Volunteer application
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>
            Volunteer with {context.society.name}
          </h1>
          <p className="landing__lede">
            Submit your interest once. The society can review, convert it into a volunteer record,
            and track screening and onboarding from there.
          </p>

          <form className="card" style={{ marginTop: 24 }} onSubmit={submit} noValidate>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              <ErrorSummary errors={errors} title="Complete these fields to submit" />
              <InspectorNote title={PIPA_INTAKE_NOTICE.title}>
                {PIPA_INTAKE_NOTICE.body} Published privacy records, when available, appear in the{" "}
                <Link to={`/public/${context.society.publicSlug}`}>public center</Link>.
              </InspectorNote>
              <Field label="First name" id={FIELD_IDS.firstName} required error={fieldError(errors, "First name")}>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoComplete="given-name" />
              </Field>
              <Field label="Last name" id={FIELD_IDS.lastName} required error={fieldError(errors, "Last name")}>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} autoComplete="family-name" />
              </Field>
              <Field label="Email" id={FIELD_IDS.email} required error={fieldError(errors, "Email")}>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
              </Field>
              <Field label="Role or area of interest" id={FIELD_IDS.roleWanted} required error={fieldError(errors, "Role or area of interest")}>
                <input className="input" value={form.roleWanted} onChange={(e) => setForm({ ...form, roleWanted: e.target.value })} />
              </Field>
              <Field label="Availability">
                <input className="input" value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })} />
              </Field>
              <Field label="Interests (comma-separated)">
                <input className="input" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
              </Field>
              <Field label="Anything else the society should know?">
                <textarea className="textarea" rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
              <button className="btn btn--accent" type="submit" disabled={errors.length > 0 || submitting}>
                {submitting ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </form>

          {context.committees.length > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card__head">
                <h2 className="card__title">Current committees</h2>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 10 }}>
                {context.committees.map((committee) => (
                  <div key={committee._id}>
                    <strong>{committee.name}</strong>
                    {committee.summary && (
                      <div className="muted" style={{ marginTop: 4 }}>{committee.summary}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function fieldError(errors: { label: string; message: string }[], label: string) {
  return errors.find((error) => error.label === label)?.message;
}
