import { createContext } from "react";

export const ProcurementInsuranceWorkspace = createContext<{ societyId: string; name: string } | null>(null);
