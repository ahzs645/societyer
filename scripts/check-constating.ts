import assert from "node:assert/strict";
import {
  constatingTimeline,
  currentRegime,
  regimeNarrative,
  validateConstatingEvent,
  type ConstatingEvent,
} from "../shared/constating";

const incorporated: ConstatingEvent = {
  action: "incorporated",
  jurisdiction: "BC",
  legislation: "Company Act",
  regNumber: "808888",
  startISO: "2000-08-08",
};

const transitioned: ConstatingEvent = {
  action: "transitioned",
  jurisdiction: "BC",
  legislation: "Business Corporations Act",
  regNumber: "BC0808888",
  startISO: "2008-08-08",
};

const continued: ConstatingEvent = {
  action: "continued",
  jurisdiction: "AB",
  legislation: "Business Corporations Act",
  regNumber: "AB2020",
  startISO: "2020-01-01",
};

// --- timeline order: input out of order, output sorted by startISO ---
{
  const ordered = constatingTimeline([continued, incorporated, transitioned]);
  assert.deepEqual(
    ordered.map((e) => e.startISO),
    ["2000-08-08", "2008-08-08", "2020-01-01"],
  );
  // does not mutate input
  assert.equal(ordered[0].action, "incorporated");
}

// --- stable sort for equal dates ---
{
  const a: ConstatingEvent = { action: "restated", jurisdiction: "BC", legislation: "A", startISO: "2010-01-01" };
  const b: ConstatingEvent = { action: "restated", jurisdiction: "BC", legislation: "B", startISO: "2010-01-01" };
  const ordered = constatingTimeline([a, b]);
  assert.deepEqual(ordered.map((e) => e.legislation), ["A", "B"]);
}

// --- currentRegime: returns the right Act as-of a date ---
{
  const events = [incorporated, transitioned, continued];

  // before anything
  assert.equal(currentRegime(events, "1999-01-01"), null);

  // exactly on incorporation boundary -> incorporated
  assert.equal(currentRegime(events, "2000-08-08")?.legislation, "Company Act");

  // between incorporation and transition -> still Company Act
  assert.equal(currentRegime(events, "2005-06-01")?.legislation, "Company Act");

  // on transition boundary -> Business Corporations Act (BC)
  const onTransition = currentRegime(events, "2008-08-08");
  assert.equal(onTransition?.legislation, "Business Corporations Act");
  assert.equal(onTransition?.jurisdiction, "BC");

  // after continuance -> Business Corporations Act (AB)
  const latest = currentRegime(events, "2025-12-31");
  assert.equal(latest?.jurisdiction, "AB");
  assert.equal(latest?.regNumber, "AB2020");
}

// --- narrative for the incorporate -> transition chain ---
{
  const narrative = regimeNarrative([transitioned, incorporated]);
  assert.equal(
    narrative,
    "Incorporated under the Company Act (BC) on 2000-08-08 (No. 808888); " +
      "transitioned to the Business Corporations Act (BC) on 2008-08-08 (No. BC0808888).",
  );
}

// --- narrative: empty input -> empty string; no regNumber omits "(No. ...)" ---
{
  assert.equal(regimeNarrative([]), "");
  const noNum: ConstatingEvent = {
    action: "incorporated",
    jurisdiction: "ON",
    legislation: "Business Corporations Act",
    startISO: "2015-03-03",
  };
  assert.equal(
    regimeNarrative([noNum]),
    "Incorporated under the Business Corporations Act (ON) on 2015-03-03.",
  );
}

// --- validate ---
{
  assert.deepEqual(validateConstatingEvent(incorporated), { ok: true, errors: [] });

  const bad = validateConstatingEvent({
    action: "merged" as ConstatingEvent["action"],
    jurisdiction: "",
    legislation: "  ",
    startISO: "",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
  assert.ok(bad.errors.some((m) => m.includes("action")));
  assert.ok(bad.errors.some((m) => m.includes("jurisdiction")));
  assert.ok(bad.errors.some((m) => m.includes("legislation")));
  assert.ok(bad.errors.some((m) => m.includes("startISO")));
}

console.log("OK constating");
