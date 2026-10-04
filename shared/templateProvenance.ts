import { isCorporation, isSociety, homeJurisdictionCode, canonicalizeJurisdictionCode, type LegalEntityLike } from "./organizationDomain";
import { CORPORATION_DOCUMENT_PACKETS, type CorporationDocumentPacket } from "./corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "./societyDocumentPackets";
import { entityPreparationDecision } from "./entitySetup";

/** A selected key must not bypass the entity-specific catalog. */
export function assertPacketCompatible(entity: (LegalEntityLike & { legalSubtype?: string }) | null | undefined, packet: CorporationDocumentPacket): void {
  if (!entity) throw new Error("The document's legal entity could not be found.");
  const route = entityPreparationDecision(entity);
  if (!route.allowed) throw new Error(route.message);
  const preparationJurisdictions: Record<string, string> = {
    "society-incorporation-constitution": "CA-BC",
    "society-incorporation-bylaws": "CA-BC",
    "bc-incorporation-agreement": "CA-BC",
    "bc-articles-preparation": "CA-BC",
    "federal-articles-preparation": "CA-FED-CBCA",
  };
  const requiredJurisdiction = preparationJurisdictions[packet.key];
  if (requiredJurisdiction && canonicalizeJurisdictionCode(homeJurisdictionCode(entity)) !== requiredJurisdiction) {
    throw new Error("This incorporation template does not apply to the selected home jurisdiction.");
  }
  const corporate = CORPORATION_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key);
  const society = SOCIETY_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key);
  if ((corporate && !isCorporation(entity)) || (society && !isSociety(entity))) {
    throw new Error("This document template does not apply to the selected entity type.");
  }
  const subtype = entity.legalSubtype;
  if (corporate && subtype && !["ordinary_private_company", "federal_private_corporation"].includes(subtype)) {
    throw new Error("This company subtype requires a separately reviewed document template.");
  }
  if (corporate && String(entity.entityType ?? "").includes("nfp")) {
    throw new Error("Business corporation templates do not apply to a not-for-profit corporation.");
  }
}

export function packetProvenance(entity: LegalEntityLike, packet: CorporationDocumentPacket) {
  return {
    templateId: packet.key,
    templateVersion: "societyer-catalog-2026-10-03",
    sourceKind: "original_application_draft",
    source: "Societyer document packet catalog",
    jurisdiction: homeJurisdictionCode(entity),
    entityType: entity.entityType ?? entity.kind ?? "unknown",
    legalReviewState: "requires_entity_specific_review",
    documentState: "draft",
    reuseConditions: "Review the source terms and governing documents before adoption; official forms are linked separately in Research library.",
    // Preserve the actual source used so future catalog edits cannot change history.
    templateSnapshot: packet,
    adoptionEvidence: null,
    signatureEvidence: null,
    filingEvidence: null,
  };
}

export function packetDataWithProvenance(dataJson: string | undefined, entity: LegalEntityLike, packet: CorporationDocumentPacket): string {
  const data = dataJson ? JSON.parse(dataJson) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Packet data must be an object.");
  return JSON.stringify({ ...data, templateProvenance: packetProvenance(entity, packet) });
}
