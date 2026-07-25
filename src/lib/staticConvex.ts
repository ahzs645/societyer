// Compatibility barrel for the local Convex-compatible client.
export { StaticConvexClient } from "./staticConvexClient";
export type { StaticDemoSeed } from "./staticDemoStore";

import { StaticConvexClient } from "./staticConvexClient";

export const staticConvex = new StaticConvexClient();

export function reseedStaticDemoData() {
  return staticConvex.reseedStaticDemo();
}
