import { organizationRuleScope } from "./entityRuleScope";
import type { LegalEntityLike } from "./organizationDomain";
import { explicitVotesPerShare } from "./shareholderElectorate";

/** Entitlement and recorded dispatch are separate facts. See MTG-1/2 research. */
export type NoticeRecipient = {
  recipientKey?: string;
  memberId?: string;
  roleHolderId?: string;
  directorId?: string;
  auditorAppointmentId?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  role?: string;
};
export type ShareholderNoticeSource = "share_register" | "shareholder_role_holders" | "none";
export type ShareholderNoticeAudience = { source: ShareholderNoticeSource; recipients: NoticeRecipient[]; issues?: string[] };
type Row = Record<string, any>;
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

export function roleHolderMailingAddress(row: Row | undefined): string | undefined {
  if (!row) return undefined;
  const street = [text(row.unit), text(row.street)].filter(Boolean).join(" ");
  return text(row.street) ? [street, text(row.city), text(row.provinceState), text(row.postalCode), text(row.country)].filter(Boolean).join(", ") : undefined;
}

/** A statutory auditor is different from an accountant engaged only to compile/review. */
export function auditorNoticeRecipients(auditors?: Row[] | null): NoticeRecipient[] {
  return (auditors ?? []).filter((row) => row.status === "Active" && row.engagementType === "Audit").map((row) => ({
    recipientKey: `auditor:${row._id}`, auditorAppointmentId: String(row._id), name: text(row.firmName) ?? "Appointed auditor",
    email: text(row.email), address: text(row.address), role: "Auditor",
  }));
}

export function directorNoticeRecipients(directors?: Row[] | null, roleHolders?: Row[] | null): NoticeRecipient[] {
  const rows: NoticeRecipient[] = (directors ?? []).filter((row) => row.status === "Active").map((row) => ({
    recipientKey: `director:${row._id}`, directorId: String(row._id), name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
    email: text(row.email), phone: text(row.phone), address: text(row.address), role: "Director",
  }));
  for (const role of roleHolders ?? []) {
    if (role.roleType !== "director" || String(role.status ?? "current") !== "current") continue;
    // A verified directory link can identify the same director across registers.
    if (role.directoryPersonId && (directors ?? []).some((row) => row.status === "Active" && row.directoryPersonId === role.directoryPersonId)) continue;
    rows.push({ recipientKey: `roleHolder:${role._id}`, roleHolderId: String(role._id), name: text(role.fullName) ?? "Director", email: text(role.email), phone: text(role.phone), address: roleHolderMailingAddress(role), role: "Director" });
  }
  return rows;
}

/**
 * Directors can be recorded in the `directors` table, as current director role
 * holders, or both. A verified directory link identifies the same person in both
 * registers. When both registers hold directors and any entry lacks a match, the
 * registers disagree and an exact board electorate cannot be frozen.
 */
export function directorRegisterComparison(directors?: Row[] | null, roleHolders?: Row[] | null) {
  const active = (directors ?? []).filter((row) => row.status === "Active");
  const current = (roleHolders ?? []).filter((row) => row.roleType === "director" && String(row.status ?? "current") === "current");
  if (!active.length || !current.length) return { agree: true, directorsOnly: 0, roleHoldersOnly: 0 };
  const directorLinks = new Set(active.map((row) => row.directoryPersonId).filter(Boolean).map(String));
  const roleLinks = new Set(current.map((row) => row.directoryPersonId).filter(Boolean).map(String));
  const directorsOnly = active.filter((row) => !row.directoryPersonId || !roleLinks.has(String(row.directoryPersonId))).length;
  const roleHoldersOnly = current.filter((row) => !row.directoryPersonId || !directorLinks.has(String(row.directoryPersonId))).length;
  return { agree: directorsOnly === 0 && roleHoldersOnly === 0, directorsOnly, roleHoldersOnly };
}

/** Shareholders with votes, as counted by the share-register voting summary. */
export function votingHolderRecipients(voting: readonly { holderKey: string; holderName?: string }[], roleHolders?: Row[] | null): NoticeRecipient[] {
  const byRole = new Map((roleHolders ?? []).map((row) => [String(row._id), row]));
  return voting.map((holder) => {
    const id = holder.holderKey.startsWith("roleHolder:") ? holder.holderKey.slice("roleHolder:".length) : undefined;
    const role = id ? byRole.get(id) : undefined;
    return { recipientKey: role ? `roleHolder:${role._id}` : holder.holderKey, roleHolderId: role ? String(role._id) : undefined,
      name: text(role?.fullName) ?? holder.holderName ?? holder.holderKey, email: text(role?.email), phone: text(role?.phone),
      address: roleHolderMailingAddress(role), role: "Shareholder" };
  });
}

/**
 * CBCA/OBCA general meeting notices: voting shareholders, directors and auditor.
 * BC BCA s.169 uses entitlement to attend: include all registered holders for
 * review instead of silently excluding a non-voting class that can attend.
 * Special class-vote rights and the statutory record date still need review.
 * Legacy shareholder-role fallback is explicitly incomplete.
 */
export function votingShareholderNoticeAudience(input: {
  organization?: LegalEntityLike | null; classes?: Row[] | null; holdings?: Row[] | null;
  roleHolders?: Row[] | null; directors?: Row[] | null; auditors?: Row[] | null;
}): ShareholderNoticeAudience {
  const roles = input.roleHolders ?? [];
  const byRole = new Map(roles.map((row) => [String(row._id), row]));
  const byClass = new Map((input.classes ?? []).map((row) => [String(row._id), row]));
  const scope = organizationRuleScope(input.organization);
  const includeAttendanceClasses = scope.isCorporation && scope.jurisdictionCode === "CA-BC";
  const holdings = (input.holdings ?? []).filter((row) => String(row.status ?? "current") === "current" && Number(row.quantity) > 0);
  const recipients = new Map<string, NoticeRecipient>();
  const issues = new Set<string>();
  let source: ShareholderNoticeSource = "none";
  const addHolder = (role: Row | undefined, key: string, name?: string) => {
    const identity = role?._id ? `roleHolder:${role._id}` : key;
    if (!role) issues.add("Some shareholders need a verified register identity and contact details.");
    recipients.set(identity, { recipientKey: identity, roleHolderId: role?._id ? String(role._id) : undefined,
      name: text(role?.fullName) ?? name ?? key.replace(/^(name|roleHolder):/, ""), email: text(role?.email), phone: text(role?.phone), address: roleHolderMailingAddress(role), role: "Shareholder" });
  };
  if (holdings.length) {
    source = "share_register";
    for (const holding of holdings) {
      const cls = byClass.get(String(holding.rightsClassId));
      const votes = cls ? explicitVotesPerShare(cls) : undefined;
      if (votes === undefined) issues.add("Review missing or ambiguous class voting and attendance rights before certifying the notice audience.");
      if (!includeAttendanceClasses && votes === 0) continue;
      const key = String(holding.holderKey ?? (holding.holderRoleHolderId ? `roleHolder:${holding.holderRoleHolderId}` : ""));
      const id = holding.holderRoleHolderId ? String(holding.holderRoleHolderId) : key.startsWith("roleHolder:") ? key.slice(11) : undefined;
      if (!key) { issues.add("A share holding has no identified recipient."); continue; }
      addHolder(id ? byRole.get(id) : undefined, key, holding.holderName);
    }
  } else {
    const shareholders = roles.filter((row) => row.roleType === "shareholder" && String(row.status ?? "current") === "current");
    if (shareholders.length) source = "shareholder_role_holders";
    shareholders.forEach((row) => addHolder(row, `roleHolder:${row._id}`));
    issues.add("The share register must establish who is entitled to notice at the applicable record date; role labels alone do not establish entitlement.");
  }
  for (const recipient of [...directorNoticeRecipients(input.directors, roles), ...auditorNoticeRecipients(input.auditors)]) {
    const key = recipient.recipientKey!;
    const existing = recipients.get(key);
    recipients.set(key, existing ? { ...existing, role: `${existing.role}, ${recipient.role}` } : recipient);
  }
  return { source, recipients: [...recipients.values()].sort((a, b) => a.name.localeCompare(b.name)), issues: [...issues] };
}

/** BC Societies Act s.77: all members, including non-voting members. */
export function allMemberNoticeRecipients(members?: Row[] | null): NoticeRecipient[] {
  return (members ?? []).filter((row) => row.status === "Active").map((row) => ({
    recipientKey: `member:${row._id}`, memberId: String(row._id), name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
    email: text(row.email), phone: text(row.phone), address: text(row.address), role: row.membershipClass,
  }));
}
/** @deprecated Kept for existing callers; the legal society audience is every member. */
export const votingMemberNoticeRecipients = allMemberNoticeRecipients;

export type NoticeCoverageTone = "success" | "info" | "warn";
export type MeetingNoticeCoverage = {
  basis: "members" | "shareholders"; source: "member_register" | ShareholderNoticeSource;
  eligibleCount: number; withoutContactCount: number; deliveredCount: number; recordedRecipientCount: number;
  noticeCoverage: number; value: string; detail: string; tone: NoticeCoverageTone;
};
function identityKeys(row: Row): string[] {
  return [row.recipientKey, row.memberId ? `member:${row.memberId}` : undefined,
    row.roleHolderId ? `roleHolder:${row.roleHolderId}` : undefined,
    row.directorId ? `director:${row.directorId}` : undefined,
    row.auditorAppointmentId ? `auditor:${row.auditorAppointmentId}` : undefined].filter(Boolean) as string[];
}
function emailKey(value: unknown) { return String(value ?? "").trim().toLowerCase(); }

/** Counts unique identified dispatches; queued, skipped, duplicate and anonymous counts never prove delivery. */
export function meetingNoticeCoverage(input: {
  organization?: LegalEntityLike | null; members?: Row[] | null; shareholders?: ShareholderNoticeAudience | null;
  additionalRecipients?: NoticeRecipient[]; deliveries?: Row[] | null; recordedRecipientCount?: number | null;
}): MeetingNoticeCoverage {
  const corporation = organizationRuleScope(input.organization).isCorporation;
  const audience = input.shareholders ?? { source: "none" as const, recipients: [] };
  const recipients = corporation ? audience.recipients : [...allMemberNoticeRecipients(input.members), ...(input.additionalRecipients ?? [])];
  const accepted = (input.deliveries ?? []).filter((row) => ["sent", "delivered", "opened", "acknowledged"].includes(String(row.status).toLowerCase()) && !row.bouncedAtISO);
  const delivered = new Set<number>();
  for (const record of accepted) {
    const keys = identityKeys(record);
    let matches = recipients.map((recipient, index) => ({ recipient, index })).filter(({ recipient }) => identityKeys(recipient).some((key) => keys.includes(key)));
    if (!keys.length && record.recipientEmail) {
      matches = recipients.map((recipient, index) => ({ recipient, index })).filter(({ recipient }) => emailKey(recipient.email) === emailKey(record.recipientEmail));
      if (matches.length !== 1) matches = []; // a shared inbox is not a shareholder identity
    }
    matches.forEach(({ index }) => delivered.add(index));
  }
  const eligibleCount = recipients.length;
  const deliveredCount = delivered.size;
  const recordedRecipientCount = Math.max(0, Number(input.recordedRecipientCount) || 0);
  const withoutContactCount = recipients.filter((row) => !row.email && !row.address).length;
  const issues = corporation ? audience.issues ?? [] : [];
  const pending = (input.deliveries ?? []).filter((row) => row.status === "queued").length;
  const notes = [
    `${deliveredCount} distinct recipients have dispatch evidence`,
    pending ? `${pending} queued records are still awaiting dispatch` : "",
    recordedRecipientCount ? `${recordedRecipientCount} manually reported recipients are retained separately from verified coverage` : "",
    withoutContactCount ? `${withoutContactCount} recipients have no email or mailing address recorded` : "",
    corporation ? "Review the meeting record date, class attendance rights, every director and the appointed auditor" : "Includes active non-voting members and the recorded appointed auditor",
    ...issues,
  ];
  return { basis: corporation ? "shareholders" : "members", source: corporation ? audience.source : "member_register", eligibleCount, withoutContactCount,
    deliveredCount, recordedRecipientCount, noticeCoverage: deliveredCount,
    value: eligibleCount ? `${deliveredCount} dispatched · ${eligibleCount} notice recipients` : "No notice audience established",
    detail: notes.filter(Boolean).join("; "), tone: eligibleCount > 0 && deliveredCount === eligibleCount && !issues.length ? "success" : "warn" };
}
