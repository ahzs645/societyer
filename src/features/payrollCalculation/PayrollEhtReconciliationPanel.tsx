import { Money } from '../../components/Money';
import type { PayrollEhtReconciliation } from '../../../shared/payrollCalculation';

export function PayrollEhtReconciliationPanel({ value, title = 'EHT by qualifying location' }: { value: PayrollEhtReconciliation; title?: string }) {
  const total = (key: 'afterCents' | 'taxAfterCents') => value.locations.reduce((amount, location) => amount + location[key], 0);
  return <section className="card payroll-calculator__panel" aria-label="EHT location reconciliation">
    <h3>{title}</h3>
    {!value.complete && <p role="alert">Source reconciliation is incomplete. Resolve the listed source gaps before treating these figures as the employer’s complete liability.</p>}
    {(value.warnings ?? []).map((warning, index) => <p key={index} role="alert">{warning}</p>)}
    <div className="payroll-calculator__table-wrap"><table className="table" aria-label="EHT amounts by qualifying location"><thead><tr><th>Physical location</th><th>Opening CAD</th><th>Prior recorded remuneration CAD</th><th>This calculation CAD</th><th>Resulting remuneration CAD</th><th>Tax before CAD</th><th>Tax after CAD</th><th>Tax change CAD</th></tr></thead><tbody>{value.locations.map(location => <tr key={location.id}><th scope="row">{location.id}</th><td><Money cents={location.openingRemunerationCents} currency="CAD" /></td><td><Money cents={location.beforeCents} currency="CAD" /></td><td><Money cents={location.currentCents} currency="CAD" /></td><td><Money cents={location.afterCents} currency="CAD" /></td><td><Money cents={location.taxBeforeCents} currency="CAD" /></td><td><Money cents={location.taxAfterCents} currency="CAD" /></td><td><Money cents={location.taxDeltaCents} currency="CAD" /></td></tr>)}</tbody></table></div>
    {value.complete && <p>Recorded remuneration total: <Money cents={total('afterCents')} currency="CAD" /> · Calculated annual liability on those amounts: <Money cents={total('taxAfterCents')} currency="CAD" /> · This calculation’s EHT change: <Money cents={value.taxDeltaCents} currency="CAD" />.</p>}
    <details><summary>Qualifying location and opening evidence</summary>{value.locations.map(location => <div key={location.id}><h4>{location.id}</h4><p>{location.evidence}</p><p>Opening source: {location.openingSourceReference}</p></div>)}</details>
    <p className="muted">This uses recorded remuneration and actual qualifying physical locations. It does not turn program, fund or grant allocations into EHT exemptions. Reconcile the complete annual return and payments separately.</p>
  </section>;
}
