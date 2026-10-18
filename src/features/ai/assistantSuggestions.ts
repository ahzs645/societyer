/**
 * What the assistant suggests, and how it describes itself, by what it can do.
 *
 * Server workspaces have the hosted assistant's tools: the prompts look things
 * up and draft records. The on-device model has the shared agent tools when
 * "Let the assistant look up workspace records" is on and the model takes
 * tools: its prompts ask about meetings, tasks and documents (and draft a
 * task when it may propose changes). Otherwise it only sees what is pasted or
 * attached, so the prompts work on pasted text and say so.
 */
import { FileText, Gavel, ListChecks, Plus, Search, type LucideIcon } from "lucide-react";
import type { DeviceAiConfig } from "../../lib/localAi/config";
import type { DeviceToolSupport } from "../../lib/localAi/toolSupport";
import { deviceAssistantToolsAvailable } from "../../lib/localAi/useDeviceAi";

export type SuggestedPrompt = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** One is picked at random and put in the composer, ready to finish. */
  prefills: string[];
};

export type AssistantCapabilities = {
  /** The assistant can read workspace records through tools. */
  toolsAvailable: boolean;
  /** Who answers: the hosted assistant, or the model on this device. */
  surface: "server" | "device";
  /** It may propose changes for the person to approve (always true on the server, where drafts need approval). */
  canProposeChanges: boolean;
};

const TOOL_PROMPTS: readonly SuggestedPrompt[] = [
  {
    id: "find-record",
    label: "Find a record",
    icon: Search,
    prefills: [
      "Find the directors whose terms expire in the next 60 days.",
      "Show me all active members joined in the last 90 days, sorted by join date.",
      "List filings due to BC Registry in the next 30 days that are still in draft.",
    ],
  },
  {
    id: "summarize-page",
    label: "Summarize this page",
    icon: FileText,
    prefills: [
      "Summarize what's on the current screen and flag anything that needs my attention.",
      "Give me the key facts from this page in 3-5 bullets.",
      "What's overdue or missing on this record? Be concise.",
    ],
  },
  {
    id: "draft-task",
    label: "Draft a task",
    icon: Plus,
    prefills: [
      "Draft a task to follow up on this record next week, priority Medium. Details: ",
      "Draft a task assigned to the secretary to file the AGM minutes by month-end. Details: ",
      "Draft a high-priority task to renew the society's annual report. Details: ",
    ],
  },
];

/** The on-device model with the shared agent tools (reads; a task only as a proposal). */
const DEVICE_TOOL_PROMPTS: readonly SuggestedPrompt[] = [
  {
    id: "ask-meeting",
    label: "Ask about a meeting",
    icon: Gavel,
    prefills: [
      "What did we decide about the budget at the last board meeting?",
      "Summarize the motions from our most recent meeting and how each was decided.",
      "Who moved and seconded the motions at the last board meeting?",
    ],
  },
  {
    id: "whats-due",
    label: "Check what's due",
    icon: ListChecks,
    prefills: [
      "List overdue tasks.",
      "What deadlines are coming up in the next 30 days?",
      "Which commitments are still open, and who owns them?",
    ],
  },
  {
    id: "find-document",
    label: "Find a document",
    icon: Search,
    prefills: [
      "Find our bylaws and summarize what they say about membership.",
      "Search our documents for the conflict of interest policy.",
    ],
  },
];

const DEVICE_DRAFT_PROMPT: SuggestedPrompt = {
  id: "propose-task",
  label: "Propose a task",
  icon: Plus,
  prefills: [
    "Propose a task to follow up on the action items from the last board meeting, due next Friday. Details: ",
    "Propose a high-priority task for the secretary to file the AGM minutes by month-end. Details: ",
  ],
};

/** The prefill ends where the person pastes the text. */
const TEXT_PROMPTS: readonly SuggestedPrompt[] = [
  {
    id: "summarize-excerpt",
    label: "Summarize this transcript excerpt",
    icon: FileText,
    prefills: [
      "Summarize this transcript excerpt in 3-5 bullets, noting who said what:\n\n",
      "Summarize the decisions and open questions in this transcript excerpt:\n\n",
    ],
  },
  {
    id: "notes-to-actions",
    label: "Turn these notes into action items",
    icon: ListChecks,
    prefills: [
      "Turn these notes into action items, with an owner and a due date where the notes give one:\n\n",
      "List the follow-ups in these notes as short action items:\n\n",
    ],
  },
  {
    id: "check-motion",
    label: "Check this motion wording",
    icon: Gavel,
    prefills: [
      "Check this motion wording: is the decision clear, and who moves and seconds it? Suggest a tighter version:\n\n",
      "Rewrite this motion so it states one clear decision, starting with \"BE IT RESOLVED THAT\":\n\n",
    ],
  },
];

/**
 * Server workspaces (and the demo) have tools. In a local or desktop workspace
 * only the on-device model can answer, with tools when they are turned on and
 * the model takes them.
 */
export function assistantCapabilities(input: {
  localOnly: boolean;
  deviceChat: boolean;
  deviceConfig: DeviceAiConfig;
  deviceToolSupport?: DeviceToolSupport;
}): AssistantCapabilities {
  if (!input.localOnly) return { toolsAvailable: true, surface: "server", canProposeChanges: true };
  const toolsAvailable = input.deviceChat && deviceAssistantToolsAvailable(input.deviceConfig, input.deviceToolSupport);
  return { toolsAvailable, surface: "device", canProposeChanges: toolsAvailable && input.deviceConfig.assistantTools.proposeChanges };
}

export function assistantSuggestions(capabilities: AssistantCapabilities): readonly SuggestedPrompt[] {
  if (!capabilities.toolsAvailable) return TEXT_PROMPTS;
  if (capabilities.surface === "server") return TOOL_PROMPTS;
  return capabilities.canProposeChanges ? [...DEVICE_TOOL_PROMPTS, DEVICE_DRAFT_PROMPT] : DEVICE_TOOL_PROMPTS;
}

export function assistantEmptyHint(capabilities: AssistantCapabilities): string {
  if (!capabilities.toolsAvailable) return "Paste or attach the text to work on. This model cannot see workspace records.";
  if (capabilities.surface === "server") return "Ask about your society's records, meetings or filings.";
  return capabilities.canProposeChanges
    ? "This model can look up meetings, minutes, transcripts, documents, tasks and deadlines you can see, and propose tasks for you to approve."
    : "This model can look up meetings, minutes, transcripts, documents, tasks and deadlines you can see. It cannot change anything.";
}

export function assistantPlaceholder(capabilities: AssistantCapabilities, onDevice: boolean): string {
  if (!onDevice) return "Ask the assistant to inspect this page, find records, draft tasks, or use workspace tools.";
  return capabilities.toolsAvailable
    ? "Ask about meetings, minutes, transcripts, documents, tasks or deadlines."
    : "Ask the on-device model. Paste or attach the text it should work from.";
}
