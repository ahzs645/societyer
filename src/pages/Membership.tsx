import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { centsToDollarInput, dollarInputToCents, money, formatDate } from "../lib/format";
import {
  CreditCard,
  UserPlus,
  PlusCircle,
  Trash2,
  CheckCircle2,
  CalendarClock,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { StudentLevyIntakeDrawer } from "../components/StudentLevyIntakeDrawer";

const PLAN_INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
  { value: "one_time", label: "One-time" },
];

const FEE_INTERVALS = [
  ...PLAN_INTERVALS,
  { value: "semester", label: "Semester / term" },
];

const FEE_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function newFeeDraft(plan?: any) {
  return {
    id: undefined,
    planId: plan?._id ?? "",
    label: plan?.name ?? "",
    membershipClass: plan?.membershipClass ?? "",
    priceDollars: centsToDollarInput(plan?.priceCents ?? 2500),
    currency: plan?.currency ?? "CAD",
    interval: plan?.interval ?? "year",
    effectiveFrom: todayISO(),
    effectiveTo: "",
    status: "active",
    notes: "",
  };
}

function feeDraftFromPeriod(period: any) {
  return {
    id: period.synthetic ? undefined : period._id,
    planId: period.planId ?? "",
    label: period.label ?? period.planName ?? "",
    membershipClass: period.membershipClass ?? "",
    priceDollars: centsToDollarInput(period.priceCents),
    currency: period.currency ?? "CAD",
    interval: period.interval ?? "year",
    effectiveFrom: period.effectiveFrom === "current" ? todayISO() : period.effectiveFrom,
    effectiveTo: period.effectiveTo ?? "",
    status: period.status ?? "active",
    notes: period.notes ?? "",
  };
}

export function MembershipPage() {
  const society = useSociety();
  const plans = useQuery(
    api.subscriptions.plans,
    society ? { societyId: society._id } : "skip",
  );
  const subs = useQuery(
    api.subscriptions.allSubscriptions,
    society ? { societyId: society._id } : "skip",
  );
  const feeTimeline = useQuery(
    api.subscriptions.feeTimeline,
    society ? { societyId: society._id } : "skip",
  );
  const upsertPlan = useMutation(api.subscriptions.upsertPlan);
  const removePlan = useMutation(api.subscriptions.removePlan);
  const upsertFeePeriod = useMutation(api.subscriptions.upsertFeePeriod);
  const removeFeePeriod = useMutation(api.subscriptions.removeFeePeriod);
  const cancelSub = useMutation(api.subscriptions.cancelSubscription);
  const beginCheckout = useAction(api.subscriptions.beginCheckout);
  const simulateActivation = useMutation(api.subscriptions.simulateActivation);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [planDraft, setPlanDraft] = useState<any>(null);
  const [feeDraft, setFeeDraft] = useState<any>(null);
  const [signup, setSignup] = useState<{
    planId: any;
    planName: string;
    priceCents: number;
    interval: string;
  } | null>(null);
  const [signupForm, setSignupForm] = useState({ fullName: "", email: "" });
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [levyImportOpen, setLevyImportOpen] = useState(false);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const activePlans = (plans ?? []).filter((p) => p.active);
  const activeSubs = (subs ?? []).filter((s) => s.status === "active");
  const activeFeePeriods = (feeTimeline ?? []).filter((p: any) => p.status === "active");

  return (
    <div className="page">
      <PageHeader
        title="Membership & billing"
        icon={<CreditCard size={16} />}
        iconColor="turquoise"
        subtitle="Fee tiers, dated member-fee history, self-serve signup and renewal. Stripe Checkout in live mode; demo mode simulates the full lifecycle."
        actions={
          <>
            <button className="btn-action" onClick={() => setLevyImportOpen(true)}>
              <Upload size={12} /> Import levy
            </button>
            <button className="btn-action" onClick={() => setFeeDraft(newFeeDraft())}>
              <CalendarClock size={12} /> Add fee period
            </button>
            <button
              className="btn-action btn-action--primary"
              onClick={() =>
                setPlanDraft({
                  name: "",
                  description: "",
                  priceCents: 2500,
                  currency: "CAD",
                  interval: "year",
                  benefits: [],
                  membershipClass: "Regular",
                  active: true,
                })
              }
            >
              <PlusCircle size={12} /> New plan
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Active plans" value={String(activePlans.length)} />
        <Stat label="Active subscribers" value={String(activeSubs.length)} />
        <Stat label="Active fee periods" value={String(activeFeePeriods.length)} />
        <Stat
          label="MRR (monthly recurring)"
          value={money(
            activeSubs.reduce((sum, s) => {
              const plan = (plans ?? []).find((p) => p._id === s.planId);
              if (!plan) return sum;
              if (plan.interval === "month") return sum + plan.priceCents;
              if (plan.interval === "year") return sum + Math.round(plan.priceCents / 12);
              return sum;
            }, 0),
          )}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Fee tiers & plans</h2>
          <span className="card__subtitle">Shown on the self-serve signup page; each tier can also carry dated fee periods.</span>
        </div>
        <div className="card__body" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))" }}>
          {(plans ?? []).map((p) => (
            <div
              key={p._id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                background: p.active ? undefined : "var(--bg-soft)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong>{p.name}</strong>
                {!p.active && <Badge>Inactive</Badge>}
                {p.membershipClass && <Badge tone="info">{p.membershipClass}</Badge>}
              </div>
              {p.description && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {p.description}
                </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>
                {money(p.priceCents)}{" "}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  / {p.interval}
                </span>
              </div>
              <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13 }}>
                {p.benefits.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button
                  className="btn btn--accent btn--sm"
                  onClick={() =>
                    setSignup({
                      planId: p._id,
                      planName: p.name,
                      priceCents: p.priceCents,
                      interval: p.interval,
                    })
                  }
                >
                  <UserPlus size={12} /> Sign up
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setFeeDraft(newFeeDraft(p))}
                >
                  Fee
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPlanDraft({ ...p, id: p._id })}
                >
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete membership plan ${p.name}`}
                  onClick={() => removePlan({ id: p._id, actingUserId })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {(plans ?? []).length === 0 && (
            <div className="muted" style={{ padding: 24, textAlign: "center", gridColumn: "1 / -1" }}>
              No plans yet — create one to open signups.
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Member fee timeline</h2>
            <span className="card__subtitle">Historical, current, and planned fee periods by tier.</span>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setFeeDraft(newFeeDraft())}>
            <CalendarClock size={12} /> Add period
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Class</th>
              <th>Fee</th>
              <th>Effective</th>
              <th>Status</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(feeTimeline ?? []).map((period: any) => (
              <tr key={period._id}>
                <td>
                  <strong>{period.label}</strong>
                  {period.planName && period.planName !== period.label && (
                    <div className="muted" style={{ fontSize: 11 }}>{period.planName}</div>
                  )}
                </td>
                <td>{period.membershipClass ? <Badge tone="info">{period.membershipClass}</Badge> : <span className="muted">—</span>}</td>
                <td className="mono">
                  {money(period.priceCents)} <span className="muted">/ {period.interval}</span>
                </td>
                <td className="mono">
                  {period.effectiveFrom === "current" ? "Current" : formatDate(period.effectiveFrom)}
                  {period.effectiveTo ? ` – ${formatDate(period.effectiveTo)}` : ""}
                </td>
                <td>
                  <Badge tone={period.status === "active" ? "success" : period.status === "planned" ? "warn" : "neutral"}>
                    {period.status}
                  </Badge>
                </td>
                <td className="muted" style={{ maxWidth: 320 }}>{period.notes ?? (period.synthetic ? "Current plan price; add a dated period to preserve history." : "—")}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setFeeDraft(feeDraftFromPeriod(period))}
                    >
                      {period.synthetic ? "Add" : "Edit"}
                    </button>
                    {!period.synthetic && (
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label={`Delete fee period ${period.label}`}
                        onClick={async () => {
                          await removeFeePeriod({ id: period._id, actingUserId });
                          toast.success("Fee period removed");
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(feeTimeline ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No fee periods yet. Add one to record the timeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Subscribers</h2>
          <span className="card__subtitle">{(subs ?? []).length} total</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Started</th>
              <th>Renews</th>
              <th>Last payment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(subs ?? []).map((s) => {
              const plan = (plans ?? []).find((p) => p._id === s.planId);
              return (
                <tr key={s._id}>
                  <td>
                    <strong>{s.fullName}</strong>
                    <div className="muted mono" style={{ fontSize: 11 }}>{s.email}</div>
                  </td>
                  <td>{plan?.name ?? "—"}</td>
                  <td>
                    <Badge
                      tone={
                        s.status === "active"
                          ? "success"
                          : s.status === "pending"
                          ? "warn"
                          : s.status === "canceled"
                          ? "danger"
                          : "info"
                      }
                    >
                      {s.status}
                    </Badge>
                    {s.demo && <Badge>demo</Badge>}
                  </td>
                  <td className="mono">{formatDate(s.startedAtISO)}</td>
                  <td className="mono">{s.currentPeriodEndISO ? formatDate(s.currentPeriodEndISO) : "—"}</td>
                  <td className="mono">{s.lastPaymentCents != null ? money(s.lastPaymentCents) : "—"}</td>
                  <td>
                    {s.status !== "canceled" && (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => cancelSub({ id: s._id, actingUserId })}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {(subs ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No subscriptions yet. Sign up from one of the plan cards above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!planDraft}
        onClose={() => setPlanDraft(null)}
        title={planDraft?.id ? "Edit plan" : "New plan"}
        footer={
          <>
            <button className="btn" onClick={() => setPlanDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertPlan({
                  ...planDraft,
                  societyId: society._id,
                  actingUserId,
                });
                toast.success("Plan saved");
                setPlanDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {planDraft && (
          <div>
            <Field label="Name">
              <input
                className="input"
                value={planDraft.name}
                onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                value={planDraft.description ?? ""}
                onChange={(e) => setPlanDraft({ ...planDraft, description: e.target.value })}
              />
            </Field>
            <Field label="Price (CAD)">
              <input
                className="input"
                type="number"
                value={planDraft.priceCents / 100}
                onChange={(e) =>
                  setPlanDraft({ ...planDraft, priceCents: Math.round(Number(e.target.value) * 100) })
                }
              />
            </Field>
            <Field label="Interval">
              <Select
                value={planDraft.interval}
                onChange={(v) => setPlanDraft({ ...planDraft, interval: v })}
                options={PLAN_INTERVALS}
              />
            </Field>
            <Field label="Membership class (optional)">
              <input
                className="input"
                value={planDraft.membershipClass ?? ""}
                onChange={(e) => setPlanDraft({ ...planDraft, membershipClass: e.target.value })}
              />
            </Field>
            <Field label="Benefits (one per line)">
              <textarea
                className="textarea"
                value={(planDraft.benefits ?? []).join("\n")}
                onChange={(e) =>
                  setPlanDraft({
                    ...planDraft,
                    benefits: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Active">
              <Select
                value={planDraft.active ? "yes" : "no"}
                onChange={(v) => setPlanDraft({ ...planDraft, active: v === "yes" })}
                options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
              />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!feeDraft}
        onClose={() => setFeeDraft(null)}
        title={feeDraft?.id ? "Edit fee period" : "Add fee period"}
        footer={
          <>
            <button className="btn" onClick={() => setFeeDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!feeDraft?.label || !feeDraft?.effectiveFrom}
              onClick={async () => {
                const priceCents = dollarInputToCents(feeDraft.priceDollars) ?? 0;
                await upsertFeePeriod({
                  id: feeDraft.id,
                  societyId: society._id,
                  planId: feeDraft.planId || undefined,
                  label: feeDraft.label,
                  membershipClass: feeDraft.membershipClass || undefined,
                  priceCents,
                  currency: feeDraft.currency || "CAD",
                  interval: feeDraft.interval,
                  effectiveFrom: feeDraft.effectiveFrom,
                  effectiveTo: feeDraft.effectiveTo || undefined,
                  status: feeDraft.status,
                  notes: feeDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Fee period saved");
                setFeeDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {feeDraft && (
          <div>
            <Field label="Linked plan">
              <select
                className="input"
                value={feeDraft.planId ?? ""}
                onChange={(e) => {
                  const plan = (plans ?? []).find((p) => p._id === e.target.value);
                  setFeeDraft({
                    ...feeDraft,
                    planId: e.target.value,
                    label: plan?.name ?? feeDraft.label,
                    membershipClass: plan?.membershipClass ?? feeDraft.membershipClass,
                    priceDollars: plan ? centsToDollarInput(plan.priceCents) : feeDraft.priceDollars,
                    currency: plan?.currency ?? feeDraft.currency,
                    interval: plan?.interval ?? feeDraft.interval,
                  });
                }}
              >
                <option value="">Standalone fee period</option>
                {(plans ?? []).map((plan) => (
                  <option key={plan._id} value={plan._id}>{plan.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Fee label">
              <input
                className="input"
                value={feeDraft.label}
                onChange={(e) => setFeeDraft({ ...feeDraft, label: e.target.value })}
              />
            </Field>
            <Field label="Membership class">
              <input
                className="input"
                value={feeDraft.membershipClass ?? ""}
                onChange={(e) => setFeeDraft({ ...feeDraft, membershipClass: e.target.value })}
              />
            </Field>
            <Field label="Price (CAD)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={feeDraft.priceDollars}
                onChange={(e) => setFeeDraft({ ...feeDraft, priceDollars: e.target.value })}
              />
            </Field>
            <Field label="Interval">
              <Select
                value={feeDraft.interval}
                onChange={(v) => setFeeDraft({ ...feeDraft, interval: v })}
                options={FEE_INTERVALS}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Effective from">
                <input
                  className="input"
                  type="date"
                  value={feeDraft.effectiveFrom}
                  onChange={(e) => setFeeDraft({ ...feeDraft, effectiveFrom: e.target.value })}
                />
              </Field>
              <Field label="Effective to">
                <input
                  className="input"
                  type="date"
                  value={feeDraft.effectiveTo ?? ""}
                  onChange={(e) => setFeeDraft({ ...feeDraft, effectiveTo: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Status">
              <Select
                value={feeDraft.status}
                onChange={(v) => setFeeDraft({ ...feeDraft, status: v })}
                options={FEE_STATUSES}
              />
            </Field>
            <Field label="Notes">
              <textarea
                className="textarea"
                value={feeDraft.notes ?? ""}
                onChange={(e) => setFeeDraft({ ...feeDraft, notes: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!signup}
        onClose={() => {
          setSignup(null);
          setCheckoutUrl(null);
          setSignupForm({ fullName: "", email: "" });
        }}
        title={`Sign up · ${signup?.planName ?? ""}`}
        footer={
          checkoutUrl ? (
            <>
              <button
                className="btn"
                onClick={() => {
                  setCheckoutUrl(null);
                  setSignup(null);
                }}
              >
                Close
              </button>
              <button
                className="btn btn--accent"
                onClick={async () => {
                  if (!signup) return;
                  await simulateActivation({
                    societyId: society._id,
                    planId: signup.planId,
                    email: signupForm.email,
                    fullName: signupForm.fullName,
                  });
                  toast.success("Payment confirmed (demo) — subscription active");
                  setCheckoutUrl(null);
                  setSignup(null);
                  setSignupForm({ fullName: "", email: "" });
                }}
              >
                <CheckCircle2 size={12} /> Simulate payment
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                onClick={() => {
                  setSignup(null);
                  setSignupForm({ fullName: "", email: "" });
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn--accent"
                disabled={!signupForm.fullName || !signupForm.email}
                onClick={async () => {
                  if (!signup) return;
                  const { url, demo } = await beginCheckout({
                    societyId: society._id,
                    planId: signup.planId,
                    email: signupForm.email,
                    fullName: signupForm.fullName,
                  });
                  if (demo) {
                    setCheckoutUrl(url);
                  } else {
                    window.location.href = url;
                  }
                }}
              >
                Continue to checkout
              </button>
            </>
          )
        }
      >
        {signup && !checkoutUrl && (
          <div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
              Signing up for <strong>{signup.planName}</strong> — {money(signup.priceCents)} / {signup.interval}
            </div>
            <Field label="Full name">
              <input
                className="input"
                value={signupForm.fullName}
                onChange={(e) => setSignupForm({ ...signupForm, fullName: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={signupForm.email}
                onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
              />
            </Field>
          </div>
        )}
        {signup && checkoutUrl && (
          <div>
            <div
              style={{
                padding: 20,
                border: "1px dashed var(--border)",
                borderRadius: 8,
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              <strong>Demo Checkout</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                In live mode this would be Stripe's hosted checkout. Click{" "}
                <em>Simulate payment</em> to activate the subscription as if the webhook fired.
              </div>
              <div className="mono" style={{ fontSize: 11, marginTop: 8, color: "var(--text-tertiary)" }}>
                {checkoutUrl}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <StudentLevyIntakeDrawer
        open={levyImportOpen}
        onClose={() => setLevyImportOpen(false)}
        societyId={society._id}
        societyName={society.name}
        actingUserId={actingUserId}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}
