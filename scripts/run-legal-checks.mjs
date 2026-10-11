import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// Keep this list explicit: a new legal profile must pass the same evidence,
// authority, source and integration gates as the existing profiles.
const scripts = [
  'check-legal-research-coverage.ts', 'check-legal-profile-registry.ts',
  'check-privacy-profiles.ts', 'check-legal-guidance.ts',
  'check-corporate-legal-deadlines.ts', 'check-annual-governance-evidence.ts',
  'check-legal-deadline-calendars.ts', 'check-filing-period-evidence.ts',
  'check-notice-calendar-review.ts', 'check-bylaw-jurisdiction-baselines.ts',
  'check-written-resolution-evidence.ts', 'check-shareholder-election-notices.ts',
  'check-written-resolution-routes.ts', 'check-meeting-notice-authority.ts',
  'check-annual-resolution.ts', 'check-corporation-document-packets.ts',
  'check-corporation-settings.ts', 'check-annual-filings.ts',
  'check-entity-rule-scope.ts', 'check-organization-domain.ts',
  'check-organization-vocabulary.ts', 'check-dashboard-compliance-rules.ts',
  'check-jurisdiction-guide-tracks.ts', 'validate-jurisdiction-guide-packs.ts',
  'check-research-legal-boundaries.ts', 'check-compliance-agm-evidence.ts',
  'check-continuity.ts', 'check-meeting-governance.ts',
  'check-governance-quorum.ts', 'check-governance-timezone.ts',
  'check-election-lifecycle.ts', 'check-election-participant-authority.ts',
  'check-register-history.ts', 'check-register-projection-authority.ts',
  'check-dashboard-resource-authority.ts', 'check-meeting-package-projection.ts',
  'check-authorization-policy.ts', 'check-generated-document-access.ts',
  'check-filing-preparation-integration.ts', 'check-filing-ledger-handoffs.ts',
  'check-guide-rule-continuity.ts',
  'check-annual-deadline-review-fixes.ts',
  'check-deadline-source-key.ts', 'check-clone-society.ts',
];
const results = [];
for (const script of scripts) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--import', 'tsx', `scripts/${script}`], { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  results.push({ script, passed: result.status === 0, durationMs: Date.now() - started });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${script} (${Date.now() - started} ms)`);
  if (result.status !== 0) console.error(output || result.error || `Exited ${result.status}`);
}
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0 && process.argv[reportIndex + 1]) fs.writeFileSync(process.argv[reportIndex + 1], JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, results }, null, 2) + '\n');
const failed = results.filter(result => !result.passed);
console.log(`Legal checks: ${results.length - failed.length}/${results.length} passed.`);
if (failed.length) process.exitCode = 1;
