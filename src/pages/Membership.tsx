import { isLocalDataRuntime } from "../lib/staticRuntime";
import { CreateMenu } from "../components/CreateMenu";
import { usePermissions } from "../hooks/usePermissions";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, type ToneVariant } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { centsToDollarInput, dollarInputToCents, money, formatDate } from "../lib/format";
import { Menu, type MenuSection } from "../components/Menu";
import { InfoPopover } from "../components/InfoPopover";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import {
  CreditCard,
  MoreHorizontal,
  Pencil,
  UserPlus,
  Trash2,
  CheckCircle2,
  CalendarClock,
  Upload,
  ReceiptText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  useRecordTableState,
  type RecordTableCardHelpers,
} from "../platform/record-engine/record-table";
import { FIELD_TYPES, type FieldMetadata } from "../platform/record-engine/types";
import { StudentLevyIntakeDrawer } from "../components/StudentLevyIntakeDrawer";
import { todayDateOnly } from "../../shared/dateOnly";
import { MembersTrendCardLazy } from "../features/people/insights/lazy";
import { MobileFold } from "../components/MobileFold";
import { useIsMobile } from "../lib/useIsMobile";

/** Phones list this many subscribers before a "Show all" button. */
const PHONE_SUBSCRIBER_LIMIT = 20;

const PLAN_INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
  { value: "one_time", label: "One-time" },
];

function intervalLabel(interval: string) {
  return interval === "one_time" ? "one time" : interval;
}

function sentenceCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : value;
}

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
  return todayDateOnly();
}

/** A row of subscriptions:feeTimeline: a dated fee period, or a plan's current price (`synthetic`). */
type FeePeriod = {
  _id: string;
  planId?: string;
  planName?: string;
  label: string;
  membershipClass?: string;
  priceCents: number;
  currency?: string;
  interval: string;
  /** "current" for a plan's undated price. */
  effectiveFrom: string;
  effectiveTo?: string;
  status: string;
  notes?: string;
  synthetic?: boolean;
};
type FeePeriodRecord = FeePeriod & { effectiveDate: string | null };

type MembershipSubscriber = {
  _id: string;
  planId: string;
  fullName: string;
  email: string;
  status: string;
  demo?: boolean;
  startedAtISO: string;
  currentPeriodEndISO?: string;
  lastPaymentCents?: number | null;
  memberId?: string;
  stripeSubscriptionId?: string;
};
type SubscriberRecord = MembershipSubscriber & { planName?: string };

const FEE_STATUS_TONES: Record<string, ToneVariant> = { active: "success", planned: "warn" };
const SUBSCRIPTION_STATUS_TONES: Record<string, ToneVariant> = { active: "success", pending: "warn", canceled: "danger" };

const FEE_TIMELINE_TABLE = staticRecordTable({
  id: "membership-fee-timeline",
  nameSingular: "memberFeePeriod",
  namePlural: "memberFeePeriods",
  labelSingular: "Fee period",
  labelPlural: "Fee periods",
  labelIdentifierFieldName: "label",
  fields: [
    { name: "label", label: "Tier", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "membershipClass", label: "Class", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "priceCents", label: "Fee", fieldType: FIELD_TYPES.CURRENCY, size: 150, config: { isCents: true, currencyCode: "CAD", groupable: false } },
    {
      name: "interval",
      label: "Interval",
      fieldType: FIELD_TYPES.SELECT,
      size: 130,
      isVisible: false,
      config: { options: FEE_INTERVALS.map((option) => ({ ...option, color: "gray" })) },
    },
    { name: "effectiveDate", label: "Effective", fieldType: FIELD_TYPES.DATE, size: 200 },
    { name: "effectiveTo", label: "Effective to", fieldType: FIELD_TYPES.DATE, size: 140, isVisible: false },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "planned", label: "Planned", color: "amber" },
          { value: "active", label: "Active", color: "green" },
          { value: "retired", label: "Retired", color: "gray" },
        ],
      },
    },
    { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, size: 320, config: { groupable: false } },
  ],
});

const SUBSCRIBERS_TABLE = staticRecordTable({
  id: "membership-subscribers",
  nameSingular: "memberSubscription",
  namePlural: "memberSubscriptions",
  labelSingular: "Subscriber",
  labelPlural: "Subscribers",
  labelIdentifierFieldName: "fullName",
  density: "comfortable",
  fields: [
    { name: "fullName", label: "Member", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, size: 240, isVisible: false, config: { groupable: false } },
    { name: "planName", label: "Plan", fieldType: FIELD_TYPES.TEXT, size: 180 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: {
        options: [
          { value: "active", label: "Active", color: "green" },
          { value: "pending", label: "Pending", color: "amber" },
          { value: "trialing", label: "Trialing", color: "blue" },
          { value: "past_due", label: "Past due", color: "blue" },
          { value: "canceled", label: "Canceled", color: "red" },
        ],
      },
    },
    { name: "demo", label: "Demo", fieldType: FIELD_TYPES.BOOLEAN, size: 100, isVisible: false },
    { name: "startedAtISO", label: "Started", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "currentPeriodEndISO", label: "Renews", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "lastPaymentCents", label: "Last payment", fieldType: FIELD_TYPES.CURRENCY, size: 140, config: { isCents: true, currencyCode: "CAD", groupable: false } },
  ],
});

/** Tells the page whether the table is searched or filtered (the phone list then shows every subscriber). */
function ReportNarrowed({ onChange }: { onChange: (narrowed: boolean) => void }) {
  const narrowed = useRecordTableState((s) => s.searchTerm.trim() !== "" || s.filters.length > 0);
  useEffect(() => onChange(narrowed), [narrowed, onChange]);
  return null;
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
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("settings:write");
  const paymentsAvailable = !isLocalDataRuntime() && canManage;
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
  const billMemberDues = useMutation(api.invoices.billMemberDues);
  const navigate = useNavigate();
  const canInvoice = loaded && can("financials:write");
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const confirm = useConfirm();
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
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [levyImportOpen, setLevyImportOpen] = useState(false);
  const isMobile = useIsMobile();
  const [showAllSubs, setShowAllSubs] = useState(false);
  const [subsNarrowed, setSubsNarrowed] = useState(false);
  const feeRecords = useMemo<FeePeriodRecord[]>(
    () => ((feeTimeline ?? []) as FeePeriod[]).map((period) => ({
      ...period,
      effectiveDate: period.effectiveFrom === "current" ? null : period.effectiveFrom,
    })),
    [feeTimeline],
  );
  const subscriberRecords = useMemo<SubscriberRecord[]>(() => {
    const planNames = new Map<string, string>(((plans ?? []) as { _id: string; name: string }[]).map((plan) => [plan._id, plan.name]));
    return ((subs ?? []) as MembershipSubscriber[]).map((sub) => ({ ...sub, planName: planNames.get(sub.planId) }));
  }, [subs, plans]);
  // Phones list the first few until "Show all"; a search or filter looks through everyone.
  const visibleSubs = useMemo(
    () => isMobile && !showAllSubs && !subsNarrowed ? subscriberRecords.slice(0, PHONE_SUBSCRIBER_LIMIT) : subscriberRecords,
    [isMobile, showAllSubs, subsNarrowed, subscriberRecords],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const activePlans = (plans ?? []).filter((p) => p.active);
  const activeSubs = (subs ?? []).filter((s) => s.status === "active");
  const activeFeePeriods = (feeTimeline ?? []).filter((p: any) => p.status === "active");
  const allSubs = subs ?? [];

  const renderFeeCell = ({ record: period, field }: { record: FeePeriodRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "label":
        return (
          <span className="record-table__identifier-lines">
            <strong className="record-table__identifier-primary">{period.label}</strong>
            {period.planName && period.planName !== period.label && (
              <span className="record-table__identifier-secondary">{period.planName}</span>
            )}
          </span>
        );
      case "membershipClass":
        return period.membershipClass ? <Badge tone="info">{period.membershipClass}</Badge> : <span className="muted">—</span>;
      case "priceCents":
        return (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {money(period.priceCents)} <span className="muted">/ {intervalLabel(period.interval)}</span>
          </span>
        );
      case "effectiveDate":
        return (
          <span>
            {period.effectiveFrom === "current" ? "Current" : formatDate(period.effectiveFrom)}
            {period.effectiveTo ? ` – ${formatDate(period.effectiveTo)}` : ""}
          </span>
        );
      case "status":
        return <Badge tone={FEE_STATUS_TONES[period.status] ?? "neutral"}>{sentenceCase(period.status)}</Badge>;
      case "notes":
        return <span className="muted">{period.notes ?? (period.synthetic ? "Current plan price; add a dated period to preserve history." : "—")}</span>;
      default:
        return undefined;
    }
  };

  // The current plan price (no dated period yet) is added, not edited.
  const renderFeeActions = (period: FeePeriodRecord) => period.synthetic ? (
    <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => setFeeDraft(feeDraftFromPeriod(period))}>
      Add
    </button>
  ) : null;
  const feeMenuSections = (period: FeePeriodRecord): MenuSection[] => period.synthetic ? [] : [{
    id: "period",
    items: [
      { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canManage, onSelect: () => setFeeDraft(feeDraftFromPeriod(period)) },
      {
        id: "delete",
        label: "Delete fee period",
        icon: <Trash2 size={14} />,
        destructive: true,
        disabled: !canManage,
        onSelect: async () => {
          await removeFeePeriod({ id: period._id });
          toast.success("Fee period removed");
        },
      },
    ],
  }];

  const renderFeeCard = (period: FeePeriodRecord, { selecting }: RecordTableCardHelpers) => {
    return (
      <RecordTablePhoneCard
        title={period.label}
        badge={<Badge tone={FEE_STATUS_TONES[period.status] ?? "neutral"}>{sentenceCase(period.status)}</Badge>}
        meta={[
          `${money(period.priceCents)} / ${intervalLabel(period.interval)}`,
          `${period.effectiveFrom === "current" ? "Current" : formatDate(period.effectiveFrom)}${period.effectiveTo ? ` – ${formatDate(period.effectiveTo)}` : ""}`,
        ]}
        detail={[period.membershipClass ?? "", period.notes ?? ""]}
        selecting={selecting}
      />
    );
  };

  const subscriptionBadges = (sub: SubscriberRecord) => (
    <>
      <Badge tone={SUBSCRIPTION_STATUS_TONES[sub.status] ?? "info"}>{sentenceCase(sub.status)}</Badge>
      {sub.demo && <Badge>Demo</Badge>}
    </>
  );

  const renderSubscriberCell = ({ record: sub, field }: { record: SubscriberRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "fullName":
        return (
          <span className="record-table__identifier-lines">
            <strong className="record-table__identifier-primary">{sub.fullName}</strong>
            <span className="record-table__identifier-secondary" title={sub.email}>{sub.email}</span>
          </span>
        );
      case "planName":
        return <span>{sub.planName ?? "—"}</span>;
      case "status":
        return <span>{subscriptionBadges(sub)}</span>;
      case "startedAtISO":
        return <span>{formatDate(sub.startedAtISO)}</span>;
      case "currentPeriodEndISO":
        return <span>{sub.currentPeriodEndISO ? formatDate(sub.currentPeriodEndISO) : "—"}</span>;
      case "lastPaymentCents":
        return <span>{sub.lastPaymentCents != null ? <Money cents={sub.lastPaymentCents} trimWholeCents /> : "—"}</span>;
      default:
        return undefined;
    }
  };

  const renderSubscriberActions = (sub: SubscriberRecord) => (
    <>
      {sub.memberId && sub.status !== "canceled" && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!canInvoice}
          onClick={async () => {
            try {
              const id = await billMemberDues({ societyId: society._id, memberId: sub.memberId });
              toast.success("Dues invoice drafted", "Review it, then mark it as sent.");
              navigate(`/app/invoices?builder=${id}`);
            } catch (error) { toast.error("Could not bill dues", error instanceof Error ? error.message : "Please try again."); }
          }}
        >
          <ReceiptText size={12} /> Bill dues
        </button>
      )}
      {sub.status !== "canceled" && !sub.demo && sub.stripeSubscriptionId ? (
        <a className="btn btn--ghost btn--sm" href="https://dashboard.stripe.com/subscriptions" target="_blank" rel="noopener noreferrer">Manage in Stripe</a>
      ) : sub.status !== "canceled" && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!canManage}
          onClick={async () => {
            const approved = await confirm({
              title: "Cancel subscription?",
              message: `${sub.fullName}'s ${sub.planName ?? "membership"} subscription will be marked canceled. This can't be undone here; they would need to sign up again.`,
              confirmLabel: "Cancel subscription",
              cancelLabel: "Keep subscription",
              tone: "danger",
            });
            if (!approved) return;
            try { await cancelSub({ id: sub._id }); toast.success("Subscription record canceled"); }
            catch (error) { toast.error("Could not cancel subscription", error instanceof Error ? error.message : "Please try again."); }
          }}
        >
          Cancel
        </button>
      )}
    </>
  );

  const renderSubscriberCard = (sub: SubscriberRecord, { selecting }: RecordTableCardHelpers) => {
    return (
      <RecordTablePhoneCard
        title={sub.fullName}
        badge={subscriptionBadges(sub)}
        meta={[
          sub.planName ?? "",
          sub.lastPaymentCents != null ? <Money cents={sub.lastPaymentCents} trimWholeCents /> : "",
        ]}
        detail={[sub.email, sub.currentPeriodEndISO ? `Renews ${formatDate(sub.currentPeriodEndISO)}` : ""]}
        selecting={selecting}
      />
    );
  };
  const planSummary = (plans ?? []).length
    ? (plans ?? []).map((p) => `${p.name} ${money(p.priceCents)}/${p.interval === "one_time" ? "once" : intervalLabel(p.interval)}`).join(" · ")
    : "No plans yet";

  return (
    <div className="page">
      <PageHeader
        title="Membership & billing"
        icon={<CreditCard size={16} />}
        iconColor="turquoise"
        subtitle="Fee tiers, member-fee history, signup and renewal."
        info={
          <p>
            Recurring subscriptions run through Stripe; payments and cancellations update after verified webhooks. Payments need a
            configured provider and a connected server; simulation needs a demo workspace.
          </p>
        }
        actions={
          <>
            <MoreActionsMenu
              items={(canManage ? [
                { id: "import-levy", label: "Import levy", icon: <Upload size={14} />, onSelect: () => setLevyImportOpen(true) },
              ] : []).concat(canInvoice ? [
                { id: "dues-invoices", label: "Generate dues invoices", icon: <ReceiptText size={14} />, onSelect: () => navigate("/app/invoices?dues=1") },
              ] : [])}
            />
            <CreateMenu
              disabled={!canManage}
              items={[
                {
                  id: "plan",
                  label: "Membership plan",
                  onSelect: () =>
                    setPlanDraft({
                      name: "",
                      description: "",
                      priceCents: 2500,
                      currency: "CAD",
                      interval: "year",
                      benefits: [],
                      membershipClass: "Regular",
                      active: true,
                    }),
                },
                { id: "fee-period", label: "Fee period", icon: <CalendarClock size={14} />, onSelect: () => setFeeDraft(newFeeDraft()) },
              ]}
            />
          </>
        }
      />

      {isLocalDataRuntime() && <p className="muted" role="status" style={{ margin: "0 0 12px", fontSize: "var(--fs-sm)" }}>Checkout and subscription activation require a connected server. Plans and fee history can still be maintained locally.</p>}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatTile label="Active plans" value={activePlans.length} />
        <StatTile label="Active subscribers" value={activeSubs.length} />
        <StatTile label="Active fee periods" value={activeFeePeriods.length} />
        <StatTile
          label="Monthly dues revenue"
          value={<Money variant="hero" trimWholeCents cents={
            activeSubs.reduce((sum, s) => {
              const plan = (plans ?? []).find((p) => p._id === s.planId);
              if (!plan) return sum;
              if (plan.interval === "month") return sum + plan.priceCents;
              if (plan.interval === "year") return sum + Math.round(plan.priceCents / 12);
              return sum;
            }, 0)} />}
        />
      </div>

      <MobileFold title="Fee tiers & plans" summary={planSummary} defaultOpen>
      <section className="membership-plans" style={{ marginBottom: 16 }}>
        <div className="row membership-plans__head" style={{ gap: 6, alignItems: "center", margin: "0 0 8px" }}>
          <h2 className="card__title">Fee tiers & plans</h2>
          <InfoPopover label="About fee tiers">
            <p>Active tiers are shown on the self-serve signup page. Each tier can also carry dated fee periods.</p>
          </InfoPopover>
        </div>
        <div className="membership-plans__grid" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))" }}>
          {(plans ?? []).map((p) => (
            <div
              key={p._id}
              className="card"
              style={{
                margin: 0,
                padding: 12,
                background: p.active ? undefined : "var(--bg-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong>{p.name}</strong>
                {!p.active && <Badge>Inactive</Badge>}
                {p.membershipClass && p.membershipClass.trim().toLowerCase() !== p.name.trim().toLowerCase() && <Badge tone="info">{p.membershipClass}</Badge>}
              </div>
              {p.description && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {p.description}
                </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>
                {money(p.priceCents)}{" "}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  / {intervalLabel(p.interval)}
                </span>
              </div>
              {p.benefits.length > 0 && (
                <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13 }}>
                  {p.benefits.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
                <button
                  className="btn btn--accent btn--sm"
                  disabled={!paymentsAvailable || !p.active}
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
                <span style={{ marginLeft: "auto" }}>
                  <Menu
                    align="right"
                    trigger={
                      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${p.name}`}>
                        <MoreHorizontal size={14} />
                      </button>
                    }
                    sections={[{
                      id: "plan",
                      items: [
                        { id: "edit", label: "Edit plan", icon: <Pencil size={14} />, disabled: !canManage, onSelect: () => setPlanDraft({ ...p, id: p._id }) },
                        { id: "fee", label: "Add fee period", icon: <CalendarClock size={14} />, disabled: !canManage, onSelect: () => setFeeDraft(newFeeDraft(p)) },
                        { id: "delete", label: "Delete plan", icon: <Trash2 size={14} />, destructive: true, disabled: !canManage, onSelect: () => void removePlan({ id: p._id }) },
                      ],
                    }]}
                  />
                </span>
              </div>
            </div>
          ))}
          {(plans ?? []).length === 0 && (
            <div className="card muted" style={{ margin: 0, padding: 24, textAlign: "center", gridColumn: "1 / -1" }}>
              No plans yet — create one to open signups.
            </div>
          )}
        </div>
      </section>
      </MobileFold>

      <MobileFold title="Members over time" summary="Membership trend and joins and departures by year">
        <MembersTrendCardLazy societyId={society._id} />
      </MobileFold>

      <MobileFold title="Member fee timeline" summary={`${pluralCount((feeTimeline ?? []).length, "fee period")} · ${activeFeePeriods.length} active`}>
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Member fee timeline</h2>
          <button className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }} disabled={!canManage} onClick={() => setFeeDraft(newFeeDraft())}>
            <CalendarClock size={12} /> Add period
          </button>
        </div>
        <RecordListTable<FeePeriodRecord>
          variant="card"
          table={FEE_TIMELINE_TABLE}
          tableId="membership-fee-timeline"
          label="All fee periods"
          icon={<CalendarClock size={14} />}
          records={feeRecords}
          loading={feeTimeline === undefined}
          renderCell={renderFeeCell}
          renderRowActions={renderFeeActions}
          rowMenuSections={feeMenuSections}
          renderPhoneCard={renderFeeCard}
          emptyState={<RecordTableEmpty title="No fee periods yet." description="Add one to record the timeline." />}
        />
      </div>
      </MobileFold>

      <MobileFold title="Subscribers" summary={`${allSubs.length} total · ${activeSubs.length} active`}>
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Subscribers</h2>
          <span className="card__subtitle">{allSubs.length} total</span>
        </div>
        <RecordListTable<SubscriberRecord>
          variant="card"
          table={SUBSCRIBERS_TABLE}
          tableId="membership-subscribers"
          label="All subscribers"
          icon={<CreditCard size={14} />}
          records={visibleSubs}
          loading={subs === undefined}
          renderCell={renderSubscriberCell}
          renderRowActions={renderSubscriberActions}
          renderPhoneCard={renderSubscriberCard}
          emptyState={<RecordTableEmpty title="No subscriptions yet." description="Sign up from one of the plan cards above." />}
        >
          <ReportNarrowed onChange={setSubsNarrowed} />
        </RecordListTable>
        {visibleSubs.length < allSubs.length && (
          <div className="card__body">
            <button type="button" className="btn" style={{ width: "100%" }} onClick={() => setShowAllSubs(true)}>
              Show all {allSubs.length} subscribers
            </button>
          </div>
        )}
      </div>
      </MobileFold>

      <Drawer
        open={!!planDraft}
        onClose={() => setPlanDraft(null)}
        title={planDraft?.id ? "Edit plan" : "New plan"}
        footer={
          <>
            <button className="btn" onClick={() => setPlanDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!canManage}
              onClick={async () => {
                if (!canManage) return;
                try {
                await upsertPlan({
                  ...planDraft,
                  societyId: society._id,
                });
                toast.success("Plan saved");
                setPlanDraft(null);
                } catch (error) { toast.error("Could not save plan", error instanceof Error ? error.message : "Please try again."); }
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
              <MarkdownEditor
                rows={4}
                value={planDraft.description ?? ""}
                onChange={(markdown) => setPlanDraft({ ...planDraft, description: markdown })}
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
              disabled={!canManage || !feeDraft?.label || !feeDraft?.effectiveFrom}
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
              <Select
                value={feeDraft.planId ?? ""}
                onChange={(value) => {
                  const plan = (plans ?? []).find((p) => p._id === value);
                  setFeeDraft({
                    ...feeDraft,
                    planId: value,
                    label: plan?.name ?? feeDraft.label,
                    membershipClass: plan?.membershipClass ?? feeDraft.membershipClass,
                    priceDollars: plan ? centsToDollarInput(plan.priceCents) : feeDraft.priceDollars,
                    currency: plan?.currency ?? feeDraft.currency,
                    interval: plan?.interval ?? feeDraft.interval,
                  });
                }}
                options={[
                  { value: "", label: "Standalone fee period" },
                  ...(plans ?? []).map((plan) => ({ value: plan._id, label: plan.name })),
                ]}
              />
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
                <DatePicker
                  value={feeDraft.effectiveFrom}
                  onChange={(value) => setFeeDraft({ ...feeDraft, effectiveFrom: value })}
                />
              </Field>
              <Field label="Effective to">
                <DatePicker
                  value={feeDraft.effectiveTo ?? ""}
                  onChange={(value) => setFeeDraft({ ...feeDraft, effectiveTo: value })}
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
              <MarkdownEditor
                rows={4}
                value={feeDraft.notes ?? ""}
                onChange={(markdown) => setFeeDraft({ ...feeDraft, notes: markdown })}
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
                disabled={!paymentsAvailable || checkoutBusy}
                onClick={async () => {
                  if (!signup || !paymentsAvailable || checkoutBusy) return;
                  setCheckoutBusy(true);
                  try {
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
                  } catch (error) { toast.error("Could not simulate payment", error instanceof Error ? error.message : "Please try again."); }
                  finally { setCheckoutBusy(false); }
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
                disabled={!paymentsAvailable || checkoutBusy || !signupForm.fullName || !signupForm.email}
                onClick={async () => {
                  if (!signup || !paymentsAvailable || checkoutBusy) return;
                  setCheckoutBusy(true);
                  try {
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
                  } catch (error) { toast.error("Could not start checkout", error instanceof Error ? error.message : "Please try again."); }
                  finally { setCheckoutBusy(false); }
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
      />
    </div>
  );
}

function pluralCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
