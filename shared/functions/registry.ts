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
import * as goalsFns from "./goals";
import * as attestationsFns from "./attestations";
import * as proxiesFns from "./proxies";
import * as pipaTrainingFns from "./pipaTraining";
import * as complianceObligationsFns from "./complianceObligations";
import * as programStatementsFns from "./programStatements";

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

  // goals
  definePortableQuery({ name: "goals:list", handler: goalsFns.listPortable }),
  definePortableQuery({ name: "goals:get", handler: goalsFns.getPortable }),
  definePortableQuery({ name: "goals:byCommittee", handler: goalsFns.byCommitteePortable }),
  definePortableMutation({ name: "goals:create", handler: goalsFns.createPortable }),
  definePortableMutation({ name: "goals:update", handler: goalsFns.updatePortable }),
  definePortableMutation({ name: "goals:toggleMilestone", handler: goalsFns.toggleMilestonePortable }),
  definePortableMutation({ name: "goals:remove", handler: goalsFns.removePortable }),

  // attestations
  definePortableQuery({ name: "attestations:list", handler: attestationsFns.attestationsListPortable }),
  definePortableQuery({ name: "attestations:forDirector", handler: attestationsFns.attestationsForDirectorPortable }),
  definePortableQuery({ name: "attestations:missingForYear", handler: attestationsFns.attestationsMissingForYearPortable }),
  definePortableMutation({ name: "attestations:sign", handler: attestationsFns.attestationSignPortable }),
  definePortableMutation({ name: "attestations:remove", handler: attestationsFns.attestationRemovePortable }),

  // proxies
  definePortableQuery({ name: "proxies:list", handler: proxiesFns.proxiesList }),
  definePortableQuery({ name: "proxies:forMeeting", handler: proxiesFns.proxiesForMeeting }),
  definePortableMutation({ name: "proxies:create", handler: proxiesFns.proxyCreate }),
  definePortableMutation({ name: "proxies:update", handler: proxiesFns.proxyUpdate }),
  definePortableMutation({ name: "proxies:revoke", handler: proxiesFns.proxyRevoke }),
  definePortableMutation({ name: "proxies:remove", handler: proxiesFns.proxyRemove }),

  // pipaTraining
  definePortableQuery({ name: "pipaTraining:list", handler: pipaTrainingFns.pipaTrainingList }),
  definePortableMutation({ name: "pipaTraining:create", handler: pipaTrainingFns.pipaTrainingCreate }),
  definePortableMutation({ name: "pipaTraining:update", handler: pipaTrainingFns.pipaTrainingUpdate }),
  definePortableMutation({ name: "pipaTraining:remove", handler: pipaTrainingFns.pipaTrainingRemove }),

  // complianceObligations
  definePortableQuery({ name: "complianceObligations:listDecisions", handler: complianceObligationsFns.listDecisionsPortable }),
  definePortableMutation({ name: "complianceObligations:markReviewed", handler: complianceObligationsFns.markReviewedPortable }),
  definePortableMutation({ name: "complianceObligations:dismissDecision", handler: complianceObligationsFns.dismissDecisionPortable }),
  definePortableMutation({ name: "complianceObligations:reopenDecision", handler: complianceObligationsFns.reopenDecisionPortable }),

  // programStatements
  definePortableQuery({ name: "programStatements:list", handler: programStatementsFns.programStatementsList }),
  definePortableQuery({ name: "programStatements:get", handler: programStatementsFns.programStatementGet }),
  definePortableMutation({ name: "programStatements:create", handler: programStatementsFns.programStatementCreate }),
  definePortableMutation({ name: "programStatements:update", handler: programStatementsFns.programStatementUpdate }),
  definePortableMutation({ name: "programStatements:remove", handler: programStatementsFns.programStatementRemove }),
];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
