import { lazy, Suspense, type ComponentProps } from "react";

/* Lazy entry so the chart kit stays out of the Grants route's first paint. */
const GrantFundingCardImpl = lazy(() => import("./GrantFundingCard").then((m) => ({ default: m.GrantFundingCard })));

export function GrantFundingCardLazy(props: ComponentProps<typeof GrantFundingCardImpl>) {
  return (
    <Suspense fallback={null}>
      <GrantFundingCardImpl {...props} />
    </Suspense>
  );
}
