import PostalMime from "postal-mime";

const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

// Only produce text; never render the email's HTML, fetch images, or activate links.
function readableEmailText(html: string) {
  return html.slice(0, 300_000)
    .replace(/<!--[\s\S]*?-->|<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(?:p|div|br|h[1-6]|tr|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160|#xa0);|[\u034f\u200c\ufeff]/gi, " ")
    .replace(/&(amp|quot|apos|lt|gt);/gi, (_, name: string) =>
      ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[name.toLowerCase()] ?? "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/(?:\s*\n){2,}/g, "\n")
    .trim();
}

export async function previewReceiptEmail(input: ArrayBuffer) {
  if (input.byteLength > MAX_EMAIL_BYTES) throw new Error("Email previews support files up to 25 MB.");
  const message = await PostalMime.parse(input, {
    forceRfc822Attachments: true, maxNestingDepth: 20, maxHeadersSize: 256 * 1024, maxPartCount: 250,
  });
  const from = message.from && "address" in message.from ? message.from : undefined;
  const headers = [
    message.subject && `Subject: ${message.subject}`,
    from && `From: ${from.name ? `${from.name} <${from.address}>` : from.address}`,
    message.date && `Date: ${message.date}`,
  ].filter(Boolean).join("\n");
  // Many receipt templates put totals in HTML tables. Keeping row boundaries
  // makes these readable even when the plain-text alternative runs together.
  const body = readableEmailText(message.html ?? "") || message.text?.trim().slice(0, 200_000);
  return [headers, body, message.attachments.length ? `Attachments in original: ${message.attachments.map((item) => item.filename || item.mimeType).join(", ")}` : ""].filter(Boolean).join("\n\n");
}
