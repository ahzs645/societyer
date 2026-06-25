import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib"; // not used; stored zip is uncompressed

import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { renderSections } from "../shared/packetRendering";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";

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
const basePacket = CORPORATION_DOCUMENT_PACKETS[0];
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

console.log("OK packet-grammar");
