import { lazy, Suspense, type ComponentProps } from "react";

/*
 * Lazy entry points so the chart kit stays out of the initial route bundle.
 * Host pages import these wrappers (one import, one element each); the
 * fallback is empty because each placement decides for itself whether it
 * renders at all.
 */
const FinancialInsightsImpl = lazy(() => import("./FinancialInsights").then((m) => ({ default: m.FinancialInsights })));
const DashboardFinanceSnapshotImpl = lazy(() => import("./DashboardFinanceSnapshot").then((m) => ({ default: m.DashboardFinanceSnapshot })));

export function FinancialInsightsLazy(props: ComponentProps<typeof FinancialInsightsImpl>) {
  return (
    <Suspense fallback={null}>
      <FinancialInsightsImpl {...props} />
    </Suspense>
  );
}

export function DashboardFinanceSnapshotLazy(props: ComponentProps<typeof DashboardFinanceSnapshotImpl>) {
  return (
    <Suspense fallback={null}>
      <DashboardFinanceSnapshotImpl {...props} />
    </Suspense>
  );
}
