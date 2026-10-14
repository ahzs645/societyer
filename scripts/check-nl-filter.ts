/**
 * Natural-language table filter parser (src/lib/nlFilter): offline, schema-only.
 * Run: npm run test:nl-filter   (DEBUG=1 prints every parse)
 */
import assert from "node:assert/strict";
import { FIELD_TYPES, type FieldType, type RecordField, type ViewFilter } from "../src/platform/record-engine/types";
import { filterRecords } from "../src/platform/record-engine/record-table/utils/filterRecords";
import {
  combineFilterTrees,
  exampleQueries,
  extractJsonObject,
  nlFieldsFromColumns,
  parseNlFilter,
  validateAiFilterReply,
  aiFilterSchema,
  aiFilterToParseResult,
  type NlContext,
  type NlParseResult,
} from "../src/lib/nlFilter";
import { DATE_RANGE_PRESETS } from "../src/lib/dateRanges";
import {
  AI_FILTER_DATE_PRESETS,
  AI_FILTER_LIMITS,
  buildAiFilterPrompt as buildSharedAiFilterPrompt,
  sanitizeAiFilterSchema,
  validateAiFilterJson,
} from "../shared/nlFilterAi";

const TODAY = "2026-10-14";

function column(name: string, label: string, fieldType: FieldType, config: Record<string, unknown> = {}, isVisible = true): RecordField {
  return {
    viewFieldId: `vf-${name}`,
    fieldMetadataId: name,
    position: 0,
    size: 160,
    isVisible,
    field: { _id: name, objectMetadataId: "o", name, label, fieldType, config, defaultValue: undefined, isSystem: false, isHidden: false, isNullable: true, isReadOnly: false, position: 0 },
  };
}
const options = (...labels: [string, string][]) => ({ options: labels.map(([value, label]) => ({ value, label })) });

const transactionColumns = [
  column("date", "Date", FIELD_TYPES.DATE),
  column("description", "Description", FIELD_TYPES.TEXT),
  column("account", "Account", FIELD_TYPES.TEXT),
  column("category", "Category", FIELD_TYPES.TEXT),
  column("amountCents", "Amount", FIELD_TYPES.CURRENCY, { currencyCode: "CAD", isCents: true }),
  column("items", "Purchase links", FIELD_TYPES.TEXT),
];
const memberColumns = [
  column("firstName", "First name", FIELD_TYPES.TEXT),
  column("lastName", "Last name", FIELD_TYPES.TEXT),
  column("email", "Email", FIELD_TYPES.EMAIL),
  column("membershipClass", "Class", FIELD_TYPES.SELECT, options(["Regular", "Regular"], ["Honorary", "Honorary"], ["Student", "Student"], ["Associate", "Associate"])),
  column("status", "Status", FIELD_TYPES.SELECT, options(["Active", "Active"], ["Inactive", "Inactive"], ["Suspended", "Suspended"])),
  column("votingRights", "Voting", FIELD_TYPES.BOOLEAN),
  column("joinedAt", "Joined", FIELD_TYPES.DATE),
  column("leftAt", "Left", FIELD_TYPES.DATE, {}, false),
  column("notes", "Notes", FIELD_TYPES.TEXT, {}, false),
];
const taskColumns = [
  column("title", "Task", FIELD_TYPES.TEXT),
  column("status", "Status", FIELD_TYPES.SELECT, options(["Todo", "To do"], ["InProgress", "In progress"], ["Blocked", "Blocked"], ["Done", "Done"], ["Unknown", "Unknown (from source)"], ["Cancelled", "Cancelled"])),
  column("priority", "Priority", FIELD_TYPES.SELECT, options(["Low", "Low"], ["Medium", "Medium"], ["High", "High"], ["Urgent", "Urgent"])),
  column("assignee", "Assignee", FIELD_TYPES.TEXT),
  column("dueDate", "Due", FIELD_TYPES.DATE),
  column("responsibleUserIds", "Responsible", FIELD_TYPES.RELATION, { targetObjectNamePlural: "users", targetLabelFieldName: "displayName" }),
  column("committeeId", "Committee", FIELD_TYPES.RELATION, { targetObjectNamePlural: "committees", targetLabelFieldName: "name" }),
  column("linkedTo", "Linked to", FIELD_TYPES.MULTI_SELECT, options(["meeting", "Meeting"], ["goal", "Goal"], ["filing", "Filing"])),
];
const filingColumns = [
  column("title", "Title", FIELD_TYPES.TEXT),
  column("status", "Status", FIELD_TYPES.SELECT, options(["draft", "Draft"], ["filed", "Filed"], ["overdue", "Overdue"])),
  column("dueDate", "Due date", FIELD_TYPES.DATE),
  column("feeCents", "Fee", FIELD_TYPES.CURRENCY, { isCents: true }),
  column("receipt", "Receipt", FIELD_TYPES.FILES),
  column("archived", "Archived", FIELD_TYPES.BOOLEAN),
];

const tables = {
  transactions: { columns: transactionColumns, context: { today: TODAY, fiscalYearEnd: "03-31", objectLabelPlural: "Transactions", objectLabelSingular: "Transaction" }, labelId: "description" },
  members: { columns: memberColumns, context: { today: TODAY, fiscalYearEnd: null, objectLabelPlural: "Members", objectLabelSingular: "Member" }, labelId: "fullName" },
  tasks: { columns: taskColumns, context: { today: TODAY, objectLabelPlural: "Tasks", objectLabelSingular: "Task" }, labelId: "title" },
  filings: { columns: filingColumns, context: { today: TODAY, objectLabelPlural: "Filings", objectLabelSingular: "Filing" }, labelId: "title" },
} satisfies Record<string, { columns: RecordField[]; context: NlContext; labelId: string }>;

type TableName = keyof typeof tables;

function parse(table: TableName, query: string): NlParseResult {
  const { columns, context, labelId } = tables[table];
  const result = parseNlFilter(query, nlFieldsFromColumns(columns, { labelIdentifierFieldName: labelId }), context);
  if (process.env.DEBUG) {
    console.log(`\n[${table}] ${query} → ${result.status}`);
    console.log("  chips:", result.chips.map((chip) => chip.text + (chip.detail ? ` (${chip.detail})` : "")).join(" · "));
    if (result.ignored.length) console.log("  ignored:", result.ignored.join(", "));
    if (result.notes.length) console.log("  notes:", result.notes.join(" | "));
    console.log("  filters:", JSON.stringify(result.filters.map((f) => [f.fieldMetadataId, f.operator, f.value])));
  }
  return result;
}

const simplify = (filters: ViewFilter[]) => filters.map((filter) => [filter.fieldMetadataId, filter.operator, filter.value]);

let count = 0;
function check(name: string, run: () => void) {
  count += 1;
  try {
    run();
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

/** Expect a fully understood parse with exactly these conditions (any order). */
function expectOk(table: TableName, query: string, expected: unknown[][], chips?: string[]) {
  check(`${table}: ${query}`, () => {
    const result = parse(table, query);
    assert.equal(result.status, "ok", `${query}: status ${result.status}, ignored ${result.ignored.join(",")}`);
    const actual = simplify(result.filters).map((entry) => JSON.stringify(entry)).sort();
    assert.deepEqual(actual, expected.map((entry) => JSON.stringify(entry)).sort(), query);
    if (chips) assert.deepEqual(result.chips.map((chip) => chip.text), chips, `${query} chips`);
  });
}

/* ---------------------------- Transactions ---------------------------- */
expectOk("transactions", "Amount over 1.5k", [["amountCents", "gte", 150000]], ["Amount ≥ $1,500"]);
expectOk("transactions", "payments over 1.5k", [["amountCents", "lte", -150000]], ["Money out ≥ $1,500"]);
expectOk("transactions", "more than $2,000", [["amountCents", "gt", 200000]]);
expectOk("transactions", "at least 500", [["amountCents", "gte", 50000]]);
expectOk("transactions", "under $50", [["amountCents", "lt", 5000]]);
expectOk("transactions", "less than 3 grand", [["amountCents", "lt", 300000]]);
expectOk("transactions", "between 1.5k and 3k", [["amountCents", "gte", 150000], ["amountCents", "lte", 300000]]);
expectOk("transactions", "$2,000+", [["amountCents", "gte", 200000]]);
expectOk("transactions", "expenses under 100", [["amountCents", "gt", -10000], ["amountCents", "lt", 0]]);
expectOk("transactions", "money in", [["amountCents", "gt", 0]], ["Money in"]);
expectOk("transactions", "deposits this year", [["amountCents", "gt", 0], ["date", "between", { start: "2026-01-01", end: "2026-12-31" }]], ["Money in", "Date: this year"]);
expectOk("transactions", "income last month", [["amountCents", "gt", 0], ["date", "between", { preset: "lastMonth" }]]);
expectOk("transactions", "last 30 days", [["date", "between", { preset: "last30" }]]);
expectOk("transactions", "in March", [["date", "between", { start: "2026-03-01", end: "2026-03-31" }]]);
expectOk("transactions", "since Jan 2026", [["date", "between", { start: "2026-01-01" }]]);
expectOk("transactions", "Q1", [["date", "between", { start: "2026-01-01", end: "2026-03-31" }]]);
expectOk("transactions", "this fiscal year", [["date", "between", { start: "2026-04-01", end: "2027-03-31" }]]);
expectOk("transactions", "last fiscal year", [["date", "between", { preset: "lastFiscalYear" }]]);
expectOk("transactions", "before 2025", [["date", "between", { end: "2024-12-31" }]]);
expectOk("transactions", "between Jan 1 2026 and March 31 2026", [["date", "between", { start: "2026-01-01", end: "2026-03-31" }]]);
expectOk("transactions", "from Coastal Hydro", [["description", "contains", "Coastal Hydro"]], ["Description contains “Coastal Hydro”"]);
expectOk("transactions", "category rent", [["category", "contains", "rent"]]);
expectOk("transactions", "uncategorised", [["category", "isEmpty", null]]);
expectOk("transactions", "without category", [["category", "isEmpty", null]]);
expectOk("transactions", "payments to BC Hydro over $200 this year", [
  ["amountCents", "lte", -20000],
  ["description", "contains", "BC Hydro"],
  ["date", "between", { start: "2026-01-01", end: "2026-12-31" }],
]);
expectOk("transactions", "Show me all transactions over 1k in Q2 2026", [["amountCents", "gte", 100000], ["date", "between", { start: "2026-04-01", end: "2026-06-30" }]]);
expectOk("transactions", "show me transactions from last week", [["date", "between", { start: "2026-10-05", end: "2026-10-11" }]]);
expectOk("transactions", "category is rent or utilities", [["category", "contains", "rent"], ["category", "contains", "utilities"]]);
expectOk("transactions", "over 1k this year or over 5k last year", [
  ["amountCents", "gte", 100000],
  ["date", "between", { start: "2026-01-01", end: "2026-12-31" }],
  ["amountCents", "gte", 500000],
  ["date", "between", { start: "2025-01-01", end: "2025-12-31" }],
]);
expectOk("transactions", "1k or over", [["amountCents", "gte", 100000]]);
expectOk("transactions", "account chequing and expenses", [["account", "contains", "chequing"], ["amountCents", "lt", 0]]);

/* ------------------------------- Members ------------------------------- */
expectOk("members", "active members", [["status", "eq", "Active"]], ["Status is Active"]);
expectOk("members", "active or suspended", [["status", "in", ["Active", "Suspended"]]], ["Status is Active or Suspended"]);
expectOk("members", "not active", [["status", "neq", "Active"]]);
expectOk("members", "named Patel", [["firstName", "contains", "Patel"], ["lastName", "contains", "Patel"]], ["(First name contains “Patel” or Last name contains “Patel”)"]);
expectOk("members", "joined this year", [["joinedAt", "between", { start: "2026-01-01", end: "2026-12-31" }]], ["Joined: this year"]);
expectOk("members", "left in 2025", [["leftAt", "between", { start: "2025-01-01", end: "2025-12-31" }]]);
expectOk("members", "non-voting student members", [["votingRights", "isFalse", null], ["membershipClass", "eq", "Student"]]);
expectOk("members", "voting members without email", [["votingRights", "isTrue", null], ["email", "isEmpty", null]]);
expectOk("members", "honorary class", [["membershipClass", "eq", "Honorary"]]);
expectOk("members", "status is inactive and joined before 2020", [["status", "eq", "Inactive"], ["joinedAt", "between", { end: "2019-12-31" }]]);
expectOk("members", "suspnded", [["status", "eq", "Suspended"]]);

/* -------------------------------- Tasks -------------------------------- */
expectOk("tasks", "overdue", [["dueDate", "lt", TODAY], ["status", "notIn", ["Done", "Cancelled"]]]);
expectOk("tasks", "high priority tasks due this month", [["priority", "eq", "High"], ["dueDate", "between", { preset: "thisMonth" }]]);
expectOk("tasks", "assigned to Sam", [["assignee", "contains", "Sam"], ["responsibleUserIds", "contains", "Sam"]]);
expectOk("tasks", "in progress or blocked", [["status", "in", ["InProgress", "Blocked"]]]);
expectOk("tasks", "to do", [["status", "eq", "Todo"]]);
expectOk("tasks", "completed tasks", [["status", "eq", "Done"]]);
expectOk("tasks", "unassigned", [["assignee", "isEmpty", null], ["responsibleUserIds", "isEmpty", null]]);
expectOk("tasks", "linked to meeting", [["linkedTo", "contains", "meeting"]]);
expectOk("tasks", "due next week", [["dueDate", "between", { start: "2026-10-19", end: "2026-10-25" }]]);
expectOk("tasks", "urgent or high priority due before Nov 1", [["priority", "in", ["Urgent", "High"]], ["dueDate", "between", { end: "2026-10-31" }]]);
expectOk("tasks", "open high priority", [["status", "notIn", ["Done", "Cancelled"]], ["priority", "eq", "High"]]);
check("tasks: 'assigned to me' has no person to match, so it is reported", () => {
  const result = parse("tasks", "tasks assigned to me");
  assert.equal(result.status, "none");
  assert.deepEqual(result.ignored, ["assigned", "me"]);
});
check("transactions: or-clauses sharing a free-text column share the rest", () => {
  const result = parse("transactions", "category is rent or utilities this year");
  assert.equal(result.status, "ok");
  assert.equal(result.root?.operator, "and");
  assert.equal(result.root?.children[0].kind, "group");
});
check("tasks: or across different fields becomes an any-of root", () => {
  const result = parse("tasks", "blocked or assigned to Sam");
  assert.equal(result.status, "ok");
  assert.equal(result.root?.operator, "or");
  assert.equal(result.filterGroups.find((group) => !group.parentViewFilterGroupId)?.logicalOperator, "or");
});

/* ------------------------------- Filings ------------------------------- */
expectOk("filings", "overdue", [["status", "eq", "overdue"]]);
expectOk("filings", "drafts", [["status", "eq", "draft"]]);
expectOk("filings", "with no receipt", [["receipt", "isEmpty", null]], ["No receipt"]);
expectOk("filings", "not archived", [["archived", "isFalse", null]], ["Not archived"]);
expectOk("filings", "archived", [["archived", "isTrue", null]]);
expectOk("filings", "fee over $100 due date this year", [["feeCents", "gte", 10000], ["dueDate", "between", { start: "2026-01-01", end: "2026-12-31" }]]);

/* ------------------------- Negative / ambiguous ------------------------- */
check("partial: unknown words are reported, never silently dropped", () => {
  const result = parse("transactions", "wires to Jane this year");
  // "wires" isn't a column, option or direction here.
  assert.equal(result.status, "partial");
  assert.deepEqual(result.ignored, ["wires"]);
  assert.ok(result.filters.length >= 1);
});
check("partial: missing column for 'receipt'", () => {
  const result = parse("transactions", "payments with no receipt");
  assert.equal(result.status, "partial");
  assert.ok(result.ignored.includes("receipt"));
});
check("none: gibberish suggests examples", () => {
  const result = parse("transactions", "flibbertigibbet");
  assert.equal(result.status, "none");
  assert.equal(result.filters.length, 0);
  assert.ok(result.suggestions.length >= 3);
});
check("none: amounts on a table without money columns", () => {
  const result = parse("members", "over 1.5k");
  assert.equal(result.status, "none");
});
check("empty input", () => assert.equal(parse("tasks", "   ").status, "empty"));
check("fiscal year without a fiscal year end is not applied", () => {
  const result = parse("members", "joined this fiscal year");
  assert.notEqual(result.status, "ok");
  assert.ok(result.notes.some((note) => /fiscal year end/i.test(note)));
});
check("'may' alone is a word, not a month", () => {
  const result = parse("tasks", "may be blocked");
  assert.ok(!result.filters.some((filter) => filter.operator === "between"));
});
check("bare year needs a preposition; amounts never read as years", () => {
  const result = parse("transactions", "between 2024 and 2025");
  assert.deepEqual(simplify(result.filters), [["date", "between", { start: "2024-01-01", end: "2025-12-31" }]]);
});
check("money in and out together drop direction with a note", () => {
  const result = parse("transactions", "income and expenses");
  assert.ok(result.notes.some((note) => /money in and money out/i.test(note)));
  assert.equal(result.filters.length, 0);
});
check("ambiguous option label notes which column won", () => {
  const columns = [...memberColumns, column("standing", "Standing", FIELD_TYPES.SELECT, options(["Active", "Active"], ["Lapsed", "Lapsed"]))];
  const result = parseNlFilter("active", nlFieldsFromColumns(columns), tables.members.context);
  assert.equal(result.filters[0]?.fieldMetadataId, "status");
  assert.ok(result.notes.length === 1);
});

/* --------------------------- End-to-end match --------------------------- */
check("parsed filters run through the RecordTable filter engine", () => {
  const records = [
    { _id: "a", date: "2026-02-03", description: "BC Hydro", amountCents: -25000, category: "Utilities" },
    { _id: "b", date: "2026-05-01", description: "BC Hydro", amountCents: -9000, category: "" },
    { _id: "c", date: "2025-12-30", description: "BC Hydro", amountCents: -40000, category: "Utilities" },
    { _id: "d", date: "2026-06-10", description: "Grant deposit", amountCents: 500000, category: "Grants" },
  ];
  const run = (query: string) => {
    const result = parse("transactions", query);
    return filterRecords({ records, columns: transactionColumns, filters: result.filters, filterGroups: result.filterGroups, dateContext: { today: TODAY, fiscalYearEnd: "03-31" } }).map((record) => record._id);
  };
  assert.deepEqual(run("payments to BC Hydro over $200 this year"), ["a"]);
  assert.deepEqual(run("expenses under 100"), ["b"]);
  assert.deepEqual(run("uncategorised"), ["b"]);
  assert.deepEqual(run("deposits or uncategorised"), ["b", "d"]);
});
check("relation contains matches the display label", () => {
  const records = [
    { _id: "1", assignee: "", responsibleUserIds: ["u1"], responsibleUserIdsLabel: "Sam Lee" },
    { _id: "2", assignee: "Priya", responsibleUserIds: ["u2"], responsibleUserIdsLabel: "Priya Shah" },
  ];
  const result = parse("tasks", "assigned to sam");
  assert.deepEqual(filterRecords({ records, columns: taskColumns, filters: result.filters, filterGroups: result.filterGroups }).map((record) => record._id), ["1"]);
});

/* ------------------------------ Examples ------------------------------ */
for (const table of Object.keys(tables) as TableName[]) {
  const { columns, context, labelId } = tables[table];
  const fields = nlFieldsFromColumns(columns, { labelIdentifierFieldName: labelId });
  const examples = exampleQueries(fields, context);
  check(`${table}: examples parse cleanly`, () => {
    assert.ok(examples.length >= 3, `${table} has ${examples.length} examples`);
    for (const example of examples) assert.equal(parse(table, example).status, "ok", `${table} example "${example}"`);
  });
}

/* -------------------------------- Merge -------------------------------- */
check("merge ANDs onto current filters and replaces same-column conditions", () => {
  const current = parse("transactions", "category rent last month");
  const next = parse("transactions", "over 1k this year");
  const merged = combineFilterTrees(current, next, "merge");
  const summary = simplify(merged.filters).map((entry) => entry.slice(0, 2).join(":")).sort();
  assert.deepEqual(summary, ["amountCents:gte", "category:contains", "date:between"]);
  assert.equal(merged.filterGroups.filter((group) => !group.parentViewFilterGroupId).length, 1);
  assert.deepEqual(combineFilterTrees(current, next, "replace"), { filters: next.filters, filterGroups: next.filterGroups });
});
check("merge nests an any-of request under the current all-of root", () => {
  const current = parse("tasks", "high priority");
  const next = parse("tasks", "blocked or assigned to Sam");
  const merged = combineFilterTrees(current, next, "merge");
  const root = merged.filterGroups.find((group) => !group.parentViewFilterGroupId)!;
  assert.equal(root.logicalOperator, "and");
  assert.equal(merged.filterGroups.filter((group) => group.parentViewFilterGroupId === root.id).length, 1);
});

/* --------------------------------- AI --------------------------------- */
check("AI replies are validated against the schema", () => {
  const fields = nlFieldsFromColumns(transactionColumns);
  const reply = extractJsonObject('```json\n{"operator":"and","conditions":[{"field":"amountCents","operator":"gte","value":1500},{"field":"secret","operator":"eq","value":"x"},{"field":"date","operator":"between","value":{"preset":"yearToDate"}}],"unmatched":["wires"]}\n```');
  const result = validateAiFilterReply(reply, fields, "wires over 1.5k ytd");
  assert.equal(result.source, "ai");
  assert.equal(result.status, "partial");
  assert.deepEqual(simplify(result.filters), [["amountCents", "gte", 150000], ["date", "between", { preset: "yearToDate" }]]);
  assert.deepEqual(validateAiFilterReply("nope", fields, "x").status, "none");
  assert.equal(validateAiFilterReply({ conditions: [{ field: "date", operator: "between", value: { start: "soon" } }] }, fields, "x").status, "none");
});

/* ------------------- shared AI validator (shared/nlFilterAi.ts) ------------------- */
const memberSchema = aiFilterSchema(nlFieldsFromColumns(memberColumns));
const transactionSchema = aiFilterSchema(nlFieldsFromColumns(transactionColumns));
check("client schema: ids, labels, types, operators, option values and isCents only", () => {
  const amount = transactionSchema.find((field) => field.id === "amountCents")!;
  assert.deepEqual(Object.keys(amount).sort(), ["id", "isCents", "label", "operators", "type"]);
  assert.equal(amount.isCents, true);
  const status = memberSchema.find((field) => field.id === "status")!;
  assert.deepEqual(status.options, [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }, { value: "Suspended", label: "Suspended" }]);
  assert.ok(status.operators.includes("in") && !status.operators.includes("between"));
  for (const field of [...memberSchema, ...transactionSchema]) {
    assert.ok(Object.keys(field).every((key) => ["id", "label", "type", "operators", "options", "isCents"].includes(key)), field.id);
  }
});
check("shared date presets mirror the date range picker", () => {
  assert.deepEqual([...AI_FILTER_DATE_PRESETS], DATE_RANGE_PRESETS.map((preset) => preset.id));
});
check("prompt carries the schema, date and request — nothing else", () => {
  const { system, user } = buildSharedAiFilterPrompt(transactionSchema, "wires over 1.5k", { today: TODAY, fiscalYearEnd: "03-31" });
  assert.match(system, /single JSON object/);
  const payload = JSON.parse(user);
  assert.deepEqual(Object.keys(payload).sort(), ["datePresets", "fields", "fiscalYearEnd", "request", "today"]);
  assert.equal(payload.today, TODAY);
  assert.equal(payload.request, "wires over 1.5k");
  const amount = payload.fields.find((field: any) => field.id === "amountCents");
  assert.equal(amount.unit, "dollars");
  assert.equal(amount.isCents, undefined, "the model answers in dollars; cents stay server-side");
});
check("sanitizer drops malformed fields, unknown operators and extra keys", () => {
  const schema = sanitizeAiFilterSchema([
    { id: "status", label: "Status", type: "SELECT", operators: ["eq", "drop table", "in"], options: [{ value: "Active", label: "Active", rows: 4 }], rows: [{ id: 1 }] },
    { id: "status", label: "Duplicate", type: "SELECT", operators: ["eq"] },
    { id: "", label: "No id", type: "TEXT", operators: ["eq"] },
    { id: "notes", label: "Notes", type: "TEXT", operators: ["nope"] },
    { id: "fee", label: "Fee", type: "NUMBER", operators: ["gt"], isCents: true },
    { id: "lower", label: "Lower", type: "text", operators: ["eq"] },
    "junk",
  ]);
  assert.deepEqual(schema, [
    { id: "status", label: "Status", type: "SELECT", operators: ["eq", "in"], options: [{ value: "Active", label: "Active" }] },
    { id: "fee", label: "Fee", type: "NUMBER", operators: ["gt"] },
  ]);
  assert.equal(sanitizeAiFilterSchema(Array.from({ length: 200 }, (_, index) => ({ id: `f${index}`, label: `F${index}`, type: "TEXT", operators: ["eq"] }))).length, AI_FILTER_LIMITS.fields);
  assert.deepEqual(sanitizeAiFilterSchema("nope"), []);
  assert.deepEqual(sanitizeAiFilterSchema(memberSchema), memberSchema, "idempotent on a well-formed schema");
});
check("validator drops out-of-schema fields, operators and values, and counts them", () => {
  const result = validateAiFilterJson({
    operator: "and",
    conditions: [
      { field: "status", operator: "eq", value: "active" },
      { field: "status", operator: "between", value: { preset: "today" } },
      { field: "salary", operator: "gt", value: 5 },
      { field: "membershipClass", operator: "in", value: ["Regular", "Platinum"] },
      { field: "joinedAt", operator: "between", value: { preset: "nextDecade" } },
      { field: "joinedAt", operator: "gt", value: "2026-01-01" },
      { field: "email", operator: "isEmpty", value: "ignored" },
      { field: "firstName", operator: "contains", value: "x".repeat(500) },
      "junk",
    ],
    groups: [{ operator: "or", conditions: [{ field: "votingRights", operator: "isTrue" }, { field: "lastName", operator: "startsWith", value: " Pat " }] }, { operator: "or", conditions: [{ field: "nope", operator: "eq", value: 1 }] }],
    unmatched: ["platinum", 4, "  "],
  }, memberSchema);
  assert.equal(result.droppedCount, 7);
  assert.deepEqual(result.unmatched, ["platinum"]);
  assert.deepEqual(result.filter, {
    operator: "and",
    conditions: [
      { field: "status", operator: "eq", value: "Active" },
      { field: "joinedAt", operator: "gt", value: "2026-01-01" },
      { field: "email", operator: "isEmpty", value: null },
    ],
    groups: [{ operator: "or", conditions: [{ field: "votingRights", operator: "isTrue", value: null }, { field: "lastName", operator: "startsWith", value: "Pat" }] }],
  });
  assert.match(result.notes[0], /Left out 7 suggested conditions/);
});
check("validator converts dollars to cents only for isCents currency", () => {
  const cents = validateAiFilterJson({ conditions: [{ field: "amountCents", operator: "gte", value: "$1,500.50" }, { field: "date", operator: "between", value: { start: "2026-01-01" } }] }, transactionSchema);
  assert.deepEqual(cents.filter?.conditions, [
    { field: "amountCents", operator: "gte", value: 150050 },
    { field: "date", operator: "between", value: { start: "2026-01-01" } },
  ]);
  const plain = sanitizeAiFilterSchema([{ id: "amount", label: "Amount", type: "CURRENCY", operators: ["gte"] }]);
  assert.equal(validateAiFilterJson({ conditions: [{ field: "amount", operator: "gte", value: 12 }] }, plain).filter?.conditions[0].value, 12);
});
check("validator caps conditions and rejects non-objects", () => {
  const many = validateAiFilterJson({ conditions: Array.from({ length: 20 }, () => ({ field: "email", operator: "isNotEmpty" })) }, memberSchema);
  assert.equal(many.filter?.conditions.length, AI_FILTER_LIMITS.conditions);
  assert.equal(many.droppedCount, 20 - AI_FILTER_LIMITS.conditions);
  for (const raw of [null, "x", [], 4]) {
    const result = validateAiFilterJson(raw, memberSchema);
    assert.equal(result.filter, null);
    assert.equal(result.droppedCount, 0);
  }
  assert.deepEqual(extractJsonObject("Sure! ```json\n{\"operator\":\"or\"}\n``` hope that helps"), { operator: "or" });
  assert.equal(extractJsonObject("no json here"), null);
  assert.equal(extractJsonObject("{not json}"), null);
});
check("server result becomes preview chips; columns the table lost are counted", () => {
  const fields = nlFieldsFromColumns(memberColumns);
  const result = aiFilterToParseResult({
    filter: { operator: "or", conditions: [{ field: "status", operator: "eq", value: "Active" }, { field: "gone", operator: "eq", value: "x" }], groups: [] },
    unmatched: [],
    droppedCount: 1,
    notes: [],
  }, fields, "active");
  assert.equal(result.source, "ai");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.chips.map((chip) => chip.text), ["Status is Active"]);
  assert.match(result.notes[0], /Left out 2 suggested conditions/);
  const none = aiFilterToParseResult({ filter: null, unmatched: ["moon"], droppedCount: 0, notes: [] }, fields, "moon");
  assert.equal(none.status, "none");
  assert.deepEqual(none.ignored, ["moon"]);
});

console.log(`nl-filter: ${count} checks passed`);
