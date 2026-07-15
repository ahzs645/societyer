import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FIELD_TYPES } from "../src/modules/object-record/types/FieldType";
import { isFieldEditable } from "../src/modules/object-record/record-field/components/FieldInput";
import {
  LAB_EDIT_VALUES,
  LAB_FIELDS,
  applyLabEdit,
  initialLabRecord,
} from "../src/modules/object-record/record-table/testing/fieldLabFixture";

const ROOT = join(process.cwd(), "src");

const recordTableContextSource = readFileSync(
  join(ROOT, "modules/object-record/record-table/contexts/RecordTableContext.ts"),
  "utf8",
);
const recordTableScopeSource = readFileSync(
  join(ROOT, "modules/object-record/record-table/components/RecordTableScope.tsx"),
  "utf8",
);
const recordTableSidePanelSource = readFileSync(
  join(ROOT, "modules/object-record/record-table/components/RecordTableSidePanel.tsx"),
  "utf8",
);
const meetingsSource = readFileSync(join(ROOT, "pages/Meetings.tsx"), "utf8");

const REVIEWED_RECORD_TABLE_FILES: Record<string, number> = {
  "src/features/financials/pages/WavePages.tsx": 2,
  "src/pages/ApiKeysPage.tsx": 2,
  "src/pages/Assets.tsx": 1,
  "src/pages/Attestations.tsx": 1,
  "src/pages/AuditLog.tsx": 1,
  "src/pages/Auditors.tsx": 1,
  "src/pages/Commitments.tsx": 1,
  "src/pages/Communications.tsx": 4,
  "src/pages/Conflicts.tsx": 1,
  "src/pages/CourtOrders.tsx": 1,
  "src/pages/CustomFields.tsx": 1,
  "src/pages/Deadlines.tsx": 1,
  "src/pages/Directors.tsx": 1,
  "src/pages/Documents.tsx": 1,
  "src/pages/Employees.tsx": 1,
  "src/pages/Filings.tsx": 1,
  "src/pages/Financials.tsx": 1,
  "src/pages/Grants.tsx": 4,
  "src/pages/Inspections.tsx": 1,
  "src/pages/Insurance.tsx": 1,
  "src/pages/Meetings.tsx": 1,
  "src/pages/MemberProposals.tsx": 1,
  "src/pages/Members.tsx": 1,
  "src/pages/Minutes.tsx": 1,
  "src/pages/Motions.tsx": 1,
  "src/pages/OrganizationHistory.tsx": 1,
  "src/pages/Outbox.tsx": 1,
  "src/pages/PipaTraining.tsx": 1,
  "src/pages/Proxies.tsx": 1,
  "src/pages/Receipts.tsx": 1,
  "src/pages/Reconciliation.tsx": 1,
  "src/pages/RecordTableFieldLab.tsx": 1,
  "src/pages/Retention.tsx": 1,
  "src/pages/Secrets.tsx": 1,
  "src/pages/Transparency.tsx": 1,
  "src/pages/Volunteers.tsx": 3,
  "src/pages/WorkflowRuns.tsx": 1,
  "src/pages/Workflows.tsx": 1,
  "src/pages/WrittenResolutions.tsx": 1,
};

const REVIEWED_LEGACY_DATA_TABLE_FILES: Record<string, number> = {
  "src/features/financials/pages/WavePages.tsx": 1,
  "src/features/grants/components/GrantSourceLibrary.tsx": 1,
  "src/pages/Assets.tsx": 3,
  "src/pages/Communications.tsx": 1,
  "src/pages/OrganizationHistory.tsx": 1,
  "src/pages/inventory/tabs.tsx": 6,
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function countPattern(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function collectOccurrences(pattern: RegExp) {
  return Object.fromEntries(
    sourceFiles(ROOT)
      .map((file) => {
        const count = countPattern(readFileSync(file, "utf8"), pattern);
        return [relative(process.cwd(), file), count] as const;
      })
      .filter(([, count]) => count > 0),
  );
}

assert.deepEqual(
  collectOccurrences(/<RecordTable\b/g),
  REVIEWED_RECORD_TABLE_FILES,
  "RecordTable inventory changed; review the new/removed instance and update the acceptance manifest",
);
assert.deepEqual(
  collectOccurrences(/<DataTable(?:<|\s)/g),
  REVIEWED_LEGACY_DATA_TABLE_FILES,
  "Legacy DataTable inventory changed; review its migration status and update the manifest",
);

assert.match(
  recordTableContextSource,
  /options:\s*RecordTableOpenOptions/,
  "record-open callbacks receive the current view's opening mode",
);
assert.match(
  recordTableScopeSource,
  /options\.openRecordIn === "drawer"[\s\S]*setSidePanelRecord/,
  "normal record opens are intercepted by the shared preview sidebar",
);
assert.match(
  recordTableScopeSource,
  /onOpenRecord[\s\S]*openRecordIn: "page"/,
  "the preview sidebar delegates its Open action to the full record surface",
);
assert.match(
  recordTableSidePanelSource,
  /Record sidebar tabs[\s\S]*Home[\s\S]*Timeline[\s\S]*Notes/,
  "the preview sidebar provides the Researcher-style tab structure",
);
assert.match(
  recordTableSidePanelSource,
  /resolveFieldIcon\(field\)/,
  "the preview sidebar resolves the same metadata-aware icon as the table header",
);
assert.doesNotMatch(
  recordTableSidePanelSource,
  /<FileText size=\{16\}/,
  "the preview sidebar must not replace every field icon with a generic document icon",
);
assert.match(
  recordTableSidePanelSource,
  /RecordTableFloatingCellEditor[\s\S]*onUpdate\?\.\(\{ recordId, fieldName: field\.name, value: nextValue \}\)/,
  "the preview sidebar reuses the table's field-type editor and update path",
);
assert.match(
  meetingsSource,
  /onRecordClick=\{\(recordId\) => navigate\(`\/app\/meetings\//,
  "the sidebar Open action routes Meetings to its full record page",
);

const expectedTypes = new Set(Object.values(FIELD_TYPES));
assert.equal(LAB_FIELDS.length, expectedTypes.size, "field lab has exactly one column per field type");
assert.deepEqual(
  new Set(LAB_FIELDS.map((field) => field.fieldType)),
  expectedTypes,
  "field lab covers every canonical field type",
);
for (const field of LAB_FIELDS) {
  assert.equal(isFieldEditable(field), true, `${field.fieldType} is editable in the demo lab`);
  assert.ok(field.name in LAB_EDIT_VALUES, `${field.fieldType} has an acceptance edit value`);
}

const relationLabels = new Map([
  ["member-avery", "Avery Chen"],
  ["member-morgan", "Morgan Patel"],
]);
let editedRecord = initialLabRecord();
for (const field of LAB_FIELDS) {
  const initialValue = editedRecord[field.name];
  const editValue = LAB_EDIT_VALUES[field.name];
  assert.notDeepEqual(editValue, initialValue, `${field.fieldType} acceptance edit changes the value`);
  editedRecord = applyLabEdit(editedRecord, field.name, editValue, relationLabels);
  assert.deepEqual(editedRecord[field.name], editValue, `${field.fieldType} edit is retained`);
}
assert.equal(editedRecord.relationLabel, "Morgan Patel", "relation edit refreshes its display label");

const recordTableCount = Object.values(REVIEWED_RECORD_TABLE_FILES).reduce((sum, count) => sum + count, 0);
const legacyCount = Object.values(REVIEWED_LEGACY_DATA_TABLE_FILES).reduce((sum, count) => sum + count, 0);
console.log(
  `record table acceptance checks passed: ${recordTableCount} RecordTable instances, ${legacyCount} legacy DataTable instances, ${LAB_FIELDS.length} field types`,
);
