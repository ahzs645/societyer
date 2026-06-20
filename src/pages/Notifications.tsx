import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Segmented } from "../components/primitives";
import { Bell, CheckCheck, Send, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { useToast } from "../components/Toast";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useConfirm } from "../components/Modal";

export function NotificationsPage() {
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const notifications = useQuery(
    api.notifications.list,
    society ? { societyId: society._id, userId, limit: 200, includeDismissed: true } : "skip",
  );
  const markAllRead = useMutation(api.notifications.markAllRead);
  const removeNotification = useMutation(api.notifications.remove);
  const removeAllDismissed = useMutation(api.notifications.removeAllDismissed);
  const sendDigest = useAction(api.notifications.sendDigest);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"all" | "unread" | "dismissed">("all");

  const filtered = useMemo(() => {
    const list = notifications ?? [];
    if (scope === "unread") return list.filter((n) => !n.readAt && !n.dismissedAt);
    if (scope === "dismissed") return list.filter((n) => n.dismissedAt);
    return list;
  }, [notifications, scope]);
  const unreadCount = (notifications ?? []).filter((n) => !n.readAt && !n.dismissedAt).length;
  const dismissedCount = (notifications ?? []).filter((n) => n.dismissedAt).length;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        icon={<Bell size={16} />}
        iconColor="orange"
        subtitle="In-app alerts for compliance deadlines, filings, AI-drafted minutes, filing-bot progress and billing events."
        actions={
          <>
            <button
              className="btn-action"
              title="Send a digest email to members who have opted in to notification emails."
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: "Send notification digest?",
                  message: "This queues digest emails for members who have opted in to notification emails for this society.",
                  confirmLabel: "Send digest",
                });
                if (!ok) return;
                setBusy(true);
                try {
                  const { sent } = await sendDigest({ societyId: society._id });
                  toast.success(
                    sent === 0
                      ? "No recipients opted in — sent 0 digest emails."
                      : `Queued digest to ${sent} recipient${sent === 1 ? "" : "s"}.`,
                  );
                } catch (err: any) {
                  toast.error(err?.message ?? "Digest failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Send size={12} /> Send digest
            </button>
            <button
              className="btn-action"
              onClick={async () => {
                await markAllRead({ societyId: society._id, userId });
                toast.success("Marked all read");
              }}
            >
              <CheckCheck size={12} /> Mark all read
            </button>
          </>
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Recent</h2>
          <span className="card__subtitle">
            {notifications?.length ?? 0} total · {unreadCount} unread · cron runs daily at 07:00 UTC
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {scope === "dismissed" && dismissedCount > 0 && (
              <button
                className="btn-action btn-action--danger"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete cleared notifications?",
                    message: `Permanently delete all ${dismissedCount} cleared notification${dismissedCount === 1 ? "" : "s"}? This can't be undone.`,
                    confirmLabel: "Delete all",
                    tone: "danger",
                  });
                  if (!ok) return;
                  setBusy(true);
                  try {
                    await removeAllDismissed({ societyId: society._id, userId });
                    toast.success("Deleted cleared notifications");
                  } catch (err: any) {
                    toast.error(err?.message ?? "Couldn't delete notifications");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={12} /> Delete all cleared
              </button>
            )}
            <Segmented
              value={scope}
              onChange={setScope}
              items={[
                { id: "all", label: `All (${notifications?.length ?? 0})` },
                { id: "unread", label: `Unread (${unreadCount})` },
                { id: "dismissed", label: `Dismissed (${dismissedCount})` },
              ]}
            />
          </div>
        </div>
        <div className="card__body">
          {filtered.length === 0 && (
            <div className="empty-state empty-state--lg">
              {scope === "unread"
                ? "No unread notifications."
                : scope === "dismissed"
                ? "Nothing cleared. Notifications you clear from the bell appear here until they're purged after the retention period set in Settings."
                : "No notifications yet. They'll appear here when deadlines approach, filings are due, AI drafts complete, or bots run."}
            </div>
          )}
          {filtered.map((n) => (
            <div key={n._id} className="notif-row" style={n.dismissedAt ? { opacity: 0.6 } : undefined}>
              <Badge
                tone={
                  n.severity === "success"
                    ? "success"
                    : n.severity === "err"
                    ? "danger"
                    : n.severity === "warn"
                    ? "warn"
                    : "info"
                }
              >
                {n.kind}
              </Badge>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>
                  {n.linkHref ? <Link to={n.linkHref}>{n.title}</Link> : n.title}
                  {!n.readAt && (
                    <span
                      style={{
                        background: "var(--accent)",
                        borderRadius: 10,
                        color: "#fff",
                        fontSize: 10,
                        padding: "1px 6px",
                        marginLeft: 8,
                      }}
                    >
                      new
                    </span>
                  )}
                </div>
                {n.body && <div className="muted" style={{ fontSize: 13 }}>{n.body}</div>}
              </div>
              <span className="muted mono" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {n.dismissedAt && <Badge tone="neutral">Cleared</Badge>}
                {formatDateTime(n.createdAtISO)}
              </span>
              {n.dismissedAt && (
                <button
                  className="btn-action btn-action--icon"
                  aria-label="Delete permanently"
                  title="Delete permanently"
                  style={{ marginLeft: 8, color: "var(--danger)" }}
                  onClick={async () => {
                    try {
                      await removeNotification({ id: n._id });
                    } catch (err: any) {
                      toast.error(err?.message ?? "Couldn't delete notification");
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
