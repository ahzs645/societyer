import { isLocalDataRuntime } from "../lib/staticRuntime";
import { usePermissions } from "../hooks/usePermissions";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Segmented, Tabs } from "../components/primitives";
import { useUrlTab } from "../hooks/useUrlTab";
import { NotificationSettings } from "../features/notifications/NotificationSettings";
import { Bell, CheckCheck, Send, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { useToast } from "../components/Toast";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useConfirm } from "../components/Modal";
import { Tooltip } from "../components/Tooltip";

/** "filing" / "ai_draft" → "Filing" / "AI draft". */
function kindLabel(kind?: string) {
  const text = String(kind ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return "General";
  return text.replace(/\bai\b/gi, "AI").replace(/^./, (letter) => letter.toUpperCase());
}

export function NotificationsPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const digestAvailable = !isLocalDataRuntime() && can("tasks:write");
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
  const [tab, setTab] = useUrlTab(["inbox", "settings"] as const, "inbox");

  const filtered = useMemo(() => {
    // Newest first, whichever runtime answered the query.
    const list = [...(notifications ?? [])].sort((a, b) => String(b.createdAtISO ?? "").localeCompare(String(a.createdAtISO ?? "")));
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
        subtitle="Alerts about deadlines, filings, meetings, finance and approvals."
        info={<>
          <p>In-app alerts for compliance deadlines, filings, budget and balance thresholds, claims waiting for approval, AI-drafted minutes and workflow progress.</p>
          {isLocalDataRuntime()
            ? <p>Email and SMS digests require a connected server. In-app notifications and reminders remain available here.</p>
            : <p>The daily digest email goes out at 13:00 UTC and the opt-in weekly summary on Mondays. Choose what you receive on the Settings tab.</p>}
        </>}
        actions={tab === "inbox" ? (
          <>
            <button
              className="btn-action"
              title="Send a digest email to workspace users who have opted in to notification emails."
              disabled={busy || !digestAvailable}
              onClick={async () => {
                if (!digestAvailable) return;
                const ok = await confirm({
                  title: "Send notification digest?",
                  message: "This queues digest emails for members who have opted in to notification emails for this society.",
                  confirmLabel: "Send digest",
                });
                if (!ok) return;
                setBusy(true);
                try {
                  const { emailsSent, smsSent } = await sendDigest({ societyId: society._id });
                  const total = (emailsSent ?? 0) + (smsSent ?? 0);
                  toast.success(
                    total === 0
                      ? "No recipients opted in — sent 0 digests."
                      : `Queued ${emailsSent} email${emailsSent === 1 ? "" : "s"}` +
                        (smsSent > 0 ? ` and ${smsSent} SMS` : "") + ".",
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
        ) : undefined}
      />

      <Tabs<"inbox" | "settings">
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Notifications views"
        items={[
          { id: "inbox", label: "Inbox", count: unreadCount || null },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "settings" ? <NotificationSettings society={society} /> : (
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Recent</h2>
          <div className="notifications__head-actions">
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
            scope === "unread" ? (
              <EmptyState variant="caught-up" size="lg" description="No unread notifications." />
            ) : (
              <div className="empty-state empty-state--lg">
                {scope === "dismissed"
                  ? "Nothing cleared. Notifications you clear from the bell appear here until they're purged after the retention period set in Settings."
                  : "No notifications yet. They'll appear here when deadlines approach, filings are due, AI drafts complete, or bots run."}
              </div>
            )
          )}
          {filtered.map((n) => (
            <div key={n._id} className="notif-row" style={n.dismissedAt ? { opacity: 0.6 } : undefined}>
              <span className="notif-row__kind"><Badge
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
                {kindLabel(n.kind)}
              </Badge></span>
              <div className="notif-row__main">
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
              <span className="muted notif-row__meta" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {n.dismissedAt && <Badge tone="neutral">Cleared</Badge>}
                {formatDateTime(n.createdAtISO)}
              </span>
              {n.dismissedAt && (
                <Tooltip content="Delete permanently">
                  <button
                    className="btn-action btn-action--icon"
                    aria-label="Delete permanently"
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
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
