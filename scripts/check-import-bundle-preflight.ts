import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertImportBundlePreflight,
  IMPORT_BUNDLE_COLLECTION_GROUPS,
  importBundlePreflightIssues,
} from "../shared/importBundlePreflight";

// Guard catalog drift against the actual parser, including aliases.
const parser = readFileSync(new URL("../shared/functions/importSessionHelpers/importSessionRecordKinds.ts", import.meta.url), "utf8")
  .split("function makeRecord")[0];
const parsedKeys = [...parser.matchAll(/bundle\?\.([A-Za-z]+)/g)].map((match) => match[1]);
assert.deepEqual([...IMPORT_BUNDLE_COLLECTION_GROUPS.flat()].sort(), parsedKeys.sort());

assertImportBundlePreflight({ metadata: { createdFrom: "Google Drive" }, sources: [{ externalSystem: "gdrive", externalId: "gdrive:123", title: "Minutes" }], organizationAddresses: [{ city: "Victoria", street: "Example" }] });
assertImportBundlePreflight({ representatives: [{ fullName: "Example Person" }] });
assertImportBundlePreflight({ meetingMinutes: [{ actionItems: [" Follow up "] }] });
assertImportBundlePreflight({ organizationIdentifiers: [{ number: "123" }], taxRegistrations: [{ number: "456" }] });
assert.throws(() => assertImportBundlePreflight({ sources: [], agreements: [{ title: "Example" }] }), /agreements: unsupported/);
assert.throws(() => assertImportBundlePreflight({ sources: {} }), /expected an array/);
assert.throws(() => assertImportBundlePreflight({ sources: [null] }), /expected a record object/);
assert.throws(() => assertImportBundlePreflight({ sources: [] }), /no supported records/);
assert.throws(() => assertImportBundlePreflight({ roleHolders: [], representatives: [{ fullName: "Example" }] }), /alias collision/);
assert.throws(() => assertImportBundlePreflight({ sources: [{ externalId: "gdrive:1", pageNumber: 3 }] }), /sources\[0\].pageNumber: normalization would discard/);
assert.throws(() => assertImportBundlePreflight({ grants: [{ amountRequestedCents: "not money" }] }), /amountRequestedCents: normalization would discard/);
assert.throws(() => assertImportBundlePreflight({ grants: [{ sourceExternalIds: "gdrive:1" }] }), /expected structured data/);
assert.throws(() => assertImportBundlePreflight({ meetingMinutes: [{ motions: [{ motionText: "Motion", unsupportedVoteDetail: "x" }] }] }), /motions\[0\].unsupportedVoteDetail/);
assert.throws(() => assertImportBundlePreflight({ meetingMinutes: [{ detailedAttendance: [{ roleTitle: "Chair" }] }] }), /detailedAttendance/);
assert.equal(importBundlePreflightIssues({ grants: [{ title: " Example ", amountRequestedCents: "1200", sourceExternalIds: ["gdrive:1"] }] }).length, 0);
const citation={sourceExternalIds:['drive:source'],sourceReference:'Source row'};
assertImportBundlePreflight({meetingMinutes:[{
 attendanceEvents:[{id:'a',kind:'present',personName:'Source person',boundary:'Opening',...citation}],
 quorumCheckpoints:[{id:'q',scope:'meeting',assertion:'confirmed',eligibleCount:3,eligiblePopulation:5,...citation}],
 consentItems:[{id:'c',outcome:'pending',...citation}],conditionalDecisions:[{id:'d',outcome:'Carried',...citation}],
 decisionRequirements:[{id:'r',decisionId:'d',kind:'condition',state:'unknown',...citation}],
 futureMeetingSuggestions:[{id:'s',status:'tbc',date:'2026-05',...citation}],
}]});
assert.throws(()=>assertImportBundlePreflight({meetingMinutes:[{attendanceEvents:[{id:'a',personName:'Missing event kind',boundary:'Opening',...citation}]}]}),/could not normalize/);
assert.throws(()=>assertImportBundlePreflight({meetingMinutes:[{unknownEvidence:[{id:'unsupported'}]}]}),/unknownEvidence: normalization would discard/);
console.log("Import bundle preflight checks passed.");
