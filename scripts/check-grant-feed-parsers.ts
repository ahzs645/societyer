import assert from "node:assert/strict";
import {
  parseRssOpportunities,
  parseJsonFeedOpportunities,
  resolveJsonItems,
} from "../shared/grantFeedParsers";

// --- RSS ---
const rss = `<?xml version="1.0"?><rss><channel>
  <item><title>Community Capacity Grant</title><link>https://x.org/g/1</link>
    <description><![CDATA[<p>Up to $25,000 for <b>capacity</b>.</p>]]></description>
    <pubDate>2026-09-01</pubDate><guid>grant-1</guid></item>
  <item><title>Arts Fund</title><link>https://x.org/g/2</link></item>
</channel></rss>`;
const rssOut = parseRssOpportunities(rss);
assert.equal(rssOut.length, 2, "two RSS items");
assert.equal(rssOut[0].title, "Community Capacity Grant", "rss title");
assert.equal(rssOut[0].opportunityUrl, "https://x.org/g/1", "rss link");
assert.equal(rssOut[0].externalId, "grant-1", "rss guid as externalId");
assert.equal(rssOut[0].description, "Up to $25,000 for capacity.", "CDATA + tags stripped");
assert.equal(rssOut[1].externalId, "https://x.org/g/2", "link fallback when no guid");

// --- Atom-style entry with href link ---
const atom = `<feed><entry><title>Atom Grant</title><link href="https://a.org/1"/><id>a-1</id></entry></feed>`;
const atomOut = parseRssOpportunities(atom);
assert.equal(atomOut[0].opportunityUrl, "https://a.org/1", "atom href link");
assert.equal(atomOut[0].externalId, "a-1", "atom id");

// --- JSON feed: envelope + field aliases ---
const json = {
  results: [
    { id: 7, name: "Green Fund", organization: "Eco Foundation", applicationDeadline: "2026-10-01", amount: "$10k", link: "https://e.org/7" },
    { title: "No URL Grant", deadline: "2026-11-01" },
  ],
};
const jsonOut = parseJsonFeedOpportunities(json);
assert.equal(jsonOut.length, 2, "two json items");
assert.equal(jsonOut[0].title, "Green Fund", "name -> title alias");
assert.equal(jsonOut[0].funder, "Eco Foundation", "organization -> funder alias");
assert.equal(jsonOut[0].applicationDueDate, "2026-10-01", "applicationDeadline alias");
assert.equal(jsonOut[0].externalId, "7", "json id as externalId");
assert.equal(jsonOut[1].externalId, "No URL Grant", "title fallback externalId");

// --- explicit mapping override + listPath ---
const mapped = parseJsonFeedOpportunities(
  { payload: { rows: [{ heading: "Mapped", who: "ACME" }] } },
  { title: "heading", funder: "who" },
  "payload.rows",
);
assert.equal(mapped[0].title, "Mapped", "mapping override title");
assert.equal(mapped[0].funder, "ACME", "mapping override funder");

// --- resolveJsonItems fallbacks ---
assert.equal(resolveJsonItems([1, 2]).length, 2, "top-level array");
assert.equal(resolveJsonItems({ data: [1] }).length, 1, "data envelope");
assert.deepEqual(resolveJsonItems({ nope: 1 }), [], "no array -> empty");

console.log("grant feed parser checks passed");
