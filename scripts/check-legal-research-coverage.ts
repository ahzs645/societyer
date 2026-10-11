import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { LEGAL_SOURCES } from '../shared/legalSources';
import { PRIVACY_CITATIONS } from '../shared/privacyRuleProfiles';

const coverage = JSON.parse(fs.readFileSync('docs/legal-research/coverage.json', 'utf8'));
const expected = { SOC:16, BCC:17, FED:16, ONT:12, PRV:9, MTG:10, REC:7, OTH:6, TRM:9 };
assert.deepEqual(coverage.counts, expected);
assert.equal(coverage.total, 102);
assert.equal(coverage.questions.length, 102);
const brief = fs.readFileSync(coverage.briefPath, 'utf8');
assert.equal(crypto.createHash('sha256').update(brief).digest('hex'), coverage.briefSha256, 'Rebuild coverage after reviewing a changed brief');
const ids = new Set<string>();
const sourceIds = new Set([...LEGAL_SOURCES.map(source => source.id), ...Object.values(PRIVACY_CITATIONS).map(source => source.id)]);
for (const question of coverage.questions) {
  assert.ok(!ids.has(question.id), `Duplicate ${question.id}`); ids.add(question.id);
  assert.ok(brief.includes(`| ${question.id} |`));
  assert.equal(question.researchStatus, 'answered');
  const report = fs.readFileSync(question.answerPath, 'utf8');
  assert.ok(report.includes(`<a id="${question.anchor}"></a>`));
  const heading = new RegExp(`^#{1,6} ${question.id}\\b[^\\n]*`, 'm').exec(report);
  assert.ok(heading, question.id);
  const after = report.slice(heading.index + heading[0].length);
  const next = /^#{1,6} (SOC|BCC|FED|ONT|PRV|MTG|REC|OTH|TRM)-\d+\b/m.exec(after);
  const section = after.slice(0, next?.index ?? after.length);
  assert.ok(section.trim().length > 180, `${question.id}: substantive answer required`);
  assert.ok(question.sourceUrls.length > 0, `${question.id}: source links required`);
  for (const source of question.sourceUrls) {
    const host = new URL(source).hostname;
    assert.ok(new Set(["pubsaskdev.blob.core.windows.net", "www.saskregistries.ca"]).has(host) || /(^|\.)(bclaws\.gov\.bc\.ca|gov\.bc\.ca|gov\.on\.ca|novascotia\.ca|justice\.gc\.ca|ontario\.ca|legisquebec\.gouv\.qc\.ca|canada\.ca|gc\.ca|priv\.gc\.ca|oipc\.bc\.ca|oipc\.ab\.ca|alberta\.ca|qc\.ca|saskatchewan\.ca|publications\.saskatchewan\.ca|publications\.gov\.sk\.ca|laws\.gnb\.ca|gnb\.ca|gov\.mb\.ca|gov\.ns\.ca|nslegislature\.ca|assnat\.qc\.ca|parl\.ca|ourcommons\.ca|ised-isde\.canada\.ca|publicationsduquebec\.gouv\.qc\.ca|quebec\.ca)$/.test(host), `${question.id}: check primary-source host ${host}`);
  }
  for (const id of question.sourceIds) assert.ok(sourceIds.has(id), `${question.id}: unknown source ${id}`);
  if (question.sourceBindingPath) {
    const bindings = JSON.parse(fs.readFileSync(question.sourceBindingPath, 'utf8'));
    assert.ok(Array.isArray(bindings[question.id]), `${question.id}: missing explicit runtime-source binding`);
    for (const id of bindings[question.id]) assert.ok(question.sourceIds.includes(id), `${question.id}: binding omitted from manifest`);
  }
  assert.ok(question.implementation.limits.length > 30);
  for (const file of question.implementation.modules) assert.ok(fs.existsSync(file), `${question.id}: missing ${file}`);
}
for (const [group, count] of Object.entries(expected)) for (let i = 1; i <= count; i++) assert.ok(ids.has(`${group}-${i}`));
console.log('Legal research coverage passed: all 102 questions answered, linked to primary sources and implementation or explicit extension boundaries.');
