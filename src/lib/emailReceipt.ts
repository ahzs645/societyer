import PostalMime, { type Address } from "postal-mime";

const MAX_EMAIL_BYTES = 25 * 1024 * 1024;
const MAX_HTML_CHARS = 2_000_000;
const MAX_TEXT_CHARS = 200_000;

export type EmailAttachmentPreview = {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
  /** Content-ID without angle brackets, lowercased, for matching `cid:` references. */
  contentId?: string;
  /** Referenced from the HTML body (e.g. an inline logo) rather than attached for download. */
  inline: boolean;
};

export type EmailPreview = {
  subject?: string;
  from?: string;
  to: string[];
  cc: string[];
  date?: string;
  html?: string;
  text?: string;
  attachments: EmailAttachmentPreview[];
};

function formatAddress(address: Address): string[] {
  if (address.group) return address.group.flatMap(formatAddress);
  return [address.name ? `${address.name} <${address.address}>` : address.address];
}

function toArrayBuffer(content: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (content instanceof ArrayBuffer) return content;
  if (typeof content === "string") return new TextEncoder().encode(content).buffer;
  return content.slice().buffer;
}

/** Parses an .eml file into the parts the preview renders. Never touches the network. */
export async function parseEmailPreview(input: ArrayBuffer): Promise<EmailPreview> {
  if (input.byteLength > MAX_EMAIL_BYTES) throw new Error("Email previews support files up to 25 MB.");
  const message = await PostalMime.parse(input, {
    forceRfc822Attachments: true, maxNestingDepth: 20, maxHeadersSize: 256 * 1024, maxPartCount: 250,
  });
  return {
    subject: message.subject?.trim() || undefined,
    from: message.from ? formatAddress(message.from).join(", ") : undefined,
    to: (message.to ?? []).flatMap(formatAddress),
    cc: (message.cc ?? []).flatMap(formatAddress),
    date: message.date,
    html: message.html?.slice(0, MAX_HTML_CHARS) || undefined,
    text: message.text?.trim().slice(0, MAX_TEXT_CHARS) || undefined,
    attachments: message.attachments.map((item, index) => {
      const contentId = item.contentId?.replace(/^<|>$/g, "").trim().toLowerCase() || undefined;
      return {
        filename: item.filename || `attachment-${index + 1}`,
        mimeType: item.mimeType,
        bytes: toArrayBuffer(item.content),
        contentId,
        inline: Boolean(item.related || (item.disposition === "inline" && contentId)),
      };
    }),
  };
}

// Text only: never renders the email's HTML, fetches images, or activates links.
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

/** Plain-text summary of an email (headers, body, attachment names) for non-visual checks. */
export async function previewReceiptEmail(input: ArrayBuffer) {
  const email = await parseEmailPreview(input);
  const headers = [
    email.subject && `Subject: ${email.subject}`,
    email.from && `From: ${email.from}`,
    email.date && `Date: ${email.date}`,
  ].filter(Boolean).join("\n");
  // Many receipt templates put totals in HTML tables. Keeping row boundaries
  // makes these readable even when the plain-text alternative runs together.
  const body = readableEmailText(email.html ?? "") || email.text;
  const attached = email.attachments.filter((item) => !item.inline);
  return [headers, body, attached.length ? `Attachments in original: ${attached.map((item) => item.filename).join(", ")}` : ""].filter(Boolean).join("\n\n");
}
