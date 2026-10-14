/**
 * Name-as-written field with an optional people-directory link (schema A1/B4,
 * motion and attendance editors). For choosing a person by id only, use
 * PersonPicker in ./PersonPicker.tsx. The text stays exactly what the minutes say; the
 * directory link is a separate, visible choice. Typing a name that matches
 * exactly one directory person (name or alias) links it automatically;
 * picking a suggestion links that person; "Unlink" keeps the text only.
 */
import { useMemo } from "react";
import { Link2, Unlink } from "lucide-react";
import { NameAutocomplete } from "@/components/NameAutocomplete";
import { matchDirectoryPerson, normalizePersonKey } from "../../shared/meetingAttendanceGrid";
import { Tooltip } from "./Tooltip";
import { EntityHoverCard } from "./HoverCard/EntityHoverCard";

export type DirectoryPerson = { _id: string; fullName: string; aliases?: string[] | null };

export type PersonPickerValue = { name: string; personId?: string };

export function usePersonOptions(people: readonly DirectoryPerson[] | undefined) {
  return useMemo(() => {
    const names = [...new Set((people ?? []).map((person) => person.fullName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const byId = new Map((people ?? []).map((person) => [String(person._id), person]));
    return { names, byId };
  }, [people]);
}

export function PersonNameLinkField({
  value,
  onChange,
  people,
  ariaLabel,
  placeholder = "Name as written",
  compact = false,
}: {
  value: PersonPickerValue;
  onChange: (next: PersonPickerValue) => void;
  people: readonly DirectoryPerson[] | undefined;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const { names, byId } = usePersonOptions(people);
  const linked = value.personId ? byId.get(String(value.personId)) : undefined;
  const handleText = (name: string) => {
    if (linked && normalizePersonKey(name) === normalizePersonKey(value.name)) {
      onChange({ name, personId: value.personId });
      return;
    }
    const match = matchDirectoryPerson(name, people as DirectoryPerson[]);
    onChange({ name, personId: match ? String(match._id) : undefined });
  };
  return (
    <div className={`person-picker${compact ? " person-picker--compact" : ""}`}>
      <NameAutocomplete value={value.name} onChange={handleText} options={names} ariaLabel={ariaLabel} placeholder={placeholder} />
      {value.personId ? (
        <span className="person-picker__link" title={linked ? `Linked to ${linked.fullName} in the people directory` : "Linked to a people-directory record"}>
          <Link2 size={11} aria-hidden="true" />
          <EntityHoverCard entity={{ kind: "person", id: String(value.personId), name: linked?.fullName ?? value.name }}>
            <span className="person-picker__link-name" tabIndex={0}>{linked?.fullName ?? "Linked"}</span>
          </EntityHoverCard>
          <Tooltip content="Unlink">
            <button type="button" className="person-picker__unlink" onClick={() => onChange({ name: value.name })} aria-label={`Unlink ${value.name || "person"} from the people directory`}>
              <Unlink size={11} />
            </button>
          </Tooltip>
        </span>
      ) : value.name.trim() && !compact ? (
        <span className="person-picker__hint muted">Not linked</span>
      ) : null}
    </div>
  );
}
