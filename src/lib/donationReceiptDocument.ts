import { escapeHtml } from "./html";
import { formatDate } from "./format";
import { formatMoney } from "./money";

/** Render only recorded facts. The current organization profile is deliberately not an input. */
export function buildDonationReceiptDocument(receipt: Record<string, any>) {
  const eh = escapeHtml;
  const multiline = (value: unknown) => eh(String(value ?? "")).replace(/\r?\n/g, "<br/>");
  const official = receipt.documentKind === "official_tax_receipt";
  const acknowledgement = receipt.documentKind === "acknowledgement";
  const historical = !official && !acknowledgement;
  const prepared = official && receipt.issueStatus !== "issued";
  const title = historical ? "Historical donation record"
    : acknowledgement ? "Donation acknowledgement"
      : prepared ? "Official donation receipt for income tax purposes"
        : "Official donation receipt — record copy";
  const status = receipt.voidedAtISO
    ? `<p><strong>VOID — ${eh(formatDate(receipt.voidedAtISO))}</strong><br/>${eh(receipt.voidReason || "")}</p>`
    : historical ? "<p>This is a historical record. Its original document kind and eligibility evidence were not captured. This export does not establish tax-receipt eligibility.</p>"
      : acknowledgement ? "<p>This acknowledgement is not an official donation receipt for income tax purposes.</p>"
        : prepared ? "<p><strong>Prepared for authorized signature. Valid only when signed.</strong></p>"
          : "<p>Record copy. The retained signed paper receipt is the original issued document.</p>";
  const issuer = receipt.issuerSnapshot;
  const date = receipt.issuedOn || receipt.intendedIssueDate || receipt.issuedAtISO;
  const bodyHtml = `
    <h1>${eh(title)}</h1>
    ${status}
    <p>Record no. <strong>${eh(receipt.receiptNumber)}</strong> · ${prepared ? "Intended issue" : "Issue recorded"}: ${eh(formatDate(date))}<br/>Place of issue: ${eh(receipt.location)}</p>
    <p><strong>${eh(issuer?.name || "Issuer identity was not captured in this historical record")}</strong>${issuer?.address ? `<br/>${multiline(issuer.address)}` : ""}
    ${official && issuer?.charityNumber ? `<br/>Charity registration number: ${eh(issuer.charityNumber)}` : ""}</p>
    <h2>Donor</h2>
    <p>${eh(receipt.donorName)}${receipt.donorAddress ? `<br/>${multiline(receipt.donorAddress)}` : ""}${receipt.donorEmail ? `<br/>${eh(receipt.donorEmail)}` : ""}</p>
    <h2>Gift</h2>
    <table>
      <tr><th>Date received</th><td>${eh(formatDate(receipt.receivedOnISO))}</td></tr>
      <tr><th>${historical ? "Recorded amount" : "Amount"} (CAD)</th><td>${eh(formatMoney(receipt.amountCents))}</td></tr>
      ${official ? `<tr><th>Donor advantage</th><td>None · ${eh(formatMoney(0))}</td></tr><tr><th>Eligible amount (CAD)</th><td>${eh(formatMoney(receipt.eligibleAmountCents))}</td></tr>` : ""}
      ${receipt.description ? `<tr><th>Description</th><td>${multiline(receipt.description)}</td></tr>` : ""}
      ${historical && receipt.charityNumber ? `<tr><th>Registration number recorded in original data</th><td>${eh(receipt.charityNumber)}</td></tr>` : ""}
      ${historical ? `<tr><th>Eligible amount recorded in original data</th><td>${eh(formatMoney(receipt.eligibleAmountCents))}</td></tr>` : ""}
    </table>
    ${official ? `<p>Canada Revenue Agency · <a href="https://www.canada.ca/charities-giving">canada.ca/charities-giving</a></p>
      ${prepared ? "<p>Authorized signature ___________________________________<br/>Name of authorized signatory ______________________________</p>" : `<p>Authorized signatory recorded: ${eh(receipt.signatoryName || "Not captured")}<br/>Signed original retained with this record.</p>`}` : ""}
    ${receipt.replacesReceiptNumber ? `<p>Replaces voided receipt ${eh(receipt.replacesReceiptNumber)}.</p>` : ""}
  `;
  return { title, bodyHtml, filename: `donation-${String(receipt.receiptNumber).replace(/[^\w-]/g, "-")}.pdf` };
}
