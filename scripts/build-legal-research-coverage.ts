import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LEGAL_SOURCES } from '../shared/legalSources';
import { PRIVACY_CITATIONS } from '../shared/privacyRuleProfiles';

const root = process.cwd();
const reportFor: Record<string, string> = {
  SOC: 'societies.md', BCC: 'corporations.md', FED: 'corporations.md', ONT: 'corporations.md',
  PRV: 'privacy.md', MTG: 'meetings-records.md', REC: 'meetings-records.md',
  OTH: 'other-entities-terminology.md', TRM: 'other-entities-terminology.md',
};
const groupModules: Record<string, string[]> = {
  SOC: ['shared/societyLegalProfile.ts', 'shared/legalGovernanceProfiles.ts', 'shared/dashboardComplianceRules.ts', 'shared/continuityRules.ts'],
  BCC: ['shared/corporateLegalProfiles.ts', 'shared/corporateLegalSources.ts', 'shared/corporationSettings.ts'],
  FED: ['shared/corporateLegalProfiles.ts', 'shared/corporateLegalSources.ts', 'shared/corporationSettings.ts'],
  ONT: ['shared/corporateLegalProfiles.ts', 'shared/corporateLegalSources.ts', 'shared/corporationSettings.ts'],
  PRV: ['shared/privacyRuleProfiles.ts', 'shared/privacyPolicyTemplate.ts', 'src/components/PrivacyScopeAssessment.tsx'],
  MTG: ['shared/meetingNoticeAudience.ts', 'shared/legalMeetingNotice.ts', 'shared/shareholderElectorate.ts', 'shared/functions/elections.ts', 'shared/functions/writtenResolutions.ts'],
  REC: ['shared/legalGovernanceTypes.ts', 'src/components/LegalRecordsRequirements.tsx', 'src/pages/MinuteBook.tsx'],
  OTH: ['shared/organizationDomain.ts', 'shared/legalGovernanceProfiles.ts'],
  TRM: ['src/lib/organizationVocabulary.ts', 'src/lib/entityRecordLabels.ts', 'src/lib/routeIdentity.ts'],
};
// These labels describe the delivered integration, not a claim that every
// legal duty is machine-decidable. The linked answer records remaining facts.
const guidanceOnly = new Set(['SOC-5','SOC-6','SOC-7','SOC-8','SOC-11','BCC-3','BCC-4','BCC-5','BCC-12','BCC-14','BCC-15','BCC-16','FED-3','FED-4','FED-10','FED-12','FED-13','FED-14','FED-15','FED-16','ONT-3','ONT-4','ONT-9','ONT-10','ONT-11','ONT-12','MTG-3','MTG-4','MTG-7','MTG-8','MTG-9','MTG-10','PRV-6','PRV-7','PRV-8','PRV-9']);
const boundaries = new Set(['BCC-17', 'OTH-1','OTH-2','OTH-3','OTH-4','OTH-5','OTH-6']);
const sources = [...LEGAL_SOURCES, ...Object.values(PRIVACY_CITATIONS)].map(source => ({ id: source.id, url: source.url }));
const bindingPaths = ['docs/legal-research/society-privacy-source-bindings.json', 'docs/legal-research/meeting-record-source-bindings.json'];
const bindings = new Map<string, { ids: string[]; path: string }>();
for (const file of bindingPaths) {
  const rows = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Record<string, string[]>;
  for (const [id, ids] of Object.entries(rows)) {
    if (bindings.has(id)) throw new Error(`Duplicate source binding: ${id}`);
    if (!Array.isArray(ids) || ids.some(sourceId => !sources.some(source => source.id === sourceId))) throw new Error(`Unknown runtime source binding for ${id}`);
    bindings.set(id, { ids, path: file });
  }
}
const briefPath = 'docs/legal-research/brief.md';
const brief = fs.readFileSync(path.join(root, briefPath), 'utf8');
const questions = brief.split('\n').filter(line => /^\| (SOC|BCC|FED|ONT|PRV|MTG|REC|OTH|TRM)-\d+ \|/.test(line)).map(line => {
  const cells = line.split('|').slice(1, -1).map(value => value.trim());
  const id = cells[0], group = id.split('-')[0];
  const answerPath = `docs/legal-research/${reportFor[group]}`;
  const report = fs.readFileSync(path.join(root, answerPath), 'utf8');
  const heading = new RegExp(`^#{1,6} ${id}\\b[^\\n]*`, 'm').exec(report);
  if (!heading) throw new Error(`Missing answer: ${id}`);
  const after = report.slice(heading.index + heading[0].length);
  const next = /^#{1,6} (SOC|BCC|FED|ONT|PRV|MTG|REC|OTH|TRM)-\d+\b/m.exec(after);
  const section = heading[0] + after.slice(0, next?.index ?? after.length);
  const sourceIds = [...new Set([...sources.filter(source => section.includes(source.id)).map(source => source.id), ...(bindings.get(id)?.ids ?? [])])];
  const localUrls = [...section.matchAll(/https:\/\/[^\s)>"`]+/g)].map(match => match[0]);
  const firstQuestion = /^#{1,6} (SOC|BCC|FED|ONT|PRV|MTG|REC|OTH|TRM)-\d+\b/m.exec(report);
  const inheritedUrls = [...report.slice(0, firstQuestion?.index ?? 0).matchAll(/https:\/\/[^\s)>"`]+/g)].map(match => match[0]);
  return {
    id, question: group === 'SOC' ? cells[2] : cells[1],
    researchStatus: 'answered', answerPath, anchor: id.toLowerCase(),
    authorityMode: 'Paraphrase; source currency and retrieval limitations in answer and report source register',
    sourceIds: [...new Set(sourceIds)],
    ...(bindings.has(id) ? { sourceBindingPath: bindings.get(id)!.path } : {}),
    sourceUrls: [...new Set([...localUrls, ...sources.filter(source => sourceIds.includes(source.id)).map(source => source.url), ...(localUrls.length || sourceIds.length ? [] : inheritedUrls)])],
    implementation: {
      level: boundaries.has(id) ? 'extension_boundary' : group === 'REC' || guidanceOnly.has(id) ? 'scoped_guidance' : group === 'TRM' ? 'terminology_and_boundary' : 'core_rules_and_workflows',
      modules: groupModules[group],
      limits: boundaries.has(id)
        ? 'Research and explicit review boundary delivered. This entity or subtype does not receive unsupported business-corporation automation.'
        : group === 'TRM' ? 'Core vocabulary is scoped; jurisdiction-specific translation and other terminology boundaries are stated in the answer.'
        : 'General law is implemented or exposed as scoped guidance. Governing documents, status, historical law, class rights and factual evidence remain inputs for review; see the answer for specific limits.',
    },
    ...(id === 'TRM-7' ? { supplementalAnswers: ['docs/legal-research/privacy.md#trm-7'] } : {}),
  };
});
const counts = Object.fromEntries(Object.keys(reportFor).map(group => [group, questions.filter(question => question.id.startsWith(`${group}-`)).length]));
for (const id of bindings.keys()) if (!questions.some(question => question.id === id)) throw new Error(`Source binding has no brief question: ${id}`);
const manifest = { schemaVersion: '1.0.0', reviewedOn: '2026-10-11', briefPath, briefSha256: crypto.createHash('sha256').update(brief).digest('hex'), counts, total: questions.length, questions };
fs.writeFileSync(path.join(root, 'docs/legal-research/coverage.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Research coverage generated: ${questions.length} questions, ${Object.keys(counts).length} groups.`);
