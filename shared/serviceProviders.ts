/**
 * Generic external service-provider register.
 *
 * Models the parties an organization appoints to provide professional
 * services — lawyers, accountants, bankers, transfer agents, auditors,
 * registered agents — each held over an appoint/remove interval. This is the
 * "DB_GLOB_SERVICE_PROVIDERS" idea: a small, framework-free register whose
 * point-in-time reconstruction reuses the interval logic in registerHistory.
 *
 * Dates are ISO-8601 strings (lexicographically sortable). All functions are
 * pure (no convex/react imports) and take the "as of" instant explicitly.
 */

import { activeAsOf, type IntervalRow } from "./registerHistory";

export type ServiceProviderFunction =
  | "lawyer"
  | "accountant"
  | "banker"
  | "transfer_agent"
  | "auditor"
  | "registered_agent"
  | "other";

export const SERVICE_PROVIDER_FUNCTIONS: ReadonlyArray<{
  value: ServiceProviderFunction;
  label: string;
}> = [
  { value: "lawyer", label: "Lawyer" },
  { value: "accountant", label: "Accountant" },
  { value: "banker", label: "Banker" },
  { value: "transfer_agent", label: "Transfer Agent" },
  { value: "auditor", label: "Auditor" },
  { value: "registered_agent", label: "Registered Agent" },
  { value: "other", label: "Other" },
];

export interface ServiceProvider {
  id?: string;
  function: ServiceProviderFunction;
  firmName: string;
  contactName?: string;
  firmLocation?: string;
  appointedOn?: string;
  removedOn?: string | null;
}

const INTERVAL_FIELDS = { start: "appointedOn", end: "removedOn" } as const;

const VALID_FUNCTIONS: ReadonlySet<ServiceProviderFunction> = new Set(
  SERVICE_PROVIDER_FUNCTIONS.map((entry) => entry.value),
);

/** Providers whose appoint/remove interval covers `asOfISO`. */
export function activeProvidersAsOf(
  list: ServiceProvider[],
  asOfISO: string,
): ServiceProvider[] {
  // ServiceProvider is a closed interface (no index signature), so cast through
  // IntervalRow for the structural interval filter and back to the public type.
  return activeAsOf(
    list as unknown as IntervalRow[],
    asOfISO,
    INTERVAL_FIELDS,
  ) as unknown as ServiceProvider[];
}

/** All providers (active or not) matching a given function. */
export function providersByFunction(
  list: ServiceProvider[],
  fn: ServiceProviderFunction,
): ServiceProvider[] {
  return list.filter((provider) => provider.function === fn);
}

/**
 * The single active provider of `fn` as of `asOfISO`. If several are active,
 * returns the one with the latest `appointedOn` (a missing appointment date
 * sorts earliest). Returns null when none is active.
 */
export function currentProviderFor(
  list: ServiceProvider[],
  fn: ServiceProviderFunction,
  asOfISO: string,
): ServiceProvider | null {
  const candidates = activeProvidersAsOf(
    providersByFunction(list, fn),
    asOfISO,
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, current) =>
    appointedKey(current) >= appointedKey(best) ? current : best,
  );
}

/**
 * Validate a service-provider record: requires a recognized `function` and a
 * non-empty `firmName`, and that `appointedOn <= removedOn` when both present.
 */
export function validateServiceProvider(p: ServiceProvider): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!VALID_FUNCTIONS.has(p.function)) {
    errors.push(`Unknown service-provider function: ${String(p.function)}`);
  }

  if (typeof p.firmName !== "string" || p.firmName.trim() === "") {
    errors.push("firmName is required.");
  }

  const appointed = isoOrNull(p.appointedOn);
  const removed = isoOrNull(p.removedOn);
  if (appointed != null && removed != null && appointed > removed) {
    errors.push(`appointedOn (${appointed}) must be on or before removedOn (${removed}).`);
  }

  return { ok: errors.length === 0, errors };
}

function appointedKey(provider: ServiceProvider): string {
  return isoOrNull(provider.appointedOn) ?? "";
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
