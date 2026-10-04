import { useConvex } from "convex/react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { StaticConvexClient, LocalActorChoice } from "../lib/staticConvexClient";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import type { Id } from "../../convex/_generated/dataModel";
import {
  useCurrentUserId,
  useCurrentUser,
  setStoredUserId,
} from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { ChevronDown, LogOut } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useDialogFocus } from "../lib/useDialogFocus";

const ClerkAccountButton = lazy(() => import("../auth/ClerkAccountButton"));

export function UserPicker() {
  const auth = useAuth();
  const society = useSociety();
  const societyId = society?._id;
  const convex = useConvex();
  const [users, setUsers] = useState<LocalActorChoice[] | undefined>();
  useEffect(() => {
    setUsers(undefined);
    if (auth.mode !== "none" || !societyId || !isLocalDataRuntime()) return;
    const localClient = convex as unknown as Pick<StaticConvexClient, "subscribeLocalActorChoices">;
    if (typeof localClient.subscribeLocalActorChoices !== "function") return;
    return localClient.subscribeLocalActorChoices(societyId, (choices) => {
      setUsers(choices.filter((choice) => !choice.status || choice.status === "Active"));
    });
  }, [auth.mode, convex, societyId]);
  const current = useCurrentUser();
  const currentId = useCurrentUserId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useDialogFocus<HTMLDivElement>(open, () => setOpen(false), '[aria-selected="true"]');

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 4;
      const width = Math.max(220, rect.width);
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
      if (left < margin) left = margin;
      const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
      const spaceAbove = rect.top - margin - gap;
      const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
      if (openUpward) {
        const maxHeight = Math.max(120, Math.min(360, spaceAbove));
        setAnchor({ bottom: window.innerHeight - rect.top + gap, left, width, maxHeight });
      } else {
        const maxHeight = Math.max(120, Math.min(360, spaceBelow));
        setAnchor({ top: rect.bottom + gap, left, width, maxHeight });
      }
    };
    place();
    const h = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
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

  useEffect(() => {
    if (!users || users.length === 0) return;
    if (currentId && users.some((u: any) => u._id === currentId)) return;
    const owner = users.find((u: any) => u.role === "Owner") ?? users[0];
    if (owner) setStoredUserId(owner._id as Id<"users">);
  }, [currentId, users]);

  if (!society) return null;

  if (auth.mode !== "none") {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          padding: "10px 12px",
          background: "var(--bg-panel)",
          display: "grid",
          gap: 10,
        }}
      >
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.displayName ?? auth.session?.user.name ?? auth.session?.user.email}
          </span>
          {current?.role && (
            <span
              style={{
                fontSize: "var(--fs-xs)",
                padding: "1px 5px",
                borderRadius: "var(--r-pill)",
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              {current.role}
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Signed in to your account. Your workspace membership determines access.
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {auth.mode === "clerk" && (
            <Suspense fallback={null}><ClerkAccountButton /></Suspense>
          )}
          {current?.memberId && (
            <Link to="/portal" className="btn btn--ghost btn--sm">
              Member portal
            </Link>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => auth.signOut()}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        className="user-picker"
        onClick={() => setOpen((v) => !v)}
        title="Switch acting user"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ fontWeight: 500, flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.displayName ?? (users && users.length === 0 ? "No users" : "Pick user")}
        </span>
        {current && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 10,
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            {current.role}
          </span>
        )}
        <ChevronDown size={10} />
      </button>

      {open && anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Acting user"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
              if (!options.length) return;
              const index = options.indexOf(document.activeElement as HTMLElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
              event.preventDefault();
              options[next].focus();
            }}
            style={{
              position: "fixed",
              top: anchor.top,
              bottom: anchor.bottom,
              left: anchor.left,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-md)",
              zIndex: "var(--z-dropdown)",
              overflowY: "auto",
              color: "var(--text-primary)",
            }}
          >
            {(users ?? []).map((u) => (
              <div
                key={u._id}
                role="option"
                tabIndex={0}
                aria-selected={u._id === currentId}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setStoredUserId(u._id as Id<"users">);
                  setOpen(false);
                }}
                onClick={() => {
                  setStoredUserId(u._id as Id<"users">);
                  setOpen(false);
                }}
                style={{
                  padding: "8px 10px",
                  fontSize: "var(--fs-md)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  background:
                    u._id === currentId ? "var(--bg-subtle)" : "var(--bg-panel)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    u._id === currentId ? "var(--bg-subtle)" : "var(--bg-panel)")
                }
              >
                <span style={{ flex: 1 }}>{u.displayName}</span>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{u.role}</span>
              </div>
            ))}
            {(users ?? []).length === 0 && (
              <div className="empty-state empty-state--sm empty-state--start">
                Add users under Users & access, or click Reseed in the demo banner.
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
