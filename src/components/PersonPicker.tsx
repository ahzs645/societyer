/**
 * Searchable people-directory picker (WP-H). The option list is only built
 * when the menu opens (Select renders options lazily), so one picker per row
 * stays cheap even on long rosters.
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { Select } from "./Select";
import { candidatePeopleForName } from "../../shared/personMatching";

export type DirectoryPersonOption = { _id: string; fullName: string; aliases?: string[]; isIndividual?: boolean };

/** One directory list for a whole page (scoped to the workspace server-side). */
export function useDirectoryPeople(societyId: string | undefined | null): DirectoryPersonOption[] | undefined {
  const { can } = usePermissions();
  return useQuery(api.peopleDirectory.list, societyId && can("members:read") ? { societyId } : "skip") as DirectoryPersonOption[] | undefined;
}

export function PersonPicker({
  people,
  value,
  onChange,
  sourceName,
  placeholder = "Choose a person",
  clearLabel = "No person linked",
  disabled,
  ariaLabel,
  linkedId,
  style,
}: {
  people: DirectoryPersonOption[] | undefined;
  value: string;
  onChange: (personId: string) => void;
  /** Source wording; matching people are listed first with the reason. */
  sourceName?: string;
  placeholder?: string;
  clearLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** The person currently linked (marked in the list). */
  linkedId?: string;
  style?: React.CSSProperties;
}) {
  const options = useMemo(() => {
    const list = people ?? [];
    const suggested = sourceName ? candidatePeopleForName(list, sourceName) : [];
    const suggestedIds = new Set(suggested.map((s) => s.person._id));
    const label = (p: DirectoryPersonOption) => `${p.fullName}${p._id === linkedId ? " (linked)" : ""}`;
    return [
      ...suggested.map((s) => ({
        value: s.person._id,
        label: label(s.person),
        hint: s.reason === "exact" ? "Same name" : s.reason === "given_name" ? `Given name matches “${sourceName}”` : "Similar name",
      })),
      ...list
        .filter((p) => !suggestedIds.has(p._id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((p) => ({ value: p._id, label: label(p), hint: p.aliases?.length ? `also ${p.aliases.slice(0, 2).join(", ")}` : p.isIndividual === false ? "Organization" : undefined })),
    ];
  }, [people, sourceName, linkedId]);
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      searchable
      clearable
      clearLabel={clearLabel}
      placeholder={people === undefined ? "Loading people…" : placeholder}
      disabled={disabled || people === undefined}
      aria-label={ariaLabel}
      style={style}
    />
  );
}
