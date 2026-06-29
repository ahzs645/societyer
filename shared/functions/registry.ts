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
import * as directorsFns from "./directors";
import * as employeesFns from "./employees";
import * as notesFns from "./notes";
import * as auditorsFns from "./auditors";
import * as courtOrdersFns from "./courtOrders";
import * as conflictsFns from "./conflicts";

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

  // directors
  definePortableQuery({ name: "directors:list", handler: directorsFns.directorsList }),
  definePortableMutation({ name: "directors:create", handler: directorsFns.directorCreate }),
  definePortableMutation({ name: "directors:update", handler: directorsFns.directorUpdate }),
  definePortableMutation({ name: "directors:remove", handler: directorsFns.directorRemove }),

  // employees
  definePortableQuery({ name: "employees:list", handler: employeesFns.employeesList }),
  definePortableMutation({ name: "employees:create", handler: employeesFns.employeeCreate }),
  definePortableMutation({ name: "employees:update", handler: employeesFns.employeeUpdate }),
  definePortableMutation({ name: "employees:remove", handler: employeesFns.employeeRemove }),

  // notes
  definePortableQuery({ name: "notes:listForRecord", handler: notesFns.notesListForRecordPortable }),
  definePortableMutation({ name: "notes:create", handler: notesFns.noteCreatePortable }),
  definePortableMutation({ name: "notes:update", handler: notesFns.noteUpdatePortable }),
  definePortableMutation({ name: "notes:remove", handler: notesFns.noteRemovePortable }),

  // auditors
  definePortableQuery({ name: "auditors:list", handler: auditorsFns.auditorsListPortable }),
  definePortableMutation({ name: "auditors:create", handler: auditorsFns.auditorCreatePortable }),
  definePortableMutation({ name: "auditors:update", handler: auditorsFns.auditorUpdatePortable }),
  definePortableMutation({ name: "auditors:remove", handler: auditorsFns.auditorRemovePortable }),

  // courtOrders
  definePortableQuery({ name: "courtOrders:list", handler: courtOrdersFns.listPortable }),
  definePortableMutation({ name: "courtOrders:create", handler: courtOrdersFns.createPortable }),
  definePortableMutation({ name: "courtOrders:update", handler: courtOrdersFns.updatePortable }),
  definePortableMutation({ name: "courtOrders:remove", handler: courtOrdersFns.removePortable }),

  // conflicts
  definePortableQuery({ name: "conflicts:list", handler: conflictsFns.conflictsListPortable }),
  definePortableQuery({ name: "conflicts:forMeeting", handler: conflictsFns.conflictsForMeetingPortable }),
  definePortableMutation({ name: "conflicts:create", handler: conflictsFns.conflictsCreatePortable }),
  definePortableMutation({ name: "conflicts:resolve", handler: conflictsFns.conflictsResolvePortable }),
  definePortableMutation({ name: "conflicts:remove", handler: conflictsFns.conflictsRemovePortable }),
];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
