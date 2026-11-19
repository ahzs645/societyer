import { OPTION_SETS, type OptionSetName } from "../../lib/orgHubOptions";
import type { SelectOption } from "@/platform/record-engine";

/** Select options for an option set; `color` picks each option's tag colour. */
export function detailOptions(setName: OptionSetName, color: (value: string) => NonNullable<SelectOption["color"]> = () => "gray"): SelectOption[] {
  return OPTION_SETS[setName].map((option) => ({ value: option.value, label: option.label, color: color(option.value) }));
}
