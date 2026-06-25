/**
 * SUBSCRIPTION FOR SHARES annex (pure logic).
 *
 * The YCN "Doc - Share Allotment" sheet generates one "Subscription for Shares"
 * agreement per subscriber alongside the directors' allotment resolution. This
 * builds that companion document's content as DOCX blocks: To corp / From
 * subscriber / the subscribe clause / a signature line (with the corporate
 * "By:" branch when the subscriber is an organization). Framework-free.
 */

import { signatureLines, type SignerLine } from "./executionBlock";

export interface DocxBlock {
  kind: "title" | "heading" | "paragraph" | "listItem";
  text: string;
}

export interface SubscriptionAgreementInput {
  corporationName: string;
  shortName: string;
  legislation: string;
  subscriberName: string;
  /** When the subscriber is itself a corporation, its name for the "By:" line. */
  subscriberCorpSign?: string | null;
  shareClass: string;
  quantity: number;
  /** Free-text consideration (e.g. "$1,000 cash"); omitted → generic phrasing. */
  consideration?: string | null;
  dateLong?: string;
}

/** Singular/plural "share" agreement on the subscribed quantity. */
function shareNoun(quantity: number, shareClass: string): string {
  const cls = shareClass.trim();
  const noun = Math.abs(quantity) === 1 ? "share" : "shares";
  return cls ? `${cls} ${noun}` : noun;
}

export function buildSubscriptionAgreementBlocks(input: SubscriptionAgreementInput): DocxBlock[] {
  const considerationClause =
    input.consideration && input.consideration.trim()
      ? ` for consideration of ${input.consideration.trim()}`
      : "";
  const blocks: DocxBlock[] = [
    { kind: "title", text: "Subscription for Shares" },
    { kind: "paragraph", text: `To: ${input.corporationName}` },
    { kind: "paragraph", text: `From: ${input.subscriberName}` },
    {
      kind: "paragraph",
      text:
        `The undersigned hereby subscribes for ${input.quantity} ${shareNoun(input.quantity, input.shareClass)} ` +
        `of ${input.shortName}${considerationClause}, and agrees to be bound by the articles of ${input.shortName} ` +
        `and the provisions of the ${input.legislation}.`,
    },
    { kind: "heading", text: "Execution" },
  ];
  const signer: SignerLine = { name: input.subscriberName, corpSign: input.subscriberCorpSign ?? null };
  for (const line of signatureLines([signer], input.dateLong)) {
    blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}
