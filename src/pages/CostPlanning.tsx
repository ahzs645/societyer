import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageLoading, SeedPrompt } from "./_helpers";
import { CostPlanningWorkspace } from "../features/financials/planning/CostPlanningWorkspace";
import { PlanningQueryBoundary } from "../features/financials/planning/usePlanningSources";

export function CostPlanningPage() {
  const society = useSociety(), permissions = usePermissions();
  const [attempt, setAttempt] = useState(0);
  if (society === undefined) return <PageLoading label="Cost planning" />;
  if (!society) return <SeedPrompt />;
  if (!permissions.loaded) return <PageLoading label="Cost planning" />;
  if (!permissions.can("financials:read")) return <div className="page"><h1>Semester cost planner</h1><p>Finance read permission is required to view cost plans.</p></div>;
  return <PlanningQueryBoundary key={`${society._id}:${attempt}`} label="Cost planner" onRetry={() => setAttempt((value) => value + 1)}><CostPlanningWorkspace societyId={society._id} /></PlanningQueryBoundary>;
}
