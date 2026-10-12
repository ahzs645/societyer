import { filterDocumentLinkedRows } from "./documents";
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
  getGlobalOrOwned,
  getOwned,
  requireAuthenticated,
  requireSocietyMembership,
} from "./access";
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
import { assertPacketCompatible, packetDataWithProvenance } from "../templateProvenance";
import { deriveCurrentHoldings, materializeRightsHoldings, type RightsholdingTransferRecord } from "../equityLedger";
import { planShareSplit, validateRatio, type HoldingPosition, type SplitRatio } from "../shareSplit";
import { bodyRowsAsOf, buildSocietyRenderContext, roleHoldersInOffice } from "../societyRenderContext";
import { formatLongDate, resolveLocale } from "../locale";
import {
  addressInForce,
  assetTransferView,
  corporateLawContext,
  directorAppointmentView,
  directorDepartureView,
  dividendDeclarationView,
  formatAddress,
  isoDay,
  officeChangeView,
  officerAppointmentView,
  packetEventDatesByKind,
  shareCertificateView,
  shareIssuanceView,
  shareRedemptionView,
  shareSplitView,
  shareTransferView,
  type PacketScope,
} from "../packetOperativeData";
import { bodySigners, buildExecutionBlock, resolvingBodyFor, type SignerLine } from "../executionBlock";
import { activeAsOf, type IntervalRow } from "../registerHistory";
import { annualResolutionDataWithAuthority, buildAnnualResolutionContext, type AnnualResolutionContext } from "../annualResolution";
import { generatedPreparationReviewView } from "../preparationDocumentState";
import { renderInstrument, renderedPacketBlocks, withExecution } from "../packetInstrument";
import { renderTemplate } from "../templateAssembly";
import { capitalizeFirst } from "../nlg";
import type { RenderContext, GroupContext } from "../renderContext";

export async function templateEnginePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<any> {
  await requireSocietyMembership(ctx, societyId);
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
    runs: (await filterDocumentLinkedRows(ctx, societyId, runs, "legalPrecedentRuns")).sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
    generatedDocuments: (await filterDocumentLinkedRows(ctx, societyId, generatedDocuments, "generatedLegalDocuments")).map(generatedPreparationReviewView).sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO))),
    signers: (await filterDocumentLinkedRows(ctx, societyId, signers, "legalSigners")).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName))),
    packetEventDates: await packetEventDatesForSociety(ctx, societyId),
  };
}

/**
 * The dates on which each transaction-scoped corporate packet has a recorded
 * transaction (newest first), so the catalog offers only meaningful dates.
 * Societies get an empty map.
 */
async function packetEventDatesForSociety(ctx: PortableQueryCtx, societyId: string): Promise<Record<string, string[]>> {
  const society = await ctx.db.get(societyId as any);
  if (!isCorporation(society as any)) return {};
  const read = (table: string) => ctx.db.query(table as any).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect() as Promise<any[]>;
  const [roleHolders, transfers, certificates, addresses, assets, dividends] = await Promise.all([
    read("roleHolders"), read("rightsholdingTransfers"), read("shareCertificates"), read("organizationAddresses"), read("assets"), read("dividends"),
  ]);
  return packetEventDatesByKind({ roleHolders, transfers, certificates, addresses, assets, dividends });
}

export async function seedStarterPolicyTemplatesPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }): Promise<any> {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, societyId);
  return seedCorporationDocumentPacketsForSociety(ctx, societyId);
}

export async function seedSocietyDocumentPacketsPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }): Promise<any> {
  await requireSocietyMembership(ctx, societyId);
  return seedSocietyDocumentPacketsForSociety(ctx, societyId);
}

/**
 * Core of catalog generation, callable directly (e.g. by the firm-wide batch
 * generator in convex/firm.ts) without going through the mutation wrapper.
 */
export async function generatePacketForSocietyPortable(
  ctx: PortableMutationCtx,
  args: { societyId: any; packetKey: string; effectiveDate?: string; transactionIds?: string[] },
): Promise<any> {
  {
    const runPayload = JSON.stringify({
      packetKey: args.packetKey,
      ...(args.transactionIds?.length ? { transactionIds: args.transactionIds.map(String) } : {}),
    });
    const corpPacket = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === args.packetKey);
    const socPacket = SOCIETY_DOCUMENT_PACKETS.find((p) => p.key === args.packetKey);
    const packet = corpPacket ?? socPacket;
    if (!packet) throw new Error(`No document packet matches key: ${args.packetKey}`);
    assertPacketCompatible(await ctx.db.get(args.societyId), packet);
    const markerKind = corpPacket ? "corporation" : "society";
    const organization = await ctx.db.get(args.societyId);
    if (!organization) throw new Error("Workspace not found.");
    if (isCorporation(organization) !== Boolean(corpPacket)) {
      throw new Error(`The ${markerKind} document packet does not apply to this workspace's entity type.`);
    }
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
      dataJson: runPayload,
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
      dataJson: runPayload,
      notes: "Generated from the document catalog.",
    });
    return { runId, packetKey: packet.key, precedentId: precedent._id, ...artifacts };
  }
}

export async function generateDocumentFromCatalogPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; packetKey: string; effectiveDate?: string; transactionIds?: string[] },
): Promise<any> {
  await requireSocietyMembership(ctx, args.societyId);
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

export async function seedDocumentPacketsForEntityRegisteredPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
): Promise<any> {
  await requireSocietyMembership(ctx, societyId);
  return seedDocumentPacketsForEntityPortable(ctx, societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.filingId) await getOwned(ctx, "filings", args.filingId, args.societyId);
  const packet = args.packetKey
    ? CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === args.packetKey)
    : corporationPacketForComplianceObligation({
        filingKind: args.filingKind,
        obligationKey: args.obligationKey,
        ruleId: args.obligationRuleId,
        organization: await ctx.db.get(args.societyId),
      });
  if (!packet) throw new Error("No corporation document packet matches this obligation.");
  assertPacketCompatible(await ctx.db.get(args.societyId), packet);
  await seedCorporationDocumentPacketsForSociety(ctx, args.societyId);

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
  await requireSocietyMembership(ctx, args.societyId);
  const transfer = await getOwned(ctx, "rightsholdingTransfers", args.transferId, args.societyId);
  if (transfer.transferType !== "issuance") {
    throw new Error("Only issuance transfers can stage the share issuance packet.");
  }
  const packet = CORPORATION_DOCUMENT_PACKETS.find((candidate) => candidate.key === "issue-shares");
  if (!packet) throw new Error("Share issuance packet is not configured.");
  assertPacketCompatible(await ctx.db.get(args.societyId), packet);

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
  await requireSocietyMembership(ctx, args.societyId);
  const rightsClass = await getOwned(ctx, "rightsClasses", args.rightsClassId, args.societyId);
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
  const existing = id
    ? await getGlobalOrOwned(ctx, "legalTemplateDataFields", id, args.societyId)
    : null;
  const societyId = args.societyId ?? existing?.societyId;
  if (societyId) await requireSocietyMembership(ctx, String(societyId));
  else requireAuthenticated(ctx);
  if (existing && typeof existing.societyId !== "string" && args.societyId) {
    throw new Error("legalTemplateDataFields not found.");
  }
  const now = new Date().toISOString();
  const payload = {
    societyId,
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
  await getGlobalOrOwned(ctx, "legalTemplateDataFields", id);
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
  const run = await ctx.db.get(args.runId);
  const sourceExternalIds = [
    ...(run?.sourceExternalIds ?? []),
    `societyer:corporation-packet-run:${args.packet.key}`,
    `societyer:legal-precedent-run:${args.runId}`,
  ];
  // Build a grammar/data context so generated packet prose binds {token}/{#if}/
  // {#each} markup (token-free packets are unaffected). Every fact is read as
  // at the document date (YCN start <= date < end): the legal name, the Act,
  // the directors, the shareholders and the voting shareholders. Logic in the
  // tested shared/societyRenderContext.ts.
  const society = await ctx.db.get(args.societyId);
  assertPacketCompatible(society, args.packet);
  let provenanceData = packetDataWithProvenance(args.dataJson, society, args.packet);
  const asOf = args.effectiveDate ?? now;
  const read = (table: string): Promise<any[]> => ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", args.societyId)).collect();
  const [roleHolders, transfers, rightsClasses, nameHistory, constating] = await Promise.all([
    read("roleHolders"), read("rightsholdingTransfers"), read("rightsClasses"), read("societyNameHistory"), read("constatingEvents"),
  ]);
  const registers = { roleHolders, transfers, rightsClasses };
  const renderCtx = society
    ? buildSocietyRenderContext(society, roleHolders, asOf, {
        transfers,
        rightsClasses,
        nameHistory: nameHistory.map((row: any) => ({ name: String(row.name ?? ""), shortName: row.shortName, startISO: String(row.startISO ?? ""), regPosn: row.regPosn })),
        constating: constating.map((row: any) => ({ action: row.action, jurisdiction: String(row.jurisdiction ?? ""), legislation: String(row.legislation ?? ""), regNumber: row.regNumber, startISO: String(row.startISO ?? "") })),
      })
    : undefined;
  const body = resolvingBodyFor(args.packet.requiredSigners ?? []);
  // Default signer placeholders: the resolving body's members as at the date.
  const bodyRows = renderCtx ? bodyRowsAsOf(roleHolders, asOf, { transfers, rightsClasses })[groupRowsKey(body.group)] : [];
  const signerRoleHolderIds = args.packet.preparationOnly || !args.packet.signatureRequired ? [] : args.signerRoleHolderIds?.length
    ? args.signerRoleHolderIds
    : bodyRows.length
      ? bodyRows.map((row: any) => row._id)
      : body.group === "dir" ? await defaultPacketSignerRoleHolderIds(ctx, args.societyId) : [];
  // Compute the execution/signature block (adoption clause + signature page) so
  // the generated DOCX is a signable instrument, not a checklist. Signatories
  // are the resolving body's members as at the date (directors for a directors'
  // resolution, voting shareholders for theirs), enriched from the per-entity
  // signer roster (entitySigners) for corporate "By:" blocks.
  let context: Record<string, unknown> | undefined = renderCtx as unknown as
    | Record<string, unknown>
    | undefined;
  let docPacket = args.packet;
  if (renderCtx) {
    const signerRoster = await read("entitySigners");
    const activeRoster = activeAsOf(signerRoster as unknown as IntervalRow[], asOf, {
      start: "validFromISO",
      end: "validToISO",
    }) as Array<{ name?: string; corpSign?: string | null; signOrder?: number }>;
    const group = (renderCtx as unknown as Record<string, GroupContext>)[body.group];
    let signers: SignerLine[];
    if (group?.list.length) {
      signers = bodySigners(group.list, body, activeRoster);
    } else if (body.group === "dir" && activeRoster.length) {
      // Legacy: a roster with no recorded directors signs a directors' resolution.
      signers = [...activeRoster]
        .sort((a, b) => (a.signOrder ?? Infinity) - (b.signOrder ?? Infinity))
        .map((s) => ({ name: String(s.name ?? ""), corpSign: s.corpSign ?? null }));
    } else {
      signers = [];
    }
    // Packet-specific operative data so the resolution body renders real clauses
    // for the transaction of the date (YCN Doc - * sheets), not a generic blurb.
    let runData: Record<string, unknown> | undefined;
    try {
      runData = args.dataJson ? JSON.parse(args.dataJson) : undefined;
    } catch {
      runData = undefined;
    }
    const dataContext = await buildPacketDataContext(ctx, args.packet, args.societyId, society, renderCtx, runData, { asOf, ...registers });
    const baseContext: Record<string, unknown> = { ...renderCtx, ...dataContext };
    const instrument = args.packet.instrument ? renderInstrument(args.packet.instrument, baseContext) : undefined;
    // "resolution" vs "resolutions" follows the numbered clauses actually present.
    const resolutionsPlural = instrument
      ? instrument.resolutionsPlural
      : args.packet.sections.reduce((sum, section) => sum + section.body.length, 0) > 1;
    const locale = resolveLocale(society?.docPrepLanguage);
    const execution = args.packet.preparationOnly || !args.packet.signatureRequired ? undefined : buildExecutionBlock({
      shortName: renderCtx.org.shortName,
      legislation: renderCtx.org.legislation,
      noun: body.noun,
      resolutionsPlural,
      signers,
      dateLong: renderCtx.date.long,
      locale,
    });
    context = {
      ...baseContext,
      ...(execution ? { execution } : {}),
      ...(instrument
        ? {
            instrument: {
              blocks: withExecution(instrument, execution ? { adoptionClause: execution.adoptionClause, dateLong: renderCtx.date.long, signers, datedLabel: locale === "fr" ? "Daté le" : "Dated" } : undefined),
              clauseCount: instrument.clauseCount,
              resolutionsPlural: instrument.resolutionsPlural,
            },
          }
        : {}),
    };
    // The DOCX renders section body blocks (shared/packetBlocks.ts): hand it the
    // instrument as rendered for this transaction (rows, numbering and
    // cross-references resolved) in place of the templated catalog sections.
    if (instrument && !args.packet.preparationOnly) {
      docPacket = {
        ...args.packet,
        sections: [{ heading: args.packet.templateName, body: renderedPacketBlocks(instrument) }],
      };
    }
    if (args.packet.key === "annual-resolutions" && dataContext.annual) {
      provenanceData = annualResolutionDataWithAuthority(provenanceData, dataContext.annual as AnnualResolutionContext, now);
    }
  }
  // Deterministic file name (YCN ENT-DOCTYPE-DATE) + optional doc-ID header.
  const fileOpts = { shortName: society?.shortName, effectiveDate: args.effectiveDate ?? now };
  if (society?.includeDocumentIdHeader) {
    context = { ...(context ?? {}), documentId: corporationPacketDocumentId(args.packet, fileOpts) };
  }
  const docxDataUrl = corporationPacketDocxDataUrl(docPacket, context);
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
    createdAtISO: now,
    reviewStatus: args.packet.preparationOnly || !args.packet.signatureRequired ? "needs_review" : "needs_signature",
    librarySection: "governance",
    flaggedForDeletion: false,
    sourceExternalIds,
    sourcePayloadJson: provenanceData,
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
    status: args.packet.preparationOnly ? "needs_review" : "draft",
    draftDocumentId,
    sourceTemplateName: args.packet.templateName,
    precedentRunId: args.runId,
    eventId: args.eventId,
    effectiveDate: args.effectiveDate,
    documentTag: args.packet.documentTag,
    dataJson: provenanceData,
    subloopJsonList: [],
    signersRequiredRoleHolderIds: signerRoleHolderIds,
    signersWhoSignedIds: [],
    signerTagsRequired: args.packet.preparationOnly ? [] : args.packet.requiredSigners ?? [],
    signerTagsSigned: [],
    sourceDocumentIds: [draftDocumentId],
    sourceExternalIds: cleanList([
      ...sourceExternalIds,
      `societyer:editable-document:${draftDocumentId}`,
      `societyer:document-version:${draftDocumentVersionId}`,
    ]),
    notes: args.packet.preparationOnly ? [args.notes, "Preparation draft only: complete review and prepare a separate execution copy with the lawful electorate. No signatures, meeting completion or filing acceptance are inferred."].filter(Boolean).join("\n") : args.notes,
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
    summary: args.packet.preparationOnly ? `Editable preparation draft and provenance staged for ${args.packet.packageName}; execution and filing remain separate.` : `Editable document, generated-document row, signer placeholders, and minute-book record staged for ${args.packet.packageName}.`,
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
 * binds (YCN Doc - * sheets). Keyed off packet.key so generic packets are
 * unaffected. Every transaction-scoped view reads only the rows effective on
 * the document date, or the selected transaction ids (`runData.transactionIds`,
 * or the staged ledger row `runData.transferId`). Logic lives in the tested
 * shared/packetOperativeData.ts helpers.
 */
async function buildPacketDataContext(
  ctx: any,
  packet: (typeof CORPORATION_DOCUMENT_PACKETS)[number],
  societyId: any,
  society: any,
  renderCtx: RenderContext,
  runData: Record<string, unknown> | undefined,
  registers: { asOf: string; roleHolders: any[]; transfers: any[]; rightsClasses: any[] },
): Promise<Record<string, unknown>> {
  const data = runData ?? {};
  const selected = Array.isArray(data.transactionIds) ? (data.transactionIds as unknown[]).map(String).filter(Boolean)
    : typeof data.transferId === "string" && data.transferId ? [data.transferId] : undefined;
  const scope: PacketScope = { asOf: isoDay(registers.asOf) || registers.asOf, ids: selected };
  const read = (table: string): Promise<any[]> => ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const corporate = CORPORATION_DOCUMENT_PACKETS.some((candidate) => candidate.key === packet.key);
  // Law fragments may carry {org.*} tokens; bind them once against the render context.
  const lawRaw = corporateLawContext(society, renderCtx.org.legislation);
  const law = Object.fromEntries(Object.entries(lawRaw).map(([key, value]) => [key, typeof value === "string" ? renderTemplate(value, renderCtx as unknown as Record<string, unknown>) : value]));
  const president = roleHoldersInOffice(registers.roleHolders, "officer", scope.asOf)
    .some((row: any) => [row.officerTitle, ...(row.additionalOfficerTitles ?? [])].some((title: unknown) => /president/i.test(String(title ?? "")) && !/vice/i.test(String(title ?? ""))));
  const officerPhrase = president ? "the President" : "any director";
  const common = corporate ? { law, signing: { officerPhrase, OfficerPhrase: capitalizeFirst(officerPhrase) } } : {};
  const shareRegisters = async () => ({
    transfers: registers.transfers,
    classes: registers.rightsClasses,
    roleHolders: registers.roleHolders,
    certificates: await read("shareCertificates"),
  });

  switch (packet.key) {
    case "appoint-officer":
      return { ...common, ...officerAppointmentView(registers.roleHolders, scope) };
    case "appoint-director":
      return { ...common, ...directorAppointmentView(registers.roleHolders, scope) };
    case "appoint-director-by-directors": {
      const view = directorAppointmentView(registers.roleHolders, scope);
      return { ...common, appointment: { ...view.appointment, isAdditional: data.basis === "additional" } };
    }
    case "director-removal":
    case "director-resignation":
      return { ...common, ...directorDepartureView(registers.roleHolders, scope) };
    case "issue-shares":
      return { ...common, ...shareIssuanceView(await shareRegisters(), scope) };
    case "share-transfer":
      return { ...common, ...shareTransferView(await shareRegisters(), scope, { consentRequired: transferConsentRequiredFor(society, registers.rightsClasses) }) };
    case "share-certificate":
      return { ...common, ...shareCertificateView(await read("shareCertificates"), scope, registers.rightsClasses) };
    case "share-redemption":
      return { ...common, ...shareRedemptionView(await shareRegisters(), scope, data) };
    case "share-split": {
      const lines = Array.isArray(data.lines) && data.lines.length ? data : splitRunDataFromLedger(registers, scope);
      const cls = registers.rightsClasses.find((row: any) => String(row._id) === String(lines.rightsClassId ?? data.rightsClassId ?? ""));
      const view = shareSplitView(lines, cls);
      return {
        ...common,
        ShareClass: String(lines.shareClassName ?? cls?.className ?? ""),
        SplitRatio: String(lines.ratioLabel ?? ""),
        EffectiveDate: renderCtx.date?.long ?? String(lines.effectiveDate ?? ""),
        PreSplitCount: Number(lines.totalBefore ?? 0),
        PostSplitCount: Number(lines.totalAfter ?? 0),
        ConsolidationFlag: lines.kind === "consolidation" ? "Yes" : "No",
        FractionalShareTreatment: "rounded down (no fractional shares issued)",
        ...view,
      };
    }
    case "change-of-offices":
      return { ...common, ...officeChangeView(await read("organizationAddresses"), scope) };
    case "asset-transfer":
      return { ...common, ...assetTransferView(await read("assets"), scope) };
    case "dividend-declaration":
      return {
        ...common,
        ...dividendDeclarationView(await read("dividends"), scope, registers.rightsClasses, {
          recordDate: typeof data.recordDate === "string" ? data.recordDate : undefined,
          paymentDate: typeof data.paymentDate === "string" ? data.paymentDate : undefined,
        }),
      };
    case "annual-resolutions":
      return {
        ...common,
        annual: buildAnnualResolutionContext({
          organization: society,
          waivePrepFinancials: society?.waivePrepFinancials,
          waiveAuditor: data.waiveAuditor === true,
          auditorName: typeof data.auditorName === "string" ? data.auditorName : undefined,
          fiscalYearEnd: society?.fiscalYearEnd,
          financialPeriodEnd: typeof data.financialPeriodEnd === "string" ? data.financialPeriodEnd : undefined,
          annualBusinessYear: typeof data.annualBusinessYear === "number" ? data.annualBusinessYear : undefined,
          annualReferenceDate: typeof data.annualReferenceDate === "string" ? data.annualReferenceDate : undefined,
          includeRatification: data.includeRatification === true,
          directors: renderCtx.dir.list,
        }),
      };
    case "annual-directors-resolution": {
      const addresses = await read("organizationAddresses");
      const office = (type: string) => formatAddress(addressInForce(addresses, type, scope.asOf) ?? addresses.find((row: any) => row.type === type && row.status === "current"));
      const period = typeof data.financialPeriodEnd === "string" ? isoDay(data.financialPeriodEnd) : "";
      const year = typeof data.annualBusinessYear === "number" ? String(data.annualBusinessYear) : scope.asOf.slice(0, 4);
      const registered = office("registered_office");
      const records = office("records_office");
      return {
        ...common,
        ...officerAppointmentView(registers.roleHolders, scope, { allInOffice: true }),
        annualDirectors: {
          year,
          hasFinancialPeriod: Boolean(period),
          financialPeriodLong: period ? formatLongDate(period) : "",
          registered, records, hasRegistered: Boolean(registered), hasRecords: Boolean(records),
        },
      };
    }
    default:
      return common;
  }
}

/** Map a resolving-body group to its row list in bodyRowsAsOf. */
function groupRowsKey(group: "dir" | "shareholders" | "votingShareholders" | "members" | "officers") {
  return group === "dir" ? "directors" : group;
}

/**
 * Whether the articles require the directors' consent to a transfer. Reads the
 * operative-articles record when present (COMMON contract:
 * `operativeArticles.transferConsentRequired`, or the organization flag
 * `transferRequiresDirectorConsent`), else the class transfer conditions.
 */
function transferConsentRequiredFor(society: any, classes: any[]): boolean {
  if (society?.operativeArticles?.transferConsentRequired === true || society?.transferRequiresDirectorConsent === true) return true;
  if (society?.operativeArticles?.transferConsentRequired === false || society?.transferRequiresDirectorConsent === false) return false;
  return classes.some((row: any) => /consent of the (?:board|directors)|directors'? consent|board consent/i.test(String(row.conditionsToTransfer ?? "")));
}

/**
 * Split lines for a catalog-generated split packet: per-holder subdivision or
 * consolidation rows posted on the event date, with holdings just before it.
 */
function splitRunDataFromLedger(registers: { transfers: any[]; roleHolders: any[] }, scope: PacketScope): Record<string, unknown> {
  const rows = registers.transfers.filter((t: any) => (t.transferType === "subdivision" || t.transferType === "consolidation") && t.status !== "void"
    && (scope.ids?.length ? scope.ids.includes(String(t._id)) : isoDay(t.transferDate) === scope.asOf));
  if (!rows.length) return {};
  const before = deriveCurrentHoldings(registers.transfers.filter((t: any) => t.status === "posted" && isoDay(t.transferDate) < isoDay(rows[0].transferDate)) as RightsholdingTransferRecord[]);
  const name = (id: unknown, fallback: unknown) => String(registers.roleHolders.find((r: any) => String(r._id) === String(id ?? ""))?.fullName ?? fallback ?? "");
  const lines = rows.map((t: any) => {
    const gains = Boolean(t.destinationRoleHolderId || t.destinationHolderName);
    const holderKey = gains ? (t.destinationRoleHolderId ? `roleHolder:${t.destinationRoleHolderId}` : `name:${t.destinationHolderName}`) : (t.sourceRoleHolderId ? `roleHolder:${t.sourceRoleHolderId}` : `name:${t.sourceHolderName}`);
    const held = before.find((h) => h.rightsClassId === String(t.rightsClassId ?? "") && h.holderKey === holderKey)?.quantity ?? 0;
    const quantity = Number(t.quantity ?? 0);
    return { holderName: gains ? name(t.destinationRoleHolderId, t.destinationHolderName) : name(t.sourceRoleHolderId, t.sourceHolderName), before: held, after: gains ? held + quantity : held - quantity };
  });
  return {
    rightsClassId: rows[0].rightsClassId,
    kind: rows[0].transferType,
    ratioLabel: String(rows[0].considerationDescription ?? ""),
    lines,
  };
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
