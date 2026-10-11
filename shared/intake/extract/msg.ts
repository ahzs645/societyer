/** Outlook .msg → email header blocks + body paragraphs; attachments are
 * returned as bytes so the dispatcher can recurse into them. */
import MsgReaderModule from "@kenjiuno/msgreader";
import { blocksFromPlainText, finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract } from "../blocks";

const MsgReader: any = (MsgReaderModule as any).default ?? MsgReaderModule;

export type MsgAttachment = { name: string; bytes: Uint8Array };

export function extractMsg(bytes: Uint8Array | ArrayBuffer): { extract: IntakeExtract; attachments: MsgAttachment[] } {
  const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const reader = new MsgReader(buffer);
  const data = reader.getFileData();
  if (data?.error) throw new Error(`Unreadable .msg: ${data.error}`);
  const headers: Record<string, string> = {};
  const add = (key: string, value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) headers[key] = text;
  };
  add("From", [data.senderName, data.senderEmail ? `<${data.senderEmail}>` : ""].filter(Boolean).join(" "));
  const recipients = (data.recipients ?? []) as any[];
  add("To", recipients.filter((r) => !r.recipType || r.recipType === "to").map((r) => [r.name, r.email ? `<${r.email}>` : ""].filter(Boolean).join(" ")).join("; "));
  add("Cc", recipients.filter((r) => r.recipType === "cc").map((r) => r.name || r.email).join("; "));
  add("Subject", data.subject);
  add("Date", data.messageDeliveryTime || data.clientSubmitTime || data.creationTime);
  const drafts: DraftBlock[] = Object.entries(headers).map(([key, value]) => ({ kind: "email_header", text: `${key}: ${value}`, style: key }));
  const body = typeof data.body === "string" && data.body.trim() ? data.body : typeof data.bodyHtml === "string" ? data.bodyHtml.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|tr|li|h\d)>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") : "";
  drafts.push(...blocksFromPlainText(body).map((draft) => ({ ...draft, page: undefined })));
  const attachments: MsgAttachment[] = [];
  const warnings: string[] = [];
  for (const attachment of (data.attachments ?? []) as any[]) {
    try {
      if (attachment.innerMsgContent) continue;
      const file = reader.getAttachment(attachment);
      if (file?.content) attachments.push({ name: String(file.fileName || attachment.fileName || attachment.name || "attachment"), bytes: new Uint8Array(file.content) });
    } catch (error) {
      warnings.push(`Attachment ${attachment.fileName ?? "?"} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { blocks, text } = finalizeBlocks(drafts);
  return { extract: { method: "msg-msgreader", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, emailHeaders: headers, warnings }, attachments };
}
