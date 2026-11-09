import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { organizationGstAccountReference } from "../shared/gstAccountReference";
import { CRA_PRE_FILL_KINDS } from "../shared/filingPreparation";
import { GstAccountReference } from "../src/components/GstAccountReference";

const today = "2026-11-08";
const gst = { kind: "gst", number: "123 456 789 rt 0001", status: "active", registeredAt: "2026-01-01" };
assert.deepEqual(organizationGstAccountReference([gst], today), {
  status: "ready", number: "123456789RT0001",
  message: "Current organization account. Confirm that this is the account for the return and reporting period you are filing.",
});
assert.equal(organizationGstAccountReference([], today).status, "missing");
assert.equal(organizationGstAccountReference([{ kind: "business_number", number: "123456789", status: "active" }], today).status, "missing");
assert.equal(organizationGstAccountReference([{ ...gst, kind: "business_number" }], today).number, "123456789RT0001");
assert.equal(organizationGstAccountReference([gst, { ...gst, kind: "business_number" }], today).status, "ready");
for (const identifiers of [
  [{ ...gst, status: "needs_review" }],
  [{ ...gst, status: undefined }],
  [{ ...gst, number: "123456789" }],
  [{ ...gst, registeredAt: "2026-02-30" }],
]) {
  const reference = organizationGstAccountReference(identifiers, today);
  assert.equal(reference.status, "review");
  assert.equal(reference.number, undefined);
}
assert.equal(organizationGstAccountReference([{ ...gst, status: "inactive" }], today).status, "inactive");
assert.equal(organizationGstAccountReference([{ ...gst, registeredAt: "2027-01-01" }], today).status, "future");
const conflict = organizationGstAccountReference([gst, { ...gst, number: "987654321RT0001" }], today);
assert.equal(conflict.status, "conflict");
assert.equal(conflict.number, undefined, "an ambiguous account must never be offered for copying");

const render = (props: React.ComponentProps<typeof GstAccountReference>) => renderToStaticMarkup(
  <MemoryRouter><GstAccountReference {...props} asOfDate={today} /></MemoryRouter>,
);
const filing = render({ identifiers: [gst], filing: true });
assert.match(filing, /Copy organization GST\/HST account 123456789RT0001/);
assert.match(filing, /Current organization account/);
assert.match(filing, /It does not change or verify a submitted return/);
assert.match(filing, /\/app\/society#tax-identifiers/);
assert.doesNotMatch(render({ identifiers: [gst], canRead: false, filing: true }), /123456789/);
assert.match(render({ identifiers: [], filing: true }), /No GST\/HST account is saved/);
assert.match(render({ filing: true }), /Loading the organization GST\/HST account/);
assert.doesNotMatch(render({ identifiers: [gst, { ...gst, number: "987654321RT0001" }], filing: true }), /Copy organization GST/);
assert.equal(CRA_PRE_FILL_KINDS.some(option => String(option.id) === "GSTHST"), false,
  "showing an account reference does not claim that GST/HST return calculations are supported");
console.log("Organization GST/HST account references: selection, filing display, permissions and unsupported return-calculation boundary passed.");
