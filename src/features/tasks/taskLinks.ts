export const TASK_DETAIL_PARAM = "task";

export function taskDetailHref(taskId: string) {
  return `/app/tasks?${TASK_DETAIL_PARAM}=${encodeURIComponent(taskId)}`;
}
