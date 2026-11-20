import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { Contact, GitMerge, Pencil, Plus, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useUrlTab } from "../hooks/useUrlTab";
import { organizationRuleScope } from "../../shared/entityRuleScope";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Tabs } from "../components/primitives";
import type { MenuSection } from "../components/Menu";
import { formatDate } from "../lib/format";
import { PersonMergeDialog, type MergeCandidate } from "../features/people/PersonMergeDialog";
import { DuplicatesTab, suggestionCandidates, type DuplicateSuggestion, type SameNameGroup } from "../features/people/directory/DuplicatesTab";
import { MergeHistoryTab, type DirectoryMergeRow } from "../features/people/directory/MergeHistoryTab";
import {
  AddToSocietyDialog,
  ChooseMergeTarget,
  EMPTY_PERSON_FORM,
  PersonDrawer,
  type PersonForm,
} from "../features/people/directory/PersonDialogs";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
} from "@/platform/record-engine";

const TABS = ["profiles", "duplicates", "merges"] as const;
type DirectoryTab = (typeof TABS)[number];

/** A profile as peopleDirectory:list returns it. */
type DirectoryPerson = {
  _id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  isIndividual?: boolean;
  editable?: boolean;
  aliases?: string[];
};
type DirectoryRecord = DirectoryPerson & { personType: "individual" | "organization"; aliasText: string };
type PersonRef = { id: string; fullName: string };

const PEOPLE_TABLE = staticRecordTable({
  id: "people-directory",
  nameSingular: "person",
  namePlural: "people",
  labelSingular: "Person",
  labelPlural: "People",
  labelIdentifierFieldName: "fullName",
  routePath: "/app/people-directory",
  sorts: [{ field: "fullName", direction: "asc" }],
  fields: [
    { name: "fullName", label: "Name", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    { name: "aliasText", label: "Also known as", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "dob", label: "Date of birth", fieldType: FIELD_TYPES.DATE, size: 140 },
    {
      name: "personType",
      label: "Type",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: { options: [{ value: "individual", label: "Individual", color: "gray" }, { value: "organization", label: "Organization", color: "blue" }] },
    },
  ],
});

/**
 * Permission-scoped people directory with linked person history profiles.
 */
export function PeopleDirectoryPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("members:write");
  const canReadHistory = can("members:read");
  const [tab, setTab] = useUrlTab<DirectoryTab>(TABS, "profiles");

  const people = useQuery(api.peopleDirectory.list, society ? { societyId: society._id } : "skip") as DirectoryPerson[] | undefined;
  const duplicateGroups = useQuery(api.peopleDirectory.duplicates, society ? { societyId: society._id } : "skip") as SameNameGroup[] | undefined;
  const suggestions = useQuery(
    api.personHistory.duplicateSuggestions,
    society && canReadHistory ? { societyId: society._id } : "skip",
  ) as DuplicateSuggestion[] | undefined;
  const mergeHistory = useQuery(
    api.personHistory.mergeHistory,
    society && canReadHistory ? { societyId: society._id } : "skip",
  ) as DirectoryMergeRow[] | undefined;
  const [form, setForm] = useState<PersonForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mergePair, setMergePair] = useState<{ people: [MergeCandidate, MergeCandidate]; reasons?: string[] } | null>(null);
  const [mergeFrom, setMergeFrom] = useState<PersonRef | null>(null);
  const [addTo, setAddTo] = useState<PersonRef | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openEdit = (person: DirectoryPerson) => {
    if (!canManage || person.editable === false) return;
    setEditingId(person._id);
    setForm({
      ...EMPTY_PERSON_FORM,
      fullName: person.fullName ?? "",
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      dob: person.dob ?? "",
      isIndividual: person.isIndividual ?? true,
      // Address, gender and pronouns start blank: only supplied fields are
      // patched server-side, so blank never clears the stored values.
    });
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const duplicateCount = (suggestions?.length ?? 0) + (duplicateGroups?.length ?? 0);
  const tabItems = [
    { id: "profiles" as const, label: "Profiles", count: people?.length ?? null },
    { id: "duplicates" as const, label: "Possible duplicates", count: duplicateCount || null },
    { id: "merges" as const, label: "Merge history", count: mergeHistory?.length || null },
  ];

  return (
    <div className="page">
      <PageHeader
        title="People directory"
        icon={<Contact size={16} />}
        iconColor="blue"
        subtitle="Everyone in this workspace. Search before adding someone new."
        info={
          <p>
            Shared legacy records stay reachable through their role links. Governance roles live in{" "}
            <Link to="/app/directors">Directors</Link> and <Link to="/app/role-holders">Role holders</Link>;{" "}
            <Link to="/app/people-history">People and source history</Link> matches names found in meeting records to these profiles.
          </p>
        }
        actions={
          <button className="btn-action btn-action--primary" onClick={() => setForm({ ...EMPTY_PERSON_FORM })} disabled={!canManage}>
            <Plus size={12} /> New person
          </button>
        }
      />

      <Tabs<DirectoryTab> value={tab} onChange={setTab} tabRoles ariaLabel="People directory sections" items={tabItems} />

      <div role="tabpanel" aria-label={tabItems.find((item) => item.id === tab)?.label}>
        {tab === "profiles" && (
          <ProfilesTable
            people={people}
            canManage={canManage}
            isCorporation={organizationRuleScope(society).isCorporation}
            onEdit={openEdit}
            onMerge={setMergeFrom}
            onAddToSociety={setAddTo}
          />
        )}
        {tab === "duplicates" && (
          <DuplicatesTab
            societyId={society._id}
            suggestions={suggestions}
            groups={duplicateGroups}
            canReadHistory={canReadHistory}
            canManage={canManage}
            onMerge={(suggestion) => setMergePair({ people: suggestionCandidates(suggestion), reasons: suggestion.reasons })}
          />
        )}
        {tab === "merges" && (
          <MergeHistoryTab
            societyId={society._id}
            merges={mergeHistory ?? []}
            loading={canReadHistory && mergeHistory === undefined}
            canManage={canManage}
          />
        )}
      </div>

      {mergePair && <PersonMergeDialog societyId={society._id} people={mergePair.people} reasons={mergePair.reasons} onClose={() => setMergePair(null)} />}
      {mergeFrom && (
        <ChooseMergeTarget
          person={mergeFrom}
          people={people ?? []}
          onClose={() => setMergeFrom(null)}
          onChoose={(other) => {
            setMergeFrom(null);
            setMergePair({ people: [mergeFrom, other] });
          }}
        />
      )}
      {addTo && <AddToSocietyDialog societyId={society._id} person={addTo} onClose={() => setAddTo(null)} />}

      <PersonDrawer
        societyId={society._id}
        editingId={editingId}
        form={form}
        canManage={canManage}
        onChange={setForm}
        onClose={closeForm}
      />
    </div>
  );
}

/** The directory's profiles: open one, edit it, merge it with another or add it to the society. */
function ProfilesTable({
  people,
  canManage,
  isCorporation,
  onEdit,
  onMerge,
  onAddToSociety,
}: {
  people: DirectoryPerson[] | undefined;
  canManage: boolean;
  isCorporation: boolean;
  onEdit: (person: DirectoryPerson) => void;
  onMerge: (person: PersonRef) => void;
  onAddToSociety: (person: PersonRef) => void;
}) {
  const navigate = useNavigate();
  const records = useMemo<DirectoryRecord[]>(
    () => (people ?? []).map((person) => ({
      ...person,
      personType: person.isIndividual === false ? "organization" : "individual",
      aliasText: (person.aliases ?? []).join(", "),
    })),
    [people],
  );

  const menu = (person: DirectoryRecord): MenuSection[] => [
    {
      id: "row",
      items: [
        {
          id: "merge",
          label: "Merge with another profile…",
          icon: <GitMerge size={14} />,
          disabled: !canManage || person.editable === false,
          onSelect: () => onMerge({ id: person._id, fullName: person.fullName }),
        },
        {
          id: "add",
          label: "Add to society…",
          icon: <UserPlus size={14} />,
          disabled: !canManage,
          onSelect: () => onAddToSociety({ id: person._id, fullName: person.fullName }),
        },
      ],
    },
  ];

  const emptyDescription = isCorporation ? (
    <>Directors, officers and shareholders are in <Link to="/app/role-holders">Role holders</Link>.</>
  ) : (
    <>Board and members are in <Link to="/app/directors">Directors</Link> and <Link to="/app/members">Members</Link>.</>
  );

  return (
    <RecordListTable<DirectoryRecord>
      table={PEOPLE_TABLE}
      tableId="people-directory"
      label="People"
      icon={<Users size={14} />}
      records={records}
      loading={people === undefined}
      showTotals={false}
      onOpen={(person) => navigate(`/app/people-directory/${person._id}`)}
      renderCell={({ record, field }) => {
        if (field.name === "fullName") return <strong>{record.fullName}</strong>;
        if (field.name === "personType") {
          return record.personType === "organization" ? <Badge>Organization</Badge> : <span className="muted">Individual</span>;
        }
        return undefined;
      }}
      renderRowActions={(person) =>
        canManage && person.editable !== false ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(person)}>
            <Pencil size={12} /> Edit
          </button>
        ) : null
      }
      rowMenuSections={menu}
      renderPhoneCard={(person, { open, selecting }) => (
        <RecordTablePhoneCard
          title={person.fullName}
          badge={person.personType === "organization" ? <Badge>Organization</Badge> : undefined}
          meta={[person.dob ? formatDate(person.dob) : "", person.aliasText ? `also ${person.aliasText}` : ""]}
          onOpen={open}
          selecting={selecting}
        />
      )}
      emptyState={<RecordTableEmpty title="No directory profiles yet" description={emptyDescription} />}
    />
  );
}

export default PeopleDirectoryPage;
