import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DataTable } from "../components/DataTable";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { Mail, Plus, Send, Settings2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { formatDateTime } from "../lib/format";
import { StructuredAddressTextFields } from "../components/StructuredAddressFields";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableEmpty,
  useObjectRecordTableData,
  useRecordTableState,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Distinguishes "genuinely zero records" from "filters/search narrowed a
 * non-empty set to zero" so we don't tell someone to "clear filters" when
 * there's nothing to clear. Must render inside a <RecordTableScope>.
 */
function CommunicationsEmptyState({
  hasAnyRecords,
  labelPlural,
  createHint,
}: {
  hasAnyRecords: boolean;
  labelPlural: string;
  createHint: string;
}) {
  const filters = useRecordTableState((s) => s.filters);
  const searchTerm = useRecordTableState((s) => s.searchTerm);
  const isFiltered = filters.length > 0 || searchTerm.trim().length > 0;

  if (hasAnyRecords && isFiltered) {
    return (
      <RecordTableEmpty
        title={`No ${labelPlural} match your filters`}
        description="Try clearing your filters or search to see all records."
      />
    );
  }

  return (
    <RecordTableEmpty
      title={`No ${labelPlural} yet`}
      description={createHint}
    />
  );
}

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
  const confirm = useConfirm();
  const [templateDraft, setTemplateDraft] = useState<any | null>(null);
  const [segmentDraft, setSegmentDraft] = useState<any | null>(null);
  const [prefDraft, setPrefDraft] = useState<any | null>(null);
  const [sendDraft, setSendDraft] = useState<any | null>(null);
  const [templatesViewId, setTemplatesViewId] = useState<Id<"views"> | undefined>(undefined);
  const [templatesFilterOpen, setTemplatesFilterOpen] = useState(false);
  const [segmentsViewId, setSegmentsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [segmentsFilterOpen, setSegmentsFilterOpen] = useState(false);
  const [campaignsViewId, setCampaignsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [campaignsFilterOpen, setCampaignsFilterOpen] = useState(false);
  const [deliveriesViewId, setDeliveriesViewId] = useState<Id<"views"> | undefined>(undefined);
  const [deliveriesFilterOpen, setDeliveriesFilterOpen] = useState(false);
  const committeeDetail = useQuery(
    api.committees.detail,
    society && sendDraft?.audiencePreset === "committee" && sendDraft.audienceTarget
      ? { id: sendDraft.audienceTarget as any }
      : "skip",
  );

  const templatesTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "communicationTemplate", viewId: templatesViewId });
  const segmentsTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "communicationSegment", viewId: segmentsViewId });
  const campaignsTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "communicationCampaign", viewId: campaignsViewId });
  const deliveriesTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "communicationDelivery", viewId: deliveriesViewId });

  const templateRecords = useMemo(() => (templates ?? []) as any[], [templates]);
  const segmentRecords = useMemo(
    () =>
      (segments ?? []).map((row: any) => ({
        ...row,
        filters:
          [
            row.memberStatus ? `status=${row.memberStatus}` : "",
            row.membershipClass ? `class=${row.membershipClass}` : "",
            row.volunteerStatus ? `volunteer=${row.volunteerStatus}` : "",
            row.votingRightsOnly ? "voting only" : "",
            row.hasEmail ? "has email" : "",
            row.hasPhone ? "has phone" : "",
          ]
            .filter(Boolean)
            .join(" · ") || "No extra filters",
      })),
    [segments],
  );
  const campaignRecords = useMemo(
    () =>
      (campaigns ?? []).map((row: any) => ({
        ...row,
        counts: `${row.deliveredCount}/${row.memberCount} sent${row.bouncedCount ? ` · ${row.bouncedCount} issues` : ""}`,
        sentAtISO: row.sentAtISO ?? row.createdAtISO,
      })),
    [campaigns],
  );
  const deliveryRecords = useMemo(() => (deliveries ?? []) as any[], [deliveries]);

  if (society === undefined) return <PageLoading />;
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
            <MoreActionsMenu
              items={[
                {
                  id: "install-defaults",
                  label: "Install defaults",
                  icon: <Settings2 size={14} />,
                  onSelect: async () => {
                    const result = await ensureDefaults({ societyId: society._id });
                    toast.success(
                      result.created === 0
                        ? "Default templates already installed"
                        : `Installed ${result.created} default template${result.created === 1 ? "" : "s"}`,
                    );
                  },
                },
                {
                  id: "new-segment",
                  label: "New segment",
                  icon: <Plus size={14} />,
                  onSelect: () =>
                    setSegmentDraft({
                      societyId: society._id,
                      name: "",
                      description: "",
                      includeAudience: "all_members",
                      votingRightsOnly: false,
                      hasEmail: false,
                      hasPhone: false,
                    }),
                },
                {
                  id: "new-template",
                  label: "New template",
                  icon: <Plus size={14} />,
                  onSelect: () =>
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
                    }),
                },
              ]}
            />
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

      {!templatesTable.loading && !templatesTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="template" />
      ) : templatesTable.objectMetadata ? (
        <RecordTableScope
          tableId="communicationTemplates"
          objectMetadata={templatesTable.objectMetadata}
          hydratedView={templatesTable.hydratedView}
          records={templateRecords}
          onRecordClick={(_recordId, record) => setTemplateDraft({ ...record, id: record._id })}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={templatesTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<Mail size={14} />}
            label="Templates"
            views={templatesTable.views}
            currentViewId={templatesViewId ?? templatesTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setTemplatesViewId(viewId as Id<"views">)}
            onOpenFilter={() => setTemplatesFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={templatesFilterOpen} onClose={() => setTemplatesFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={templatesTable.loading || templates === undefined}
            emptyState={
              <CommunicationsEmptyState
                hasAnyRecords={templateRecords.length > 0}
                labelPlural="templates"
                createHint="Create a template to get started."
              />
            }
            renderCell={({ record: row, field }) => {
              if (field.name === "name") return <strong>{row.name}</strong>;
              if (field.name === "kind") return <Badge>{row.kind}</Badge>;
              if (field.name === "channel") return <span className="cell-tag">{row.channel}</span>;
              if (field.name === "audience") return <span>{row.audience}</span>;
              if (field.name === "updatedAtISO") return <span className="mono">{formatDateTime(row.updatedAtISO)}</span>;
              return undefined;
            }}
            renderRowActions={(row) => (
              <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setTemplateDraft({ ...row, id: row._id }); }}>
                Edit
              </button>
            )}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!segmentsTable.loading && !segmentsTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="saved segment" />
      ) : segmentsTable.objectMetadata ? (
        <RecordTableScope
          tableId="communicationSegments"
          objectMetadata={segmentsTable.objectMetadata}
          hydratedView={segmentsTable.hydratedView}
          records={segmentRecords}
          onRecordClick={(_recordId, record) => setSegmentDraft({ ...record, id: record._id })}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={segmentsTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<Mail size={14} />}
            label="Saved segments"
            views={segmentsTable.views}
            currentViewId={segmentsViewId ?? segmentsTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setSegmentsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setSegmentsFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={segmentsFilterOpen} onClose={() => setSegmentsFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={segmentsTable.loading || segments === undefined}
            emptyState={
              <CommunicationsEmptyState
                hasAnyRecords={segmentRecords.length > 0}
                labelPlural="saved segments"
                createHint="Create a segment to get started."
              />
            }
            renderCell={({ record: row, field }) => {
              if (field.name === "name") return <strong>{row.name}</strong>;
              if (field.name === "includeAudience") return <Badge>{row.includeAudience}</Badge>;
              if (field.name === "filters") return <span className="muted">{row.filters}</span>;
              if (field.name === "updatedAtISO") return <span className="mono">{formatDateTime(row.updatedAtISO)}</span>;
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setSegmentDraft({ ...row, id: row._id }); }}>
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await removeSegment({ id: row._id });
                    toast.success("Segment removed");
                  }}
                >
                  Delete
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!campaignsTable.loading && !campaignsTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="campaign" />
      ) : campaignsTable.objectMetadata ? (
        <RecordTableScope
          tableId="communicationCampaigns"
          objectMetadata={campaignsTable.objectMetadata}
          hydratedView={campaignsTable.hydratedView}
          records={campaignRecords}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={campaignsTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<Send size={14} />}
            label="Campaign history"
            views={campaignsTable.views}
            currentViewId={campaignsViewId ?? campaignsTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setCampaignsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setCampaignsFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={campaignsFilterOpen} onClose={() => setCampaignsFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={campaignsTable.loading || campaigns === undefined}
            emptyState={
              <CommunicationsEmptyState
                hasAnyRecords={campaignRecords.length > 0}
                labelPlural="campaigns"
                createHint="Send a campaign to get started."
              />
            }
            renderCell={({ record: row, field }) => {
              if (field.name === "subject") return <strong>{row.subject}</strong>;
              if (field.name === "audience") return <span>{row.audience}</span>;
              if (field.name === "channel") return <Badge>{row.channel}</Badge>;
              if (field.name === "status") return (
                <Badge tone={row.status === "sent" ? "success" : row.status === "partial" ? "warn" : row.status === "failed" ? "danger" : "info"}>
                  {row.status}
                </Badge>
              );
              if (field.name === "counts") return <span className="mono">{row.counts}</span>;
              if (field.name === "sentAtISO") return <span className="mono">{formatDateTime(row.sentAtISO)}</span>;
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!deliveriesTable.loading && !deliveriesTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="delivery" />
      ) : deliveriesTable.objectMetadata ? (
        <RecordTableScope
          tableId="communicationDeliveries"
          objectMetadata={deliveriesTable.objectMetadata}
          hydratedView={deliveriesTable.hydratedView}
          records={deliveryRecords}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={deliveriesTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<Send size={14} />}
            label="Delivery log"
            views={deliveriesTable.views}
            currentViewId={deliveriesViewId ?? deliveriesTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setDeliveriesViewId(viewId as Id<"views">)}
            onOpenFilter={() => setDeliveriesFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={deliveriesFilterOpen} onClose={() => setDeliveriesFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={deliveriesTable.loading || deliveries === undefined}
            emptyState={
              <CommunicationsEmptyState
                hasAnyRecords={deliveryRecords.length > 0}
                labelPlural="deliveries"
                createHint="Send a campaign to generate delivery records."
              />
            }
            renderCell={({ record: row, field }) => {
              if (field.name === "recipientName") return (
                <div>
                  <strong>{row.recipientName}</strong>
                  <div className="muted mono" style={{ fontSize: 11 }}>{row.recipientEmail || row.recipientPhone || "No contact data"}</div>
                </div>
              );
              if (field.name === "channel") return <span className="cell-tag">{row.channel}</span>;
              if (field.name === "provider") return <span className="cell-tag">{row.provider}</span>;
              if (field.name === "status") return (
                <Badge tone={row.status === "sent" || row.status === "opened" ? "success" : row.status === "skipped" ? "warn" : row.status === "unsubscribed" ? "info" : "danger"}>
                  {row.status}
                </Badge>
              );
              if (field.name === "subject") return <span>{row.subject || "—"}</span>;
              if (field.name === "proofOfNotice") return <span className="mono">{row.proofOfNotice || "—"}</span>;
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      <DataTable
        label="Member contact preferences"
        icon={<Mail size={14} />}
        data={prefRows as any[]}
        rowKey={(row) => String(row.memberId)}
        searchPlaceholder="Search member or email…"
        emptyMessage="No active members yet — add a member to manage their contact preferences."
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
                <Select value={templateDraft.kind} onChange={(value) => setTemplateDraft({ ...templateDraft, kind: value })}
                  options={[
                    { value: "notice", label: "Notice" },
                    { value: "renewal", label: "Renewal" },
                    { value: "digest", label: "Digest" },
                    { value: "newsletter", label: "Newsletter" },
                  ]} />
              </Field>
              <Field label="Channel">
                <Select value={templateDraft.channel} onChange={(value) => setTemplateDraft({ ...templateDraft, channel: value })}
                  options={[
                    { value: "email", label: "Email" },
                    { value: "inApp", label: "In-app" },
                    { value: "sms", label: "SMS" },
                    { value: "mail", label: "Postal mail" },
                    { value: "manual", label: "Manual delivery" },
                  ]} />
              </Field>
            </div>
            <Field label="Audience">
              <Select value={templateDraft.audience} onChange={(value) => setTemplateDraft({ ...templateDraft, audience: value })}
                options={[
                  { value: "all_members", label: "All members" },
                  { value: "voting_members", label: "Voting members" },
                  { value: "directors", label: "Directors" },
                  { value: "overdue_subscribers", label: "Overdue subscribers" },
                  { value: "volunteers", label: "Volunteers" },
                ]} />
            </Field>
            <Field label="Subject"><input className="input" value={templateDraft.subject} onChange={(e) => setTemplateDraft({ ...templateDraft, subject: e.target.value })} /></Field>
            <Field label="Body"><MarkdownEditor rows={10} value={templateDraft.bodyText} onChange={(markdown) => setTemplateDraft({ ...templateDraft, bodyText: markdown })} /></Field>
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
            <Field label="Description"><MarkdownEditor rows={4} value={segmentDraft.description ?? ""} onChange={(markdown) => setSegmentDraft({ ...segmentDraft, description: markdown })} /></Field>
            <Field label="Base audience">
              <Select value={segmentDraft.includeAudience} onChange={(value) => setSegmentDraft({ ...segmentDraft, includeAudience: value })}
                options={[
                  { value: "all_members", label: "All members" },
                  { value: "voting_members", label: "Voting members" },
                  { value: "directors", label: "Directors" },
                  { value: "overdue_subscribers", label: "Overdue subscribers" },
                  { value: "volunteers", label: "Volunteers" },
                  { value: "custom", label: "Custom member subset" },
                ]} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Member status">
                <Select value={segmentDraft.memberStatus ?? ""} onChange={(value) => setSegmentDraft({ ...segmentDraft, memberStatus: value })}
                  options={[{ value: "", label: "Any" }, ...memberStatusOptions.map((value) => ({ value: value, label: value }))]} />
              </Field>
              <Field label="Member class">
                <Select value={segmentDraft.membershipClass ?? ""} onChange={(value) => setSegmentDraft({ ...segmentDraft, membershipClass: value })}
                  options={[{ value: "", label: "Any" }, ...memberClassOptions.map((value) => ({ value: value, label: value }))]} />
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
            <StructuredAddressTextFields value={prefDraft.postalAddress ?? ""} onChange={(postalAddress) => setPrefDraft({ ...prefDraft, postalAddress })} />
            <label className="checkbox"><input type="checkbox" checked={prefDraft.transactionalEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, transactionalEmailEnabled: e.target.checked })} /> Transactional email allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.noticeEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, noticeEmailEnabled: e.target.checked })} /> Formal notices allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.newsletterEmailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, newsletterEmailEnabled: e.target.checked })} /> Newsletter / CASL marketing consent</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.smsEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, smsEnabled: e.target.checked })} /> SMS allowed</label>
            <label className="checkbox"><input type="checkbox" checked={prefDraft.mailEnabled} onChange={(e) => setPrefDraft({ ...prefDraft, mailEnabled: e.target.checked })} /> Postal mail allowed</label>
            <Field label="Preferred channel">
              <Select value={prefDraft.preferredChannel} onChange={(value) => setPrefDraft({ ...prefDraft, preferredChannel: value })}
                options={[
                  { value: "email", label: "Email" },
                  { value: "sms", label: "SMS" },
                  { value: "mail", label: "Postal mail" },
                ]} />
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
                const recipientCount = audiencePreview ?? 0;
                if (!sendDraft.subject.trim() || !sendDraft.bodyText.trim()) {
                  toast.error("Add a subject and body before sending");
                  return;
                }
                const ok = await confirm({
                  title: "Send campaign?",
                  message: `This will send a ${sendDraft.channel} ${sendDraft.kind} campaign to about ${recipientCount} recipient${recipientCount === 1 ? "" : "s"} using audience "${buildAudienceValue(sendDraft)}". Review the subject and body before continuing.`,
                  confirmLabel: "Send campaign",
                  tone: "warn",
                });
                if (!ok) return;
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
              <Select
                value={sendDraft.templateId}
                onChange={(value) => {
                const next = (templates ?? []).find((template) => String(template._id) === value);
                  const nextAudience = parseAudienceValue(next?.audience ?? sendDraft.audiencePreset ?? "all_members");
                  setSendDraft({
                    ...sendDraft,
                    templateId: value,
                    audiencePreset: nextAudience.preset,
                    audienceTarget: nextAudience.target,
                    kind: next?.kind ?? sendDraft.kind,
                    channel: next?.channel ?? sendDraft.channel,
                    subject: next?.subject ?? sendDraft.subject,
                    bodyText: next?.bodyText ?? sendDraft.bodyText,
                  });
                }}
                options={[{ value: "", label: "No template" }, ...templateOptions.map((option) => ({ value: option.value, label: option.label }))]}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Audience">
                <Select
                  value={sendDraft.audiencePreset}
                  onChange={(value) =>
                    setSendDraft({
                      ...sendDraft,
                      audiencePreset: value,
                      audienceTarget: "",
                    })
                  }
                  options={[
                    { value: "all_members", label: "All members" },
                    { value: "voting_members", label: "Voting members" },
                    { value: "directors", label: "Directors" },
                    { value: "overdue_subscribers", label: "Overdue subscribers" },
                    { value: "volunteers", label: "Volunteers" },
                    { value: "segment", label: "Saved segment" },
                    { value: "committee", label: "Committee" },
                    { value: "member_class", label: "Member class" },
                    { value: "member_status", label: "Member status" },
                  ]}
                />
              </Field>
              <Field label="Channel">
                <Select value={sendDraft.channel} onChange={(value) => setSendDraft({ ...sendDraft, channel: value })}
                  options={[
                    { value: "email", label: "Email" },
                    { value: "inApp", label: "In-app" },
                    { value: "sms", label: "SMS" },
                    { value: "mail", label: "Postal mail" },
                    { value: "postal", label: "Postal queue" },
                    { value: "manual", label: "Manual delivery" },
                  ]} />
              </Field>
            </div>
            {sendDraft.audiencePreset === "committee" && (
              <Field label="Committee">
                <Select
                  value={sendDraft.audienceTarget}
                  onChange={(value) => setSendDraft({ ...sendDraft, audienceTarget: value })}
                  options={[{ value: "", label: "Select committee" }, ...(committees ?? []).map((committee) => ({ value: String(committee._id), label: committee.name }))]}
                />
              </Field>
            )}
            {sendDraft.audiencePreset === "segment" && (
              <Field label="Saved segment">
                <Select
                  value={sendDraft.audienceTarget}
                  onChange={(value) => setSendDraft({ ...sendDraft, audienceTarget: value })}
                  options={[{ value: "", label: "Select segment" }, ...segmentOptions.map((option) => ({ value: option.value, label: option.label }))]}
                />
              </Field>
            )}
            {sendDraft.audiencePreset === "member_class" && (
              <Field label="Member class">
                <Select
                  value={sendDraft.audienceTarget}
                  onChange={(value) => setSendDraft({ ...sendDraft, audienceTarget: value })}
                  options={[{ value: "", label: "Select class" }, ...memberClassOptions.map((value) => ({ value: value, label: value }))]}
                />
              </Field>
            )}
            {sendDraft.audiencePreset === "member_status" && (
              <Field label="Member status">
                <Select
                  value={sendDraft.audienceTarget}
                  onChange={(value) => setSendDraft({ ...sendDraft, audienceTarget: value })}
                  options={[{ value: "", label: "Select status" }, ...memberStatusOptions.map((value) => ({ value: value, label: value }))]}
                />
              </Field>
            )}
            <Field label="Kind">
              <Select value={sendDraft.kind} onChange={(value) => setSendDraft({ ...sendDraft, kind: value })}
                options={[
                  { value: "notice", label: "Notice" },
                  { value: "renewal", label: "Renewal" },
                  { value: "digest", label: "Digest" },
                  { value: "newsletter", label: "Newsletter" },
                ]} />
            </Field>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Estimated recipients: {audiencePreview ?? 0}
            </div>
            <Field label="Subject"><input className="input" value={sendDraft.subject} onChange={(e) => setSendDraft({ ...sendDraft, subject: e.target.value })} /></Field>
            <Field label="Body"><MarkdownEditor rows={10} value={sendDraft.bodyText} onChange={(markdown) => setSendDraft({ ...sendDraft, bodyText: markdown })} /></Field>
            {selectedSendTemplate?.kind === "newsletter" && (
              <Field label="Custom newsletter message">
                <MarkdownEditor rows={4} value={sendDraft.customMessage ?? ""} onChange={(markdown) => setSendDraft({ ...sendDraft, customMessage: markdown })} />
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
