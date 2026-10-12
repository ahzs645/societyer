/**
 * Share-class presets: pre-filled class rows the user must confirm against
 * the company's own articles. A preset is a starting point, never a statement
 * of what any company's articles say. Classes are created with status
 * "needs_review" so nothing treats them as confirmed until the user checks
 * each field and sets the class to active.
 */

import type { StructuredShareRights } from "./equityLedger";

export type ShareClassPresetClass = StructuredShareRights & {
  className: string;
  classType: "share";
  votesPerShare: number;
  votingRights: string;
  conditionsToTransfer?: string;
  otherProvisions: string;
};

export type ShareClassPreset = {
  id: string;
  label: string;
  description: string;
  /** Shown before creation; the user must confirm it. */
  confirmation: string;
  classes: ShareClassPresetClass[];
};

const REVIEW = "Preset text: replace with the special rights and restrictions in your articles. The articles govern.";
const TRANSFER = "Confirm whether the articles require the directors' consent to a transfer.";

/** Redemption terms common to the preferred classes of this structure; confirm each against the articles. */
const PREFERRED_REDEMPTION = {
  byCompany: true,
  byHolder: false,
  priceCents: 1000,
  includesDeclaredUnpaid: true,
  minNoticeDays: 10,
  nonProRataPermitted: true,
} as const;

export const FAMILY_HOLDING_COMPANY_PRESET: ShareClassPreset = {
  id: "family_holding_company",
  label: "Family holding company (Common + Class A voting preferred + Class B and C non-voting preferred)",
  description:
    "Four classes without par value and with no maximum: voting Common shares; Class A voting preferred shares; and Class B and Class C non-voting preferred shares. Dividends are declared class by class at the directors' discretion. The preferred classes are redeemable by the company at a fixed price plus declared but unpaid dividends, on notice, and not necessarily pro rata. Class B and C rank first on liquidation for their redemption amount.",
  confirmation:
    "I will compare every class, price, notice period, voting condition and liquidation ranking with our articles and notice of articles before setting these classes to active. Dividend and redemption features can have tax consequences; this preset is not legal or tax advice.",
  classes: [
    {
      className: "Common",
      classType: "share",
      votesPerShare: 1,
      votingRights: "One vote per share at general meetings.",
      dividendEntitlement: "discretionary_by_class",
      redemption: { byCompany: false, byHolder: false },
      liquidationRank: 2,
      singularDescription: "Common Share",
      pluralDescription: "Common Shares",
      conditionsToTransfer: TRANSFER,
      otherProvisions: `${REVIEW} Spell out the Common shares' rights; articles often leave them implicit.`,
    },
    {
      className: "Class A Voting Preferred",
      classType: "share",
      votesPerShare: 1,
      votingRights: "One vote per share at general meetings.",
      dividendEntitlement: "discretionary_by_class",
      redemption: { ...PREFERRED_REDEMPTION },
      liquidationRank: 2,
      singularDescription: "Class A Voting Preferred Share",
      pluralDescription: "Class A Voting Preferred Shares",
      conditionsToTransfer: TRANSFER,
      otherProvisions: `${REVIEW} In this structure Class A ranks equally with Common on liquidation, so "preferred" may describe no actual preference. Check any requirement that Common and Class A be subdivided or consolidated together.`,
    },
    {
      className: "Class B Non-Voting Preferred",
      classType: "share",
      votesPerShare: 0,
      votingRights: "Non-voting while any Common or Class A share is held outside the company (confirm the condition in the articles). The class still votes separately on changes to its own rights.",
      dividendEntitlement: "discretionary_by_class",
      redemption: { ...PREFERRED_REDEMPTION },
      liquidationRank: 1,
      preEmptiveRights: false,
      singularDescription: "Class B Non-Voting Preferred Share",
      pluralDescription: "Class B Non-Voting Preferred Shares",
      conditionsToTransfer: TRANSFER,
      otherProvisions: `${REVIEW} Ranks ahead of Common and Class A for its redemption amount and does not participate further. Confirm how Class B ranks against Class C.`,
    },
    {
      className: "Class C Non-Voting Preferred",
      classType: "share",
      votesPerShare: 0,
      votingRights: "Non-voting while any Common or Class A share is held outside the company (confirm the condition in the articles). The class still votes separately on changes to its own rights.",
      dividendEntitlement: "discretionary_by_class",
      redemption: { ...PREFERRED_REDEMPTION },
      liquidationRank: 1,
      preEmptiveRights: false,
      singularDescription: "Class C Non-Voting Preferred Share",
      pluralDescription: "Class C Non-Voting Preferred Shares",
      conditionsToTransfer: TRANSFER,
      otherProvisions: `${REVIEW} Ranks ahead of Common and Class A for its redemption amount and does not participate further. Confirm how Class C ranks against Class B.`,
    },
  ],
};

export const SHARE_CLASS_PRESETS: readonly ShareClassPreset[] = [FAMILY_HOLDING_COMPANY_PRESET];
