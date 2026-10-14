import { lazy, Suspense, type ComponentProps } from "react";

/* Lazy entry so the chart kit stays out of the Membership route's first paint. */
const MembersTrendCardImpl = lazy(() => import("./MembersTrendCard").then((m) => ({ default: m.MembersTrendCard })));

export function MembersTrendCardLazy(props: ComponentProps<typeof MembersTrendCardImpl>) {
  return (
    <Suspense fallback={null}>
      <MembersTrendCardImpl {...props} />
    </Suspense>
  );
}
