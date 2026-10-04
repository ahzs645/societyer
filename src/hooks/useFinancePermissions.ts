import { usePermissions } from "./usePermissions";

/** Match the server's finance, integration and export policies. */
export function useFinancePermissions() {
  const { loaded, can, role } = usePermissions();
  return {
    canWrite: loaded && can("financials:write"),
    canExport: loaded && can("exports:download"),
    canEditSettings: loaded && can("settings:write"),
    canManageIntegration: loaded && can("financials:write") && (role === "Owner" || role === "Admin"),
  };
}
