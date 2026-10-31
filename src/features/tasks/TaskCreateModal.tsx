import { usePermissions } from "@/hooks/usePermissions";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTaskFormData } from "./TaskFormFields";
import { TaskEditDrawer } from "./TaskEditDrawer";

export type TaskCreateInitialValues = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  responsibleUserId?: string;
  responsibleUserIds?: string[];
  committeeId?: Id<"committees">;
  goalId?: Id<"goals">;
  meetingId?: Id<"meetings">;
  filingId?: Id<"filings">;
  workflowId?: Id<"workflows">;
  documentId?: Id<"documents">;
  commitmentId?: Id<"commitments">;
  eventId?: string;
};


type Props = {
  open: boolean;
  onClose: () => void;
  societyId: Id<"societies">;
  initialValues?: TaskCreateInitialValues;
  onCreated?: (taskId: Id<"tasks">) => void;
};
export function TaskCreateModal(props: Props) {
  const { can } = usePermissions();
  if (!props.open || !can("tasks:write")) return null;
  return <TaskCreateForm {...props} />;
}
function TaskCreateForm({ societyId, ...props }: Props) {
  const { can } = usePermissions();
  const data = useTaskFormData(societyId);
  return <TaskEditDrawer {...props} societyId={societyId} data={data} canManage={can("tasks:write")} presentation="modal" />;
}
