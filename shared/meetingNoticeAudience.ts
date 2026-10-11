import { organizationRuleScope } from "./entityRuleScope";
import type { LegalEntityLike } from "./organizationDomain";
import { votesPerShareOf } from "./votingPower";

/**
 * Who gets annual-meeting notice, and how much of that audience the recorded
 * deliveries cover (pure logic, shared by the notice action and the coverage
 * query).
 *
 * A society (and a custom entity, which keeps a member register) gives notice
 * to its active voting members. A corporation gives notice to its voting
 * shareholders: holders of current share-register positions in a class that
 * carries votes, or, when no share register positions are recorded yet, the
 * current role holders recorded with the shareholder role. Shareholder contact
 * details come from the linked role-holder record; when it has none, the
 * coverage text says so instead of counting them as reachable.
 */

export type NoticeRecipient = {
  memberId?: string;
  roleHolderId?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  role?: string;
};

export type ShareholderNoticeSource = "share_register" | "shareholder_role_holders" | "none";

export type ShareholderNoticeAudience = {
  source: ShareholderNoticeSource;
  recipients: NoticeRecipient[];
};

type Row = Record<string, any>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Single-line mailing address from a role holder's address fields. */
export function roleHolderMailingAddress(row: Row | undefined): string | undefined {
  if (!row) return undefined;
  const street = [text(row.unit), text(row.street)].filter(Boolean).join(" ");
  const parts = [street, text(row.city), text(row.provinceState), text(row.postalCode), text(row.country)].filter(Boolean);
  return text(row.street) && parts.length > 0 ? parts.join(", ") : undefined;
}

function roleHolderRecipient(role: Row | undefined, fallbackName: string): NoticeRecipient {
  return {
    roleHolderId: role?._id ? String(role._id) : undefined,
    name: text(role?.fullName) ?? fallbackName,
    email: text(role?.email),
    phone: text(role?.phone),
    address: roleHolderMailingAddress(role),
    role: "Shareholder",
  };
}

/**
 * Voting shareholders from the share register (current positions in a class
 * with votes), falling back to current shareholder role holders when the
 * register has no positions yet.
 */
export function votingShareholderNoticeAudience(input: {
  classes?: Row[] | null;
  holdings?: Row[] | null;
  roleHolders?: Row[] | null;
}): ShareholderNoticeAudience {
  const classes = input.classes ?? [];
  const roleHolders = input.roleHolders ?? [];
  const roleById = new Map<string, Row>(roleHolders.map((row) => [String(row._id), row]));
  const holdings = (input.holdings ?? []).filter((row) => String(row.status ?? "current") === "current" && Number(row.quantity) > 0);

  if (holdings.length > 0) {
    const votesByClass = new Map<string, number>(
      classes.map((row) => [String(row._id), votesPerShareOf({ rightsClassId: String(row._id), votesPerShare: row.votesPerShare, votingRights: row.votingRights, classType: row.classType })]),
    );
    const votesByHolder = new Map<string, { votes: number; roleHolderId?: string }>();
    for (const holding of holdings) {
      const key = String(holding.holderKey ?? holding.holderRoleHolderId ?? "");
      if (!key) continue;
      const entry = votesByHolder.get(key) ?? { votes: 0 };
      entry.votes += Number(holding.quantity) * (votesByClass.get(String(holding.rightsClassId)) ?? 0);
      const roleHolderId = holding.holderRoleHolderId
        ? String(holding.holderRoleHolderId)
        : key.startsWith("roleHolder:") ? key.slice("roleHolder:".length) : undefined;
      if (roleHolderId) entry.roleHolderId = roleHolderId;
      votesByHolder.set(key, entry);
    }
    const recipients = [...votesByHolder.entries()]
      .filter(([, entry]) => entry.votes > 0)
      .map(([key, entry]) => roleHolderRecipient(entry.roleHolderId ? roleById.get(entry.roleHolderId) : undefined, key.replace(/^(name|roleHolder):/, "")))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { source: "share_register", recipients };
  }

  const recorded = roleHolders
    .filter((row) => String(row.roleType) === "shareholder" && String(row.status ?? "current") === "current")
    .map((row) => roleHolderRecipient(row, "Shareholder"))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { source: recorded.length > 0 ? "shareholder_role_holders" : "none", recipients: recorded };
}

/** Active voting members, as the society notice has always used. */
export function votingMemberNoticeRecipients(members?: Row[] | null): NoticeRecipient[] {
  return (members ?? [])
    .filter((member) => member.status === "Active" && member.votingRights)
    .map((member) => ({
      memberId: String(member._id),
      name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
      email: text(member.email),
      phone: text(member.phone),
      address: text(member.address),
      role: member.membershipClass,
    }));
}

export type NoticeCoverageTone = "success" | "info" | "warn";

export type MeetingNoticeCoverage = {
  /** Whose notice the coverage measures. */
  basis: "members" | "shareholders";
  source: "member_register" | ShareholderNoticeSource;
  /** People entitled to notice under the basis above. */
  eligibleCount: number;
  /** Eligible recipients with neither an email nor a mailing address on file. */
  withoutContactCount: number;
  deliveredCount: number;
  recordedRecipientCount: number;
  noticeCoverage: number;
  value: string;
  detail: string;
  tone: NoticeCoverageTone;
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The "Notice coverage" summary for an annual meeting. Society output is
 * unchanged from the members-table count the AGM workflow always showed.
 */
export function meetingNoticeCoverage(input: {
  organization?: LegalEntityLike | null;
  members?: Row[] | null;
  shareholders?: ShareholderNoticeAudience | null;
  deliveries?: Row[] | null;
  recordedRecipientCount?: number | null;
}): MeetingNoticeCoverage {
  const deliveredCount = (input.deliveries ?? []).filter((delivery) => delivery.status !== "bounced" && delivery.status !== "failed").length;
  const recordedRecipientCount = Number(input.recordedRecipientCount ?? 0) || 0;
  const noticeCoverage = Math.max(deliveredCount, recordedRecipientCount);
  const baseDetail = [
    `${plural(deliveredCount, "delivery record")} logged`,
    recordedRecipientCount ? `the workflow records ${plural(recordedRecipientCount, "recipient")}` : "",
  ];
  const toneFor = (eligible: number): NoticeCoverageTone =>
    eligible > 0 && noticeCoverage >= eligible ? (deliveredCount >= eligible ? "success" : "info") : "warn";

  if (!organizationRuleScope(input.organization).isCorporation) {
    const voting = votingMemberNoticeRecipients(input.members);
    const eligibleCount = voting.length;
    return {
      basis: "members",
      source: "member_register",
      eligibleCount,
      withoutContactCount: voting.filter((row) => !row.email && !row.address).length,
      deliveredCount,
      recordedRecipientCount,
      noticeCoverage,
      value: eligibleCount ? `${noticeCoverage} notified · ${plural(eligibleCount, "voting member")}` : "No voting member register",
      detail: baseDetail.filter(Boolean).join("; "),
      tone: toneFor(eligibleCount),
    };
  }

  const audience = input.shareholders ?? { source: "none" as const, recipients: [] };
  const eligibleCount = audience.recipients.length;
  const withoutContactCount = audience.recipients.filter((row) => !row.email && !row.address).length;
  const sourceNote =
    audience.source === "share_register"
      ? "voting shareholders come from the share register"
      : audience.source === "shareholder_role_holders"
        ? "no share register positions yet, so shareholders come from the shareholder role holders"
        : "";
  const contactNote = withoutContactCount
    ? `${plural(withoutContactCount, "shareholder")} ${withoutContactCount === 1 ? "has" : "have"} no email or mailing address on file; record notice given to ${withoutContactCount === 1 ? "that shareholder" : "them"} outside Societyer`
    : "";
  return {
    basis: "shareholders",
    source: audience.source,
    eligibleCount,
    withoutContactCount,
    deliveredCount,
    recordedRecipientCount,
    noticeCoverage,
    value: eligibleCount
      ? `${noticeCoverage} notified · ${plural(eligibleCount, "voting shareholder")}`
      : audience.source === "share_register"
        ? "No voting shares in the share register"
        : "No shareholders recorded",
    detail: [...baseDetail, sourceNote, contactNote].filter(Boolean).join("; "),
    tone: toneFor(eligibleCount),
  };
}
