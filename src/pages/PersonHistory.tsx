import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { GitMerge, Plus, UserX, Users, Wrench } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecordQuery } from "@/hooks/useRecordQuery";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Modal";
import { Banner, Drawer, EmptyState, Field } from "@/components/ui";
import { Tabs } from "@/components/primitives";
import { Select } from "@/components/Select";
import { MoreActionsMenu } from "@/components/MoreActionsMenu";
import { UnsupportedDetailsBadge } from "@/components/UnsupportedDetailsBadge";
import { PersonOccurrenceReview } from "@/components/PersonRecordLinks";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { ContactsCard } from "../features/people/profile/ContactsTab";
import { HistoricalCard, HistoryCard, groupEvents } from "../features/people/profile/HistoryTab";
import { AliasesCard, MergesCard, RegistersCard } from "../features/people/profile/IdentityTab";
import { ObservationsCard } from "../features/people/profile/ObservationsTab";
import {
  MATCH_STATUSES,
  MatchStatusBadge,
  errorMessage,
  plural,
  type MergeRow,
  type Occurrence,
  type Overview,
  type OverviewPerson,
  type ProfileResult,
} from "../features/people/profile/shared";
import { sourceRoleLabel } from "../../shared/personHistory";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";

/** A page for a reader without people access: the header and why the page is empty. */
function PeopleAccessRequired({ title }: { title: string }) {
  return (
    <div className="page">
      <PageHeader title={title} />
      <Banner tone="info">Reviewing people and their source history needs people read access.</Banner>
    </div>
  );
}

/* --------------------------- people and history -------------------------- */

type RepairPreview = { count: number; examples: Array<{ id: string; title?: string; table: string }> };

/** P8: find and move history entries left behind by earlier re-links. */
function useRepairLostHistory(societyId: string) {
  const repair = useMutation(api.personHistory.repairOrphanedEvents);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const preview = (await repair({ societyId, dryRun: true })) as RepairPreview;
      if (!preview.count) {
        toast.info("No lost history found", "Every history entry is on the same person as its source occurrence.");
        return;
      }
      const ok = await confirm({
        title: `Move ${plural(preview.count, "history entry", "history entries")}?`,
        message: (
          <>
            <p>
              Earlier re-links moved these source occurrences to another person but left their history behind, so it was hidden on
              both profiles. They will move to the person the occurrence is linked to now.
            </p>
            <ul>
              {preview.examples.slice(0, 8).map((example) => <li key={example.id}>{example.title ?? example.table}</li>)}
            </ul>
          </>
        ),
        confirmLabel: "Move history",
      });
      if (!ok) return;
      const result = (await repair({ societyId, dryRun: false })) as { count: number };
      toast.success("History repaired", `${result.count} entries moved`);
    } catch (error) {
      toast.error("Repair failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

const REVIEW_FILTERS: Array<[string, string]> = [
  ["pending", "Needs review"],
  ["ambiguous", "Ambiguous names"],
  ["all", "All mentions"],
  ["verified", "Confirmed"],
  ["assumed", "Test assumptions"],
  ["not_person", "Organizations and headings"],
  ["named_fragment", "Headings with a known name"],
  ["rejected", "Rejected"],
];

function matchesReviewFilter(row: Occurrence, filter: string) {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return ["suggested", "unresolved", "assumed"].includes(row.matchStatus);
    case "ambiguous":
      return (row.candidates?.length ?? 0) > 1 && row.matchStatus !== "verified";
    case "named_fragment":
      return row.matchStatus === "not_person" && (row.namedPeople?.length ?? 0) > 0;
    default:
      return row.matchStatus === filter;
  }
}

type MentionRecord = Occurrence & { linkedProfile: string; sourceRole: string };
type ProfileSummaryRecord = OverviewPerson & { aliasText: string };

const MENTIONS_TABLE = staticRecordTable({
  id: "people-history:mentions",
  nameSingular: "personMention",
  namePlural: "personMentions",
  labelSingular: "Mention",
  labelPlural: "Mentions",
  labelIdentifierFieldName: "personName",
  fields: [
    { name: "personName", label: "Name as written", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "matchStatus", label: "Identity", fieldType: FIELD_TYPES.SELECT, size: 170, config: { options: MATCH_STATUSES } },
    { name: "linkedProfile", label: "Profile", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "observedDate", label: "Date", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "context", label: "Context", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "sourceRole", label: "Source role", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "affiliation", label: "Source affiliation", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
  ],
});

const PROFILES_TABLE = staticRecordTable({
  id: "people-history:profiles",
  nameSingular: "contactProfile",
  namePlural: "contactProfiles",
  labelSingular: "Profile",
  labelPlural: "Profiles",
  labelIdentifierFieldName: "fullName",
  routePath: "/app/people-directory",
  sorts: [{ field: "fullName", direction: "asc" }],
  fields: [
    { name: "fullName", label: "Name", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "aliasText", label: "Also known as", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "occurrences", label: "Mentions", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false } },
    { name: "unreviewed", label: "To review", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false, hideZero: true } },
  ],
});

const REVIEW_TABS = ["review", "profiles"] as const;
type ReviewTab = (typeof REVIEW_TABS)[number];

export function PersonReviewPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canRead = can("members:read");
  const canWrite = can("members:write");
  const data = useQuery(api.personHistory.overview, society && canRead ? { societyId: society._id } : "skip") as Overview | undefined;
  const navigate = useNavigate();
  const repair = useRepairLostHistory(society?._id ?? "");
  const [tab, setTab] = useUrlTab<ReviewTab>(REVIEW_TABS, "review");
  const [status, setStatus] = useState("pending");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (!society) return <SeedPrompt />;
  if (!loaded) return <PageLoading />;
  if (!canRead) return <PeopleAccessRequired title="People and source history" />;
  if (!data) return <PageLoading />;

  const reviewing = reviewId ? data.occurrences.find((row) => row._id === reviewId) : undefined;
  const tabItems = [
    { id: "review" as const, label: "Identity review", count: data.occurrences.filter((row) => matchesReviewFilter(row, status)).length },
    { id: "profiles" as const, label: "Profiles", count: data.people.length },
  ];

  return (
    <div className="page">
      <PageHeader
        title="People and source history"
        subtitle="Match names in meetings and rosters to contact profiles."
        info={
          <>
            <p>Contact profiles connect meeting attendance, notes, roles and affiliations found in source records.</p>
            <p>
              Each name found in a source is a mention. Confirm which profile it belongs to, or mark it as an organization or heading.
              Membership and voting rights are assessed separately.
            </p>
          </>
        }
        actions={
          <>
            {canWrite && (
              <button className="btn-action btn-action--primary" onClick={() => setCreateOpen(true)}>
                <Plus size={12} /> New contact
              </button>
            )}
            <MoreActionsMenu
              items={[
                {
                  id: "duplicates",
                  label: "Duplicates and merges",
                  icon: <GitMerge size={14} />,
                  onSelect: () => navigate("/app/people-directory?tab=duplicates"),
                },
                ...(canWrite
                  ? [{
                      id: "repair",
                      label: "Find history lost by earlier re-links",
                      icon: <Wrench size={14} />,
                      disabled: repair.busy,
                      onSelect: () => { void repair.run(); },
                    }]
                  : []),
              ]}
            />
          </>
        }
      />

      <Tabs<ReviewTab> value={tab} onChange={setTab} tabRoles ariaLabel="People and source history sections" items={tabItems} />

      <div role="tabpanel" aria-label={tabItems.find((item) => item.id === tab)?.label}>
        {tab === "review" && <MentionsTable data={data} status={status} onStatusChange={setStatus} onReview={setReviewId} />}
        {tab === "profiles" && <ContactProfilesTable people={data.people} />}
      </div>

      <Drawer
        open={Boolean(reviewing)}
        onClose={() => setReviewId(null)}
        title={reviewing ? `Review ${reviewing.personName}` : "Review mention"}
        footer={<button className="btn" onClick={() => setReviewId(null)}>Close</button>}
      >
        {reviewing && (
          <PersonOccurrenceReview
            key={reviewing._id + reviewing.matchStatus + (reviewing.personId ?? "")}
            row={reviewing}
            people={data.people}
          />
        )}
      </Drawer>

      <NewContactDrawer societyId={society._id} open={createOpen && canWrite} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/** Every name found in the sources, filtered by review state; a row opens its review. */
function MentionsTable({
  data,
  status,
  onStatusChange,
  onReview,
}: {
  data: Overview;
  status: string;
  onStatusChange: (status: string) => void;
  onReview: (occurrenceId: string) => void;
}) {
  const mentions = useMemo<MentionRecord[]>(() => {
    const names = new Map(data.people.map((person) => [person._id, person.fullName]));
    return data.occurrences
      .filter((row) => matchesReviewFilter(row, status))
      .map((row) => ({
        ...row,
        linkedProfile: row.personId ? names.get(row.personId) ?? "" : "",
        sourceRole: row.roleTitle ? sourceRoleLabel(row.roleTitle) : "",
      }));
  }, [data, status]);
  const filterOptions = REVIEW_FILTERS.map(([value, label]) => ({
    value,
    label: `${label} (${data.occurrences.filter((row) => matchesReviewFilter(row, value)).length})`,
  }));

  return (
    <RecordListTable<MentionRecord>
      table={MENTIONS_TABLE}
      tableId="people-history-mentions"
      label="Mentions"
      icon={<Users size={14} />}
      records={mentions}
      showTotals={false}
      onOpen={(row) => onReview(row._id)}
      toolbarActions={
        <Select
          size="sm"
          aria-label="Identity review filter"
          value={status}
          onChange={onStatusChange}
          options={filterOptions}
          style={{ width: "auto" }}
        />
      }
      renderCell={({ record, field }) => {
        if (field.name === "personName") return <strong>{record.personName}</strong>;
        if (field.name === "matchStatus") return <MatchStatusBadge status={record.matchStatus} />;
        if (field.name === "linkedProfile") {
          return record.personId
            ? <Link to={`/app/people-directory/${record.personId}`}>{record.linkedProfile || "Profile"}</Link>
            : <span className="muted">None</span>;
        }
        if (field.name === "observedDate") return <span>{record.observedDate || "Date unknown"}</span>;
        return undefined;
      }}
      renderRowActions={(row) => (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onReview(row._id)}>
          Review
        </button>
      )}
      renderPhoneCard={(row, { open, selecting }) => (
        <RecordTablePhoneCard
          title={row.personName}
          badge={<MatchStatusBadge status={row.matchStatus} />}
          meta={[row.observedDate || "Date unknown", row.context]}
          detail={[row.linkedProfile]}
          onOpen={open}
          selecting={selecting}
        />
      )}
      emptyState={
        <RecordTableEmpty title={data.occurrences.length ? "Nothing matches this filter" : "No names found in source records yet"} />
      }
    />
  );
}

/** Contact profiles with how often the sources mention them; a row opens the profile. */
function ContactProfilesTable({ people }: { people: OverviewPerson[] }) {
  const navigate = useNavigate();
  const profiles = useMemo<ProfileSummaryRecord[]>(
    () => people.map((person) => ({ ...person, aliasText: (person.aliases ?? []).join(", ") })),
    [people],
  );
  return (
    <RecordListTable<ProfileSummaryRecord>
      table={PROFILES_TABLE}
      tableId="people-history-profiles"
      label="Profiles"
      icon={<Users size={14} />}
      records={profiles}
      showTotals={false}
      onOpen={(person) => navigate(`/app/people-directory/${person._id}`)}
      renderCell={({ record, field }) => {
        if (field.name === "fullName") return <strong>{record.fullName}</strong>;
        return undefined;
      }}
      renderPhoneCard={(person, { open, selecting }) => (
        <RecordTablePhoneCard
          title={person.fullName}
          meta={[plural(person.occurrences, "mention"), person.unreviewed ? `${person.unreviewed} to review` : ""]}
          onOpen={open}
          selecting={selecting}
        />
      )}
      emptyState={<RecordTableEmpty title="No contact profiles yet" />}
    />
  );
}

function NewContactDrawer({ societyId, open, onClose }: { societyId: string; open: boolean; onClose: () => void }) {
  const create = useMutation(api.personHistory.createContact);
  const toast = useToast();
  const [name, setName] = useState("");

  const close = () => {
    setName("");
    onClose();
  };
  const createContact = async () => {
    if (!name.trim()) return;
    try {
      await create({ societyId, fullName: name });
      close();
      toast.success("Contact profile created");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title="New contact profile"
      footer={
        <>
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn btn--accent" disabled={!name.trim()} onClick={() => void createContact()}>Create contact</button>
        </>
      }
    >
      <Field label="Person's name">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createContact();
          }}
        />
      </Field>
    </Drawer>
  );
}

/* ------------------------------ person profile ----------------------------- */

const PROFILE_TABS = ["history", "observations", "contacts", "identity"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];

export function PersonProfilePage() {
  const { id } = useParams();
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canRead = can("members:read");
  const canWrite = can("members:write");
  const [tab, setTab] = useUrlTab<ProfileTab>(PROFILE_TABS, "history");
  const [asOf, setAsOf] = useState("");

  // P12: a profile from another workspace (or a missing id) resolves to null and shows a not-found state.
  const data = useRecordQuery<ProfileResult>(
    api.personHistory.profile,
    society && id && canRead ? { societyId: society._id, personId: id, ...(asOf ? { asOf } : {}) } : "skip",
  );
  const profile = data && !data.notFound ? data : undefined;
  // Merge history waits for the profile: a missing id must show the not-found state, not fail this panel (FF-2).
  const profileId = profile?.person._id;
  const merges = useQuery(
    api.personHistory.mergeHistory,
    society && profileId && canRead ? { societyId: society._id, personId: profileId } : "skip",
  ) as MergeRow[] | undefined;
  const events = useMemo(() => groupEvents(profile?.events ?? []), [profile]);

  if (society === undefined) return <PageLoading variant="detail" />;
  if (!society) return <SeedPrompt />;
  if (!loaded) return <PageLoading variant="detail" />;
  if (!canRead) return <PeopleAccessRequired title="Person profile" />;
  if (data === undefined) return <PageLoading variant="detail" />;
  if (data === null || data.notFound) {
    return (
      <div className="page">
        <EmptyState
          icon={<UserX size={18} />}
          title="Person not found in this workspace"
          description="This profile does not exist here. It may belong to another workspace, or the link is out of date."
          action={<Link className="btn btn--accent" to="/app/people-directory">Back to the people directory</Link>}
        />
      </div>
    );
  }
  if (data.mergedInto) {
    return (
      <div className="page">
        <EmptyState
          icon={<GitMerge size={18} />}
          title={`${data.person.fullName} was merged`}
          description={`This profile was merged into ${data.mergedInto.fullName}. Its history now appears there.`}
          action={<Link className="btn btn--accent" to={`/app/people-directory/${data.mergedInto._id}`}>Open {data.mergedInto.fullName}</Link>}
        />
      </div>
    );
  }

  const person = data.person;
  const aliases = person.aliases ?? [];
  const tabItems = [
    { id: "history" as const, label: "History", count: events.length },
    { id: "observations" as const, label: "Observations", count: data.occurrences.length },
    { id: "contacts" as const, label: "Contacts", count: data.contactPoints.length || null },
    { id: "identity" as const, label: "Identity", count: null },
  ];

  return (
    <div className="page person-profile">
      <PageHeader
        title={person.fullName}
        subtitle={aliases.length ? `Also known as ${aliases.join(", ")}` : "No confirmed aliases"}
        status={<UnsupportedDetailsBadge table="peopleDirectory" id={person._id} />}
        info={
          <p>
            Source observations retain their wording and dates. Pending links and test assumptions are displayed for review. Contact
            identity alone does not establish membership or voting eligibility.
          </p>
        }
        actions={<Link className="btn-action" to="/app/people-history">Identity review</Link>}
      />

      <Tabs<ProfileTab> value={tab} onChange={setTab} tabRoles ariaLabel="Person profile sections" items={tabItems} />

      <div role="tabpanel" aria-label={tabItems.find((item) => item.id === tab)?.label}>
        {tab === "history" && (
          <div className="col" style={{ gap: 16 }}>
            <HistoricalCard historical={data.historical} asOf={asOf} onAsOfChange={setAsOf} />
            <HistoryCard
              societyId={society._id}
              personId={person._id}
              events={data.events}
              grouped={events}
              canWrite={canWrite}
            />
          </div>
        )}
        {tab === "observations" && <ObservationsCard occurrences={data.occurrences} />}
        {tab === "contacts" && (
          <ContactsCard societyId={society._id} personId={person._id} contactPoints={data.contactPoints} canWrite={canWrite} />
        )}
        {tab === "identity" && (
          <div className="col" style={{ gap: 16 }}>
            <AliasesCard societyId={society._id} personId={person._id} aliases={aliases} canWrite={canWrite} />
            <RegistersCard registers={data.registers} />
            <MergesCard societyId={society._id} person={person} merges={merges} canWrite={canWrite} />
          </div>
        )}
      </div>
    </div>
  );
}

