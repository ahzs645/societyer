import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { Banner, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { formatMoney } from "../../../lib/money";
import { formatDistanceKm, formatMileageRate, mileageAmountCents } from "../../../../shared/expensePolicy";
import type { ClaimBudgetOption } from "../spendBudgets/types";

export type MileageDraft = { distanceKm: string; fromLocation: string; toLocation: string; tripDescription: string };

export function parseDistance(value: string | undefined): number | undefined {
  const distance = Number(String(value ?? "").replace(/,/g, "").trim());
  return value && Number.isFinite(distance) && distance > 0 ? distance : undefined;
}

/**
 * Mileage claim fields: distance, where the trip started and ended and what it
 * was for. The amount is distance × the organisation's mileage rate from the
 * claim policy; mileage claims don't need a receipt.
 */
export function ClaimMileageFields({ value, rateCentsPerKm, onChange }: { value: MileageDraft; rateCentsPerKm: number | null | undefined; onChange: (patch: Partial<MileageDraft>) => void }) {
  const distance = parseDistance(value.distanceKm);
  return (
    <div className="claim-mileage">
      {!rateCentsPerKm && (
        <Banner tone="warn" title="No mileage rate yet">
          Set your organisation's rate per kilometre under <Link to="/app/approvals?tab=policy">Approvals → Claim policy</Link> before submitting mileage claims.
        </Banner>
      )}
      <div className="claim-editor__grid">
        <Field label="Distance (km)" required>
          <input className="input" inputMode="decimal" placeholder="0" value={value.distanceKm} onChange={(event) => onChange({ distanceKm: event.target.value })} />
        </Field>
        <Field label="Rate" hint="Your organisation's rate, set in the claim policy.">
          <input className="input" readOnly value={rateCentsPerKm ? formatMileageRate(rateCentsPerKm) : "Not set"} />
        </Field>
      </div>
      <div className="claim-editor__grid">
        <Field label="From">
          <input className="input" value={value.fromLocation} placeholder="e.g. Community hall" onChange={(event) => onChange({ fromLocation: event.target.value })} />
        </Field>
        <Field label="To">
          <input className="input" value={value.toLocation} placeholder="e.g. Food bank warehouse" onChange={(event) => onChange({ toLocation: event.target.value })} />
        </Field>
      </div>
      <Field label="Trip" hint="What the trip was for. Optional when you enter where it started and ended.">
        <input className="input" value={value.tripDescription} placeholder="e.g. Pickup for the summer meal program" onChange={(event) => onChange({ tripDescription: event.target.value })} />
      </Field>
      <p className="claim-mileage__amount" role="status">
        {distance && rateCentsPerKm
          ? <>{formatDistanceKm(distance)} × {formatMileageRate(rateCentsPerKm)} = <strong><Money cents={mileageAmountCents(distance, rateCentsPerKm)} /></strong>. No receipt needed.</>
          : "Enter the distance to work out the amount. No receipt needed."}
      </p>
    </div>
  );
}

/**
 * The spend budget a claim is charged to: only budgets the claimant is
 * assigned to, with what is left in the claim's cycle and a warning when this
 * claim would go over.
 */
export function ClaimBudgetField({
  societyId,
  claimantUserId,
  incurredAtISO,
  amountCents,
  claimId,
  value,
  onChange,
}: {
  societyId: string;
  claimantUserId?: string;
  incurredAtISO?: string;
  amountCents: number;
  claimId?: string;
  value: string;
  onChange: (spendBudgetId: string) => void;
}) {
  const options = useQuery(
    api.spendBudgets.optionsForClaim,
    claimantUserId ? { societyId, claimantUserId, incurredAtISO: incurredAtISO || undefined, amountCents, claimId } : "skip",
  ) as ClaimBudgetOption[] | undefined;
  const selected = options?.find((option) => option._id === value);
  if (!claimantUserId) {
    return (
      <Field label="Spend budget" hint="Link the claim to a user to charge it to a spend budget.">
        <Select value="" onChange={() => undefined} disabled placeholder="No spend budget" options={[]} />
      </Field>
    );
  }
  return (
    <>
      <Field
        label="Spend budget"
        hint={options && options.length === 0 ? "The claimant isn't assigned to an active spend budget." : selected ? `${formatMoney(selected.remainingCents)} left of ${formatMoney(selected.limitCents)} this ${selected.cycleLabel === "One time" ? "budget" : "cycle"}.` : "Optional. Only budgets the claimant is assigned to are listed."}
      >
        <Select
          value={value}
          onChange={onChange}
          clearable
          clearLabel="No spend budget"
          placeholder="No spend budget"
          options={(options ?? []).map((option) => ({ value: option._id, label: option.name, hint: `${formatMoney(option.remainingCents)} left` }))}
        />
      </Field>
      {selected?.exceeds && (
        <Banner tone="warn" title="Over the spend budget">
          This claim would take {selected.name} over its limit: {formatMoney(-selected.remainingAfterCents)} more than the {formatMoney(selected.remainingCents)} left. Approvers will see this.
        </Banner>
      )}
    </>
  );
}
