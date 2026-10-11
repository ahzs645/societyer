import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { buildAnnualResolutionContext, type AnnualResolutionInput } from '../shared/annualResolution';
import { buildSocietyRenderContext } from '../shared/societyRenderContext';
import { renderSections } from '../shared/packetRendering';
import { CORPORATION_DOCUMENT_PACKETS } from '../shared/corporationDocumentPackets';
import { corporationPacketDocxBytes } from '../shared/corporationPacketDocx';
import { LEGACY_ANNUAL_PREPARATION_WARNING, preparationDocumentUpdate } from '../shared/preparationDocumentState';
import { pathwayForPacket, resolvePathway, validatePathwayRegistry, PATHWAY_REGISTRY } from '../shared/pathways/registry';
import { staticCreatePacketRunArtifacts } from '../src/lib/staticConvexDocuments';
import { StaticConvexClient } from '../src/lib/staticConvex';

const base = { entityType: 'corporation__business_', jurisdictionCode: 'CA-BC', actFormedUnder: 'business_corporations_act', distributing: false };
const federal = { ...base, jurisdictionCode: 'CA-FED-CBCA', actFormedUnder: 'canada_business_corporations_act' };
const ontario = { ...base, jurisdictionCode: 'CA-ON-OBCA', actFormedUnder: 'business_corporations_act__ontario_' };
const facts: AnnualResolutionInput = {
  fiscalYearEnd: '12-31', financialPeriodEnd: '2025-12-31', annualBusinessYear: 2026,
  annualReferenceDate: '2026-06-25', directors: [{ name: 'Dana Wells' }, { name: 'Sam Okoro' }],
};
const annual = CORPORATION_DOCUMENT_PACKETS.find(p => p.key === 'annual-resolutions')!;
assert.ok(annual.preparationOnly);
assert.equal(annual.signatureRequired, false);
assert.deepEqual(annual.requiredSigners, []);

const bcFinancial = buildAnnualResolutionContext({ ...facts, organization: base, waivePrepFinancials: true });
assert.equal(bcFinancial.waivePrepFinancials, true);
assert.equal(bcFinancial.waiveAuditor, false, 'financial waiver must not silently request an auditor waiver');
assert.ok(bcFinancial.financialClause.includes('s. 200'));
assert.ok(bcFinancial.annualBusinessClause.includes('2026-06-25'));
assert.equal(bcFinancial.directorSlate, 'Dana Wells; Sam Okoro');
for (const organization of [federal, ontario]) {
  const context = buildAnnualResolutionContext({ ...facts, organization, waivePrepFinancials: true, waiveAuditor: true });
  assert.equal(context.waivePrepFinancials, false, 'no BC financial waiver in another Act');
  assert.equal(context.waiveAuditor, true, 'independent private auditor waiver remains available');
  assert.ok(context.auditorClause.includes('every shareholder including non-voting'));
  assert.ok(context.reviewNotes.some(n => n.message.includes('requested financial-statement waiver')));
}
for (const organization of [{ ...federal, distributing: true }, { ...ontario, distributing: undefined }, { ...base, legalSubtype: 'community_contribution_company' }]) {
  const context = buildAnnualResolutionContext({ ...facts, organization, waivePrepFinancials: true, waiveAuditor: true });
  assert.equal(context.waivePrepFinancials, false);
  assert.equal(context.waiveAuditor, false);
}
assert.equal(buildAnnualResolutionContext({ ...facts, waivePrepFinancials: true }).supported, false, 'missing identity never defaults to BC corporate waiver');
assert.equal(buildAnnualResolutionContext({ organization: { entityType: 'society', jurisdictionCode: 'CA-BC' } }).supported, false);
assert.ok(buildAnnualResolutionContext({ ...facts, organization: ontario }).annualBusinessClause.includes('ten-business-day'));
assert.ok(buildAnnualResolutionContext({ ...facts, organization: federal }).annualBusinessClause.includes('CBCA s. 142'));
assert.ok(buildAnnualResolutionContext({ ...facts, organization: base, auditorName: 'Example Audit LLP' }).auditorClause.includes('appoint Example Audit LLP'));

function render(organization: typeof base, extras: Partial<AnnualResolutionInput> = {}) {
  const society = { ...organization, name: 'Acme Inc.', shortName: 'Acme' };
  const renderContext = buildSocietyRenderContext(society, [{ roleType: 'director', fullName: 'Dana Wells' }], '2026-06-25');
  const context = { ...renderContext, annual: buildAnnualResolutionContext({ ...facts, ...extras, organization }), execution: { adoptionClause: 'FALSE_ALL_SHAREHOLDER_CONSENT', lines: ['DEFAULT_DIRECTOR_SIGNATURE'] } };
  return { context, body: renderSections(annual.sections, context as unknown as Record<string, unknown>).flatMap(s => s.body).join('\n') };
}
for (const organization of [base, federal, ontario]) {
  const rendered = render(organization, { waivePrepFinancials: true, waiveAuditor: true });
  assert.ok(!rendered.body.includes('{'), 'all template tokens are bound');
  assert.ok(!rendered.body.includes('deemed to have been held on June 25'), 'generation never asserts a held meeting');
  assert.ok(!rendered.body.includes('All lawful contracts'), 'no blanket ratification of unknown acts');
  assert.ok(!rendered.body.includes('directors are authorized to appoint an auditor'), 'annual auditor appointment belongs to shareholders');
  const docx = Buffer.from(corporationPacketDocxBytes(annual, rendered.context as unknown as Record<string, unknown>)).toString('utf8');
  assert.ok(!docx.includes('FALSE_ALL_SHAREHOLDER_CONSENT'));
  assert.ok(!docx.includes('DEFAULT_DIRECTOR_SIGNATURE'));
}

// The offline artifact path cannot stage a director roster as annual shareholder signatures.
const rows = new Map<string, Map<string, any>>();
const table = (name: string) => { if (!rows.has(name)) rows.set(name, new Map()); return rows.get(name)!; };
const store = {
  transaction: (fn: () => void) => fn(),
  listRows: (name: string, query?: { societyId?: string }) => [...table(name).values()].filter(r => !query?.societyId || r.societyId === query.societyId),
  getRow: (name: string, id?: string) => table(name).get(id ?? ''),
  upsertRow: (name: string, row: any) => { table(name).set(row._id, row); },
};
store.upsertRow('societies', { _id: 'corporation', ...base, name: 'Acme Inc.', fiscalYearEnd: '12-31', waivePrepFinancials: true });
store.upsertRow('roleHolders', { _id: 'director', societyId: 'corporation', roleType: 'director', status: 'current', fullName: 'Director Only' });
store.upsertRow('legalPrecedentRuns', { _id: 'run', societyId: 'corporation' });
let seq = 0;
staticCreatePacketRunArtifacts(store, { societyId: 'corporation', packet: annual, runId: 'run', effectiveDate: '2026-06-25', signerRoleHolderIds: ['director'], dataJson: JSON.stringify({ financialPeriodEnd: '2025-12-31', annualBusinessYear: 2026, annualReferenceDate: '2026-06-25', waiveAuditor: true }) }, name => `${name}_${++seq}`, values => [...new Set(values.filter(Boolean))] as string[]);
const document = store.listRows('documents')[0], generated = store.listRows('generatedLegalDocuments')[0];
assert.equal(document.reviewStatus, 'needs_review');
assert.equal(document.retentionYears, undefined, 'corporate minute-book documents have no invented seven-year purge');
assert.equal(generated.status, 'needs_review');
assert.deepEqual(generated.signersRequiredRoleHolderIds, []);
assert.deepEqual(generated.signerTagsRequired, []);
assert.equal(store.listRows('legalSigners').length, 0);
const xml = Buffer.from(document.url.split(',')[1], 'base64').toString('utf8');
assert.ok(xml.includes('BC BCA s. 200'), 'static path binds Act-specific annual context');
assert.ok(!xml.includes('{annual.'));
assert.equal(JSON.parse(generated.dataJson).templateProvenance.templateSnapshot.preparationOnly, true);
const staticAuthority = JSON.parse(generated.dataJson).templateProvenance.legalAuthority;
assert.equal(staticAuthority.profileId, 'bc_company');
assert.equal(staticAuthority.profileReviewedOn, '2026-10-11');
assert.ok(staticAuthority.sourceSnapshots.some((s: any) => s.id === 'BC-BCA-ANNUAL-FINANCIALS' && s.consolidatedThrough === '2026-10-06'));
assert.equal(staticAuthority.resolvedAnnualContext.waivePrepFinancials, true);

// Draft metadata edits cannot erase preparation provenance then claim completion.
for (const status of ['out_for_signing', 'signed', 'final']) assert.throws(() => preparationDocumentUpdate(generated.dataJson, '{}', status), /preparation draft/);
const edited = preparationDocumentUpdate(generated.dataJson, JSON.stringify({ annualBusinessYear: 2027 }), 'needs_review');
assert.equal(JSON.parse(edited.dataJson!).annualBusinessYear, 2027);
assert.equal(JSON.parse(edited.dataJson!).templateProvenance.templateSnapshot.preparationOnly, true);
assert.throws(() => preparationDocumentUpdate(edited.dataJson, undefined, 'signed'), /separate execution/);
assert.equal(preparationDocumentUpdate(undefined, '{}', 'signed').preparationOnly, false, 'separate reviewed execution records remain possible');

// The shared portable mutation uses the same draft-only semantics in the live
// local client, and preserves source editions even after editable data changes.
const client = new StaticConvexClient({ databaseName: `annual-preparation-${Date.now()}`, seed: { societies: [] } });
const workspace = await client.mutation('society:createWorkspace', {
  name: 'Federal Annual Preparation Inc.', ...federal, fiscalYearEnd: '12-31',
});
const directorId = await client.mutation('legalOperations:upsertRoleHolder', {
  societyId: workspace.societyId, roleType: 'director', status: 'current', fullName: 'Director Is Not A Shareholder',
});
const result = await client.mutation('legalOperations:generateDocumentFromCatalog', {
  societyId: workspace.societyId, packetKey: 'annual-resolutions', effectiveDate: '2026-06-25',
});
const engine = await client.query('legalOperations:templateEngine', { societyId: workspace.societyId });
const portableGenerated = engine.generatedDocuments.find((d: any) => d._id === result.generatedDocumentId)!;
const portableDoc = (await client.query('documents:list', { societyId: workspace.societyId })).find((d: any) => d._id === result.draftDocumentId)!;
assert.equal(portableGenerated.status, 'needs_review');
assert.equal(portableDoc.reviewStatus, 'needs_review');
assert.equal(portableDoc.retentionYears, undefined);
assert.deepEqual(portableGenerated.signersRequiredRoleHolderIds, []);
assert.deepEqual(result.signerIds, []);
const portableAuthority = JSON.parse(portableGenerated.dataJson).templateProvenance.legalAuthority;
assert.equal(portableAuthority.profileId, 'federal_cbca');
assert.ok(portableAuthority.sourceSnapshots.some((s: any) => s.id === 'CBCA-ANNUAL-FINANCIALS' && s.consolidatedThrough === '2026-09-21'));
const portableXml = Buffer.from(portableDoc.url.split(',')[1], 'base64').toString('utf8');
assert.ok(portableXml.includes('CBCA s. 142'));
assert.ok(!portableXml.includes('BC BCA'));
const editArgs = { id: portableGenerated._id, societyId: workspace.societyId, title: portableGenerated.title, dataJson: '{}' };
for (const status of ['out_for_signing', 'signed', 'final']) {
  await assert.rejects(client.mutation('legalOperations:upsertGeneratedLegalDocument', { ...editArgs, status }), /preparation draft/);
}
await client.mutation('legalOperations:upsertGeneratedLegalDocument', { ...editArgs, status: 'needs_review', signersRequiredRoleHolderIds: [directorId] });
const after = (await client.query('legalOperations:templateEngine', { societyId: workspace.societyId })).generatedDocuments.find((d: any) => d._id === portableGenerated._id)!;
assert.deepEqual(after.signersRequiredRoleHolderIds, []);
assert.deepEqual(JSON.parse(after.dataJson).templateProvenance.legalAuthority, portableAuthority, 'editable inputs cannot replace source provenance');
await assert.rejects(client.mutation('legalOperations:upsertGeneratedLegalDocument', { ...editArgs, status: 'needs_review', signedDocumentId: portableDoc._id }), /separately reviewed execution/);

// Ontario has one reviewed annual preparation exception. It does not enable
// incorporation, an executable annual template, another Act or a subtype.
assert.equal(resolvePathway(ontario).allowed, false);
assert.equal(pathwayForPacket(ontario, annual).key, 'ontario_obca');
assert.throws(() => pathwayForPacket(ontario, { ...annual, preparationOnly: false }), /under review/);
assert.throws(() => pathwayForPacket({ ...ontario, actFormedUnder: 'bespoke_act' }, annual), /governing Act/);
assert.throws(() => pathwayForPacket({ ...ontario, legalSubtype: 'other' }, annual), /subtype/);
assert.throws(() => validatePathwayRegistry(PATHWAY_REGISTRY.map(p => p.key === 'ontario_obca' ? { ...p, reviewedPreparationPacketKeys: ['organize-corporation'] } : p)), /preparation-only/);
const onWorkspace = await client.mutation('society:createWorkspace', { name: 'Ontario Annual Preparation Inc.', ...ontario });
const onResult = await client.mutation('legalOperations:generateDocumentFromCatalog', { societyId: onWorkspace.societyId, packetKey: 'annual-resolutions', effectiveDate: '2026-06-25' });
const onDoc = await client.query('documents:get', { id: onResult.draftDocumentId });
assert.equal(onDoc.reviewStatus, 'needs_review');
for (const reviewStatus of ['needs_signature', 'approved']) {
  await client.mutation('documents:updateReviewStatus', { id: onResult.draftDocumentId, reviewStatus });
  assert.equal((await client.query('documents:get', { id: onResult.draftDocumentId })).reviewStatus, 'needs_review', 'Modern local annual preparation cannot become signing-ready through document review');
}
assert.equal(JSON.parse(onDoc.sourcePayloadJson).templateProvenance.legalAuthority.profileId, 'ontario_obca');
assert.ok(Buffer.from(onDoc.url.split(',')[1], 'base64').toString('utf8').includes('OBCA s. 104'));
await assert.rejects(client.mutation('legalOperations:generateDocumentFromCatalog', { societyId: onWorkspace.societyId, packetKey: 'organize-corporation' }), /under review/);

// Hosted handlers enforce the same pathway and retain exact historical
// instruments. Reading a legacy draft changes its presentation, not the file,
// source snapshot, retention setting or already executed originals.
const native = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './legalOperations.js': () => import('../convex/legalOperations'),
  './documents.js': () => import('../convex/documents'),
});
const issuer = betterAuthIssuer();
const oldTemplate = { key: 'annual-resolutions', signatureRequired: true, requiredSigners: ['director'], sections: [{ title: 'Historical annual clauses', body: ['Old financial and auditor language'] }] };
const oldData = JSON.stringify({ annualBusinessYear: 2025, templateProvenance: {
  templateId: 'annual-resolutions', templateVersion: 'societyer-catalog-2026-10-03', templateSnapshot: oldTemplate,
  signatureEvidence: null, adoptionEvidence: null,
} });
const marker = 'societyer:corporation-packet-run:annual-resolutions';
const fixture = await native.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Native Ontario Annual Inc.', ...ontario, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert('users', { societyId, displayName: 'Annual owner', email: 'owner@annual.example', role: 'Owner', status: 'Active', authIssuer: issuer, authSubject: 'annual-native-owner', authProvider: 'better-auth', createdAtISO: '2026-10-11' });
  const documentBase = { societyId, category: 'governance', createdAtISO: '2025-06-01', flaggedForDeletion: false, tags: [], retentionYears: 7, sourcePayloadJson: oldData, sourceExternalIds: [marker] };
  const draftId = await ctx.db.insert('documents', { ...documentBase, title: 'Legacy annual draft', reviewStatus: 'needs_signature', url: 'https://example.invalid/legacy-draft.docx' });
  const signedId = await ctx.db.insert('documents', { ...documentBase, title: 'Historical executed annual instrument', reviewStatus: 'approved', sourceVersionStatus: 'signed', url: 'https://example.invalid/executed-original.pdf' });
  const generatedBase = { societyId, dataJson: oldData, subloopJsonList: [], signersRequiredRoleHolderIds: [], signersWhoSignedIds: [], signerTagsRequired: ['old-director-default'], signerTagsSigned: [], sourceDocumentIds: [], sourceExternalIds: [marker], createdAtISO: '2025-06-01', updatedAtISO: '2025-06-01' };
  const draftGeneratedId = await ctx.db.insert('generatedLegalDocuments', { ...generatedBase, title: 'Legacy annual draft', status: 'out_for_signing', draftDocumentId: draftId });
  const signedGeneratedId = await ctx.db.insert('generatedLegalDocuments', { ...generatedBase, title: 'Historical executed annual instrument', status: 'signed', draftDocumentId: signedId, signedDocumentId: signedId, signerTagsSigned: ['actual-signature'], effectiveDate: '2025-06-01', draftFileUrl: 'https://example.invalid/executed-original.pdf' });
  return { societyId, draftId, signedId, draftGeneratedId, signedGeneratedId };
});
const actor = native.withIdentity({ issuer, subject: 'annual-native-owner' });
const nativeAnnual = await actor.mutation(api.legalOperations.generateDocumentFromCatalog, { societyId: fixture.societyId, packetKey: 'annual-resolutions', effectiveDate: '2026-06-25' });
const nativeAnnualDoc = await actor.query(api.documents.get, { id: nativeAnnual.draftDocumentId });
assert.equal(nativeAnnualDoc.reviewStatus, 'needs_review');
for (const reviewStatus of ['needs_signature', 'approved']) {
  await actor.mutation(api.documents.updateReviewStatus, { id: nativeAnnual.draftDocumentId, reviewStatus });
  assert.equal((await native.run(ctx => ctx.db.get(nativeAnnual.draftDocumentId)))!.reviewStatus, 'needs_review', 'Modern native annual preparation cannot become signing-ready through document review');
}
assert.equal(nativeAnnualDoc.retentionYears, undefined);
assert.equal(JSON.parse(nativeAnnualDoc.sourcePayloadJson).templateProvenance.legalAuthority.profileId, 'ontario_obca');
assert.ok(Buffer.from(nativeAnnualDoc.url.split(',')[1], 'base64').toString('utf8').includes('OBCA s. 104'));
await assert.rejects(() => actor.mutation(api.legalOperations.generateDocumentFromCatalog, { societyId: fixture.societyId, packetKey: 'organize-corporation' }), /under review/);

const historicalEngine = await actor.query(api.legalOperations.templateEngine, { societyId: fixture.societyId });
const legacyView = historicalEngine.generatedDocuments.find((d: any) => d._id === fixture.draftGeneratedId);
assert.equal(legacyView.status, 'needs_review');
assert.deepEqual(legacyView.signerTagsRequired, []);
assert.equal(legacyView.preparationReviewWarning, LEGACY_ANNUAL_PREPARATION_WARNING);
assert.equal(legacyView.dataJson, oldData);
assert.equal(historicalEngine.generatedDocuments.find((d: any) => d._id === fixture.signedGeneratedId).status, 'signed');
const originalBefore = await native.run(async ctx => ({ draft: await ctx.db.get(fixture.draftId), generated: await ctx.db.get(fixture.draftGeneratedId), signed: await ctx.db.get(fixture.signedId), signedGenerated: await ctx.db.get(fixture.signedGeneratedId) }));
assert.equal(originalBefore.generated!.status, 'out_for_signing', 'read projection must not write historical records');
assert.equal(originalBefore.draft!.reviewStatus, 'needs_signature');
const legacyDoc = await actor.query(api.documents.get, { id: fixture.draftId });
assert.equal(legacyDoc.reviewStatus, 'needs_review');
assert.equal(legacyDoc.preparationReviewWarning, LEGACY_ANNUAL_PREPARATION_WARNING);
assert.equal(legacyDoc.retentionYears, 7);
assert.equal(legacyDoc.sourcePayloadJson, oldData);
assert.equal(legacyDoc.url, originalBefore.draft!.url);
const documentList = await actor.query(api.documents.list, { societyId: fixture.societyId });
assert.equal(documentList.find((d: any) => d._id === fixture.draftId).reviewStatus, 'needs_review');
assert.equal(documentList.find((d: any) => d._id === fixture.signedId).reviewStatus, 'approved');
await assert.rejects(() => actor.mutation(api.legalOperations.upsertGeneratedLegalDocument, { id: fixture.draftGeneratedId, societyId: fixture.societyId, title: 'Legacy annual draft', dataJson: '{}', status: 'signed' }), /preparation draft/);
await actor.mutation(api.documents.updateReviewStatus, { id: fixture.draftId, reviewStatus: 'needs_signature' });
assert.equal((await native.run(ctx => ctx.db.get(fixture.draftId)))!.reviewStatus, 'needs_review');
await actor.mutation(api.legalOperations.upsertGeneratedLegalDocument, { id: fixture.draftGeneratedId, societyId: fixture.societyId, title: 'Legacy annual draft reviewed', dataJson: JSON.stringify({ annualBusinessYear: 2025 }), status: 'needs_review' });
const legacyAfter = await native.run(async ctx => ({ draft: await ctx.db.get(fixture.draftId), generated: await ctx.db.get(fixture.draftGeneratedId) }));
assert.equal(legacyAfter.generated!.status, 'needs_review');
const legacyProvenance = JSON.parse(legacyAfter.generated!.dataJson!).templateProvenance;
assert.deepEqual(legacyProvenance.templateSnapshot, oldTemplate, 'review annotation does not rewrite the historical instrument');
assert.equal(legacyProvenance.templateVersion, 'societyer-catalog-2026-10-03');
assert.equal(legacyProvenance.legacyPreparationReview.required, true);
assert.equal(legacyAfter.draft!.retentionYears, 7);
assert.equal(legacyAfter.draft!.sourcePayloadJson, oldData);
assert.equal(legacyAfter.draft!.url, originalBefore.draft!.url);

await actor.mutation(api.legalOperations.upsertGeneratedLegalDocument, { id: fixture.signedGeneratedId, societyId: fixture.societyId, title: 'Historical executed annual instrument — indexed', dataJson: '{}', status: 'draft' });
const executedAfter = await native.run(async ctx => ({ document: await ctx.db.get(fixture.signedId), generated: await ctx.db.get(fixture.signedGeneratedId) }));
assert.deepEqual(executedAfter.document, originalBefore.signed, 'executed document file, status, source and retention stay byte-for-byte unchanged');
assert.deepEqual({ ...executedAfter.generated, title: originalBefore.signedGenerated!.title, updatedAtISO: originalBefore.signedGenerated!.updatedAtISO }, originalBefore.signedGenerated, 'metadata edit preserves all historical execution and source evidence');
const executedView = await actor.query(api.documents.get, { id: fixture.signedId });
assert.equal(executedView.preparationReviewWarning, undefined);
assert.equal(executedView.reviewStatus, 'approved');
console.log('Annual resolution Act scope, Ontario draft exception, legacy review preservation and native/local artifact checks passed');
