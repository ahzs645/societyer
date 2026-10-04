import { canonicalizeJurisdictionCode, homeJurisdictionCode, organizationEntityType, type LegalEntityLike } from "../organizationDomain";
import { INCORPORATION_PREPARATION_GUIDES, type IncorporationPreparationGuide } from "./data/preparation";
import { POST_INCORPORATION_FLOWS, type PostIncorporationFlow } from "./data/steps";
import { validatePipelineGraph, type PipelineGraph } from "./pipeline";
import { CORPORATION_DOCUMENT_PACKETS } from "../corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../societyDocumentPackets";

export type PathwayEntity = LegalEntityLike & {
  legalSubtype?: string | null;
  isMemberFunded?: boolean;
  isCharity?: boolean;
  charityStatus?: string;
};
export type PathwayDefinition = {
  key: string;
  version: string;
  title: string;
  availability: "preparation" | "review_required";
  eligibility: {
    jurisdictions: string[];
    entityTypes: string[];
    acts: string[];
    subtypes: string[];
  };
  setup: { label: string; jurisdictionCode: string; entityType: string; actFormedUnder: string; hint: string };
  message: string;
  preparation?: IncorporationPreparationGuide;
  flow?: PostIncorporationFlow;
  packetKeys: string[];
  packetContexts?: Record<string, { kind: "extra_provincial"; jurisdictions: string[] }>;
  pipeline?: PipelineGraph;
};

function incorporationPipeline(key: string, guide: IncorporationPreparationGuide): PipelineGraph {
  const company = key !== "bc_society";
  return {
    version: 1,
    inputFields: [
      { key: "proposedName", label: "Proposed legal or working name", type: "text", required: true },
      { key: "registeredOffice", label: "Registered office address", type: "text", required: true },
      { key: "directors", label: "Initial directors and consent references", type: "text", required: true },
      ...(company ? [
        { key: "namedCompany", label: "Use a named company (turn off for a numbered company)", type: "boolean" as const, required: true },
        { key: "shareStructure", label: "Share structure and subscription review reference", type: "text" as const, required: true },
      ] : [{ key: "purposes", label: "Society purposes", type: "text" as const, required: true }]),
      ...(key === "bc_company" ? [{ key: "recordsOffice", label: "BC records office address", type: "text" as const, required: true }] : []),
    ],
    nodes: [
      { key: "collect-information", title: "Confirm incorporation information", kind: "manual", dependsOn: [] },
      { key: "name-approval", title: "Record the required name approval", kind: "document", dependsOn: ["collect-information"], requiresEvidence: true, requiresUploadedEvidence: true,
        ...(company ? { condition: { field: "namedCompany", operator: "equals" as const, value: true } } : {}) },
      ...(company ? [{ key: "numbered-name", title: "Confirm the numbered-company route", kind: "manual" as const, dependsOn: ["collect-information"], condition: { field: "namedCompany", operator: "equals" as const, value: false } }] : []),
      { key: "prepare-documents", title: "Prepare and review the incorporation document packet", kind: "document", dependsOn: ["name-approval", ...(company ? ["numbered-name"] : [])], requiresEvidence: true },
      { key: "review", title: "Independent preparation review", kind: "approval", dependsOn: ["prepare-documents"], approval: { permission: "documents:write", distinctInitiator: true } },
      { key: "submit", title: "Complete filing in the official registry", kind: "submission", dependsOn: ["review"], submission: { adapterId: "official-portal", officialUrl: guide.filingChannel.onlineUrl } },
      { key: "retain-certificate", title: "Retain the official incorporation certificate", kind: "document", dependsOn: ["submit"], requiresEvidence: true, requiresUploadedEvidence: true },
    ],
  };
}

function incorporationPathway(input: Omit<PathwayDefinition, "version" | "preparation" | "flow" | "pipeline" | "packetKeys">): PathwayDefinition {
  const preparation = INCORPORATION_PREPARATION_GUIDES.find((guide) => guide.id === input.key);
  const flow = POST_INCORPORATION_FLOWS.find((candidate) => candidate.jurisdictionCode === input.setup.jurisdictionCode && candidate.entityTypes.includes(input.setup.entityType));
  const catalog = input.setup.entityType === "society" ? SOCIETY_DOCUMENT_PACKETS : CORPORATION_DOCUMENT_PACKETS;
  const registrationPackets = (flow?.steps ?? []).filter((step) => step.packetKey && step.appliesTo.contextKinds?.includes("extra_provincial"))
    .flatMap((step) => catalog.filter((packet) => packet.key === step.packetKey));
  return {
    ...input, version: "2026-10-03.1", preparation, flow,
    packetKeys: [...new Set([...catalog
      .filter((packet) => packet.jurisdictions.some((code) => input.eligibility.jurisdictions.includes(canonicalizeJurisdictionCode(code))))
      .map((packet) => packet.key), ...registrationPackets.map((packet) => packet.key)])],
    packetContexts: Object.fromEntries(registrationPackets.map((packet) => [packet.key, { kind: "extra_provincial", jurisdictions: packet.jurisdictions.map(canonicalizeJurisdictionCode) }])),
    pipeline: preparation ? incorporationPipeline(input.key, preparation) : undefined,
  };
}

/** Register a pathway here once. Compatibility accessors, UI and backend resolve this same list. */
export const PATHWAY_REGISTRY: readonly PathwayDefinition[] = createPathwayRegistry([
  incorporationPathway({
    key: "bc_society", title: "BC society incorporation", availability: "preparation",
    eligibility: { jurisdictions: ["CA-BC"], entityTypes: ["society", "society__bc_"], acts: ["societies_act"], subtypes: ["ordinary_society", "member_funded_society"] },
    setup: { label: "BC society (nonprofit)", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", hint: "British Columbia Societies Act; member governance." },
    message: "BC society preparation: confirm ordinary or member-funded classification, constitution, bylaws, eligible directors and official incorporation evidence. Charity registration is separate.",
  }),
  incorporationPathway({
    key: "bc_company", title: "BC ordinary private company incorporation", availability: "preparation",
    eligibility: { jurisdictions: ["CA-BC"], entityTypes: ["corporation__business_"], acts: ["business_corporations_act__british_columbia_", "business_corporations_act"], subtypes: ["ordinary_private_company"] },
    setup: { label: "BC business corporation (provincial)", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", hint: "British Columbia Business Corporations Act; shareholder governance." },
    message: "BC ordinary private company preparation. Confirm the articles, incorporation agreement and director eligibility; specialist company subtypes require review.",
  }),
  incorporationPathway({
    key: "federal_cbca", title: "Federal CBCA business incorporation", availability: "preparation",
    eligibility: { jurisdictions: ["CA-FED-CBCA"], entityTypes: ["corporation__business_"], acts: ["canada_business_corporations_act"], subtypes: ["federal_private_corporation"] },
    setup: { label: "Federal business corporation (CBCA)", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", hint: "Corporations Canada; provincial registration may also be needed where you operate." },
    message: "Federal CBCA business corporation preparation. Registry acceptance, execution and CRA accounts require their own evidence.",
  }),
  incorporationPathway({
    key: "ontario_obca", title: "Ontario OBCA business incorporation", availability: "review_required",
    eligibility: { jurisdictions: ["CA-ON-OBCA"], entityTypes: ["corporation__business_"], acts: ["business_corporations_act__ontario_"], subtypes: [] },
    setup: { label: "Ontario business corporation (OBCA)", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_", hint: "Existing Ontario guide track; incorporation preparation requires review." },
    message: "Ontario preparation remains under review. Confirm the Ontario rules and document forms before using a packet.",
  }),
]);

export function validatePathwayRegistry(entries: readonly PathwayDefinition[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9_-]{1,79}$/.test(entry.key) || keys.has(entry.key)) throw new Error("Pathway registration requires unique valid keys.");
    keys.add(entry.key);
    if (!entry.version?.trim() || !entry.title?.trim() || !entry.message?.trim()) throw new Error("Pathway version, title and guidance are required.");
    if (!["preparation", "review_required"].includes(entry.availability)) throw new Error("Unknown pathway availability.");
    if (!entry.eligibility.jurisdictions.length || !entry.eligibility.entityTypes.length || !entry.eligibility.acts.length) throw new Error("Explicit pathway jurisdiction, entity and governing Act are required.");
    for (const [field, values] of Object.entries(entry.eligibility)) {
      if (new Set(values).size !== values.length || values.some((value) => !value.trim() || value !== value.trim() || ["unknown", "organization"].includes(value))) throw new Error(`Invalid or duplicate explicit pathway ${field}.`);
    }
    if (entry.eligibility.jurisdictions.some((code) => canonicalizeJurisdictionCode(code) !== code)) throw new Error("Pathway registration requires canonical jurisdiction codes.");
    if (!entry.eligibility.jurisdictions.includes(entry.setup.jurisdictionCode) || !entry.eligibility.entityTypes.includes(entry.setup.entityType) || !entry.eligibility.acts.includes(entry.setup.actFormedUnder)) throw new Error("Setup choices must agree with pathway eligibility.");
    if (new Set(entry.packetKeys).size !== entry.packetKeys.length) throw new Error("Pathway packet keys must be unique.");
    for (const [packetKey, context] of Object.entries(entry.packetContexts ?? {})) {
      if (!entry.packetKeys.includes(packetKey) || context.kind !== "extra_provincial" || !context.jurisdictions.length || context.jurisdictions.some((code) => !code.trim() || code === "unknown" || canonicalizeJurisdictionCode(code) !== code)) throw new Error("Registration packet context must name a registered packet and explicit target jurisdictions.");
    }
    if (entry.availability === "preparation" && !entry.pipeline && !entry.preparation && !entry.flow) throw new Error("Available pathways require a definition to execute or display.");
    if (entry.preparation && (entry.preparation.id !== entry.key || !entry.eligibility.jurisdictions.includes(entry.preparation.jurisdictionCode) || !entry.eligibility.entityTypes.includes(entry.preparation.entityType))) throw new Error("Preparation guide and pathway eligibility disagree.");
    if (entry.flow) {
      if (!entry.eligibility.jurisdictions.includes(entry.flow.jurisdictionCode) || entry.flow.entityTypes.some((type) => !entry.eligibility.entityTypes.includes(type))) throw new Error("Checklist and pathway eligibility disagree.");
      for (const step of entry.flow.steps) if (step.packetKey && !entry.packetKeys.includes(step.packetKey)) throw new Error(`Checklist packet ${step.packetKey} is not registered for pathway ${entry.key}.`);
    }
    if (entry.pipeline) {
      const graph = validatePipelineGraph(entry.pipeline);
      for (const node of graph.nodes) if (node.packetKey && !entry.packetKeys.includes(node.packetKey)) throw new Error("Pipeline packet is not registered for this pathway.");
    }
  }
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    // Blank legal subtype/Act remains supported for legacy profiles. Therefore
    // jurisdiction + entity must identify exactly one route even without them.
    if (entries[i].eligibility.jurisdictions.some((code) => entries[j].eligibility.jurisdictions.includes(code)) && entries[i].eligibility.entityTypes.some((type) => entries[j].eligibility.entityTypes.includes(type))) throw new Error("Ambiguous pathway eligibility: jurisdiction and entity overlap.");
  }
}

/** Validate and deep-freeze trusted definitions so callers cannot alter active registration. */
export function createPathwayRegistry(entries: readonly PathwayDefinition[]): readonly PathwayDefinition[] {
  validatePathwayRegistry(entries);
  const snapshot = JSON.parse(JSON.stringify(entries)) as PathwayDefinition[];
  const freeze = (value: any): any => {
    if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  };
  return freeze(snapshot);
}

export function getPathway(key: string) { return PATHWAY_REGISTRY.find((entry) => entry.key === key); }

export const PATHWAY_LEGAL_SUBTYPE_OPTIONS = [
  ...PATHWAY_REGISTRY.flatMap((entry) => entry.eligibility.subtypes.map((value) => ({ value, label: ({
    ordinary_society: "BC ordinary society", member_funded_society: "BC member-funded society",
    ordinary_private_company: "BC ordinary private company", federal_private_corporation: "Federal CBCA private business corporation",
  } as Record<string, string>)[value] ?? value }))),
  ...[
    { value: "unlimited_liability_company", label: "BC unlimited liability company — review required" },
    { value: "community_contribution_company", label: "BC community contribution company — review required" },
    { value: "benefit_company", label: "BC benefit company — review required" },
    { value: "other", label: "Other / classification needs review" },
  ],
].filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);

export function resolvePathway(entity?: PathwayEntity | null, registry: readonly PathwayDefinition[] = PATHWAY_REGISTRY): { allowed: boolean; message: string; pathway?: PathwayDefinition } {
  if (!entity) return { allowed: false, message: "Choose an entity and jurisdiction before selecting a preparation route." };
  const jurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(entity));
  const entityType = organizationEntityType(entity);
  const candidates = registry.filter((entry) => entry.eligibility.jurisdictions.includes(jurisdiction) && entry.eligibility.entityTypes.includes(entityType));
  if (candidates.length !== 1) return { allowed: false, message: "This entity and jurisdiction have no unambiguous registered preparation route. Arrange entity-specific review." };
  const pathway = candidates[0];
  const act = entity.actFormedUnder?.trim().toLowerCase();
  if (act && !pathway.eligibility.acts.includes(act)) return { allowed: false, message: "The governing Act does not match this entity's registered pathway. Review the organization profile." };
  if (entity.legalSubtype && !pathway.eligibility.subtypes.includes(entity.legalSubtype)) return { allowed: false, message: "This entity subtype needs a reviewed specialist route. Review the classification before preparing documents." };
  if (entityType.includes("society") && ((entity.legalSubtype === "ordinary_society" && entity.isMemberFunded) || (entity.legalSubtype === "member_funded_society" && entity.isMemberFunded === false))) return { allowed: false, message: "Society subtype and member-funded status disagree. Review the classification." };
  if ((entity.isMemberFunded || entity.legalSubtype === "member_funded_society") && (entity.isCharity || entity.charityStatus === "registered")) return { allowed: false, message: "A BC member-funded society cannot be a registered charity. Review the classification." };
  return { allowed: pathway.availability === "preparation", message: pathway.message, pathway };
}

export function pathwayForPacket(entity: PathwayEntity, packet: { key: string; preparationOnly?: boolean; jurisdictions: string[] }, registry: readonly PathwayDefinition[] = PATHWAY_REGISTRY) {
  const result = resolvePathway(entity, registry);
  if (!result.allowed || !result.pathway) throw new Error(result.message);
  const context = result.pathway.packetContexts?.[packet.key];
  const permitted = context && !packet.preparationOnly ? context.jurisdictions : result.pathway.eligibility.jurisdictions;
  if (!packet.jurisdictions.some((code) => permitted.includes(canonicalizeJurisdictionCode(code)))) throw new Error("This document template does not apply to the selected home jurisdiction or registered target context.");
  if (!result.pathway.packetKeys.includes(packet.key)) throw new Error("This document template is not registered for the selected pathway.");
  return result.pathway;
}
