import assert from "node:assert/strict";
import { bcRegistryFilingHistoryBundle, bcRegistryGovernanceDocumentsBundle } from "../server/integrations/bc-registry-staging";
import { gcosProjectSnapshotImportBundle } from "../server/integrations/gcos-staging";
import { waveTransactionsImportBundle } from "../server/integrations/wave-staging";

const waveBundle = waveTransactionsImportBundle(
  { businessId: "biz_123", profileKey: "wave-demo" },
  {
    accounts: [{ externalId: "acct_1", name: "Operating" }],
    transactions: [
      {
        externalId: "txn_1",
        accountExternalId: "acct_1",
        date: "2026-04-30",
        description: "Membership dues",
        amountCents: 5000,
        counterparty: "Member A",
        category: "Revenue",
      },
    ],
  },
);
assert.equal(waveBundle.metadata.sourceSystem, "wave");
assert.equal(waveBundle.transactionCandidates.length, 1);
assert.equal(waveBundle.transactionCandidates[0].accountName, "Operating");
assert.equal(waveBundle.transactionCandidates[0].status, "NeedsReview");
assert.deepEqual(waveBundle.transactionCandidates[0].sourceExternalIds, [
  "wave:transaction:txn_1",
  "wave:account:acct_1",
]);

const gcosBundle = gcosProjectSnapshotImportBundle(
  {
    title: "Community services grant",
    status: "Agreement",
    sourceExternalIds: ["gcos:project:ABC"],
  },
  {
    projectId: "ABC",
    programCode: "ESDC",
    currentUrl: "https://example.test/gcos/project/ABC",
  },
);
assert.equal(gcosBundle.metadata.sourceSystem, "gcos");
assert.equal(gcosBundle.sources[0].externalId, "gcos:project:ABC");
assert.equal(gcosBundle.grants.length, 1);
assert.ok(gcosBundle.grants[0].riskFlags.some((flag: string) => flag.includes("Review imported GCOS data")));

const filingBundle = bcRegistryFilingHistoryBundle(
  "S0048345",
  [
    {
      kind: "Annual Report",
      dateFiled: "2026-01-15",
      eventId: "event_1",
      confirmationNumber: "CNF123",
    },
  ],
  [
    {
      Filing: "Annual Report",
      EventId: "event_1",
      "Date Filed": "2026-01-15",
      Filename: "annual-report.pdf",
    },
  ],
  { publicDirectory: "/tmp/export" },
);
assert.equal(filingBundle.metadata.sourceSystem, "bc-registry");
assert.equal(filingBundle.filings.length, 1);
assert.equal(filingBundle.filings[0].status, "NeedsReview");
assert.equal(filingBundle.sourceEvidence.length, 1);
assert.ok(filingBundle.sourceEvidence[0].sourceExternalIds.includes("bc-registry:event:event_1"));

const governanceBundle = bcRegistryGovernanceDocumentsBundle(
  "S0048345",
  [
    {
      kind: "bylaws",
      title: "Society bylaws",
      category: "Bylaws",
      fileName: "bylaws.pdf",
      sourcePath: "/tmp/export/bylaws.pdf",
      eventId: "event_2",
      dateFiled: "2026-02-01",
    },
  ],
  { publicDirectory: "/tmp/export" },
);
assert.equal(governanceBundle.sources.length, 1);
assert.equal(governanceBundle.documentMap.length, 1);
assert.equal(governanceBundle.documentMap[0].externalId, "bc-registry:event:event_2");

console.log("Integration staging bundle checks passed.");
