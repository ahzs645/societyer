import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { Mail, Plus, Send, Settings2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDateTime } from "../lib/format";

type AudiencePreset =
  | "all_members"
  | "voting_members"
  | "directors"
  | "overdue_subscribers"
  | "volunteers"
  | "segment"
  | "committee"
  | "member_class"
  | "member_status";

function parseAudienceValue(audience: string): { preset: AudiencePreset; target: string } {
  if (audience.startsWith("segment:")) return { preset: "segment", target: audience.slice("segment:".length) };
  if (audience.startsWith("committee:")) return { preset: "committee", target: audience.slice("committee:".length) };
  if (audience.startsWith("member_class:")) return { preset: "member_class", target: audience.slice("member_class:".length) };
  if (audience.startsWith("member_status:")) return { preset: "member_status", target: audience.slice("member_status:".length) };
  if (
    [
      "all_members",
      "voting_members",
      "directors",
      "overdue_subscribers",
      "volunteers",
    ].includes(audience)
  ) {
    return { preset: audience as AudiencePreset, target: "" };
  }
  return { preset: "all_members", target: "" };
}

function buildAudienceValue(draft: any) {
  switch (draft.audiencePreset as AudiencePreset) {
    case "segment":
      return draft.audienceTarget ? `segment:${draft.audienceTarget}` : "segment:";
    case "committee":
      return draft.audienceTarget ? `committee:${draft.audienceTarget}` : "committee:";
    case "member_class":
      return draft.audienceTarget ? `member_class:${draft.audienceTarget}` : "member_class:";
    case "member_status":
      return draft.audienceTarget ? `member_status:${draft.audienceTarget}` : "member_status:";
    default:
      return draft.audiencePreset ?? "all_members";
  }
}

function estimateAudience(args: {
  audience: string;
  members: any[];
  directors: any[];
  subscriptions: any[];
  volunteers: any[];
  committees: any[];
  segments?: any[];
}) {
  const activeMembers = args.members.filter((member) => member.status === "Active");
  if (args.audience.startsWith("segment:")) {
    const segmentId = args.audience.slice("segment:".length);
    const segment = (args.segments ?? []).find((row: any) => String(row._id) === segmentId);
    if (!segment) return 0;
    const baseAudience =
      segment.includeAudience === "custom"
        ? "all_members"
        : segment.includeAudience;
    const volunteerByMemberId = new Map(
      args.volunteers
        .filter((volunteer) => volunteer.memberId)
        .map((volunteer) => [String(volunteer.memberId), volunteer]),
    );
    const baseCountSource =
      baseAudience === "directors"
        ? args.directors
            .filter((director) => director.status === "Active")
            .map((director) => ({
              member: args.members.find((member) => member._id === director.memberId),
              email: director.email,
              phone: undefined,
            }))
        : baseAudience === "volunteers"
          ? args.volunteers.map((volunteer) => ({
              member: volunteer.memberId
                ? args.members.find((member) => member._id === volunteer.memberId)
                : null,
              email: volunteer.email,
              phone: volunteer.phone,
            }))
          : activeMembers
              .filter((member) => {
                if (baseAudience === "voting_members") return member.votingRights;
                if (baseAudience === "overdue_subscribers") {
                  return args.subscriptions.some(
                    (subscription) =>
                      subscription.memberId === member._id &&
                      ["pending", "past_due"].includes(subscription.status),
                  );
                }
                return true;
              })
              .map((member) => ({
                member,
                email: member.email,
                phone: member.phone,
              }));
    return baseCountSource.filter((row) => {
      const member = row.member;
      const volunteer = member ? volunteerByMemberId.get(String(member._id)) : null;
      if (segment.memberStatus && String(member?.status ?? "") !== segment.memberStatus) return false;
      if (
        segment.membershipClass &&
        String(member?.membershipClass ?? "") !== segment.membershipClass
      ) {
        return false;
      }
      if (segment.votingRightsOnly && !member?.votingRights) return false;
      if (segment.hasEmail && !row.email) return false;
      if (segment.hasPhone && !row.phone) return false;
      if (
        segment.volunteerStatus &&
        String(volunteer?.status ?? "") !== segment.volunteerStatus
      ) {
        return false;
      }
      return true;
    }).length;
  }
  if (args.audience === "all_members") return activeMembers.length;
  if (args.audience === "voting_members") return activeMembers.filter((member) => member.votingRights).length;
  if (args.audience === "directors") return args.directors.filter((director) => director.status === "Active").length;
  if (args.audience === "overdue_subscribers") {
    return args.subscriptions.filter((subscription) => ["pending", "past_due"].includes(subscription.status)).length;
  }
  if (args.audience === "volunteers") return args.volunteers.length;
  if (args.audience.startsWith("committee:")) {
    const committeeId = args.audience.slice("committee:".length);
    const committee = args.committees.find((row: any) => String(row._id) === committeeId);
    return committee ? Number(committee.memberCount ?? committee.members?.length ?? 0) : 0;
  }
  if (args.audience.startsWith("member_class:")) {
    const className = args.audience.slice("member_class:".length);
    return activeMembers.filter((member) => String(member.membershipClass ?? "") === className).length;
  }
  if (args.audience.startsWith("member_status:")) {
    const status = args.audience.slice("member_status:".length);
    return args.members.filter((member) => String(member.status ?? "") === status).length;
  }
  return activeMembers.length;
}

export function CommunicationsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const templates = useQuery(
    api.communications.listTemplates,
    society ? { societyId: society._id } : "skip",
  );
  const campaigns = useQuery(
    api.communications.listCampaigns,
    society ? { societyId: society._id, limit: 50 } : "skip",
  );
  const segments = useQuery(
    api.communications.listSegments,
    society ? { societyId: society._id } : "skip",
  );
  const deliveries = useQuery(
    api.communications.listDeliveries,
    society ? { societyId: society._id, limit: 100 } : "skip",
  );
  const prefs = useQuery(
    api.communications.listMemberPrefs,
    society ? { societyId: society._id } : "skip",
  );
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  );
  const directors = useQuery(
    api.directors.list,
    society ? { societyId: society._id } : "skip",
  );
  const committees = useQuery(
    api.committees.list,
    society ? { societyId: society._id } : "skip",
  );
  const volunteers = useQuery(
    api.volunteers.list,
    society ? { societyId: society._id } : "skip",
  );
  const subscriptions = useQuery(
    api.subscriptions.allSubscriptions,
    society ? { societyId: society._id } : "skip",
  );
  const ensureDefaults = useMutation(api.communications.ensureDefaultTemplates);
  const upsertTemplate = useMutation(api.communications.upsertTemplate);
  const upsertSegment = useMutation(api.communications.upsertSegment);
  const removeSegment = useMutation(api.communications.removeSegment);
  const upsertPref = useMutation(api.communications.upsertMemberPref);
  const sendCampaign = useAction(api.communications.sendCampaign);
  const toast = useToast();
  const [templateDraft, setTemplateDraft] = useState<any | null>(null);
  const [segmentDraft, setSegmentDraft] = useState<any | null>(null);
  const [prefDraft, setPrefDraft] = useState<any | null>(null);
  const [sendDraft, setSendDraft] = useState<any | null>(null);
  const committeeDetail = useQuery(
    api.committees.detail,
    society && sendDraft?.audiencePreset === "committee" && sendDraft.audienceTarget
      ? { id: sendDraft.audienceTarget as any }
      : "skip",
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const prefByMemberId = new Map(
    (prefs ?? []).map((pref) => [String(pref.memberId), pref]),
  );

  const prefRows = (members ?? [])
    .filter((member) => member.status === "Active")
    .map((member) => {
      const pref = prefByMemberId.get(String(member._id));
      return {
        memberId: member._id,
        name: `${member.firstName} ${member.lastName}`,
        email: member.email ?? "",
        pref:
          pref ??
          ({
            email: member.email,
            phone: member.phone,
            postalAddress: member.address,
            transactionalEmailEnabled: true,
            noticeEmailEnabled: true,
            newsletterEmailEnabled: false,
            smsEnabled: false,
            mailEnabled: !!member.address,
            preferredChannel: "email",
          } as const),
      };
    });

  const sentCount = (deliveries ?? []).filter((row) => row.status === "sent" || row.status === "opened").length;
  const issueCount = (deliveries ?? []).filter((row) => ["failed", "bounced"].includes(row.status)).length;
  const suppressedCount = (deliveries ?? []).filter((row) => row.status === "skipped").length;

  const templateOptions = (templates ?? []).map((template) => ({
    value: String(template._id),
    label: template.name,
  }));
  const segmentOptions = (segments ?? []).map((segment) => ({
    value: String(segment._id),
    label: segment.name,
  }));

  const selectedSendTemplate = useMemo(
    () => (templates ?? []).find((template) => String(template._id) === sendDraft?.templateId),
    [templates, sendDraft?.templateId],
  );

  const memberClassOptions = useMemo(
    () =>
      [...new Set((members ?? []).map((member) => member.membershipClass).filter(Boolean))].sort() as string[],
    [members],
  );
  const memberStatusOptions = useMemo(
    () =>
      [...new Set((members ?? []).map((member) => member.status).filter(Boolean))].sort() as string[],
    [members],
  );

  const audiencePreview = useMemo(() => {
    if (!sendDraft) return null;
    const audience = buildAudienceValue(sendDraft);
    return estimateAudience({
      audience,
      members: members ?? [],
      directors: directors ?? [],
      subscriptions: subscriptions ?? [],
      volunteers: volunteers ?? [],
      segments: segments ?? [],
      committees:
        committeeDetail && sendDraft.audienceTarget
          ? [{ _id: sendDraft.audienceTarget, members: committeeDetail.members ?? [] }]
          : [],
    });
  }, [sendDraft, members, directors, subscriptions, volunteers, segments, committeeDetail]);

  return (
    <div className="page">
      <PageHeader
        title="Communications"
        icon={<Mail size={16} />}
        iconColor="orange"
        subtitle="Templated notices, campaign history, member contact preferences, and proof-of-notice delivery logs."
        actions={
          <>
            <button
              className="btn-action"
              onClick={async () => {
                const result = await ensureDefaults({ societyId: society._id });
                toast.success(
                  result.created === 0
                    ? "Default templates already installed"
                    : `Installed ${result.created} default template${result.created === 1 ? "" : "s"}`,
                );
              }}
            >
              <Settings2 size={12} /> Install defaults
            </button>
            <button
              className="btn-action"
              onClick={() =>
                setSegmentDraft({
                  societyId: society._id,
                  name: "",
                  description: "",
                  includeAudience: "all_members",
                  votingRightsOnly: false,
                  hasEmail: false,
                  hasPhone: false,
                })
              }
            >
              <Plus size={12} /> New segment
            </button>
            <button
              className="btn-action"
              onClick={() =>
                setTemplateDraft({
                  societyId: society._id,
                  name: "",
                  slug: "",
                  kind: "notice",
                  channel: "email",
                  audience: "all_members",
                  subject: "",
                  bodyText: "",
                  system: false,
                })
              }
            >
              <Plus size={12} /> New template
            </button>
            <button
              className="btn-action btn-action--primary"
              onClick={() =>
                {
                  const initialTemplate = templates?.[0];
                  const initialAudience = parseAudienceValue(initialTemplate?.audience ?? "all_members");
                  setSendDraft({
                    templateId: templateOptions[0]?.value ?? "",
                    audiencePreset: initialAudience.preset,
                    audienceTarget: initialAudience.target,
                    kind: "notice",
                    channel: "email",
                    subject: initialTemplate?.subject ?? "",
                    bodyText: initialTemplate?.bodyText ?? "",
                  });
                }
              }
            >
              <Send size={12} /> Send campaign
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Templates" value={String((templates ?? []).length)} />
        <Stat label="Campaigns" value={String((campaigns ?? []).length)} />
        <Stat label="Sent" value={String(sentCount)} />
        <Stat label="Issues" value={String(issueCount + suppressedCount)} tone={issueCount > 0 ? "danger" : "ok"} />
      </div>

      <DataTable
        label="Templates"
        icon={<Mail size={14} />}
        data={(templates ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search templates…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        columns={[
          { id: "name", header: "Name", sortable: true, accessor: (row) => row.name, render: (row) => <strong>{row.name}</strong> },
          { id: "kind", header: "Kind", sortable: true, accessor: (row) => row.kind, render: (row) => <Badge>{row.kind}</Badge> },
          { id: "channel", header: "Channel", sortable: true, accessor: (row) => row.channel, render: (row) => <span className="cell-tag">{row.channel}</span> },
          { id: "audience", header: "Audience", sortable: true, accessor: (row) => row.audience },
          { id: "updatedAtISO", header: "Updated", sortable: true, accessor: (row) => row.updatedAtISO, render: (row) => <span className="mono">{formatDateTime(row.updatedAtISO)}</span> },
        ]}
        renderRowActions={(row) => (
          <button className="btn btn--ghost btn--sm" onClick={() => setTemplateDraft({ ...row, id: row._id })}>
            Edit
          </button>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Saved segments"
        icon={<Mail size={14} />}
        data={(segments ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search saved segments…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        columns={[
          { id: "name", header: "Name", sortable: true, accessor: (row) => row.name, render: (row) => <strong>{row.name}</strong> },
          { id: "includeAudience", header: "Base audience", sortable: true, accessor: (row) => row.includeAudience, render: (row) => <Badge>{row.includeAudience}</Badge> },
          { id: "filters", header: "Filters", accessor: (row) => `${row.memberStatus ?? ""} ${row.membershipClass ?? ""} ${row.volunteerStatus ?? ""}`, render: (row) => (
            <span className="muted">
              {[
                row.memberStatus ? `status=${row.memberStatus}` : "",
                row.membershipClass ? `class=${row.membershipClass}` : "",
                row.volunteerStatus ? `volunteer=${row.volunteerStatus}` : "",
                row.votingRightsOnly ? "voting only" : "",
                row.hasEmail ? "has email" : "",
                row.hasPhone ? "has phone" : "",
              ].filter(Boolean).join(" · ") || "No extra filters"}
            </span>
          ) },
          { id: "updatedAtISO", header: "Updated", sortable: true, accessor: (row) => row.updatedAtISO, render: (row) => <span className="mono">{formatDateTime(row.updatedAtISO)}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setSegmentDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                await removeSegment({ id: row._id });
                toast.success("Segment removed");
              }}
            >
              Delete
            </button>
          </>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Campaign history"
        icon={<Send size={14} />}
        data={(campaigns ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search subject or audience…"
        defaultSort={{ columnId: "createdAtISO", dir: "desc" }}
        columns={[
          { id: "subject", header: "Subject", sortable: true, accessor: (row) => row.subject, render: (row) => <strong>{row.subject}</strong> },
          { id: "audience", header: "Audience", sortable: true, accessor: (row) => row.audience },
          { id: "channel", header: "Channel", sortable: true, accessor: (row) => row.channel, render: (row) => <Badge>{row.channel}</Badge> },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "sent" ? "success" : row.status === "partial" ? "warn" : row.status === "failed" ? "danger" : "info"}>
                {row.status}
              </Badge>
            ),
          },
          {
            id: "counts",
            header: "Results",
            accessor: (row) => row.deliveredCount,
            render: (row) => (
              <span className="mono">
                {row.deliveredCount}/{row.memberCount} sent
                {row.bouncedCount ? ` · ${row.bouncedCount} issues` : ""}
              </span>
            ),
          },
          { id: "sentAtISO", header: "Sent", sortable: true, accessor: (row) => row.sentAtISO ?? row.createdAtISO, render: (row) => <span className="mono">{formatDateTime(row.sentAtISO ?? row.createdAtISO)}</span> },
        ]}
      />

      <div className="spacer-6" />

      <DataTable
        label="Delivery log"
        icon={<Send size={14} />}
        data={(deliveries ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search recipient or subject…"
        defaultSort={{ columnId: "sentAtISO", dir: "desc" }}
        columns={[
          {
            id: "recipientName",
            header: "Recipient",
            sortable: true,
            accessor: (row) => row.recipientName,
            render: (row) => (
              <div>
                <strong>{row.recipientName}</strong>
                <div className="muted mono" style={{ fontSize: 11 }}>{row.recipientEmail || row.recipientPhone || "No contact data"}</div>
              </div>
            ),
          },
          { id: "channel", header: "Channel", sortable: true, accessor: (row) => row.channel, render: (row) => <span className="cell-tag">{row.channel}</span> },
          { id: "provider", header: "Provider", sortable: true, accessor: (row) => row.provider, render: (row) => <span className="cell-tag">{row.provider}</span> },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "sent" || row.status === "opened" ? "success" : row.status === "skipped" ? "warn" : row.status === "unsubscribed" ? "info" : "danger"}>
                {row.status}
              </Badge>
            ),
          },
          { id: "subject", header: "Subject", sortable: true, accessor: (row) => row.subject, render: (row) => <span>{row.subject || "—"}</span> },
          { id: "proofOfNotice", header: "Proof", sortable: true, accessor: (row) => row.proofOfNotice, render: (row) => <span className="mono">{row.proofOfNotice || "—"}</span> },
        ]}
      />

      <div className="spacer-6" />

      <DataTable
        label="Member contact preferences"
        icon={<Mail size={14} />}
        data={prefRows as any[]}
        rowKey={(row) => String(row.memberId)}
        searchPlaceholder="Search member or email…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        columns={[
          {
            id: "name",
            header: "Member",
            sortable: true,
            accessor: (row) => row.name,
            render: (row) => (
              <div>
                <strong>{row.name}</strong>
                <div className="muted mono" style={{ fontSize: 11 }}>{row.email || "No email on file"}</div>
              </div>
            ),
          },
          {
            id: "noticeEmailEnabled",
            header: "Notice",
            sortable: true,
            accessor: (row) => (row.pref.noticeEmailEnabled ? 1 : 0),
            render: (row) => <Badge tone={row.pref.noticeEmailEnabled ? "success" : "warn"}>{row.pref.noticeEmailEnabled ? "Enabled" : "Off"}</Badge>,
          },
          {
            id: "newsletterEmailEnabled",
            header: "Newsletter",
            sortable: true,
            accessor: (row) => (row.pref.newsletterEmailEnabled ? 1 : 0),
            render: (row) => <Badge tone={row.pref.newsletterEmailEnabled ? "success" : "warn"}>{row.pref.newsletterEmailEnabled ? "Enabled" : "Off"}</Badge>,
          },
          {
            id: "preferredChannel",
            header: "Preferred channel",
            sortable: true,
            accessor: (row) => row.pref.preferredChannel,
            render: (row) => <span className="cell-tag">{row.pref.preferredChannel}</span>,
          },
          {
            id: "mailEnabled",
            header: "Mail",
            sortable: true,
            accessor: (row) => (row.pref.mailEnabled ? 1 : 0),
            render: (row) => (
              <Badge tone={row.pref.mailEnabled ? "success" : "info"}>
                {row.pref.mailEnabled ? "Enabled" : "Off"}
              </Badge>
            ),
          },
        ]}
        renderRowActions={(row) => (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setPrefDraft({
                memberId: row.memberId,
                email: row.pref.email ?? row.email,
                phone: row.pref.phone ?? "",
                postalAddress: row.pref.postalAddress ?? "",
                transactionalEmailEnabled: row.pref.transactionalEmailEnabled,
                noticeEmailEnabled: row.pref.noticeEmailEnabled,
                newsletterEmailEnabled: row.pref.newsletterEmailEnabled,
                smsEnabled: row.pref.smsEnabled,
                mailEnabled: row.pref.mailEnabled ?? false,
                preferredChannel: row.pref.preferredChannel,
                memberName: row.name,
              })
            }
          >
            Edit
          </button>
        )}
      />

      <Drawer
        open={!!templateDraft}
        onClose={() => setTemplateDraft(null)}
        title={templateDraft?.id ? "Edit template" : "New template"}
        footer={
          <>
            <button className="btn" onClick={() => setTemplateDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertTemplate({ ...templateDraft, societyId: society._id });
                toast.success("Template saved");
                setTemplateDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {templateDraft && (
          <div>
            <Field label="Name"><input className="input" value={templateDraft.name} onChange={(e) => setTemplateDraft({ ...templateDraft, name: e.target.value })} /></Field>
            <Field label="Slug"><input className="input" value={templateDraft.slug} onChange={(e) => setTemplateDraft({ ...templateDraft, slug: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind">
                <select className="input" value={templateDraft.kind} onChange={(e) => setTemplateDraft({ ...templateDraft, kind: e.target.value })}>
                  <option value="notice">Notice</option>
                  <option value="renewal">Renewal</option>
                  <option value="digest">Digest</option>
                  <option value="newsletter">Newsletter</option>
                </select>
              </Field>
              <Field label="Channel">
                <select className="input" value={templateDraft.channel} onChange={(e) => setTemplateDraft({ ...templateDraft, channel: e.target.value })}>
                  <option value="email">Email</option>
                  <option value="inApp">In-app</option>
                  <option value="sms">SMS</option>
                  <option value="mail">Postal mail</option>
                  <option value="manual">Manual delivery</option>
                </select>
              </Field>
            </div>
            <Field label="Audience">
              <select className="input" value={templateDraft.audience} onChange={(e) => setTemplateDraft({ ...templateDraft, audience: e.target.value })}>
                <option value="all_members">All members</option>
                <option value="voting_members">Voting members</option>
                <option value="directors">Directors</option>
                <option value="overdue_subscribers">Overdue subscribers</option>
                <option value="volunteers">Volunteers</option>
              </select>
            </Field>
            <Field label="Subject"><input className="input" value={templateDraft.subject} onChange={(e) => setTemplateDraft({ ...templateDraft, subject: e.target.value })} /></Field>
            <Field label="Body"><textarea className="textarea" rows={10} value={templateDraft.bodyText} onChange={(e) => setTemplateDraft({ ...templateDraft, bodyText: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!segmentDraft}
        onClose={() => setSegmentDraft(null)}
        title={segmentDraft?.id ? "Edit segment" : "New segment"}
        footer={
          <>
            <button className="btn" onClick={() => setSegmentDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertSegment({
                  ...segmentDraft,
                  societyId: society._id,
                  description: segmentDraft.description || undefined,
                  memberStatus: segmentDraft.memberStatus || undefined,
                  membershipClass: segmentDraft.membershipClass || undefined,
                  volunteerStatus: segmentDraft.volunteerStatus || undefined,
                  votingRightsOnly: !!segmentDraft.votingRightsOnly,
                  hasEmail: !!segmentDraft.hasEmail,
                  hasPhone: !!segmentDraft.hasPhone,
                });
                toast.success("Segment saved");
                setSegmentDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {segmentDraft && (
          <div>
            <Field label="Name"><input className="input" value={segmentDraft.name} onChange={(e) => setSegmentDraft({ ...segmentDraft, name: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" rows={4} value={segmentDraft.description ?? ""} onChange={(e) => setSegmentDraft({ ...segmentDraft, description: e.target.value })} /></Field>
            <Field label="Base audience">
              <select className="input" value={segmentDraft.includeAudience} onChange={(e) => setSegmentDraft({ ...segmentDraft, includeAudience: e.target.value })}>
                <option value="all_members">All members</option>
                <option value="voting_members">Voting members</option>
                <option value="directors">Directors</option>
                <option value="overdue_subscribers">Overdue subscribers</option>
                <option value="volunteers">Volunteers</option>
                <option value="custom">Custom member subset</option>
              </select>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Member status">
                <select className="input" value={segmentDraft.memberStatus ?? ""} onChange={(e) => setSegmentDraft({ ...segmentDraft, memberStatus: e.target.value })}>
                  <option value="">Any</option>
                  {memberStatusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Member class">
                <select className="input" value={segmentDraft.membershipClass ?? ""} onChange={(e) => setSegmentDraft({ ...segmentDraft, membershipClass: e.target.value })}>
                  <option value="">Any</option>
                  {memberClassOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Volunteer status">
              <input className="input" value={segmentDraft.volunteerStatus ?? ""} onChange={(e) => setSegmentDraft({ ...segmentDraft, volunteerStatus: e.target.value })} placeholder="Active, Applied, Paused…" />
            </Field>
            <label className="checkbox"><input type="checkbox" checked={!!segmentDraft.votingRightsOnly} onChange={(e) => setSegmentDraft({ ...segmentDraft, votingRightsOnly: e.target.checked })} /> Require voting rights</label>
            <label className="checkbox"><input type="checkbox" checked={!!segmentDraft.hasEmail} onChange={(e) => setSegmentDraft({ ...segmentDraft, hasEmail: e.target.checked })} /> Require email</label>
            <label className="checkbox"><input type="checkbox" checked={!!segmentDraft.hasPhone} onChange={(e) => setSegmentDraft({ ...segmentDraft, hasPhone: e.target.checked })} /> Require phone</label>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!prefDraft}
        onClose={() => setPrefDraft(null)}
        title={`Contact preferences · ${prefDraft?.memberName ?? ""}`}
        footer={
          <>
            <button className="btn" onClick={() => setPrefDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertPref({
                  societyId: society._id,
                  memberId: prefDraft.memberId,
                  email: prefDraft.email || undefined,
                  phone: prefDraft.phone || undefined,
                  postalAddress: prefDraft.postalAddress || undefined,
                  transactionalEmailEnabled: prefDraft.transactionalEmailEnabled,
                  noticeEmailEnabled: prefDraft.noticeEmailEnabled,
                  newsletterEmailEnabled: prefDraft.newsletterEmailEnabled,
                  smsEnabled: prefDraft.smsEnabled,
                  mailEnabled: prefDraft.mailEnabled,
                  preferredChannel: prefDraft.preferredChannel,
                });
                toast.success("Preferences saved");
                setPrefDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {prefDraft && (
          <div>
            <Field label="Email"><input className="input" value={prefDraft.email ?? ""} onChange={(e) => setPrefDraft({ ...prefDraft, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={prefDraft.phone ?? ""} onChange={(e) => setPrefDraft({ ...prefDraft, phone: e.target.value })} /></Field>
            <Field label="Postal address"><textarea className="textarea" rows={4} value={prefDraft.postalAddress ?? ""} onChange={(e) => setPrefDraft({ ...prefDraft, postalAddress: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.transactionalEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, transactionalEmailEnabled: e.target.checked })} /> Transactional email allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.noticeEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, noticeEmailEnabled: e.target.checked })} /> Formal notices allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.newsletterEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, newsletterEmailEnabled: e.target.checked })} /> Newsletter / CASL marketing consent</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.smsEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, smsEnabled: e.target.checked })} /> SMS allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.mailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, mailEnabled: e.target.checked })} /> Postal mail allowed</label>
            <Field label="Preferred channel">
              <select className="input" value={prefDraft.preferredChannel} onChange={(e) => setPrefDraft({ ...prefDraft, preferredChannel: e.target.value })}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="mail">Postal mail</option>
              </select>
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!sendDraft}
        onClose={() => setSendDraft(null)}
        title="Send campaign"
        footer={
          <>
            <button className="btn" onClick={() => setSendDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={
                !!sendDraft &&
                ["segment", "committee", "member_class", "member_status"].includes(sendDraft.audiencePreset) &&
                !sendDraft.audienceTarget
              }
              onClick={async () => {
                const result = await sendCampaign({
                  societyId: society._id,
                  templateId: sendDraft.templateId || undefined,
                  audience: buildAudienceValue(sendDraft),
                  kind: sendDraft.kind,
                  channel: sendDraft.channel,
                  subject: sendDraft.subject,
                  bodyText: sendDraft.bodyText,
                  customMessage: sendDraft.customMessage || undefined,
                  actingUserId,
                });
                toast.success(
                  result.bouncedCount
                    ? `Sent ${result.deliveredCount} with ${result.bouncedCount} issue(s)`
                    : `Sent ${result.deliveredCount} delivery${result.deliveredCount === 1 ? "" : "ies"}`,
                );
                setSendDraft(null);
              }}
            >
              Send
            </button>
          </>
        }
      >
        {sendDraft && (
          <div>
            <Field label="Template">
              <select
                className="input"
                value={sendDraft.templateId}
                onChange={(e) => {
                const next = (templates ?? []).find((template) => String(template._id) === e.target.value);
                  const nextAudience = parseAudienceValue(next?.audience ?? sendDraft.audiencePreset ?? "all_members");
                  setSendDraft({
                    ...sendDraft,
                    templateId: e.target.value,
                    audiencePreset: nextAudience.preset,
                    audienceTarget: nextAudience.target,
                    kind: next?.kind ?? sendDraft.kind,
                    channel: next?.channel ?? sendDraft.channel,
                    subject: next?.subject ?? sendDraft.subject,
                    bodyText: next?.bodyText ?? sendDraft.bodyText,
                  });
                }}
              >
                <option value="">No template</option>
                {templateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Audience">
                <select
                  className="input"
                  value={sendDraft.audiencePreset}
                  onChange={(e) =>
                    setSendDraft({
                      ...sendDraft,
                      audiencePreset: e.target.value,
                      audienceTarget: "",
                    })
                  }
                >
                  <option value="all_members">All members</option>
                  <option value="voting_members">Voting members</option>
                  <option value="directors">Directors</option>
                  <option value="overdue_subscribers">Overdue subscribers</option>
                  <option value="volunteers">Volunteers</option>
                  <option value="segment">Saved segment</option>
                  <option value="committee">Committee</option>
                  <option value="member_class">Member class</option>
                  <option value="member_status">Member status</option>
                </select>
              </Field>
              <Field label="Channel">
                <select className="input" value={sendDraft.channel} onChange={(e) => setSendDraft({ ...sendDraft, channel: e.target.value })}>
                  <option value="email">Email</option>
                  <option value="inApp">In-app</option>
                  <option value="sms">SMS</option>
                  <option value="mail">Postal mail</option>
                  <option value="postal">Postal queue</option>
                  <option value="manual">Manual delivery</option>
                </select>
              </Field>
            </div>
            {sendDraft.audiencePreset === "committee" && (
              <Field label="Committee">
                <select
                  className="input"
                  value={sendDraft.audienceTarget}
                  onChange={(e) => setSendDraft({ ...sendDraft, audienceTarget: e.target.value })}
                >
                  <option value="">Select committee</option>
                  {(committees ?? []).map((committee) => (
                    <option key={committee._id} value={String(committee._id)}>
                      {committee.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {sendDraft.audiencePreset === "segment" && (
              <Field label="Saved segment">
                <select
                  className="input"
                  value={sendDraft.audienceTarget}
                  onChange={(e) => setSendDraft({ ...sendDraft, audienceTarget: e.target.value })}
                >
                  <option value="">Select segment</option>
                  {segmentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {sendDraft.audiencePreset === "member_class" && (
              <Field label="Member class">
                <select
                  className="input"
                  value={sendDraft.audienceTarget}
                  onChange={(e) => setSendDraft({ ...sendDraft, audienceTarget: e.target.value })}
                >
                  <option value="">Select class</option>
                  {memberClassOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {sendDraft.audiencePreset === "member_status" && (
              <Field label="Member status">
                <select
                  className="input"
                  value={sendDraft.audienceTarget}
                  onChange={(e) => setSendDraft({ ...sendDraft, audienceTarget: e.target.value })}
                >
                  <option value="">Select status</option>
                  {memberStatusOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Kind">
              <select className="input" value={sendDraft.kind} onChange={(e) => setSendDraft({ ...sendDraft, kind: e.target.value })}>
                <option value="notice">Notice</option>
                <option value="renewal">Renewal</option>
                <option value="digest">Digest</option>
                <option value="newsletter">Newsletter</option>
              </select>
            </Field>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Estimated recipients: {audiencePreview ?? 0}
            </div>
            <Field label="Subject"><input className="input" value={sendDraft.subject} onChange={(e) => setSendDraft({ ...sendDraft, subject: e.target.value })} /></Field>
            <Field label="Body"><textarea className="textarea" rows={10} value={sendDraft.bodyText} onChange={(e) => setSendDraft({ ...sendDraft, bodyText: e.target.value })} /></Field>
            {selectedSendTemplate?.kind === "newsletter" && (
              <Field label="Custom newsletter message">
                <textarea className="textarea" rows={4} value={sendDraft.customMessage ?? ""} onChange={(e) => setSendDraft({ ...sendDraft, customMessage: e.target.value })} />
              </Field>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone === "danger" ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
    </div>
  );
}
