import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib"; // not used; stored zip is uncompressed

import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { renderSections } from "../shared/packetRendering";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";

/**
 * (C) Live-doc-generator wiring: proves grammar/data context binds packet prose
 * through the real DOCX generator, and that token-free packets are unchanged.
 */
void inflateRawSync;

// --- societyRenderContext from persisted shapes -------------------------------
const society = { name: "Riverbend Community Society", entityType: "society", actFormedUnder: "societies_act", shortName: "Riverbend" };
const roleHolders = [
  { roleType: "director", fullName: "Avery Chen", gender: "F", endDate: null },
  { roleType: "director", fullName: "Morgan Patel", gender: "M", endDate: null },
  { roleType: "director", fullName: "Sam Lee", gender: "M", endDate: "2024-01-01" }, // resigned → excluded
];
const ctx = buildSocietyRenderContext(society, roleHolders, "2026-01-15");
assert.equal(ctx.dir.count, 2); // Sam excluded (has endDate)
assert.equal(ctx.dir.isMultiple, true);
assert.equal(ctx.org.legislation, "Societies Act");

// --- renderSections binds tokens ---------------------------------------------
const sampleSections = [
  { heading: "Adoption", body: ["The undersigned being {#if dir.isSole}the sole director{/if}{#if dir.isMultiple}all the directors{/if} of {org.shortName} hereby adopt{dir.verbS} this resolution."] },
];
const bound = renderSections(sampleSections, ctx as unknown as Record<string, unknown>);
assert.equal(bound[0].body[0], "The undersigned being all the directors of Riverbend hereby adopt this resolution.");
// no context → unchanged (back-compat)
assert.equal(renderSections(sampleSections)[0].body[0], sampleSections[0].body[0]);

// --- the real DOCX generator binds prose when context present ----------------
// Build a synthetic packet carrying a grammar token in a section body.
// A token-free packet; preparation-only worksheets (listed first) now carry {org.name} tokens.
const basePacket = CORPORATION_DOCUMENT_PACKETS.find((packet) => packet.key === "organize-corporation")!;
assert.ok(basePacket && !/\{[#/a-z]/.test(JSON.stringify(basePacket)), "organize-corporation packet stays token-free");
const tokenPacket = {
  ...basePacket,
  sections: [{ heading: "Resolution", body: ["{org.shortName}: adopted by {dir.count} director{dir.plural}."] }],
};

function docxText(bytes: Uint8Array): string {
  // Stored (uncompressed) zip: the document.xml bytes appear verbatim. Decode
  // the whole archive as latin1 and assert on the visible run text.
  return Buffer.from(bytes).toString("latin1");
}

const withCtx = docxText(corporationPacketDocxBytes(tokenPacket as typeof basePacket, ctx as unknown as Record<string, unknown>));
assert.ok(withCtx.includes("Riverbend: adopted by 2 directors."), "context should bind tokens in DOCX");
assert.ok(!withCtx.includes("{org.shortName}"), "no raw tokens should remain");

const withoutCtx = docxText(corporationPacketDocxBytes(tokenPacket as typeof basePacket));
assert.ok(withoutCtx.includes("{org.shortName}"), "without context, tokens pass through literally");

// --- existing token-free packets are byte-identical with/without context -----
const plainNo = corporationPacketDocxBytes(basePacket);
const plainCtx = corporationPacketDocxBytes(basePacket, ctx as unknown as Record<string, unknown>);
assert.equal(Buffer.from(plainNo).toString("latin1"), Buffer.from(plainCtx).toString("latin1"), "token-free packet unchanged by context");

// --- BC company with shareholders: shareholder groups bind ---------------------
{
  const company = { name: "Cedar Point Ventures Ltd.", shortName: "the Company", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", jurisdictionCode: "CA-BC" };
  const people = [
    { _id: "d1", roleType: "director", fullName: "Jordan Vale", startDate: "2021-01-01" },
    { _id: "h1", roleType: "shareholder", fullName: "Jordan Vale", startDate: "2021-01-01" },
    { _id: "h2", roleType: "shareholder", fullName: "Quill Holdings Inc.", startDate: "2021-01-01" },
    { _id: "h3", roleType: "shareholder", fullName: "Rowan Price", startDate: "2021-01-01" },
  ];
  const classes = [{ _id: "v", className: "Common", classType: "share", votesPerShare: 1 }, { _id: "n", className: "Preferred", classType: "share", votesPerShare: 0 }];
  const ledger = [
    { transferType: "issuance", status: "posted", transferDate: "2021-01-01", rightsClassId: "v", destinationRoleHolderId: "h1", quantity: 60, sourceDocumentIds: [], sourceExternalIds: [] },
    { transferType: "issuance", status: "posted", transferDate: "2021-01-01", rightsClassId: "v", destinationRoleHolderId: "h2", quantity: 40, sourceDocumentIds: [], sourceExternalIds: [] },
    { transferType: "issuance", status: "posted", transferDate: "2021-01-01", rightsClassId: "n", destinationRoleHolderId: "h3", quantity: 10, sourceDocumentIds: [], sourceExternalIds: [] },
  ];
  const bcCtx = buildSocietyRenderContext(company, people, "2026-06-25", { transfers: ledger, rightsClasses: classes });
  assert.equal(bcCtx.org.legislation, "Business Corporations Act (British Columbia)");
  assert.equal(bcCtx.org.ShortName, "The Company");
  assert.equal(bcCtx.shareholders.count, 3);
  assert.equal(bcCtx.votingShareholders.count, 2);
  assert.equal(bcCtx.members.count, 0, "shareholders are not society members");
  const render = (key: string) => renderSections(CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === key)!.sections, bcCtx as unknown as Record<string, unknown>).flatMap((s) => s.body).join("\n");
  const shell = render("all-shareholders-resolution");
  assert.ok(shell.includes("The undersigned, being all the shareholders of the Company, hereby sign the following resolution"), shell);
  const voting = render("all-voting-shareholders-resolution");
  assert.ok(voting.includes("The undersigned, being all the voting shareholders of the Company, hereby sign the following resolution"), voting);
  assert.ok(voting.includes("as permitted under the Business Corporations Act (British Columbia)."));
  for (const packet of CORPORATION_DOCUMENT_PACKETS) {
    const text = renderSections(packet.sections, bcCtx as unknown as Record<string, unknown>).flatMap((s) => s.body).join("\n");
    assert.ok(!/being\s+of /.test(text), `${packet.key}: no empty body noun ("being  of")`);
    assert.ok(!text.includes("share(s)"), `${packet.key}: no "share(s)"`);
  }
}

// --- Society packets: no regression in the society vocabulary -------------------
{
  const societyPeople = [
    { roleType: "director", fullName: "Avery Chen", gender: "F", endDate: null },
    { roleType: "director", fullName: "Morgan Patel", gender: "M", endDate: null },
    { roleType: "director", fullName: "Former Person", gender: "M", startDate: "2019-01-01", endDate: "2024-01-01" },
    { roleType: "member", fullName: "Sam Lee", gender: "M", endDate: null },
  ];
  const socCtx = buildSocietyRenderContext(society, societyPeople, "2026-01-15");
  assert.equal(socCtx.org.legislation, "Societies Act", "societies keep the Societies Act name");
  assert.equal(socCtx.dir.count, 2);
  assert.equal(socCtx.members.count, 1);
  assert.equal(socCtx.shareholders.count, 0);
  for (const packet of SOCIETY_DOCUMENT_PACKETS) {
    const text = renderSections(packet.sections, socCtx as unknown as Record<string, unknown>).flatMap((s) => s.body).join("\n");
    assert.ok(!/\{[#/a-zA-Z.]/.test(text), `${packet.key}: all society tokens bind`);
    assert.ok(!/shareholder|Business Corporations Act/i.test(text), `${packet.key}: no corporate wording in a society packet`);
  }
  // Backdated society documents read the board as at the date.
  assert.equal(buildSocietyRenderContext(society, societyPeople, "2023-06-01").dir.count, 3);
}

console.log("OK packet-grammar");
