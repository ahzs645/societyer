/** Real Intl plus an old Vancouver tzdata simulation must produce identical source clocks. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if (!process.env.PROCUREMENT_CLOCK_CHILD) {
  for (const mode of ['current', 'old']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      env: {...process.env, PROCUREMENT_CLOCK_CHILD: mode}, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${mode}: ${result.stderr || result.stdout}`);
  }
  console.log('Procurement source clocks agree with current and legacy runtime timezone data.');
} else {
  if (process.env.PROCUREMENT_CLOCK_CHILD === 'old') {
    const Original = Intl.DateTimeFormat;
    // Los Angeles retains the pre-2026 Vancouver seasonal rules. Install before
    // importing the real shared module, including its cached formatter.
    Intl.DateTimeFormat = function (locales: any, options: any) {
      return new Original(locales, {...options, ...(options?.timeZone === 'America/Vancouver' ? {timeZone: 'America/Los_Angeles'} : {})});
    } as any;
  }
  const {parseSourceDate, zoneToday} = await import('../src/features/procurementReview/lib/notice');
  const {nextAnalyticsDay} = await import('../shared/procurementAnalyticsArtifacts');
  for (const [instant, date, time] of [
    ['2026-03-08T09:59:00Z', '2026-03-08', '01:59'],
    ['2026-03-08T10:00:00Z', '2026-03-08', '03:00'],
    ['2026-11-01T09:30:00Z', '2026-11-01', '02:30'],
    ['2026-11-10T06:59:00Z', '2026-11-09', '23:59'],
    ['2026-11-10T07:00:00Z', '2026-11-10', '00:00'],
    ['2025-11-02T08:30:00Z', '2025-11-02', '01:30'],
    ['2025-11-02T09:30:00Z', '2025-11-02', '01:30'],
  ]) {
    assert.deepEqual(parseSourceDate(instant), {date, time});
    assert.equal(zoneToday(Date.parse(instant)), date);
  }
  assert.equal(nextAnalyticsDay(Date.parse('2026-11-10T07:00:00Z')), Date.parse('2026-11-11T07:00:00Z'));
  for (const [instant, hours] of [['2025-03-09T08:00:00Z', 23], ['2025-11-02T07:00:00Z', 25], ['2026-11-01T07:00:00Z', 24]] as const)
    assert.equal(nextAnalyticsDay(Date.parse(instant)) - Date.parse(instant), hours * 3_600_000);
}
