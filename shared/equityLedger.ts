export type RightsClassStatus = "active" | "proposed" | "inactive" | "needs_review" | string;
export type RightsClassType = "membership" | "voting" | "non_voting" | "unit" | "share" | "other" | string;

export type RightsClassRecord = {
  societyId: string;
  className: string;
  classType: RightsClassType;
  status: RightsClassStatus;
  idPrefix?: string;
  highestAssignedNumber?: number;
  votingRights?: string;
  startDate?: string;
  endDate?: string;
  conditionsToHold?: string;
  conditionsToTransfer?: string;
  conditionsForRemoval?: string;
  otherProvisions?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
  notes?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export type RightsholdingTransferType =
  | "issuance"
  | "transfer"
  | "redemption"
  | "cancellation"
  | "conversion"
  | "adjustment"
  | "other"
  | string;

export type RightsholdingTransferStatus = "draft" | "posted" | "void" | "needs_review" | string;

export type RightsholdingTransferRecord = {
  societyId: string;
  transferType: RightsholdingTransferType;
  status: RightsholdingTransferStatus;
  transferDate?: string;
  eventId?: string;
  precedentRunId?: string;
  rightsClassId?: string;
  sourceRoleHolderId?: string;
  destinationRoleHolderId?: string;
  sourceHolderName?: string;
  destinationHolderName?: string;
  quantity?: number;
  considerationType?: string;
  considerationDescription?: string;
  priceToOrganizationCents?: number;
  priceToOrganizationCurrency?: string;
  priceToVendorCents?: number;
  priceToVendorCurrency?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
  notes?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export type RightsClassSummary = {
  className: string;
  classType: RightsClassType;
  status: RightsClassStatus;
  isShareClass: boolean;
  isActive: boolean;
};

export type HoldingKey = {
  rightsClassId: string;
  holderKey: string;
};

export type CurrentHolding = HoldingKey & {
  quantity: number;
};

export type MaterializedRightsHolding = CurrentHolding & {
  societyId: string;
  status: "current";
  holderRoleHolderId?: string;
  lastTransactionId?: string;
  sourceDocumentIds: string[];
  sourceExternalIds: string[];
};

export type EquityLedgerOptions = {
  includeStatuses?: RightsholdingTransferStatus[];
};

const DEFAULT_LEDGER_STATUSES = new Set<RightsholdingTransferStatus>(["posted"]);

export function summarizeRightsClass(rightsClass: RightsClassRecord): RightsClassSummary {
  return {
    className: rightsClass.className,
    classType: rightsClass.classType,
    status: rightsClass.status,
    isShareClass: rightsClass.classType === "share",
    isActive: rightsClass.status === "active",
  };
}

export function activeRightsClasses(rightsClasses: RightsClassRecord[]): RightsClassRecord[] {
  return rightsClasses.filter((rightsClass) => rightsClass.status === "active");
}

export function isTransferPosted(transfer: RightsholdingTransferRecord): boolean {
  return transfer.status === "posted";
}

export function deriveCurrentHoldings(
  transfers: RightsholdingTransferRecord[],
  options: EquityLedgerOptions = {},
): CurrentHolding[] {
  const includedStatuses = options.includeStatuses
    ? new Set<RightsholdingTransferStatus>(options.includeStatuses)
    : DEFAULT_LEDGER_STATUSES;
  const balances = new Map<string, CurrentHolding>();

  for (const transfer of transfers) {
    if (!includedStatuses.has(transfer.status)) {
      continue;
    }

    for (const movement of transferMovements(transfer)) {
      const balanceKey = serializeHoldingKey(movement);
      const existing = balances.get(balanceKey) ?? {
        rightsClassId: movement.rightsClassId,
        holderKey: movement.holderKey,
        quantity: 0,
      };
      existing.quantity += movement.quantityDelta;
      balances.set(balanceKey, existing);
    }
  }

  return Array.from(balances.values())
    .filter((holding) => holding.quantity !== 0)
    .sort((left, right) => {
      const classSort = left.rightsClassId.localeCompare(right.rightsClassId);
      return classSort === 0 ? left.holderKey.localeCompare(right.holderKey) : classSort;
    });
}

export function materializeRightsHoldings(transfers: (RightsholdingTransferRecord & { _id?: string })[]): MaterializedRightsHolding[] {
  const postedTransfers = transfers.filter(isTransferPosted);
  const currentHoldings = deriveCurrentHoldings(postedTransfers);
  return currentHoldings.map((holding) => {
    const relatedTransfers = postedTransfers.filter((transfer) =>
      transferMovements(transfer).some(
        (movement) => movement.rightsClassId === holding.rightsClassId && movement.holderKey === holding.holderKey,
      ),
    );
    const lastTransfer = relatedTransfers[relatedTransfers.length - 1];
    return {
      ...holding,
      societyId: String(lastTransfer?.societyId ?? ""),
      status: "current",
      holderRoleHolderId: holding.holderKey.startsWith("roleHolder:")
        ? holding.holderKey.slice("roleHolder:".length)
        : undefined,
      lastTransactionId: lastTransfer?._id,
      sourceDocumentIds: uniqueStrings(relatedTransfers.flatMap((transfer) => transfer.sourceDocumentIds ?? [])),
      sourceExternalIds: uniqueStrings([
        ...relatedTransfers.flatMap((transfer) => transfer.sourceExternalIds ?? []),
        ...relatedTransfers.map((transfer) => transfer._id ? `societyer:rightsholding-transfer:${transfer._id}` : undefined),
      ]),
    };
  });
}

export function validateNoNegativeHoldings(transfers: RightsholdingTransferRecord[]): void {
  const runningBalances = new Map<string, number>();

  for (const transfer of transfers) {
    if (!isTransferPosted(transfer)) {
      continue;
    }

    for (const movement of transferMovements(transfer)) {
      const balanceKey = serializeHoldingKey(movement);
      const nextBalance = (runningBalances.get(balanceKey) ?? 0) + movement.quantityDelta;
      if (nextBalance < 0) {
        throw new Error(
          `Transfer would create negative holding for ${movement.holderKey} in rights class ${movement.rightsClassId}.`,
        );
      }
      runningBalances.set(balanceKey, nextBalance);
    }
  }
}

export function validateTransferQuantityAvailable(
  priorTransfers: RightsholdingTransferRecord[],
  transfer: RightsholdingTransferRecord,
): void {
  if (!isTransferPosted(transfer) || transfer.transferType !== "transfer") {
    return;
  }

  const rightsClassId = requireRightsClassId(transfer);
  const sourceHolderKey = requireHolderKey(transfer, "source");
  const quantity = requirePositiveQuantity(transfer);
  const sourceBalance = holdingQuantity(priorTransfers, rightsClassId, sourceHolderKey);

  if (quantity > sourceBalance) {
    throw new Error(
      `Transfer quantity ${quantity} exceeds source balance ${sourceBalance} for ${sourceHolderKey} in rights class ${rightsClassId}.`,
    );
  }
}

export function validateLedger(transfers: RightsholdingTransferRecord[]): void {
  const acceptedTransfers: RightsholdingTransferRecord[] = [];

  for (const transfer of transfers) {
    validateTransferQuantityAvailable(acceptedTransfers, transfer);
    if (isTransferPosted(transfer)) {
      transferMovements(transfer);
      acceptedTransfers.push(transfer);
    }
  }

  validateNoNegativeHoldings(transfers);
}

export function holdingQuantity(
  transfers: RightsholdingTransferRecord[],
  rightsClassId: string,
  holderKey: string,
): number {
  return deriveCurrentHoldings(transfers).find(
    (holding) => holding.rightsClassId === rightsClassId && holding.holderKey === holderKey,
  )?.quantity ?? 0;
}

type HoldingMovement = HoldingKey & {
  quantityDelta: number;
};

function transferMovements(transfer: RightsholdingTransferRecord): HoldingMovement[] {
  switch (transfer.transferType) {
    case "issuance":
      return [{
        rightsClassId: requireRightsClassId(transfer),
        holderKey: requireHolderKey(transfer, "destination"),
        quantityDelta: requirePositiveQuantity(transfer),
      }];
    case "transfer": {
      const rightsClassId = requireRightsClassId(transfer);
      const quantity = requirePositiveQuantity(transfer);
      return [
        {
          rightsClassId,
          holderKey: requireHolderKey(transfer, "source"),
          quantityDelta: -quantity,
        },
        {
          rightsClassId,
          holderKey: requireHolderKey(transfer, "destination"),
          quantityDelta: quantity,
        },
      ];
    }
    case "cancellation":
    case "redemption":
      return [{
        rightsClassId: requireRightsClassId(transfer),
        holderKey: requireHolderKey(transfer, "source"),
        quantityDelta: -requirePositiveQuantity(transfer),
      }];
    case "conversion":
    case "adjustment":
      return adjustmentMovements(transfer);
    default:
      return [];
  }
}

function adjustmentMovements(transfer: RightsholdingTransferRecord): HoldingMovement[] {
  const rightsClassId = requireRightsClassId(transfer);
  const quantity = requirePositiveQuantity(transfer);
  const sourceHolderKey = holderKey(transfer, "source");
  const destinationHolderKey = holderKey(transfer, "destination");

  if (sourceHolderKey && destinationHolderKey) {
    return [
      { rightsClassId, holderKey: sourceHolderKey, quantityDelta: -quantity },
      { rightsClassId, holderKey: destinationHolderKey, quantityDelta: quantity },
    ];
  }

  if (sourceHolderKey) {
    return [{ rightsClassId, holderKey: sourceHolderKey, quantityDelta: -quantity }];
  }

  if (destinationHolderKey) {
    return [{ rightsClassId, holderKey: destinationHolderKey, quantityDelta: quantity }];
  }

  throw new Error("Adjustment requires a source or destination holder.");
}

function requireRightsClassId(transfer: RightsholdingTransferRecord): string {
  if (!transfer.rightsClassId) {
    throw new Error(`${transfer.transferType} requires rightsClassId.`);
  }
  return transfer.rightsClassId;
}

function requirePositiveQuantity(transfer: RightsholdingTransferRecord): number {
  if (typeof transfer.quantity !== "number" || !Number.isFinite(transfer.quantity) || transfer.quantity <= 0) {
    throw new Error(`${transfer.transferType} requires a positive quantity.`);
  }
  return transfer.quantity;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function requireHolderKey(transfer: RightsholdingTransferRecord, side: "source" | "destination"): string {
  const key = holderKey(transfer, side);
  if (!key) {
    throw new Error(`${transfer.transferType} requires a ${side} holder.`);
  }
  return key;
}

function holderKey(transfer: RightsholdingTransferRecord, side: "source" | "destination"): string | undefined {
  const roleHolderId = side === "source" ? transfer.sourceRoleHolderId : transfer.destinationRoleHolderId;
  const holderName = side === "source" ? transfer.sourceHolderName : transfer.destinationHolderName;
  return roleHolderId ? `roleHolder:${roleHolderId}` : holderName ? `name:${holderName}` : undefined;
}

function serializeHoldingKey(holding: HoldingKey): string {
  return `${holding.rightsClassId}\u0000${holding.holderKey}`;
}
