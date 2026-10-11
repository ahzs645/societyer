// Compatibility barrel for the local Convex-compatible client.
export { StaticConvexClient } from "./staticConvexClient";
export type { StaticDemoSeed } from "./staticDemoStore";

import { StaticConvexClient } from "./staticConvexClient";

// Created on first use only. Importing this barrel used to construct a demo
// client eagerly, which opened and hydrated a second IndexedDB vault (and ran
// its metadata seed) on every boot of every local workspace.
let demoClient: StaticConvexClient | null = null;

export function getStaticConvex() {
  demoClient ??= new StaticConvexClient();
  return demoClient;
}

export function reseedStaticDemoData() {
  return getStaticConvex().reseedStaticDemo();
}
