# Semester cost planning implementation contract

Student societies can save a semester/custom period, enter its allocation/opening balance/reserve, reuse recurring costs and staff assumptions, and compare dated cash commitments with costs allocated to the period. Plans are forecasts using editable assumptions. Existing payroll records/provider settings remain the source for actual pay runs/remittances; no forecast creates a payment or pay run.

## Shared model (`shared/costPlanning.ts`)

All money is integer cents. Dates are valid YYYY-MM-DD. One currency per period; foreign costs are excluded with an explicit count. Inclusive period ends. Maximum planning range two years. No hardcoded statutory payroll rates.

```ts
type CostCadence = 'once'|'weekly'|'biweekly'|'monthly'|'quarterly'|'semiannual'|'annual';
type PlanningStatus = 'committed'|'planned'|'paused';
type CostBasis = 'cash'|'allocated';
type CostPeriod = {
  _id?: string; name:string; startDate:string; endDate:string; currency:string;
  allocationCents:number; openingBalanceCents:number; reserveCents:number;
  basis:CostBasis; includePlanned:boolean; spendBudgetId?:string;
};
type PlanningCost = {
  _id?:string; name:string; category:string; currency:string; amountCents:number;
  cadence:CostCadence; startDate:string; anchorDate:string; endDate?:string;
  status:PlanningStatus; sourceKind:'manual'|'insurance'|'subscription'; sourceId?:string;
  notes?:string;
};
type StaffCostPlan = {
  _id?:string; name:string; employeeId?:string; currency:string;
  startDate:string; endDate?:string; status:PlanningStatus;
  compensation:'hourly'|'monthly'|'annual'; rateCents:number; hoursPerWeek?:number;
  payFrequency:'weekly'|'biweekly'|'semimonthly'|'monthly'; payAnchorDate:string;
  vacationPercent?:number; employerPercent?:number; monthlyBenefitsCents?:number;
  assumptionsConfirmed:boolean; notes?:string;
};
```

Export the types, enum labels/default helpers/validators, and `projectCostPeriod(period,costs,staff)`. Output includes cash/allocated cost and staff totals; selected-basis cost, available funding and remaining after reserve; monthly cash/allocated series; category breakdown; per-item totals and sorted cash occurrences; warnings/excluded counts. Engine agent may refine output names, immediately sharing exact final types with UI owner.

Cost anchor is the first payment date (must be on/after startDate). Coverage for recurring cost runs from an occurrence to the day before the next occurrence; the first cycle starts at startDate. Recurrences preserve the original month day, clamping shorter months without drift. Cash includes only occurrences inside the selected period/active dates. Allocated cost prorates overlapping coverage by actual days, including coverage from an earlier renewal. Once-only cost is recognized on its due date. Payment amounts include any nonrecoverable tax entered by the user.

Staff hourly earnings use entered hours/week across five working days (Mon–Fri), monthly salary prorates actual month days, annual salary actual year days. Vacation adds to gross; employer contribution percent applies to gross plus vacation, then monthly benefits are added. These are editable cost assumptions, not statutory withholding calculations. Cash commitments allocate employer cost to scheduled pay dates; pay periods run from the previous pay date +1 through the current pay date. First pay date can follow staff start. Semimonthly pay dates are the 15th and month end. Stop earnings on the staff end date but include an in-period later pay date for final earned amounts. Surface missing/unconfirmed assumptions. Preserve cents across monthly/detail/grand totals; bound expansion with explicit errors.

## Backend (`costPlanning`)

New tables `costPlanningPeriods`, `costPlanningItems`, `staffCostPlans`, each with societyId, appropriate indexes, creator/update attribution and optional archivedAtISO. Register all exports/permissions for portable and hosted runtimes. Root owns integration into schema/registry/export lists/action policy.

- `workspace({societyId,periodId?,cursor?,archived?})`: one bounded period pagination (50), selected period by direct owned get, organization today/base currency/jurisdiction and planning links metadata. Do not load entire people/payroll/bank tables.
- `sourcePage({societyId,collection,cursor?,periodId?})`: one bounded pagination per invocation, collection costs|staff|insurance|subscriptions|employees|budgets|actuals. Return planning-only projections. Employees require employees:read and omit SIN, birthdate, addresses, contact data. Actuals require a selected period with linked spendBudgetId and only include that budget's dated bank records, with explicit source currency.
- `savePeriod({societyId,id?,fields})`, `saveCost(...)`, `saveStaff(...)`: validate before write; scope every reference, enforce financials:write, never trust caller actor fields. Keep optional archive fields additive.
- `setArchived({societyId,kind:'period'|'cost'|'staff',id,archived})` preserves records. No destructive delete required.
- `importSource({societyId,kind:'insurance'|'subscription',sourceId})`: explicit action by user, owned source lookup, idempotently creates/reuses one editable cost. Do not import silently. Derive insurance annual premium + fee using totalCostCents when present; preserve coverage/renewal dates without guessing missing premiums. Subscriptions honor interval/currency/status/dates. A linked record retains planning assumptions until explicitly edited.

Actual bank spending is shown separately from forecast totals. It is money out assigned to the linked spend budget through the selected as-of/period window, not a sum of every organization expense or a second addition to full forecast. Never present an unlinked/incomplete source as a complete actual zero. Sources use bounded pages; no truncated aggregate fallback.

## UI ownership

Main planner at `/app/financials/planning`, exported `CostPlanningPage`. Period presets Winter Jan–Apr, Summer May–Aug, Fall Sep–Dec with fully editable dates. Saved periods/duplicate next-term convenience, currency/allocation/opening/reserve, cash/allocated comparison, budget/remaining cards, monthly graph and table, reusable cost rows and due calendar, committed/planned controls, staff costs, source imports, CSV/Excel and branded graph PDF. Real persisted forms, error states, mobile layout and read/write/export permissions. Labels explain annual cash renewal versus allocated semester cost. Cost and staff changes recalculate live forecasts; issued/exported PDF files retain their snapshot.

Main UI owner owns `src/pages/CostPlanning.tsx`, new `src/features/financials/planning/*` except `StaffCostForm.tsx` and `PayrollSetupPanel.tsx` (staff UI owner). StaffCostForm props `{societyId,currency,today,value?:StaffCostPlan|null,onSaved:()=>void,onCancel:()=>void}`; it calls saveStaff directly and uses bounded employee picker. PayrollSetupPanel reads existing payroll settings/readiness, gives actionable setup links, and may open existing PayrollSettingsDrawer on the Payroll page. Staff owner can edit Payroll.tsx/Employees.tsx for planner navigation/setup, not core planner.

Root integrates lazy route, BooksNav/sidebar/financial entry links, schema/registry/action policy/export lists, package scripts/manifests, documentation, build/hosted verification. Verification owner provides dedicated browser scenarios and a focused review of source privacy, recurrence/rounding, permissions, and native PDF output.
