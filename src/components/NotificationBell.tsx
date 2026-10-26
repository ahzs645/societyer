import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Bell, CheckCircle2, AlertTriangle, Info, XCircle, X, Clock, Settings2 } from "lucide-react";
import { useToast } from "./Toast";
import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import { useDialogFocus } from "../lib/useDialogFocus";
import { useFloatingLayerStack } from "../lib/overlayStack";
import { backdropDismissProps, swallowFollowingClick } from "../lib/floatingLayer";
import { useIsBottomSheet, useSheetDrag } from "../lib/useSheetDrag";
import { useSociety } from "../hooks/useSociety";
import { Tooltip } from "./Tooltip";
import { useLocalAlertScan } from "../hooks/useLocalAlertScan";

export function NotificationBell() {
  const society = useSociety();
  const { can } = usePermissions();
  const canRead = can("tasks:read");
  const canWrite = can("tasks:write");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const notifications = useQuery(
    api.notifications.list,
    open && canRead && society ? { societyId: society._id, limit: 15 } : "skip",
  );
  const unread = useQuery(
    api.notifications.unreadCount,
    canRead && society ? { societyId: society._id } : "skip",
  );
  const markRead = usePermissionedMutation(api.notifications.markRead, canRead);
  const markAllRead = usePermissionedMutation(api.notifications.markAllRead, canRead);
  const dismiss = usePermissionedMutation(api.notifications.dismiss, canRead);
  const dismissAll = usePermissionedMutation(api.notifications.dismissAll, canRead);
  const snooze = usePermissionedMutation(api.notifications.snooze, canRead);
  useLocalAlertScan(society?._id, canWrite);
  const updateInbox = async (write: () => Promise<unknown>) => {
    try { await write(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't update your notifications"); }
  };
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // Dialog semantics: focus moves in, Escape closes, focus returns to the bell.
  const panelRef = useDialogFocus<HTMLDivElement>(open, () => setOpen(false));
  // Phones: the panel is a swipe-dismissable bottom sheet, not a popover
  // hanging off a bell in the corner.
  const isSheet = useIsBottomSheet();
  // Closing by backdrop tap or swipe hands focus back to the bell.
  const dismissPanel = () => {
    setOpen(false);
    btnRef.current?.focus({ preventScroll: true });
  };
  useSheetDrag(panelRef, { enabled: open && isSheet, onDismiss: dismissPanel });
  const layer = useFloatingLayerStack(open);
  // Ring the bell when the unread count goes UP (not on first load / reads).
  const unreadCount = unread ?? 0;
  const prevUnreadRef = useRef<number | null>(null);
  const [ringKey, setRingKey] = useState(0);
  useEffect(() => {
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = unreadCount;
    if (prev !== null && unreadCount > prev) setRingKey((k) => k + 1);
  }, [unreadCount]);

  useEffect(() => {
    if (!open || isSheet) return;
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
      swallowFollowingClick({ onlyBackdrops: true });
    };
    window.addEventListener("mousedown", h);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, isSheet]);

  if (!society) return null;

  if (!canRead) return null;

  return (
    <>
      <Tooltip content="Notifications" placement="bottom" disabled={open}>
        <button
          ref={btnRef}
          className="sidebar__icon-btn notif-bell"
          onClick={() => setOpen((v) => !v)}
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Bell key={`ring-${ringKey}`} size={14} className={ringKey > 0 ? "notif-bell__icon is-ringing" : "notif-bell__icon"} />
          {unreadCount > 0 ? (
            <span key={`badge-${unreadCount}`} className="notif-bell__badge">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </Tooltip>

      {open && (isSheet || anchor) &&
        createPortal(
          <>
          {isSheet && <div className="menu-backdrop" style={layer.backdrop} {...backdropDismissProps(dismissPanel)} />}
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            aria-modal={isSheet || undefined}
            tabIndex={-1}
            className={`notif-panel${isSheet ? " notif-panel--sheet" : ""}`}
            style={isSheet || !anchor ? layer.panel : {
              ...layer.panel,
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
            }}
          >
            {isSheet && <div className="sheet-grabber" aria-hidden="true" />}
            <div className="notif-panel__head">
              <strong>Notifications</strong>
              {(notifications ?? []).length > 0 && (
                <>
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!canRead}
                    onClick={async () => {
                      if (!canRead) return;
                      await updateInbox(() => markAllRead({ societyId: society._id }));
                    }}
                  >
                    Mark all read
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!canRead}
                    title="Clear all notifications from this list"
                    onClick={async () => {
                      if (!canRead) return;
                      await updateInbox(() => dismissAll({ societyId: society._id }));
                    }}
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>

            {(notifications ?? []).length === 0 && (
              <div className="empty-state">
                {notifications === undefined ? "Loading notifications…" : "You're all caught up."}
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
                  className={`notif-row${n.readAt ? "" : " is-unread"}`}
                  onClick={async () => {
                    if (canRead && !n.readAt) await updateInbox(() => markRead({ id: n._id }));
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
                      className="muted"
                      style={{ fontSize: "var(--fs-xs)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatDateTime(n.createdAtISO)}
                    </div>
                  </div>
                </div>
              );
              const clearButton = (
                <Tooltip content="Clear notification">
                  <button
                    className="notif-clear"
                    disabled={!canRead}
                    aria-label="Clear notification"
                    onClick={(event) => {
                      // Sibling of the row body, but guard anyway so a click never
                      // navigates the link or marks-read underneath.
                      event.preventDefault();
                      event.stopPropagation();
                      if (!canRead) return;
                      void updateInbox(() => dismiss({ id: n._id }));
                    }}
                  >
                    <X size={13} />
                  </button>
                </Tooltip>
              );
              const snoozeButton = (
                <Tooltip content="Snooze for 1 day">
                  <button
                    className="notif-clear notif-clear--secondary"
                    disabled={!canRead}
                    aria-label="Snooze for 1 day"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!canRead) return;
                      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                      void updateInbox(() => snooze({ id: n._id, untilISO: until }));
                    }}
                  >
                    <Clock size={13} />
                  </button>
                </Tooltip>
              );
              return (
                <div key={n._id} style={{ position: "relative" }}>
                  {n.linkHref ? (
                    <Link to={n.linkHref} style={{ color: "inherit", textDecoration: "none" }}>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                  {snoozeButton}
                  {clearButton}
                </div>
              );
            })}

            <div className="notif-panel__foot">
              <Link
                to="/app/notifications?tab=settings"
                className="btn btn--ghost btn--sm"
                onClick={() => setOpen(false)}
              >
                <Settings2 size={12} aria-hidden="true" /> Settings
              </Link>
              <Link
                to="/app/notifications"
                className="btn btn--ghost btn--sm"
                onClick={() => setOpen(false)}
              >
                View all
              </Link>
            </div>
          </div>
          </>,
          document.body,
        )}
    </>
  );
}
