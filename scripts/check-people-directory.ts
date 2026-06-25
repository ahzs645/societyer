import assert from "node:assert/strict";
import {
  normalizeSearchName,
  matchByPrefix,
  dedupeKey,
  findDuplicates,
  suggestLink,
  type DirectoryPerson,
} from "../shared/peopleDirectory";

// normalizeSearchName: stable, lowercased, punctuation-light
{
  const out = normalizeSearchName("  Dr. Jane  A. Doe ,  ");
  assert.equal(out, "dr jane a doe");
  // deterministic / idempotent
  assert.equal(normalizeSearchName(out), out);
  // lowercased
  assert.equal(out, out.toLowerCase());
  // punctuation stripped
  assert.ok(!out.includes("."));
  assert.ok(!out.includes(","));
  // diacritics-light
  assert.equal(normalizeSearchName("Renée"), "renee");
}

// matchByPrefix: finds 'Jane' -> 'Jane Doe' and respects limit
{
  const people: DirectoryPerson[] = [
    { id: "1", fullName: "Jane Doe", firstName: "Jane", lastName: "Doe" },
    { id: "2", fullName: "Janet Smith" },
    { id: "3", fullName: "John Roe" },
    { id: "4", fullName: "Jane Austen" },
  ];
  const res = matchByPrefix(people, "Jane");
  const names = res.map((p) => p.fullName);
  assert.ok(names.includes("Jane Doe"));
  assert.ok(names.includes("Jane Austen"));
  assert.ok(!names.includes("John Roe"));
  // sorted by normalized name: "jane austen" < "jane doe" < "janet smith"
  assert.deepEqual(names, ["Jane Austen", "Jane Doe", "Janet Smith"]);

  // limit respected
  const limited = matchByPrefix(people, "Jane", 1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].fullName, "Jane Austen");

  // "last, first" order matched too
  const byLast = matchByPrefix(people, "Doe, Jane");
  assert.ok(byLast.some((p) => p.id === "1"));
}

// dedupeKey: collides on same name+dob, differs on different dob
{
  const a = dedupeKey({ fullName: "Jane Doe", dob: "1990-01-01" });
  const b = dedupeKey({ fullName: "jane  doe", dob: "1990-01-01" });
  const c = dedupeKey({ fullName: "Jane Doe", dob: "1991-02-02" });
  assert.equal(a, b);
  assert.notEqual(a, c);
}

// findDuplicates: groups a duplicate pair
{
  const people: DirectoryPerson[] = [
    { id: "1", fullName: "Jane Doe", dob: "1990-01-01" },
    { id: "2", fullName: "John Roe", dob: "1985-05-05" },
    { id: "3", fullName: "JANE DOE", dob: "1990-01-01" },
    { id: "4", fullName: "Unique Person" },
  ];
  const dups = findDuplicates(people);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].length, 2);
  const ids = dups[0].map((p) => p.id).sort();
  assert.deepEqual(ids, ["1", "3"]);
}

// suggestLink: returns existing person for exact normalized name, null otherwise
{
  const people: DirectoryPerson[] = [
    { id: "1", fullName: "Jane A. Doe" },
    { id: "2", fullName: "John Roe" },
  ];
  const hit = suggestLink("jane a doe", people);
  assert.ok(hit);
  assert.equal(hit!.id, "1");

  const miss = suggestLink("Nobody Here", people);
  assert.equal(miss, null);

  const empty = suggestLink("   ", people);
  assert.equal(empty, null);
}

console.log("OK people-directory");
