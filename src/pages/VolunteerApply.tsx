import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ArrowLeft, HandHeart } from "lucide-react";

export function VolunteerApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const context = useQuery(
    api.publicPortal.volunteerIntakeContext,
    slug ? { slug } : "skip",
  );
  const currentUser = useCurrentUser();
  const submitApplication = useMutation(api.volunteers.submitApplication);
  const toast = useToast();
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

  const submit = async () => {
    await submitApplication({
      societyId: context.society._id,
      memberId: currentUser?.memberId ?? undefined,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
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

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              <Field label="First name">
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label="Last name">
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Role or area of interest">
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
              <button className="btn btn--accent" onClick={submit}>
                Submit application
              </button>
            </div>
          </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}
