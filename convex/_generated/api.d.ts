/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agendas from "../agendas.js";
import type * as agm from "../agm.js";
import type * as aiAgents from "../aiAgents.js";
import type * as aiChat from "../aiChat.js";
import type * as aiChatActions from "../aiChatActions.js";
import type * as aiSettings from "../aiSettings.js";
import type * as aiSettingsActions from "../aiSettingsActions.js";
import type * as annualCycle from "../annualCycle.js";
import type * as apiPlatform from "../apiPlatform.js";
import type * as assets from "../assets.js";
import type * as attestations from "../attestations.js";
import type * as auditors from "../auditors.js";
import type * as bylawAmendments from "../bylawAmendments.js";
import type * as bylawRules from "../bylawRules.js";
import type * as calendarSync from "../calendarSync.js";
import type * as commandMenuItems from "../commandMenuItems.js";
import type * as commitments from "../commitments.js";
import type * as committees from "../committees.js";
import type * as communications from "../communications.js";
import type * as conflicts from "../conflicts.js";
import type * as courtOrders from "../courtOrders.js";
import type * as crons from "../crons.js";
import type * as customFields from "../customFields.js";
import type * as dashboard from "../dashboard.js";
import type * as dashboardRemediation from "../dashboardRemediation.js";
import type * as deadlines from "../deadlines.js";
import type * as directors from "../directors.js";
import type * as documentComments from "../documentComments.js";
import type * as documentVersions from "../documentVersions.js";
import type * as documents from "../documents.js";
import type * as elections from "../elections.js";
import type * as employees from "../employees.js";
import type * as evidenceRegisters from "../evidenceRegisters.js";
import type * as expenseReports from "../expenseReports.js";
import type * as exports from "../exports.js";
import type * as fieldMetadata from "../fieldMetadata.js";
import type * as files from "../files.js";
import type * as filingBot from "../filingBot.js";
import type * as filingExports from "../filingExports.js";
import type * as filings from "../filings.js";
import type * as financialHub from "../financialHub.js";
import type * as financials from "../financials.js";
import type * as fundingSources from "../fundingSources.js";
import type * as goals from "../goals.js";
import type * as grantSources from "../grantSources.js";
import type * as grants from "../grants.js";
import type * as http from "../http.js";
import type * as importSessions from "../importSessions.js";
import type * as inspections from "../inspections.js";
import type * as insurance from "../insurance.js";
import type * as invitations from "../invitations.js";
import type * as legalOperations from "../legalOperations.js";
import type * as lib_access_documentAccess from "../lib/access/documentAccess.js";
import type * as lib_access_materialAccess from "../lib/access/materialAccess.js";
import type * as lib_bylawRules from "../lib/bylawRules.js";
import type * as lib_dashboardComplianceRules from "../lib/dashboardComplianceRules.js";
import type * as lib_moduleSettings from "../lib/moduleSettings.js";
import type * as lib_orgHubOptions from "../lib/orgHubOptions.js";
import type * as lib_pdfTableNormalization from "../lib/pdfTableNormalization.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_untypedServer from "../lib/untypedServer.js";
import type * as library from "../library.js";
import type * as meetingMaterials from "../meetingMaterials.js";
import type * as meetingTemplates from "../meetingTemplates.js";
import type * as meetings from "../meetings.js";
import type * as memberProposals from "../memberProposals.js";
import type * as members from "../members.js";
import type * as minuteBook from "../minuteBook.js";
import type * as minutes from "../minutes.js";
import type * as motionBacklog from "../motionBacklog.js";
import type * as motionTemplates from "../motionTemplates.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as objectMetadata from "../objectMetadata.js";
import type * as orgChartAssignments from "../orgChartAssignments.js";
import type * as organizationDetails from "../organizationDetails.js";
import type * as organizationHistory from "../organizationHistory.js";
import type * as paperless from "../paperless.js";
import type * as pendingEmails from "../pendingEmails.js";
import type * as permissions from "../permissions.js";
import type * as pipaTraining from "../pipaTraining.js";
import type * as policies from "../policies.js";
import type * as providers_accounting from "../providers/accounting.js";
import type * as providers_billing from "../providers/billing.js";
import type * as providers_email from "../providers/email.js";
import type * as providers_env from "../providers/env.js";
import type * as providers_llm from "../providers/llm.js";
import type * as providers_paperless from "../providers/paperless.js";
import type * as providers_sms from "../providers/sms.js";
import type * as providers_storage from "../providers/storage.js";
import type * as providers_transcription from "../providers/transcription.js";
import type * as providers_waveData from "../providers/waveData.js";
import type * as providers_waveDiagnostics from "../providers/waveDiagnostics.js";
import type * as proxies from "../proxies.js";
import type * as publicPortal from "../publicPortal.js";
import type * as receipts from "../receipts.js";
import type * as reconciliation from "../reconciliation.js";
import type * as recordLayouts from "../recordLayouts.js";
import type * as recordTableMetadataDefinitions from "../recordTableMetadataDefinitions.js";
import type * as recordsLocation from "../recordsLocation.js";
import type * as remuneration from "../remuneration.js";
import type * as retention from "../retention.js";
import type * as secrets from "../secrets.js";
import type * as seed from "../seed.js";
import type * as seedRecordTableMetadata from "../seedRecordTableMetadata.js";
import type * as signatures from "../signatures.js";
import type * as society from "../society.js";
import type * as starterPolicyTemplateSourceTexts from "../starterPolicyTemplateSourceTexts.js";
import type * as starterPolicyTemplates from "../starterPolicyTemplates.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tasks from "../tasks.js";
import type * as transcripts from "../transcripts.js";
import type * as transparency from "../transparency.js";
import type * as treasury from "../treasury.js";
import type * as users from "../users.js";
import type * as views from "../views.js";
import type * as volunteers from "../volunteers.js";
import type * as waveCache from "../waveCache.js";
import type * as workflowPackages from "../workflowPackages.js";
import type * as workflows from "../workflows.js";
import type * as writtenResolutions from "../writtenResolutions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agendas: typeof agendas;
  agm: typeof agm;
  aiAgents: typeof aiAgents;
  aiChat: typeof aiChat;
  aiChatActions: typeof aiChatActions;
  aiSettings: typeof aiSettings;
  aiSettingsActions: typeof aiSettingsActions;
  annualCycle: typeof annualCycle;
  apiPlatform: typeof apiPlatform;
  assets: typeof assets;
  attestations: typeof attestations;
  auditors: typeof auditors;
  bylawAmendments: typeof bylawAmendments;
  bylawRules: typeof bylawRules;
  calendarSync: typeof calendarSync;
  commandMenuItems: typeof commandMenuItems;
  commitments: typeof commitments;
  committees: typeof committees;
  communications: typeof communications;
  conflicts: typeof conflicts;
  courtOrders: typeof courtOrders;
  crons: typeof crons;
  customFields: typeof customFields;
  dashboard: typeof dashboard;
  dashboardRemediation: typeof dashboardRemediation;
  deadlines: typeof deadlines;
  directors: typeof directors;
  documentComments: typeof documentComments;
  documentVersions: typeof documentVersions;
  documents: typeof documents;
  elections: typeof elections;
  employees: typeof employees;
  evidenceRegisters: typeof evidenceRegisters;
  expenseReports: typeof expenseReports;
  exports: typeof exports;
  fieldMetadata: typeof fieldMetadata;
  files: typeof files;
  filingBot: typeof filingBot;
  filingExports: typeof filingExports;
  filings: typeof filings;
  financialHub: typeof financialHub;
  financials: typeof financials;
  fundingSources: typeof fundingSources;
  goals: typeof goals;
  grantSources: typeof grantSources;
  grants: typeof grants;
  http: typeof http;
  importSessions: typeof importSessions;
  inspections: typeof inspections;
  insurance: typeof insurance;
  invitations: typeof invitations;
  legalOperations: typeof legalOperations;
  "lib/access/documentAccess": typeof lib_access_documentAccess;
  "lib/access/materialAccess": typeof lib_access_materialAccess;
  "lib/bylawRules": typeof lib_bylawRules;
  "lib/dashboardComplianceRules": typeof lib_dashboardComplianceRules;
  "lib/moduleSettings": typeof lib_moduleSettings;
  "lib/orgHubOptions": typeof lib_orgHubOptions;
  "lib/pdfTableNormalization": typeof lib_pdfTableNormalization;
  "lib/permissions": typeof lib_permissions;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/untypedServer": typeof lib_untypedServer;
  library: typeof library;
  meetingMaterials: typeof meetingMaterials;
  meetingTemplates: typeof meetingTemplates;
  meetings: typeof meetings;
  memberProposals: typeof memberProposals;
  members: typeof members;
  minuteBook: typeof minuteBook;
  minutes: typeof minutes;
  motionBacklog: typeof motionBacklog;
  motionTemplates: typeof motionTemplates;
  notes: typeof notes;
  notifications: typeof notifications;
  objectMetadata: typeof objectMetadata;
  orgChartAssignments: typeof orgChartAssignments;
  organizationDetails: typeof organizationDetails;
  organizationHistory: typeof organizationHistory;
  paperless: typeof paperless;
  pendingEmails: typeof pendingEmails;
  permissions: typeof permissions;
  pipaTraining: typeof pipaTraining;
  policies: typeof policies;
  "providers/accounting": typeof providers_accounting;
  "providers/billing": typeof providers_billing;
  "providers/email": typeof providers_email;
  "providers/env": typeof providers_env;
  "providers/llm": typeof providers_llm;
  "providers/paperless": typeof providers_paperless;
  "providers/sms": typeof providers_sms;
  "providers/storage": typeof providers_storage;
  "providers/transcription": typeof providers_transcription;
  "providers/waveData": typeof providers_waveData;
  "providers/waveDiagnostics": typeof providers_waveDiagnostics;
  proxies: typeof proxies;
  publicPortal: typeof publicPortal;
  receipts: typeof receipts;
  reconciliation: typeof reconciliation;
  recordLayouts: typeof recordLayouts;
  recordTableMetadataDefinitions: typeof recordTableMetadataDefinitions;
  recordsLocation: typeof recordsLocation;
  remuneration: typeof remuneration;
  retention: typeof retention;
  secrets: typeof secrets;
  seed: typeof seed;
  seedRecordTableMetadata: typeof seedRecordTableMetadata;
  signatures: typeof signatures;
  society: typeof society;
  starterPolicyTemplateSourceTexts: typeof starterPolicyTemplateSourceTexts;
  starterPolicyTemplates: typeof starterPolicyTemplates;
  subscriptions: typeof subscriptions;
  tasks: typeof tasks;
  transcripts: typeof transcripts;
  transparency: typeof transparency;
  treasury: typeof treasury;
  users: typeof users;
  views: typeof views;
  volunteers: typeof volunteers;
  waveCache: typeof waveCache;
  workflowPackages: typeof workflowPackages;
  workflows: typeof workflows;
  writtenResolutions: typeof writtenResolutions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
