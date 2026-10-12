/**
 * Articles drafting view for the BC incorporation agreement and articles
 * preparation packets: the "Table 1 supplemented by Parts [n]" sentence, a
 * per-class Part skeleton generated from the structured share-class fields,
 * and drafting checks surfaced as warnings.
 *
 * Output is original preparation text for lawyer review, not precedent
 * wording: every Part keeps bracketed prompts where a fact is missing, and the
 * checks never claim a legal or tax effect.
 *
 * Reads the optional `rightsClasses` fields defined by the share-rights
 * contract (parValueCents, maxAuthorized, dividendEntitlement, dividendRateBps,
 * redemption, liquidationRank, preEmptiveRights, articlesPart,
 * singularDescription, pluralDescription); rows without them still render
 * with prompts. Pure and framework-free.
 */

import { articlesAdoptionSentence, resolveOperativeArticles } from "./operativeArticles";
import { explicitVotesPerShare } from "./shareholderElectorate";

type Redemption = {
  byCompany?: boolean;
  byHolder?: boolean;
  priceCents?: number;
  includesDeclaredUnpaid?: boolean;
  minNoticeDays?: number;
  nonProRataPermitted?: boolean;
};

export type ArticlesClassRow = {
  _id?: string;
  className?: string;
  classType?: string;
  status?: string;
  votesPerShare?: number;
  votingRights?: string;
  parValueCents?: number;
  maxAuthorized?: number;
  dividendEntitlement?: "discretionary_by_class" | "fixed_rate" | "cumulative_fixed" | "participating";
  dividendRateBps?: number;
  redemption?: Redemption;
  liquidationRank?: number;
  preEmptiveRights?: boolean;
  articlesPart?: string;
  singularDescription?: string;
  pluralDescription?: string;
};

export type ArticlesClassPart = { heading: string; text: string };

export type ArticlesPacketView = {
  articles: {
    hasRecord: boolean;
    adoptionSentence: string;
    partsSentence: string;
    hasClassParts: boolean;
    classParts: ArticlesClassPart[];
    hasWarnings: boolean;
    warnings: string[];
  };
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const percent = (bps: number) => `${(bps / 100).toLocaleString("en-CA", { maximumFractionDigits: 2 })}%`;

function plural(row: ArticlesClassRow): string {
  const name = row.pluralDescription?.trim() || row.className?.trim() || "[class name]";
  return /shares$/i.test(name) ? name : `${name} Shares`;
}

function singular(row: ArticlesClassRow): string {
  const name = row.singularDescription?.trim() || row.className?.trim().replace(/\s+shares?$/i, "") || "[class name]";
  return /share$/i.test(name) ? name : `${name} Share`;
}

function isCommon(row: ArticlesClassRow): boolean {
  return /\bcommon\b/i.test(`${row.className ?? ""} ${row.pluralDescription ?? ""}`);
}

function isPreferred(row: ArticlesClassRow): boolean {
  return /\bpref(erred|erence)?\b/i.test(`${row.className ?? ""} ${row.pluralDescription ?? ""}`)
    || row.dividendEntitlement === "fixed_rate" || row.dividendEntitlement === "cumulative_fixed";
}

function shareClasses(rows: ArticlesClassRow[]): ArticlesClassRow[] {
  return rows.filter((row) => (!row.classType || /share/i.test(row.classType)) && !["retired", "cancelled", "archived"].includes(String(row.status ?? "").toLowerCase()));
}

function redemptionPrice(row: ArticlesClassRow): string {
  const price = typeof row.redemption?.priceCents === "number" ? `${money(row.redemption.priceCents)} per share` : "[redemption amount per share]";
  return row.redemption?.includesDeclaredUnpaid ? `${price}, plus all dividends declared on that share and unpaid at the redemption date` : price;
}

function dividendClause(row: ArticlesClassRow, label: string): string {
  const rate = typeof row.dividendRateBps === "number" ? percent(row.dividendRateBps) : "[RATE]";
  switch (row.dividendEntitlement) {
    case "fixed_rate":
      return `Dividends. The holders of the ${label} are entitled to receive, as and when declared by the directors, non-cumulative preferential dividends at the rate of ${rate} per year on [the amount on which the rate is calculated]. Dividends not declared in a year do not accumulate.`;
    case "cumulative_fixed":
      return `Dividends. The holders of the ${label} are entitled to receive cumulative preferential dividends at the rate of ${rate} per year on [the amount on which the rate is calculated], accruing from [the date of issue]. [State how arrears are paid and whether any dividend on a lower-ranking class is restricted while arrears are outstanding.]`;
    case "participating":
      return `Dividends. The holders of the ${label} participate in dividends [state the participation formula and any priority].`;
    case "discretionary_by_class":
      return `Dividends. The holders of the ${label} are entitled to receive dividends as and when the directors declare them on the ${label}. The directors may declare a dividend on this class without declaring one on any other class, and a dividend on any other class without declaring one on this class. Dividends declared on this class are paid in equal amounts per share.`;
    default:
      return `Dividends. [State the dividend entitlement of the ${label}: discretionary by class, a fixed or cumulative rate, or participating.]`;
  }
}

function redemptionClauses(row: ArticlesClassRow, label: string, one: string): string[] {
  const redemption = row.redemption;
  if (!redemption?.byCompany && !redemption?.byHolder) return [];
  const notice = typeof redemption.minNoticeDays === "number" ? `${redemption.minNoticeDays} days'` : "[number of days']";
  const clauses: string[] = [];
  if (redemption.byCompany) clauses.push(`Redemption by the Company. Subject to the Business Corporations Act (including the insolvency restriction in s. 79), the Company may redeem at any time all or any of the ${label} for ${redemptionPrice(row)} (the "Redemption Price").`);
  if (redemption.byHolder) clauses.push(`Retraction by the holder. A holder of ${label} may require the Company to redeem all or any of the holder's ${label} for ${redemption.byCompany ? "the Redemption Price" : `${redemptionPrice(row)} (the "Redemption Price")`} [state the retraction notice and payment period], subject to the Business Corporations Act (including s. 79).`);
  clauses.push(
    redemption.nonProRataPermitted
      ? `(a) Selection. If fewer than all of the ${label} are redeemed, the directors may redeem shares held by one or more holders without redeeming shares held by others, and need not redeem pro rata.`
      : `(a) Selection. If fewer than all of the ${label} are redeemed, the shares to be redeemed are selected pro rata among the holders, disregarding fractions [or state another method].`,
    `(b) Notice. The Company gives each holder whose shares are to be redeemed at least ${notice} written notice before the redemption date, unless the holder waives notice in writing.`,
    `(c) Contents of notice. The notice states the redemption date, the Redemption Price and, if not all of the holder's shares are redeemed, the number to be redeemed.`,
    `(d) Payment. On the redemption date the Company pays the Redemption Price to the holder on presentation and surrender of the certificate (if any) for the shares redeemed.`,
    `(e) Partial redemption. If only part of the shares represented by a certificate is redeemed, the Company issues a new certificate for the balance.`,
    `(f) Effect. From the redemption date the redeemed shares carry no rights except to receive the Redemption Price, unless the Company fails to pay it.`,
    `(g) Deposit. If a holder does not surrender the certificate within [number] days, the Company may deposit the Redemption Price [state the deposit arrangement], which then discharges the Company.`,
    `(h) Transfers. No ${one} that is the subject of an outstanding redemption notice may be transferred [state the period].`,
  );
  return clauses;
}

function liquidationClause(row: ArticlesClassRow, label: string, all: ArticlesClassRow[]): string {
  if (typeof row.liquidationRank !== "number") return `Liquidation. [State the entitlement of the ${label} on a liquidation, dissolution or winding-up, and how this class ranks against every other class.]`;
  const others = all.filter((other) => other !== row && typeof other.liquidationRank === "number");
  const ahead = others.filter((other) => other.liquidationRank! < row.liquidationRank!).map(plural);
  const equal = others.filter((other) => other.liquidationRank === row.liquidationRank).map(plural);
  const behind = others.filter((other) => other.liquidationRank! > row.liquidationRank!).map(plural);
  const residual = !behind.length;
  const parts: string[] = [];
  if (ahead.length) parts.push(`after payment of the amounts to which the ${ahead.join(", ")} are entitled`);
  if (behind.length) parts.push(`in priority to the ${behind.join(", ")}`);
  if (equal.length) parts.push(`equally, share for share, with the ${equal.join(", ")}`);
  const entitlement = residual
    ? `to share in the remaining property of the Company`
    : `to receive ${row.redemption?.byCompany || row.redemption?.byHolder ? "an amount equal to the Redemption Price" : "[the preferential amount] per share"}, and after that payment to no further participation`;
  return `Liquidation. On a liquidation, dissolution or winding-up of the Company, the holders of the ${label} are entitled ${parts.length ? `${parts.join(" and ")}, ` : ""}${entitlement}.`;
}

function votingClause(row: ArticlesClassRow, label: string): string {
  const votes = explicitVotesPerShare(row);
  if (votes === undefined) return `Voting. [State whether the holders of the ${label} are entitled to notice of, to attend and to vote at general meetings, and the number of votes per share.]`;
  if (votes === 0) return `Voting. The holders of the ${label} are not, as holders of that class, entitled to receive notice of, attend or vote at general meetings, except where the Business Corporations Act gives them a vote (for example, a separate class vote on a change to the special rights or restrictions of the class).`;
  return `Voting. The holders of the ${label} are entitled to receive notice of, attend and vote at general meetings, with ${votes} vote${votes === 1 ? "" : "s"} for each share held.`;
}

/** One Part per share class, from the structured share-class fields. */
export function articlesClassParts(rows: ArticlesClassRow[]): ArticlesClassPart[] {
  const classes = shareClasses(rows);
  return classes.map((row, index) => {
    const label = plural(row);
    const one = singular(row);
    const par = typeof row.parValueCents === "number" ? `with a par value of ${money(row.parValueCents)} each` : "without par value";
    const heading = `${row.articlesPart?.trim() || `Part [${21 + index}]`} — Special rights and restrictions of the ${label}`;
    const clauses = [
      `Special rights and restrictions. The ${label} ${par} have attached to them the special rights and restrictions set out in this Part.${typeof row.maxAuthorized === "number" ? ` [Confirm the notice of articles states a maximum of ${row.maxAuthorized.toLocaleString("en-CA")} ${label}.]` : " [Confirm the authorized number (maximum or no maximum) in the notice of articles.]"}`,
      dividendClause(row, label),
      ...redemptionClauses(row, label, one),
      liquidationClause(row, label, classes),
      votingClause(row, label),
      row.preEmptiveRights === true ? `Pre-emptive rights. [State the pre-emptive right of the holders of the ${label} on a new issue.]`
        : row.preEmptiveRights === false ? `Pre-emptive rights. The holders of the ${label} have no pre-emptive right to acquire shares the Company issues.`
          : `Pre-emptive rights. [State whether the holders of the ${label} have any pre-emptive right.]`,
      ...(row.redemption?.byCompany || row.redemption?.byHolder
        ? [`Cancellation. ${label} that are redeemed are cancelled (Business Corporations Act s. 82(1)(a)) [state whether they may be reissued].`]
        : []),
    ];
    return { heading, text: [heading, ...clauses].join("\n") };
  });
}

/** Drafting checks for lawyer review. Warnings only; never conclusions. */
export function articlesDraftingWarnings(rows: ArticlesClassRow[]): string[] {
  const classes = shareClasses(rows);
  const warnings: string[] = [];
  for (const row of classes) {
    const label = plural(row);
    if (row.dividendEntitlement === "cumulative_fixed" && typeof row.dividendRateBps !== "number") {
      warnings.push(`${label}: "cumulative" dividends need a stated rate and base. Without them the entitlement works as discretionary; describe it as discretionary by class instead.`);
    }
    if (row.dividendEntitlement === "fixed_rate" && typeof row.dividendRateBps !== "number") warnings.push(`${label}: state the fixed dividend rate.`);
    if ((row.redemption?.byCompany || row.redemption?.byHolder) && typeof row.redemption?.priceCents !== "number") warnings.push(`${label}: state the redemption price.`);
    if (row.redemption?.byCompany || row.redemption?.byHolder) {
      warnings.push(`${label}: if these are estate-freeze shares, the redemption amount is normally the fair market value of the frozen interest at issue, with a price-adjustment clause; a fixed nominal price does not follow value. Confirm with tax and legal advisers.`);
    }
    if (isCommon(row) && !row.articlesPart?.trim()) warnings.push(`${label}: spell out the voting, dividend and liquidation rights of the common shares rather than leaving them implicit.`);
  }
  const preferred = classes.filter(isPreferred);
  if (preferred.length > 1 && preferred.some((row) => typeof row.liquidationRank !== "number")) {
    warnings.push(`State how the ${preferred.map(plural).join(", ")} rank against each other on liquidation (equally, or one before another).`);
  }
  if (classes.some((row) => row.dividendEntitlement === "discretionary_by_class")) {
    warnings.push("Dividends declared on one class to the exclusion of others can have tax consequences, including the tax on split income rules. This draft makes no tax claim; obtain tax advice.");
  }
  return warnings;
}

/** Context for the bc-incorporation-agreement and bc-articles-preparation packets. */
export function articlesPacketView(organization: any, rightsClasses: ArticlesClassRow[]): ArticlesPacketView {
  const resolved = resolveOperativeArticles(organization);
  const classParts = articlesClassParts(rightsClasses);
  const warnings = [...(resolved?.warnings ?? []), ...articlesDraftingWarnings(rightsClasses)];
  const partsSentence = resolved?.customParts.length
    ? resolved.customParts.map((part) => `${part.part} (${part.title})`).join("; ")
    : classParts.length ? classParts.map((part) => part.heading.split(" — ")[0]).join(", ") : "";
  return {
    articles: {
      hasRecord: Boolean(resolved),
      adoptionSentence: articlesAdoptionSentence(organization) ?? "",
      partsSentence,
      hasClassParts: classParts.length > 0,
      classParts,
      hasWarnings: warnings.length > 0,
      warnings,
    },
  };
}
