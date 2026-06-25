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
  corporationPacketForComplianceObligation,
  corporationPacketPrecedentMarker,
  corporationPacketTemplateHtml,
} from "../../shared/corporationDocumentPackets";
import {
  corporationPacketDocxDataUrl,
  corporationPacketDocxFileName,
  corporationPacketDocxMimeType,
} from "../../shared/corporationPacketDocx";
import { SOCIETY_DOCUMENT_PACKETS, societyPacketEntityTypes } from "../../shared/societyDocumentPackets";

type DocStoreLike = {
  transaction: (fn: () => void) => void;
  listRows: (table: string, args?: any) => any[];
  upsertRow: (table: string, row: any) => void;
  getRow: (table: string, id?: any) => any;
} | null | undefined;

/** Helpers threaded from staticConvex.ts so this module stays decoupled. */
type StaticLocalId = (moduleName: string, exportName?: string) => string;
type StaticUniqueStrings = (values: Array<string | undefined>) => string[];

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

export function staticCreatePacketRunArtifacts(
  store: DocStoreLike,
  args: {
    societyId: string;
    packet: (typeof CORPORATION_DOCUMENT_PACKETS)[number];
    runId: string;
    eventId?: string;
    effectiveDate?: string;
    filingId?: string;
    signerRoleHolderIds?: string[];
    dataJson?: string;
    notes?: string;
  },
  staticLocalId: StaticLocalId,
  staticUniqueStrings: StaticUniqueStrings,
) {
  const now = new Date().toISOString();
  const run = store?.getRow("legalPrecedentRuns", args.runId);
  const signerRoleHolderIds = args.signerRoleHolderIds?.length
    ? args.signerRoleHolderIds
    : (store?.listRows("roleHolders", { societyId: args.societyId }) ?? [])
      .filter((row: any) => row.status === "current" && ["director", "officer", "authorized_representative"].includes(row.roleType))
      .map((row: any) => row._id);
  const sourceExternalIds = staticUniqueStrings([
    ...(run?.sourceExternalIds ?? []),
    `societyer:corporation-packet-run:${args.packet.key}`,
    `societyer:legal-precedent-run:${args.runId}`,
  ]);
  const society = store?.getRow("societies", args.societyId);
  const fileOpts = { shortName: society?.shortName, effectiveDate: args.effectiveDate };
  const docxDataUrl = corporationPacketDocxDataUrl(args.packet);
  const docxFileName = corporationPacketDocxFileName(args.packet, fileOpts);
  const docxMimeType = corporationPacketDocxMimeType();
  const draftDocumentId = staticLocalId("document", `${args.packet.key}_editable_docx`);
  const draftDocumentVersionId = staticLocalId("documentVersion", `${args.packet.key}_editable_docx`);
  const generatedDocumentId = staticLocalId("generatedLegalDocument", args.packet.key);
  const sourceEvidenceId = staticLocalId("sourceEvidence", args.packet.key);
  const minuteBookItemId = staticLocalId("minuteBookItem", args.packet.key);
  const signerIds: string[] = [];

  store?.transaction(() => {
    store.upsertRow("documents", {
      _id: draftDocumentId,
      _creationTime: Date.now(),
      societyId: args.societyId,
      title: `${args.packet.packageName} - editable draft`,
      category: "governance",
      fileName: docxFileName,
      mimeType: docxMimeType,
      content: corporationPacketTemplateHtml(args.packet),
      url: docxDataUrl,
      fileSizeBytes: docxDataUrl.length,
      retentionYears: 7,
      createdAtISO: now,
      reviewStatus: "needs_signature",
      librarySection: "governance",
      flaggedForDeletion: false,
      sourceExternalIds,
      sourcePayloadJson: args.dataJson,
      tags: ["corporation-packet", args.packet.key, "editable-docx"],
    });
    store.upsertRow("documentVersions", {
      _id: draftDocumentVersionId,
      _creationTime: Date.now(),
      societyId: args.societyId,
      documentId: draftDocumentId,
      version: 1,
      storageProvider: "generated-inline",
      storageKey: docxDataUrl,
      fileName: docxFileName,
      mimeType: docxMimeType,
      fileSizeBytes: docxDataUrl.length,
      uploadedByName: "Societyer packet generator",
      uploadedAtISO: now,
      changeNote: `Generated editable DOCX for ${args.packet.packageName}.`,
      isCurrent: true,
    });
    store.upsertRow("generatedLegalDocuments", {
      _id: generatedDocumentId,
      _creationTime: Date.now(),
      societyId: args.societyId,
      title: args.packet.packageName,
      status: "draft",
      draftDocumentId,
      sourceTemplateName: args.packet.templateName,
      precedentRunId: args.runId,
      eventId: args.eventId,
      effectiveDate: args.effectiveDate,
      documentTag: args.packet.documentTag,
      dataJson: args.dataJson,
      subloopJsonList: [],
      signersRequiredRoleHolderIds: signerRoleHolderIds,
      signersWhoSignedIds: [],
      signerTagsRequired: args.packet.requiredSigners ?? [],
      signerTagsSigned: [],
      sourceDocumentIds: [draftDocumentId],
      sourceExternalIds: staticUniqueStrings([
        ...sourceExternalIds,
        `societyer:editable-document:${draftDocumentId}`,
        `societyer:document-version:${draftDocumentVersionId}`,
      ]),
      notes: args.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    for (const roleHolderId of signerRoleHolderIds) {
      const roleHolder = store.getRow("roleHolders", roleHolderId);
      if (!roleHolder) continue;
      const signerId = staticLocalId("legalSigner", roleHolderId);
      signerIds.push(signerId);
      store.upsertRow("legalSigners", {
        _id: signerId,
        _creationTime: Date.now(),
        societyId: args.societyId,
        status: "unsigned",
        fullName: roleHolder.fullName ?? "Unnamed signer",
        firstName: roleHolder.firstName,
        lastName: roleHolder.lastName,
        email: roleHolder.email,
        phone: roleHolder.phone,
        signerTag: roleHolder.signerTag ?? roleHolder.roleType,
        eventId: args.eventId,
        generatedDocumentId,
        roleHolderId,
        sourceExternalIds: staticUniqueStrings([...sourceExternalIds, `societyer:generated-legal-document:${generatedDocumentId}`]),
        notes: "Signer placeholder staged from corporation document packet.",
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    store.upsertRow("sourceEvidence", {
      _id: sourceEvidenceId,
      _creationTime: Date.now(),
      societyId: args.societyId,
      sourceDocumentId: draftDocumentId,
      externalSystem: "societyer",
      externalId: `corporation-packet:${args.packet.key}:${args.runId}`,
      sourceTitle: `${args.packet.packageName} editable packet`,
      sourceDate: args.effectiveDate,
      evidenceKind: "provenance",
      targetTable: "generatedLegalDocuments",
      targetId: generatedDocumentId,
      sensitivity: "standard",
      accessLevel: "internal",
      summary: `Editable document, generated-document row, signer placeholders, and minute-book record staged for ${args.packet.packageName}.`,
      status: "Linked",
      notes: args.notes,
      createdAtISO: now,
    });
    store.upsertRow("minuteBookItems", {
      _id: minuteBookItemId,
      _creationTime: Date.now(),
      societyId: args.societyId,
      title: args.packet.packageName,
      recordType: args.packet.requiresAnnualMaintenanceRecord ? "filing" : "package",
      effectiveDate: args.effectiveDate,
      status: "Draft",
      documentIds: [draftDocumentId],
      filingId: args.filingId,
      signatureIds: [],
      sourceEvidenceIds: [sourceEvidenceId],
      notes: args.notes ?? `Minute-book item staged from corporation packet ${args.packet.key}.`,
      createdAtISO: now,
      updatedAtISO: now,
    });
    store.upsertRow("legalPrecedentRuns", {
      ...run,
      _id: args.runId,
      generatedDocumentIds: [generatedDocumentId],
      signerRoleHolderIds,
      sourceExternalIds: staticUniqueStrings([
        ...sourceExternalIds,
        `societyer:editable-document:${draftDocumentId}`,
        `societyer:document-version:${draftDocumentVersionId}`,
        `societyer:generated-legal-document:${generatedDocumentId}`,
        `societyer:minute-book-item:${minuteBookItemId}`,
        `societyer:source-evidence:${sourceEvidenceId}`,
        ...signerIds.map((signerId) => `societyer:legal-signer:${signerId}`),
      ]),
      updatedAtISO: now,
    });
    if (args.filingId) {
      const filing = store.getRow("filings", args.filingId);
      if (filing) {
        store.upsertRow("filings", {
          ...filing,
          stagedPacketDocumentId: draftDocumentId,
          relatedPrecedentRunId: args.runId,
          updatedAtISO: now,
        });
      }
    }
  });

  return { draftDocumentId, draftDocumentVersionId, generatedDocumentId, signerIds, minuteBookItemId, sourceEvidenceId };
}

/** Entity-agnostic catalog generate (mirror of legalOperations.generateDocumentFromCatalog). */
export function staticGenerateDocumentFromCatalog(
  store: DocStoreLike,
  args: any,
  staticLocalId: StaticLocalId,
  staticUniqueStrings: StaticUniqueStrings,
) {
  const societyId = args?.societyId ?? SOCIETY_ID;
  const corpPacket = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === args?.packetKey);
  const socPacket = SOCIETY_DOCUMENT_PACKETS.find((p) => p.key === args?.packetKey);
  const packet = corpPacket ?? socPacket;
  if (!packet) throw new Error(`No document packet matches key: ${args?.packetKey}`);
  const markerKind = corpPacket ? "corporation" : "society";
  if (markerKind === "corporation") staticSeedCorporationDocumentPackets(store, { societyId });
  else staticSeedSocietyDocumentPackets(store, { societyId });

  const precMarker = `societyer:${markerKind}-packet-precedent:${packet.key}`;
  const precedent = (store?.listRows("legalPrecedents", { societyId }) ?? [])
    .find((row: any) => (row.sourceExternalIds ?? []).includes(precMarker));
  if (!precedent) throw new Error(`Packet precedent was not seeded: ${packet.key}`);

  const now = new Date().toISOString();
  const runId = staticLocalId("legalPrecedentRuns", packet.key);
  store?.upsertRow("legalPrecedentRuns", {
    _id: runId,
    _creationTime: Date.now(),
    societyId,
    name: `${packet.packageName}${args?.effectiveDate ? ` - ${args.effectiveDate}` : ""}`,
    status: "draft",
    precedentId: precedent._id,
    dateTime: args?.effectiveDate,
    dataJson: JSON.stringify({ packetKey: packet.key }),
    dataJsonList: [],
    dataReviewed: false,
    searchIds: [],
    registrationIds: [],
    filingIds: [],
    generatedDocumentIds: [],
    signerRoleHolderIds: [],
    priceItems: [],
    abstainingDirectorIds: [],
    abstainingRightsholderIds: [],
    sourceExternalIds: [`societyer:${markerKind}-packet-run:${packet.key}`],
    notes: "Generated from the document catalog.",
    createdAtISO: now,
    updatedAtISO: now,
  });
  const artifacts = staticCreatePacketRunArtifacts(store, {
    societyId,
    packet,
    runId,
    effectiveDate: args?.effectiveDate,
    dataJson: JSON.stringify({ packetKey: packet.key }),
    notes: "Generated from the document catalog.",
  }, staticLocalId, staticUniqueStrings);
  return { runId, packetKey: packet.key, precedentId: precedent._id, ...artifacts };
}

export function staticStageCorporationDocumentPacket(
  store: DocStoreLike,
  args: any,
  staticLocalId: StaticLocalId,
  staticUniqueStrings: StaticUniqueStrings,
) {
  const societyId = args?.societyId ?? SOCIETY_ID;
  staticSeedCorporationDocumentPackets(store, { societyId });
  const packet = args?.packetKey
    ? CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === args.packetKey)
    : corporationPacketForComplianceObligation({
        filingKind: args?.filingKind,
        obligationKey: args?.obligationKey,
        ruleId: args?.obligationRuleId,
      });
  if (!packet) throw new Error("No corporation document packet matches this obligation.");

  const marker = corporationPacketPrecedentMarker(packet);
  const precedent = (store?.listRows("legalPrecedents", { societyId }) ?? [])
    .find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
  if (!precedent) throw new Error(`Corporation document packet precedent was not seeded: ${packet.key}`);

  const now = new Date().toISOString();
  const runId = staticLocalId("legalPrecedentRuns", packet.key);
  store?.upsertRow("legalPrecedentRuns", {
    _id: runId,
    _creationTime: Date.now(),
    societyId,
    name: `${packet.packageName}${args?.dueDate ? ` - ${args.dueDate}` : ""}`,
    status: "draft",
    precedentId: precedent._id,
    eventId: args?.obligationRuleId,
    dateTime: args?.dueDate,
    dataJson: JSON.stringify({
      packetKey: packet.key,
      obligationKey: args?.obligationKey,
      obligationRuleId: args?.obligationRuleId,
      obligationTitle: args?.obligationTitle,
      filingKind: args?.filingKind,
      dueDate: args?.dueDate,
      sourceRegistrationId: args?.sourceRegistrationId,
    }),
    dataJsonList: [],
    dataReviewed: false,
    externalNotes: args?.obligationTitle,
    searchIds: [],
    registrationIds: args?.sourceRegistrationId ? [args.sourceRegistrationId] : [],
    filingIds: args?.filingId ? [args.filingId] : [],
    generatedDocumentIds: [],
    signerRoleHolderIds: [],
    priceItems: [],
    abstainingDirectorIds: [],
    abstainingRightsholderIds: [],
    sourceExternalIds: [
      `societyer:compliance-obligation:${args?.obligationRuleId ?? args?.obligationKey ?? packet.key}`,
      `societyer:corporation-packet-run:${packet.key}`,
    ],
    notes: args?.notes ?? `Staged from compliance obligation ${args?.obligationKey ?? args?.obligationRuleId ?? packet.key}.`,
    createdAtISO: now,
    updatedAtISO: now,
  });
  const artifacts = staticCreatePacketRunArtifacts(store, {
    societyId,
    packet,
    runId,
    eventId: args?.obligationRuleId ?? args?.obligationKey,
    effectiveDate: args?.dueDate,
    filingId: args?.filingId,
    dataJson: JSON.stringify({
      packetKey: packet.key,
      obligationKey: args?.obligationKey,
      obligationRuleId: args?.obligationRuleId,
      obligationTitle: args?.obligationTitle,
      filingKind: args?.filingKind,
      dueDate: args?.dueDate,
      sourceRegistrationId: args?.sourceRegistrationId,
    }),
    notes: args?.notes ?? `Editable packet output staged from compliance obligation ${args?.obligationKey ?? args?.obligationRuleId ?? packet.key}.`,
  }, staticLocalId, staticUniqueStrings);
  return { runId, packetKey: packet.key, precedentId: precedent._id, ...artifacts };
}
