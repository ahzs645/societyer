import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { GitMerge, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { usePrompt } from "@/components/Modal";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, staticRecordTable } from "@/platform/record-engine";
import type { MergeCandidate } from "../PersonMergeDialog";

/** One pair from personHistory:duplicateSuggestions. */
export type DuplicateSuggestion = {
  ids: [string, string];
  names: [string, string];
  score: number;
  reasons: string[];
  sharedMeetings: number;
  occurrences: [number, number];
  observed: [string, string];
};
type SuggestionRecord = { _id: string; suggestion: DuplicateSuggestion; pair: string; reasonText: string; sharedMeetings: number };

/** One group from peopleDirectory:duplicates: profiles sharing a normalized name and date of birth. */
export type SameNameGroup = Array<{ id: string; fullName: string; dob?: string }>;
type SameNameRecord = { _id: string; group: SameNameGroup; names: string; dob: string | null };

const SUGGESTIONS_TABLE = staticRecordTable({
  id: "people-directory:duplicate-suggestions",
  nameSingular: "duplicateSuggestion",
  namePlural: "duplicateSuggestions",
  labelSingular: "Possible duplicate",
  labelPlural: "Possible duplicates",
  labelIdentifierFieldName: "pair",
  fields: [
    { name: "pair", label: "Profiles", fieldType: FIELD_TYPES.TEXT, size: 320, config: { groupable: false } },
    { name: "reasonText", label: "Why they may match", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    { name: "sharedMeetings", label: "Shared meetings", fieldType: FIELD_TYPES.NUMBER, size: 140, config: { groupable: false } },
  ],
});

const SAME_NAME_TABLE = staticRecordTable({
  id: "people-directory:same-name-dob",
  nameSingular: "sameNameGroup",
  namePlural: "sameNameGroups",
  labelSingular: "Group",
  labelPlural: "Groups",
  labelIdentifierFieldName: "names",
  fields: [
    { name: "names", label: "Profiles", fieldType: FIELD_TYPES.TEXT, size: 360, config: { groupable: false } },
    { name: "dob", label: "Date of birth", fieldType: FIELD_TYPES.DATE, size: 160 },
  ],
});

/** The two merge candidates of a suggestion, for PersonMergeDialog. */
export function suggestionCandidates(suggestion: DuplicateSuggestion): [MergeCandidate, MergeCandidate] {
  return [
    { id: suggestion.ids[0], fullName: suggestion.names[0], occurrences: suggestion.occurrences[0], observed: suggestion.observed[0] },
    { id: suggestion.ids[1], fullName: suggestion.names[1], occurrences: suggestion.occurrences[1], observed: suggestion.observed[1] },
  ];
}

function ProfileLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/app/people-directory/${id}`}>{name}</Link>;
}

/**
 * The people directory's "Possible duplicates" tab: pairs that look like one
 * person (merge or dismiss them) and profiles that share a name and birth date.
 */
export function DuplicatesTab({
  societyId,
  suggestions,
  groups,
  canReadHistory,
  canManage,
  onMerge,
}: {
  societyId: string;
  suggestions: DuplicateSuggestion[] | undefined;
  groups: SameNameGroup[] | undefined;
  canReadHistory: boolean;
  canManage: boolean;
  onMerge: (suggestion: DuplicateSuggestion) => void;
}) {
  const dismiss = useMutation(api.personHistory.dismissDuplicate);
  const prompt = usePrompt();
  const toast = useToast();

  const suggestionRecords = useMemo<SuggestionRecord[]>(
    () => (suggestions ?? []).map((suggestion) => ({
      _id: suggestion.ids.join(":"),
      suggestion,
      pair: suggestion.names.join(" ↔ "),
      reasonText: suggestion.reasons.join(" · "),
      sharedMeetings: suggestion.sharedMeetings,
    })),
    [suggestions],
  );
  const sameNameRecords = useMemo<SameNameRecord[]>(
    () => (groups ?? []).map((group) => ({
      _id: group.map((person) => person.id).join(":"),
      group,
      names: group.map((person) => person.fullName).join(", "),
      dob: group.find((person) => person.dob)?.dob ?? null,
    })),
    [groups],
  );

  const dismissSuggestion = async ({ ids, names }: DuplicateSuggestion) => {
    const rationale = await prompt({
      title: "Different people?",
      message: `Record why ${names[0]} and ${names[1]} are different people. The suggestion will not be shown again.`,
      placeholder: "e.g. different organizations in the same year",
      confirmLabel: "Not the same person",
      required: true,
    });
    if (!rationale) return;
    try {
      await dismiss({ societyId, personIds: ids, rationale });
      toast.success("Suggestion dismissed");
    } catch (error) {
      toast.error("Could not dismiss", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <>
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Possible duplicates</h2>
          <span className="card__subtitle">
            Spelling variants, nicknames, a first name only, or one name inside another. Check the sources before merging; profiles
            listed at the same meeting are probably different people.
          </span>
        </div>
        <RecordListTable<SuggestionRecord>
          variant="card"
          table={SUGGESTIONS_TABLE}
          tableId="people-directory-duplicates"
          label="Possible duplicates"
          icon={<GitMerge size={14} />}
          records={suggestionRecords}
          loading={canReadHistory && suggestions === undefined}
          renderCell={({ record, field }) => {
            const { suggestion } = record;
            if (field.name === "pair") {
              return (
                <span>
                  <ProfileLink id={suggestion.ids[0]} name={suggestion.names[0]} /> <span className="muted">({suggestion.occurrences[0]})</span>
                  {" ↔ "}
                  <ProfileLink id={suggestion.ids[1]} name={suggestion.names[1]} /> <span className="muted">({suggestion.occurrences[1]})</span>
                </span>
              );
            }
            if (field.name === "reasonText") return <span className="muted">{record.reasonText}</span>;
            return undefined;
          }}
          renderRowActions={(record) => (
            <>
              <button type="button" className="btn btn--sm" disabled={!canManage} onClick={() => onMerge(record.suggestion)}>
                <GitMerge size={12} /> Merge…
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => void dismissSuggestion(record.suggestion)}>
                Not the same
              </button>
            </>
          )}
          emptyState={<RecordTableEmpty title="No possible duplicates" description="Profiles that look alike are suggested here." />}
        />
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Same name and date of birth</h2>
          <span className="card__subtitle">These people share a normalized name and date of birth.</span>
        </div>
        <RecordListTable<SameNameRecord>
          variant="card"
          table={SAME_NAME_TABLE}
          tableId="people-directory-same-name"
          label="Groups"
          icon={<Users size={14} />}
          records={sameNameRecords}
          loading={groups === undefined}
          renderCell={({ record, field }) => {
            if (field.name !== "names") return undefined;
            return (
              <span>
                {record.group.map((person, index) => (
                  <span key={person.id}>
                    {index > 0 && ", "}
                    <ProfileLink id={person.id} name={person.fullName} />
                  </span>
                ))}
              </span>
            );
          }}
          emptyState={<RecordTableEmpty title="No shared names and birth dates" />}
        />
      </section>
    </>
  );
}
