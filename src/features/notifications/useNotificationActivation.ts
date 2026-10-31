import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissions } from "../../hooks/usePermissions";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { useToast } from "../../components/Toast";

/** Both surfaces mark on semantic activation, including keyboard and modified link clicks. */
export function useNotificationActivation() {
  const { can } = usePermissions();
  const allowed = can("tasks:read");
  const markRead = usePermissionedMutation(api.notifications.markRead, allowed);
  const toast = useToast();
  return (notification: { _id: Id<"notifications">; readAt?: unknown }, after?: () => void) => {
    if (!allowed) return;
    after?.();
    if (!notification.readAt) void markRead({ id: notification._id }).catch((error: unknown) => {
      toast.error("Notification was not marked read", error instanceof Error ? error.message : "Please try again.");
    });
  };
}
