/** Workspace-wide governance tools: the snapshot, tasks, deadlines, commitments. */
import { z } from "zod";
import { localDateKey } from "../../dateOnly";
import { interfaceRouteReadPermission } from "../../interfaceRouteAccess";
import { AgentToolError, READ_ANNOTATIONS, defineAgentTool, type AgentToolAdapter } from "../types";
import {
  UNTRUSTED_NOTICE,
  asRows,
  dateOnly,
  dateString,
  idOf,
  isRow,
  label,
  limitInput,
  matchesQuery,
  page,
  untrusted,
  untrustedTextSchema,
  type Row,
} from "../output";

const can = (adapter: AgentToolAdapter, permission: string) => adapter.context.principal.permissions.includes(permission);
const societyArgs = (adapter: AgentToolAdapter) => ({ societyId: adapter.context.workspace.id });

function isOpenDeadline(record: Row) {
  return (record.status ?? (record.done ? "complete" : "open")) === "open";
}

function isOpenTask(record: Row) {
  return ["Todo", "InProgress", "Blocked"].includes(String(record.status));
}

const snapshotItem = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.string().optional(),
  scheduledAt: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
});

function item(record: Row, dateField: "dueDate" | "scheduledAt") {
  return {
    id: idOf(record),
    title: label(record.title ?? record.kind) ?? "Untitled",
    ...(typeof record[dateField] === "string" ? { [dateField]: record[dateField] as string } : {}),
    ...(label(record.status) ? { status: label(record.status) } : {}),
    ...(label(record.category) ? { category: label(record.category) } : {}),
    ...(label(record.priority) ? { priority: label(record.priority) } : {}),
  };
}

const RESOURCE_LISTS = [
  { resource: "deadlines", permission: "deadlines:read", query: "deadlines:list" },
  { resource: "filings", permission: "filings:read", query: "filings:list" },
  { resource: "meetings", permission: "meetings:read", query: "meetings:list" },
  { resource: "tasks", permission: "tasks:read", query: "tasks:list" },
] as const;

export const getGovernanceSnapshot = defineAgentTool({
  name: "get_governance_snapshot",
  title: "Get governance snapshot",
  description:
    "Read the active Societyer workspace's compliance posture across deadlines, filings, meetings, tasks, and rule-based flags. Use this before recommending or creating work.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [
    { name: "dashboard:summary", kind: "query" },
    ...RESOURCE_LISTS.map((list) => ({ name: list.query, kind: "query" as const })),
  ],
  requires: ["society:read"],
  enrichesWith: RESOURCE_LISTS.map((list) => list.permission),
  input: z.strictObject({
    horizonDays: z.number().int().min(1).max(365).default(45).describe("Days ahead to look for upcoming items."),
    maxItems: z.number().int().min(1).max(20).default(8).describe("Most items per list."),
  }),
  async handler({ horizonDays, maxItems }, adapter) {
    const now = adapter.context.now();
    const today = localDateKey(now);
    const horizon = new Date(now.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);
    const [dashboard, ...lists] = await Promise.all([
      adapter.query<unknown>("dashboard:summary", societyArgs(adapter)),
      ...RESOURCE_LISTS.map((list) => (can(adapter, list.permission) ? adapter.query<unknown>(list.query, societyArgs(adapter)) : Promise.resolve([]))),
    ]);
    const [deadlines, filings, meetings, tasks] = lists.map(asRows);
    const restrictedResources = RESOURCE_LISTS.filter((list) => !can(adapter, list.permission)).map((list) => list.resource);
    const byDue = (a: Row, b: Row) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate));
    const due = (rows: Row[], keep: (row: Row) => boolean) => rows.filter(keep).sort(byDue).slice(0, maxItems).map((row) => item(row, "dueDate"));
    const unfiled = (row: Row) => row.status !== "Filed";
    const summary = isRow(dashboard) ? dashboard : {};
    return {
      workspace: {
        name: adapter.context.workspace.name,
        jurisdictionCode: adapter.context.workspace.jurisdictionCode,
        entityType: adapter.context.workspace.entityType,
      },
      generatedAt: now.toISOString(),
      restrictedResources,
      horizonDays,
      summaryCounts: isRow(summary.counts) ? summary.counts : {
        openDeadlines: deadlines.filter(isOpenDeadline).length,
        openTasks: tasks.filter(isOpenTask).length,
        overdueFilings: filings.filter((row) => unfiled(row) && dateOnly(row.dueDate) < today).length,
      },
      attention: {
        overdueDeadlines: due(deadlines, (row) => isOpenDeadline(row) && dateOnly(row.dueDate) < today),
        dueSoonDeadlines: due(deadlines, (row) => isOpenDeadline(row) && dateOnly(row.dueDate) >= today && dateOnly(row.dueDate) <= horizon),
        overdueFilings: due(filings, (row) => unfiled(row) && dateOnly(row.dueDate) < today),
        upcomingFilings: due(filings, (row) => unfiled(row) && dateOnly(row.dueDate) >= today && dateOnly(row.dueDate) <= horizon),
        upcomingMeetings: meetings
          .filter((row) => dateOnly(row.scheduledAt) >= today && dateOnly(row.scheduledAt) <= horizon)
          .sort((a, b) => dateOnly(a.scheduledAt).localeCompare(dateOnly(b.scheduledAt)))
          .slice(0, maxItems)
          .map((row) => item(row, "scheduledAt")),
        openTasks: tasks
          .filter(isOpenTask)
          .sort((a, b) => (dateOnly(a.dueDate) || "9999").localeCompare(dateOnly(b.dueDate) || "9999"))
          .slice(0, maxItems)
          .map((row) => item(row, "dueDate")),
        complianceFlags: asRows(summary.complianceFlags).slice(0, maxItems).map((flag) => ({
          ruleId: label(flag.ruleId),
          level: label(flag.level),
          text: label(flag.text, 400),
          evidenceRequired: Array.isArray(flag.evidenceRequired) ? flag.evidenceRequired.slice(0, 8).map((entry) => label(entry)).filter(Boolean) : undefined,
        })),
      },
      collaboration: {
        nextStep: can(adapter, "tasks:write")
          ? "Review the risks with the user, then call create_governance_tasks for the actions they approve."
          : "Review the accessible records with the user. Your role cannot create governance tasks.",
        reviewViews: ["deadlines", "filings", "tasks", "meetings"].filter((view) => !restrictedResources.includes(view as (typeof restrictedResources)[number])),
      },
    };
  },
  output: z.object({
    workspace: z.object({ name: z.string().optional(), jurisdictionCode: z.string().optional(), entityType: z.string().optional() }),
    generatedAt: z.string(),
    restrictedResources: z.array(z.string()),
    horizonDays: z.number(),
    summaryCounts: z.record(z.string(), z.unknown()),
    attention: z.object({
      overdueDeadlines: z.array(snapshotItem),
      dueSoonDeadlines: z.array(snapshotItem),
      overdueFilings: z.array(snapshotItem),
      upcomingFilings: z.array(snapshotItem),
      upcomingMeetings: z.array(snapshotItem),
      openTasks: z.array(snapshotItem),
      complianceFlags: z.array(z.record(z.string(), z.unknown())),
    }),
    collaboration: z.object({ nextStep: z.string(), reviewViews: z.array(z.string()) }),
  }),
});

const TASK_STATUSES = ["Todo", "InProgress", "Blocked", "Done"] as const;

export const listTasks = defineAgentTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List the workspace's tasks, open ones by default, soonest due first.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "tasks:list", kind: "query" }],
  requires: ["tasks:read"],
  input: z.strictObject({
    status: z.enum(["open", "all", ...TASK_STATUSES]).default("open").describe("open = Todo, InProgress or Blocked."),
    dueBefore: dateString.optional().describe("Only tasks due on or before this date."),
    query: z.string().max(200).optional().describe("Words to match in the title, assignee or tags."),
    limit: limitInput(20, 50),
  }),
  async handler({ status, dueBefore, query, limit }, adapter) {
    const rows = asRows(await adapter.query("tasks:list", societyArgs(adapter)))
      .filter((row) => (status === "all" ? true : status === "open" ? isOpenTask(row) : row.status === status))
      .filter((row) => !dueBefore || (dateOnly(row.dueDate) && dateOnly(row.dueDate) <= dueBefore))
      .filter((row) => matchesQuery(query, [row.title, row.assignee, row.tags]))
      .sort((a, b) => (dateOnly(a.dueDate) || "9999").localeCompare(dateOnly(b.dueDate) || "9999"));
    const { items, total, truncated } = page(rows, limit);
    return {
      notice: UNTRUSTED_NOTICE,
      total,
      truncated,
      tasks: items.map((row) => ({
        id: idOf(row),
        title: label(row.title) ?? "Untitled",
        status: label(row.status),
        priority: label(row.priority),
        dueDate: label(row.dueDate),
        assignee: label(row.assignee),
        tags: Array.isArray(row.tags) ? row.tags.slice(0, 8).map((tag) => label(tag, 40)).filter((tag): tag is string => Boolean(tag)) : [],
        description: untrusted(row.description, 500),
      })),
    };
  },
  output: z.object({
    notice: z.string(),
    total: z.number(),
    truncated: z.boolean(),
    tasks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string().optional(),
      priority: z.string().optional(),
      dueDate: z.string().optional(),
      assignee: z.string().optional(),
      tags: z.array(z.string()),
      description: untrustedTextSchema.optional(),
    })),
  }),
});

export const listDeadlines = defineAgentTool({
  name: "list_deadlines",
  title: "List deadlines",
  description: "List compliance deadlines, open ones by default, soonest first, with whether each is overdue.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "deadlines:list", kind: "query" }],
  requires: ["deadlines:read"],
  input: z.strictObject({
    status: z.enum(["open", "complete", "all"]).default("open"),
    dueBefore: dateString.optional(),
    limit: limitInput(20, 50),
  }),
  async handler({ status, dueBefore, limit }, adapter) {
    const today = localDateKey(adapter.context.now());
    const rows = asRows(await adapter.query("deadlines:list", societyArgs(adapter)))
      .filter((row) => (status === "all" ? true : status === "open" ? isOpenDeadline(row) : !isOpenDeadline(row)))
      .filter((row) => !dueBefore || dateOnly(row.dueDate) <= dueBefore)
      .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)));
    const { items, total, truncated } = page(rows, limit);
    return {
      notice: UNTRUSTED_NOTICE,
      total,
      truncated,
      deadlines: items.map((row) => ({
        id: idOf(row),
        title: label(row.title) ?? "Untitled",
        dueDate: dateOnly(row.dueDate),
        category: label(row.category),
        status: isOpenDeadline(row) ? "open" : String(row.status ?? "complete"),
        overdue: isOpenDeadline(row) && dateOnly(row.dueDate) < today,
        description: untrusted(row.description, 500),
      })),
    };
  },
  output: z.object({
    notice: z.string(),
    total: z.number(),
    truncated: z.boolean(),
    deadlines: z.array(z.object({
      id: z.string(),
      title: z.string(),
      dueDate: z.string(),
      category: z.string().optional(),
      status: z.string(),
      overdue: z.boolean(),
      description: untrustedTextSchema.optional(),
    })),
  }),
});

export const listCommitments = defineAgentTool({
  name: "list_commitments",
  title: "List commitments",
  description: "List recurring obligations from contracts, grants and policies, with what each requires and when it is next due.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "commitments:list", kind: "query" }],
  requires: ["commitments:read"],
  input: z.strictObject({
    status: z.string().max(40).optional().describe("Active, Watching, Paused or Closed. Default: everything but Closed."),
    limit: limitInput(20, 50),
  }),
  async handler({ status, limit }, adapter) {
    const rows = asRows(await adapter.query("commitments:list", societyArgs(adapter)))
      .filter((row) => (status ? String(row.status).toLowerCase() === status.toLowerCase() : row.status !== "Closed"))
      .sort((a, b) => (dateOnly(a.nextDueDate) || "9999").localeCompare(dateOnly(b.nextDueDate) || "9999"));
    const { items, total, truncated } = page(rows, limit);
    return {
      notice: UNTRUSTED_NOTICE,
      total,
      truncated,
      commitments: items.map((row) => ({
        id: idOf(row),
        title: label(row.title) ?? "Untitled",
        category: label(row.category),
        counterparty: label(row.counterparty),
        cadence: label(row.cadence),
        nextDueDate: label(row.nextDueDate),
        owner: label(row.owner),
        status: label(row.status),
        requirement: untrusted(row.requirement, 600),
      })),
    };
  },
  output: z.object({
    notice: z.string(),
    total: z.number(),
    truncated: z.boolean(),
    commitments: z.array(z.object({
      id: z.string(),
      title: z.string(),
      category: z.string().optional(),
      counterparty: z.string().optional(),
      cadence: z.string().optional(),
      nextDueDate: z.string().optional(),
      owner: z.string().optional(),
      status: z.string().optional(),
      requirement: untrustedTextSchema.optional(),
    })),
  }),
});

const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export const createGovernanceTasks = defineAgentTool({
  name: "create_governance_tasks",
  title: "Create governance tasks",
  description:
    "Create up to eight approved governance follow-up tasks in the active workspace so the user can review them. Read the governance snapshot first and do not infer legal conclusions. Only call this for tasks the user has approved.",
  kind: "write",
  // Creating tasks only adds records (MCP: destructiveHint false = additive).
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
  calls: [{ name: "tasks:create", kind: "mutation" }],
  requires: ["tasks:write"],
  // Decision A4: remote connectors only propose; the on-device assistant asks
  // inline; WebMCP runs in the person's own session, flagged consequential.
  writeMode: { remote: "draft", device: "approve", browser: "direct" },
  draftTitle: ({ tasks }) => (tasks.length === 1 ? `Create task "${tasks[0].title.slice(0, 80)}"` : `Create ${tasks.length} governance tasks`),
  input: z.strictObject({
    tasks: z
      .array(z.strictObject({
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000).optional(),
        dueDate: dateString.optional(),
        priority: z.enum(PRIORITIES).default("Medium"),
        assignee: z.string().trim().max(120).optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
      }))
      .min(1, "tasks must contain between 1 and 8 items.")
      .max(8, "tasks must contain between 1 and 8 items."),
  }),
  async handler({ tasks }, adapter) {
    const sourceTag = adapter.context.surface === "browser" ? "webmcp" : `${adapter.context.surface}-agent`;
    const created: Array<{ id: string; title: string; dueDate?: string; priority: (typeof PRIORITIES)[number] }> = [];
    for (const task of tasks) {
      const id = await adapter.mutation<unknown>("tasks:create", {
        ...societyArgs(adapter),
        title: task.title,
        description: task.description || undefined,
        status: "Todo",
        priority: task.priority,
        assignee: task.assignee || undefined,
        dueDate: task.dueDate,
        tags: Array.from(new Set([sourceTag, "agent-created", ...task.tags])),
      });
      created.push({ id: String(id), title: task.title, dueDate: task.dueDate, priority: task.priority });
    }
    const browser = adapter.context.browser;
    if (browser) {
      browser.navigate("/app/tasks");
      browser.notify?.(`${created.length} governance task${created.length === 1 ? "" : "s"} created`, "Review the agent-created work in Tasks.");
    }
    return { created, count: created.length, ...(browser ? { openedView: "tasks" } : {}) };
  },
  output: z.object({
    created: z.array(z.object({ id: z.string(), title: z.string(), dueDate: z.string().optional(), priority: z.enum(PRIORITIES) })),
    count: z.number(),
    openedView: z.literal("tasks").optional(),
  }),
});

export const GOVERNANCE_VIEW_ROUTES = {
  dashboard: "/app",
  deadlines: "/app/deadlines",
  filings: "/app/filings",
  meetings: "/app/meetings",
  tasks: "/app/tasks",
  ai_agents: "/app/ai-agents",
} as const;
type GovernanceView = keyof typeof GOVERNANCE_VIEW_ROUTES;
const VIEWS = Object.keys(GOVERNANCE_VIEW_ROUTES) as [GovernanceView, ...GovernanceView[]];

export const openGovernanceView = defineAgentTool({
  name: "open_governance_view",
  title: "Open governance view",
  description:
    "Open a Societyer workspace view in this browser tab so the user and agent can look at the same deadlines, filings, meetings, tasks, dashboard, or AI-agent workspace together.",
  kind: "read",
  // Changes what the page shows, not workspace data.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
  calls: [],
  requires: [],
  surfaces: ["browser"],
  input: z.strictObject({ view: z.enum(VIEWS) }),
  async handler({ view }, adapter) {
    const route = GOVERNANCE_VIEW_ROUTES[view];
    const permission = interfaceRouteReadPermission(route);
    if (permission && !can(adapter, permission)) throw new AgentToolError("permission_denied", "This workspace view is restricted by your role.");
    if (!adapter.context.browser) throw new AgentToolError("not_available", "open_governance_view needs a browser tab.");
    adapter.context.browser.navigate(route);
    return { openedView: view, route };
  },
  output: z.object({ openedView: z.enum(VIEWS), route: z.string() }),
});
