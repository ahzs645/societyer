import { useMemo } from 'react';
import type { EmployerSettingsFields } from '../../../shared/payrollCalculation';
import { payrollEhtReconciliation, payrollLocationHistory } from '../../../shared/payrollEmployerConfiguration';
import { PayrollEhtReconciliationPanel } from './PayrollEhtReconciliationPanel';

export function PayrollEhtAnnualPanel({ employer, runs, complete }: { employer: EmployerSettingsFields; runs: Array<{ _id: string }>; complete: boolean }) {
  const result = useMemo(() => {
    if (!complete) return {};
    try { return { value: payrollEhtReconciliation(employer, payrollLocationHistory(employer, runs), new Map()) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Review the recorded EHT location sources.' }; }
  }, [employer, runs, complete]);
  if (employer.ehtEmployerClass !== 'charitable_nonprofit' || !(employer.ehtLocations?.length || employer.ehtLocation)) return null;
  if (!complete) return <p role="status">Load every recorded {employer.year} payroll page before viewing the complete EHT location reconciliation.</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return result.value ? <PayrollEhtReconciliationPanel value={result.value} title={`Recorded ${employer.year} EHT by physical location`} /> : null;
}
