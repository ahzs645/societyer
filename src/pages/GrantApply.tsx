import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { ArrowLeft, BadgeDollarSign } from "lucide-react";

export function GrantApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const context = useQuery(api.publicPortal.grantIntakeContext, slug ? { slug } : "skip");
  const currentUser = useCurrentUser();
  const submitApplication = useMutation(api.grants.submitApplication);
  const toast = useToast();
  const [form, setForm] = useState({
    grantId: "",
    applicantName: currentUser?.displayName ?? "",
    organizationName: "",
    email: currentUser?.email ?? "",
    phone: "",
    amountRequestedCents: "",
    projectTitle: "",
    projectSummary: "",
    proposedUseOfFunds: "",
    expectedOutcomes: "",
  });

  const selectedGrant = useMemo(
    () => (context?.grants ?? []).find((grant) => String(grant._id) === form.grantId) ?? null,
    [context?.grants, form.grantId],
  );

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

  const submit = async () => {
    await submitApplication({
      societyId: context.society._id,
      grantId: form.grantId ? (form.grantId as any) : undefined,
      memberId: currentUser?.memberId ?? undefined,
      applicantName: form.applicantName,
      organizationName: form.organizationName || undefined,
      email: form.email,
      phone: form.phone || undefined,
      amountRequestedCents: form.amountRequestedCents
        ? Number(form.amountRequestedCents)
        : undefined,
      projectTitle: form.projectTitle,
      projectSummary: form.projectSummary,
      proposedUseOfFunds: form.proposedUseOfFunds || undefined,
      expectedOutcomes: form.expectedOutcomes || undefined,
      source: currentUser?.memberId ? "portal" : "public",
    });
    toast.success("Grant application submitted");
    setForm((current) => ({
      ...current,
      phone: "",
      amountRequestedCents: "",
      projectTitle: "",
      projectSummary: "",
      proposedUseOfFunds: "",
      expectedOutcomes: "",
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
            <BadgeDollarSign size={12} /> Grant application
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>
            Funding intake for {context.society.name}
          </h1>
          <p className="landing__lede">
            Submit a project or funding request directly. It will land in the internal intake queue
            instead of being re-entered by hand later.
          </p>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {context.grants.length > 0 && (
                <Field label="Program or opportunity">
                  <select className="input" value={form.grantId} onChange={(e) => setForm({ ...form, grantId: e.target.value })}>
                    <option value="">General funding intake</option>
                    {context.grants.map((grant) => (
                      <option key={grant._id} value={grant._id}>
                        {grant.title}
                      </option>
                    ))}
                  </select>
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
              <Field label="Applicant name">
                <input className="input" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} />
              </Field>
              <Field label="Organization name">
                <input className="input" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Requested amount (cents)">
                <input className="input" type="number" value={form.amountRequestedCents} onChange={(e) => setForm({ ...form, amountRequestedCents: e.target.value })} />
              </Field>
              <Field label="Project title">
                <input className="input" value={form.projectTitle} onChange={(e) => setForm({ ...form, projectTitle: e.target.value })} />
              </Field>
              <Field label="Project summary">
                <textarea className="textarea" rows={5} value={form.projectSummary} onChange={(e) => setForm({ ...form, projectSummary: e.target.value })} />
              </Field>
              <Field label="Proposed use of funds">
                <textarea className="textarea" rows={4} value={form.proposedUseOfFunds} onChange={(e) => setForm({ ...form, proposedUseOfFunds: e.target.value })} />
              </Field>
              <Field label="Expected outcomes">
                <textarea className="textarea" rows={4} value={form.expectedOutcomes} onChange={(e) => setForm({ ...form, expectedOutcomes: e.target.value })} />
              </Field>
              <button className="btn btn--accent" onClick={submit}>
                Submit funding request
              </button>
            </div>
          </div>
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
