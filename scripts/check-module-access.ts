import assert from "node:assert/strict";
import { PERMISSIONS } from "../shared/functions/permissions";
import { ROLES } from "../shared/functions/access";
import { MODULE_KEYS } from "../src/lib/modules";
import { ACCESS_ACTIONS, getModuleAccess, MODULE_ACCESS_DEFINITIONS } from "../src/lib/moduleAccess";

const find = (role: string, key: string, source?: Parameters<typeof getModuleAccess>[1]) => {
  const row = getModuleAccess(role, source).find((entry) => entry.key === key);
  assert.ok(row, `Missing access area ${key}`);
  return row;
};

// Missing/duplicated grants would make the admin projection silently incomplete.
const mapped = MODULE_ACCESS_DEFINITIONS.flatMap((row) =>
  ACCESS_ACTIONS.flatMap((action) => row.permissions[action] ?? []));
assert.deepEqual([...mapped].sort(), [...PERMISSIONS].sort());
assert.equal(new Set(MODULE_ACCESS_DEFINITIONS.map((row) => row.key)).size, MODULE_ACCESS_DEFINITIONS.length);
assert.deepEqual(MODULE_ACCESS_DEFINITIONS.flatMap((row) => row.moduleKey ?? []).sort(), [...MODULE_KEYS].sort());

assert.equal(find("Owner", "settings").actionCoverage.manage, "full");
assert.equal(find("Admin", "settings").actionCoverage.manage, "none");
assert.equal(find("Admin", "users").actions.manage, true);
assert.equal(find("Director", "documents").actions.write, true);
assert.equal(find("Director", "minutes").actions.approve, false);
assert.equal(find("Viewer", "financials").actions.write, false);
assert.equal(find("Member", "people").actionCoverage.view, "partial");
assert.equal(find("Member", "voting").actionCoverage.view, "partial");
assert.equal(find("Viewer", "exports").actionCoverage.view, "partial");
assert.equal(find("Director", "exports").actionCoverage.view, "full");

// A missing module policy is not a permission denial or an inferred grant.
for (const role of ROLES) {
  const insurance = find(role, "insurance");
  assert.ok(ACCESS_ACTIONS.every((action) => insurance.actions[action] === null));
  assert.ok(ACCESS_ACTIONS.every((action) => insurance.actionCoverage[action] === "unmapped"));
}

const grantsOn = find("Owner", "grants");
const grantsOff = find("Owner", "grants", { disabledModules: ["grants"] });
const legacyOff = find("Owner", "grants", { modules: { grants: false } });
assert.equal(grantsOn.enabled, true);
assert.equal(grantsOff.enabled, false);
assert.equal(legacyOff.enabled, false);
assert.deepEqual(grantsOff.actions, grantsOn.actions);
assert.equal(find("Owner", "documents", ["grants"]).enabled, true);
assert.ok(grantsOff.notes.some((note) => note.includes("feature switch")));

const active = getModuleAccess("Admin", undefined, "Active");
for (const status of ["Invited", "Disabled"]) {
  const inactive = getModuleAccess("Admin", undefined, status);
  assert.deepEqual(inactive.map((row) => row.actions), active.map((row) => row.actions));
  assert.ok(inactive.every((row) => row.notes.some((note) => note.includes("membership is not active"))));
}
assert.ok(getModuleAccess("unknown").every((row) => ACCESS_ACTIONS.every((action) => row.actions[action] !== true)));
assert.ok(find("Director", "grants").notes.some((note) => note.includes("grants:write")));
assert.ok(find("Viewer", "financials").notes.some((note) => note.includes("corresponding role permission")));

console.log("Module access projection checks passed: all role grants, optional modules, partial access, disabled features, inactive memberships, and enforcement caveats.");
