import { Navigate } from "react-router-dom";

// Organization Details was merged into the organization profile (/app/society),
// whose tabs now hold structured addresses (Offices & contacts), lifecycle dates
// and classification flags (Legal profile), registrations (Registrations) and
// tax and registry identifiers (Tax accounts). This route is kept only so
// existing links and main.tsx's lazy import keep working; it just redirects.
export function OrganizationDetailsPage() {
  return <Navigate to="/app/society?tab=registrations" replace />;
}
