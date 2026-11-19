import { emlAttachments } from "../../../../shared/registryDocuments/eml";

/**
 * Text from registry files, with an email's PDF and message attachments read
 * as documents of their own. The text extractor is injected: the worker passes
 * `extractBytes` with pdf.js; the check script passes a stand-in. No browser
 * or Convex imports here.
 */

export type RegistryFileInput = { id: string; name: string; bytes: Uint8Array };

export type RegistryFileText = {
  /** "f0" for a chosen file, "f0.1" for its first attachment. */
  id: string;
  /** The chosen file this came from. */
  sourceId: string;
  /** The email this was attached to. */
  parentId?: string;
  name: string;
  text: string;
  warnings: string[];
  /** Set for an attachment: its own bytes, so it can be uploaded as a file. */
  attachment?: { bytes: Uint8Array; mimeType: string };
};

export type ExtractText = (name: string, bytes: Uint8Array) => Promise<{ text: string; warnings: string[] }>;

/** An attached message inside an attached message is read; one level deeper is not. */
const MAX_ATTACHMENT_DEPTH = 2;

export function isEmailFileName(name: string) {
  return /\.eml$/i.test(name);
}

async function readOne(
  input: { id: string; sourceId: string; parentId?: string; name: string; bytes: Uint8Array; attachment?: RegistryFileText["attachment"] },
  extract: ExtractText,
  depth: number,
): Promise<RegistryFileText[]> {
  let text = "";
  const warnings: string[] = [];
  try {
    const result = await extract(input.name, input.bytes);
    text = result.text;
    warnings.push(...result.warnings);
  } catch (error) {
    warnings.push(`Could not read ${input.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const own: RegistryFileText = {
    id: input.id,
    sourceId: input.sourceId,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    name: input.name,
    text,
    warnings,
    ...(input.attachment ? { attachment: input.attachment } : {}),
  };
  const results = [own];
  if (!isEmailFileName(input.name) || depth >= MAX_ATTACHMENT_DEPTH) return results;
  let attachments: ReturnType<typeof emlAttachments> = [];
  try {
    attachments = emlAttachments(input.bytes);
  } catch (error) {
    warnings.push(`Could not read the attachments of ${input.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [index, attachment] of attachments.entries()) {
    results.push(...await readOne({
      id: `${input.id}.${index + 1}`,
      sourceId: input.sourceId,
      parentId: input.id,
      name: attachment.name,
      bytes: attachment.bytes,
      attachment: { bytes: attachment.bytes, mimeType: attachment.contentType },
    }, extract, depth + 1));
  }
  return results;
}

/** One chosen file: itself, then (for an email) each PDF or message attached to it. */
export function readRegistryFile(file: RegistryFileInput, extract: ExtractText): Promise<RegistryFileText[]> {
  return readOne({ id: file.id, sourceId: file.id, name: file.name, bytes: file.bytes }, extract, 0);
}
