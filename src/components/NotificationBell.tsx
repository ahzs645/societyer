import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Bell, CheckCircle2, AlertTriangle, Info, XCircle } from "lucide-react";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import { useSociety } from "../hooks/useSociety";

export function NotificationBell() {
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const notifications = useQuery(
    api.notifications.list,
    society ? { societyId: society._id, userId, limit: 15 } : "skip",
  );
  const unread = useQuery(
    api.notifications.unreadCount,
    society ? { societyId: society._id, userId } : "skip",
  );
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gutter = 8;
      const panelWidth = Math.min(340, window.innerWidth - gutter * 2);
      const panelMaxHeight = Math.min(440, Math.max(180, window.innerHeight - rect.bottom - gutter * 2));
      // Anchor to the right edge of the button, but keep the panel on-screen.
      let left = rect.right - panelWidth;
      if (left < gutter) left = gutter;
      if (left + panelWidth > window.innerWidth - gutter) {
        left = window.innerWidth - panelWidth - gutter;
      }
      let top = rect.bottom + 6;
      if (top + panelMaxHeight > window.innerHeight - gutter) {
        top = Math.max(gutter, window.innerHeight - panelMaxHeight - gutter);
      }
      setAnchor({ top, left, width: panelWidth, maxHeight: panelMaxHeight });
    };
    place();
    const h = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", h);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (!society) return null;

  return (
    <>
      <button
        ref={btnRef}
        className="sidebar__icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Notifications"
        style={{ position: "relative" }}
      >
        <Bell size={14} />
        {unread && unread > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              background: "var(--danger)",
              color: "var(--text-inverse)",
              borderRadius: "var(--r-pill)",
              padding: "0 5px",
              fontSize: "var(--fs-xs)",
              lineHeight: "14px",
              minWidth: 14,
              textAlign: "center",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open && anchor &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
              overflow: "auto",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 1000,
              color: "var(--text-primary)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <strong style={{ fontSize: "var(--fs-md)" }}>Notifications</strong>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await markAllRead({ societyId: society._id, userId });
                }}
              >
                Mark all read
              </button>
            </div>

            {(notifications ?? []).length === 0 && (
              <div className="muted" style={{ padding: 16, textAlign: "center" }}>
                You're all caught up.
              </div>
            )}

            {(notifications ?? []).map((n) => {
              const Icon =
                n.severity === "success"
                  ? CheckCircle2
                  : n.severity === "err"
                  ? XCircle
                  : n.severity === "warn"
                  ? AlertTriangle
                  : Info;
              const color =
                n.severity === "success"
                  ? "var(--success)"
                  : n.severity === "err"
                  ? "var(--danger)"
                  : n.severity === "warn"
                  ? "var(--warn)"
                  : "var(--text-secondary)";
              const body = (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    background: n.readAt ? "var(--bg-panel)" : "var(--bg-subtle)",
                    cursor: "pointer",
                  }}
                  onClick={async () => {
                    if (!n.readAt) await markRead({ id: n._id });
                    setOpen(false);
                  }}
                >
                  <Icon size={14} style={{ color, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--fs-md)", fontWeight: 500 }}>{n.title}</div>
                    {n.body && (
                      <div
                        className="muted"
                        style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}
                      >
                        {n.body}
                      </div>
                    )}
                    <div
                      className="muted mono"
                      style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}
                    >
                      {formatDateTime(n.createdAtISO)}
                    </div>
                  </div>
                </div>
              );
              return n.linkHref ? (
                <Link
                  key={n._id}
                  to={n.linkHref}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {body}
                </Link>
              ) : (
                <div key={n._id}>{body}</div>
              );
            })}

            <div style={{ padding: 8, textAlign: "center", background: "var(--bg-panel)" }}>
              <Link
                to="/app/notifications"
                className="btn btn--ghost btn--sm"
                onClick={() => setOpen(false)}
              >
                View all
              </Link>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
