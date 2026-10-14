/**
 * Gate for the corporation demo workspaces (shared/demoData/corporations.ts):
 * Cedar Demo Holdings Ltd. (BC), Maple Demo Federal Inc. (CBCA) and Lakeshore
 * Demo Ontario Inc. (OBCA), the populated workspaces the demo banner's
 * "Try another organization type" opens.
 *
 * For each persona, at several demo dates, it checks the generated rows with
 * the app's own rules rather than restating them:
 *   - every reference resolves (schema-typed id fields and every generated id
 *     mentioned anywhere), and the rows insert into the Convex schema;
 *   - the share ledger balances: issued − redeemed ± transferred = outstanding
 *     per class, the posting gates pass, and the certificates match holdings;
 *   - the transparency / ISC register matches the 25% holding thresholds;
 *   - every dividend passes the dividend gate and its entitlements match the
 *     ledger at the record date;
 *   - every written resolution is a verified "Carried" record;
 *   - the directors meet the profile's minimum and residency rules;
 *   - the derived obligations are non-empty, open and dated after the demo date;
 *   - the real portable queries behind the corporate pages answer with content;
 *   - in the in-browser demo store, seeding a persona is idempotent, Reseed and
 *     Wipe drop it, and it can be opened again.
 *
 *   npm run test:corporation-demo
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import {
  CORPORATION_DEMO_IDENTITIES,
  CORPORATION_DEMO_KEYS,
  CORPORATION_DEMO_STORY_DATE,
  CORPORATION_DEMO_TABLE_ORDER,
  buildCorporationDemo,
  corporationDemoLocalSeed,
  corporationDemoSocietyId,
  insertCorporationDemo,
  type CorporationDemo,
  type CorporationDemoKey,
} from "../shared/demoData/corporations";
import { DEMO_PERSONAS, demoPersonaWorkspaceValues, personaForOrganization } from "../src/lib/demoPersonas";
import { demoAsOfDate } from "../shared/demoData/prng";
import { todayDateOnly } from "../shared/dateOnly";
import {
  deriveCurrentHoldings,
  holdingsAsOf,
  ledgerPostingIssues,
  shareClassRightsIssues,
  validateAuthorizedMaximums,
  validateLedger,
} from "../shared/equityLedger";
import { duplicateCertificateNumber, reconcileCertificatesWithLedger, validateCertificate } from "../shared/shareCertificates";
import { candidateFactsFromRegister, candidateSignificantIndividuals, reviewsDue, transparencyEventsFromSteps } from "../shared/significantIndividuals";
import { looksLikeOrganization } from "../shared/nlg";
import { dividendDeclarationProblems, dividendEntitlements } from "../shared/dividends";
import { transferConsentRequired } from "../shared/operativeArticles";
import { legalGovernanceProfile, minimumLegalDirectors, requiredResidentCanadianDirectors, writtenResolutionRule } from "../shared/legalGovernanceProfiles";
import { roleHolderEligibility, eligibilityScopeFor, directorProblems, sharedOfficeWarnings } from "../shared/registerValidation";
import { deriveComplianceDeadlines, deriveComplianceHistoryNotices } from "../shared/corporationSettings";
import { annualGovernanceSettings } from "../shared/annualGovernanceEvidence";
import { writtenResolutionView } from "../shared/functions/writtenResolutions";
import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import * as roleHolderFns from "../shared/functions/roleHolders";
import * as votingPowerFns from "../shared/functions/votingPower";
import * as certificateFns from "../shared/functions/shareCertificates";
import * as dividendFns from "../shared/functions/dividends";
import * as stepFns from "../shared/functions/significantIndividualSteps";
import * as resolutionFns from "../shared/functions/writtenResolutions";
import * as settingsFns from "../shared/functions/corporationSettings";
import * as minuteBookFns from "../shared/functions/minuteBook";
import * as dashboardFns from "../shared/functions/dashboard";
import * as annualFilingFns from "../shared/functions/annualFilings";
import { StaticConvexClient } from "../src/lib/staticConvex";

const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) {
  checks += 1;
  if (!condition) failures.push(message);
}
function noProblems(problems: readonly string[], context: string) {
  checks += 1;
  if (problems.length) failures.push(`${context}: ${problems.join(" | ")}`);
}

const realToday = todayDateOnly();
const liveAsOf = demoAsOfDate(CORPORATION_DEMO_STORY_DATE, realToday);
// The story date, the live date and later dates (the yearly cycle must keep
// rolling forward with nothing left overdue).
const AS_OF_DATES = [...new Set([CORPORATION_DEMO_STORY_DATE, liveAsOf, "2027-02-15", "2027-06-30", "2028-11-20"])].sort();

// Schema: id-typed fields, so typed references can be checked exactly.
type FieldRef = { path: string[]; table: string };
const tableSchemas: Record<string, any> = Object.fromEntries(Object.entries((schema as any).tables).map(([name, table]: [string, any]) => [name, table.validator.json ?? table.validator]));
function idFields(json: any, path: string[] = []): FieldRef[] {
  if (!json) return [];
  if (json.type === "id") return [{ path, table: json.tableName }];
  if (json.type === "object") return Object.entries<any>(json.value).flatMap(([field, value]) => idFields(value.fieldType, [...path, field]));
  if (json.type === "array") return idFields(json.value, [...path, "[]"]);
  if (json.type === "union") return json.value.flatMap((member: any) => idFields(member, path));
  return [];
}
const refsByTable: Record<string, FieldRef[]> = Object.fromEntries(Object.entries(tableSchemas).map(([table, json]) => [table, idFields(json)]));
function valuesAt(value: any, path: string[]): unknown[] {
  if (!path.length) return [value];
  if (value === undefined || value === null) return [];
  const [head, ...rest] = path;
  if (head === "[]") return Array.isArray(value) ? value.flatMap((item) => valuesAt(item, rest)) : [];
  return valuesAt(value[head], rest);
}

function allRows(demo: CorporationDemo): Array<{ table: string; row: Record<string, any> }> {
  return [{ table: "societies", row: demo.society }, ...Object.entries(demo.tables).flatMap(([table, rows]) => rows.map((row) => ({ table, row })))];
}

/* ------------------------------------------------------------- references */

function checkReferences(demo: CorporationDemo, label: string) {
  const byId = new Map<string, string>();
  for (const { table, row } of allRows(demo)) {
    check(!byId.has(row._id), `${label}: duplicate id ${row._id}`);
    byId.set(row._id, table);
    if (table !== "societies") check(row.societyId === demo.societyId, `${label}: ${table}.${row._id} belongs to ${row.societyId}, not the workspace`);
    check(table in tableSchemas, `${label}: ${table} is not a table in the schema`);
  }
  const prefix = `${CORPORATION_DEMO_IDENTITIES[demo.key].idPrefix}_`;
  for (const { table, row } of allRows(demo)) {
    for (const ref of refsByTable[table] ?? []) {
      for (const value of valuesAt(row, ref.path)) {
        if (value === undefined || value === null) continue;
        check(byId.get(String(value)) === ref.table, `${label}: ${table}.${row._id}.${ref.path.join(".")} → ${String(value)} is not a ${ref.table} row`);
      }
    }
    // Ids kept in plain strings (holder keys, evidence refs, related ids) must resolve too.
    const scan = (value: unknown, where: string) => {
      if (typeof value === "string") {
        for (const match of value.matchAll(new RegExp(`${prefix}[a-z0-9_]+`, "g"))) check(byId.has(match[0]), `${label}: ${where} mentions ${match[0]}, which is not a row`);
      } else if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${where}[${index}]`));
      else if (value && typeof value === "object") for (const [field, item] of Object.entries(value)) scan(item, `${where}.${field}`);
    };
    for (const [field, value] of Object.entries(row)) if (field !== "_id") scan(value, `${table}.${row._id}.${field}`);
  }
  check(!JSON.stringify(demo).includes("undefined"), `${label}: a generated string contains "undefined"`);
  check(!/\bNaN\b/.test(JSON.stringify(demo)), `${label}: a generated value is NaN`);
}

/* ---------------------------------------------------------------- ledger */

function checkLedger(demo: CorporationDemo, label: string) {
  const org = demo.society;
  const classes = demo.tables.rightsClasses ?? [];
  const transfers = (demo.tables.rightsholdingTransfers ?? []) as any[];
  const holdings = demo.tables.rightsHoldings ?? [];
  check(classes.length >= 3, `${label}: at least three share classes`);
  check(transfers.length >= 5, `${label}: a ledger with several years of activity`);
  validateLedger([...transfers].sort((a, b) => String(a.transferDate).localeCompare(String(b.transferDate)) || (a.sequence ?? 0) - (b.sequence ?? 0)), { classes });
  validateAuthorizedMaximums(transfers, classes);
  for (const cls of classes) noProblems(shareClassRightsIssues(cls), `${label}: class ${cls.className} rights`);
  for (const transfer of transfers) {
    const others = transfers.filter((row) => row !== transfer);
    noProblems(ledgerPostingIssues(transfer, {
      isCorporation: true, isBcCompany: demo.key === "bc_company", transferConsentRequired: transferConsentRequired(org),
      rightsClass: classes.find((cls) => cls._id === transfer.rightsClassId), otherTransfers: others,
    }), `${label}: posting gate for ${transfer.transferType} on ${transfer.transferDate}`);
    if (transfer.directorConsentResolutionId) {
      const consent = demo.tables.writtenResolutions.find((row) => row._id === transfer.directorConsentResolutionId);
      check(consent?.body === "directors" && consent.recordDateISO <= transfer.transferDate, `${label}: transfer on ${transfer.transferDate} has the directors' consent before it`);
    }
  }
  // issued − redeemed − cancelled ± transfers (net zero) = outstanding, per class.
  const current = deriveCurrentHoldings(transfers);
  for (const cls of classes) {
    const posted = transfers.filter((row) => row.rightsClassId === cls._id && row.status === "posted");
    const issued = posted.filter((row) => row.transferType === "issuance").reduce((sum, row) => sum + row.quantity, 0);
    const removed = posted.filter((row) => ["redemption", "cancellation"].includes(row.transferType)).reduce((sum, row) => sum + row.quantity, 0);
    const outstanding = current.filter((row) => row.rightsClassId === cls._id).reduce((sum, row) => sum + row.quantity, 0);
    const stored = holdings.filter((row) => row.rightsClassId === cls._id).reduce((sum, row) => sum + row.quantity, 0);
    check(issued - removed === outstanding, `${label}: ${cls.className} issued ${issued} − redeemed ${removed} ≠ outstanding ${outstanding}`);
    check(stored === outstanding, `${label}: ${cls.className} rightsHoldings ${stored} ≠ ledger ${outstanding}`);
    check(outstanding > 0, `${label}: ${cls.className} has shares outstanding`);
    check((cls.highestAssignedNumber ?? 0) === (demo.tables.shareCertificates ?? []).filter((row) => row.rightsClassId === cls._id).length, `${label}: ${cls.className} highest certificate number matches the certificates issued`);
  }
  for (const holding of holdings) {
    const match = current.find((row) => row.rightsClassId === holding.rightsClassId && row.holderKey === holding.holderKey);
    check(match?.quantity === holding.quantity, `${label}: stored holding ${holding._id} matches the ledger`);
  }
  // Certificates match holdings at every ledger date and today.
  const certificates = demo.tables.shareCertificates ?? [];
  for (const certificate of certificates) {
    noProblems(validateCertificate(certificate as any).errors, `${label}: certificate ${certificate.certificateNumber}`);
    check(!duplicateCertificateNumber(certificates as any, certificate.certificateNumber, certificate._id), `${label}: certificate number ${certificate.certificateNumber} is unique`);
  }
  const dates = [...new Set([...transfers.map((row) => row.transferDate), demo.asOf])].sort();
  for (const date of dates) {
    const reconciliation = reconcileCertificatesWithLedger({
      certificates: certificates as any, holdings: holdingsAsOf(transfers, date), classes: classes as any, roleHolders: demo.tables.roleHolders as any, asOfISO: date,
    });
    noProblems(reconciliation.issues, `${label}: certificates vs ledger on ${date}`);
    noProblems(reconciliation.notes, `${label}: uncertificated holdings on ${date}`);
  }
}

/* ----------------------------------------------- transparency / ISC register */

function checkOwnershipRegister(demo: CorporationDemo, label: string, votingPower: { voting: any[]; nonVoting: any[] }) {
  const roleHolders = demo.tables.roleHolders ?? [];
  const holders = [...votingPower.voting, ...votingPower.nonVoting];
  const candidates = candidateSignificantIndividuals(holders, candidateFactsFromRegister(holders, roleHolders, looksLikeOrganization));
  const controllers = roleHolders.filter((row) => row.roleType === "controller" && row.status === "current");
  check(candidates.length >= 2, `${label}: the register has holders over the 25% threshold`);
  check(controllers.length >= 2, `${label}: the ownership register lists individuals`);
  const explained = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.action === "review") {
      check(candidate.recorded, `${label}: ${candidate.holderName} holds ${candidate.percentOfShares.toFixed(1)}% of shares / ${candidate.percentOfVotes.toFixed(1)}% of votes but is not on the register`);
      const controller = controllers.find((row) => row.fullName === candidate.holderName);
      if (controller) explained.add(controller._id);
    } else {
      const holderId = candidate.holderKey.replace(/^roleHolder:/, "");
      const lookThrough = controllers.filter((row) => (row.relatedShareholderIds ?? []).includes(holderId));
      check(lookThrough.length > 0, `${label}: ${candidate.holderName} (not an individual) has no individuals recorded behind it`);
      lookThrough.forEach((row) => explained.add(row._id));
      const holder = roleHolders.find((row) => row._id === holderId);
      check((holder?.controllingIndividualIds ?? []).length === lookThrough.length, `${label}: ${candidate.holderName} lists the individuals who control it`);
    }
  }
  for (const controller of controllers) {
    check(explained.has(controller._id), `${label}: ${controller.fullName} is on the register without meeting a 25% threshold directly or through a holder`);
    check((controller.significanceBases ?? []).length > 0 && String(controller.significanceReason ?? "").length > 20, `${label}: ${controller.fullName} has a recorded basis of significance`);
    check(Boolean(controller.startDate), `${label}: ${controller.fullName} has the date they became significant`);
  }
  const steps = demo.tables.significantIndividualSteps ?? [];
  for (const controller of controllers) {
    check(steps.some((step) => step.stepKind === "became_significant" && step.roleHolderId === controller._id && step.recordedOn && step.notifiedOn), `${label}: ${controller.fullName}'s entry is recorded and notified`);
  }
  check(steps.some((step) => step.stepKind === "annual_review"), `${label}: annual reviews of the register are recorded`);
  check(reviewsDue(steps as any, demo.asOf).length === 0, `${label}: no register review is overdue on the demo date`);
}

/* -------------------------------------------------------------- dividends */

function checkDividends(demo: CorporationDemo, label: string) {
  const transfers = demo.tables.rightsholdingTransfers as any[];
  const dividends = demo.tables.dividends ?? [];
  check(dividends.length >= 2, `${label}: dividend history`);
  const scope = demo.key === "bc_company" ? "bc_company" : "other_corporation";
  for (const dividend of dividends) {
    noProblems(dividendDeclarationProblems(dividend as any, scope), `${label}: dividend ${dividend._id}`);
    check(["declared", "paid"].includes(dividend.status), `${label}: dividend ${dividend._id} is declared or paid`);
    const recomputed = dividendEntitlements(holdingsAsOf(transfers, dividend.recordDate), dividend.rightsClassId, dividend.perShareAmount);
    check(recomputed.sharesOutstanding === dividend.sharesOutstanding, `${label}: dividend ${dividend._id} shares outstanding ${dividend.sharesOutstanding} ≠ ledger ${recomputed.sharesOutstanding}`);
    check(recomputed.totalCents === dividend.totalCents, `${label}: dividend ${dividend._id} total matches the per-share amount`);
    check(JSON.stringify(recomputed.entitlements.map((row) => [row.holderKey, row.shares, row.amountCents])) === JSON.stringify(dividend.entitlements.map((row: any) => [row.holderKey, row.shares, row.amountCents])), `${label}: dividend ${dividend._id} entitlements match the ledger`);
    const resolution = demo.tables.writtenResolutions.find((row) => row._id === dividend.declaredByResolutionId);
    check(resolution?.body === "directors" && resolution.recordDateISO === dividend.declaredOn, `${label}: dividend ${dividend._id} is declared by a directors' resolution of the same day`);
    check(dividend.solvencyConfirmedAt <= dividend.declaredOn, `${label}: dividend ${dividend._id} solvency confirmed on or before the declaration`);
    if (dividend.status === "paid") {
      const paid = (demo.tables.financialTransactions ?? []).filter((row) => row.category === "Dividends paid" && row.date === dividend.paymentDate && String(row.description).includes(dividend.shareClass));
      const inFeed = (demo.tables.financialTransactions ?? []).some((row) => row.date <= dividend.paymentDate) && dividend.paymentDate >= (demo.tables.financialTransactions ?? [])[0]?.date;
      if (inFeed) check(-paid.reduce((sum, row) => sum + row.amountCents, 0) === dividend.entitlements.reduce((sum: number, row: any) => sum + row.amountCents, 0), `${label}: dividend ${dividend._id} payments appear in the bank feed`);
    }
  }
}

/* ------------------------------------------------------------ resolutions */

function checkResolutions(demo: CorporationDemo, label: string) {
  const nowISO = `${demo.asOf}T12:00:00.000Z`;
  const rows = demo.tables.writtenResolutions ?? [];
  check(rows.length >= 8, `${label}: a minute book of signed resolutions`);
  for (const row of rows) {
    const view = writtenResolutionView(row, nowISO);
    check(view.status === "Carried" && view.establishedPassage, `${label}: "${row.title}" reads ${view.status}, not a verified Carried resolution`);
    const statutory = writtenResolutionRule(demo.society as any, row.kind, row.body);
    const unanimous = row.approvalRule.numerator === row.approvalRule.denominator;
    check(Boolean(statutory) && (unanimous || (row.approvalRule.numerator === statutory!.numerator && row.approvalRule.denominator === statutory!.denominator && row.approvalRule.unit === statutory!.unit)),
      `${label}: "${row.title}" uses the profile's threshold or a stricter unanimous one`);
    check(row.circulatedAtISO.slice(0, 10) <= demo.asOf, `${label}: "${row.title}" is not dated in the future`);
  }
  const annual = rows.filter((row) => /^Annual resolutions of the shareholders/.test(row.title));
  check(annual.length >= 3, `${label}: several years of annual resolutions in place of meetings`);
  for (const row of annual) {
    const holders = new Set((demo.tables.roleHolders ?? []).filter((holder) => holder.roleType === "shareholder").map((holder) => holder._id));
    const transfers = demo.tables.rightsholdingTransfers as any[];
    const onDate = new Set(holdingsAsOf(transfers, row.recordDateISO).map((holding) => holding.holderKey.replace(/^roleHolder:/, "")));
    check([...onDate].every((holder) => holders.has(holder) && row.electorate.some((elector: any) => elector.roleHolderId === holder)),
      `${label}: "${row.title}" is signed by every shareholder, including non-voting holders (auditor waiver)`);
  }
  for (const completion of demo.society.annualMeetingCompletions ?? []) {
    check(rows.some((row) => row._id === completion.evidenceRef && row.completedAtISO.slice(0, 10) === completion.date), `${label}: annual completion ${completion.cycleYear} points at its signed resolution`);
  }
}

/* -------------------------------------------------------------- directors */

function checkDirectors(demo: CorporationDemo, label: string) {
  const org = demo.society;
  const profile = legalGovernanceProfile(org as any);
  check(profile?.id === demo.key, `${label}: the workspace resolves to the ${demo.key} legal profile (got ${profile?.id})`);
  const active = (demo.tables.directors ?? []).filter((row) => row.status === "Active");
  check(active.length >= (minimumLegalDirectors(org as any) ?? 1), `${label}: at least the minimum number of directors`);
  if (profile?.directors.residency === "canadian_25_percent") {
    const residents = active.filter((row) => row.residentCanadianStatus === "yes").length;
    check(residents >= requiredResidentCanadianDirectors(active.length), `${label}: ${residents} of ${active.length} directors are resident Canadians; ${requiredResidentCanadianDirectors(active.length)} required`);
    check(active.some((row) => row.residentCanadianStatus === "no"), `${label}: the CBCA board shows the residency rule with a non-resident director`);
  }
  for (const row of demo.tables.directors ?? []) noProblems(directorProblems(row as any), `${label}: director ${row.firstName} ${row.lastName}`);
  const scope = eligibilityScopeFor(org as any);
  for (const holder of (demo.tables.roleHolders ?? []).filter((row) => ["director", "officer"].includes(row.roleType) && row.status === "current")) {
    const result = roleHolderEligibility(holder as any, scope, demo.asOf);
    noProblems([...result.blocking, ...result.warnings], `${label}: eligibility of ${holder.fullName} (${holder.roleType})`);
  }
  noProblems(sharedOfficeWarnings((demo.tables.roleHolders ?? []).filter((row) => row.roleType === "officer" && row.status === "current") as any), `${label}: officer offices`);
  const roleDirectors = (demo.tables.roleHolders ?? []).filter((row) => row.roleType === "director" && row.status === "current");
  check(roleDirectors.length === active.length && roleDirectors.every((row) => active.some((director) => director.directoryPersonId === row.directoryPersonId)),
    `${label}: the directors register and the director role holders agree (same directory people)`);
}

/* ------------------------------------------------------------ obligations */

function checkObligations(demo: CorporationDemo, label: string) {
  const org = demo.society;
  const filings = demo.tables.filings ?? [];
  const settings = annualGovernanceSettings(org as any, [], filings, demo.asOf);
  const derived = deriveComplianceDeadlines({ ...settings, transparencyEvents: transparencyEventsFromSteps(demo.tables.significantIndividualSteps ?? []) }, demo.asOf);
  const keys = derived.map((row) => row.key);
  check(keys.includes("agm") && keys.includes("annual-report") && keys.includes("fiscal-year-end"), `${label}: annual meeting, annual filing and year-end deadlines are derived (got ${keys.join(", ")})`);
  if (demo.key === "bc_company") check(keys.includes("transparency-review"), `${label}: the transparency register review is derived`);
  for (const row of derived) {
    check(row.dueDate >= demo.asOf, `${label}: derived "${row.title}" is due ${row.dueDate}, before the demo date ${demo.asOf}`);
    check(["upcoming", "due", undefined].includes(row.status as any), `${label}: derived "${row.title}" is ${row.status}`);
  }
  noProblems(deriveComplianceHistoryNotices(settings, demo.asOf).map((notice) => `${notice.title}: ${notice.cycleYears.join(", ")}`), `${label}: annual history is fully evidenced`);
  const deadlines = demo.tables.deadlines ?? [];
  check(deadlines.length >= 4, `${label}: deadlines for the coming year`);
  for (const row of deadlines) check(row.dueDate >= demo.asOf && row.dueDate <= `${Number(demo.asOf.slice(0, 4)) + 2}${demo.asOf.slice(4)}`, `${label}: deadline "${row.title}" (${row.dueDate}) is in the coming months`);
  for (const row of derived) check(deadlines.some((deadline) => deadline.title === row.title && deadline.dueDate === row.dueDate), `${label}: derived "${row.title}" is in the deadline register`);
  const facts = complianceFactsForOrganization(org, { asOfDate: demo.asOf, registrations: demo.tables.organizationRegistrations as any });
  const obligations = facts.flatMap((fact) => computeComplianceObligations(fact));
  check(obligations.length > 0, `${label}: the compliance engine produces obligations`);
  // Annual business done by written resolution counts as the last annual
  // meeting, so the Obligations page never asks for a date it already has.
  const lastAnnual = (org.annualMeetingCompletions ?? []).map((row: any) => row.annualReferenceDate ?? row.date).filter((date: string) => date <= demo.asOf).sort().at(-1);
  check(Boolean(facts[0]?.annualReferenceDate) && facts[0]?.annualReferenceDate === lastAnnual, `${label}: the last written annual business (${lastAnnual}) is the annual reference date (${facts[0]?.annualReferenceDate})`);
  check(obligations.every((row: any) => !row.dueDate || typeof row.dueDate === "string"), `${label}: obligations carry dates`);
  // The Obligations page: every past date is filed, reviewed or dismissed with
  // a reason, and every open filing obligation has its filing in the register.
  const remediations = demo.tables.complianceRemediations ?? [];
  for (const obligation of obligations as any[]) {
    const filing = obligation.creates?.filingKind ? filings.find((row) => row.kind === obligation.creates.filingKind && row.dueDate === obligation.dueDate) : undefined;
    const decision = remediations.find((row) => row.ruleId === obligation.occurrenceKey);
    if (obligation.dueDate < demo.asOf) {
      check(filing?.status === "Filed" || (decision && ["resolved", "dismissed"].includes(decision.status) && String(decision.notes ?? "").length > 20),
        `${label}: past obligation "${obligation.title}" (${obligation.dueDate}) has no filing, review or reasoned dismissal`);
      if (decision?.status === "resolved" && obligation.creates?.filingKind) failures.push(`${label}: "${obligation.title}" (${obligation.dueDate}) needs a filing or a dismissal; a review does not close a filing obligation on the page`);
    } else if (obligation.creates?.filingKind && !decision) {
      check(Boolean(filing), `${label}: open filing obligation "${obligation.title}" (${obligation.dueDate}) has its filing in the register`);
    }
  }
  const tasks = demo.tables.tasks ?? [];
  check(tasks.some((task) => task.status !== "Done" && task.dueDate >= demo.asOf), `${label}: open tasks ahead of the demo date`);
}

/* -------------------------------------- schema: rows insert into Convex */

async function checkSchema(demo: CorporationDemo, label: string) {
  const t = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
  });
  const counts = await t.run(async (ctx: any) => {
    const { societyId, ids } = await insertCorporationDemo({ insert: (table, doc) => ctx.db.insert(table, doc), patch: (id, doc) => ctx.db.patch(id, doc) }, demo);
    const society = await ctx.db.get(societyId);
    const result: Record<string, number> = { societies: society ? 1 : 0, mapped: ids.size };
    for (const table of CORPORATION_DEMO_TABLE_ORDER) result[table] = (await ctx.db.query(table).collect()).length;
    result.primaryRegistrationResolves = society?.primaryRegistrationId && (await ctx.db.get(society.primaryRegistrationId)) ? 1 : 0;
    return result;
  });
  for (const table of CORPORATION_DEMO_TABLE_ORDER) check(counts[table] === (demo.tables[table]?.length ?? 0), `${label}: ${table} inserted ${counts[table]} of ${demo.tables[table]?.length ?? 0} rows into the Convex schema`);
  check(counts.primaryRegistrationResolves === 1, `${label}: the society's patched references resolve after insert`);
}

/* ------------------------------ the portable queries behind each page */

async function checkPortableQueries(demo: CorporationDemo, label: string) {
  const seed: Record<string, any[]> = corporationDemoLocalSeed(demo);
  const owner = seed.users.find((user) => user._id === demo.ownerUserId)!;
  const db = new MemoryDb({ seed });
  const ctx: any = {
    db,
    principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `local:${owner._id}`, userId: owner._id, societyId: demo.societyId },
    capabilities: makeCapabilities({}),
    runQuery: async () => { throw new Error("nested"); },
  };
  const societyId = demo.societyId;
  const ledger = await roleHolderFns.rightsLedgerPortable(ctx, { societyId });
  check(ledger.classes.length >= 3 && ledger.holdings.length >= 4 && ledger.transfers.length >= 5, `${label}: Share register query has classes, holdings and transfers`);
  const voting = await votingPowerFns.votingPowerPortable(ctx, { societyId, asOf: demo.asOf }) as any;
  check(voting.voting.length >= 2, `${label}: voting power lists the voting holders`);
  checkOwnershipRegister(demo, label, voting);
  const reconcile = await certificateFns.reconcilePortable(ctx, { societyId, asOf: demo.asOf }) as any;
  check(reconcile.balanced === true, `${label}: certificate register reconciles in the app query`);
  const certificates = await certificateFns.listPortable(ctx, { societyId }) as any[];
  check(certificates.length >= 5, `${label}: certificate register lists certificates`);
  const dividends = await dividendFns.listPortable(ctx, { societyId }) as any[];
  check(dividends.length >= 2, `${label}: dividends page lists declarations`);
  const dividendSummary = await dividendFns.summaryPortable(ctx, { societyId }) as any;
  check(Boolean(dividendSummary), `${label}: dividend summary answers`);
  const steps = await stepFns.listPortable(ctx, { societyId }) as any[];
  check(steps.length >= 3, `${label}: register diligence steps are listed`);
  if (demo.key === "bc_company") {
    const transparency = await stepFns.transparencyDeadlinesPortable(ctx, { societyId, asOf: demo.asOf }) as any[];
    check(transparency.length >= 2 && transparency.every((row) => row.status !== "overdue"), `${label}: transparency deadlines are open and none overdue`);
  }
  const resolutions = await resolutionFns.listPortable(ctx, { societyId }) as any[];
  check(resolutions.length >= 8 && resolutions.every((row) => row.status === "Carried"), `${label}: Written resolutions page shows every resolution Carried (${resolutions.filter((row) => row.status !== "Carried").map((row) => `${row.title}: ${row.status}`).join("; ")})`);
  const deadlines = await settingsFns.complianceDeadlinesPortable(ctx, { societyId, fromISO: demo.asOf }) as any[];
  check(deadlines.length >= 3 && deadlines.every((row) => row.status !== "overdue" && row.status !== "review_required"), `${label}: compliance settings deadlines are open and reviewed (${deadlines.map((row) => `${row.key}:${row.status}`).join(", ")})`);
  const minuteBook = await minuteBookFns.overviewPortable(ctx, { societyId }) as any;
  check(Boolean(minuteBook), `${label}: minute book overview answers`);
  const dashboard = await dashboardFns.summaryPortable(ctx, { societyId }) as any;
  check(dashboard.counts.directors >= 2, `${label}: dashboard counts the directors`);
  check(dashboard.counts.overdueFilings === 0, `${label}: dashboard shows no overdue filings`);
  const annualFilings = await annualFilingFns.listPortable(ctx, { societyId }) as any[];
  check(annualFilings.length >= 3, `${label}: annual filings ledger lists the filing history`);
}

/* ------------------------------------------------------------------- run */

const summary: string[] = [];
for (const key of CORPORATION_DEMO_KEYS) {
  // Personas in the banner match the generated workspace.
  const persona = DEMO_PERSONAS.find((row) => row.key === key)!;
  const identity = CORPORATION_DEMO_IDENTITIES[key];
  check(persona.sample.name === identity.name && persona.sample.incorporationNumber === identity.incorporationNumber && persona.sample.incorporationDate === identity.incorporationDate && persona.sample.fiscalYearEnd === identity.fiscalYearEnd,
    `${key}: the demo banner persona matches the generated workspace identity`);
  const createValues = demoPersonaWorkspaceValues(persona);
  check(personaForOrganization(createValues as any) === key, `${key}: a workspace created from the persona is recognised as that persona`);

  for (const asOf of AS_OF_DATES) {
    const label = `${key} @ ${asOf}`;
    const demo = buildCorporationDemo(key, { asOf });
    check(personaForOrganization(demo.society as any) === key, `${label}: the seeded workspace is recognised as the ${key} persona`);
    check(demo.societyId === corporationDemoSocietyId(key), `${label}: the society id is the persona's fixed id`);
    check(JSON.stringify(buildCorporationDemo(key, { asOf })) === JSON.stringify(demo), `${label}: building twice gives the same rows`);
    checkReferences(demo, label);
    checkLedger(demo, label);
    checkDividends(demo, label);
    checkResolutions(demo, label);
    checkDirectors(demo, label);
    checkObligations(demo, label);
    if (asOf === liveAsOf || asOf === AS_OF_DATES[0]) await checkSchema(demo, label);
    // Pages read with the real clock, so only the live demo date runs them.
    if (asOf === liveAsOf) {
      await checkPortableQueries(demo, label);
      const rows = Object.values(demo.tables).reduce((sum, list) => sum + list.length, 0);
      summary.push(`${identity.name}: ${rows} rows — ${demo.tables.rightsClasses.length} classes, ${demo.tables.rightsholdingTransfers.length} ledger entries, ${demo.tables.shareCertificates.length} certificates, ${demo.tables.writtenResolutions.length} resolutions, ${demo.tables.dividends.length} dividends, ${demo.tables.filings.length} filings, ${demo.tables.deadlines.length} deadlines`);
    }
  }
}

// The in-browser demo store: the persona switch seeds each workspace once,
// switching back and forth never duplicates it, and Reseed / Wipe (both reset
// the store to the bundled seed) drop it until it is opened again.
{
  const client = new StaticConvexClient({ databaseName: `societyer-corporation-demo-${process.pid}` });
  await client.whenLocalWorkspaceReady();
  const societyCount = async () => ((await client.query("society:list", {})) as any[]).length;
  const base = await societyCount();
  check(base >= 1, "demo store: the bundled demo has its society");
  for (const key of CORPORATION_DEMO_KEYS) {
    const demo = buildCorporationDemo(key);
    const first = await client.seedDemoWorkspace(demo.societyId, corporationDemoLocalSeed(demo));
    const again = await client.seedDemoWorkspace(demo.societyId, corporationDemoLocalSeed(demo));
    check(first.created && !again.created, `demo store: ${key} is seeded once and reused`);
    const ledger = await client.query("legalOperations:rightsLedger", { societyId: demo.societyId }) as any;
    check(ledger.holdings.length === demo.tables.rightsHoldings.length, `demo store: ${key} share register reads its holdings`);
    const resolutions = await client.query("writtenResolutions:list", { societyId: demo.societyId }) as any[];
    check(resolutions.length === demo.tables.writtenResolutions.length && resolutions.every((row) => row.status === "Carried"), `demo store: ${key} resolutions read as Carried`);
    const engine = await client.query("legalOperations:templateEngine", { societyId: demo.societyId }) as any;
    check(engine.templates.length > 0, `demo store: ${key} has its document packet catalog`);
  }
  check(await societyCount() === base + CORPORATION_DEMO_KEYS.length, "demo store: one workspace per persona after repeated switches");
  await client.reseedStaticDemo();
  check(await societyCount() === base, "demo store: Reseed and Wipe reset the store and drop the demo companies");
  const reopened = await client.seedDemoWorkspace(corporationDemoSocietyId("bc_company"), corporationDemoLocalSeed(buildCorporationDemo("bc_company")));
  check(reopened.created && await societyCount() === base + 1, "demo store: a demo company opens again after a reseed");
  await client.close();
}

// The checks above must catch broken data: each deliberate fault below has to
// fail at least one check (the failures are then discarded).
async function expectCaught(name: string, mutate: (demo: CorporationDemo) => void, run: (demo: CorporationDemo, label: string) => void | Promise<void>) {
  const demo = JSON.parse(JSON.stringify(buildCorporationDemo("bc_company", { asOf: liveAsOf }))) as CorporationDemo;
  mutate(demo);
  const before = failures.length;
  try {
    await run(demo, `fault "${name}"`);
  } catch {
    failures.push("thrown");
  }
  const caught = failures.length > before;
  failures.length = before;
  check(caught, `self-test: the gate did not catch the fault "${name}"`);
}
await expectCaught("holding off by one share", (demo) => { demo.tables.rightsHoldings[0].quantity += 1; }, checkLedger);
await expectCaught("missing certificate", (demo) => { demo.tables.shareCertificates.splice(demo.tables.shareCertificates.findIndex((row) => !row.cancelledOn), 1); }, checkLedger);
await expectCaught("transfer without directors' consent", (demo) => { delete demo.tables.rightsholdingTransfers.find((row) => row.transferType === "transfer")!.directorConsentResolutionId; }, checkLedger);
await expectCaught("dangling class reference", (demo) => { demo.tables.rightsholdingTransfers[0].rightsClassId = `${CORPORATION_DEMO_IDENTITIES.bc_company.idPrefix}_class_missing`; }, checkReferences);
await expectCaught("dividend without solvency basis", (demo) => { demo.tables.dividends[0].solvencyBasis = ""; }, checkDividends);
await expectCaught("dividend on the wrong share count", (demo) => { demo.tables.dividends[0].sharesOutstanding += 10; }, checkDividends);
await expectCaught("controller missing from the register", (demo) => {
  demo.tables.roleHolders = demo.tables.roleHolders.filter((row) => !(row.roleType === "controller" && row.fullName === "Daniel Okafor"));
}, async (demo, label) => checkPortableQueries(demo, label));
await expectCaught("unsigned resolution", (demo) => { demo.tables.writtenResolutions[0].signatures.pop(); }, checkResolutions);
await expectCaught("latest filed annual report removed", (demo) => {
  const filed = demo.tables.filings.filter((row) => row.status === "Filed" && /AnnualReport|AnnualReturn/.test(row.kind));
  demo.tables.filings = demo.tables.filings.filter((row) => row !== filed.at(-1));
}, checkObligations);
await expectCaught("no resident Canadian on a CBCA board", (demo) => {
  const cbca = JSON.parse(JSON.stringify(buildCorporationDemo("federal_cbca", { asOf: liveAsOf }))) as CorporationDemo;
  for (const row of cbca.tables.directors) row.residentCanadianStatus = "no";
  Object.assign(demo, cbca);
}, checkDirectors);

// Nothing in the generator reads the clock or the random generator at runtime.
for (const file of ["shared/demoData/corporations.ts", "shared/demoData/corporationStories.ts", "shared/demoData/corporationIdentities.ts"]) {
  const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(!/Math\.random|new Date\(\)|Date\.now\(\)/.test(source), `${file}: no Math.random, new Date() or Date.now() in the generator`);
}

if (failures.length) {
  console.error(`Corporation demo gate: ${failures.length} of ${checks} checks failed:\n  - ${[...new Set(failures)].slice(0, 80).join("\n  - ")}`);
  process.exit(1);
}
console.log(`Corporation demo gate: ${checks} checks passed for ${CORPORATION_DEMO_KEYS.length} workspaces at ${AS_OF_DATES.length} demo dates (${AS_OF_DATES.join(", ")}).\n  ${summary.join("\n  ")}`);
assert.ok(true);
