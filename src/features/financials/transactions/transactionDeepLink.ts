import { appRouteAbsoluteHref, type AppRouteHrefOptions } from "../../../lib/appRouteHref";

export function transactionDeepLink(id: string, societyId?: string, options: AppRouteHrefOptions = {}): string {
  const params = new URLSearchParams({ tab: "transactions", transactionId: id });
  if (societyId) params.set("societyId", societyId);
  return appRouteAbsoluteHref(`/app/financials?${params}`, options);
}
