/**
 * "This is us": whether a supplier (or buyer) named on a notice is the
 * workspace's own organisation, so its wins can be marked. Names are compared
 * the way the reader compares organisations (case, spacing, punctuation and a
 * trailing legal suffix don't matter). The workspace's name is the only name
 * for now; aliases would come from workspace settings.
 */
import { useMemo } from "react";
import { useSociety } from "../../../hooks/useSociety";

const SUFFIX = /\b(inc|incorporated|ltd|limited|corp|corporation|society|association|co|llc|llp)\b\.?$/;

export function organisationKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(SUFFIX, "").trim();
}

/** A test for "is this name ours?"; always false when the workspace has no name. */
export function useIsOurOrganisation(): (name: string | null | undefined) => boolean {
  const society = useSociety();
  const ours = society?.name ? organisationKey(society.name) : "";
  return useMemo(() => (name) => Boolean(ours && name && organisationKey(name) === ours), [ours]);
}
