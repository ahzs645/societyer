import { useMemo } from "react";

import type { Organization } from "../../shared/organizationDomain";
import { useSociety } from "./useSociety";

export function useOrganizationWorkspace() {
  const society = useSociety();

  return useMemo(() => {
    const workspace = society;
    const organization = workspace as Organization | null | undefined;
    const societyId = society?._id ?? null;

    return {
      organization,
      workspace,
      society,
      organizationId: organization?._id ?? null,
      societyId,
      isLoading: society === undefined,
      missingWorkspace: society === null,
    };
  }, [society]);
}
