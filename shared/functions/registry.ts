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
import * as documentsFns from "./documents";
import * as organizationHistoryFns from "./organizationHistory";
import * as meetingsFns from "./meetings";
import * as agendasFns from "./agendas";
import * as motionsFns from "./motions";
import * as evidenceRegistersFns from "./evidenceRegisters";
import * as minuteBookFns from "./minuteBook";
import * as dashboardFns from "./dashboard";
import * as dashboardRemediationFns from "./dashboardRemediation";
import * as meetingTemplatesFns from "./meetingTemplates";
import * as pendingEmailsFns from "./pendingEmails";
import * as aiChatFns from "./aiChat";
import * as entitySignersFns from "./entitySigners";
import * as roleHolderHistoryFns from "./roleHolderHistory";
import * as accountingFns from "./accounting";
import * as assetsFns from "./assets";
import * as electionsFns from "./elections";
import * as exportsFns from "./exports";
import * as fundingSourcesFns from "./fundingSources";
import * as grantSourcesFns from "./grantSources";
import * as grantsFns from "./grants";
import * as inventoryHubFns from "./inventoryHub";
import * as meetingMaterialsFns from "./meetingMaterials";
import * as minutesFns from "./minutes";
import * as notificationsFns from "./notifications";
import * as partyPortalsFns from "./partyPortals";
import * as societyFns from "./society";
import * as subscriptionsFns from "./subscriptions";
import * as transparencyFns from "./transparency";
import * as usersFns from "./users";
import * as volunteersFns from "./volunteers";

import * as aiAgentsFns from "./aiAgents";
import * as aiSettingsFns from "./aiSettings";
import * as apiPlatformFns from "./apiPlatform";
import * as calendarSyncFns from "./calendarSync";
import * as communicationsFns from "./communications";
import * as documentVersionsFns from "./documentVersions";
import * as financialHubFns from "./financialHub";
import * as importSessionsFns from "./importSessions";
import * as membersFns from "./members";
import * as paperlessFns from "./paperless";
import * as recordLayoutsFns from "./recordLayouts";
import * as roleHoldersFns from "./roleHolders";
import * as secretsFns from "./secrets";
import * as transcriptsFns from "./transcripts";
import * as waveCacheFns from "./waveCache";
import * as workflowsFns from "./workflows";

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

  // documents
  definePortableQuery({ name: "documents:list", handler: documentsFns.listPortable }),
  definePortableQuery({ name: "documents:get", handler: documentsFns.getPortable }),
  definePortableQuery({ name: "documents:getMany", handler: documentsFns.getManyPortable }),
  definePortableQuery({ name: "documents:reviewQueues", handler: documentsFns.reviewQueuesPortable }),
  definePortableMutation({ name: "documents:create", handler: documentsFns.createPortable }),
  definePortableMutation({ name: "documents:markOpened", handler: documentsFns.markOpenedPortable }),
  definePortableMutation({ name: "documents:updateReviewStatus", handler: documentsFns.updateReviewStatusPortable }),
  definePortableMutation({ name: "documents:createPipaPolicyDraft", handler: documentsFns.createPipaPolicyDraftPortable }),
  definePortableMutation({ name: "documents:rebuildPipaPolicyDraftFromSociety", handler: documentsFns.rebuildPipaPolicyDraftFromSocietyPortable }),
  definePortableMutation({ name: "documents:createMemberDataGapMemoDraft", handler: documentsFns.createMemberDataGapMemoDraftPortable }),
  definePortableMutation({ name: "documents:updateDraftContent", handler: documentsFns.updateDraftContentPortable }),
  definePortableMutation({ name: "documents:linkPrivacyPolicyEvidence", handler: documentsFns.linkPrivacyPolicyEvidencePortable }),
  definePortableMutation({ name: "documents:createGovernanceDocumentFromLocalFile", handler: documentsFns.createGovernanceDocumentFromLocalFilePortable }),
  definePortableMutation({ name: "documents:createLocalDocumentFromConnector", handler: documentsFns.createLocalDocumentFromConnectorPortable }),
  definePortableMutation({ name: "documents:mergeConnectorDocumentMetadata", handler: documentsFns.mergeConnectorDocumentMetadataPortable }),
  definePortableMutation({ name: "documents:flagForDeletion", handler: documentsFns.flagForDeletionPortable }),
  definePortableMutation({ name: "documents:archive", handler: documentsFns.archivePortable }),
  definePortableMutation({ name: "documents:remove", handler: documentsFns.removePortable }),

  // organizationHistory
  definePortableQuery({ name: "organizationHistory:list", handler: organizationHistoryFns.listPortable }),
  definePortableMutation({ name: "organizationHistory:removeSource", handler: organizationHistoryFns.removeSourcePortable }),
  definePortableMutation({ name: "organizationHistory:bulkSetItemReviewStatus", handler: organizationHistoryFns.bulkSetItemReviewStatusPortable }),
  definePortableMutation({ name: "organizationHistory:removeItem", handler: organizationHistoryFns.removeItemPortable }),

  // meetings
  definePortableQuery({ name: "meetings:list", handler: meetingsFns.listPortable }),
  definePortableQuery({ name: "meetings:get", handler: meetingsFns.getPortable }),
  definePortableMutation({ name: "meetings:create", handler: meetingsFns.createPortable }),
  definePortableMutation({ name: "meetings:applyTemplate", handler: meetingsFns.applyTemplatePortable }),
  definePortableMutation({ name: "meetings:update", handler: meetingsFns.updatePortable }),
  definePortableMutation({ name: "meetings:markSourceReview", handler: meetingsFns.markSourceReviewPortable }),
  definePortableMutation({ name: "meetings:setPackageReviewStatus", handler: meetingsFns.setPackageReviewStatusPortable }),
  definePortableMutation({ name: "meetings:remove", handler: meetingsFns.removePortable }),

  // agendas
  definePortableQuery({ name: "agendas:listForMeeting", handler: agendasFns.listForMeetingPortable }),
  definePortableQuery({ name: "agendas:getForMeeting", handler: agendasFns.getForMeetingPortable }),
  definePortableQuery({ name: "agendas:get", handler: agendasFns.getPortable }),
  definePortableQuery({ name: "agendas:listForSociety", handler: agendasFns.listForSocietyPortable }),
  definePortableMutation({ name: "agendas:create", handler: agendasFns.createPortable }),
  definePortableMutation({ name: "agendas:updateAgenda", handler: agendasFns.updateAgendaPortable }),
  definePortableMutation({ name: "agendas:remove", handler: agendasFns.removePortable }),
  definePortableMutation({ name: "agendas:addItem", handler: agendasFns.addItemPortable }),
  definePortableMutation({ name: "agendas:updateItem", handler: agendasFns.updateItemPortable }),
  definePortableMutation({ name: "agendas:syncForMeeting", handler: agendasFns.syncForMeetingPortable }),
  definePortableMutation({ name: "agendas:startMinutesFromAgenda", handler: agendasFns.startMinutesFromAgendaPortable }),
  definePortableMutation({ name: "agendas:removeItem", handler: agendasFns.removeItemPortable }),
  definePortableMutation({ name: "agendas:reorderItems", handler: agendasFns.reorderItemsPortable }),

  // motions
  definePortableQuery({ name: "motions:list", handler: motionsFns.listPortable }),
  definePortableQuery({ name: "motions:listForMinutes", handler: motionsFns.listForMinutesPortable }),
  definePortableQuery({ name: "motions:listForMeeting", handler: motionsFns.listForMeetingPortable }),
  definePortableQuery({ name: "motions:backlog", handler: motionsFns.backlogPortable }),
  definePortableMutation({ name: "motions:create", handler: motionsFns.createPortable }),
  definePortableMutation({ name: "motions:update", handler: motionsFns.updatePortable }),
  definePortableMutation({ name: "motions:setStatus", handler: motionsFns.setStatusPortable }),
  definePortableMutation({ name: "motions:setTags", handler: motionsFns.setTagsPortable }),
  definePortableMutation({ name: "motions:recordVote", handler: motionsFns.recordVotePortable }),
  definePortableMutation({ name: "motions:remove", handler: motionsFns.removePortable }),

  // evidenceRegisters
  definePortableQuery({ name: "evidenceRegisters:overview", handler: evidenceRegistersFns.overviewPortable }),
  definePortableMutation({ name: "evidenceRegisters:updateReview", handler: evidenceRegistersFns.updateReviewPortable }),
  definePortableMutation({ name: "evidenceRegisters:promoteBoardRoleToDirector", handler: evidenceRegistersFns.promoteBoardRoleToDirectorPortable }),
  definePortableMutation({ name: "evidenceRegisters:finishFinancePaperlessReview", handler: evidenceRegistersFns.finishFinancePaperlessReviewPortable }),
  definePortableMutation({ name: "evidenceRegisters:finishSafePaperlessReview", handler: evidenceRegistersFns.finishSafePaperlessReviewPortable }),
  definePortableMutation({ name: "evidenceRegisters:createManual", handler: evidenceRegistersFns.createManualPortable }),

  // minuteBook
  definePortableQuery({ name: "minuteBook:overview", handler: minuteBookFns.overviewPortable }),
  definePortableMutation({ name: "minuteBook:upsert", handler: minuteBookFns.upsertPortable }),
  definePortableMutation({ name: "minuteBook:remove", handler: minuteBookFns.removePortable }),

  // dashboard
  definePortableQuery({ name: "dashboard:navCounts", handler: dashboardFns.navCountsPortable }),
  definePortableQuery({ name: "dashboard:summary", handler: dashboardFns.summaryPortable }),

  // dashboardRemediation
  definePortableMutation({ name: "dashboardRemediation:createComplianceReviewTask", handler: dashboardRemediationFns.createComplianceReviewTaskPortable }),
  definePortableMutation({ name: "dashboardRemediation:createPrivacyReviewTask", handler: dashboardRemediationFns.createPrivacyReviewTaskPortable }),
  definePortableMutation({ name: "dashboardRemediation:markPrivacyProgramReviewed", handler: dashboardRemediationFns.markPrivacyProgramReviewedPortable }),
  definePortableMutation({ name: "dashboardRemediation:markMemberDataAccessReviewed", handler: dashboardRemediationFns.markMemberDataAccessReviewedPortable }),

  // meetingTemplates
  definePortableQuery({ name: "meetingTemplates:list", handler: meetingTemplatesFns.listPortable }),
  definePortableMutation({ name: "meetingTemplates:create", handler: meetingTemplatesFns.createPortable }),
  definePortableMutation({ name: "meetingTemplates:update", handler: meetingTemplatesFns.updatePortable }),
  definePortableMutation({ name: "meetingTemplates:remove", handler: meetingTemplatesFns.removePortable }),
  definePortableMutation({ name: "meetingTemplates:duplicate", handler: meetingTemplatesFns.duplicatePortable }),
  definePortableMutation({ name: "meetingTemplates:createFromMeeting", handler: meetingTemplatesFns.createFromMeetingPortable }),

  // pendingEmails
  definePortableQuery({ name: "pendingEmails:list", handler: pendingEmailsFns.listPortable }),
  definePortableQuery({ name: "pendingEmails:get", handler: pendingEmailsFns.getPortable }),
  definePortableMutation({ name: "pendingEmails:create", handler: pendingEmailsFns.createPortable }),
  definePortableMutation({ name: "pendingEmails:update", handler: pendingEmailsFns.updatePortable }),
  definePortableMutation({ name: "pendingEmails:markSent", handler: pendingEmailsFns.markSentPortable }),
  definePortableMutation({ name: "pendingEmails:cancel", handler: pendingEmailsFns.cancelPortable }),
  definePortableMutation({ name: "pendingEmails:remove", handler: pendingEmailsFns.removePortable }),

  // aiChat
  definePortableQuery({ name: "aiChat:listThreads", handler: aiChatFns.listThreadsPortable }),
  definePortableQuery({ name: "aiChat:messagesForThread", handler: aiChatFns.messagesForThreadPortable }),
  definePortableQuery({ name: "aiChat:getThread", handler: aiChatFns.getThreadPortable }),
  definePortableMutation({ name: "aiChat:createThread", handler: aiChatFns.createThreadPortable }),
  definePortableMutation({ name: "aiChat:archiveThread", handler: aiChatFns.archiveThreadPortable }),
  definePortableMutation({ name: "aiChat:renameThread", handler: aiChatFns.renameThreadPortable }),
  definePortableMutation({ name: "aiChat:deleteThread", handler: aiChatFns.deleteThreadPortable }),

  // entitySigners
  definePortableQuery({ name: "entitySigners:list", handler: entitySignersFns.listPortable }),
  definePortableQuery({ name: "entitySigners:activeAsOfQuery", handler: entitySignersFns.activeAsOfQueryPortable }),
  definePortableMutation({ name: "entitySigners:upsert", handler: entitySignersFns.upsertPortable }),
  definePortableMutation({ name: "entitySigners:remove", handler: entitySignersFns.removePortable }),

  // roleHolderHistory
  definePortableQuery({ name: "roleHolderHistory:revisionHistory", handler: roleHolderHistoryFns.revisionHistoryPortable }),
  definePortableQuery({ name: "roleHolderHistory:registerAsOf", handler: roleHolderHistoryFns.registerAsOfPortable }),
  definePortableQuery({ name: "roleHolderHistory:changesBetween", handler: roleHolderHistoryFns.changesBetweenPortable }),

  // accounting
  definePortableQuery({ name: "accounting:chartAccounts", handler: accountingFns.chartAccountsPortable }),
  definePortableQuery({ name: "accounting:fiscalPeriods", handler: accountingFns.fiscalPeriodsPortable }),
  definePortableQuery({ name: "accounting:counterparties", handler: accountingFns.counterpartiesPortable }),
  definePortableQuery({ name: "accounting:fundRestrictions", handler: accountingFns.fundRestrictionsPortable }),
  definePortableQuery({ name: "accounting:restrictedFundBalances", handler: accountingFns.restrictedFundBalancesPortable }),
  definePortableQuery({ name: "accounting:accountMappings", handler: accountingFns.accountMappingsPortable }),
  definePortableQuery({ name: "accounting:journalEntries", handler: accountingFns.journalEntriesPortable }),
  definePortableQuery({ name: "accounting:journalEntry", handler: accountingFns.journalEntryPortable }),
  definePortableQuery({ name: "accounting:trialBalance", handler: accountingFns.trialBalancePortable }),
  definePortableQuery({ name: "accounting:generalLedger", handler: accountingFns.generalLedgerPortable }),
  definePortableQuery({ name: "accounting:exportCsv", handler: accountingFns.exportCsvPortable }),
  definePortableQuery({ name: "accounting:boardAuditorPackage", handler: accountingFns.boardAuditorPackagePortable }),

  // assets
  definePortableQuery({ name: "assets:get", handler: assetsFns.getPortable }),
  definePortableQuery({ name: "assets:resolveScan", handler: assetsFns.resolveScanPortable }),
  definePortableQuery({ name: "assets:receiptLinks", handler: assetsFns.receiptLinksPortable }),
  definePortableQuery({ name: "assets:events", handler: assetsFns.eventsPortable }),
  definePortableQuery({ name: "assets:maintenance", handler: assetsFns.maintenancePortable }),
  definePortableQuery({ name: "assets:verificationRuns", handler: assetsFns.verificationRunsPortable }),
  definePortableQuery({ name: "assets:verificationItems", handler: assetsFns.verificationItemsPortable }),
  definePortableMutation({ name: "assets:create", handler: assetsFns.createPortable }),
  definePortableMutation({ name: "assets:update", handler: assetsFns.updatePortable }),
  definePortableMutation({ name: "assets:addConsumableStock", handler: assetsFns.addConsumableStockPortable }),
  definePortableMutation({ name: "assets:linkReceiptLine", handler: assetsFns.linkReceiptLinePortable }),
  definePortableMutation({ name: "assets:recordEvent", handler: assetsFns.recordEventPortable }),
  definePortableMutation({ name: "assets:scheduleMaintenance", handler: assetsFns.scheduleMaintenancePortable }),
  definePortableMutation({ name: "assets:completeMaintenance", handler: assetsFns.completeMaintenancePortable }),
  definePortableMutation({ name: "assets:startVerificationRun", handler: assetsFns.startVerificationRunPortable }),
  definePortableMutation({ name: "assets:verifyAsset", handler: assetsFns.verifyAssetPortable }),
  definePortableMutation({ name: "assets:completeVerificationRun", handler: assetsFns.completeVerificationRunPortable }),
  definePortableMutation({ name: "assets:dispose", handler: assetsFns.disposePortable }),
  definePortableMutation({ name: "assets:remove", handler: assetsFns.removePortable }),

  // inventoryHub
  definePortableQuery({ name: "inventoryHub:connections", handler: inventoryHubFns.connectionsPortable }),
  definePortableQuery({ name: "inventoryHub:locations", handler: inventoryHubFns.locationsPortable }),
  definePortableQuery({ name: "inventoryHub:balances", handler: inventoryHubFns.balancesPortable }),
  definePortableQuery({ name: "inventoryHub:lots", handler: inventoryHubFns.lotsPortable }),
  definePortableQuery({ name: "inventoryHub:stockMovements", handler: inventoryHubFns.stockMovementsPortable }),
  definePortableQuery({ name: "inventoryHub:receiptLinks", handler: inventoryHubFns.receiptLinksPortable }),
  definePortableQuery({ name: "inventoryHub:counts", handler: inventoryHubFns.countsPortable }),
  definePortableMutation({ name: "inventoryHub:upsertConnection", handler: inventoryHubFns.upsertConnectionPortable }),
  definePortableMutation({ name: "inventoryHub:deleteConnection", handler: inventoryHubFns.deleteConnectionPortable }),
  definePortableMutation({ name: "inventoryHub:upsertItem", handler: inventoryHubFns.upsertItemPortable }),
  definePortableMutation({ name: "inventoryHub:upsertLocation", handler: inventoryHubFns.upsertLocationPortable }),
  definePortableMutation({ name: "inventoryHub:deleteLocation", handler: inventoryHubFns.deleteLocationPortable }),
  definePortableMutation({ name: "inventoryHub:deleteItem", handler: inventoryHubFns.deleteItemPortable }),
  definePortableMutation({ name: "inventoryHub:upsertLot", handler: inventoryHubFns.upsertLotPortable }),
  definePortableMutation({ name: "inventoryHub:deleteLot", handler: inventoryHubFns.deleteLotPortable }),
  definePortableMutation({ name: "inventoryHub:createCount", handler: inventoryHubFns.createCountPortable }),
  definePortableMutation({ name: "inventoryHub:addCountLine", handler: inventoryHubFns.addCountLinePortable }),
  definePortableMutation({ name: "inventoryHub:setCountLine", handler: inventoryHubFns.setCountLinePortable }),
  definePortableMutation({ name: "inventoryHub:voidCount", handler: inventoryHubFns.voidCountPortable }),
  definePortableMutation({ name: "inventoryHub:upsertCandidate", handler: inventoryHubFns.upsertCandidatePortable }),
  definePortableQuery({ name: "inventoryHub:candidates", handler: inventoryHubFns.candidatesPortable }),
  definePortableMutation({ name: "inventoryHub:setCandidateStatus", handler: inventoryHubFns.setCandidateStatusPortable }),
  definePortableMutation({ name: "inventoryHub:promoteCandidateToMovement", handler: inventoryHubFns.promoteCandidateToMovementPortable }),
  definePortableMutation({ name: "inventoryHub:linkReceipt", handler: inventoryHubFns.linkReceiptPortable }),
  definePortableMutation({ name: "inventoryHub:unlinkReceipt", handler: inventoryHubFns.unlinkReceiptPortable }),
  definePortableMutation({ name: "inventoryHub:postStockMovement", handler: inventoryHubFns.postStockMovementPortable }),
  definePortableMutation({ name: "inventoryHub:postCountVarianceAdjustments", handler: inventoryHubFns.postCountVarianceAdjustmentsPortable }),
  definePortableMutation({ name: "inventoryHub:importOpenBoxesSnapshot", handler: inventoryHubFns.importOpenBoxesSnapshotPortable }),
  definePortableMutation({ name: "inventoryHub:createItemFromAsset", handler: inventoryHubFns.createItemFromAssetPortable }),
  definePortableMutation({ name: "inventoryHub:recordAssetStockIntake", handler: inventoryHubFns.recordAssetStockIntakePortable }),
  definePortableMutation({ name: "inventoryHub:backfillAssets", handler: inventoryHubFns.backfillAssetsPortable }),

  // grants
  definePortableQuery({ name: "grants:list", handler: grantsFns.listPortable }),
  definePortableQuery({ name: "grants:get", handler: grantsFns.getPortable }),
  definePortableQuery({ name: "grants:publicOpenings", handler: grantsFns.publicOpeningsPortable }),
  definePortableQuery({ name: "grants:applications", handler: grantsFns.applicationsPortable }),
  definePortableQuery({ name: "grants:transactions", handler: grantsFns.transactionsPortable }),
  definePortableQuery({ name: "grants:reports", handler: grantsFns.reportsPortable }),
  definePortableQuery({ name: "grants:employeeLinks", handler: grantsFns.employeeLinksPortable }),
  definePortableQuery({ name: "grants:summary", handler: grantsFns.summaryPortable }),

  // grantSources
  definePortableQuery({ name: "grantSources:library", handler: grantSourcesFns.libraryPortable }),
  definePortableQuery({ name: "grantSources:list", handler: grantSourcesFns.listPortable }),
  definePortableQuery({ name: "grantSources:listWithLibrary", handler: grantSourcesFns.listWithLibraryPortable }),
  definePortableQuery({ name: "grantSources:getSource", handler: grantSourcesFns.getSourcePortable }),
  definePortableQuery({ name: "grantSources:candidates", handler: grantSourcesFns.candidatesPortable }),
  definePortableMutation({ name: "grantSources:createCandidate", handler: grantSourcesFns.createCandidatePortable }),
  definePortableMutation({ name: "grantSources:setCandidateStatus", handler: grantSourcesFns.setCandidateStatusPortable }),

  // society
  definePortableMutation({ name: "society:setLogoInvertInDarkMode", handler: societyFns.setLogoInvertInDarkModePortable }),
  definePortableMutation({ name: "society:updateModules", handler: societyFns.updateModulesPortable }),
  definePortableMutation({ name: "society:cloneSociety", handler: societyFns.cloneSocietyPortable }),
  definePortableMutation({ name: "society:updateComplianceSettings", handler: societyFns.updateComplianceSettingsPortable }),
  definePortableMutation({ name: "society:updateInventorySettings", handler: societyFns.updateInventorySettingsPortable }),
  definePortableMutation({ name: "society:updateNotificationSettings", handler: societyFns.updateNotificationSettingsPortable }),

  // subscriptions
  definePortableQuery({ name: "subscriptions:plans", handler: subscriptionsFns.plansPortable }),
  definePortableQuery({ name: "subscriptions:mySubscriptions", handler: subscriptionsFns.mySubscriptionsPortable }),
  definePortableQuery({ name: "subscriptions:allSubscriptions", handler: subscriptionsFns.allSubscriptionsPortable }),
  definePortableQuery({ name: "subscriptions:feeTimeline", handler: subscriptionsFns.feeTimelinePortable }),
  definePortableMutation({ name: "subscriptions:cancelSubscription", handler: subscriptionsFns.cancelSubscriptionPortable }),
  definePortableQuery({ name: "subscriptions:getPlan", handler: subscriptionsFns.getPlanPortable }),

  // elections
  definePortableQuery({ name: "elections:list", handler: electionsFns.listPortable }),
  definePortableQuery({ name: "elections:get", handler: electionsFns.getPortable }),
  definePortableQuery({ name: "elections:listNominations", handler: electionsFns.listNominationsPortable }),
  definePortableQuery({ name: "elections:listMine", handler: electionsFns.listMinePortable }),
  definePortableMutation({ name: "elections:submitNomination", handler: electionsFns.submitNominationPortable }),
  definePortableMutation({ name: "elections:castBallot", handler: electionsFns.castBallotPortable }),
  definePortableQuery({ name: "elections:tally", handler: electionsFns.tallyPortable }),

  // volunteers
  definePortableQuery({ name: "volunteers:list", handler: volunteersFns.listPortable }),
  definePortableQuery({ name: "volunteers:applications", handler: volunteersFns.applicationsPortable }),
  definePortableQuery({ name: "volunteers:screenings", handler: volunteersFns.screeningsPortable }),
  definePortableQuery({ name: "volunteers:summary", handler: volunteersFns.summaryPortable }),
  definePortableQuery({ name: "volunteers:buildCrrpDraft", handler: volunteersFns.buildCrrpDraftPortable }),

  // users
  definePortableQuery({ name: "users:list", handler: usersFns.usersList }),
  definePortableQuery({ name: "users:get", handler: usersFns.userGet }),
  definePortableQuery({ name: "users:getByEmail", handler: usersFns.userGetByEmail }),
  definePortableQuery({ name: "users:getByAuthSubject", handler: usersFns.userGetByAuthSubject }),
  definePortableMutation({ name: "users:resolveAuthSession", handler: usersFns.resolveAuthSessionPortable }),
  definePortableMutation({ name: "users:recordLogin", handler: usersFns.recordLoginPortable }),

  // notifications
  definePortableQuery({ name: "notifications:list", handler: notificationsFns.notificationsList }),
  definePortableQuery({ name: "notifications:unreadCount", handler: notificationsFns.notificationsUnreadCount }),
  definePortableMutation({ name: "notifications:create", handler: notificationsFns.notificationCreate }),
  definePortableMutation({ name: "notifications:remove", handler: notificationsFns.notificationRemove }),
  definePortableMutation({ name: "notifications:removeAllDismissed", handler: notificationsFns.notificationRemoveAllDismissed }),
  definePortableQuery({ name: "notifications:listPrefs", handler: notificationsFns.notificationsListPrefs }),
  definePortableMutation({ name: "notifications:upsertPref", handler: notificationsFns.notificationUpsertPref }),

  // fundingSources
  definePortableQuery({ name: "fundingSources:list", handler: fundingSourcesFns.fundingSourcesList }),
  definePortableQuery({ name: "fundingSources:rollup", handler: fundingSourcesFns.fundingSourcesRollup }),
  definePortableMutation({ name: "fundingSources:applyOtenFeeStructure", handler: fundingSourcesFns.applyOtenFeeStructurePortable }),

  // exports
  definePortableQuery({ name: "exports:listExportableTables", handler: exportsFns.listExportableTablesPortable }),
  definePortableQuery({ name: "exports:exportTable", handler: exportsFns.exportTablePortable }),
  definePortableQuery({ name: "exports:exportTablePage", handler: exportsFns.exportTablePagePortable }),
  definePortableQuery({ name: "exports:countTablePage", handler: exportsFns.countTablePagePortable }),
  definePortableQuery({ name: "exports:exportWorkspace", handler: exportsFns.exportWorkspacePortable }),
  definePortableQuery({ name: "exports:validateCurrentDatabase", handler: exportsFns.validateCurrentDatabasePortable }),

  // partyPortals
  definePortableQuery({ name: "partyPortals:list", handler: partyPortalsFns.listPortable }),
  definePortableMutation({ name: "partyPortals:create", handler: partyPortalsFns.createPortable }),
  definePortableMutation({ name: "partyPortals:revoke", handler: partyPortalsFns.revokePortable }),

  // minutes
  definePortableQuery({ name: "minutes:list", handler: minutesFns.listPortable }),
  definePortableQuery({ name: "minutes:getByMeeting", handler: minutesFns.getByMeetingPortable }),
  definePortableMutation({ name: "minutes:create", handler: minutesFns.createPortable }),
  definePortableMutation({ name: "minutes:update", handler: minutesFns.updatePortable }),
  definePortableMutation({ name: "minutes:upsertFromDraft", handler: minutesFns.upsertFromDraftPortable }),
  definePortableMutation({ name: "minutes:backfillMotionPersonLinks", handler: minutesFns.backfillMotionPersonLinksPortable }),

  // meetingMaterials
  definePortableQuery({ name: "meetingMaterials:listForMeeting", handler: meetingMaterialsFns.listForMeetingPortable }),
  definePortableQuery({ name: "meetingMaterials:listForSociety", handler: meetingMaterialsFns.listForSocietyPortable }),
  definePortableMutation({ name: "meetingMaterials:attach", handler: meetingMaterialsFns.attachPortable }),
  definePortableMutation({ name: "meetingMaterials:setAvailability", handler: meetingMaterialsFns.setAvailabilityPortable }),
  definePortableMutation({ name: "meetingMaterials:remove", handler: meetingMaterialsFns.removePortable }),

  // transparency
  definePortableQuery({ name: "transparency:listPublications", handler: transparencyFns.listPublicationsPortable }),

  // financialHub
  definePortableQuery({ name: "financialHub:connections", handler: financialHubFns.connectionsPortable }),
  definePortableQuery({ name: "financialHub:accounts", handler: financialHubFns.accountsPortable }),
  definePortableQuery({ name: "financialHub:transactions", handler: financialHubFns.transactionsPortable }),
  definePortableQuery({ name: "financialHub:transactionsForAccountExternalId", handler: financialHubFns.transactionsForAccountExternalIdPortable }),
  definePortableQuery({ name: "financialHub:transactionsForCounterpartyExternalId", handler: financialHubFns.transactionsForCounterpartyExternalIdPortable }),
  definePortableQuery({ name: "financialHub:transactionsForCategoryAccountExternalId", handler: financialHubFns.transactionsForCategoryAccountExternalIdPortable }),
  definePortableQuery({ name: "financialHub:budgets", handler: financialHubFns.budgetsPortable }),
  definePortableQuery({ name: "financialHub:operatingSubscriptions", handler: financialHubFns.operatingSubscriptionsPortable }),
  definePortableMutation({ name: "financialHub:upsertBudget", handler: financialHubFns.upsertBudgetPortable }),
  definePortableMutation({ name: "financialHub:upsertOperatingSubscription", handler: financialHubFns.upsertOperatingSubscriptionPortable }),
  definePortableMutation({ name: "financialHub:removeOperatingSubscription", handler: financialHubFns.removeOperatingSubscriptionPortable }),
  definePortableMutation({ name: "financialHub:removeBudget", handler: financialHubFns.removeBudgetPortable }),

  // communications
  definePortableQuery({ name: "communications:listTemplates", handler: communicationsFns.listTemplatesPortable }),
  definePortableQuery({ name: "communications:getTemplate", handler: communicationsFns.getTemplatePortable }),
  definePortableQuery({ name: "communications:listCampaigns", handler: communicationsFns.listCampaignsPortable }),
  definePortableQuery({ name: "communications:listDeliveries", handler: communicationsFns.listDeliveriesPortable }),
  definePortableQuery({ name: "communications:listMemberPrefs", handler: communicationsFns.listMemberPrefsPortable }),
  definePortableQuery({ name: "communications:listSegments", handler: communicationsFns.listSegmentsPortable }),
  definePortableMutation({ name: "communications:upsertTemplate", handler: communicationsFns.upsertTemplatePortable }),
  definePortableMutation({ name: "communications:upsertSegment", handler: communicationsFns.upsertSegmentPortable }),
  definePortableMutation({ name: "communications:removeSegment", handler: communicationsFns.removeSegmentPortable }),
  definePortableMutation({ name: "communications:upsertMemberPref", handler: communicationsFns.upsertMemberPrefPortable }),
  definePortableMutation({ name: "communications:markDeliveryOpened", handler: communicationsFns.markDeliveryOpenedPortable }),

  // workflows
  definePortableQuery({ name: "workflows:list", handler: workflowsFns.listPortable }),
  definePortableQuery({ name: "workflows:listRuns", handler: workflowsFns.listRunsPortable }),
  definePortableQuery({ name: "workflows:runsForWorkflow", handler: workflowsFns.runsForWorkflowPortable }),
  definePortableQuery({ name: "workflows:getRun", handler: workflowsFns.getRunPortable }),
  definePortableMutation({ name: "workflows:setStatus", handler: workflowsFns.setStatusPortable }),
  definePortableMutation({ name: "workflows:update", handler: workflowsFns.updatePortable }),
  definePortableMutation({ name: "workflows:addNode", handler: workflowsFns.addNodePortable }),

  // waveCache
  definePortableQuery({ name: "waveCache:summary", handler: waveCacheFns.summaryPortable }),
  definePortableQuery({ name: "waveCache:resources", handler: waveCacheFns.resourcesPortable }),
  definePortableQuery({ name: "waveCache:resource", handler: waveCacheFns.resourcePortable }),
  definePortableQuery({ name: "waveCache:resourceByExternalId", handler: waveCacheFns.resourceByExternalIdPortable }),
  definePortableQuery({ name: "waveCache:structures", handler: waveCacheFns.structuresPortable }),

  // calendarSync
  definePortableMutation({ name: "calendarSync:upsertExternalCalendarEventMapping", handler: calendarSyncFns.upsertExternalCalendarEventMappingPortable }),
  definePortableMutation({ name: "calendarSync:recordCalendarWebhook", handler: calendarSyncFns.recordCalendarWebhookPortable }),
  definePortableMutation({ name: "calendarSync:recordCalendarIncrementalCursor", handler: calendarSyncFns.recordCalendarIncrementalCursorPortable }),

  // secrets
  definePortableQuery({ name: "secrets:list", handler: secretsFns.listPortable }),
  definePortableMutation({ name: "secrets:remove", handler: secretsFns.removePortable }),

  // aiAgents
  definePortableQuery({ name: "aiAgents:listDefinitions", handler: aiAgentsFns.listDefinitionsPortable }),
  definePortableQuery({ name: "aiAgents:listSkills", handler: aiAgentsFns.listSkillsPortable }),
  definePortableQuery({ name: "aiAgents:listAllSkills", handler: aiAgentsFns.listAllSkillsPortable }),
  definePortableQuery({ name: "aiAgents:loadSkills", handler: aiAgentsFns.loadSkillsPortable }),
  definePortableMutation({ name: "aiAgents:upsertSkill", handler: aiAgentsFns.upsertSkillPortable }),
  definePortableMutation({ name: "aiAgents:setSkillActive", handler: aiAgentsFns.setSkillActivePortable }),
  definePortableMutation({ name: "aiAgents:removeSkill", handler: aiAgentsFns.removeSkillPortable }),
  definePortableQuery({ name: "aiAgents:listLogicFunctions", handler: aiAgentsFns.listLogicFunctionsPortable }),
  definePortableQuery({ name: "aiAgents:listToolDrafts", handler: aiAgentsFns.listToolDraftsPortable }),
  definePortableMutation({ name: "aiAgents:approveToolDraft", handler: aiAgentsFns.approveToolDraftPortable }),
  definePortableMutation({ name: "aiAgents:rejectToolDraft", handler: aiAgentsFns.rejectToolDraftPortable }),
  definePortableMutation({ name: "aiAgents:upsertLogicFunction", handler: aiAgentsFns.upsertLogicFunctionPortable }),

  // aiSettings
  definePortableQuery({ name: "aiSettings:getEffective", handler: aiSettingsFns.getEffectivePortable }),
  definePortableMutation({ name: "aiSettings:upsert", handler: aiSettingsFns.upsertPortable }),
  definePortableMutation({ name: "aiSettings:setStatus", handler: aiSettingsFns.setStatusPortable }),

  // apiPlatform
  definePortableQuery({ name: "apiPlatform:listClients", handler: apiPlatformFns.listClientsPortable }),
  definePortableMutation({ name: "apiPlatform:createClient", handler: apiPlatformFns.createClientPortable }),
  definePortableMutation({ name: "apiPlatform:updateClient", handler: apiPlatformFns.updateClientPortable }),
  definePortableQuery({ name: "apiPlatform:listTokens", handler: apiPlatformFns.listTokensPortable }),
  definePortableQuery({ name: "apiPlatform:listPluginInstallations", handler: apiPlatformFns.listPluginInstallationsPortable }),
  definePortableQuery({ name: "apiPlatform:listIntegrationCatalog", handler: apiPlatformFns.listIntegrationCatalogPortable }),
  definePortableMutation({ name: "apiPlatform:installIntegration", handler: apiPlatformFns.installIntegrationPortable }),
  definePortableMutation({ name: "apiPlatform:updateIntegrationHealth", handler: apiPlatformFns.updateIntegrationHealthPortable }),
  definePortableMutation({ name: "apiPlatform:upsertPluginInstallation", handler: apiPlatformFns.upsertPluginInstallationPortable }),
  definePortableQuery({ name: "apiPlatform:listIntegrationSyncStates", handler: apiPlatformFns.listIntegrationSyncStatesPortable }),

  // paperless
  definePortableQuery({ name: "paperless:listConnection", handler: paperlessFns.listConnectionPortable }),
  definePortableQuery({ name: "paperless:recentSyncs", handler: paperlessFns.recentSyncsPortable }),
  definePortableQuery({ name: "paperless:syncForDocument", handler: paperlessFns.syncForDocumentPortable }),
  definePortableQuery({ name: "paperless:sourcePullContext", handler: paperlessFns.sourcePullContextPortable }),
  definePortableQuery({ name: "paperless:authorizeMeetingImport", handler: paperlessFns.authorizeMeetingImportPortable }),
  definePortableQuery({ name: "paperless:getSync", handler: paperlessFns.getSyncPortable }),
  definePortableMutation({ name: "paperless:recordConnectionTest", handler: paperlessFns.recordConnectionTestPortable }),

  // documentVersions
  definePortableQuery({ name: "documentVersions:listForDocument", handler: documentVersionsFns.listForDocumentPortable }),
  definePortableQuery({ name: "documentVersions:latest", handler: documentVersionsFns.latestPortable }),
  definePortableQuery({ name: "documentVersions:get", handler: documentVersionsFns.getPortable }),
  definePortableMutation({ name: "documentVersions:rollback", handler: documentVersionsFns.rollbackPortable }),

  // importSessions
  definePortableQuery({ name: "importSessions:list", handler: importSessionsFns.listPortable }),
  definePortableQuery({ name: "importSessions:get", handler: importSessionsFns.getPortable }),
  definePortableMutation({ name: "importSessions:createFromBundle", handler: importSessionsFns.createFromBundlePortable }),
  definePortableMutation({ name: "importSessions:updateRecord", handler: importSessionsFns.updateRecordPortable }),
  definePortableMutation({ name: "importSessions:bulkSetStatus", handler: importSessionsFns.bulkSetStatusPortable }),
  definePortableMutation({ name: "importSessions:bulkSetStatusByKind", handler: importSessionsFns.bulkSetStatusByKindPortable }),
  definePortableMutation({ name: "importSessions:bulkSetStatusByFilter", handler: importSessionsFns.bulkSetStatusByFilterPortable }),
  definePortableMutation({ name: "importSessions:refreshSessionSummaries", handler: importSessionsFns.refreshSessionSummariesPortable }),
  definePortableMutation({ name: "importSessions:removeSession", handler: importSessionsFns.removeSessionPortable }),
  definePortableMutation({ name: "importSessions:applyApprovedToOrgHistory", handler: importSessionsFns.applyApprovedToOrgHistoryPortable }),
  definePortableMutation({ name: "importSessions:applyApprovedMeetings", handler: importSessionsFns.applyApprovedMeetingsPortable }),
  definePortableMutation({ name: "importSessions:backfillApprovedMeetingReferences", handler: importSessionsFns.backfillApprovedMeetingReferencesPortable }),

  // transcripts
  definePortableQuery({ name: "transcripts:getByMeeting", handler: transcriptsFns.getByMeetingPortable }),
  definePortableQuery({ name: "transcripts:jobForMeeting", handler: transcriptsFns.jobForMeetingPortable }),
  definePortableMutation({ name: "transcripts:createJob", handler: transcriptsFns.createJobPortable }),
  definePortableMutation({ name: "transcripts:updateJob", handler: transcriptsFns.updateJobPortable }),
  definePortableMutation({ name: "transcripts:saveTranscript", handler: transcriptsFns.saveTranscriptPortable }),
  definePortableMutation({ name: "transcripts:saveText", handler: transcriptsFns.saveTextPortable }),
  definePortableMutation({ name: "transcripts:importVtt", handler: transcriptsFns.importVttPortable }),

  // grants
  definePortableMutation({ name: "grants:upsertEmployeeLink", handler: grantsFns.upsertEmployeeLinkPortable }),
  definePortableMutation({ name: "grants:removeEmployeeLink", handler: grantsFns.removeEmployeeLinkPortable }),
  definePortableMutation({ name: "grants:submitApplication", handler: grantsFns.submitApplicationPortable }),
  definePortableMutation({ name: "grants:reviewApplication", handler: grantsFns.reviewApplicationPortable }),
  definePortableMutation({ name: "grants:convertApplication", handler: grantsFns.convertApplicationPortable }),
  definePortableMutation({ name: "grants:upsertGrant", handler: grantsFns.upsertGrantPortable }),
  definePortableMutation({ name: "grants:importGcosProjectSnapshot", handler: grantsFns.importGcosProjectSnapshotPortable }),
  definePortableMutation({ name: "grants:removeGrant", handler: grantsFns.removeGrantPortable }),
  definePortableMutation({ name: "grants:upsertReport", handler: grantsFns.upsertReportPortable }),
  definePortableMutation({ name: "grants:removeReport", handler: grantsFns.removeReportPortable }),
  definePortableMutation({ name: "grants:upsertTransaction", handler: grantsFns.upsertTransactionPortable }),
  definePortableMutation({ name: "grants:removeTransaction", handler: grantsFns.removeTransactionPortable }),

  // fundingSources
  definePortableMutation({ name: "fundingSources:upsertSource", handler: fundingSourcesFns.upsertSourcePortable }),
  definePortableMutation({ name: "fundingSources:removeSource", handler: fundingSourcesFns.removeSourcePortable }),
  definePortableMutation({ name: "fundingSources:upsertEvent", handler: fundingSourcesFns.upsertEventPortable }),
  definePortableMutation({ name: "fundingSources:removeEvent", handler: fundingSourcesFns.removeEventPortable }),
  definePortableMutation({ name: "fundingSources:importStudentLevy", handler: fundingSourcesFns.importStudentLevyPortable }),

  // subscriptions
  definePortableMutation({ name: "subscriptions:upsertPlan", handler: subscriptionsFns.upsertPlanPortable }),
  definePortableMutation({ name: "subscriptions:upsertFeePeriod", handler: subscriptionsFns.upsertFeePeriodPortable }),
  definePortableMutation({ name: "subscriptions:removeFeePeriod", handler: subscriptionsFns.removeFeePeriodPortable }),
  definePortableMutation({ name: "subscriptions:removePlan", handler: subscriptionsFns.removePlanPortable }),

  // elections
  definePortableMutation({ name: "elections:create", handler: electionsFns.createPortable }),
  definePortableMutation({ name: "elections:updateSettings", handler: electionsFns.updateSettingsPortable }),
  definePortableMutation({ name: "elections:addQuestion", handler: electionsFns.addQuestionPortable }),
  definePortableMutation({ name: "elections:reviewNomination", handler: electionsFns.reviewNominationPortable }),
  definePortableMutation({ name: "elections:publishNominationToBallot", handler: electionsFns.publishNominationToBallotPortable }),
  definePortableMutation({ name: "elections:snapshotEligibleVoters", handler: electionsFns.snapshotEligibleVotersPortable }),
  definePortableMutation({ name: "elections:close", handler: electionsFns.closePortable }),
  definePortableMutation({ name: "elections:tallyElection", handler: electionsFns.tallyElectionPortable }),

  // volunteers
  definePortableMutation({ name: "volunteers:submitApplication", handler: volunteersFns.submitApplicationPortable }),
  definePortableMutation({ name: "volunteers:reviewApplication", handler: volunteersFns.reviewApplicationPortable }),
  definePortableMutation({ name: "volunteers:convertApplication", handler: volunteersFns.convertApplicationPortable }),
  definePortableMutation({ name: "volunteers:upsertVolunteer", handler: volunteersFns.upsertVolunteerPortable }),
  definePortableMutation({ name: "volunteers:removeVolunteer", handler: volunteersFns.removeVolunteerPortable }),
  definePortableMutation({ name: "volunteers:upsertScreening", handler: volunteersFns.upsertScreeningPortable }),
  definePortableMutation({ name: "volunteers:removeScreening", handler: volunteersFns.removeScreeningPortable }),

  // notifications
  definePortableMutation({ name: "notifications:markRead", handler: notificationsFns.notificationMarkRead }),
  definePortableMutation({ name: "notifications:markAllRead", handler: notificationsFns.notificationMarkAllRead }),
  definePortableMutation({ name: "notifications:dismiss", handler: notificationsFns.notificationDismiss }),
  definePortableMutation({ name: "notifications:snooze", handler: notificationsFns.notificationSnooze }),
  definePortableMutation({ name: "notifications:dismissAll", handler: notificationsFns.notificationDismissAll }),

  // transparency
  definePortableMutation({ name: "transparency:upsertPublication", handler: transparencyFns.upsertPublicationPortable }),
  definePortableMutation({ name: "transparency:removePublication", handler: transparencyFns.removePublicationPortable }),

  // members
  definePortableMutation({ name: "members:merge", handler: membersFns.memberMerge }),

  // recordLayouts
  definePortableQuery({ name: "recordLayouts:get", handler: recordLayoutsFns.recordLayoutGet }),
  definePortableMutation({ name: "recordLayouts:upsert", handler: recordLayoutsFns.recordLayoutUpsert }),
  definePortableMutation({ name: "recordLayouts:remove", handler: recordLayoutsFns.recordLayoutRemove }),

  // legalOperations
  definePortableQuery({ name: "legalOperations:listRoleHolders", handler: roleHoldersFns.listRoleHoldersPortable }),
  definePortableMutation({ name: "legalOperations:upsertRoleHolder", handler: roleHoldersFns.upsertRoleHolderPortable }),
  definePortableMutation({ name: "legalOperations:removeRoleHolder", handler: roleHoldersFns.removeRoleHolderPortable }),
  definePortableQuery({ name: "legalOperations:rightsLedger", handler: roleHoldersFns.rightsLedgerPortable }),

  // bylawAmendments
  definePortableMutation({ name: "bylawAmendments:startConsultation", handler: bylawAmendmentsFns.startConsultationPortable }),
  definePortableMutation({ name: "bylawAmendments:markResolutionPassed", handler: bylawAmendmentsFns.markResolutionPassedPortable }),
  definePortableMutation({ name: "bylawAmendments:markFiled", handler: bylawAmendmentsFns.markFiledPortable }),
  definePortableMutation({ name: "bylawAmendments:withdraw", handler: bylawAmendmentsFns.withdrawPortable }),
  definePortableMutation({ name: "bylawAmendments:supersede", handler: bylawAmendmentsFns.supersedePortable }),
  definePortableMutation({ name: "bylawAmendments:materializeSections", handler: bylawAmendmentsFns.materializeSectionsPortable }),

];

/** Names of every ported function, for diagnostics / the conformance harness. */
export const PORTABLE_FUNCTION_NAMES: string[] = PORTABLE_FUNCTIONS.map((def) => def.name);
