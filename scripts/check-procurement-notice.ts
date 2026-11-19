/**
 * The hosted procurement reader's record and review models
 * (src/features/procurementReview/lib/notice.ts, review.ts): source date
 * formats, deadlines judged in the source zone, BC Bid's repeated page fields
 * dropped, published review rows read into a decision, suggestion and
 * requirements, and the page around the record: Back's label, the buyer's
 * other notices, and the documents as one list. Text published with HTML
 * entities still in it (shared/htmlEntities.ts) reads as plain text.
 */
import assert from "node:assert/strict";
import { backLabel, deadlineOf, describeNotice, documentTipNames, formatSourceDate, noticeDocumentRows, onDocumentSource, onSource, parseSourceDate, partyCount, sortableDate, sourceLabel, statusOf } from "../src/features/procurementReview/lib/notice";
import { describeReview } from "../src/features/procurementReview/lib/review";
import { decodeHtmlEntities } from "../shared/htmlEntities";
import { readableListRow, type ListRow } from "../shared/procurementListRow";
import { toNoticeRow } from "../shared/procurementNoticeRow";
import { procurementPartyKey } from "../shared/procurementAnalytics";

// Noon UTC on October 18, 2026 is 5 AM in Vancouver.
const now = Date.parse("2026-10-18T12:00:00Z");

const dates: [string, string][] = [
  ["2026-10-30", "2026-10-30"],
  ["2026-10-30 2:00:00 PM (Pacific)", "2026-10-30T14:00"],
  ["2026-10-21T21:00:00Z", "2026-10-21T14:00"],
  ["2026-11-06T15:00:00-08:00", "2026-11-06T16:00"],
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
assert.deepEqual(notice.commodities, [{ label: "Engineering Services", code: "", title: "", ancestors: [], main: true }], "A label with no classification is plain text");

// Classified commodities: main first, each label with the code its classification names, then any classification no label names.
const software = { code: "43230000", title: "Software", level: "family", ancestors: [{ code: "43000000", title: "Information Technology Broadcasting and Telecommunications", level: "segment" }] };
const erp = { sourceLabel: "Finance accounting and enterprise resource planning ERP software", code: "43231600", title: "Finance accounting and enterprise resource planning ERP software", level: "class", ancestors: [{ code: "43230000", title: "Software", level: "family" }, { code: "43000000", title: "Information Technology Broadcasting and Telecommunications", level: "segment" }] };
const classified = describeNotice({ recordKey: "opportunity:1", kind: "opportunity", title: "ERP replacement" }, {
  taxonomyReleaseId: "taxonomy-release:UNSPSC:UNv260801", mainCommodity: "Finance accounting and enterprise resource planning ERP software",
  commodities: ["Software", "Finance accounting and enterprise resource planning ERP software", "Hosting"],
  commodityClassifications: [{ ...software, sourceLabel: "Software" }, erp, { sourceLabel: "Data services", code: "81112000", title: "Data services", level: "family", ancestors: [] }, { code: "nonsense" }],
}, now);
assert.deepEqual(classified.commodities.map((item) => [item.label, item.code, item.main]), [
  ["Finance accounting and enterprise resource planning ERP software", "43231600", true],
  ["Software", "43230000", false],
  ["Hosting", "", false],
  ["Data services", "81112000", false],
]);
assert.deepEqual(classified.commodities[0].ancestors.map((item) => item.code), ["43000000", "43230000"], "Ancestors run from the segment down");
assert.deepEqual(describeNotice({ recordKey: "opportunity:2", kind: "opportunity", title: "Old" }, { taxonomyReleaseId: "taxonomy-release:UNSPSC:UNv260801", historicalTypeReferenceId: "historical:RFQ", commodities: ["Software"], commodityClassifications: [{ ...software, sourceLabel: "Software" }] }, now).commodities.map((item) => item.code), [""], "Pre-2023 notices link no UNSPSC code");
assert.deepEqual(describeNotice({ recordKey: "opportunity:3", kind: "opportunity", title: "GSIN" }, { taxonomyReleaseId: "taxonomy-release:GSIN:1", commodities: ["Software"], commodityClassifications: [{ ...software, sourceLabel: "Software" }] }, now).commodities.map((item) => item.code), [""], "Only a UNSPSC release's codes link");

// BC Bid also publishes the contact a second time, an office address in five fields, and map coordinates.
const tidy = describeNotice({ recordKey: "opportunity:234294", kind: "opportunity", title: "Laboratory Equipment" }, {
  status: "Open", closingDate: "2026-10-30", issuedBy: "CivicInfoBC",
  contacts: [{ name: "Renee Johansson", email: "rfp@example.gov" }],
  detailFields: [
    { label: "Enquiries Deadline", value: "2026-10-22 2:30:00 PM" },
    { label: "Delivery of Submissions", value: "Through the buyer's procurement portal only." },
    { label: "Contact email", value: "rfp@example.gov" },
    { label: "Office Street Address", value: "2510 Sparrow Dr" },
    { label: "City", value: "Nisku" },
    { label: "Postal Code", value: "T9E 8N5" },
    { label: "Country", value: "Canada" },
    { label: "Province", value: "Alberta" },
    { label: "Latitude", value: "53.3537157" },
    { label: "Longitude", value: "-113.5370052" },
    { label: "Contact First Name", value: "Renee" },
    { label: "Contact Last Name", value: "Johansson" },
    { label: "Pre-bid Meeting", value: "2026-10-20 10:00:00 AM" },
  ],
}, now);
assert.deepEqual(tidy.fields.map((field) => [field.label, field.value]), [
  ["Delivery of Submissions", "Through the buyer's procurement portal only."],
  ["Pre-bid Meeting", formatSourceDate("2026-10-20 10:00:00 AM")],
], "The contact's repeats, the address parts and the coordinates are not fields; a bare stamp reads as a date");
assert.equal(tidy.contactAddress, "2510 Sparrow Dr, Nisku, Alberta T9E 8N5, Canada");
assert.deepEqual(tidy.facts.slice(0, 2).map((fact) => fact.label), ["Closes", "Enquiries by"], "The enquiries deadline sits with the closing date");
assert.equal(tidy.facts[1].value.includes("2:30"), true);
const loneCity = describeNotice({ recordKey: "opportunity:1", kind: "opportunity", title: "T" }, { detailFields: [{ label: "City", value: "Nisku" }, { label: "Contact Name", value: "Someone Else" }] }, now);
assert.deepEqual(loneCity.fields.map((field) => field.label), ["City", "Contact Name"], "Without a street there is no address to make, and an unknown contact is kept");
assert.equal(loneCity.contactAddress, "");
assert.equal(notice.sourceUrl, "https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/216117");
assert.equal(describeNotice({ recordKey: "opportunity:municipal-sites:x:1", kind: "opportunity", title: "T" }, { opportunityId: "municipal-sites:x:1", detailUrl: "javascript:alert(1)" }, now).reference, "", "Synthetic keys and unsafe links are not shown");
assert.equal(describeNotice({ recordKey: "opportunity:bidsandtenders:s:1", kind: "opportunity", title: "T" }, { opportunityId: "bidsandtenders:surrey:abc", externalId: "1220-030" }, now).reference, "1220-030", "A synthetic key falls through to the source's own number");
assert.equal(describeNotice({ recordKey: "opportunity:canadabuys:1", kind: "opportunity", title: "T" }, { opportunityId: "canadabuys:tender:ws123:000" }, now).reference, "", "CanadaBuys keys Zoer made up are not references");
assert.equal(describeNotice({ recordKey: "opportunity:municipal-sites:x:1", kind: "opportunity", title: "T" }, {}, now).source, "Buyer's website");

// BC Bid award keys join their parts with "::" and name no source.
assert.equal(sourceLabel("award:hlth-2026-rfp-0219::c26hlth0418::cedar & main::2026-10-16"), "BC Bid");
assert.equal(sourceLabel("opportunity:216117"), "BC Bid");
assert.equal(sourceLabel("opportunity:canadabuys:tender:cb-1:000"), "CanadaBuys");
const award = describeNotice({ recordKey: "award:hlth-2026-rfp-0219::c26hlth0418", kind: "award", title: "Peer Support" }, { issuingOrganization: "Ministry of Health", contactEmail: "procurement@example.gov.bc.ca" }, now);
assert.deepEqual(award.contacts, [{ name: "", role: "", email: "procurement@example.gov.bc.ca", phone: "" }], "An award's flat contact fields are its contact");
assert.equal(award.source, "BC Bid");

// Buyer and Issued for open the organisation's page; the issued-for fact only appears when it names someone else.
assert.deepEqual(notice.facts.find((fact) => fact.label === "Buyer")?.party, "organization");
const issued = describeNotice({ recordKey: "opportunity:1", kind: "opportunity", title: "T" }, { issuedBy: "BC Housing", issuedFor: "Metro Vancouver Housing" }, now);
assert.deepEqual(issued.facts.filter((fact) => fact.party).map((fact) => [fact.label, fact.party]), [["Buyer", "organization"], ["Issued for", "issuedFor"]]);
assert.equal(describeNotice({ recordKey: "award:1", kind: "award", title: "T" }, { issuedBy: "City of Burnaby" }, now).facts.find((fact) => fact.label === "Buyer")?.party, "organization");

// Back names the place under the notice.
assert.equal(backLabel({}), "Opportunities");
assert.equal(backLabel({ kind: "award" }), "Awards");
assert.equal(backLabel({ kind: "award", buyer: " City of Burnaby " }), "City of Burnaby", "A buyer page under the notice wins over the list");
assert.equal(backLabel({ issuedFor: "Metro Vancouver Housing" }), "Metro Vancouver Housing");
assert.equal(backLabel({ section: "analytics", kind: "award" }), "Analytics");
assert.equal(backLabel({ commodity: "43230000", kind: "award" }), "Commodity 43230000", "A commodity page under the notice wins over the list");
assert.equal(backLabel({ commodity: "43230000", buyer: "City" }), "City");
assert.equal(onSource("BC Bid"), "on BC Bid");
assert.equal(onSource("Buyer's website"), "on the buyer's site");

const listRows = [
  { organization: "City of Burnaby", issuedFor: "" },
  { organization: "city of burnaby", issuedFor: "Burnaby Public Library" },
  { organization: "BC Transit", issuedFor: "" },
];
assert.equal(partyCount(listRows, "organization", "City of Burnaby"), 2, "Names compare without case or punctuation");
assert.equal(partyCount(listRows, "organization", "BC Transit"), null, "Only this notice: nothing to add");
assert.equal(partyCount(listRows, "issuedFor", "Burnaby Public Library"), null);
assert.equal(partyCount(listRows, "organization", ""), null);

// The documents: downloaded first, then the stored ones without a file, then the source's list, once each.
const doc = (name: string, available: boolean) => ({ documentKey: `d:${name}`, name, available });
const attachments = [
  { name: "Tender Documents.pdf", url: "https://bcbid.gov.bc.ca/doc/1" },
  { name: "drawings set.pdf ", url: "https://bcbid.gov.bc.ca/doc/2" },
  { name: "Addendum 1.pdf", url: "https://bcbid.gov.bc.ca/doc/3" },
  { name: "Addendum 1.pdf" },
  { name: "Site photos.zip", url: "http://insecure.example/photos.zip" },
];
const rows = noticeDocumentRows([doc("Drawings Set.pdf", false), doc("Tender Documents.pdf", true)], attachments, true);
assert.deepEqual(rows.map((item) => [item.state, item.name, item.state === "elsewhere" ? item.url ?? null : null]), [
  ["downloaded", "Tender Documents.pdf", null],
  ["elsewhere", "Drawings Set.pdf", "https://bcbid.gov.bc.ca/doc/2"],
  ["elsewhere", "Addendum 1.pdf", "https://bcbid.gov.bc.ca/doc/3"],
  ["elsewhere", "Site photos.zip", null],
], "A stored file without its bytes takes the source's link; listed files dedupe by name; only https links open");
assert.equal(new Set(rows.map((item) => item.key)).size, rows.length, "Row keys are unique");
assert.deepEqual(noticeDocumentRows([doc("Tender Documents.pdf", true)], attachments, false).map((item) => item.name), ["Tender Documents.pdf"], "Without the whole stored list, the source's list waits");
assert.equal(noticeDocumentRows([], [], true).length, 0);
const twice = [{ ...doc("Addendum 1", true), sha256: "aa" }, { ...doc("Addendum 2", true), sha256: "bb" }, { ...doc("Addendum 1", true), documentKey: "d:again", sha256: "aa" }];
assert.deepEqual(noticeDocumentRows(twice, [], true).map((item) => item.key), ["d:Addendum 1", "d:Addendum 2"], "The same bytes stored twice show once");
const amendmentData = {
  attachments: ["Tender.pdf"],
  addenda: [
    { title: "Amendment History", date: "2015-06-15", link: null },
    { title: "Amendment 3", date: "2015-06-15" },
    { title: "Addendum 2", link: "https://bcbid.gov.bc.ca/doc/addendum" },
    "Drawings.zip",
  ],
};
const amendmentNotice = describeNotice({ recordKey: "opportunity:56151", kind: "opportunity", title: "Strathcona" }, amendmentData);
assert.deepEqual(amendmentNotice.attachments, [
  { name: "Tender.pdf", url: undefined },
  { name: "Addendum 2", url: "https://bcbid.gov.bc.ca/doc/addendum" },
  { name: "Drawings.zip", url: undefined },
]);
assert.equal(documentTipNames([], amendmentData, true).linkedTotal, 3);
const firstForm = "https://bcbid.gov.bc.ca/doc/first";
const secondForm = "https://bcbid.gov.bc.ca/doc/second";
const duplicateNames = [
  { name: "Tender Form.pdf", url: firstForm },
  { name: "Tender Form.pdf", url: secondForm },
  { name: "Tender Form.pdf", url: firstForm },
  { name: "Tender Form.pdf" },
];
const listedForms = noticeDocumentRows([], duplicateNames, true);
assert.deepEqual(listedForms.map(item => item.state === "elsewhere" && item.url), [firstForm, secondForm]);
assert.equal(new Set(listedForms.map(item => item.key)).size, 2);
const storedForm = { ...doc("Tender Form.pdf", true), sourceUrl: firstForm };
assert.deepEqual(noticeDocumentRows([storedForm], duplicateNames, true).map(item => item.state === "elsewhere" && item.url), [false, secondForm]);
assert.equal(documentTipNames([storedForm], { attachments: duplicateNames }, true).linkedTotal, 1);
const ambiguous = noticeDocumentRows([doc("Tender Form.pdf", false)], duplicateNames, true);
assert.deepEqual(ambiguous.map(item => item.state === "elsewhere" && item.url), [undefined, firstForm, secondForm]);
assert.equal(onDocumentSource("https://canadabuys.canada.ca/documents/example.pdf", "BC Bid"), "on CanadaBuys");
assert.equal(onDocumentSource(firstForm, "BC Bid"), "on BC Bid");


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

// A CanadaBuys notice as Zoer published it before decoding source text (opportunity:canadabuys:tender:MX-444188030829:000).
const tungsten = "The purpose of this call for tenders is to solicit proposals for the Tungsten Total Agility (TTA) (formerly Kofax, &ldquo;KTA&rdquo;) managed services, as further detailed in section&nbsp;2 of tender document. The requirement combines three related activities: (i) authorized reseller and licensing management for TTA licenses and subscriptions; (ii) first-line application support and maintenance; and (iii) professional services for development, integration and continuous evolution of the existing Platform.Bidding and Documents are available on http://www.merx.com.  Fees may apply; See https://www.merx.com/public/pricing for more information.";
const encoded = describeNotice(
  { recordKey: "opportunity:canadabuys:tender:MX-444188030829:000", kind: "opportunity", title: "Caf&eacute; &amp; kitchen services" },
  { sourceId: "canadabuys", issuedBy: "Soci&eacute;t&eacute; &laquo;A&raquo;", sourceDescriptionText: tungsten, detailFields: [{ label: "Delivery terms", value: "Rock &amp; gravel &ndash; 5&nbsp;m&sup3;" }] },
  now,
);
assert.equal(encoded.title, "Café & kitchen services");
assert.equal(encoded.buyer, "Société «A»");
assert.ok(encoded.description.startsWith("The purpose of this call for tenders is to solicit proposals for the Tungsten Total Agility (TTA) (formerly Kofax, “KTA”) managed services, as further detailed in section 2 of tender document."));
assert.ok(encoded.description.includes("existing Platform.\n\nBidding and Documents are available on http://www.merx.com."), "The MERX footer starts its own paragraph");
assert.ok(!/&[a-z]+;|&#/i.test(encoded.description), "No entity is left in the description");
assert.equal(encoded.fields.find((field) => field.label === "Delivery terms")?.value, "Rock & gravel – 5 m³");
assert.equal(describeNotice({ recordKey: "opportunity:canadabuys:tender:X:", kind: "opportunity", title: "T" }, { sourceDescriptionText: "Line one.\r\nRFEOI.Bidding and Documents are available on x" }, now).description, "Line one.\r\nRFEOI.\n\nBidding and Documents are available on x");
assert.equal(describeNotice({ recordKey: "opportunity:canadabuys:tender:X:", kind: "opportunity", title: "T" }, { sourceDescriptionText: "Ends with a link.\r\n&nbsp;Bidding and Documents are available on x" }, now).description, "Ends with a link.\r\n Bidding and Documents are available on x", "A footer already on its own line stays put");

const decodes: [string, string][] = [
  ["&ldquo;KTA&rdquo; &rsquo;s &ndash; &eacute; &Eacute; &oelig; &sup2; &#39; &#233; &#xE9; &#146;", "“KTA” ’s – é É œ ² ' é é ’"],
  ["section&nbsp;2 and section&#160;3", "section 2 and section 3"],
  ["Twice: &amp;ldquo;quoted&amp;rdquo; &amp;amp;", "Twice: “quoted” &"],
  ["Three times stays at two: &amp;amp;amp;", "Three times stays at two: &amp;"],
  ["&lt;script&gt;alert(1)&lt;/script&gt;", "<script>alert(1)</script>"],
  ["AT&T, R&D, a&b; &unknown; &valueOf; &nbsp no semicolon &#0; &#xD800;", "AT&T, R&D, a&b; &unknown; &valueOf; &nbsp no semicolon &#0; &#xD800;"],
  ["Plain text, no ampersand", "Plain text, no ampersand"],
];
for (const [raw, expected] of decodes) assert.equal(decodeHtmlEntities(raw), expected, raw);
for (const [raw] of decodes.slice(0, 3)) assert.equal(decodeHtmlEntities(decodeHtmlEntities(raw)), decodeHtmlEntities(raw), `Decoding twice changes nothing: ${raw}`);

const listRow: ListRow = { recordKey: "award:1", kind: "award", title: "Caf&eacute;", organization: "A &amp; B", issuedFor: "", status: "", date: "2026-10-01", dateText: "", reference: "R&amp;D-1", documents: 0, listedDocuments: 0, supplier: "L&rsquo;Atelier", value: null, currency: "", procurementType: "RFQ" };
assert.deepEqual(
  (({ title, organization, reference, supplier }) => ({ title, organization, reference, supplier }))(readableListRow(listRow)),
  { title: "Café", organization: "A & B", reference: "R&D-1", supplier: "L’Atelier" },
);
const plainRow = { ...listRow, title: "Plain", organization: "Plain", reference: "", supplier: "" };
assert.equal(readableListRow(plainRow), plainRow, "A row with nothing to decode is passed through as it is");
const drawn = toNoticeRow(listRow, now);
assert.deepEqual([drawn.title, drawn.organization, drawn.supplier, drawn._searchText], ["Café", "A & B", "L’Atelier", "R&D-1"]);
assert.equal(procurementPartyKey("A &amp; B"), procurementPartyKey("A & B"), "An encoded buyer name is the same party");

console.log("OK: source dates, deadlines in the source zone, status wording, BC Bid field de-duplication, safe links, review rows, Back labels, party links and counts, commodities and their codes, one documents list, entities decoded.");
