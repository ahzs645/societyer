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
import * as tasksFns from "./tasks";
import * as agmFns from "./agm";
import * as financialsFns from "./financials";
import * as firmFns from "./firm";
import * as orgChartAssignmentsFns from "./orgChartAssignments";
import * as shareCertificatesFns from "./shareCertificates";
import * as annualFilingsFns from "./annualFilings";
import * as peopleDirectoryFns from "./peopleDirectory";
import * as memberProposalsFns from "./memberProposals";
import * as commandMenuItemsFns from "./commandMenuItems";
import * as expenseReportsFns from "./expenseReports";
import * as insuranceFns from "./insurance";
import * as libraryFns from "./library";
import * as registerHistoryFns from "./registerHistory";
import * as publicPortalFns from "./publicPortal";
import * as filingExportsFns from "./filingExports";
import * as fieldMetadataFns from "./fieldMetadata";
import * as treasuryFns from "./treasury";
import * as customFieldsFns from "./customFields";
import * as motionTemplatesFns from "./motionTemplates";
import * as reconciliationFns from "./reconciliation";
import * as signaturesFns from "./signatures";
import * as bylawRulesFns from "./bylawRules";
import * as policiesFns from "./policies";
import * as viewsFns from "./views";
import * as motionBacklogFns from "./motionBacklog";
import * as workflowPackagesFns from "./workflowPackages";
import * as yearEndFns from "./yearEnd";
import * as annualCycleFns from "./annualCycle";
import * as objectMetadataFns from "./objectMetadata";
import * as bylawAmendmentsFns from "./bylawAmendments";
import * as filingsFns from "./filings";
import * as organizationDetailsFns from "./organizationDetails";

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

  // tasks
  definePortableQuery({ name: "tasks:list", handler: tasksFns.tasksList }),
  definePortableQuery({ name: "tasks:byCommittee", handler: tasksFns.tasksByCommittee }),
  definePortableQuery({ name: "tasks:byGoal", handler: tasksFns.tasksByGoal }),
  definePortableQuery({ name: "tasks:byMeeting", handler: tasksFns.tasksByMeeting }),
  definePortableMutation({ name: "tasks:create", handler: tasksFns.taskCreate }),
  definePortableMutation({ name: "tasks:update", handler: tasksFns.taskUpdate }),
  definePortableMutation({ name: "tasks:remove", handler: tasksFns.taskRemove }),

  // agm
  definePortableQuery({ name: "agm:runForMeeting", handler: agmFns.runForMeeting }),
  definePortableQuery({ name: "agm:noticeDeliveries", handler: agmFns.noticeDeliveries }),
  definePortableMutation({ name: "agm:init", handler: agmFns.agmInit }),
  definePortableMutation({ name: "agm:markStep", handler: agmFns.agmMarkStep }),
  definePortableMutation({ name: "agm:logNoticeDelivery", handler: agmFns.logNoticeDelivery }),
  definePortableMutation({ name: "agm:queueNoticeToAllVotingMembers", handler: agmFns.queueNoticeToAllVotingMembers }),

  // financials
  definePortableQuery({ name: "financials:list", handler: financialsFns.financialsList }),
  definePortableQuery({ name: "financials:detailByFiscalYear", handler: financialsFns.detailByFiscalYearPortable }),
  definePortableMutation({ name: "financials:create", handler: financialsFns.financialCreate }),
  definePortableMutation({ name: "financials:update", handler: financialsFns.financialUpdate }),
  definePortableMutation({ name: "financials:remove", handler: financialsFns.financialRemove }),

  // firm
  definePortableQuery({ name: "firm:overview", handler: firmFns.overviewPortable }),

  // orgChartAssignments
  definePortableQuery({ name: "orgChartAssignments:list", handler: orgChartAssignmentsFns.listPortable }),
  definePortableQuery({ name: "orgChartAssignments:listAsOf", handler: orgChartAssignmentsFns.listAsOfPortable }),
  definePortableMutation({ name: "orgChartAssignments:upsert", handler: orgChartAssignmentsFns.upsertPortable }),
  definePortableMutation({ name: "orgChartAssignments:remove", handler: orgChartAssignmentsFns.removePortable }),

  // shareCertificates
  definePortableQuery({ name: "shareCertificates:list", handler: shareCertificatesFns.listPortable }),
  definePortableQuery({ name: "shareCertificates:register", handler: shareCertificatesFns.registerPortable }),
  definePortableQuery({ name: "shareCertificates:chain", handler: shareCertificatesFns.chainPortable }),
  definePortableMutation({ name: "shareCertificates:create", handler: shareCertificatesFns.createPortable }),
  definePortableMutation({ name: "shareCertificates:update", handler: shareCertificatesFns.updatePortable }),
  definePortableMutation({ name: "shareCertificates:remove", handler: shareCertificatesFns.removePortable }),

  // annualFilings
  definePortableQuery({ name: "annualFilings:list", handler: annualFilingsFns.listPortable }),
  definePortableQuery({ name: "annualFilings:jurisdictions", handler: annualFilingsFns.jurisdictionsPortable }),
  definePortableQuery({ name: "annualFilings:history", handler: annualFilingsFns.historyPortable }),
  definePortableQuery({ name: "annualFilings:outstanding", handler: annualFilingsFns.outstandingPortable }),
  definePortableMutation({ name: "annualFilings:upsert", handler: annualFilingsFns.upsertPortable }),
  definePortableMutation({ name: "annualFilings:remove", handler: annualFilingsFns.removePortable }),

  // peopleDirectory
  definePortableQuery({ name: "peopleDirectory:list", handler: peopleDirectoryFns.listPortable }),
  definePortableQuery({ name: "peopleDirectory:searchByPrefix", handler: peopleDirectoryFns.searchByPrefixPortable }),
  definePortableQuery({ name: "peopleDirectory:duplicates", handler: peopleDirectoryFns.duplicatesPortable }),
  definePortableMutation({ name: "peopleDirectory:upsert", handler: peopleDirectoryFns.upsertPortable }),
  definePortableMutation({ name: "peopleDirectory:addToSociety", handler: peopleDirectoryFns.addToSocietyPortable }),

  // memberProposals
  definePortableQuery({ name: "memberProposals:list", handler: memberProposalsFns.memberProposalsList }),
  definePortableMutation({ name: "memberProposals:create", handler: memberProposalsFns.memberProposalCreate }),
  definePortableMutation({ name: "memberProposals:update", handler: memberProposalsFns.memberProposalUpdate }),
  definePortableMutation({ name: "memberProposals:remove", handler: memberProposalsFns.memberProposalRemove }),

  // commandMenuItems
  definePortableQuery({ name: "commandMenuItems:listForScope", handler: commandMenuItemsFns.commandMenuItemsListForScope }),
  definePortableMutation({ name: "commandMenuItems:upsert", handler: commandMenuItemsFns.commandMenuItemUpsert }),
  definePortableMutation({ name: "commandMenuItems:remove", handler: commandMenuItemsFns.commandMenuItemRemove }),

  // expenseReports
  definePortableQuery({ name: "expenseReports:list", handler: expenseReportsFns.listPortable }),
  definePortableMutation({ name: "expenseReports:upsert", handler: expenseReportsFns.upsertPortable }),
  definePortableMutation({ name: "expenseReports:setStatus", handler: expenseReportsFns.setStatusPortable }),
  definePortableMutation({ name: "expenseReports:remove", handler: expenseReportsFns.removePortable }),

  // insurance
  definePortableQuery({ name: "insurance:list", handler: insuranceFns.listPortable }),
  definePortableMutation({ name: "insurance:create", handler: insuranceFns.createPortable }),
  definePortableMutation({ name: "insurance:update", handler: insuranceFns.updatePortable }),
  definePortableMutation({ name: "insurance:remove", handler: insuranceFns.removePortable }),

  // library
  definePortableQuery({ name: "library:overview", handler: libraryFns.overviewPortable }),

  // registerHistory
  definePortableQuery({ name: "registerHistory:roleHoldersAsOfDate", handler: registerHistoryFns.roleHoldersAsOfDatePortable }),
  definePortableQuery({ name: "registerHistory:addressesAsOf", handler: registerHistoryFns.addressesAsOfPortable }),
  definePortableQuery({ name: "registerHistory:directorsAsOf", handler: registerHistoryFns.directorsAsOfPortable }),
  definePortableQuery({ name: "registerHistory:significantIndividualsAsOf", handler: registerHistoryFns.significantIndividualsAsOfPortable }),

  // publicPortal
  definePortableQuery({ name: "publicPortal:getSocietyBySlug", handler: publicPortalFns.getSocietyBySlugPortable }),
  definePortableQuery({ name: "publicPortal:volunteerIntakeContext", handler: publicPortalFns.volunteerIntakeContextPortable }),
  definePortableQuery({ name: "publicPortal:grantIntakeContext", handler: publicPortalFns.grantIntakeContextPortable }),

  // filingExports
  definePortableQuery({ name: "filingExports:societiesOnlinePreFill", handler: filingExportsFns.societiesOnlinePreFillPortable }),
  definePortableQuery({ name: "filingExports:craPreFill", handler: filingExportsFns.craPreFillPortable }),

  // fieldMetadata
  definePortableQuery({ name: "fieldMetadata:listForObject", handler: fieldMetadataFns.listForObjectPortable }),
  definePortableQuery({ name: "fieldMetadata:listForSociety", handler: fieldMetadataFns.listForSocietyPortable }),
  definePortableQuery({ name: "fieldMetadata:get", handler: fieldMetadataFns.getPortable }),
  definePortableQuery({ name: "fieldMetadata:getByName", handler: fieldMetadataFns.getByNamePortable }),
  definePortableMutation({ name: "fieldMetadata:create", handler: fieldMetadataFns.createPortable }),
  definePortableMutation({ name: "fieldMetadata:update", handler: fieldMetadataFns.updatePortable }),
  definePortableMutation({ name: "fieldMetadata:remove", handler: fieldMetadataFns.removePortable }),

  // treasury
  definePortableQuery({ name: "treasury:profitAndLoss", handler: treasuryFns.profitAndLossPortable }),
  definePortableQuery({ name: "treasury:budgetVariance", handler: treasuryFns.budgetVariancePortable }),
  definePortableQuery({ name: "treasury:restrictedFunds", handler: treasuryFns.restrictedFundsPortable }),

  // customFields
  definePortableQuery({ name: "customFields:listDefinitions", handler: customFieldsFns.listDefinitionsPortable }),
  definePortableQuery({ name: "customFields:listValues", handler: customFieldsFns.listValuesPortable }),
  definePortableMutation({ name: "customFields:createDefinition", handler: customFieldsFns.createDefinitionPortable }),
  definePortableMutation({ name: "customFields:updateDefinition", handler: customFieldsFns.updateDefinitionPortable }),
  definePortableMutation({ name: "customFields:deleteDefinition", handler: customFieldsFns.deleteDefinitionPortable }),
  definePortableMutation({ name: "customFields:setValue", handler: customFieldsFns.setValuePortable }),
  definePortableMutation({ name: "customFields:clearValue", handler: customFieldsFns.clearValuePortable }),

  // motionTemplates
  definePortableQuery({ name: "motionTemplates:list", handler: motionTemplatesFns.listPortable }),
  definePortableMutation({ name: "motionTemplates:create", handler: motionTemplatesFns.createPortable }),
  definePortableMutation({ name: "motionTemplates:update", handler: motionTemplatesFns.updatePortable }),
  definePortableMutation({ name: "motionTemplates:remove", handler: motionTemplatesFns.removePortable }),

  // reconciliation
  definePortableQuery({ name: "reconciliation:overview", handler: reconciliationFns.overviewPortable }),
  definePortableMutation({ name: "reconciliation:match", handler: reconciliationFns.matchPortable }),
  definePortableMutation({ name: "reconciliation:markManual", handler: reconciliationFns.markManualPortable }),
  definePortableMutation({ name: "reconciliation:addManualTransaction", handler: reconciliationFns.addManualTransactionPortable }),
  definePortableMutation({ name: "reconciliation:unmatch", handler: reconciliationFns.unmatchPortable }),

  // signatures
  definePortableQuery({ name: "signatures:listForEntity", handler: signaturesFns.listForEntityPortable }),
  definePortableQuery({ name: "signatures:listProfilesForSociety", handler: signaturesFns.listProfilesForSocietyPortable }),
  definePortableMutation({ name: "signatures:saveProfile", handler: signaturesFns.saveProfilePortable }),
  definePortableMutation({ name: "signatures:sign", handler: signaturesFns.signPortable }),
  definePortableMutation({ name: "signatures:revoke", handler: signaturesFns.revokePortable }),

  // bylawRules
  definePortableQuery({ name: "bylawRules:getActive", handler: bylawRulesFns.getActivePortable }),
  definePortableQuery({ name: "bylawRules:getForDate", handler: bylawRulesFns.getForDatePortable }),
  definePortableQuery({ name: "bylawRules:list", handler: bylawRulesFns.listPortable }),
  definePortableMutation({ name: "bylawRules:upsertActive", handler: bylawRulesFns.upsertActivePortable }),
  definePortableMutation({ name: "bylawRules:resetToDefault", handler: bylawRulesFns.resetToDefaultPortable }),

  // policies
  definePortableQuery({ name: "policies:list", handler: policiesFns.listPortable }),
  definePortableQuery({ name: "policies:adoptionOptions", handler: policiesFns.adoptionOptionsPortable }),
  definePortableMutation({ name: "policies:upsert", handler: policiesFns.upsertPortable }),
  definePortableMutation({ name: "policies:remove", handler: policiesFns.removePortable }),
  definePortableMutation({ name: "policies:createReviewTask", handler: policiesFns.createReviewTaskPortable }),
  definePortableMutation({ name: "policies:createRequiredSignerTask", handler: policiesFns.createRequiredSignerTaskPortable }),
  definePortableMutation({ name: "policies:createTransparencyDraft", handler: policiesFns.createTransparencyDraftPortable }),

  // views
  definePortableQuery({ name: "views:listForObject", handler: viewsFns.listForObjectPortable }),
  definePortableQuery({ name: "views:get", handler: viewsFns.getPortable }),
  definePortableQuery({ name: "views:getHydrated", handler: viewsFns.getHydratedPortable }),
  definePortableQuery({ name: "views:listSharedForDataTable", handler: viewsFns.listSharedForDataTablePortable }),
  definePortableQuery({ name: "views:listFieldsForView", handler: viewsFns.listFieldsForViewPortable }),
  definePortableMutation({ name: "views:create", handler: viewsFns.createPortable }),
  definePortableMutation({ name: "views:update", handler: viewsFns.updatePortable }),
  definePortableMutation({ name: "views:createSharedDataTableView", handler: viewsFns.createSharedDataTableViewPortable }),
  definePortableMutation({ name: "views:deleteSharedDataTableView", handler: viewsFns.deleteSharedDataTableViewPortable }),
  definePortableMutation({ name: "views:seedGovernanceDataTableViews", handler: viewsFns.seedGovernanceDataTableViewsPortable }),
  definePortableMutation({ name: "views:remove", handler: viewsFns.removePortable }),
  definePortableMutation({ name: "views:addField", handler: viewsFns.addFieldPortable }),
  definePortableMutation({ name: "views:updateField", handler: viewsFns.updateFieldPortable }),
  definePortableMutation({ name: "views:removeField", handler: viewsFns.removeFieldPortable }),
  definePortableMutation({ name: "views:reorderFields", handler: viewsFns.reorderFieldsPortable }),

  // motionBacklog
  definePortableQuery({ name: "motionBacklog:list", handler: motionBacklogFns.listPortable }),
  definePortableQuery({ name: "motionBacklog:suggestForMeeting", handler: motionBacklogFns.suggestForMeetingPortable }),
  definePortableMutation({ name: "motionBacklog:create", handler: motionBacklogFns.createPortable }),
  definePortableMutation({ name: "motionBacklog:update", handler: motionBacklogFns.updatePortable }),
  definePortableMutation({ name: "motionBacklog:remove", handler: motionBacklogFns.removePortable }),
  definePortableMutation({ name: "motionBacklog:createFromMinutesMotion", handler: motionBacklogFns.createFromMinutesMotionPortable }),
  definePortableMutation({ name: "motionBacklog:createFromMinutesSection", handler: motionBacklogFns.createFromMinutesSectionPortable }),
  definePortableMutation({ name: "motionBacklog:seedPipaSetup", handler: motionBacklogFns.seedPipaSetupPortable }),
  definePortableMutation({ name: "motionBacklog:addToAgenda", handler: motionBacklogFns.addToAgendaPortable }),
  definePortableMutation({ name: "motionBacklog:carryForwardToMeeting", handler: motionBacklogFns.carryForwardToMeetingPortable }),
  definePortableMutation({ name: "motionBacklog:seedToMinutes", handler: motionBacklogFns.seedToMinutesPortable }),

  // workflowPackages
  definePortableQuery({ name: "workflowPackages:list", handler: workflowPackagesFns.listPortable }),
  definePortableMutation({ name: "workflowPackages:upsert", handler: workflowPackagesFns.upsertPortable }),
  definePortableMutation({ name: "workflowPackages:remove", handler: workflowPackagesFns.removePortable }),
  definePortableMutation({ name: "workflowPackages:createFollowUpTask", handler: workflowPackagesFns.createFollowUpTaskPortable }),
  definePortableMutation({ name: "workflowPackages:markFiled", handler: workflowPackagesFns.markFiledPortable }),
  definePortableMutation({ name: "workflowPackages:createBoardPack", handler: workflowPackagesFns.createBoardPackPortable }),

  // yearEnd
  definePortableQuery({ name: "yearEnd:annualStatement", handler: yearEndFns.annualStatementPortable }),
  definePortableQuery({ name: "yearEnd:orgRevenueExpense", handler: yearEndFns.orgRevenueExpensePortable }),
  definePortableQuery({ name: "yearEnd:restrictedFundStatement", handler: yearEndFns.restrictedFundStatementPortable }),
  definePortableQuery({ name: "yearEnd:readiness", handler: yearEndFns.readinessPortable }),

  // annualCycle
  definePortableQuery({ name: "annualCycle:summary", handler: annualCycleFns.summaryPortable }),

  // objectMetadata
  definePortableQuery({ name: "objectMetadata:list", handler: objectMetadataFns.listPortable }),
  definePortableQuery({ name: "objectMetadata:get", handler: objectMetadataFns.getPortable }),
  definePortableQuery({ name: "objectMetadata:getByNameSingular", handler: objectMetadataFns.getByNameSingularPortable }),
  definePortableQuery({ name: "objectMetadata:getByNamePlural", handler: objectMetadataFns.getByNamePluralPortable }),
  definePortableQuery({ name: "objectMetadata:getWithFields", handler: objectMetadataFns.getWithFieldsPortable }),
  definePortableQuery({ name: "objectMetadata:getFullTableSetup", handler: objectMetadataFns.getFullTableSetupPortable }),
  definePortableMutation({ name: "objectMetadata:create", handler: objectMetadataFns.createPortable }),
  definePortableMutation({ name: "objectMetadata:update", handler: objectMetadataFns.updatePortable }),
  definePortableMutation({ name: "objectMetadata:remove", handler: objectMetadataFns.removePortable }),

  // bylawAmendments
  definePortableQuery({ name: "bylawAmendments:list", handler: bylawAmendmentsFns.listPortable }),
  definePortableQuery({ name: "bylawAmendments:get", handler: bylawAmendmentsFns.getPortable }),
  definePortableQuery({ name: "bylawAmendments:sectionsForAmendment", handler: bylawAmendmentsFns.sectionsForAmendmentPortable }),
  definePortableMutation({ name: "bylawAmendments:createDraft", handler: bylawAmendmentsFns.createDraftPortable }),
  definePortableMutation({ name: "bylawAmendments:updateDraft", handler: bylawAmendmentsFns.updateDraftPortable }),
  definePortableMutation({ name: "bylawAmendments:remove", handler: bylawAmendmentsFns.removePortable }),

  // filings
  definePortableQuery({ name: "filings:get", handler: filingsFns.getPortable }),
  definePortableQuery({ name: "filings:list", handler: filingsFns.listPortable }),
  definePortableQuery({ name: "filings:guidance", handler: filingsFns.guidancePortable }),
  definePortableMutation({ name: "filings:create", handler: filingsFns.createPortable }),
  definePortableMutation({ name: "filings:markFiled", handler: filingsFns.markFiledPortable }),
  definePortableMutation({ name: "filings:update", handler: filingsFns.updatePortable }),
  definePortableMutation({ name: "filings:importBcRegistryHistory", handler: filingsFns.importBcRegistryHistoryPortable }),
  definePortableMutation({ name: "filings:remove", handler: filingsFns.removePortable }),

  // organizationDetails
  definePortableQuery({ name: "organizationDetails:overview", handler: organizationDetailsFns.overviewPortable }),
  definePortableMutation({ name: "organizationDetails:upsertAddress", handler: organizationDetailsFns.upsertAddressPortable }),
  definePortableMutation({ name: "organizationDetails:removeAddress", handler: organizationDetailsFns.removeAddressPortable }),
  definePortableMutation({ name: "organizationDetails:upsertRegistration", handler: organizationDetailsFns.upsertRegistrationPortable }),
  definePortableMutation({ name: "organizationDetails:removeRegistration", handler: organizationDetailsFns.removeRegistrationPortable }),
  definePortableMutation({ name: "organizationDetails:upsertIdentifier", handler: organizationDetailsFns.upsertIdentifierPortable }),
  definePortableMutation({ name: "organizationDetails:removeIdentifier", handler: organizationDetailsFns.removeIdentifierPortable }),
];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
