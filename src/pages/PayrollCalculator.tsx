import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { Banner } from "../components/ui";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
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
        <PageHeader title="Payroll calculator" />
        <Banner tone="info">
          Finance read permission is required to view payroll calculations.
        </Banner>
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
