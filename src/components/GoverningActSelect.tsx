import { Field } from "./ui";
import { Select, type SelectOption } from "./Select";
import { optionLabel } from "../lib/orgHubOptions";
import {
  ANOTHER_ACT_VALUE, INCORPORATION_ACTS, INCORPORATION_JURISDICTIONS, SUPPORT_LABELS,
  incorporationActForValue, incorporationActTitle, incorporationJurisdiction, incorporationJurisdictionForCode,
  type IncorporationAct,
} from "../../shared/incorporationActs";

const JURISDICTION_ORDER = new Map(INCORPORATION_JURISDICTIONS.map((place, index) => [place.id, index]));

/** Every catalogued Act, federal first then by province/territory, with where it applies and how much guidance there is. */
const ACT_OPTIONS: SelectOption[] = [...INCORPORATION_ACTS]
  .sort((a, b) => (JURISDICTION_ORDER.get(a.jurisdiction) ?? 0) - (JURISDICTION_ORDER.get(b.jurisdiction) ?? 0))
  .map((act) => ({
    value: act.actFormedUnder,
    label: incorporationActTitle(act),
    hint: `${incorporationJurisdiction(act.jurisdiction)!.name} · ${SUPPORT_LABELS[act.support].badge}`,
  }));

/**
 * Jurisdiction choices for organization settings: the reviewed guide tracks
 * plus each catalogue jurisdiction code, so a records-only organization's
 * stored code (e.g. "CA-AB") is shown and kept.
 */
export function jurisdictionChoices(base: readonly SelectOption[], current?: string | null): SelectOption[] {
  const known = new Set(base.map((option) => option.value));
  const extra: SelectOption[] = [];
  for (const place of INCORPORATION_JURISDICTIONS) {
    if (known.has(place.code)) continue;
    known.add(place.code);
    extra.push({ value: place.code, label: place.level === "federal" ? "Canada federal - other Acts" : place.code === "CA-ON" ? "Ontario - other Acts" : place.name, hint: SUPPORT_LABELS.records_only.badge });
  }
  if (current && !known.has(current)) extra.push({ value: current, label: incorporationJurisdictionForCode(current)?.name ?? current });
  return [...base, ...extra];
}

/**
 * The governing Act picker for organization settings. Choosing a catalogued
 * Act hands back the catalogue entry so the caller can keep the jurisdiction
 * and entity type consistent with it.
 */
export function GoverningActSelect({ value, jurisdictionCode, onChange, otherActName }: {
  value?: string | null;
  jurisdictionCode?: string | null;
  onChange: (value: string | undefined, act?: IncorporationAct) => void;
  /** The Act's name recorded at setup when "Another Act" was chosen. */
  otherActName?: string;
}) {
  const current = value ?? "";
  const options: SelectOption[] = [...ACT_OPTIONS];
  const anotherPlace = incorporationJurisdictionForCode(jurisdictionCode);
  options.push({ value: ANOTHER_ACT_VALUE, label: otherActName ? `Another Act: ${otherActName}` : "Another Act", hint: `${anotherPlace ? `${anotherPlace.name} · ` : ""}${SUPPORT_LABELS.records_only.badge}` });
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: optionLabel("actsFormedUnder", current), hint: "Older or imported value" });
  const act = incorporationActForValue(current, jurisdictionCode);
  return (
    <Field label="Act formed under" hint={act ? (act.support === "full" ? SUPPORT_LABELS.full.description : SUPPORT_LABELS.records_only.description) : undefined}>
      <Select
        value={current}
        onChange={(next) => onChange(next || undefined, next && next !== ANOTHER_ACT_VALUE ? incorporationActForValue(next) : undefined)}
        options={options}
        placeholder="Review governing Act"
        searchable
        clearable
        clearLabel="Review governing Act"
      />
    </Field>
  );
}
