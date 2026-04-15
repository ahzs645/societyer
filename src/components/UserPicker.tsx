import { useQuery } from "convex/react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import {
  useCurrentUserId,
  useCurrentUser,
  setStoredUserId,
} from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { ChevronDown, LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";

export function UserPicker() {
  const auth = useAuth();
  const society = useSociety();
  const users = useQuery(
    api.users.list,
    society ? { societyId: society._id } : "skip",
  );
  const current = useCurrentUser();
  const currentId = useCurrentUserId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(220, rect.width);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      setAnchor({ top: rect.bottom + 4, left, width });
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
    if (owner) setStoredUserId(owner._id);
  }, [currentId, users]);

  if (!society) return null;

  if (auth.mode === "better-auth") {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "10px 12px",
          background: "var(--bg-panel)",
          display: "grid",
          gap: 10,
        }}
      >
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <User size={12} />
          <span style={{ fontWeight: 500, flex: 1 }}>
            {current?.displayName ?? auth.session?.user.name ?? auth.session?.user.email}
          </span>
          {current?.role && (
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
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          Signed in through Better Auth. Member eligibility and staff permissions
          resolve into the society workspace from here.
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
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
      >
        <User size={12} />
        <span style={{ fontWeight: 500, flex: 1, textAlign: "left" }}>
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
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              width: anchor.width,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "var(--shadow-md, 0 8px 24px rgba(0,0,0,0.2))",
              zIndex: 1000,
              overflow: "hidden",
              color: "var(--text-primary)",
            }}
          >
            {(users ?? []).map((u: any) => (
              <div
                key={u._id}
                onClick={() => {
                  setStoredUserId(u._id);
                  setOpen(false);
                }}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
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
                <span className="muted" style={{ fontSize: 11 }}>{u.role}</span>
              </div>
            ))}
            {(users ?? []).length === 0 && (
              <div className="muted" style={{ padding: 12, fontSize: 12 }}>
                Add users under Users & roles, or click Reseed in the demo banner.
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
