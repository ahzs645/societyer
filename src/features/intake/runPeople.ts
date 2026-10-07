/** Pure helpers for adding an intake run's people to the directory. */
import { screenAttendanceName } from "../../../shared/attendanceNames";

export const personNameKey = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const key = personNameKey;


export function runPeopleNames(people: Array<{ fullName: string; aliases?: string[] }> | undefined): string[] {
  const names = new Map<string, string>();
  for (const person of people ?? []) {
    for (const name of [person.fullName, ...(person.aliases ?? [])]) {
      const clean = String(name ?? "").replace(/\s+/g, " ").trim();
      if (clean.split(" ").length < 2 || screenAttendanceName(clean).kind !== "person") continue;
      if (!names.has(key(clean))) names.set(key(clean), clean);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

