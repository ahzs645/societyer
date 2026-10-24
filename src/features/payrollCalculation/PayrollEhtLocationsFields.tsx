import { useState } from 'react';
import { Field } from '../../components/ui';
import { Money } from '../../components/Money';
import { payrollMoney, amountInput } from './payrollUi';
import type { PayrollEhtLocationOpening } from '../../../shared/payrollCalculation';

type LocationDraft = { key: string; id: string; evidence: string; qualifying: boolean; amount: string; reference: string; saved: boolean };
const nextKey = () => crypto.randomUUID();
export function readPayrollEhtLocations(data: FormData): PayrollEhtLocationOpening[] | undefined {
  const count = Number(data.get('ehtLocationCount') ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error('Use at most 100 distinct qualifying EHT locations.');
  if (!count) return undefined;
  return Array.from({ length: count }, (_, index) => {
    const read = (key: string) => String(data.get(`ehtLocation.${index}.${key}`) ?? '').trim();
    return { id: read('id'), evidence: read('evidence'), qualifying: data.has(`ehtLocation.${index}.qualifying`), openingRemunerationCents: payrollMoney(read('amount'), `Location ${index + 1} opening remuneration`)!, openingSourceReference: read('reference') };
  });
}

export function PayrollEhtLocationsFields({ value }: { value?: PayrollEhtLocationOpening[] }) {
  const [rows, setRows] = useState<LocationDraft[]>(() => (value ?? []).map(location => ({ key: nextKey(), id: location.id, evidence: location.evidence, qualifying: location.qualifying, amount: amountInput(location.openingRemunerationCents), reference: location.openingSourceReference, saved: true })));
  const change = (key: string, patch: Partial<LocationDraft>) => setRows(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row));
  let total: number | undefined = 0;
  for (const row of rows) { try { total += payrollMoney(row.amount, 'Location opening')!; } catch { total = undefined; break; } }
  return <section aria-label="Qualifying nonprofit EHT locations">
    <h3>Qualifying nonprofit EHT locations</h3>
    <p>For charitable/nonprofit employers, list actual qualifying physical locations. Each must be a B.C. permanent establishment with exclusive occupancy and use. Suites in one building, contiguous properties and internal divisions sharing that property form one location. Departments, programs and grants do not create separate exemptions.</p>
    <p>Attribute an employee’s whole annual remuneration to their primary qualifying reporting location. Remuneration from nonqualifying premises must be reasonably attributed to a qualifying location. Record that basis in each employee profile.</p>
    <input type="hidden" name="ehtLocationCount" value={rows.length} />
    {rows.map((row, index) => <fieldset key={row.key} className="payroll-calculator__panel"><legend>EHT location {index + 1}</legend>
      <div className="payroll-calculator__form-grid">
        <Field label={`EHT location ${index + 1} identifier`} hint="Use a stable location reference; saved identifiers stay fixed to preserve recorded attribution."><input className="input" name={`ehtLocation.${index}.id`} required maxLength={80} value={row.id} readOnly={row.saved} onChange={event => change(row.key, { id: event.target.value })} /></Field>
        <Field label={`EHT location ${index + 1} qualification evidence`} hint="Identify the physical property, permanent establishment, exclusive occupancy/use, and any contiguous/internal-division grouping."><textarea className="input" name={`ehtLocation.${index}.evidence`} required maxLength={4000} value={row.evidence} onChange={event => change(row.key, { evidence: event.target.value, qualifying: false })} /></Field>
        <Field label={`EHT location ${index + 1} opening remuneration (CAD)`} hint="Actual remuneration already represented at the employer opening date; enter 0 explicitly when none."><input className="input" name={`ehtLocation.${index}.amount`} inputMode="decimal" required value={row.amount} onChange={event => change(row.key, { amount: event.target.value })} /></Field>
        <Field label={`EHT location ${index + 1} opening source reference`}><input className="input" name={`ehtLocation.${index}.reference`} required maxLength={2000} value={row.reference} onChange={event => change(row.key, { reference: event.target.value })} /></Field>
      </div>
      <label className="checkbox-label"><input type="checkbox" name={`ehtLocation.${index}.qualifying`} checked={row.qualifying} onChange={event => change(row.key, { qualifying: event.target.checked })} />EHT location {index + 1} meets the physical qualifying-location requirements</label>
      <p><button className="btn" type="button" onClick={() => setRows(previous => previous.filter(candidate => candidate.key !== row.key))}>Remove EHT location {index + 1}</button></p>
    </fieldset>)}
    <button className="btn" type="button" disabled={rows.length >= 100} onClick={() => setRows(previous => [...previous, { key: nextKey(), id: '', evidence: '', qualifying: false, amount: '', reference: '', saved: false }])}>Add qualifying EHT location</button>
    {rows.length > 0 && <p aria-live="polite">Location opening remuneration total: {total === undefined ? 'Enter a valid amount for each location.' : <Money cents={total} currency="CAD" />}. This must equal the employer’s aggregate EHT opening. The shared covered-through date, confirmation and represented-run selections apply to all locations.</p>}
    <p className="muted">Use the single-location fields above for an existing single-location setup, or the complete list here for multiple locations. The employer’s permanent-establishment days govern the common prorated thresholds; a new location does not create its own shorter employer year.</p>
  </section>;
}
