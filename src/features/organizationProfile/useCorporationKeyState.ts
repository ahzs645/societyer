import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { canonicalizeJurisdictionCode, homeJurisdictionCode } from "../../../shared/organizationDomain";
import { SECRET_IDENTIFIER_KINDS } from "./detailRows";
import { corporationKeyState, type CorporationKeyState, type VaultItemSummary } from "./registryFacts";
import type { IdentifierRow, OrganizationRecord } from "./types";

/**
 * Whether the corporation key is held in Access custody, recorded as a
 * reference only, or not stored. Reads the vault list (values are never in it).
 */
export function useCorporationKeyState(society: OrganizationRecord, identifiers: readonly IdentifierRow[]): CorporationKeyState {
  const vaultItemId = society.corporationKeyVaultItemId;
  const items = useQuery(api.secrets.list, vaultItemId ? { societyId: society._id } : "skip") as VaultItemSummary[] | undefined;
  const home = canonicalizeJurisdictionCode(homeJurisdictionCode(society));
  const legacyIdentifier = identifiers.some((identifier) => identifier.kind === "corporation_key"
    || (SECRET_IDENTIFIER_KINDS.has(identifier.kind ?? "") && canonicalizeJurisdictionCode(identifier.jurisdiction) === home));
  return corporationKeyState(vaultItemId, items, legacyIdentifier);
}
