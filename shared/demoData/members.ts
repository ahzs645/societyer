/**
 * Deterministic member register for the demo society.
 *
 * Adds a few dozen fictional members to the hand-written ones so the register,
 * renewal tracking and a "members over time" view have real shape: joins
 * spread over several years (growing, with September/April peaks), a mix of
 * classes and fee tiers, people who left, and renewal states (renewed,
 * renewed through the payment page, past due, pending first payment).
 *
 * The membership year runs April 1 to March 31 and renewals are due April 1,
 * so dues cluster in April and May. `buildDemoDuesPayments` turns the register
 * into the e-transfer rows the bank feed shows.
 */

import { addDays, createRng, dayOfMonth, daysInMonth } from "./prng";
import type { DemoDuesPayment } from "./bankFeed";

export type DemoRenewalState = "renewed" | "renewed_online" | "past_due" | "pending" | "not_applicable" | "left";

export type DemoMemberSeed = {
  key: string;
  firstName: string;
  lastName: string;
  membershipClass: "Regular" | "Student" | "Associate" | "Honorary";
  status: "Active" | "Inactive" | "Suspended";
  joinedAt: string;
  leftAt?: string;
  votingRights: boolean;
  plan: "regular" | "student" | "sustainer" | null;
  notes?: string;
};

export type DemoMemberLike = {
  firstName: string;
  lastName: string;
  membershipClass: string;
  status: string;
  joinedAt: string;
  leftAt?: string;
};

const FIRST_NAMES = [
  "Aiyana", "Bashir", "Camille", "Dawit", "Eilidh", "Farah", "Gabriel", "Haruto", "Ines", "Jasper",
  "Keira", "Lucien", "Maya", "Nikhil", "Odessa", "Pavel", "Quinn", "Rania", "Soren", "Talia",
  "Umar", "Valentina", "Wren", "Xiomara", "Yusuf", "Zara", "Anouk", "Bodhi", "Cyrus", "Delphine",
  "Emeka", "Freya", "Gideon", "Hollis", "Imani", "Joaquin", "Kalani", "Leona", "Mateo", "Nell",
  "Orin", "Paloma", "Rafferty", "Saoirse", "Tobias", "Ulla", "Vikram", "Willa", "Yara", "Zane",
  "Amaru", "Beatrix", "Cormac", "Dalia", "Esme", "Florian", "Greta", "Hamza", "Ivy", "Jun",
];

const LAST_NAMES = [
  "Abernathy", "Bellweather", "Castellanos", "Delacroix", "Esposito", "Fairbairn", "Gallagher", "Hollander", "Ibarra", "Jorgensen",
  "Kowalczyk", "Lindqvist", "Mbeki", "Navarro", "Oyelaran", "Pemberton", "Quintero", "Rasmussen", "Sorensen", "Takahashi",
  "Underhill", "Vasconcelos", "Whitlock", "Yilmaz", "Zielinski", "Achterberg", "Brennan", "Calloway", "Dimitriou", "Eriksen",
  "Fontaine", "Grabowski", "Haddad", "Iwasaki", "Jablonski", "Kaminski", "Laurent", "Moreau", "Nakashima", "Okafor-Reid",
  "Pacheco", "Rautenbach", "Santangelo", "Thibodeau", "Ueda", "Valcourt", "Wainwright", "Xu-Lambert", "Yamada", "Zamora",
];

// Relative join volume per year and month (September and April peaks).
const YEAR_WEIGHTS: Array<[number, number]> = [[2019, 5], [2020, 4], [2021, 7], [2022, 9], [2023, 11], [2024, 13], [2025, 15], [2026, 11]];
const MONTH_WEIGHTS = [1.1, 0.8, 0.8, 1.4, 1.0, 0.6, 0.4, 0.5, 1.7, 1.4, 0.9, 0.5];

function weightedPick<T>(entries: Array<[T, number]>, roll: number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = roll * total;
  for (const [value, weight] of entries) {
    remaining -= weight;
    if (remaining < 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function buildDemoMembers(options: { count: number; asOf: string; excludeNames?: string[] }): DemoMemberSeed[] {
  const rng = createRng("members:register");
  const taken = new Set((options.excludeNames ?? []).map((name) => name.toLowerCase()));
  const members: DemoMemberSeed[] = [];
  let attempt = 0;
  while (members.length < options.count && attempt < options.count * 20) {
    attempt += 1;
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`.toLowerCase();
    if (taken.has(fullName)) continue;
    taken.add(fullName);

    const year = weightedPick(YEAR_WEIGHTS, rng.next());
    const month = weightedPick(MONTH_WEIGHTS.map((weight, index) => [index + 1, weight] as [number, number]), rng.next());
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    let joinedAt = dayOfMonth(monthKey, rng.int(1, daysInMonth(monthKey)));
    if (joinedAt > options.asOf) joinedAt = addDays(options.asOf, -rng.int(3, 120));

    const classRoll = rng.next();
    const membershipClass: DemoMemberSeed["membershipClass"] =
      classRoll < 0.68 ? "Regular" : classRoll < 0.86 ? "Student" : classRoll < 0.96 ? "Associate" : "Honorary";
    const leaves = joinedAt < "2025-01-01" && rng.chance(0.16);
    const leftAt = leaves ? addDays(joinedAt, rng.int(400, 1500)) : undefined;
    const left = Boolean(leftAt && leftAt <= options.asOf);
    const status: DemoMemberSeed["status"] = left ? "Inactive" : rng.chance(0.015) ? "Suspended" : "Active";
    const plan: DemoMemberSeed["plan"] =
      membershipClass === "Honorary" ? null : membershipClass === "Student" ? "student" : rng.chance(0.1) ? "sustainer" : "regular";
    members.push({
      key: `${firstName}-${lastName}`.toLowerCase().replace(/[^a-z]+/g, "-"),
      firstName,
      lastName,
      membershipClass,
      status,
      joinedAt,
      leftAt: left ? leftAt : undefined,
      votingRights: membershipClass === "Regular" || membershipClass === "Student",
      plan,
      notes:
        status === "Suspended" ? "Suspended pending a conduct review." :
        membershipClass === "Honorary" ? "Honorary membership granted at an AGM." :
        left ? "Did not renew; asked to stay on the newsletter list." : undefined,
    });
  }
  return members;
}

function duesCents(membershipClass: string) {
  if (membershipClass === "Student") return 500;
  if (membershipClass === "Honorary") return 0;
  return 2500;
}

/** Renewal behaviour for one member in one membership year. */
function renewalFor(member: DemoMemberLike, renewalYear: number) {
  const rng = createRng(`renewal:${member.firstName} ${member.lastName}:${renewalYear}`);
  const roll = rng.next();
  const how: "etransfer" | "online" | "lapsed" = roll < 0.66 ? "etransfer" : roll < 0.9 ? "online" : "lapsed";
  const timing = rng.next();
  const monthKey = timing < 0.55 ? `${renewalYear}-04` : timing < 0.85 ? `${renewalYear}-05` : `${renewalYear}-06`;
  const day = timing < 0.55 ? rng.int(1, 21) : rng.int(1, daysInMonth(monthKey));
  return { how, date: dayOfMonth(monthKey, day), memo: rng.chance(0.3) ? `${renewalYear}-${String((renewalYear + 1) % 100).padStart(2, "0")} dues` : undefined };
}

/** Membership year (by its starting April) that contains a date. */
function membershipYearOf(iso: string) {
  const year = Number(iso.slice(0, 4));
  return iso.slice(5) >= "04-01" ? year : year - 1;
}

export function demoRenewalState(member: DemoMemberLike, asOf: string): DemoRenewalState {
  if (member.status === "Inactive" || (member.leftAt && member.leftAt <= asOf)) return "left";
  if (member.membershipClass === "Honorary") return "not_applicable";
  const year = membershipYearOf(asOf);
  if (member.joinedAt >= `${year}-04-01`) {
    return createRng(`join:${member.firstName} ${member.lastName}`).chance(0.12) && member.joinedAt >= addDays(asOf, -21) ? "pending" : "renewed";
  }
  const renewal = renewalFor(member, year);
  if (renewal.how === "lapsed" || renewal.date > asOf) return "past_due";
  return renewal.how === "online" ? "renewed_online" : "renewed";
}

/** E-transfer dues rows between `start` and `asOf` for every paying member. */
export function buildDemoDuesPayments(members: DemoMemberLike[], window: { start: string; asOf: string }): DemoDuesPayment[] {
  const payments: DemoDuesPayment[] = [];
  const firstYear = membershipYearOf(window.start);
  const lastYear = membershipYearOf(window.asOf);
  for (const member of members) {
    const cents = duesCents(member.membershipClass);
    if (!cents || member.status === "Suspended") continue;
    const name = `${member.firstName} ${member.lastName}`;
    // A joiner pays on joining; later years renew in the April-May season.
    if (member.joinedAt >= window.start && member.joinedAt <= window.asOf) {
      const rng = createRng(`join:${name}`);
      const pending = rng.chance(0.12) && member.joinedAt >= addDays(window.asOf, -21);
      if (!pending && rng.chance(0.72)) {
        payments.push({ name, date: addDays(member.joinedAt, rng.int(0, 2)), amountCents: cents, memo: "New member dues" });
      }
    }
    for (let year = firstYear; year <= lastYear; year += 1) {
      const due = `${year}-04-01`;
      if (member.joinedAt >= due || due < window.start) continue;
      if (member.leftAt && member.leftAt <= `${year}-06-30`) continue;
      const renewal = renewalFor(member, year);
      if (renewal.how !== "etransfer" || renewal.date > window.asOf) continue;
      payments.push({ name, date: renewal.date, amountCents: cents, memo: renewal.memo });
    }
  }
  return payments.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
