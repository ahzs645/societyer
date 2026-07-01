import { Navigate } from "react-router-dom";

// Organization Details was merged into the Society page (/app/society), which
// now includes an expandable "More organization details" section covering
// structured addresses, lifecycle dates, classification flags, extra-provincial
// registrations, and tax/registry identifiers. This route is kept only so
// existing links and main.tsx's lazy import keep working; it just redirects.
export function OrganizationDetailsPage() {
  return <Navigate to="/app/society" replace />;
}
