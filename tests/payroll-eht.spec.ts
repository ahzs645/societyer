import { expect, test } from '@playwright/test';

test('qualified physical EHT locations persist, reconcile exact annual cents and receive native employee attribution', async ({ page }) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app/payroll/calculator?tab=employer');
  await expect(page.getByRole('heading', { name: 'Payroll calculator', exact: true })).toBeVisible();
  const societyId = await page.evaluate(async () => {
    const { localDataClient: client } = await import('/src/lib/localDataClient.ts');
    const { setStoredSocietyId } = await import('/src/hooks/useSociety.ts');
    const { setStoredUserId } = await import('/src/hooks/useCurrentUser.ts');
    const workspace = await client.mutation('society:createWorkspace', { name: 'Synthetic EHT locations browser', jurisdictionCode: 'CA-BC', seedDocumentPackets: false, isCharity: false, isMemberFunded: false });
    const owners = await client.query('users:list', { societyId: workspace.societyId });
    setStoredSocietyId(workspace.societyId); setStoredUserId(owners.find((owner: any) => owner.role === 'Owner')._id);
    return workspace.societyId;
  });
  await page.reload();
  const tabs = page.getByRole('navigation', { name: 'Payroll calculator sections', exact: true });
  await tabs.getByRole('button', { name: 'Employer setup', exact: true }).click();
  await page.getByRole('button', { name: 'Configure employer year', exact: true }).click();
  let form = page.getByRole('form', { name: 'Employer setup', exact: true });
  await form.getByLabel('Pay frequency', { exact: true }).selectOption('semimonthly');
  await form.getByLabel('Actual pay dates', { exact: true }).fill(Array.from({ length: 12 }, (_, i) => [7, 22].map(day => `2026-${String(i + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)).flat().join('\n'));
  await form.getByLabel('EHT employer class', { exact: true }).selectOption('charitable_nonprofit');
  for (const [label, value] of [
    ['EI employer multiplier', '1.4'], ['EHT qualification evidence', 'Reviewed Income Tax Act 149(1)(l) exemption and organizational records'], ['Permanent establishment days in year', '365'], ['EHT opening remuneration', '3000000.00'], ['EHT opening covered through', '2026-04-30'], ['EHT opening source reference', 'Complete synthetic annual remuneration allocated to physical locations'], ['WorkSafe rate per $100', '1'], ['Annual WorkSafe assessable earnings limit', '127500.00'], ['WorkSafe classification code', 'Synthetic actual class'], ['WorkSafe rate evidence', 'Reviewed actual 2026 net-rate notice'],
  ]) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByRole('checkbox', { name: 'EHT opening remuneration is complete and confirmed', exact: true }).check();
  await form.getByRole('checkbox', { name: 'Default employer EI, benefits and pension assumptions reviewed for employees without overrides', exact: true }).check();
  for (const [index, id, amount] of [[1, 'north-campus', '1400000.00'], [2, 'south-campus', '1600000.00']] as const) {
    await form.getByRole('button', { name: 'Add qualifying EHT location', exact: true }).click();
    await form.getByLabel(`EHT location ${index} identifier`, { exact: true }).fill(id);
    await form.getByLabel(`EHT location ${index} qualification evidence`, { exact: true }).fill(`${id}: distinct noncontiguous B.C. permanent establishment, exclusive use and occupancy; no shared internal divisions omitted`);
    await form.getByLabel(`EHT location ${index} opening remuneration (CAD)`, { exact: true }).fill(amount);
    await form.getByLabel(`EHT location ${index} opening source reference`, { exact: true }).fill(`Reviewed ${id} actual wage register and physical premises records`);
    await form.getByRole('checkbox', { name: `EHT location ${index} meets the physical qualifying-location requirements`, exact: true }).check();
  }
  await expect(form).toContainText('Location opening remuneration total:');
  await expect(form).toContainText('$3,000,000.00');
  await form.getByRole('button', { name: 'Save employer setup', exact: true }).click();
  await expect(form).toBeHidden();
  const annual = page.getByRole('region', { name: 'EHT location reconciliation', exact: true });
  await expect(annual).toContainText('Recorded 2026 EHT by physical location');
  await expect(annual).toContainText('$2,925.00');
  await expect(annual.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Edit employer setup', exact: true }).click();
  form = page.getByRole('form', { name: 'Employer setup', exact: true });
  await expect(form.getByLabel('EHT location 1 identifier', { exact: true })).toHaveValue('north-campus');
  await expect(form.getByLabel('EHT location 2 opening remuneration (CAD)', { exact: true })).toHaveValue('1600000.00');
  await expect(form.getByLabel('EHT location 2 qualification evidence', { exact: true })).toHaveValue(/exclusive use and occupancy/);
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();

  const checked = await page.evaluate(async societyId => {
    const { localDataClient: client } = await import('/src/lib/localDataClient.ts');
    const { emptyPayrollYtd } = await import('/shared/payrollDeductions.ts');
    const employer = (await client.query('payrollCalculation:workspace', { societyId, collection: 'employer', year: 2026 })).page[0];
    if (employer.ehtLocations.length !== 2 || employer.ehtLocations[1].openingRemunerationCents !== 160000000) throw new Error('Saved location cents did not persist.');
    const employeeId = await client.mutation('employees:create', { societyId, firstName: 'Casey', lastName: 'EHT boundary', role: 'Synthetic boundary fixture', startDate: '2025-01-01', birthDate: '1990-01-01', province: 'BC', employmentType: 'PartTime', cppExempt: false, eiExempt: false });
    await client.mutation('payrollCalculation:saveProfile', { societyId, employeeId, fields: { effectiveFrom: '2025-01-01', provinceOfEmployment: 'BC', employmentKind: 'ordinary', compensation: 'hourly', rateCents: 2500000, normalWeeklyMinutes: 2400, averageWeeklyMinutes: 2400, policy: 'ordinary_bc', restPeriodsConfirmed: true, historyCompleteFrom: '2026-04-01', historyCompleteThrough: '2026-05-16', ytdConfirmed: true, vacationMode: 'accrue', td1: { confirmed: true, declarationReference: 'Reviewed synthetic TD1' }, cpp: { exempt: false }, eiExempt: false, ehtLocationId: 'north-campus', ehtAttributionBasis: 'primary_reporting', ehtAttributionEvidence: 'Employee primarily reports to the north physical premises for this calendar year' } });
    await client.mutation('payrollCalculation:saveOpeningBalance', { societyId, employeeId, fields: { year: 2026, coveredThroughDate: '2026-04-30', sameEmployerConfirmed: true, sourceReference: 'Confirmed zero employee opening; employer location opening relates to other workers', ytd: emptyPayrollYtd(), insurableHours: 0, vacationBalanceCents: 0, cashPaidCents: 0, netPaidCents: 0, workSafeAssessableCents: 0, sickPaidDaysUsed: 0, sickUnpaidDaysUsed: 0, representedPayRunIds: [] } });
    await client.mutation('payrollCalculation:saveWorkDay', { societyId, employeeId, fields: { date: '2026-05-15', minutes: 480 } });
    return { employeeId };
  }, societyId);
  await tabs.getByRole('button', { name: 'Calculate', exact: true }).click();
  const runForm = page.getByRole('form', { name: 'Payroll run inputs', exact: true });
  await runForm.getByLabel('Pay period start', { exact: true }).fill('2026-05-01');
  await runForm.getByLabel('Pay period end', { exact: true }).fill('2026-05-15');
  await runForm.getByLabel('Payment date', { exact: true }).fill('2026-05-22');
  await runForm.getByRole('checkbox', { name: /Casey EHT boundary/ }).check();
  await runForm.getByRole('button', { name: 'Preview calculation', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Live payroll preview', exact: true });
  await expect(preview.getByRole('region', { name: 'EHT location reconciliation', exact: true })).toContainText('$5,850.00');
  await expect(preview.getByRole('alert')).toHaveCount(0);
  const native = await page.evaluate(async ({ societyId, employeeId }) => {
    const { localDataClient: client } = await import('/src/lib/localDataClient.ts');
    const input = { periodStart: '2026-05-01', periodEnd: '2026-05-15', payDate: '2026-05-22', runType: 'regular', employeeIds: [employeeId], method: 'option1' };
    const result = await client.query('payrollCalculation:preview', { societyId, input });
    if (result.blockers.length || result.employees[0].blockers.length) throw new Error(JSON.stringify(result.blockers.concat(result.employees[0].blockers)));
    return result.ehtReconciliation;
  }, { societyId, employeeId: checked.employeeId });
  expect(native.complete).toBe(true); expect(native.taxDeltaCents).toBe(292500);
  expect(native.locations.map((location: any) => [location.id, location.beforeCents, location.currentCents, location.afterCents, location.taxAfterCents])).toEqual([['north-campus', 140000000, 20000000, 160000000, 292500], ['south-campus', 160000000, 0, 160000000, 292500]]);
  expect(errors).toEqual([]);
});
