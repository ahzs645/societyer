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
import type * as agm from "../agm.js";
import type * as attestations from "../attestations.js";
import type * as auditors from "../auditors.js";
import type * as bylawAmendments from "../bylawAmendments.js";
import type * as committees from "../committees.js";
import type * as conflicts from "../conflicts.js";
import type * as courtOrders from "../courtOrders.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deadlines from "../deadlines.js";
import type * as directors from "../directors.js";
import type * as documentVersions from "../documentVersions.js";
import type * as documents from "../documents.js";
import type * as employees from "../employees.js";
import type * as files from "../files.js";
import type * as filingBot from "../filingBot.js";
import type * as filingExports from "../filingExports.js";
import type * as filings from "../filings.js";
import type * as financialHub from "../financialHub.js";
import type * as financials from "../financials.js";
import type * as goals from "../goals.js";
import type * as inspections from "../inspections.js";
import type * as insurance from "../insurance.js";
import type * as meetings from "../meetings.js";
import type * as memberProposals from "../memberProposals.js";
import type * as members from "../members.js";
import type * as minutes from "../minutes.js";
import type * as notifications from "../notifications.js";
import type * as pipaTraining from "../pipaTraining.js";
import type * as providers_accounting from "../providers/accounting.js";
import type * as providers_billing from "../providers/billing.js";
import type * as providers_email from "../providers/email.js";
import type * as providers_env from "../providers/env.js";
import type * as providers_llm from "../providers/llm.js";
import type * as providers_storage from "../providers/storage.js";
import type * as providers_transcription from "../providers/transcription.js";
import type * as proxies from "../proxies.js";
import type * as receipts from "../receipts.js";
import type * as reconciliation from "../reconciliation.js";
import type * as recordsLocation from "../recordsLocation.js";
import type * as remuneration from "../remuneration.js";
import type * as retention from "../retention.js";
import type * as seed from "../seed.js";
import type * as signatures from "../signatures.js";
import type * as society from "../society.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tasks from "../tasks.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";
import type * as writtenResolutions from "../writtenResolutions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agm: typeof agm;
  attestations: typeof attestations;
  auditors: typeof auditors;
  bylawAmendments: typeof bylawAmendments;
  committees: typeof committees;
  conflicts: typeof conflicts;
  courtOrders: typeof courtOrders;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deadlines: typeof deadlines;
  directors: typeof directors;
  documentVersions: typeof documentVersions;
  documents: typeof documents;
  employees: typeof employees;
  files: typeof files;
  filingBot: typeof filingBot;
  filingExports: typeof filingExports;
  filings: typeof filings;
  financialHub: typeof financialHub;
  financials: typeof financials;
  goals: typeof goals;
  inspections: typeof inspections;
  insurance: typeof insurance;
  meetings: typeof meetings;
  memberProposals: typeof memberProposals;
  members: typeof members;
  minutes: typeof minutes;
  notifications: typeof notifications;
  pipaTraining: typeof pipaTraining;
  "providers/accounting": typeof providers_accounting;
  "providers/billing": typeof providers_billing;
  "providers/email": typeof providers_email;
  "providers/env": typeof providers_env;
  "providers/llm": typeof providers_llm;
  "providers/storage": typeof providers_storage;
  "providers/transcription": typeof providers_transcription;
  proxies: typeof proxies;
  receipts: typeof receipts;
  reconciliation: typeof reconciliation;
  recordsLocation: typeof recordsLocation;
  remuneration: typeof remuneration;
  retention: typeof retention;
  seed: typeof seed;
  signatures: typeof signatures;
  society: typeof society;
  subscriptions: typeof subscriptions;
  tasks: typeof tasks;
  transcripts: typeof transcripts;
  users: typeof users;
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
