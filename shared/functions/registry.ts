/**
 * The set of functions ported to the portable `ctx.db` contract.
 *
 * This is the migration frontier: a function listed here runs as ONE handler on
 * hosted Convex (via convex/lib/portable.ts) and on the local runtimes (via the
 * PortableRuntime in src/lib/staticConvex.ts), instead of being hand-mirrored.
 * Add an entry as each handler is ported; delete its static-mirror case once the
 * conformance test is green.
 */

import { definePortableQuery, definePortableMutation, type PortableFunctionDef } from "../portable/define";
import { votingPowerPortable } from "./votingPower";
import { upsertRightsClassPortable } from "./rightsClasses";
import {
  upsertRightsholdingTransferPortable,
  removeRightsholdingTransferPortable,
  removeRightsClassPortable,
} from "./rightsholdingTransfers";
import { membersList, memberGet, memberCreate, memberUpdate, memberRemove } from "./members";

export const PORTABLE_FUNCTIONS: PortableFunctionDef[] = [
  definePortableQuery({ name: "legalOperations:votingPower", handler: votingPowerPortable }),
  definePortableMutation({ name: "legalOperations:upsertRightsClass", handler: upsertRightsClassPortable }),
  // Cap-table transfer domain. Safe to run live: the demo seed has no rights-ledger
  // rows, so syncRightsHoldings has nothing to rewrite (see the live-runtime test).
  definePortableMutation({ name: "legalOperations:upsertRightsholdingTransfer", handler: upsertRightsholdingTransferPortable }),
  definePortableMutation({ name: "legalOperations:removeRightsholdingTransfer", handler: removeRightsholdingTransferPortable }),
  definePortableMutation({ name: "legalOperations:removeRightsClass", handler: removeRightsClassPortable }),
  // Members domain (CRUD).
  definePortableQuery({ name: "members:list", handler: membersList }),
  definePortableQuery({ name: "members:get", handler: memberGet }),
  definePortableMutation({ name: "members:create", handler: memberCreate }),
  definePortableMutation({ name: "members:update", handler: memberUpdate }),
  definePortableMutation({ name: "members:remove", handler: memberRemove }),
];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
