import { isCalendarDate } from "./invoicing";
import { normalizeGstRegistration, selectIssuerTaxRegistrations } from "./invoiceTaxRegistrations";

export type GstAccountIdentifier = {
  kind?: string;
  number?: string;
  status?: string;
  registeredAt?: string;
};

export type GstAccountReference = {
  status: "ready" | "missing" | "review" | "conflict" | "inactive" | "future";
  number?: string;
  message: string;
};

/** A reference to today's organization account, never evidence of the account
 * used for a historic return. A BN alone must not become a GST/HST account. */
export function organizationGstAccountReference(
  identifiers: GstAccountIdentifier[],
  asOfDate: string,
): GstAccountReference {
  const relevant = identifiers.filter(row => row.kind === "gst"
    || (row.kind === "business_number" && normalizeGstRegistration(row.number ?? "")));
  const eligible = relevant.flatMap(row => selectIssuerTaxRegistrations([row], asOfDate));
  const numbers = [...new Set(eligible.map(row => row.number))];
  if (numbers.length > 1) return {
    status: "conflict",
    message: "More than one active GST/HST account is eligible. Review the organization identifiers and choose the correct account before filing; no account has been selected automatically.",
  };
  if (numbers.length === 1) return {
    status: "ready", number: numbers[0],
    message: "Current organization account. Confirm that this is the account for the return and reporting period you are filing.",
  };
  if (relevant.some(row => row.status === "active"
    && normalizeGstRegistration(row.number ?? "")
    && row.registeredAt && isCalendarDate(row.registeredAt) && row.registeredAt > asOfDate)) return {
    status: "future",
    message: "The saved GST/HST registration starts in the future. Review its effective date before using an account for this filing.",
  };
  if (relevant.some(row => row.status !== "inactive")) return {
    status: "review",
    message: "The GST/HST registration needs review. Confirm the full account number, status and effective date in the organization identifiers.",
  };
  if (relevant.length) return {
    status: "inactive",
    message: "The saved GST/HST registration is inactive. Check the registration and the account required for this return before filing.",
  };
  return {
    status: "missing",
    message: "No GST/HST account is saved. Add the full account number from the registration: nine digits, RT, then four digits. A business number alone is not a GST/HST account.",
  };
}
