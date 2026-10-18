/**
 * The hosted procurement reader's record and review models
 * (src/features/procurementReview/lib/notice.ts, review.ts): source date
 * formats, deadlines judged in the source zone, BC Bid's repeated page fields
 * dropped, and published review rows read into a decision, suggestion and
 * requirements.
 */
import assert from "node:assert/strict";
import { deadlineOf, describeNotice, parseSourceDate, sortableDate, statusOf } from "../src/features/procurementReview/lib/notice";
import { describeReview } from "../src/features/procurementReview/lib/review";

// Noon UTC on October 18, 2026 is 5 AM in Vancouver.
const now = Date.parse("2026-10-18T12:00:00Z");

const dates: [string, string][] = [
  ["2026-10-30", "2026-10-30"],
  ["2026-10-30 2:00:00 PM (Pacific)", "2026-10-30T14:00"],
  ["2026-10-21T21:00:00Z", "2026-10-21T14:00"],
  ["2026-11-06T15:00:00-08:00", "2026-11-06T15:00"],
  ["Wed Oct 7, 2026 3:00 PM (PDT)", "2026-10-07T15:00"],
  ["Tue Oct 27, 2026 4:00:59 PM (PDT)", "2026-10-27T16:00"],
  ["October 24, 2026 at 2:00 PM", "2026-10-24T14:00"],
  ["10/05/26 2:00pm", "2026-10-05T14:00"],
  ["submissions can be received at any time", ""],
  ["2026-02-30", ""],
];
for (const [raw, expected] of dates) assert.equal(sortableDate(raw), expected, raw);
assert.equal(parseSourceDate(""), null);

assert.equal(deadlineOf("2026-10-18", now)?.state, "today", "A bare closing day is neither open nor closed on the day");
assert.equal(deadlineOf("2026-10-17", now)?.state, "closed");
assert.equal(deadlineOf("2026-10-20", now)?.relative, "in 2 days");
assert.equal(deadlineOf("2026-10-30", now)?.state, "open");
assert.equal(deadlineOf("2026-10-18T04:00:00-07:00", now)?.state, "closed", "An instant earlier today has passed");
assert.equal(deadlineOf("by appointment", now)?.state, "unknown");

assert.deepEqual(statusOf("opportunity", "Open", deadlineOf("2026-09-14", now), "BC Bid"), { label: "Closed", tone: "neutral", note: "still listed as “Open” on BC Bid" });
assert.equal(statusOf("opportunity", "Open", deadlineOf("2026-10-30", now))?.tone, "success");
assert.equal(statusOf("opportunity", "Cancelled", null)?.tone, "danger");
assert.equal(statusOf("opportunity", "Open", deadlineOf("no fixed date", now))?.label, "Open", "An unreadable deadline never closes a notice");

// BC Bid's page repeats the title, number, status, dates and description; only the delivery note is new.
const description = "The Regional District gives notice of its intent to directly award a contract for dam safety engineering services, including surveillance plans, instrumentation and remediation planning for the saddle dam.";
const notice = describeNotice({ recordKey: "opportunity:216117", kind: "opportunity", title: "NOI - Dam Safety Engineering" }, {
  description: "NOI - Dam Safety Engineering", descriptionText: description, status: "Open", type: "Notice of Intent (BPS)",
  issuedBy: "Sunshine Coast Regional District", issuedFor: "Sunshine Coast Regional District", opportunityId: "SCRD-2026-NOI-0114",
  closingDate: "2026-09-14", issueDate: "2026-09-03", detailUrl: "https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/216117",
  place: { municipality: null, regionalDistrict: "Sunshine Coast Regional District" }, commodities: ["Engineering Services"], mainCommodity: "Engineering Services",
  detailFields: [
    { label: "Opportunity Type", value: "Notice of Intent (BPS)" },
    { label: "Opportunity Description", value: "NOI - Dam Safety Engineering" },
    { label: "Opportunity ID", value: "SCRD-2026-NOI-0114" },
    { label: "Status", value: "Open" },
    { label: "Lot #", value: "1" },
    { label: "Amendment #", value: "0" },
    { label: "Issue Date", value: "2026-09-03 9:00:00 AM (Pacific)" },
    { label: "Closing Date and Time", value: "2026-09-14 3:00:00 PM (Pacific)" },
    { label: "Delivery of Submissions", value: "Statements of capabilities must be emailed to the contact below." },
    { label: "Summary Details", value: description },
    { label: "Commodities", value: "Engineering Services" },
  ],
}, now);
assert.deepEqual(notice.fields.map((field) => field.label), ["Delivery of Submissions"]);
assert.deepEqual(notice.facts.map((fact) => fact.label), ["Closes", "Buyer", "Type", "Reference", "Issued"], "Issued for and Location repeat the buyer");
assert.equal(notice.facts[0].value.includes("3:00"), true, "The closing time comes from the page fields when the stored date is a bare day");
assert.equal(notice.status?.label, "Closed");
assert.equal(notice.source, "BC Bid");
assert.equal(notice.sourceUrl, "https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/216117");
assert.equal(describeNotice({ recordKey: "opportunity:municipal-sites:x:1", kind: "opportunity", title: "T" }, { opportunityId: "municipal-sites:x:1", detailUrl: "javascript:alert(1)" }, now).reference, "", "Synthetic keys and unsafe links are not shown");
assert.equal(describeNotice({ recordKey: "opportunity:municipal-sites:x:1", kind: "opportunity", title: "T" }, {}, now).source, "Buyer's website");

const row = (source: string, value: Record<string, unknown>) => ({ source, dataJson: JSON.stringify(value) });
const review = describeReview([
  row("procurement_decisions", { decision: "monitor", note: "Older", actor: "A", created_at: "2026-10-01T00:00:00Z" }),
  row("procurement_decisions", { decision: "pursue", note: "Strong fit", actor: "Mina Patel", created_at: "2026-10-16T23:00:00Z", needs_reconfirmation: 0 }),
  row("procurement_assessments", { is_current: 1, as_of: "2026-10-18T06:40:00Z", suggested_action: "ready_for_human_decision", relevance: "strong", eligibility: "blocker", delivery: "not_assessed", reasons: JSON.stringify(["Matches core work"]), critical_unknowns: "[]" }),
  row("procurement_requirements", { id: "rq-2", ordinal: 2, text: "Carry $5M CGL insurance", strength: "mandatory", category: "insurance" }),
  row("procurement_requirements", { id: "rq-1", ordinal: 1, text: "Be registered in BC", strength: "mandatory", category: "eligibility" }),
  row("procurement_matches", { requirement_id: "rq-1", status: "supported", rationale: "Registered society", updated_at: "2026-10-17" }),
  row("procurement_facts", { field_key: "estimated_value", status: "stated", value: JSON.stringify({ raw: "$180,000 to $220,000" }) }),
  row("procurement_tasks", { title: "Ask the broker", status: "open", owner: "Jordan", due_at: "2026-10-22", created_at: "2026-10-17" }),
  row("procurement_tasks", { title: "Done already", status: "done", created_at: "2026-10-10" }),
  row("reviews", { status: "succeeded", created_at: "2026-10-17", model: "m", result: JSON.stringify({ summary: "Strong fit", labels: ["engagement"] }) }),
  { source: "procurement_changes", dataJson: "not json" },
]);
assert.equal(review.decision?.label, "Pursue", "The newest decision wins");
assert.equal(review.suggestion?.label, "Ready for a decision");
assert.deepEqual(review.suggestion?.dimensions.map((dim) => [dim.label, dim.tone]), [["Work fit", "success"], ["Eligibility", "danger"]], "Unassessed dimensions are left out");
assert.deepEqual(review.requirements.map((item) => [item.text, item.match?.label ?? null]), [["Be registered in BC", "Met"], ["Carry $5M CGL insurance", null]]);
assert.deepEqual(review.facts, [{ label: "Estimated value", value: "$180,000 to $220,000" }]);
assert.equal(review.tasks.filter((task) => !task.done).length, 1);
assert.equal(review.summary?.text, "Strong fit");
assert.equal(review.empty, false);
assert.equal(describeReview([]).empty, true);

console.log("OK: source dates, deadlines in the source zone, status wording, BC Bid field de-duplication, safe links, review rows.");
