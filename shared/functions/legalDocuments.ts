/**
 * PORTABLE FUNCTIONS: the document/template GENERATION surface of
 * legalOperations.
 *
 * These are the catalog-seeding, packet-staging, and template-data-field
 * handlers that produce draft documents, generated-document rows, signer
 * placeholders, minute-book items, and source-evidence records. Each handler
 * reads/writes exclusively through the portable `ctx.db` contract and binds the
 * grammar-aware render context + DOCX builders from the pure `shared/*` kernels
 * (templateAssembly, packetRendering, corporationDocumentPackets,
 * corporationPacketDocx, societyRenderContext, executionBlock, …). Nothing here
 * touches ctx.storage, ctx.scheduler, ctx.auth, fetch, or ctx.run*, so each runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. The bodies are moved verbatim from convex/legalOperations.ts.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { cleanText, cleanList } from "./text";
import {
  STARTER_POLICY_TEMPLATES,
  starterTemplateHtml,
  starterTemplateMarker,
  starterTemplateRequiredFields,
} from "../starterPolicyTemplates";
import {
  CORPORATION_DOCUMENT_PACKETS,
  corporationPacketEntityTypes,
  corporationPacketForComplianceObligation,
  corporationPacketPrecedentMarker,
  corporationPacketTemplateHtml,
} from "../corporationDocumentPackets";
import {
  corporationPacketDocumentId,
  corporationPacketDocxDataUrl,
  corporationPacketDocxFileName,
  corporationPacketDocxMimeType,
  documentDocxDataUrl,
} from "../corporationPacketDocx";
import { buildSubscriptionAgreementBlocks } from "../subscriptionAgreement";
import { SOCIETY_DOCUMENT_PACKETS, societyPacketEntityTypes } from "../societyDocumentPackets";
import { isCorporation } from "../organizationDomain";
import { materializeRightsHoldings } from "../equityLedger";
import { planShareSplit, validateRatio, type HoldingPosition, type SplitRatio } from "../shareSplit";
import { buildSocietyRenderContext } from "../societyRenderContext";
import { resolveLocale } from "../locale";
import {
  assetTransferView,
  directorAppointmentView,
  directorRemovalView,
  officeChangeView,
  officerAppointmentView,
  shareCertificateView,
  shareTransferView,
} from "../packetOperativeData";
import { buildExecutionBlock, resolvingBodyFor, type SignerLine } from "../executionBlock";
import { activeAsOf, type IntervalRow } from "../registerHistory";
import { buildAnnualResolutionContext } from "../annualResolution";
import { buildDividendResolutionContext } from "../dividendResolution";

export async function templateEnginePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<any> {
  const [dataFields, templates, precedents, runs, generatedDocuments, signers] = await Promise.all([
    ctx.db.query("legalTemplateDataFields").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("legalTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("legalPrecedents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("generatedLegalDocuments").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("legalSigners").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return {
    dataFields: dataFields.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    templates: templates.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    precedents: precedents.sort((a, b) => String(a.packageName).localeCompare(String(b.packageName))),
    runs: runs.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
    generatedDocuments: generatedDocuments.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
    signers: signers.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
  };
}

export async function seedStarterPolicyTemplatesPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }): Promise<any> {
  const now = new Date().toISOString();
  const existing = await ctx.db
    .query("legalTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const template of STARTER_POLICY_TEMPLATES) {
    const marker = starterTemplateMarker(template);
    const existingByMarker = existing.find((row) => (row.sourceExternalIds ?? []).includes(marker));
    const existingByName = existing.find((row) => row.name.toLowerCase() === template.name.toLowerCase());
    const payload = {
      societyId,
      templateType: template.templateType ?? "policy",
      name: template.name,
      status: "active",
      templateDocumentId: undefined,
      docxDocumentId: undefined,
      pdfDocumentId: undefined,
      html: starterTemplateHtml(template),
      notes: [
        template.summary,
        "Exact normalized text extracted from the local source PDF template supplied for Societyer template inclusion.",
        `Source file: ${template.sourceFile}`,
        `Source SHA-256: ${template.sourceSha256}`,
      ].join("\n"),
      owner: "Societyer starter catalog",
      ownerIsTobuso: false,
      signatureRequired: template.signatureRequired ?? true,
      documentTag: template.documentTag ?? "other",
      entityTypes: ["society", "corporation__nfp_"],
      jurisdictions: ["british_columbia", "federal__canada_"],
      requiredSigners: template.signatureRequired === false ? [] : ["all_directors"],
      requiredDataFieldIds: [],
      optionalDataFieldIds: [],
      reviewDataFieldIds: [],
      requiredDataFields: starterTemplateRequiredFields(template),
      optionalDataFields: template.optionalDataFields ?? [],
      reviewDataFields: template.reviewDataFields ?? ["Bylaws", "SigningAuthorities", "Jurisdiction", "CharityStatus"],
      timeline: "Review exact source text and customize before board approval.",
      deliverable: template.templateType === "document" ? "Exact source governance document template" : "Exact source policy template",
      terms: "Exact PDF text extraction. Review for jurisdiction, bylaws, charity status, funder requirements, and actual operations before adoption.",
      filingType: undefined,
      priceItems: [],
      sourceExternalIds: [marker, `sha256:${template.sourceSha256}`, `source-file:${template.sourceFile}`],
      updatedAtISO: now,
    };

    if (existingByMarker) {
      await ctx.db.patch(existingByMarker._id, payload);
      updated += 1;
    } else if (existingByName) {
      skipped += 1;
    } else {
      await ctx.db.insert("legalTemplates", { ...payload, createdAtISO: now });
      inserted += 1;
    }
  }

  return { inserted, updated, skipped, total: STARTER_POLICY_TEMPLATES.length };
}

export async function seedCorporationDocumentPacketsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }): Promise<any> {
  return seedCorporationDocumentPacketsForSociety(ctx, societyId);
}

export async function seedSocietyDocumentPacketsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }): Promise<any> {
  return seedSocietyDocumentPacketsForSociety(ctx, societyId);
}

/**
 * Core of catalog generation, callable directly (e.g. by the firm-wide batch
 * generator in convex/firm.ts) without going through the mutation wrapper.
 */
export async function generatePacketForSocietyPortable(
  ctx: PortableMutationCtx,
  args: { societyId: any; packetKey: string; effectiveDate?: string },
): Promise<any> {
  {
    const corpPacket = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === args.packetKey);
    const socPacket = SOCIETY_DOCUMENT_PACKETS.find((p) => p.key === args.packetKey);
    const packet = corpPacket ?? socPacket;
    if (!packet) throw new Error(`No document packet matches key: ${args.packetKey}`);
    const markerKind = corpPacket ? "corporation" : "society";
    if (markerKind === "corporation") await seedCorporationDocumentPacketsForSociety(ctx, args.societyId);
    else await seedSocietyDocumentPacketsForSociety(ctx, args.societyId);

    const precMarker = `societyer:${markerKind}-packet-precedent:${packet.key}`;
    const precedent = await ctx.db
      .query("legalPrecedents")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect()
      .then((rows: any[]) => rows.find((r: any) => (r.sourceExternalIds ?? []).includes(precMarker)));
    if (!precedent) throw new Error(`Packet precedent was not seeded: ${packet.key}`);

    const now = new Date().toISOString();
    const runId = await ctx.db.insert("legalPrecedentRuns", {
      societyId: args.societyId,
      name: `${packet.packageName}${args.effectiveDate ? ` - ${args.effectiveDate}` : ""}`,
      status: "draft",
      precedentId: precedent._id,
      dateTime: args.effectiveDate,
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
    const artifacts = await createPacketRunArtifacts(ctx, {
      societyId: args.societyId,
      packet,
      runId,
      effectiveDate: args.effectiveDate,
      dataJson: JSON.stringify({ packetKey: packet.key }),
      notes: "Generated from the document catalog.",
    });
    return { runId, packetKey: packet.key, precedentId: precedent._id, ...artifacts };
  }
}

export async function generateDocumentFromCatalogPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; packetKey: string; effectiveDate?: string },
): Promise<any> {
  return generatePacketForSocietyPortable(ctx, args);
}

/**
 * Seed the correct packet catalog for an entity by kind. Plain helper so other
 * mutations (e.g. society.createWorkspace) can auto-seed on entity creation
 * without going through the mutation boundary.
 */
export async function seedDocumentPacketsForEntityPortable(ctx: PortableMutationCtx, societyId: any): Promise<any> {
  const society = await ctx.db.get(societyId);
  if (society && isCorporation(society as any)) {
    return { kind: "corporation", ...(await seedCorporationDocumentPacketsForSociety(ctx, societyId)) };
  }
  return { kind: "society", ...(await seedSocietyDocumentPacketsForSociety(ctx, societyId)) };
}

export async function stageCorporationDocumentPacketPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    packetKey?: string;
    obligationKey?: string;
    obligationRuleId?: string;
    obligationTitle?: string;
    filingKind?: string;
    dueDate?: string;
    filingId?: string;
    sourceRegistrationId?: string;
    notes?: string;
  },
): Promise<any> {
  await seedCorporationDocumentPacketsForSociety(ctx, args.societyId);
  const packet = args.packetKey
    ? CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === args.packetKey)
    : corporationPacketForComplianceObligation({
        filingKind: args.filingKind,
        obligationKey: args.obligationKey,
        ruleId: args.obligationRuleId,
      });
  if (!packet) throw new Error("No corporation document packet matches this obligation.");

  const precedent = await corporationPacketPrecedentForSociety(ctx, args.societyId, packet);

  const now = new Date().toISOString();
  const runId = await ctx.db.insert("legalPrecedentRuns", {
    societyId: args.societyId,
    name: `${packet.packageName}${args.dueDate ? ` - ${args.dueDate}` : ""}`,
    status: "draft",
    precedentId: precedent._id,
    eventId: args.obligationRuleId,
    dateTime: args.dueDate,
    dataJson: JSON.stringify({
      packetKey: packet.key,
      obligationKey: args.obligationKey,
      obligationRuleId: args.obligationRuleId,
      obligationTitle: args.obligationTitle,
      filingKind: args.filingKind,
      dueDate: args.dueDate,
      sourceRegistrationId: args.sourceRegistrationId,
    }),
    dataJsonList: [],
    dataReviewed: false,
    externalNotes: args.obligationTitle,
    searchIds: [],
    registrationIds: args.sourceRegistrationId ? [args.sourceRegistrationId] : [],
    filingIds: args.filingId ? [args.filingId] : [],
    generatedDocumentIds: [],
    signerRoleHolderIds: [],
    priceItems: [],
    abstainingDirectorIds: [],
    abstainingRightsholderIds: [],
    sourceExternalIds: [
      `societyer:compliance-obligation:${args.obligationRuleId ?? args.obligationKey ?? packet.key}`,
      `societyer:corporation-packet-run:${packet.key}`,
    ],
    notes: args.notes ?? `Staged from compliance obligation ${args.obligationKey ?? args.obligationRuleId ?? packet.key}.`,
    createdAtISO: now,
    updatedAtISO: now,
  });
  const artifacts = await createPacketRunArtifacts(ctx, {
    societyId: args.societyId,
    packet,
    runId,
    eventId: args.obligationRuleId ?? args.obligationKey,
    effectiveDate: args.dueDate,
    filingId: args.filingId,
    dataJson: JSON.stringify({
      packetKey: packet.key,
      obligationKey: args.obligationKey,
      obligationRuleId: args.obligationRuleId,
      obligationTitle: args.obligationTitle,
      filingKind: args.filingKind,
      dueDate: args.dueDate,
      sourceRegistrationId: args.sourceRegistrationId,
    }),
    notes: args.notes ?? `Editable packet output staged from compliance obligation ${args.obligationKey ?? args.obligationRuleId ?? packet.key}.`,
  });
  return { runId, packetKey: packet.key, precedentId: precedent._id, ...artifacts };
}

export async function stageShareIssuancePacketPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; transferId: string; notes?: string },
): Promise<any> {
  const transfer = await ctx.db.get(args.transferId);
  if (!transfer || transfer.societyId !== args.societyId) {
    throw new Error("Share issuance transfer was not found for this workspace.");
  }
  if (transfer.transferType !== "issuance") {
    throw new Error("Only issuance transfers can stage the share issuance packet.");
  }
  const packet = CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === "issue-shares");
  if (!packet) throw new Error("Share issuance packet is not configured.");

  await seedCorporationDocumentPacketsForSociety(ctx, args.societyId);
  const precedent = await corporationPacketPrecedentForSociety(ctx, args.societyId, packet);
  const now = new Date().toISOString();
  const runId = await ctx.db.insert("legalPrecedentRuns", {
    societyId: args.societyId,
    name: `${packet.packageName}${transfer.transferDate ? ` - ${transfer.transferDate}` : ""}`,
    status: "draft",
    precedentId: precedent._id,
    eventId: String(args.transferId),
    dateTime: transfer.transferDate,
    dataJson: JSON.stringify({
      packetKey: packet.key,
      transferId: args.transferId,
      transferType: transfer.transferType,
      transferDate: transfer.transferDate,
      rightsClassId: transfer.rightsClassId,
      destinationRoleHolderId: transfer.destinationRoleHolderId,
      destinationHolderName: transfer.destinationHolderName,
      quantity: transfer.quantity,
      considerationType: transfer.considerationType,
      considerationDescription: transfer.considerationDescription,
    }),
    dataJsonList: [],
    dataReviewed: false,
    externalNotes: "Share issuance packet staged from the share register.",
    searchIds: [],
    registrationIds: [],
    filingIds: [],
    generatedDocumentIds: [],
    signerRoleHolderIds: transfer.destinationRoleHolderId ? [transfer.destinationRoleHolderId] : [],
    priceItems: [],
    abstainingDirectorIds: [],
    abstainingRightsholderIds: [],
    sourceExternalIds: [
      `societyer:rightsholding-transfer:${args.transferId}`,
      `societyer:corporation-packet-run:${packet.key}`,
    ],
    notes: args.notes ?? `Staged share issuance packet for ledger transfer ${args.transferId}.`,
    createdAtISO: now,
    updatedAtISO: now,
  });
  const artifacts = await createPacketRunArtifacts(ctx, {
    societyId: args.societyId,
    packet,
    runId,
    eventId: String(args.transferId),
    effectiveDate: transfer.transferDate,
    signerRoleHolderIds: transfer.destinationRoleHolderId ? [transfer.destinationRoleHolderId] : [],
    dataJson: JSON.stringify({
      packetKey: packet.key,
      transferId: args.transferId,
      transferType: transfer.transferType,
      transferDate: transfer.transferDate,
      rightsClassId: transfer.rightsClassId,
      destinationRoleHolderId: transfer.destinationRoleHolderId,
      destinationHolderName: transfer.destinationHolderName,
      quantity: transfer.quantity,
      considerationType: transfer.considerationType,
      considerationDescription: transfer.considerationDescription,
    }),
    notes: args.notes ?? `Editable share issuance packet output staged for ledger transfer ${args.transferId}.`,
  });
  await ctx.db.patch(args.transferId, {
    precedentRunId: runId,
    sourceDocumentIds: cleanDocumentIds([...(transfer.sourceDocumentIds ?? []), artifacts.draftDocumentId]),
    sourceExternalIds: cleanList([
      ...(transfer.sourceExternalIds ?? []),
      `societyer:corporation-packet-run:${packet.key}`,
      `societyer:legal-precedent-run:${runId}`,
      `societyer:generated-legal-document:${artifacts.generatedDocumentId}`,
      `societyer:minute-book-item:${artifacts.minuteBookItemId}`,
      `societyer:source-evidence:${artifacts.sourceEvidenceId}`,
      ...artifacts.signerIds.map((signerId: string) => `societyer:legal-signer:${signerId}`),
    ]),
    notes: [transfer.notes, args.notes ?? "Share issuance packet staged in Template Engine."].filter(Boolean).join("\n\n"),
    updatedAtISO: now,
  });
  await syncRightsHoldings(ctx, args.societyId);
  return { runId, packetKey: packet.key, precedentId: precedent._id, transferId: args.transferId, ...artifacts };
}

export async function stageShareSplitPacketPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; rightsClassId: string; numerator: number; denominator: number; notes?: string },
): Promise<any> {
  const rightsClass = await ctx.db.get(args.rightsClassId);
  if (!rightsClass || rightsClass.societyId !== args.societyId) {
    throw new Error("Rights class was not found for this workspace.");
  }
  const ratio: SplitRatio = { numerator: args.numerator, denominator: args.denominator };
  const validation = validateRatio(ratio);
  if (!validation.ok) {
    throw new Error(`Invalid split ratio: ${validation.errors.join(" ")}`);
  }

  // Current holdings in this class become the before-state of the split.
  const holdingRows = await ctx.db
    .query("rightsHoldings")
    .withIndex("by_society_class", (q: any) => q.eq("societyId", args.societyId).eq("rightsClassId", args.rightsClassId))
    .collect();
  const positions: HoldingPosition[] = [];
  for (const row of holdingRows) {
    if (!row.quantity) continue;
    const roleHolder = row.holderRoleHolderId ? await ctx.db.get(row.holderRoleHolderId) : null;
    const holderName = roleHolder?.fullName
      || (String(row.holderKey).startsWith("name:") ? String(row.holderKey).slice("name:".length) : String(row.holderKey));
    positions.push({
      holderKey: String(row.holderKey),
      holderName,
      holderRoleHolderId: row.holderRoleHolderId ? String(row.holderRoleHolderId) : undefined,
      shares: Number(row.quantity),
    });
  }
  if (positions.length === 0) {
    throw new Error("This share class has no current holdings to subdivide or consolidate.");
  }

  const plan = planShareSplit(positions, ratio);
  const now = new Date().toISOString();
  const effectiveDate = now.slice(0, 10);
  const eventId = `share-split:${args.rightsClassId}:${now}`;
  const transferType = plan.kind === "subdivision" ? "subdivision" : "consolidation";

  // One signed per-holder adjustment row per holder whose count changes.
  for (const line of plan.lines) {
    if (line.delta === 0) continue;
    const gains = line.delta > 0;
    await ctx.db.insert("rightsholdingTransfers", {
      societyId: args.societyId,
      transferType,
      status: "posted",
      transferDate: effectiveDate,
      eventId,
      rightsClassId: args.rightsClassId,
      sourceRoleHolderId: gains ? undefined : line.holderRoleHolderId,
      sourceHolderName: gains ? undefined : line.holderName,
      destinationRoleHolderId: gains ? line.holderRoleHolderId : undefined,
      destinationHolderName: gains ? line.holderName : undefined,
      quantity: Math.abs(line.delta),
      considerationType: "share-split",
      considerationDescription: plan.label,
      sourceDocumentIds: [],
      sourceExternalIds: [`societyer:share-split:${eventId}`],
      notes: `${plan.label} of ${rightsClass.className}: ${line.before} → ${line.after} shares.`,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }

  const packet = CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === "share-split");
  if (!packet) throw new Error("Share split packet is not configured.");
  await seedCorporationDocumentPacketsForSociety(ctx, args.societyId);
  const precedent = await corporationPacketPrecedentForSociety(ctx, args.societyId, packet);
  const splitData = {
    packetKey: packet.key,
    rightsClassId: String(args.rightsClassId),
    shareClassName: rightsClass.className,
    ratioLabel: plan.label,
    kind: plan.kind,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    sharesDropped: plan.sharesDropped,
    effectiveDate,
    lines: plan.lines.map((line) => ({
      holderName: line.holderName,
      before: line.before,
      after: line.after,
    })),
  };
  const signerRoleHolderIds = await defaultPacketSignerRoleHolderIds(ctx, args.societyId);
  const runId = await ctx.db.insert("legalPrecedentRuns", {
    societyId: args.societyId,
    name: `${packet.packageName} - ${rightsClass.className} (${plan.label})`,
    status: "draft",
    precedentId: precedent._id,
    eventId,
    dateTime: effectiveDate,
    dataJson: JSON.stringify(splitData),
    dataJsonList: [],
    dataReviewed: false,
    externalNotes: "Share subdivision/consolidation packet staged from the share register.",
    searchIds: [],
    registrationIds: [],
    filingIds: [],
    generatedDocumentIds: [],
    signerRoleHolderIds,
    priceItems: [],
    abstainingDirectorIds: [],
    abstainingRightsholderIds: [],
    sourceExternalIds: [
      `societyer:share-split:${eventId}`,
      `societyer:corporation-packet-run:${packet.key}`,
    ],
    notes: args.notes ?? `Staged ${plan.label} of ${rightsClass.className}.`,
    createdAtISO: now,
    updatedAtISO: now,
  });
  const artifacts = await createPacketRunArtifacts(ctx, {
    societyId: args.societyId,
    packet,
    runId,
    eventId,
    effectiveDate,
    signerRoleHolderIds,
    dataJson: JSON.stringify(splitData),
    notes: args.notes ?? `Editable ${plan.label} resolution for ${rightsClass.className}.`,
  });
  await syncRightsHoldings(ctx, args.societyId);
  return {
    runId,
    packetKey: packet.key,
    precedentId: precedent._id,
    ratioLabel: plan.label,
    kind: plan.kind,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    sharesDropped: plan.sharesDropped,
    ...artifacts,
  };
}

export interface UpsertTemplateDataFieldArgs {
  id?: string;
  societyId?: string;
  name: string;
  label?: string;
  fieldType?: string;
  number?: number;
  dynamicIndicator?: string;
  required?: boolean;
  reviewRequired?: boolean;
  notes?: string;
  sourceExternalIds?: string[];
}

export async function upsertTemplateDataFieldPortable(
  ctx: PortableMutationCtx,
  { id, ...args }: UpsertTemplateDataFieldArgs,
): Promise<string> {
  const now = new Date().toISOString();
  const payload = {
    societyId: args.societyId,
    name: cleanText(args.name) || "Unnamed data field",
    label: cleanText(args.label),
    fieldType: cleanText(args.fieldType),
    number: args.number,
    dynamicIndicator: cleanText(args.dynamicIndicator),
    required: args.required,
    reviewRequired: args.reviewRequired,
    notes: cleanText(args.notes),
    sourceExternalIds: cleanList(args.sourceExternalIds),
    updatedAtISO: now,
  };
  if (id) {
    await ctx.db.patch(id, payload);
    return id;
  }
  return await ctx.db.insert("legalTemplateDataFields", { ...payload, createdAtISO: now });
}

export async function removeTemplateDataFieldPortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}

// ---------------------------------------------------------------------------
// Internal catalog/packet generation helpers (moved verbatim).
// ---------------------------------------------------------------------------

async function seedCorporationDocumentPacketsForSociety(ctx: any, societyId: any) {
  return seedDocumentPacketCatalog(ctx, societyId, CORPORATION_DOCUMENT_PACKETS, {
    entityTypes: corporationPacketEntityTypes(),
    markerKind: "corporation",
    catalogNote: "Catalog packet for corporation minute book, registers, filings, and compliance evidence.",
    owner: "Societyer corporation packet catalog",
  });
}

async function seedSocietyDocumentPacketsForSociety(ctx: any, societyId: any) {
  return seedDocumentPacketCatalog(ctx, societyId, SOCIETY_DOCUMENT_PACKETS, {
    entityTypes: societyPacketEntityTypes(),
    markerKind: "society",
    catalogNote: "Catalog packet for society minute book, registers, AGM, and Societies Act resolutions.",
    owner: "Societyer society packet catalog",
  });
}

/**
 * Generic packet-catalog seeder: idempotently upserts legalTemplates +
 * legalPrecedents for any packet set (corporation or society), keyed by a
 * per-kind marker so the two catalogs coexist. The corporation marker format is
 * preserved exactly (markerKind "corporation" → societyer:corporation-packet-*).
 */
async function seedDocumentPacketCatalog(
  ctx: any,
  societyId: any,
  packets: typeof CORPORATION_DOCUMENT_PACKETS,
  opts: { entityTypes: string[]; markerKind: string; catalogNote: string; owner: string },
) {
  const now = new Date().toISOString();
  const templateMarker = (packet: (typeof packets)[number]) => `societyer:${opts.markerKind}-packet-template:${packet.key}`;
  const precedentMarker = (packet: (typeof packets)[number]) => `societyer:${opts.markerKind}-packet-precedent:${packet.key}`;
  const [existingTemplates, existingPrecedents] = await Promise.all([
    ctx.db.query("legalTemplates").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("legalPrecedents").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  let insertedTemplates = 0;
  let updatedTemplates = 0;
  let skippedTemplates = 0;
  let insertedPrecedents = 0;
  let updatedPrecedents = 0;
  let skippedPrecedents = 0;
  const templateIdByPacketKey = new Map<string, any>();

  for (const packet of packets) {
    const marker = templateMarker(packet);
    const existingByMarker = existingTemplates.find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
    const existingByName = existingTemplates.find((row: any) => String(row.name ?? "").toLowerCase() === packet.templateName.toLowerCase());
    const payload = {
      societyId,
      templateType: "document",
      name: packet.templateName,
      status: "active",
      templateDocumentId: undefined,
      docxDocumentId: undefined,
      pdfDocumentId: undefined,
      html: corporationPacketTemplateHtml(packet),
      notes: [
        packet.summary,
        opts.catalogNote,
        `Packet key: ${packet.key}`,
      ].join("\n"),
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
      updatedAtISO: now,
    };

    if (existingByMarker) {
      await ctx.db.patch(existingByMarker._id, payload);
      updatedTemplates += 1;
      templateIdByPacketKey.set(packet.key, existingByMarker._id);
    } else if (existingByName) {
      skippedTemplates += 1;
      templateIdByPacketKey.set(packet.key, existingByName._id);
    } else {
      const id = await ctx.db.insert("legalTemplates", { ...payload, createdAtISO: now });
      insertedTemplates += 1;
      templateIdByPacketKey.set(packet.key, id);
    }
  }

  for (const packet of packets) {
    const marker = precedentMarker(packet);
    const existingByMarker = existingPrecedents.find((row: any) => (row.sourceExternalIds ?? []).includes(marker));
    const existingByName = existingPrecedents.find((row: any) => String(row.packageName ?? "").toLowerCase() === packet.packageName.toLowerCase());
    const templateId = templateIdByPacketKey.get(packet.key);
    const payload = {
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
      updatedAtISO: now,
    };

    if (existingByMarker) {
      await ctx.db.patch(existingByMarker._id, payload);
      updatedPrecedents += 1;
    } else if (existingByName) {
      skippedPrecedents += 1;
    } else {
      await ctx.db.insert("legalPrecedents", { ...payload, createdAtISO: now });
      insertedPrecedents += 1;
    }
  }

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

async function corporationPacketPrecedentForSociety(ctx: any, societyId: any, packet: (typeof CORPORATION_DOCUMENT_PACKETS)[number]) {
  const marker = corporationPacketPrecedentMarker(packet);
  const precedent = await ctx.db
    .query("legalPrecedents")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect()
    .then((rows: any[]) => rows.find((row) => (row.sourceExternalIds ?? []).includes(marker)));
  if (!precedent) throw new Error(`Corporation document packet precedent was not seeded: ${packet.key}`);
  return precedent;
}

async function createPacketRunArtifacts(ctx: any, args: {
  societyId: any;
  packet: (typeof CORPORATION_DOCUMENT_PACKETS)[number];
  runId: any;
  eventId?: string;
  effectiveDate?: string;
  filingId?: any;
  signerRoleHolderIds?: any[];
  dataJson?: string;
  notes?: string;
}) {
  const now = new Date().toISOString();
  const signerRoleHolderIds = args.signerRoleHolderIds?.length
    ? args.signerRoleHolderIds
    : await defaultPacketSignerRoleHolderIds(ctx, args.societyId);
  const run = await ctx.db.get(args.runId);
  const sourceExternalIds = [
    ...(run?.sourceExternalIds ?? []),
    `societyer:corporation-packet-run:${args.packet.key}`,
    `societyer:legal-precedent-run:${args.runId}`,
  ];
  // Build a grammar/data context so generated packet prose binds {token}/{#if}/
  // {#each} markup (token-free packets are unaffected). Logic in the tested
  // shared/societyRenderContext.ts.
  const society = await ctx.db.get(args.societyId);
  const roleHolders = await ctx.db
    .query("roleHolders")
    .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
    .collect();
  const renderCtx = society
    ? buildSocietyRenderContext(society, roleHolders, args.effectiveDate ?? now)
    : undefined;
  // Compute the execution/signature block (adoption clause + signature page) so
  // the generated DOCX is a signable instrument, not a checklist. Signatories
  // come from the per-entity signer roster (entitySigners) when one exists,
  // otherwise from the resolving body's current role holders.
  let context: Record<string, unknown> | undefined = renderCtx as unknown as
    | Record<string, unknown>
    | undefined;
  if (renderCtx) {
    const asOf = args.effectiveDate ?? now;
    const body = resolvingBodyFor(args.packet.requiredSigners ?? []);
    const signerRoster = await ctx.db
      .query("entitySigners")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    const activeRoster = activeAsOf(signerRoster as unknown as IntervalRow[], asOf, {
      start: "validFromISO",
      end: "validToISO",
    }) as Array<{ name?: string; corpSign?: string | null; signOrder?: number }>;
    let signers: SignerLine[];
    if (activeRoster.length) {
      signers = [...activeRoster]
        .sort((a, b) => (a.signOrder ?? Infinity) - (b.signOrder ?? Infinity))
        .map((s) => ({ name: String(s.name ?? ""), corpSign: s.corpSign ?? null }));
    } else {
      signers = roleHolders
        .filter((r: any) => body.roleTypes.includes(r.roleType) && !r.endDate)
        .map((r: any) => ({ name: String(r.fullName ?? ""), capacity: body.capacity }));
    }
    const resolutionsPlural =
      args.packet.sections.reduce((sum, section) => sum + section.body.length, 0) > 1;
    const execution = buildExecutionBlock({
      shortName: renderCtx.org.shortName,
      legislation: renderCtx.org.legislation,
      noun: body.noun,
      resolutionsPlural,
      signers,
      dateLong: renderCtx.date.long,
      locale: resolveLocale(society?.docPrepLanguage),
    });
    // Packet-specific operative data so the resolution body renders real clauses
    // (YCN Doc - Annual / Doc - Dividends), not a generic blurb.
    let runData: Record<string, unknown> | undefined;
    try {
      runData = args.dataJson ? JSON.parse(args.dataJson) : undefined;
    } catch {
      runData = undefined;
    }
    const dataContext = await buildPacketDataContext(ctx, args.packet, args.societyId, society, renderCtx, runData);
    context = { ...renderCtx, execution, ...dataContext };
  }
  // Deterministic file name (YCN ENT-DOCTYPE-DATE) + optional doc-ID header.
  const fileOpts = { shortName: society?.shortName, effectiveDate: args.effectiveDate ?? now };
  if (society?.includeDocumentIdHeader) {
    context = { ...(context ?? {}), documentId: corporationPacketDocumentId(args.packet, fileOpts) };
  }
  const docxDataUrl = corporationPacketDocxDataUrl(args.packet, context);
  const docxFileName = corporationPacketDocxFileName(args.packet, fileOpts);
  const docxMimeType = corporationPacketDocxMimeType();
  const draftDocumentId = await ctx.db.insert("documents", {
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
  const draftDocumentVersionId = await ctx.db.insert("documentVersions", {
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
  const generatedDocumentId = await ctx.db.insert("generatedLegalDocuments", {
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
    sourceExternalIds: cleanList([
      ...sourceExternalIds,
      `societyer:editable-document:${draftDocumentId}`,
      `societyer:document-version:${draftDocumentVersionId}`,
    ]),
    notes: args.notes,
    createdAtISO: now,
    updatedAtISO: now,
  });
  const signerIds = await createPacketSigners(ctx, {
    societyId: args.societyId,
    generatedDocumentId,
    roleHolderIds: signerRoleHolderIds,
    eventId: args.eventId,
    sourceExternalIds: [...sourceExternalIds, `societyer:generated-legal-document:${generatedDocumentId}`],
  });
  const sourceEvidenceId = await ctx.db.insert("sourceEvidence", {
    societyId: args.societyId,
    sourceDocumentId: draftDocumentId,
    externalSystem: "societyer",
    externalId: `corporation-packet:${args.packet.key}:${args.runId}`,
    sourceTitle: `${args.packet.packageName} editable packet`,
    sourceDate: args.effectiveDate,
    evidenceKind: "provenance",
    targetTable: "generatedLegalDocuments",
    targetId: String(generatedDocumentId),
    sensitivity: "standard",
    accessLevel: "internal",
    summary: `Editable document, generated-document row, signer placeholders, and minute-book record staged for ${args.packet.packageName}.`,
    status: "Linked",
    notes: args.notes,
    createdAtISO: now,
  });
  // Per-subscriber "Subscription for Shares" annexes for the allotment packet
  // (YCN Doc - Share Allotment): one companion document per subscriber of the
  // latest issuance. Logic in the tested shared/subscriptionAgreement.ts.
  const companionDocumentIds =
    args.packet.key === "issue-shares"
      ? await createSubscriptionAnnexes(ctx, {
          societyId: args.societyId,
          society,
          renderCtx,
          effectiveDate: args.effectiveDate ?? now,
          now,
          sourceExternalIds,
        })
      : [];
  const minuteBookItemId = await ctx.db.insert("minuteBookItems", {
    societyId: args.societyId,
    title: args.packet.packageName,
    recordType: args.packet.requiresAnnualMaintenanceRecord ? "filing" : "package",
    effectiveDate: args.effectiveDate,
    status: "Draft",
    documentIds: [draftDocumentId, ...companionDocumentIds],
    filingId: args.filingId,
    signatureIds: [],
    sourceEvidenceIds: [sourceEvidenceId],
    notes: args.notes ?? `Minute-book item staged from corporation packet ${args.packet.key}.`,
    createdAtISO: now,
    updatedAtISO: now,
  });
  await ctx.db.patch(args.runId, {
    generatedDocumentIds: [generatedDocumentId],
    signerRoleHolderIds,
    sourceExternalIds: cleanList([
      ...sourceExternalIds,
      `societyer:editable-document:${draftDocumentId}`,
      `societyer:document-version:${draftDocumentVersionId}`,
      `societyer:generated-legal-document:${generatedDocumentId}`,
      `societyer:minute-book-item:${minuteBookItemId}`,
      `societyer:source-evidence:${sourceEvidenceId}`,
      ...companionDocumentIds.map((id: string) => `societyer:subscription-annex:${id}`),
      ...signerIds.map((signerId: string) => `societyer:legal-signer:${signerId}`),
    ]),
    updatedAtISO: now,
  });
  if (args.filingId) {
    await ctx.db.patch(args.filingId, {
      stagedPacketDocumentId: draftDocumentId,
      relatedPrecedentRunId: args.runId,
      updatedAtISO: now,
    });
  }
  return { draftDocumentId, draftDocumentVersionId, generatedDocumentId, signerIds, minuteBookItemId, sourceEvidenceId, companionDocumentIds };
}

/**
 * Create one "Subscription for Shares" document per subscriber of the latest
 * posted issuance, returning the created document ids. Each is a standalone DOCX
 * (shared/subscriptionAgreement.ts) stored as a documents row + version.
 */
async function createSubscriptionAnnexes(
  ctx: any,
  args: {
    societyId: any;
    society: any;
    renderCtx: { org: { name: string; shortName: string; legislation: string }; date: { long: string } } | undefined;
    effectiveDate: string;
    now: string;
    sourceExternalIds: string[];
  },
): Promise<string[]> {
  if (!args.renderCtx) return [];
  const [transfers, classes, roleHolders] = await Promise.all([
    ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q: any) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query("rightsClasses").withIndex("by_society", (q: any) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q: any) => q.eq("societyId", args.societyId)).collect(),
  ]);
  const issuances = transfers.filter(
    (t: any) => String(t.transferType) === "issuance" && String(t.status) === "posted",
  );
  if (issuances.length === 0) return [];
  // Use the latest issuance date's subscribers (one declaration of allotment).
  let latest = "";
  for (const t of issuances) {
    const date = String(t.transferDate ?? t.createdAtISO ?? "");
    if (date > latest) latest = date;
  }
  const subscribers = issuances.filter((t: any) => String(t.transferDate ?? t.createdAtISO ?? "") === latest);
  const classById = new Map<string, any>(classes.map((c: any) => [String(c._id), c]));
  const roleById = new Map<string, any>(roleHolders.map((r: any) => [String(r._id), r]));
  const created: string[] = [];
  for (const t of subscribers) {
    const cls = t.rightsClassId ? classById.get(String(t.rightsClassId)) : undefined;
    const role = t.destinationRoleHolderId ? roleById.get(String(t.destinationRoleHolderId)) : undefined;
    const subscriberName = String(role?.fullName ?? t.destinationHolderName ?? "Subscriber");
    const consideration =
      cleanText(t.considerationDescription) ?? cleanText(t.considerationType) ?? undefined;
    const blocks = buildSubscriptionAgreementBlocks({
      corporationName: args.renderCtx.org.name,
      shortName: args.renderCtx.org.shortName,
      legislation: args.renderCtx.org.legislation,
      subscriberName,
      shareClass: String(cls?.className ?? ""),
      quantity: Number(t.quantity ?? 0),
      consideration,
      dateLong: args.renderCtx.date.long,
    });
    const dataUrl = documentDocxDataUrl("Subscription for Shares", blocks);
    const fileName = `subscription-for-shares-${created.length + 1}.docx`;
    const docId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title: `Subscription for Shares — ${subscriberName}`,
      category: "governance",
      fileName,
      mimeType: corporationPacketDocxMimeType(),
      content: `Subscription for Shares for ${subscriberName}.`,
      url: dataUrl,
      fileSizeBytes: dataUrl.length,
      retentionYears: 7,
      createdAtISO: args.now,
      reviewStatus: "needs_signature",
      librarySection: "governance",
      flaggedForDeletion: false,
      sourceExternalIds: [...args.sourceExternalIds, "societyer:subscription-annex"],
      tags: ["corporation-packet", "subscription-agreement", "editable-docx"],
    });
    await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId: docId,
      version: 1,
      storageProvider: "generated-inline",
      storageKey: dataUrl,
      fileName,
      mimeType: corporationPacketDocxMimeType(),
      fileSizeBytes: dataUrl.length,
      uploadedByName: "Societyer packet generator",
      uploadedAtISO: args.now,
      changeNote: `Generated Subscription for Shares for ${subscriberName}.`,
      isCurrent: true,
    });
    created.push(docId as unknown as string);
  }
  return created;
}

/**
 * Build the packet-specific operative data context that the resolution body
 * binds (YCN Doc - Annual / Doc - Dividends). Keyed off packet.key so generic
 * packets are unaffected. Logic lives in the tested shared/* helpers.
 */
async function buildPacketDataContext(
  ctx: any,
  packet: (typeof CORPORATION_DOCUMENT_PACKETS)[number],
  societyId: any,
  society: any,
  renderCtx: { dir: { list: Array<{ name: string }> }; date?: { long?: string } },
  runData?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (packet.key === "share-split" && runData) {
    const lines = Array.isArray(runData.lines) ? (runData.lines as Array<Record<string, unknown>>) : [];
    return {
      ShareClass: String(runData.shareClassName ?? ""),
      SplitRatio: String(runData.ratioLabel ?? ""),
      EffectiveDate: renderCtx.date?.long ?? String(runData.effectiveDate ?? ""),
      PreSplitCount: Number(runData.totalBefore ?? 0),
      PostSplitCount: Number(runData.totalAfter ?? 0),
      ConsolidationFlag: runData.kind === "consolidation" ? "Yes" : "No",
      FractionalShareTreatment: "rounded down (no fractional shares issued)",
      split: {
        ratioLabel: String(runData.ratioLabel ?? ""),
        kind: String(runData.kind ?? ""),
        totalBefore: Number(runData.totalBefore ?? 0),
        totalAfter: Number(runData.totalAfter ?? 0),
        sharesDropped: Number(runData.sharesDropped ?? 0),
        hasLines: lines.length > 0,
        hasDroppedShares: Number(runData.sharesDropped ?? 0) > 0,
        lines: lines.map((line) => ({
          holderName: String(line.holderName ?? ""),
          before: Number(line.before ?? 0),
          after: Number(line.after ?? 0),
        })),
      },
    };
  }
  if (packet.key === "appoint-officer" || packet.key === "appoint-director" || packet.key === "director-removal") {
    const roleHolders = await ctx.db
      .query("roleHolders")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    if (packet.key === "appoint-officer") return officerAppointmentView(roleHolders);
    if (packet.key === "appoint-director") return directorAppointmentView(roleHolders);
    return directorRemovalView(roleHolders);
  }
  if (packet.key === "share-transfer") {
    const [transfers, classes] = await Promise.all([
      ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("rightsClasses").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ]);
    const classNameById: Record<string, string> = {};
    for (const c of classes) classNameById[String(c._id)] = String(c.className ?? "");
    return shareTransferView(transfers, classNameById);
  }
  if (packet.key === "share-certificate") {
    const certs = await ctx.db
      .query("shareCertificates")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return shareCertificateView(certs);
  }
  if (packet.key === "change-of-offices") {
    const addresses = await ctx.db
      .query("organizationAddresses")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return officeChangeView(addresses);
  }
  if (packet.key === "asset-transfer") {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return assetTransferView(assets);
  }
  if (packet.key === "annual-resolutions") {
    return {
      annual: buildAnnualResolutionContext({
        waivePrepFinancials: society?.waivePrepFinancials,
        fiscalYearEnd: society?.fiscalYearEnd,
        directors: renderCtx.dir.list,
      }),
    };
  }
  if (packet.key === "dividend-declaration") {
    const rows = await ctx.db
      .query("dividends")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    // The latest declaration date's rows make up one multi-class declaration.
    let latest = "";
    for (const row of rows) {
      const declaredOn = String(row.declaredOn ?? "");
      if (declaredOn > latest) latest = declaredOn;
    }
    const declarationRows = rows
      .filter((row: any) => String(row.declaredOn ?? "") === latest)
      .map((row: any) => ({
        shareClass: String(row.shareClass ?? ""),
        perShareCents: Number(row.perShareCents ?? 0),
        sharesOutstanding: Number(row.sharesOutstanding ?? 0),
        totalCents: Number(row.totalCents ?? 0),
        currency: String(row.currency ?? ""),
      }));
    return {
      dividend: buildDividendResolutionContext(declarationRows, { declaredDate: latest || undefined }),
    };
  }
  return {};
}

async function defaultPacketSignerRoleHolderIds(ctx: any, societyId: any) {
  const roleHolders = await ctx.db
    .query("roleHolders")
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .collect();
  return roleHolders
    .filter((row: any) => row.status === "current" && ["director", "officer", "authorized_representative"].includes(row.roleType))
    .map((row: any) => row._id);
}

async function createPacketSigners(ctx: any, args: {
  societyId: any;
  generatedDocumentId: any;
  roleHolderIds: any[];
  eventId?: string;
  sourceExternalIds: string[];
}) {
  const signerIds: string[] = [];
  for (const roleHolderId of args.roleHolderIds) {
    const roleHolder = await ctx.db.get(roleHolderId);
    if (!roleHolder) continue;
    signerIds.push(await ctx.db.insert("legalSigners", {
      societyId: args.societyId,
      status: "unsigned",
      fullName: roleHolder.fullName ?? "Unnamed signer",
      firstName: roleHolder.firstName,
      lastName: roleHolder.lastName,
      email: roleHolder.email,
      phone: roleHolder.phone,
      signerTag: roleHolder.signerTag ?? roleHolder.roleType,
      eventId: args.eventId,
      generatedDocumentId: args.generatedDocumentId,
      roleHolderId,
      sourceExternalIds: args.sourceExternalIds,
      notes: "Signer placeholder staged from corporation document packet.",
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    }));
  }
  return signerIds;
}

async function syncRightsHoldings(ctx: any, societyId: any) {
  const [existingHoldings, transfers] = await Promise.all([
    ctx.db.query("rightsHoldings").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  const now = new Date().toISOString();
  const nextHoldings = materializeRightsHoldings(transfers.sort(rightsholdingTransferChronologicalSort));
  const nextByKey = new Map(nextHoldings.map((holding) => [`${holding.rightsClassId}:${holding.holderKey}`, holding]));
  const existingByKey = new Map<string, any>(existingHoldings.map((holding: any) => [`${holding.rightsClassId}:${holding.holderKey}`, holding]));

  for (const existing of existingHoldings) {
    const key = `${existing.rightsClassId}:${existing.holderKey}`;
    if (!nextByKey.has(key)) {
      await ctx.db.delete(existing._id);
    }
  }

  for (const holding of nextHoldings) {
    const key = `${holding.rightsClassId}:${holding.holderKey}`;
    const existing = existingByKey.get(key);
    const payload = {
      societyId,
      rightsClassId: holding.rightsClassId,
      holderRoleHolderId: holding.holderRoleHolderId,
      holderKey: holding.holderKey,
      quantity: holding.quantity,
      status: holding.status,
      lastTransactionId: holding.lastTransactionId,
      sourceDocumentIds: holding.sourceDocumentIds,
      sourceExternalIds: holding.sourceExternalIds,
      updatedAtISO: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("rightsHoldings", { ...payload, createdAtISO: now });
    }
  }
}

function cleanDocumentIds(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as any[];
}

function rightsholdingTransferChronologicalSort(left: any, right: any) {
  const leftDate = String(left.transferDate ?? left.createdAtISO ?? left._creationTime ?? "");
  const rightDate = String(right.transferDate ?? right.createdAtISO ?? right._creationTime ?? "");
  const dateSort = leftDate.localeCompare(rightDate);
  if (dateSort !== 0) return dateSort;
  return Number(left._creationTime ?? 0) - Number(right._creationTime ?? 0);
}
