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
import * as committeesFns from "./committees";
import * as commitmentsFns from "./commitments";
import * as deadlinesFns from "./deadlines";
import * as nameHistoryFns from "./nameHistory";
import * as dividendsFns from "./dividends";
import * as receiptsFns from "./receipts";
import * as constatingFns from "./constating";
import * as corporationSettingsFns from "./corporationSettings";
import * as postIncorporationFns from "./postIncorporation";
import * as recordsLocationFns from "./recordsLocation";
import * as remunerationFns from "./remuneration";
import * as activityFns from "./activity";
import * as inspectionsFns from "./inspections";
import * as invitationsFns from "./invitations";
import * as significantIndividualStepsFns from "./significantIndividualSteps";
import * as documentCommentsFns from "./documentComments";
import * as writtenResolutionsFns from "./writtenResolutions";
import * as retentionFns from "./retention";
import * as serviceProvidersFns from "./serviceProviders";

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

  // committees
  definePortableQuery({ name: "committees:list", handler: committeesFns.committeesListPortable }),
  definePortableQuery({ name: "committees:get", handler: committeesFns.committeeGetPortable }),
  definePortableQuery({ name: "committees:detail", handler: committeesFns.committeeDetailPortable }),
  definePortableMutation({ name: "committees:create", handler: committeesFns.committeeCreatePortable }),
  definePortableMutation({ name: "committees:update", handler: committeesFns.committeeUpdatePortable }),
  definePortableMutation({ name: "committees:remove", handler: committeesFns.committeeRemovePortable }),
  definePortableMutation({ name: "committees:addMember", handler: committeesFns.committeeAddMemberPortable }),
  definePortableMutation({ name: "committees:removeMember", handler: committeesFns.committeeRemoveMemberPortable }),

  // commitments
  definePortableQuery({ name: "commitments:list", handler: commitmentsFns.listPortable }),
  definePortableQuery({ name: "commitments:get", handler: commitmentsFns.getPortable }),
  definePortableQuery({ name: "commitments:eventsForSociety", handler: commitmentsFns.eventsForSocietyPortable }),
  definePortableQuery({ name: "commitments:eventsForCommitment", handler: commitmentsFns.eventsForCommitmentPortable }),
  definePortableMutation({ name: "commitments:create", handler: commitmentsFns.createPortable }),
  definePortableMutation({ name: "commitments:update", handler: commitmentsFns.updatePortable }),
  definePortableMutation({ name: "commitments:recordEvent", handler: commitmentsFns.recordEventPortable }),
  definePortableMutation({ name: "commitments:removeEvent", handler: commitmentsFns.removeEventPortable }),
  definePortableMutation({ name: "commitments:remove", handler: commitmentsFns.removePortable }),

  // deadlines
  definePortableQuery({ name: "deadlines:list", handler: deadlinesFns.listPortable }),
  definePortableMutation({ name: "deadlines:create", handler: deadlinesFns.createPortable }),
  definePortableMutation({ name: "deadlines:setStatus", handler: deadlinesFns.setStatusPortable }),
  definePortableMutation({ name: "deadlines:toggleDone", handler: deadlinesFns.toggleDonePortable }),
  definePortableMutation({ name: "deadlines:update", handler: deadlinesFns.updatePortable }),
  definePortableMutation({ name: "deadlines:remove", handler: deadlinesFns.removePortable }),
  definePortableMutation({ name: "deadlines:backfillStatus", handler: deadlinesFns.backfillStatusPortable }),

  // nameHistory
  definePortableQuery({ name: "nameHistory:list", handler: nameHistoryFns.listPortable }),
  definePortableQuery({ name: "nameHistory:asOf", handler: nameHistoryFns.asOfPortable }),
  definePortableQuery({ name: "nameHistory:narrative", handler: nameHistoryFns.narrativePortable }),
  definePortableMutation({ name: "nameHistory:upsert", handler: nameHistoryFns.upsertPortable }),
  definePortableMutation({ name: "nameHistory:remove", handler: nameHistoryFns.removePortable }),

  // dividends
  definePortableQuery({ name: "dividends:list", handler: dividendsFns.listPortable }),
  definePortableQuery({ name: "dividends:summary", handler: dividendsFns.summaryPortable }),
  definePortableMutation({ name: "dividends:create", handler: dividendsFns.createPortable }),
  definePortableMutation({ name: "dividends:remove", handler: dividendsFns.removePortable }),

  // receipts
  definePortableQuery({ name: "receipts:list", handler: receiptsFns.receiptsListPortable }),
  definePortableMutation({ name: "receipts:issue", handler: receiptsFns.receiptIssuePortable }),
  definePortableMutation({ name: "receipts:voidReceipt", handler: receiptsFns.receiptVoidPortable }),
  definePortableMutation({ name: "receipts:remove", handler: receiptsFns.receiptRemovePortable }),

  // constating
  definePortableQuery({ name: "constating:list", handler: constatingFns.listPortable }),
  definePortableQuery({ name: "constating:currentRegime", handler: constatingFns.currentRegimePortable }),
  definePortableQuery({ name: "constating:narrative", handler: constatingFns.narrativePortable }),
  definePortableMutation({ name: "constating:create", handler: constatingFns.createPortable }),
  definePortableMutation({ name: "constating:remove", handler: constatingFns.removePortable }),

  // corporationSettings
  definePortableQuery({ name: "corporationSettings:complianceDeadlines", handler: corporationSettingsFns.complianceDeadlinesPortable }),

  // postIncorporation
  definePortableQuery({ name: "postIncorporation:checklist", handler: postIncorporationFns.checklistPortable }),

  // recordsLocation
  definePortableQuery({ name: "recordsLocation:get", handler: recordsLocationFns.recordsLocationGet }),
  definePortableMutation({ name: "recordsLocation:upsert", handler: recordsLocationFns.recordsLocationUpsert }),

  // remuneration
  definePortableQuery({ name: "remuneration:disclosureForYear", handler: remunerationFns.disclosureForYearPortable }),
  definePortableMutation({ name: "remuneration:applyToFinancials", handler: remunerationFns.applyToFinancialsPortable }),

  // activity
  definePortableQuery({ name: "activity:list", handler: activityFns.listPortable }),
  definePortableQuery({ name: "activity:listForRecord", handler: activityFns.listForRecordPortable }),
  definePortableMutation({ name: "activity:log", handler: activityFns.logPortable }),

  // inspections
  definePortableQuery({ name: "inspections:list", handler: inspectionsFns.inspectionsList }),
  definePortableQuery({ name: "inspections:forDocument", handler: inspectionsFns.inspectionsForDocument }),
  definePortableMutation({ name: "inspections:create", handler: inspectionsFns.inspectionCreate }),
  definePortableMutation({ name: "inspections:remove", handler: inspectionsFns.inspectionRemove }),

  // invitations
  definePortableQuery({ name: "invitations:list", handler: invitationsFns.listPortable }),
  definePortableQuery({ name: "invitations:getByToken", handler: invitationsFns.getByTokenPortable }),
  definePortableMutation({ name: "invitations:create", handler: invitationsFns.createPortable }),
  definePortableMutation({ name: "invitations:revoke", handler: invitationsFns.revokePortable }),

  // significantIndividualSteps
  definePortableQuery({ name: "significantIndividualSteps:list", handler: significantIndividualStepsFns.listPortable }),
  definePortableQuery({ name: "significantIndividualSteps:reviewsDue", handler: significantIndividualStepsFns.reviewsDuePortable }),
  definePortableMutation({ name: "significantIndividualSteps:create", handler: significantIndividualStepsFns.createPortable }),
  definePortableMutation({ name: "significantIndividualSteps:remove", handler: significantIndividualStepsFns.removePortable }),

  // documentComments
  definePortableQuery({ name: "documentComments:listForDocument", handler: documentCommentsFns.listForDocumentPortable }),
  definePortableMutation({ name: "documentComments:create", handler: documentCommentsFns.createPortable }),
  definePortableMutation({ name: "documentComments:setStatus", handler: documentCommentsFns.setStatusPortable }),
  definePortableMutation({ name: "documentComments:remove", handler: documentCommentsFns.removePortable }),

  // writtenResolutions
  definePortableQuery({ name: "writtenResolutions:list", handler: writtenResolutionsFns.listPortable }),
  definePortableMutation({ name: "writtenResolutions:create", handler: writtenResolutionsFns.createPortable }),
  definePortableMutation({ name: "writtenResolutions:sign", handler: writtenResolutionsFns.signPortable }),
  definePortableMutation({ name: "writtenResolutions:markFailed", handler: writtenResolutionsFns.markFailedPortable }),
  definePortableMutation({ name: "writtenResolutions:remove", handler: writtenResolutionsFns.removePortable }),

  // retention
  definePortableQuery({ name: "retention:expiredForSociety", handler: retentionFns.expiredForSocietyPortable }),

  // serviceProviders
  definePortableQuery({ name: "serviceProviders:list", handler: serviceProvidersFns.listPortable }),
  definePortableQuery({ name: "serviceProviders:functionsCatalog", handler: serviceProvidersFns.functionsCatalogPortable }),
  definePortableQuery({ name: "serviceProviders:activeAsOf", handler: serviceProvidersFns.activeAsOfPortable }),
  definePortableMutation({ name: "serviceProviders:upsert", handler: serviceProvidersFns.upsertPortable }),
];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
