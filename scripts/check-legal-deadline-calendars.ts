import assert from 'node:assert/strict';
import { assessAnnualMeetingDeadline, assessAnnualReturnDeadline, withAnnualMeetingCompletion, type AnnualDeadlineCalendarReview, type ComplianceSettings } from '../shared/corporationSettings';
import { noAgmAnnualReportForYear } from '../shared/agmEvidence';

const society: ComplianceSettings = { entityType: 'society', jurisdictionCode: 'CA-BC', incorporationDate: '2020-01-01', annualReturnCycleYear: 2026 };
const calendar: AnnualDeadlineCalendarReview = {
  profileId: 'bc_society', obligation: 'annual_return', cycleYear: 2026,
  nominalDueDate: '2027-01-31', reviewedDueDate: '2027-02-01', reviewedOn: '2027-01-25',
  verified: true, evidenceRef: 'synthetic-reviewed-calendar-record',
  calendarBasis: 'Review fixture: BC Interpretation Act s.25.5; January 31 is Sunday; applicable office/channel checked for February 1.',
};

// January 31, 2027 is Sunday. Raw arithmetic must not label a February 1
// filing legally late or the unfiled boundary legally overdue without review.
assert.equal(new Date('2027-01-31T00:00:00Z').getUTCDay(), 0);
const unreviewed = assessAnnualReturnDeadline(society, '2027-02-01');
assert.equal(unreviewed.nominalDueDate, '2027-01-31');
assert.equal(unreviewed.status, 'review_required');
assert.equal(unreviewed.calendarReviewStatus, 'unreviewed');
assert.ok(unreviewed.sourceIds.includes('BC-IA-TIME'));
const filed = { cycleYear: 2026, filedAt: '2027-02-01', status: 'filed' as const };
const filedWithoutCalendar = assessAnnualReturnDeadline({ ...society, annualReturnFilings: [filed] }, '2027-02-01');
assert.equal(filedWithoutCalendar.status, 'satisfied');
assert.equal(filedWithoutCalendar.late, undefined);
assert.equal(filedWithoutCalendar.timingReviewRequired, true);
const legacyMatch = noAgmAnnualReportForYear([{ kind: 'AnnualReport', status: 'Filed', reportingYear: 2026, filedAt: '2027-02-01' }], 2026);
assert.equal(legacyMatch?.late, undefined);
assert.equal(legacyMatch?.nominalDaysPastDue, 1);

const reviewedSettings = { ...society, annualDeadlineCalendarReviews: [calendar] };
const due = assessAnnualReturnDeadline(reviewedSettings, '2027-02-01');
assert.equal(due.dueDate, '2027-02-01');
assert.equal(due.nominalDueDate, '2027-01-31');
assert.equal(due.status, 'due');
assert.equal(due.calendarEvidenceRef, calendar.evidenceRef);
assert.equal(assessAnnualReturnDeadline(reviewedSettings, '2027-02-02').status, 'overdue');
const timely = assessAnnualReturnDeadline({ ...reviewedSettings, annualReturnFilings: [filed] }, '2027-02-02');
assert.equal(timely.status, 'satisfied');
assert.equal(timely.late, false);
assert.equal(timely.timingReviewRequired, false);
assert.equal(assessAnnualReturnDeadline({ ...reviewedSettings, annualReturnFilings: [{ ...filed, filedAt: '2027-02-02' }] }, '2027-02-02').late, true);

// No evidence for another Act, cycle, obligation or raw boundary may be reused.
for (const invalid of [
  { ...calendar, profileId: 'ontario_obca' }, { ...calendar, cycleYear: 2025 },
  { ...calendar, obligation: 'annual_meeting' as const }, { ...calendar, nominalDueDate: '2027-01-30' },
  { ...calendar, reviewedOn: '2027-02-03' }, { ...calendar, reviewedDueDate: '2027-01-30' },
  { ...calendar, reviewedDueDate: '2027-02-30' }, { ...calendar, verified: false },
  { ...calendar, evidenceRef: '' }, { ...calendar, calendarBasis: '' },
]) {
  const result = assessAnnualReturnDeadline({ ...society, annualDeadlineCalendarReviews: [invalid] }, '2027-02-02');
  assert.equal(result.status, 'review_required');
  assert.equal(result.calendarReviewStatus, 'unreviewed');
}
assert.equal(assessAnnualReturnDeadline({ ...society, annualDeadlineCalendarReviews: [calendar, { ...calendar, reviewedDueDate: '2027-02-02' }] }, '2027-02-02').calendarReviewStatus, 'unreviewed');

// All reviewed corporate profiles expose their own legal calendar source. A
// completed meeting stays factual while an unreviewed late boundary is flagged.
for (const [jurisdictionCode, source] of [['CA-BC', 'BC-IA-TIME'], ['CA-FED-CBCA', 'FED-IA-TIME'], ['CA-ON-OBCA', 'ON-LEGISLATION-TIME']] as const) {
  const entity = { entityType: 'corporation__business_', jurisdictionCode, incorporationDate: '2020-01-01' };
  // Within the calendar-adjustment margin the unreviewed boundary needs review.
  const meeting = assessAnnualMeetingDeadline(entity, '2021-07-05');
  assert.equal(meeting.nominalDueDate, '2021-07-01');
  assert.equal(meeting.status, 'review_required');
  assert.ok(meeting.sourceIds.includes(source));
  const completed = withAnnualMeetingCompletion(meeting, '2021-07-03');
  assert.equal(completed.status, 'satisfied');
  assert.equal(completed.late, undefined);
  assert.equal(completed.timingReviewRequired, true);
  // Long past the margin with no review recorded, the open boundary is overdue
  // and says why; a recorded completion is still attached factually.
  const missed = assessAnnualMeetingDeadline({ ...entity, annualMeetingAssessmentYear: 2021 }, '2022-01-01');
  assert.equal(missed.status, 'overdue');
  assert.equal(missed.calendarReviewStatus, 'unreviewed');
  assert.ok(missed.basis.includes('calendar not reviewed'));
  assert.equal(withAnnualMeetingCompletion(missed, '2021-08-01').status, 'satisfied');
  assert.equal(withAnnualMeetingCompletion(missed, '2021-08-01').timingReviewRequired, true);
}
const incompleteFederal = assessAnnualMeetingDeadline({ entityType: 'corporation__business_', jurisdictionCode: 'CA-FED-CBCA', incorporationDate: '2020-01-01', annualMeetingDate: '2025-01-01' }, '2026-10-11');
assert.equal(withAnnualMeetingCompletion(incompleteFederal, '2026-05-01').status, 'review_required', 'Completion cannot cure an unresolved fiscal-year constraint');
console.log('Annual deadline calendar checks passed: nominal boundaries, exact review scope, holiday regression, factual completion, contradictory evidence and all four Act profiles.');
