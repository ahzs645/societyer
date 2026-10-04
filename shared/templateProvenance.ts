import { isCorporation, isSociety, homeJurisdictionCode, type LegalEntityLike } from "./organizationDomain";
import { CORPORATION_DOCUMENT_PACKETS, type CorporationDocumentPacket } from "./corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "./societyDocumentPackets";
import { pathwayForPacket } from "./pathways/registry";

/** A selected key must not bypass the entity-specific catalog. */
export function assertPacketCompatible(entity: (LegalEntityLike & { legalSubtype?: string }) | null | undefined, packet: CorporationDocumentPacket): void {
  if (!entity) throw new Error("The document's legal entity could not be found.");
  const corporate = CORPORATION_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key);
  const society = SOCIETY_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key);
  if ((corporate && !isCorporation(entity)) || (society && !isSociety(entity))) {
    throw new Error("This document template does not apply to the selected entity type.");
  }
  pathwayForPacket(entity, packet);

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
