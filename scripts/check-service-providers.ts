import assert from "node:assert/strict";
import {
  SERVICE_PROVIDER_FUNCTIONS,
  activeProvidersAsOf,
  currentProviderFor,
  providersByFunction,
  validateServiceProvider,
  type ServiceProvider,
} from "../shared/serviceProviders";

const list: ServiceProvider[] = [
  { id: "a", function: "lawyer", firmName: "Old Law LLP", appointedOn: "2020-01-01", removedOn: "2022-06-30" },
  { id: "b", function: "lawyer", firmName: "New Law LLP", appointedOn: "2022-07-01", removedOn: null },
  { id: "c", function: "auditor", firmName: "Audit Co", appointedOn: "2021-03-15" },
  { id: "d", function: "transfer_agent", firmName: "TA Inc", appointedOn: "2023-01-01", removedOn: "2023-12-31" },
  { id: "e", function: "banker", firmName: "Bank One", appointedOn: "2024-02-01" },
];

// activeProvidersAsOf includes/excludes by interval.
const activeMid2021 = activeProvidersAsOf(list, "2021-06-01");
const ids2021 = new Set(activeMid2021.map((p) => p.id));
assert.ok(ids2021.has("a"), "Old Law active mid-2021");
assert.ok(ids2021.has("c"), "Audit Co active mid-2021");
assert.ok(!ids2021.has("b"), "New Law not yet appointed mid-2021");
assert.ok(!ids2021.has("d"), "TA Inc not yet appointed mid-2021");

// Boundary: absent at exact removal end, present at exact appointment start.
assert.ok(
  !activeProvidersAsOf(list, "2022-06-30").some((p) => p.id === "a"),
  "Old Law absent at exact removedOn",
);
assert.ok(
  activeProvidersAsOf(list, "2022-07-01").some((p) => p.id === "b"),
  "New Law present at exact appointedOn",
);

// providersByFunction filters.
const lawyers = providersByFunction(list, "lawyer");
assert.equal(lawyers.length, 2);
assert.deepEqual(new Set(lawyers.map((p) => p.id)), new Set(["a", "b"]));
assert.equal(providersByFunction(list, "accountant").length, 0);

// currentProviderFor returns the right firm.
assert.equal(currentProviderFor(list, "lawyer", "2021-06-01")?.firmName, "Old Law LLP");
assert.equal(currentProviderFor(list, "lawyer", "2023-01-01")?.firmName, "New Law LLP");
assert.equal(currentProviderFor(list, "auditor", "2024-01-01")?.firmName, "Audit Co");

// currentProviderFor returns null when none active.
assert.equal(currentProviderFor(list, "lawyer", "2019-01-01"), null, "no lawyer before any appointment");
assert.equal(currentProviderFor(list, "transfer_agent", "2024-06-01"), null, "TA removed");
assert.equal(currentProviderFor(list, "accountant", "2024-06-01"), null, "no accountant ever");

// currentProviderFor picks latest appointedOn when several active.
const overlap: ServiceProvider[] = [
  { id: "x", function: "banker", firmName: "Bank Early", appointedOn: "2020-01-01" },
  { id: "y", function: "banker", firmName: "Bank Late", appointedOn: "2021-01-01" },
];
assert.equal(currentProviderFor(overlap, "banker", "2022-01-01")?.firmName, "Bank Late");

// validate catches bad function and reversed dates.
const badFn = validateServiceProvider({
  function: "wizard" as unknown as ServiceProvider["function"],
  firmName: "X",
});
assert.equal(badFn.ok, false);
assert.ok(badFn.errors.some((e) => e.includes("function")));

const reversed = validateServiceProvider({
  function: "lawyer",
  firmName: "Y",
  appointedOn: "2023-05-01",
  removedOn: "2023-01-01",
});
assert.equal(reversed.ok, false);
assert.ok(reversed.errors.some((e) => e.includes("appointedOn")));

const missingFirm = validateServiceProvider({ function: "lawyer", firmName: "   " });
assert.equal(missingFirm.ok, false);
assert.ok(missingFirm.errors.some((e) => e.includes("firmName")));

const good = validateServiceProvider({
  function: "auditor",
  firmName: "Good Audit",
  appointedOn: "2023-01-01",
  removedOn: "2023-12-31",
});
assert.equal(good.ok, true);
assert.deepEqual(good.errors, []);

// SERVICE_PROVIDER_FUNCTIONS includes 'auditor' and 'transfer_agent'.
const fnValues = new Set(SERVICE_PROVIDER_FUNCTIONS.map((f) => f.value));
assert.ok(fnValues.has("auditor"));
assert.ok(fnValues.has("transfer_agent"));

console.log("OK service-providers");
