/**
 * Demo workload for the demo society: tasks, deadlines, documents and budget
 * lines, sized so every status, priority, due-date bucket, owner scope and
 * document section in the app has something in it.
 *
 * Dates are offsets from the demo's "today" (see `demoAsOfDate`), so overdue
 * work is always overdue and next week's work is always next week. Owners are
 * roles ("owner", "treasurer", "secretary"); each runtime maps them to its own
 * users and people. Pure data, no runtime imports.
 */

import { addDays } from "./prng";

export type DemoOwnerRole = "owner" | "treasurer" | "secretary";

export type DemoTaskSeed = {
  key: string;
  title: string;
  description?: string;
  status: "Todo" | "InProgress" | "Blocked" | "Done" | "Cancelled";
  priority: "Low" | "Medium" | "High" | "Urgent";
  /** Responsible user (drives "Mine"); null leaves the task unowned. */
  owner: DemoOwnerRole | null;
  /** Free-text assignee when the work sits with a volunteer or committee. */
  assignee?: string;
  /** Days from today; undefined = no due date. */
  dueInDays?: number;
  /** Days ago the task was created. */
  createdDaysAgo: number;
  /** Days ago it was completed (Done/Cancelled only). */
  completedDaysAgo?: number;
  committee?: "programs" | "finance" | "governance";
  tags: string[];
  checklist?: Array<{ title: string; done: boolean }>;
};

export const DEMO_TASKS: DemoTaskSeed[] = [
  { key: "reconcile-operating", title: "Reconcile operating chequing for last month", status: "InProgress", priority: "High", owner: "treasurer", dueInDays: 2, createdDaysAgo: 9, committee: "finance", tags: ["finance", "month-end"], checklist: [{ title: "Match card payment", done: true }, { title: "Clear uncategorised e-transfers", done: false }, { title: "Attach statement PDF", done: false }] },
  { key: "missing-receipts", title: "Chase missing card receipts", description: "Several recent Visa purchases have no receipt attached. Ask program leads to upload them.", status: "Todo", priority: "Medium", owner: "treasurer", dueInDays: 5, createdDaysAgo: 4, committee: "finance", tags: ["finance", "receipts"] },
  { key: "categorise-feed", title: "Categorise this week's bank feed", status: "Todo", priority: "Medium", owner: "treasurer", dueInDays: 0, createdDaysAgo: 2, tags: ["finance"] },
  { key: "gala-sponsors", title: "Confirm fall gala sponsors and table hosts", status: "InProgress", priority: "High", owner: "owner", dueInDays: 9, createdDaysAgo: 30, committee: "programs", tags: ["fundraising", "gala"], checklist: [{ title: "Presenting sponsor", done: true }, { title: "Table sponsor", done: true }, { title: "Silent auction donors", done: false }] },
  { key: "gala-volunteers", title: "Recruit 12 gala night volunteers", status: "Todo", priority: "Medium", owner: null, assignee: "Volunteer coordinator", dueInDays: 16, createdDaysAgo: 21, committee: "programs", tags: ["volunteers", "gala"] },
  { key: "renewal-reminders", title: "Send renewal reminders to past-due members", description: "Members who have not renewed for the current membership year get a reminder and a payment link.", status: "Todo", priority: "High", owner: "secretary", dueInDays: -6, createdDaysAgo: 25, committee: "governance", tags: ["membership", "renewals"] },
  { key: "grant-report", title: "Draft Harbour Foundation interim report", status: "InProgress", priority: "Urgent", owner: "owner", dueInDays: -2, createdDaysAgo: 18, committee: "programs", tags: ["grants", "reporting"] },
  { key: "t4-prep", title: "Collect employee addresses for T4 slips", status: "Todo", priority: "Low", owner: "treasurer", dueInDays: 75, createdDaysAgo: 3, tags: ["payroll"] },
  { key: "insurance-review", title: "Review insurance coverage before renewal", status: "Blocked", priority: "Medium", owner: "treasurer", assignee: "Insurance broker", dueInDays: 24, createdDaysAgo: 40, committee: "finance", tags: ["insurance"], description: "Waiting on the broker's updated quote for the liability and D&O package." },
  { key: "fridge-schedule", title: "Publish winter community fridge schedule", status: "Todo", priority: "Low", owner: null, dueInDays: 12, createdDaysAgo: 6, committee: "programs", tags: ["programs", "food-security"] },
  { key: "hall-accessibility", title: "Get quotes for an accessible hall entrance ramp", status: "Blocked", priority: "High", owner: "owner", dueInDays: -12, createdDaysAgo: 60, tags: ["facility", "accessibility"], description: "Blocked until the landlord confirms who pays for the work." },
  { key: "newsletter", title: "Write the quarterly member newsletter", status: "InProgress", priority: "Low", owner: "secretary", dueInDays: 6, createdDaysAgo: 14, tags: ["communications"] },
  { key: "board-orientation", title: "Run orientation for new directors", status: "Todo", priority: "Medium", owner: "secretary", dueInDays: 33, createdDaysAgo: 10, committee: "governance", tags: ["board"] },
  { key: "budget-draft", title: "Draft next fiscal year operating budget", status: "Todo", priority: "High", owner: "treasurer", dueInDays: 48, createdDaysAgo: 5, committee: "finance", tags: ["budget"] },
  { key: "privacy-training", title: "Book annual privacy training for staff", status: "Todo", priority: "Medium", owner: null, dueInDays: 3, createdDaysAgo: 12, tags: ["privacy"] },
  { key: "volunteer-checks", title: "Renew criminal record checks for youth mentors", status: "InProgress", priority: "Urgent", owner: "owner", dueInDays: 1, createdDaysAgo: 20, committee: "programs", tags: ["volunteers", "youth"] },
  { key: "donor-thanks", title: "Send thank-you notes for September gifts", status: "Done", priority: "Medium", owner: "owner", dueInDays: -20, createdDaysAgo: 35, completedDaysAgo: 22, tags: ["fundraising"] },
  { key: "plant-sale-wrap", title: "Close out spring plant sale float", status: "Done", priority: "Low", owner: "treasurer", dueInDays: -140, createdDaysAgo: 160, completedDaysAgo: 150, tags: ["fundraising"] },
  { key: "q1-remittance", title: "Confirm CRA remittance schedule with payroll provider", status: "Done", priority: "High", owner: "treasurer", dueInDays: -45, createdDaysAgo: 70, completedDaysAgo: 50, committee: "finance", tags: ["payroll"] },
  { key: "website-bylaws", title: "Post current bylaws on the website", status: "Done", priority: "Low", owner: "secretary", dueInDays: -90, createdDaysAgo: 120, completedDaysAgo: 95, tags: ["governance"] },
  { key: "storage-cleanup", title: "Clear out the storage room before winter", status: "Cancelled", priority: "Low", owner: null, dueInDays: -30, createdDaysAgo: 80, completedDaysAgo: 28, tags: ["facility"] },
  { key: "member-survey", title: "Analyse member survey results", status: "Todo", priority: "Medium", owner: "owner", createdDaysAgo: 8, committee: "governance", tags: ["membership"] },
  { key: "card-policy", title: "Update the organization card spending policy", status: "Todo", priority: "Low", owner: "treasurer", createdDaysAgo: 15, committee: "finance", tags: ["finance", "policy"] },
];

export type DemoDeadlineSeed = {
  key: string;
  title: string;
  description?: string;
  category: string;
  dueInDays: number;
  done: boolean;
  recurrence?: "Monthly" | "Quarterly" | "Annual" | "None";
};

export const DEMO_DEADLINES: DemoDeadlineSeed[] = [
  { key: "remit-source-deductions", title: "Remit payroll source deductions", description: "Due the 15th of the month after pay day.", category: "Payroll", dueInDays: 1, done: false, recurrence: "Monthly" },
  { key: "remit-prior", title: "Remit payroll source deductions (last month)", category: "Payroll", dueInDays: -29, done: true, recurrence: "Monthly" },
  { key: "gst-rebate", title: "File public service bodies' rebate claim", category: "Tax", dueInDays: 38, done: false, recurrence: "Annual" },
  { key: "grant-interim", title: "Harbour Foundation interim report", category: "Other", dueInDays: -2, done: false, recurrence: "None" },
  { key: "eastside-report", title: "Eastside Community Fund program report", category: "Other", dueInDays: 52, done: false, recurrence: "Annual" },
  { key: "insurance-renewal", title: "Insurance renewal decision", category: "Other", dueInDays: 47, done: false, recurrence: "Annual" },
  { key: "worksafe", title: "Report payroll to WorkSafeBC", category: "Payroll", dueInDays: 98, done: false, recurrence: "Annual" },
  { key: "month-end-close", title: "Close the books for last month", category: "Other", dueInDays: 4, done: false, recurrence: "Monthly" },
  { key: "card-statement", title: "Reconcile the organization Visa statement", category: "Other", dueInDays: 8, done: false, recurrence: "Monthly" },
  { key: "renewal-season-close", title: "Close membership renewal season", category: "Governance", dueInDays: -130, done: true, recurrence: "Annual" },
];

export type DemoDocumentSeed = {
  key: string;
  title: string;
  category: string;
  librarySection: "governance" | "policy" | "meeting_material" | "finance" | "other";
  fileName: string;
  createdDaysAgo: number;
  retentionYears: number;
  reviewStatus?: "needs_review" | "in_review" | "needs_signature" | "approved";
  tags: string[];
};

export const DEMO_DOCUMENTS: DemoDocumentSeed[] = [
  { key: "bank-statement-latest", title: "Operating chequing statement (last month)", category: "FinancialStatement", librarySection: "finance", fileName: "operating-statement-latest.pdf", createdDaysAgo: 12, retentionYears: 7, reviewStatus: "needs_review", tags: ["finance", "bank statement"] },
  { key: "visa-statement-latest", title: "Organization Visa statement (last month)", category: "FinancialStatement", librarySection: "finance", fileName: "visa-statement-latest.pdf", createdDaysAgo: 10, retentionYears: 7, reviewStatus: "in_review", tags: ["finance", "card"] },
  { key: "budget-current", title: "Operating budget, current fiscal year", category: "FinancialStatement", librarySection: "finance", fileName: "operating-budget-current-fy.xlsx", createdDaysAgo: 200, retentionYears: 7, reviewStatus: "approved", tags: ["finance", "budget"] },
  { key: "gala-sponsorship", title: "Fall gala sponsorship agreement", category: "Agreement", librarySection: "other", fileName: "gala-sponsorship-agreement.pdf", createdDaysAgo: 34, retentionYears: 7, reviewStatus: "needs_signature", tags: ["fundraising", "gala"] },
  { key: "harbour-grant-letter", title: "Harbour Foundation grant agreement", category: "Grant", librarySection: "finance", fileName: "harbour-foundation-grant-agreement.pdf", createdDaysAgo: 240, retentionYears: 10, reviewStatus: "approved", tags: ["grants", "restricted"] },
  { key: "eastside-grant-letter", title: "Eastside Community Fund award letter", category: "Grant", librarySection: "finance", fileName: "eastside-community-fund-award.pdf", createdDaysAgo: 130, retentionYears: 10, tags: ["grants", "food security"] },
  { key: "card-policy", title: "Organization card spending policy", category: "Policy", librarySection: "policy", fileName: "card-spending-policy.pdf", createdDaysAgo: 300, retentionYears: 7, reviewStatus: "needs_review", tags: ["finance", "policy"] },
  { key: "volunteer-policy", title: "Volunteer screening policy", category: "Policy", librarySection: "policy", fileName: "volunteer-screening-policy.pdf", createdDaysAgo: 410, retentionYears: 7, reviewStatus: "approved", tags: ["volunteers", "policy"] },
  { key: "expense-policy", title: "Expense reimbursement policy", category: "Policy", librarySection: "policy", fileName: "expense-reimbursement-policy.pdf", createdDaysAgo: 520, retentionYears: 7, tags: ["finance", "policy"] },
  { key: "board-packet", title: "Board packet, last meeting", category: "Minutes", librarySection: "meeting_material", fileName: "board-packet-last-meeting.pdf", createdDaysAgo: 26, retentionYears: 10, tags: ["board", "meeting"] },
  { key: "treasurer-report", title: "Treasurer's report, last quarter", category: "FinancialStatement", librarySection: "meeting_material", fileName: "treasurers-report-last-quarter.pdf", createdDaysAgo: 27, retentionYears: 10, reviewStatus: "approved", tags: ["finance", "board"] },
  { key: "insurance-certificate", title: "Certificate of insurance, community hall", category: "Insurance", librarySection: "other", fileName: "certificate-of-insurance-hall.pdf", createdDaysAgo: 190, retentionYears: 7, tags: ["insurance", "facility"] },
  { key: "director-register", title: "Register of directors (export)", category: "Filing", librarySection: "governance", fileName: "register-of-directors.pdf", createdDaysAgo: 60, retentionYears: 99, reviewStatus: "approved", tags: ["governance", "directors"] },
  { key: "member-register", title: "Register of members (export)", category: "Filing", librarySection: "governance", fileName: "register-of-members.csv", createdDaysAgo: 45, retentionYears: 99, tags: ["governance", "membership"] },
  { key: "plant-sale-receipts", title: "Plant sale receipts bundle", category: "Receipt", librarySection: "finance", fileName: "plant-sale-receipts.pdf", createdDaysAgo: 150, retentionYears: 7, tags: ["fundraising", "receipts"] },
];

/** Budget plan per category: [category, prior-year planned, current-year planned, notes]. */
export const DEMO_BUDGET_PLAN: Array<[string, number, number, string?]> = [
  ["Donations", 5800000, 6000000, "Online giving, cheques and the annual operating gift."],
  ["Program fees", 4000000, 4400000, "Registration payouts across fall, winter and spring terms."],
  ["Grant revenue", 5300000, 5000000, "Restricted: Harbour Foundation and Eastside Community Fund."],
  ["Fundraising", 2600000, 2600000, "Fall gala and spring plant sale."],
  ["Membership fees", 150000, 90000],
  ["Wages & benefits", 7600000, 7500000, "Net pay plus CRA source-deduction remittances."],
  ["Program delivery", 4200000, 4000000, "Restricted fund spending."],
  ["Facilities", 2300000, 2500000, "Hall rent, hydro and gas."],
  ["Professional fees", 850000, 950000, "Bookkeeping and the annual review engagement."],
  ["Fundraising costs", 900000, 950000],
  ["Insurance", 500000, 520000],
  ["Program supplies", 360000, 320000],
  ["Office & technology", 260000, 240000],
  ["Bank & processing fees", 220000, 240000],
  ["Advertising", 160000, 60000],
  ["Travel", 60000, 15000],
];

/** Fiscal-year label as the Treasurer page writes it: the year the fiscal year ends. */
export function fiscalYearEndLabel(asOf: string, fiscalYearEnd = "03-31") {
  const year = Number(asOf.slice(0, 4));
  return asOf.slice(5) > fiscalYearEnd ? String(year + 1) : String(year);
}

export function offsetDate(asOf: string, days: number) {
  return addDays(asOf, days);
}
