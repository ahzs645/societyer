/**
 * Document-packet seeding for the static (offline/demo) Convex mirror, extracted
 * from src/lib/staticConvex.ts (modularizing the mirror beyond the YCN slice).
 * staticConvex.ts imports and delegates to these. Structural store type keeps the
 * module decoupled from the mirror's internal classes.
 */
import { SOCIETY_ID } from "./staticConvexFixtures";
import {
  CORPORATION_DOCUMENT_PACKETS,
  corporationPacketEntityTypes,
  corporationPacketTemplateHtml,
} from "../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS, societyPacketEntityTypes } from "../../shared/societyDocumentPackets";

type DocStoreLike = {
  transaction: (fn: () => void) => void;
  listRows: (table: string, args?: any) => any[];
  upsertRow: (table: string, row: any) => void;
  getRow: (table: string, id?: any) => any;
} | null | undefined;

export function staticSeedCorporationDocumentPackets(store: DocStoreLike, args: any) {
  return staticSeedDocumentPackets(store, args, CORPORATION_DOCUMENT_PACKETS, {
    markerKind: "corporation",
    entityTypes: corporationPacketEntityTypes(),
    catalogNote: "Catalog packet for corporation minute book, registers, filings, and compliance evidence.",
    owner: "Societyer corporation packet catalog",
  });
}

export function staticSeedSocietyDocumentPackets(store: DocStoreLike, args: any) {
  return staticSeedDocumentPackets(store, args, SOCIETY_DOCUMENT_PACKETS, {
    markerKind: "society",
    entityTypes: societyPacketEntityTypes(),
    catalogNote: "Catalog packet for society minute book, registers, AGM, and Societies Act resolutions.",
    owner: "Societyer society packet catalog",
  });
}

/** Generic offline seeder mirroring convex/legalOperations seedDocumentPacketCatalog. */
export function staticSeedDocumentPackets(
  store: DocStoreLike,
  args: any,
  packets: typeof CORPORATION_DOCUMENT_PACKETS,
  opts: { markerKind: string; entityTypes: string[]; catalogNote: string; owner: string },
) {
  const now = new Date().toISOString();
  const societyId = args?.societyId ?? SOCIETY_ID;
  const templateMarker = (packet: (typeof packets)[number]) => `societyer:${opts.markerKind}-packet-template:${packet.key}`;
  const precedentMarker = (packet: (typeof packets)[number]) => `societyer:${opts.markerKind}-packet-precedent:${packet.key}`;
  const existingTemplates = store?.listRows("legalTemplates", { societyId }) ?? [];
  const existingPrecedents = store?.listRows("legalPrecedents", { societyId }) ?? [];
  let insertedTemplates = 0;
  let updatedTemplates = 0;
  let skippedTemplates = 0;
  let insertedPrecedents = 0;
  let updatedPrecedents = 0;
  let skippedPrecedents = 0;
  const templateIdByPacketKey = new Map<string, string>();

  store?.transaction(() => {
    for (const packet of packets) {
      const marker = templateMarker(packet);
      const existingByMarker = existingTemplates.find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
      const existingByName = existingTemplates.find((row: any) => String(row.name ?? "").toLowerCase() === packet.templateName.toLowerCase());
      const id = existingByMarker?._id ?? `static_legal_template_${packet.key}`;
      const payload = {
        _id: id,
        _creationTime: existingByMarker?._creationTime ?? Date.now(),
        societyId,
        templateType: "document",
        name: packet.templateName,
        status: "active",
        html: corporationPacketTemplateHtml(packet),
        notes: [packet.summary, opts.catalogNote, `Packet key: ${packet.key}`].join("\n"),
        owner: opts.owner,
        ownerIsTobuso: false,
        signatureRequired: packet.signatureRequired,
        documentTag: packet.documentTag,
        entityTypes: opts.entityTypes,
        jurisdictions: packet.jurisdictions,
        requiredSigners: packet.requiredSigners,
        requiredDataFieldIds: [],
        optionalDataFieldIds: [],
        reviewDataFieldIds: [],
        requiredDataFields: packet.requiredDataFields,
        optionalDataFields: packet.optionalDataFields,
        reviewDataFields: packet.reviewDataFields,
        timeline: packet.timeline,
        deliverable: packet.deliverable,
        terms: packet.terms,
        filingType: packet.filingType,
        priceItems: [],
        sourceExternalIds: [marker],
        createdAtISO: existingByMarker?.createdAtISO ?? now,
        updatedAtISO: now,
      };
      if (existingByMarker) {
        store.upsertRow("legalTemplates", payload);
        updatedTemplates += 1;
        templateIdByPacketKey.set(packet.key, id);
      } else if (existingByName) {
        skippedTemplates += 1;
        templateIdByPacketKey.set(packet.key, existingByName._id);
      } else {
        store.upsertRow("legalTemplates", payload);
        insertedTemplates += 1;
        templateIdByPacketKey.set(packet.key, id);
      }
    }

    const latestTemplates = store?.listRows("legalTemplates", { societyId }) ?? [];
    for (const packet of packets) {
      const marker = precedentMarker(packet);
      const existingByMarker = existingPrecedents.find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
      const existingByName = existingPrecedents.find((row: any) => String(row.packageName ?? "").toLowerCase() === packet.packageName.toLowerCase());
      const id = existingByMarker?._id ?? `static_legal_precedent_${packet.key}`;
      const templateId = templateIdByPacketKey.get(packet.key) ??
        latestTemplates.find((row: any) => String(row.name ?? "").toLowerCase() === packet.templateName.toLowerCase())?._id;
      const payload = {
        _id: id,
        _creationTime: existingByMarker?._creationTime ?? Date.now(),
        societyId,
        packageName: packet.packageName,
        partType: packet.partType,
        status: "active",
        description: packet.terms,
        shortDescription: packet.summary,
        timeline: packet.timeline,
        deliverables: packet.deliverable,
        internalNotes: `Catalog packet key: ${packet.key}`,
        addOnTerms: packet.terms,
        templateIds: templateId ? [templateId] : [],
        templateNames: [packet.templateName],
        templateFilingNames: packet.templateFilingNames ?? [],
        templateSearchNames: [],
        templateRegistrationNames: packet.templateRegistrationNames ?? [],
        requiresAmendmentRecord: packet.requiresAmendmentRecord,
        requiresAnnualMaintenanceRecord: packet.requiresAnnualMaintenanceRecord,
        priceItems: [],
        entityTypes: opts.entityTypes,
        jurisdictions: packet.jurisdictions,
        subloopPairs: [],
        sourceExternalIds: [marker],
        createdAtISO: existingByMarker?.createdAtISO ?? now,
        updatedAtISO: now,
      };
      if (existingByMarker) {
        store.upsertRow("legalPrecedents", payload);
        updatedPrecedents += 1;
      } else if (existingByName) {
        skippedPrecedents += 1;
      } else {
        store.upsertRow("legalPrecedents", payload);
        insertedPrecedents += 1;
      }
    }
  });

  return {
    insertedTemplates,
    updatedTemplates,
    skippedTemplates,
    insertedPrecedents,
    updatedPrecedents,
    skippedPrecedents,
    total: packets.length,
  };
}
