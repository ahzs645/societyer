import { staticConvex, reseedStaticDemoData } from "./staticConvex";

// Temporary local-data facade. Keep app startup pointed here so the current
// static demo adapter can be replaced by a durable workspace adapter later
// without changing the React provider wiring again.
export const localDataClient = staticConvex;

export function reseedLocalData() {
  return reseedStaticDemoData();
}
