import { useState } from "react";
import { calendarDateKey } from "../lib/calendarDates";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field, InspectorNote } from "../components/ui";
import { ShieldCheck, Plus, Trash2 } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { isCorporation } from "../../shared/organizationDomain";

/**
 * BC Transparency Register of Significant Individuals + a diligence-steps
 * sub-register. This register is required for BC private corporations under
 * the Business Corporations Act — not for societies — but it is tracked here
 * for organizations that operate on the corporations track.
 */
export function SignificantIndividualsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("deadlines:write");
  const [asOf, setAsOf] = useState(calendarDateKey(new Date()));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const toast = useToast();

  const individuals = useQuery(
    api.registerHistory.significantIndividualsAsOf,
    society ? { societyId: society._id, asOf } : "skip",
  ) as
    | Array<{
        name: string;
        dateOfBirth?: string;
        becameSignificantOn: string;
        ceasedSignificantOn?: string;
        reason: string;
        status?: string;
      }>
    | undefined;

  const steps = useQuery(
    api.significantIndividualSteps.list,
    society ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id: string;
        individualName: string;
        stepsNarrative: string;
        stepDate: string;
        nextReviewDate?: string;
      }>
    | undefined;

  const reviewsDue = useQuery(
    api.significantIndividualSteps.reviewsDue,
    society ? { societyId: society._id, asOf } : "skip",
  ) as Array<{ _id: string }> | undefined;

  const createStep = usePermissionedMutation(api.significantIndividualSteps.create, canWrite);
  const removeStep = usePermissionedMutation(api.significantIndividualSteps.remove, canWrite);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      individualName: "",
      stepDate: calendarDateKey(new Date()),
      stepsNarrative: "",
      nextReviewDate: "",
    });
    setOpen(true);
  };

  const formProblems = form
    ? [
        !String(form.individualName ?? "").trim() ? "the individual's name" : "",
        !String(form.stepsNarrative ?? "").trim() ? "the steps taken" : "",
        !form.stepDate ? "the step date" : "",
      ].filter(Boolean)
    : [];
  const save = async () => {
    if (!canWrite || !form) return;
    if (formProblems.length) {
      toast.error("Step not recorded", `Enter ${formProblems.join(", ")}.`);
      return;
    }
    try {
      await createStep({
        societyId: society._id,
        individualName: form.individualName.trim(),
        stepsNarrative: form.stepsNarrative.trim(),
        stepDate: form.stepDate,
        nextReviewDate: form.nextReviewDate || undefined,
        nowISO: new Date().toISOString(),
      });
      setOpen(false);
      toast.success("Diligence step recorded");
    } catch (error) {
      toast.error("Step not recorded", error instanceof Error ? error.message : String(error));
    }
  };
  const notApplicable = !isCorporation(society);

  const dueCount = reviewsDue?.length ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="Significant individuals"
        icon={<ShieldCheck size={16} />}
        iconColor="green"
        subtitle="Transparency Register of significant individuals (controllers) shown as of a chosen date, with the reasonable-diligence steps taken to identify them. This register is required for BC private corporations under the Business Corporations Act — not for societies."
        actions={
          <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
            <Plus size={12} /> Record step
          </button>
        }
      />

      {notApplicable && (
        <InspectorNote title="Not required for this organization">
          {society.name} is not a BC company, so the BC Business Corporations Act transparency register does not apply.
          Records kept here are optional and are not a statutory register for a society.
        </InspectorNote>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <Field label="As of">
          <DatePicker
            value={asOf}
            onChange={(value) => setAsOf(value)}
          />
        </Field>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2 className="page__section-title">Significant individuals</h2>
        {individuals === undefined ? (
          <div className="card">Loading…</div>
        ) : individuals.length === 0 ? (
          <div className="card">No significant individuals as of this date.</div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {individuals.map((ind: any, i: number) => (
              <div
                key={i}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <strong>{ind.name}</strong>
                  {ind.status && <span className="muted">{ind.status}</span>}
                </div>
                <div className="muted">{ind.reason}</div>
                <div className="muted" style={{ display: "flex", gap: 12 }}>
                  <span>Became significant: {ind.becameSignificantOn}</span>
                  {ind.ceasedSignificantOn && (
                    <span>Ceased: {ind.ceasedSignificantOn}</span>
                  )}
                  {ind.dateOfBirth && <span>DOB: {ind.dateOfBirth}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="page__section-title">Diligence steps taken</h2>
        {dueCount > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            {dueCount} review{dueCount === 1 ? "" : "s"} due
          </div>
        )}
        {steps === undefined ? (
          <div className="card">Loading…</div>
        ) : steps.length === 0 ? (
          <div className="card">No diligence steps recorded.</div>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((s: any) => (
              <div
                key={s._id}
                style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
              >
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <strong>{s.individualName}</strong>
                    <span className="muted">{s.stepDate}</span>
                  </div>
                  <div className="muted">{s.stepsNarrative}</div>
                  {s.nextReviewDate && (
                    <div className="muted">Next review: {s.nextReviewDate}</div>
                  )}
                </div>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove step for ${s.individualName}`}
                  disabled={!canWrite}
                  onClick={() => { if (canWrite) void removeStep({ id: s._id }); }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Record diligence step"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite} onClick={save}>Save</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Individual name">
              <input
                disabled={!canWrite}
                className="input"
                value={form.individualName}
                onChange={(e) => setForm({ ...form, individualName: e.target.value })}
              />
            </Field>
            <Field label="Step date">
              <DatePicker
                disabled={!canWrite}
                value={form.stepDate}
                onChange={(value) => setForm({ ...form, stepDate: value })}
              />
            </Field>
            <Field label="Steps narrative">
              <textarea
                disabled={!canWrite}
                className="input"
                value={form.stepsNarrative}
                onChange={(e) => setForm({ ...form, stepsNarrative: e.target.value })}
              />
            </Field>
            <Field label="Next review date">
              <DatePicker
                disabled={!canWrite}
                value={form.nextReviewDate}
                onChange={(value) => setForm({ ...form, nextReviewDate: value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default SignificantIndividualsPage;
