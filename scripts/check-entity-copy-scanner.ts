/** Regression gate for rendered entity-copy context, without a browser. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isAllowed,
  partitionEntityGateText,
  partitionPrivacySummaryText,
  scan,
  type AllowList,
  type CopyWorkspace,
  type WorkspaceKey,
} from "../tests/helpers/entityCopyScanner";

const { allow } = JSON.parse(readFileSync(new URL("../tests/fixtures/entity-copy-allowlist.json", import.meta.url), "utf8")) as AllowList;
const workspace = (key: WorkspaceKey): CopyWorkspace => ({ key, name: "Example organization", bc: false, society: false });

function classify(main: string, summaries: string[] = [], key: WorkspaceKey = "cbca-corp", route = "/app/privacy") {
  const text = partitionPrivacySummaryText(main, summaries);
  const findings = [
    ...scan(workspace(key), route, "main", text.main, true),
    ...text.privacySummaries.flatMap((summary) => scan(workspace(key), route, "main", summary, true, "privacy-summary")),
  ];
  return { ...text, findings, leaks: findings.filter((finding) => !isAllowed(finding, allow)) };
}

// CI's innerText put the status badge on its own line. The legal scope remains
// conditional; the label and badge must be evaluated together as one summary.
for (const key of ["cbca-corp", "obca-corp", "custom"] as const) {
  for (const separator of [" ", "\n", " \n\t", "\r\n"]) {
    const summaries = [`BC PIPA${separator}Conditional`, `Alberta PIPA${separator}Conditional`];
    const main = ["Which privacy law applies isn't assessed yet", ...summaries, "Review the operating locations."].join("\n");
    const result = classify(main, summaries, key);
    assert.equal(result.findings.length, 2, `${key}: both law names must still be scanned`);
    assert.equal(result.privacySummaries.length, 2, `${key}: both captured summaries retain their status`);
    assert.deepEqual(result.findings.map((finding) => finding.snippet), ["BC PIPA Conditional", "Alberta PIPA Conditional"]);
    assert.equal(result.leaks.length, 0, `${key}: conditional summaries may be split across lines`);
    assert.match(result.main, /Which privacy law applies isn't assessed yet/);
    assert.match(result.main, /Review the operating locations\./);
  }
}

// Bare labels, changed statuses and unverified text must never acquire the
// conditional-summary exemption merely because a law name appears on the page.
for (const label of ["BC PIPA", "Alberta PIPA"]) {
  for (const status of ["", "\nAssessed as applicable", "\nAssumed: confirm", "\nConditional requirements apply"]) {
    const text = label + status;
    const result = classify(text, [text]);
    assert.deepEqual(result.privacySummaries, [], `${JSON.stringify(text)} is not a conditional summary`);
    assert.equal(result.leaks.length, 1, `${JSON.stringify(text)} stays a finding`);
  }
  for (const text of [label, `${label}\nConditional`, `${label} Conditional`]) {
    assert.equal(classify(text).leaks.length, 1, "text outside the verified assessment summaries is still checked");
    const sidebar = scan(workspace("cbca-corp"), "(sidebar)", "sidebar", text, true);
    assert.equal(sidebar.length, 1);
    assert.ok(sidebar.every((finding) => !isAllowed(finding, allow)), "conditional wording cannot excuse a sidebar law label");
  }
}

const summary = "BC PIPA\nConditional";
const alongsideBareLabel = classify(`BC PIPA\nOther content\n${summary}`, [summary]);
assert.equal(alongsideBareLabel.privacySummaries.length, 1);
assert.equal(alongsideBareLabel.leaks.length, 1, "a valid summary cannot hide an unrelated bare label");
assert.equal(alongsideBareLabel.leaks[0].snippet, "BC PIPA");

const ambiguous = classify(`${summary}\nOther content\n${summary}`, [summary]);
assert.deepEqual(ambiguous.privacySummaries, [], "ambiguous rendered positions must fail closed");
assert.equal(ambiguous.leaks.length, 2);
for (const main of [`Required: ${summary}`, `${summary} applies here`]) {
  assert.equal(classify(main, [summary]).leaks.length, 1, "a partial summary match cannot hide adjacent operative wording");
}
assert.equal(classify("BC PIPA", [summary]).leaks.length, 1, "a captured summary absent from main cannot excuse a label");
assert.equal(classify(summary, [summary], "cbca-corp", "/app/dashboard").leaks.length, 1, "the exception remains scoped to Privacy");
assert.equal(classify(summary, [summary], "cbca-demo").leaks.length, 1, "the exception remains scoped to unassessed setup fixtures");

// The same extraction must preserve unrelated forbidden copy for the sweep.
const mixed = classify(`Follow the Societies Act\n${summary}`, [summary]);
assert.equal(mixed.leaks.length, 1);
assert.equal(mixed.leaks[0].pattern, "societies-act");
assert.deepEqual(scan({ ...workspace("bc-corp"), bc: true }, "/app/privacy", "main", "BC PIPA", true), []);

const gateExplanation = "Example organization: Business corporation. This page applies to Society (nonprofit), Nonprofit corporation, Cooperative, Unincorporated association.";
function classifyGate(main: string, captured: string[] = [], route = "/app/members", key: WorkspaceKey = "cbca-corp") {
  const text = partitionEntityGateText(main, captured);
  const findings = [
    ...scan(workspace(key), route, "main", text.main, false),
    ...text.entityGateExplanations.flatMap((explanation) => scan(workspace(key), route, "main", explanation, false, "entity-kind-applicability")),
  ];
  return { ...text, findings, leaks: findings.filter((finding) => !isAllowed(finding, allow)) };
}
// Replay the exact gate boundary that produced all fourteen CI findings, while
// preserving detection of genuine society wording around or outside that gate.
for (const key of ["bc-corp", "cbca-corp", "obca-corp", "custom", "bc-demo", "cbca-demo", "obca-demo"] as const) {
  for (const route of ["/app/members", "/app/membership"]) {
    const result = classifyGate(gateExplanation, [gateExplanation], route, key);
    assert.equal(result.findings.length, 1, "the boundary label is still scanned");
    assert.equal(result.leaks.length, 0, `${key} ${route}: exact gate explanation is contextual`);
    assert.equal(classifyGate(gateExplanation, [], route, key).leaks.length, 1, "identical ordinary page text has no gate exemption");
    const mixed = classifyGate(`${gateExplanation}\nSociety records are required here.`, [gateExplanation], route, key);
    assert.equal(mixed.leaks.length, 1, "a gate cannot excuse unrelated society copy");
    assert.equal(mixed.leaks[0].snippet, "Society records are required here.");
  }
}
for (const changed of [
  gateExplanation.replace("Business corporation", "Society (nonprofit)"),
  gateExplanation.replace("This page applies to", "This organization is a"),
  `${gateExplanation} These society requirements apply here.`,
]) {
  const result = classifyGate(changed, [changed]);
  assert.equal(result.entityGateExplanations.length, 0, "changed legal meaning must not receive boundary context");
  assert.ok(result.leaks.length > 0);
}
for (const main of [`Required: ${gateExplanation}`, `${gateExplanation} applies here`, `${gateExplanation}\n${gateExplanation}`]) {
  const result = classifyGate(main, [gateExplanation]);
  assert.equal(result.entityGateExplanations.length, 0, "partial and ambiguous positions fail closed");
  assert.ok(result.leaks.length > 0);
}
assert.equal(classifyGate(gateExplanation, [gateExplanation, gateExplanation]).leaks.length, 1, "multiple captured gates fail closed");
assert.equal(classifyGate("Society records", [gateExplanation]).leaks.length, 1, "a missing captured subtitle cannot hide other wording");
assert.equal(classifyGate(gateExplanation, [gateExplanation], "/app/society").leaks.length, 1, "boundary exception is limited to member routes");
const sidebarGate = scan(workspace("cbca-corp"), "/app/members", "sidebar", gateExplanation, true, "entity-kind-applicability");
assert.ok(sidebarGate.every((finding) => !isAllowed(finding, allow)), "boundary wording cannot excuse sidebar labels");

console.log("Entity copy scanner: conditional summaries and exact unavailable-page explanations pass; ordinary page/sidebar copy, changed meaning, ambiguity and out-of-scope labels remain findings.");
