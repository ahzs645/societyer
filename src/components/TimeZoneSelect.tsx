import { useMemo } from "react";
import { Select, type SelectOption } from "./Select";
import { CANADIAN_TIME_ZONES, allTimeZones, timeZoneAbbreviation, viewerTimeZone } from "../../shared/timeZones";

/** "Los Angeles" from "America/Los_Angeles". */
function zoneCity(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

function timeZoneOptions(local: string, selected: string, at: number): SelectOption[] {
  const yours = (zone: string) => (zone === local ? " · your time zone" : "");
  const options: SelectOption[] = CANADIAN_TIME_ZONES.map((choice) => ({
    value: choice.zone,
    label: `${choice.label} time`,
    hint: `${timeZoneAbbreviation(choice.zone, at)} · ${choice.place}${yours(choice.zone)}`,
    keywords: `${choice.zone} ${choice.place} ${timeZoneAbbreviation(choice.zone, at)}`,
  }));
  const listed = new Set(options.map((option) => option.value));
  if (!listed.has(local)) {
    options.push({ value: local, label: "Your time zone", hint: `${timeZoneAbbreviation(local, at)} · ${zoneCity(local)}`, keywords: `${local} ${timeZoneAbbreviation(local, at)}` });
    listed.add(local);
  }
  // Every other zone the browser knows, found by searching; a saved zone outside the list stays selectable.
  for (const zone of [...allTimeZones(), selected]) {
    if (listed.has(zone)) continue;
    listed.add(zone);
    options.push({ value: zone, label: zoneCity(zone), hint: zone.includes("/") ? zone.split("/")[0].replace(/_/g, " ") : undefined, keywords: zone });
  }
  return options;
}

/**
 * A quiet time-zone control for beside a time input: shows the zone's short
 * name ("PST") and opens a searchable list, Canada's zones first, then the
 * viewer's own, then every zone the browser knows. `value` is an IANA zone;
 * empty means the viewer's. `at` dates the short name (PST or PDT).
 */
export function TimeZoneSelect({
  value,
  onChange,
  at,
  disabled,
  "aria-label": ariaLabel = "Time zone",
}: {
  value: string;
  onChange: (timeZone: string) => void;
  at?: number;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const local = viewerTimeZone() ?? "UTC";
  const zone = value || local;
  const when = at ?? Date.now();
  // Short names only change with daylight time; an hour's precision keeps the list stable while typing.
  const hour = Math.floor(when / 3_600_000);
  const options = useMemo(() => timeZoneOptions(local, zone, hour * 3_600_000), [local, zone, hour]);
  const abbreviation = timeZoneAbbreviation(zone, when) || zoneCity(zone);
  return (
    <Select
      size="sm"
      className="select-trigger--quiet"
      value={zone}
      onChange={onChange}
      options={options}
      searchable
      menuMinWidth={240}
      disabled={disabled}
      triggerLabel={abbreviation}
      sheetTitle="Time zone"
      aria-label={`${ariaLabel}: ${options.find((option) => option.value === zone)?.label ?? zone} (${abbreviation})`}
    />
  );
}
