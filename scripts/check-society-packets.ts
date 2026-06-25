import assert from "node:assert/strict";

import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import type { RenderContextOrg } from "../shared/renderContext";

/**
 * Society document packets render through the SAME grammar-aware DOCX generator
 * as corporations, but bind society vocabulary ("members", "Societies Act").
 * This is the society-view analog of check-packet-grammar.ts.
 */

// Structural sanity: unique keys, non-empty sections.
const keys = new Set<string>();
for (const p of SOCIETY_DOCUMENT_PACKETS) {
  assert.ok(p.key && !keys.has(p.key), `duplicate/empty packet key: ${p.key}`);
  keys.add(p.key);
  assert.ok(p.sections.length > 0 && p.sections[0].body.length > 0, `${p.key} has no body`);
}
assert.ok(keys.has("society-special-resolution"));
assert.ok(keys.has("society-annual-general-meeting"));

const society: RenderContextOrg = {
  entityType: "society",
  actFormedUnder: "societies_act",
  legalName: "Riverbend Community Society",
  shortName: "Riverbend",
  jurisdictionCode: "CA-BC",
};
const ctx = buildSocietyRenderContext(
  society,
  [
    { roleType: "director", fullName: "Avery Chen", gender: "F", endDate: null },
    { roleType: "director", fullName: "Morgan Patel", gender: "M", endDate: null },
    { roleType: "member", fullName: "Sam Lee", gender: "M", endDate: null },
  ],
  "2026-01-15",
);
assert.equal(ctx.org.legislation, "Societies Act");

function docxText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

// Directors' resolution: multiple directors → "all the directors ... adopt".
const dirRes = SOCIETY_DOCUMENT_PACKETS.find((p) => p.key === "society-directors-resolution")!;
const dirText = docxText(corporationPacketDocxBytes(dirRes, ctx as unknown as Record<string, unknown>));
assert.ok(dirText.includes("all the directors of Riverbend hereby adopt the following resolution pursuant to the Societies Act."), "directors' resolution binds society grammar");
assert.ok(!dirText.includes("{org.shortName}"), "no raw tokens remain");

// Appointment: lists directors and uses society legislation.
const appt = SOCIETY_DOCUMENT_PACKETS.find((p) => p.key === "society-appoint-directors")!;
const apptText = docxText(corporationPacketDocxBytes(appt, ctx as unknown as Record<string, unknown>));
assert.ok(apptText.includes("appointed as directors of Riverbend pursuant to the Societies Act:"));
assert.ok(apptText.includes("Avery Chen") && apptText.includes("Morgan Patel"));

console.log("OK society-packets");
