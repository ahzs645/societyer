import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Bell, CheckCheck, Send, RefreshCw } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { useToast } from "../components/Toast";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useConfirm } from "../components/Modal";

export function NotificationsPage() {
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const notifications = useQuery(
    api.notifications.list,
    society ? { societyId: society._id, userId, limit: 200 } : "skip",
  );
  const markAllRead = useMutation(api.notifications.markAllRead);
  const sendDigest = useAction(api.notifications.sendDigest);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  if (society === undefined) return <div className="page">Loading…</div>;
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
            {notifications?.length ?? 0} total · cron runs daily at 07:00 UTC
          </span>
        </div>
        <div className="card__body">
          {(notifications ?? []).length === 0 && (
            <div className="muted" style={{ padding: 24, textAlign: "center" }}>
              No notifications yet. They'll appear here when deadlines approach, filings are due,
              AI drafts complete, or bots run.
            </div>
          )}
          {(notifications ?? []).map((n) => (
            <div key={n._id} className="notif-row">
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
              <span className="muted mono" style={{ fontSize: 11 }}>
                {formatDateTime(n.createdAtISO)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
