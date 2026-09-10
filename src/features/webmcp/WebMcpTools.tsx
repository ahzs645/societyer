import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { useToast } from "@/components/Toast";

const VIEW_ROUTES = {
  dashboard: "/app",
  deadlines: "/app/deadlines",
  filings: "/app/filings",
  meetings: "/app/meetings",
  tasks: "/app/tasks",
  ai_agents: "/app/ai-agents",
} as const;

const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type GovernanceTaskInput = {
  title: string;
  description?: string;
  dueDate?: string;
  priority: (typeof PRIORITIES)[number];
  assignee?: string;
  tags: string[];
};

type LiveWorkspaceData = {
  society: any;
  dashboard: any;
  deadlines: any[] | undefined;
  filings: any[] | undefined;
  meetings: any[] | undefined;
  tasks: any[] | undefined;
};

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, label: string) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || Number(resolved) < min || Number(resolved) > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return Number(resolved);
}

function requireText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  const text = value.trim();
  if (text.length > maxLength) throw new RangeError(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const text = value.trim();
  if (text.length > maxLength) throw new RangeError(`${label} must be ${maxLength} characters or fewer.`);
  return text || undefined;
}

function validateTaskInputs(input: unknown): GovernanceTaskInput[] {
  const root = asRecord(input, "Input");
  if (!Array.isArray(root.tasks) || root.tasks.length < 1 || root.tasks.length > 8) {
    throw new RangeError("tasks must contain between 1 and 8 items.");
  }

  return root.tasks.map((candidate, index) => {
    const task = asRecord(candidate, `tasks[${index}]`);
    const priority = task.priority === undefined ? "Medium" : task.priority;
    if (typeof priority !== "string" || !PRIORITIES.includes(priority as GovernanceTaskInput["priority"])) {
      throw new TypeError(`tasks[${index}].priority must be Low, Medium, High, or Urgent.`);
    }
    if (task.dueDate !== undefined && (typeof task.dueDate !== "string" || !DATE_PATTERN.test(task.dueDate))) {
      throw new TypeError(`tasks[${index}].dueDate must use YYYY-MM-DD.`);
    }
    if (task.tags !== undefined && (!Array.isArray(task.tags) || task.tags.length > 8)) {
      throw new RangeError(`tasks[${index}].tags must contain at most 8 items.`);
    }
    const tags = (task.tags ?? []).map((tag, tagIndex) =>
      requireText(tag, `tasks[${index}].tags[${tagIndex}]`, 40),
    );

    return {
      title: requireText(task.title, `tasks[${index}].title`, 160),
      description: optionalText(task.description, `tasks[${index}].description`, 2_000),
      dueDate: task.dueDate as string | undefined,
      priority: priority as GovernanceTaskInput["priority"],
      assignee: optionalText(task.assignee, `tasks[${index}].assignee`, 120),
      tags: Array.from(new Set(["webmcp", "agent-created", ...tags])),
    };
  });
}

function dateOnly(value: unknown) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function isOpenDeadline(record: any) {
  return (record?.status ?? (record?.done ? "complete" : "open")) === "open";
}

function isOpenTask(record: any) {
  return ["Todo", "InProgress", "Blocked"].includes(String(record?.status));
}

function item(record: any, dateField: "dueDate" | "scheduledAt") {
  return {
    id: String(record?._id ?? ""),
    title: String(record?.title ?? record?.kind ?? "Untitled"),
    [dateField]: record?.[dateField],
    status: record?.status,
    category: record?.category,
    priority: record?.priority,
  };
}

function buildSnapshot(data: LiveWorkspaceData, input: unknown) {
  const args = asRecord(input, "Input");
  const horizonDays = boundedInteger(args.horizonDays, 45, 1, 365, "horizonDays");
  const maxItems = boundedInteger(args.maxItems, 8, 1, 20, "maxItems");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);
  const deadlines = data.deadlines ?? [];
  const filings = data.filings ?? [];
  const meetings = data.meetings ?? [];
  const tasks = data.tasks ?? [];

  const overdueDeadlines = deadlines
    .filter((record) => isOpenDeadline(record) && dateOnly(record.dueDate) < today)
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))
    .slice(0, maxItems)
    .map((record) => item(record, "dueDate"));
  const dueSoonDeadlines = deadlines
    .filter((record) => isOpenDeadline(record) && dateOnly(record.dueDate) >= today && dateOnly(record.dueDate) <= horizon)
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))
    .slice(0, maxItems)
    .map((record) => item(record, "dueDate"));
  const overdueFilings = filings
    .filter((record) => record?.status !== "Filed" && dateOnly(record.dueDate) < today)
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))
    .slice(0, maxItems)
    .map((record) => item(record, "dueDate"));
  const upcomingFilings = filings
    .filter((record) => record?.status !== "Filed" && dateOnly(record.dueDate) >= today && dateOnly(record.dueDate) <= horizon)
    .sort((a, b) => dateOnly(a.dueDate).localeCompare(dateOnly(b.dueDate)))
    .slice(0, maxItems)
    .map((record) => item(record, "dueDate"));
  const upcomingMeetings = meetings
    .filter((record) => dateOnly(record.scheduledAt) >= today && dateOnly(record.scheduledAt) <= horizon)
    .sort((a, b) => dateOnly(a.scheduledAt).localeCompare(dateOnly(b.scheduledAt)))
    .slice(0, maxItems)
    .map((record) => item(record, "scheduledAt"));
  const openTasks = tasks
    .filter(isOpenTask)
    .sort((a, b) => (dateOnly(a.dueDate) || "9999").localeCompare(dateOnly(b.dueDate) || "9999"))
    .slice(0, maxItems)
    .map((record) => item(record, "dueDate"));

  return {
    workspace: {
      name: data.society?.name,
      jurisdictionCode: data.society?.jurisdictionCode,
      entityKind: data.society?.entityKind,
    },
    generatedAt: now.toISOString(),
    horizonDays,
    summaryCounts: data.dashboard?.counts ?? {
      openDeadlines: deadlines.filter(isOpenDeadline).length,
      openTasks: tasks.filter(isOpenTask).length,
      overdueFilings: filings.filter((record) => record?.status !== "Filed" && dateOnly(record.dueDate) < today).length,
    },
    attention: {
      overdueDeadlines,
      dueSoonDeadlines,
      overdueFilings,
      upcomingFilings,
      upcomingMeetings,
      openTasks,
      complianceFlags: (data.dashboard?.complianceFlags ?? []).slice(0, maxItems).map((flag: any) => ({
        ruleId: flag?.ruleId,
        level: flag?.level,
        text: flag?.text,
        evidenceRequired: flag?.evidenceRequired,
      })),
    },
    collaboration: {
      nextStep: "Review the risks with the user, then call create_governance_tasks for the actions they approve.",
      reviewViews: ["deadlines", "filings", "tasks", "meetings"],
    },
  };
}

function reportRegistrationError(error: unknown) {
  console.warn("Societyer could not register a WebMCP tool.", error);
}

export function WebMcpTools() {
  const society = useSociety();
  const navigate = useNavigate();
  const toast = useToast();
  const args = society ? { societyId: society._id } : "skip";
  const dashboard = useQuery(api.dashboard.summary, args);
  const deadlines = useQuery(api.deadlines.list, args) as any[] | undefined;
  const filings = useQuery(api.filings.list, args) as any[] | undefined;
  const meetings = useQuery(api.meetings.list, args) as any[] | undefined;
  const tasks = useQuery(api.tasks.list, args) as any[] | undefined;
  const createTask = useMutation(api.tasks.create);
  const liveData = useRef<LiveWorkspaceData>({ society, dashboard, deadlines, filings, meetings, tasks });
  const actions = useRef({ createTask, navigate, toast });
  const societyId = society?._id;
  liveData.current = { society, dashboard, deadlines, filings, meetings, tasks };
  actions.current = { createTask, navigate, toast };

  useEffect(() => {
    const context = document.modelContext;
    if (!societyId || !context?.registerTool) return;

    const lifecycle = new AbortController();
    const toolNames = ["get_governance_snapshot", "create_governance_tasks", "open_governance_view"];
    const registrations = [
      context.registerTool(
        {
          name: "get_governance_snapshot",
          title: "Get governance snapshot",
          description:
            "Read the active Societyer workspace's compliance posture across deadlines, filings, meetings, tasks, and rule-based flags. Use this before recommending or creating work.",
          inputSchema: {
            type: "object",
            properties: {
              horizonDays: { type: "integer", minimum: 1, maximum: 365, default: 45 },
              maxItems: { type: "integer", minimum: 1, maximum: 20, default: 8 },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input) {
            const current = liveData.current;
            if (!current.society) throw new Error("No Societyer workspace is selected.");
            if ([current.deadlines, current.filings, current.meetings, current.tasks].some((value) => value === undefined)) {
              throw new Error("The governance workspace is still loading. Try again in a moment.");
            }
            return buildSnapshot(current, input);
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "create_governance_tasks",
          title: "Create governance tasks",
          description:
            "Create up to eight approved governance follow-up tasks in the active workspace and open the Tasks view so the user can review them. Read the governance snapshot first and do not infer legal conclusions.",
          inputSchema: {
            type: "object",
            required: ["tasks"],
            properties: {
              tasks: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string", minLength: 1, maxLength: 160 },
                    description: { type: "string", maxLength: 2000 },
                    dueDate: { type: "string", format: "date" },
                    priority: { type: "string", enum: PRIORITIES, default: "Medium" },
                    assignee: { type: "string", maxLength: 120 },
                    tags: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 40 } },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const currentSociety = liveData.current.society;
            if (!currentSociety) throw new Error("No Societyer workspace is selected.");
            const validatedTasks = validateTaskInputs(input);
            const created: Array<{ id: string; title: string; dueDate?: string; priority: GovernanceTaskInput["priority"] }> = [];
            for (const task of validatedTasks) {
              const id = await actions.current.createTask({
                societyId: currentSociety._id,
                title: task.title,
                description: task.description,
                status: "Todo",
                priority: task.priority,
                assignee: task.assignee,
                dueDate: task.dueDate,
                tags: task.tags,
              });
              created.push({ id: String(id), title: task.title, dueDate: task.dueDate, priority: task.priority });
            }
            actions.current.navigate(VIEW_ROUTES.tasks);
            actions.current.toast.success(`${created.length} governance task${created.length === 1 ? "" : "s"} created`, "Review the agent-created work in Tasks.");
            return { created, count: created.length, openedView: "tasks" };
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "open_governance_view",
          title: "Open governance view",
          description:
            "Open a Societyer workspace view so the user and agent can inspect the same deadlines, filings, meetings, tasks, dashboard, or AI-agent workspace together.",
          inputSchema: {
            type: "object",
            required: ["view"],
            properties: { view: { type: "string", enum: Object.keys(VIEW_ROUTES) } },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const args = asRecord(input, "Input");
            if (typeof args.view !== "string" || !(args.view in VIEW_ROUTES)) {
              throw new TypeError(`view must be one of: ${Object.keys(VIEW_ROUTES).join(", ")}.`);
            }
            const view = args.view as keyof typeof VIEW_ROUTES;
            actions.current.navigate(VIEW_ROUTES[view]);
            return { openedView: view, route: VIEW_ROUTES[view] };
          },
        },
        { signal: lifecycle.signal },
      ),
    ];

    void Promise.all(registrations.map((registration) => Promise.resolve(registration)))
      .then(() => {
        if (!lifecycle.signal.aborted) document.documentElement.dataset.webmcpTools = toolNames.join(",");
      })
      .catch(reportRegistrationError);

    return () => {
      lifecycle.abort();
      if (document.documentElement.dataset.webmcpTools === toolNames.join(",")) {
        delete document.documentElement.dataset.webmcpTools;
      }
    };
  }, [societyId]);

  return null;
}
