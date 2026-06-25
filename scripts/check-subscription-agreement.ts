import assert from "node:assert/strict";

import { buildSubscriptionAgreementBlocks } from "../shared/subscriptionAgreement";
import { documentDocxBytes } from "../shared/corporationPacketDocx";

/**
 * #5 Subscription for Shares annex: the per-subscriber companion document the
 * YCN allotment sheet generates alongside the directors' resolution.
 */

// --- individual subscriber ----------------------------------------------------
const blocks = buildSubscriptionAgreementBlocks({
  corporationName: "Acme Inc.",
  shortName: "Acme",
  legislation: "Business Corporations Act",
  subscriberName: "Dana Wells",
  shareClass: "Class A Common",
  quantity: 100,
  consideration: "$1,000.00 cash",
  dateLong: "June 25, 2026",
});
const text = blocks.map((b) => b.text).join("\n");
assert.equal(blocks[0].kind, "title");
assert.ok(text.includes("Subscription for Shares"), "title");
assert.ok(text.includes("To: Acme Inc."), "to the corporation");
assert.ok(text.includes("From: Dana Wells"), "from the subscriber");
assert.ok(
  text.includes("subscribes for 100 Class A Common shares of Acme for consideration of $1,000.00 cash"),
  "subscribe clause with quantity, class, and consideration",
);
assert.ok(text.includes("Dated: June 25, 2026"), "dated line");
assert.ok(text.includes("Dana Wells"), "signature name");
assert.ok(!text.includes("By: "), "individual subscriber has no corporate By: line");

// --- singular share + no consideration ---------------------------------------
const one = buildSubscriptionAgreementBlocks({
  corporationName: "Acme Inc.",
  shortName: "Acme",
  legislation: "Business Corporations Act",
  subscriberName: "Dana Wells",
  shareClass: "Class A Common",
  quantity: 1,
}).map((b) => b.text).join("\n");
assert.ok(one.includes("subscribes for 1 Class A Common share of Acme,"), "singular 'share' + no consideration clause");

// --- corporate subscriber renders the "By:" branch ---------------------------
const corp = buildSubscriptionAgreementBlocks({
  corporationName: "Acme Inc.",
  shortName: "Acme",
  legislation: "Business Corporations Act",
  subscriberName: "Jordan Vane",
  subscriberCorpSign: "Vane Holdings Ltd.",
  shareClass: "Class A Common",
  quantity: 50,
}).map((b) => b.text).join("\n");
assert.ok(corp.includes("Vane Holdings Ltd."), "corporation name on signature");
assert.ok(corp.includes("By: "), "corporate subscriber signs By:");

// --- DOCX serialization carries the content ----------------------------------
const docx = Buffer.from(documentDocxBytes("Subscription for Shares", blocks)).toString("latin1");
assert.ok(docx.includes("Subscription for Shares"), "title in DOCX");
assert.ok(docx.includes("subscribes for 100 Class A Common shares"), "subscribe clause in DOCX");

console.log("OK subscription-agreement");
