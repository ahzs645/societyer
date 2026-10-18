/**
 * ⌘K "New …" commands: create the common records from anywhere. Each one
 * opens the same form as the page's own New button, and is listed only when
 * the viewer may create that record (the page checks again before opening).
 *
 * "New task", "New meeting" and "New transaction rule" keep the ids of the
 * older static actions so pins made under the old names keep working. The
 * finance items are the Create menu's (lib/financeCreateItems.ts).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ListTodo, Receipt } from "lucide-react";
import type { ComponentType } from "react";
import { usePermissions } from "../hooks/usePermissions";
import type { ModuleKey } from "./modules";
import { FINANCE_CREATE_ITEMS } from "./financeCreateItems";

export type CreateCommand = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  keywords: string[];
  module?: ModuleKey;
  run: () => void;
};

/** Static palette actions these commands replace (same id, new label). */
export const CREATE_COMMAND_IDS = new Set(["action-add-task", "action-create-meeting", "action-new-transaction-rule"]);

export function useCreateCommands(): CreateCommand[] {
  const navigate = useNavigate();
  const { loaded, can } = usePermissions();
  const finance = loaded && can("financials:write");
  const tasks = loaded && can("tasks:write");
  const meetings = loaded && can("meetings:write");

  return useMemo(() => {
    const out: CreateCommand[] = [];
    if (finance) {
      out.push(
        {
          id: "create-expense-claim",
          label: "New expense claim",
          icon: Receipt,
          keywords: ["expense report", "reimbursement", "claim", "receipt", "add expense"],
          run: () => navigate("/app/treasurer?intent=new-claim"),
        },
        // The finance Create menu's items (lib/financeCreateItems.ts).
        ...FINANCE_CREATE_ITEMS.map((item) => ({
          id: item.id,
          label: item.commandLabel,
          icon: item.icon,
          keywords: item.keywords,
          run: () => navigate(item.to),
        })),
      );
    }
    if (tasks) {
      out.push({
        id: "action-add-task",
        label: "New task",
        icon: ListTodo,
        keywords: ["add task", "create task", "to do", "todo"],
        run: () => { window.dispatchEvent(new Event("quickaction:add-task")); },
      });
    }
    if (meetings) {
      out.push({
        id: "action-create-meeting",
        label: "New meeting",
        icon: Calendar,
        keywords: ["create meeting", "schedule meeting", "board meeting", "add meeting"],
        run: () => { window.dispatchEvent(new Event("quickaction:create-meeting")); },
      });
    }
    return out;
  }, [finance, meetings, navigate, tasks]);
}
