import assert from "node:assert/strict";
import { PATHWAY_REGISTRY, createPathwayRegistry, getPathway, pathwayForPacket, resolvePathway, validatePathwayRegistry, type PathwayDefinition, type PathwayEntity } from "../shared/pathways/registry";
import { evaluatePipeline, validatePipelineGraph, validatePipelineInputs, type PipelineGraph } from "../shared/pathways/pipeline";
import { INCORPORATION_PREPARATION_GUIDES, incorporationPreparationForOrganization } from "../shared/incorporationPreparation";
import { POST_INCORPORATION_FLOWS, postIncorporationStepsForOrganization } from "../shared/postIncorporationSteps";
import { WORKSPACE_SETUP_TRACKS } from "../shared/jurisdictionWorkspace";
import { entityPreparationDecision, LEGAL_SUBTYPE_OPTIONS } from "../shared/entitySetup";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../shared/societyDocumentPackets";
import { assertPacketCompatible } from "../shared/templateProvenance";

const bc: PathwayEntity = { jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", legalSubtype: "ordinary_private_company" };
const federal: PathwayEntity = { jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation" };
const society: PathwayEntity = { jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", isMemberFunded: false };
const reject = (entity: PathwayEntity | null | undefined, pattern?: RegExp) => {
  const result = resolvePathway(entity);
  assert.equal(result.allowed, false, `Unexpected route: ${JSON.stringify(entity)}`);
  if (pattern) assert.match(result.message, pattern);
  assert.equal(entityPreparationDecision(entity).allowed, false);
  assert.equal(incorporationPreparationForOrganization(entity), undefined);
  assert.deepEqual(postIncorporationStepsForOrganization(entity), []);
};

validatePathwayRegistry(PATHWAY_REGISTRY);
assert.equal(getPathway("missing"), undefined);
for (const [entity, key] of [[bc, "bc_company"], [federal, "federal_cbca"], [society, "bc_society"]] as const) {
  const resolved = resolvePathway(entity);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.pathway?.key, key);
  assert.equal(incorporationPreparationForOrganization(entity), resolved.pathway?.preparation);
  assert.deepEqual(postIncorporationStepsForOrganization(entity).map(step => step.key), resolved.pathway?.flow?.steps.slice().sort((a, b) => a.order - b.order).map(step => step.key));
}
assert.deepEqual(INCORPORATION_PREPARATION_GUIDES.map(guide => guide.id), PATHWAY_REGISTRY.flatMap(entry => entry.preparation ? [entry.preparation.id] : []), "Preparation selector must derive from the registry");
assert.deepEqual(POST_INCORPORATION_FLOWS, PATHWAY_REGISTRY.flatMap(entry => entry.flow ? [entry.flow] : []), "Post-incorporation selector must derive from the registry");
assert.deepEqual(WORKSPACE_SETUP_TRACKS.map(track => track.id), PATHWAY_REGISTRY.map(entry => entry.key), "Workspace setup selector must derive from the registry");
for (const entry of PATHWAY_REGISTRY) for (const subtype of entry.eligibility.subtypes) assert.ok(LEGAL_SUBTYPE_OPTIONS.some(option => option.value === subtype), `Registered subtype ${subtype} is missing from classification options`);
assert.equal(resolvePathway({ ...society, jurisdictionCode: "british_columbia", entityType: "society__bc_" }).pathway?.key, "bc_society");
assert.equal(resolvePathway({ ...federal, jurisdictionCode: "federal__canada_" }).pathway?.key, "federal_cbca");
assert.equal(resolvePathway({ jurisdictionCode: "CA-BC", entityType: "society" }).allowed, true, "Explicit unique legacy classification may omit Act/subtype; this does not establish legal adoption");
for (const entity of [null, undefined, {}, { entityType: "society" }, { jurisdictionCode: "CA-BC" }, { entityType: "society", jurisdictionCode: "unknown" }, { entityType: "society", jurisdictionCode: "CA-ZZ" }]) reject(entity);
reject({ ...bc, actFormedUnder: "societies_act" }, /Act/i);
reject({ ...society, actFormedUnder: "canada_business_corporations_act" }, /Act/i);
for (const legalSubtype of ["benefit_company", "unlimited_liability_company", "community_contribution_company", "other"]) reject({ ...bc, legalSubtype }, /subtype/i);
reject({ ...federal, entityType: "corporation__non_profit_" });
reject({ jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_" }, /review/i);
reject({ ...society, isMemberFunded: true }, /disagree/i);
reject({ ...society, legalSubtype: "member_funded_society", isMemberFunded: false }, /disagree/i);
reject({ ...society, legalSubtype: "member_funded_society", isMemberFunded: true, charityStatus: "registered" }, /charity/i);
assert.equal(resolvePathway({ ...society, legalSubtype: "member_funded_society", isMemberFunded: true }).allowed, true);

const packets = [...CORPORATION_DOCUMENT_PACKETS, ...SOCIETY_DOCUMENT_PACKETS];
for (const entity of [bc, federal, society]) {
  const pathway = resolvePathway(entity).pathway!;
  for (const packetKey of pathway.packetKeys) {
    const packet = packets.find(candidate => candidate.key === packetKey);
    assert.ok(packet, `${pathway.key} owns unknown catalog packet ${packetKey}`);
    assert.equal(pathwayForPacket(entity, packet).key, pathway.key);
    assert.doesNotThrow(() => assertPacketCompatible(entity, packet));
  }
  for (const step of pathway.flow?.steps ?? []) if (step.packetKey) assert.ok(pathway.packetKeys.includes(step.packetKey), `${pathway.key} flow references an unowned packet`);
}
const societyPacket = SOCIETY_DOCUMENT_PACKETS.find(packet => packet.preparationOnly)!;
const companyPacket = CORPORATION_DOCUMENT_PACKETS.find(packet => packet.key === "bc-incorporation-agreement")!;
assert.throws(() => pathwayForPacket(bc, societyPacket), /registered|apply/i);
assert.throws(() => assertPacketCompatible(society, companyPacket), /entity/i);
assert.throws(() => pathwayForPacket(federal, companyPacket), /jurisdiction/i);
assert.throws(() => pathwayForPacket(bc, { key: "forged-unregistered-packet", jurisdictions: ["CA-BC"] }), /registered/i, "Non-preparation keys cannot bypass route ownership");
assert.throws(() => pathwayForPacket(bc, { key: companyPacket.key, jurisdictions: ["CA-FED-CBCA"] }), /jurisdiction/i, "A known packet key cannot conceal contradictory jurisdiction metadata");
const provincialPacket = CORPORATION_DOCUMENT_PACKETS.find(packet => packet.key === "extra-provincial-registration-evidence")!;
assert.equal(pathwayForPacket(federal, provincialPacket).key, "federal_cbca", "A registered extra-provincial target context is distinct from home incorporation");
assert.throws(() => pathwayForPacket(federal, { ...provincialPacket, jurisdictions: ["CA-ZZ-TEST"] }), /jurisdiction|context/i);
assert.throws(() => pathwayForPacket(federal, { ...provincialPacket, preparationOnly: true }), /jurisdiction|context/i, "An extra-provincial context cannot relax an initial incorporation template's home scope");

const syntheticGraph: PipelineGraph = { version: 1, inputFields: [{ key: "licensed", label: "Licence recorded", type: "boolean", required: true }], nodes: [
  { key: "collect", title: "Confirm test information", kind: "manual", dependsOn: [] },
  { key: "licensed-record", title: "Retain test licence", kind: "document", dependsOn: ["collect"], packetKey: "synthetic-certificate", requiresEvidence: true, condition: { field: "licensed", operator: "equals", value: true } },
  { key: "review", title: "Independent test review", kind: "approval", dependsOn: ["licensed-record"], approval: { permission: "documents:write", distinctInitiator: true } },
  { key: "submit", title: "Manual test handoff", kind: "submission", dependsOn: ["review"], submission: { adapterId: "official-portal", officialUrl: "https://example.invalid/test-only" } },
] };
const synthetic: PathwayDefinition = {
  key: "synthetic_extension", version: "test-only.1", title: "Synthetic extension; no legal route asserted", availability: "preparation",
  eligibility: { jurisdictions: ["CA-ZZ-TEST"], entityTypes: ["synthetic_entity"], acts: ["synthetic_test_act"], subtypes: ["synthetic_subtype"] },
  setup: { label: "Synthetic test", jurisdictionCode: "CA-ZZ-TEST", entityType: "synthetic_entity", actFormedUnder: "synthetic_test_act", hint: "No production jurisdiction" },
  message: "Synthetic fixture only", packetKeys: ["synthetic-certificate"], pipeline: syntheticGraph,
};
const extended = createPathwayRegistry([...PATHWAY_REGISTRY, synthetic]);
const editable = structuredClone(synthetic);
const frozen = createPathwayRegistry([editable]);
editable.version = "test-only.2";
editable.pipeline!.nodes[0].title = "Changed after registration";
assert.equal(frozen[0].version, "test-only.1", "Registration must snapshot caller-owned data");
assert.equal(frozen[0].pipeline!.nodes[0].title, "Confirm test information");
assert.equal(Object.isFrozen(frozen[0].pipeline!.nodes), true);
assert.throws(() => { frozen[0].packetKeys.push("injected-packet"); }, /extensible|read.only|frozen|assign/i);
const syntheticEntity: PathwayEntity = { jurisdictionCode: "CA-ZZ-TEST", entityType: "synthetic_entity", actFormedUnder: "synthetic_test_act", legalSubtype: "synthetic_subtype" };
assert.equal(resolvePathway(syntheticEntity).allowed, false, "Synthetic extension must not leak into production registry");
assert.equal(resolvePathway(syntheticEntity, extended).pathway?.key, synthetic.key, "An unknown canonical code and new entity resolve through registry data without selector branches");
assert.equal(pathwayForPacket(syntheticEntity, { key: "synthetic-certificate", jurisdictions: ["CA-ZZ-TEST"] }, extended).key, synthetic.key);
const state = evaluatePipeline(syntheticGraph, { licensed: false }, [{ nodeKey: "collect", state: "completed" }]);
assert.equal(state.find(node => node.key === "licensed-record")?.state, "skipped");
assert.equal(state.find(node => node.key === "review")?.state, "ready", "A data-defined conditional branch unlocks its dependent review");
assert.equal(state.find(node => node.key === "submit")?.state, "blocked", "A skipped optional branch does not skip independent approval");
assert.throws(() => validatePipelineInputs(syntheticGraph, { licensed: "false" }, true), /boolean/i);
assert.throws(() => validatePipelineInputs(syntheticGraph, { forgedAuthority: true }, true), /Unknown/i);
assert.throws(() => validatePipelineInputs(syntheticGraph, {}, true), /required/i);

assert.throws(() => validatePathwayRegistry([...PATHWAY_REGISTRY, { ...synthetic, key: "bc_company" }]), /unique|duplicate/i);
assert.throws(() => validatePathwayRegistry([...PATHWAY_REGISTRY, { ...synthetic, key: "ambiguous", eligibility: { ...PATHWAY_REGISTRY[0].eligibility }, setup: { ...PATHWAY_REGISTRY[0].setup } }]), /ambiguous|overlap/i);
assert.throws(() => createPathwayRegistry([{ ...synthetic, eligibility: { ...synthetic.eligibility, jurisdictions: ["unknown"] }, setup: { ...synthetic.setup, jurisdictionCode: "unknown" } }]), /explicit|Invalid/i, "Missing jurisdiction must never acquire a registry fallback");
assert.throws(() => createPathwayRegistry([{ ...synthetic, eligibility: { ...synthetic.eligibility, entityTypes: ["organization"] }, setup: { ...synthetic.setup, entityType: "organization" } }]), /explicit|Invalid/i, "Missing entity must never acquire a registry fallback");
assert.throws(() => createPathwayRegistry([{ ...synthetic, eligibility: { ...synthetic.eligibility, jurisdictions: ["british_columbia"] }, setup: { ...synthetic.setup, jurisdictionCode: "british_columbia" } }]), /canonical/i);
assert.throws(() => createPathwayRegistry([{ ...synthetic, eligibility: { ...synthetic.eligibility, acts: ["synthetic_test_act", "synthetic_test_act"] } }]), /duplicate/i);
assert.throws(() => createPathwayRegistry([{ ...synthetic, packetContexts: { "unowned-packet": { kind: "extra_provincial", jurisdictions: ["CA-ON-OBCA"] } } }]), /context|registered/i);
assert.throws(() => validatePathwayRegistry([{ ...synthetic, pipeline: { ...syntheticGraph, nodes: [...syntheticGraph.nodes, { key: "bad", title: "Unknown dependency", kind: "manual", dependsOn: ["missing"] }] } }]), /Unknown.*dependency/i);
assert.throws(() => validatePipelineGraph({ version: 1, nodes: [{ key: "one", title: "One", kind: "manual", dependsOn: ["two"] }, { key: "two", title: "Two", kind: "manual", dependsOn: ["one"] }] }), /cycle/i);
assert.throws(() => validatePipelineGraph({ version: 1, nodes: [{ key: "submit", title: "Approval bypass", kind: "submission", dependsOn: [], submission: { adapterId: "official-portal" } }] }), /approval/i);
assert.throws(() => validatePipelineGraph({ version: 1, nodes: [{ key: "step", title: "One", kind: "manual", dependsOn: [] }, { key: "step", title: "Duplicate", kind: "manual", dependsOn: [] }] }), /unique/i);
assert.throws(() => validatePipelineGraph({ version: 1, nodes: [{ key: "step", title: "Undeclared condition", kind: "manual", dependsOn: [], condition: { field: "forgedAuthority", operator: "equals", value: true } }] }), /declared/i);
assert.throws(() => validatePathwayRegistry([{ ...synthetic, pipeline: { ...syntheticGraph, nodes: syntheticGraph.nodes.map(node => node.key === "licensed-record" ? { ...node, packetKey: "unowned-packet" } : node) } }]), /packet/i);
console.log("Pathway registry checks passed: shared selector drift, explicit classification, route/packet ownership, synthetic extension, graph dependencies and approval boundaries.");
