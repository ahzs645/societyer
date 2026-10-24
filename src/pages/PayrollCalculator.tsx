import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageLoading, SeedPrompt } from "./_helpers";
import { PayrollCalculatorWorkspace } from "../features/payrollCalculation/PayrollCalculatorWorkspace";
import { PayrollQueryBoundary } from "../features/payrollCalculation/payrollUi";

export function PayrollCalculatorPage() {
  const society = useSociety(),
    permissions = usePermissions(),
    [attempt, setAttempt] = useState(0);
  if (society === undefined) return <PageLoading label="Payroll calculator" />;
  if (!society) return <SeedPrompt />;
  if (!permissions.loaded) return <PageLoading label="Payroll calculator" />;
  if (!permissions.can("financials:read"))
    return (
      <div className="page">
        <h1>Payroll calculator</h1>
        <p>Finance read permission is required to view payroll calculations.</p>
      </div>
    );
  return (
    <PayrollQueryBoundary
      key={`${society._id}:${attempt}`}
      label="Payroll calculator"
      onRetry={() => setAttempt((old) => old + 1)}
    >
      <PayrollCalculatorWorkspace societyId={society._id} />
    </PayrollQueryBoundary>
  );
}
