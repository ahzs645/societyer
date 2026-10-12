import assert from "node:assert/strict";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { registerDeletionBlock, REGISTER_CORRECTION_WINDOW_MS } from "../shared/registerRetention";
import { formerNamesFrom, portfolioEntityMatches } from "../shared/portfolioSearch";

/**
 * Statutory register purge guard, constating/name-history evidence and end
 * dates, and the portfolio's former-name search. Fixtures are synthetic.
 */

const bc = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
const cbca = { entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" };
const society = { entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" };
const now = Date.parse("2026-10-12T12:00:00Z");
const old = "2024-01-01T00:00:00Z";
const fresh = new Date(now - REGISTER_CORRECTION_WINDOW_MS / 2).toISOString();

// ---- purge guard (pure) -------------------------------------------------------
assert.match(registerDeletionBlock(bc, "rightsholdingTransfers", { status: "posted", createdAtISO: old }, now)!, /securities register.*kept permanently.*Void the transaction/i);
assert.equal(registerDeletionBlock(bc, "rightsholdingTransfers", { status: "draft", createdAtISO: old }, now), null, "drafts are not register entries");
assert.equal(registerDeletionBlock(bc, "rightsholdingTransfers", { status: "posted", createdAtISO: fresh }, now), null, "a same-day data-entry mistake can be corrected");
assert.match(registerDeletionBlock(bc, "shareCertificates", { createdAtISO: old }, now)!, /cancelled/);
assert.match(registerDeletionBlock(bc, "societyNameHistory", { createdAtISO: old }, now)!, /articles, alteration history.*end date/i);
assert.match(registerDeletionBlock(bc, "constatingEvents", { createdAtISO: old }, now)!, /end date for the event/);
assert.match(registerDeletionBlock(cbca, "rightsholdingTransfers", { status: "posted", createdAtISO: old }, now)!, /securities register/i);
assert.match(registerDeletionBlock(cbca, "societyNameHistory", { createdAtISO: old }, now)!, /articles, bylaws/i);
assert.equal(registerDeletionBlock(society, "societyNameHistory", { createdAtISO: old }, now), null, "societies are outside this corporate guard");
assert.equal(registerDeletionBlock(bc, "dividends", { createdAtISO: old }, now), null, "only the guarded registers");
assert.match(registerDeletionBlock(bc, "constatingEvents", {}, now)!, /kept permanently/, "a row without an entry time is treated as established");

// ---- end to end ---------------------------------------------------------------
const SRC = "soc-retention";
const client = new StaticConvexClient({
  databaseName: `register-retention-${Date.now()}`,
  seed: {
    societies: [
      { _id: SRC, name: "Current Name Holdings Ltd.", isCharity: false, isMemberFunded: false, ...bc, incorporationNumber: "BC0000123" },
      { _id: "soc-plain", name: "Plain Society", isCharity: false, isMemberFunded: false, ...society },
    ],
    societyNameHistory: [
      { _id: "nh-old", societyId: SRC, name: "Former Name Ventures Ltd.", startISO: "2010-05-01", createdAtISO: old },
      { _id: "nh-now", societyId: SRC, name: "Current Name Holdings Ltd.", startISO: "2018-07-01", createdAtISO: old },
    ],
    constatingEvents: [{ _id: "ce-old", societyId: SRC, action: "incorporated", jurisdiction: "British Columbia", legislation: "Business Corporations Act", startISO: "2010-05-01", createdAtISO: old }],
    shareCertificates: [{ _id: "cert-old", societyId: SRC, certificateNumber: "C-1", holderName: "Synthetic Holder", shareClass: "Common", shares: 10, issuedOn: "2010-05-02", createdAtISO: old }],
    rightsClasses: [{ _id: "rc-r", societyId: SRC, className: "Common", classType: "share", status: "active" }],
    rightsholdingTransfers: [{ _id: "xfer-old", societyId: SRC, transferType: "issuance", status: "posted", transferDate: "2010-05-02", rightsClassId: "rc-r", quantity: 10, sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: old }],
  } as never,
});
await assert.rejects(client.mutation("nameHistory:remove", { id: "nh-old" }), /kept permanently/);
await assert.rejects(client.mutation("constating:remove", { id: "ce-old" }), /kept permanently/);
await assert.rejects(client.mutation("shareCertificates:remove", { id: "cert-old" }), /kept permanently/);
await assert.rejects(client.mutation("legalOperations:removeRightsholdingTransfer", { id: "xfer-old" }), /kept permanently/);
const tables = () => (client as unknown as { exportLocalWorkspaceSnapshot(): { tables: Record<string, any[]> } }).exportLocalWorkspaceSnapshot().tables;
assert.ok(tables().societyNameHistory.some((row) => row._id === "nh-old"), "the entry survives a refused delete");
// A same-day correction still works.
const mistake = await client.mutation("nameHistory:upsert", { societyId: SRC, name: "Typo Name Ltd.", startISO: "2018-07-01", nowISO: new Date().toISOString() });
await client.mutation("nameHistory:remove", { id: mistake });
assert.ok(!tables().societyNameHistory.some((row) => row._id === mistake));

// End dates and linked evidence instead of deletion.
const certificate = await client.mutation("documents:create", { societyId: SRC, title: "Certificate of change of name", category: "governance", tags: [] });
await client.mutation("nameHistory:upsert", { id: "nh-old", societyId: SRC, name: "Former Name Ventures Ltd.", startISO: "2010-05-01", endISO: "2018-06-30", sourceDocumentIds: [certificate], nowISO: new Date().toISOString() });
const names = await client.query("nameHistory:list", { societyId: SRC });
const former = names.find((row: any) => row._id === "nh-old");
assert.equal(former.endISO, "2018-06-30");
assert.deepEqual(former.sourceDocumentIds, [certificate]);
await assert.rejects(client.mutation("nameHistory:upsert", { id: "nh-old", societyId: SRC, name: "Former Name Ventures Ltd.", startISO: "2010-05-01", endISO: "2009-01-01", nowISO: new Date().toISOString() }), /cannot end before/);
const foreignDocument = await client.mutation("documents:create", { societyId: "soc-plain", title: "Other workspace", category: "governance", tags: [] });
await assert.rejects(client.mutation("nameHistory:upsert", { id: "nh-old", societyId: SRC, name: "Former Name Ventures Ltd.", startISO: "2010-05-01", sourceDocumentIds: [foreignDocument], nowISO: new Date().toISOString() }), /not found/i);
const articles = await client.mutation("documents:create", { societyId: SRC, title: "Certificate of incorporation", category: "governance", tags: [] });
await client.mutation("constating:update", { id: "ce-old", action: "incorporated", jurisdiction: "British Columbia", legislation: "Business Corporations Act", startISO: "2010-05-01", sourceDocumentIds: [articles] });
const continued = await client.mutation("constating:create", { societyId: SRC, action: "continued", jurisdiction: "Canada", legislation: "Canada Business Corporations Act", startISO: "2020-01-01", endISO: "2022-01-01", sourceDocumentIds: [articles], nowISO: new Date().toISOString() });
const events = await client.query("constating:list", { societyId: SRC });
assert.deepEqual(events.find((row: any) => row._id === "ce-old").sourceDocumentIds, [articles]);
assert.equal(events.find((row: any) => row._id === continued).endISO, "2022-01-01");
await client.mutation("constating:update", { id: continued, action: "continued", jurisdiction: "Canada", legislation: "Canada Business Corporations Act", startISO: "2020-01-01", endISO: null });
assert.equal((await client.query("constating:list", { societyId: SRC })).find((row: any) => row._id === continued).endISO, undefined, "null clears the end date");

// ---- portfolio search by former name -------------------------------------------
assert.deepEqual(formerNamesFrom([{ name: "B Ltd.", startISO: "2015-01-01" }, { name: "A Ltd.", startISO: "2010-01-01" }, { name: "Current Ltd.", startISO: "2020-01-01" }, { name: "a ltd.", startISO: "2009-01-01" }], "Current Ltd."), ["B Ltd.", "A Ltd."]);
const entity = { name: "Current Name Holdings Ltd.", shortName: "CNH", incorporationNumber: "BC0000123", formerNames: ["Former Name Ventures Ltd."] };
assert.deepEqual(portfolioEntityMatches(entity, "former name"), { matches: true, formerName: "Former Name Ventures Ltd." });
assert.deepEqual(portfolioEntityMatches(entity, "bc0000123"), { matches: true });
assert.deepEqual(portfolioEntityMatches(entity, "cnh"), { matches: true });
assert.deepEqual(portfolioEntityMatches(entity, "unrelated"), { matches: false });
assert.deepEqual(portfolioEntityMatches(entity, "  "), { matches: true });
assert.deepEqual(portfolioEntityMatches({ name: "Société Ltée", formerNames: [] }, "societe"), { matches: true }, "accent-insensitive");
const overview = await client.query("firm:overview", {});
const row = overview.entities.find((item: any) => item._id === SRC);
assert.deepEqual(row.formerNames, ["Former Name Ventures Ltd."]);
assert.equal(portfolioEntityMatches(row, "Former Name").matches, true);

console.log("Register retention passed: statutory registers refuse hard deletes (void, cancel or end-date instead; same-day corrections allowed), name/constating end dates and evidence links, and former-name portfolio search.");
