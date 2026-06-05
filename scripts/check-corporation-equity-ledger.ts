import {
  deriveCurrentHoldings,
  holdingQuantity,
  materializeRightsHoldings,
  summarizeRightsClass,
  validateLedger,
  validateTransferQuantityAvailable,
  type RightsholdingTransferRecord,
  type RightsClassRecord,
} from "../src/lib/equity";
import { StaticConvexClient } from "../src/lib/staticConvex";

function expectThrows(label: string, fn: () => unknown) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label} should have thrown.`);
}

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

const rightsClass: RightsClassRecord = {
  societyId: "society-1",
  className: "Class A Common Shares",
  classType: "share",
  status: "active",
  sourceDocumentIds: [],
  sourceExternalIds: [],
  createdAtISO: "2026-01-01T00:00:00.000Z",
  updatedAtISO: "2026-01-01T00:00:00.000Z",
};

const baseTransfer = {
  societyId: "society-1",
  status: "posted",
  rightsClassId: "rights-class-a",
  sourceDocumentIds: [],
  sourceExternalIds: [],
  createdAtISO: "2026-01-01T00:00:00.000Z",
  updatedAtISO: "2026-01-01T00:00:00.000Z",
} satisfies Partial<RightsholdingTransferRecord>;

const transfers: RightsholdingTransferRecord[] = [
  {
    ...baseTransfer,
    transferType: "issuance",
    transferDate: "2026-01-02",
    destinationRoleHolderId: "holder-alice",
    quantity: 100,
  },
  {
    ...baseTransfer,
    transferType: "transfer",
    transferDate: "2026-01-03",
    sourceRoleHolderId: "holder-alice",
    destinationRoleHolderId: "holder-bob",
    quantity: 25,
  },
  {
    ...baseTransfer,
    transferType: "cancellation",
    transferDate: "2026-01-04",
    sourceRoleHolderId: "holder-bob",
    quantity: 5,
  },
  {
    ...baseTransfer,
    transferType: "conversion",
    transferDate: "2026-01-05",
    sourceRoleHolderId: "holder-alice",
    destinationRoleHolderId: "holder-charlie",
    quantity: 10,
  },
];

expectEqual("rights class summary", summarizeRightsClass(rightsClass), {
  className: "Class A Common Shares",
  classType: "share",
  status: "active",
  isShareClass: true,
  isActive: true,
});

validateLedger(transfers);

expectEqual("current holdings", deriveCurrentHoldings(transfers), [
  {
    rightsClassId: "rights-class-a",
    holderKey: "roleHolder:holder-alice",
    quantity: 65,
  },
  {
    rightsClassId: "rights-class-a",
    holderKey: "roleHolder:holder-bob",
    quantity: 20,
  },
  {
    rightsClassId: "rights-class-a",
    holderKey: "roleHolder:holder-charlie",
    quantity: 10,
  },
]);

const materialized = materializeRightsHoldings(transfers.map((transfer, index) => ({ ...transfer, _id: `transfer-${index}` })));
expectEqual("materialized holding source links", materialized[0].sourceExternalIds.includes("societyer:rightsholding-transfer:transfer-0"), true);

expectEqual(
  "alice holding quantity",
  holdingQuantity(transfers, "rights-class-a", "roleHolder:holder-alice"),
  65,
);

expectThrows("over-transfer", () => validateTransferQuantityAvailable(transfers, {
  ...baseTransfer,
  transferType: "transfer",
  transferDate: "2026-01-05",
  sourceRoleHolderId: "holder-bob",
  destinationRoleHolderId: "holder-alice",
  quantity: 21,
}));

expectThrows("negative holding", () => validateLedger([
  {
    ...baseTransfer,
    transferType: "cancellation",
    transferDate: "2026-01-06",
    sourceRoleHolderId: "holder-alice",
    quantity: 1,
  },
]));

const client = new StaticConvexClient({
  databaseName: `societyer-static-corp-equity-${Date.now()}`,
  seed: { societies: [] },
});
const created = await client.mutation("society:createWorkspace", {
  name: "Northstar Materialized Holdings Inc.",
  incorporationNumber: "123456-7",
  incorporationDate: "2026-01-01",
  jurisdictionCode: "CA-FED-CBCA",
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
});
const holderId = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId: created.societyId,
  roleType: "shareholder",
  status: "current",
  fullName: "Ava Holder",
});
const classId = await client.mutation("legalOperations:upsertRightsClass", {
  societyId: created.societyId,
  className: "Common shares",
  classType: "share",
  status: "active",
});
const issuanceId = await client.mutation("legalOperations:upsertRightsholdingTransfer", {
  societyId: created.societyId,
  transferType: "issuance",
  status: "posted",
  transferDate: "2026-01-02",
  rightsClassId: classId,
  destinationRoleHolderId: holderId,
  quantity: 100,
});
const ledger = await client.query("legalOperations:rightsLedger", { societyId: created.societyId });
expectEqual("materialized static holdings count", ledger.holdings.length, 1);
expectEqual("materialized static holding quantity", ledger.holdings[0].quantity, 100);
expectEqual("materialized static holding class", ledger.holdings[0].rightsClassId, classId);
expectEqual("materialized static holding holder", ledger.holdings[0].holderRoleHolderId, holderId);
expectEqual("materialized static holding last transaction", ledger.holdings[0].lastTransactionId, issuanceId);

console.log("Corporation equity ledger checks passed.");
