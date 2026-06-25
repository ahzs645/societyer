import assert from "node:assert/strict";

import {
  buildExecutionBlock,
  resolvingBodyFor,
  type SignerLine,
} from "../shared/executionBlock";
import { corporationPacketDocxBytes } from "../shared/corporationPacketDocx";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";

/**
 * #1 Execution/signature block: the adoption clause + signature page that turns
 * a generated resolution from a checklist into a signable instrument. Grammar
 * (sole vs all, adopt vs adopts, resolution vs resolutions) and the corporate
 * "By:" signatory branch are covered, plus the DOCX integration.
 */

// --- resolving body from requiredSigners tags --------------------------------
assert.equal(resolvingBodyFor(["all_directors"]).noun, "director");
assert.equal(resolvingBodyFor(["directors___entering", "all_directors"]).noun, "director");
assert.equal(resolvingBodyFor(["all_voting_shareholders"]).noun, "voting shareholder");
assert.equal(resolvingBodyFor(["all_shareholders"]).noun, "shareholder");
assert.equal(resolvingBodyFor(["officer___president"]).noun, "officer");
assert.deepEqual(resolvingBodyFor(["all_shareholders"]).roleTypes, ["shareholder"]);
// default → directors
assert.equal(resolvingBodyFor([]).noun, "director");

// --- sole director, single resolution ----------------------------------------
const sole = buildExecutionBlock({
  shortName: "Acme",
  legislation: "Business Corporations Act",
  noun: "director",
  resolutionsPlural: false,
  signers: [{ name: "Dana Wells", capacity: "Director" }],
  dateLong: "June 25, 2026",
});
assert.equal(
  sole.adoptionClause,
  "The undersigned, being the sole director of Acme, hereby adopts the foregoing resolution pursuant to the provisions of the Business Corporations Act.",
);
assert.equal(sole.lines[0], "Dated: June 25, 2026");
assert.ok(sole.lines.some((l) => l.includes("____")), "a signature rule line is present");
assert.ok(sole.lines.some((l) => l === "Dana Wells, Director"), "printed name + capacity");

// --- multiple directors, multiple resolutions --------------------------------
const board = buildExecutionBlock({
  shortName: "Acme",
  legislation: "Business Corporations Act",
  noun: "director",
  resolutionsPlural: true,
  signers: [
    { name: "Dana Wells", capacity: "Director" },
    { name: "Sam Okoro", capacity: "Director" },
  ],
});
assert.equal(
  board.adoptionClause,
  "The undersigned, being all the directors of Acme, hereby adopt the foregoing resolutions pursuant to the provisions of the Business Corporations Act.",
);
// two signature rules for two signatories
assert.equal(board.lines.filter((l) => l.includes("____")).length, 2);

// --- corporate signatory renders a "By:" block over the corporation name -----
const corp = buildExecutionBlock({
  shortName: "Acme",
  legislation: "Business Corporations Act",
  noun: "voting shareholder",
  resolutionsPlural: false,
  signers: [
    { name: "Jordan Vane", capacity: "President", corpSign: "Vane Holdings Ltd." } as SignerLine,
  ],
});
assert.ok(corp.lines.includes("Vane Holdings Ltd."), "corporation name printed");
assert.ok(corp.lines.some((l) => l.startsWith("By: ")), "By: signature line for corporate signer");
assert.ok(corp.lines.some((l) => l.trim() === "Jordan Vane, President"), "authorized signatory beneath");
// a single corporate signatory is still grammatically "the sole voting shareholder … adopts"
assert.ok(corp.adoptionClause.includes("the sole voting shareholder"));

// --- DOCX integration: execution prose appears in the generated document -----
const packet = CORPORATION_DOCUMENT_PACKETS[0];
const withExec = Buffer.from(
  corporationPacketDocxBytes(packet, { execution: board } as unknown as Record<string, unknown>),
).toString("latin1");
assert.ok(withExec.includes("Execution"), "Execution heading present");
assert.ok(
  withExec.includes("being all the directors of Acme"),
  "adoption clause rendered into the DOCX",
);

// --- no execution field → unchanged (back-compat) ----------------------------
const plain = Buffer.from(corporationPacketDocxBytes(packet)).toString("latin1");
assert.ok(!plain.includes("hereby adopt"), "no execution block when none supplied");

console.log("OK execution-block");
