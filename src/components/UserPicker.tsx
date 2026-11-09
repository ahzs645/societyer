import { useConvex } from "convex/react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { StaticConvexClient, LocalActorChoice } from "../lib/staticConvexClient";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import type { Id } from "../../convex/_generated/dataModel";
import {
  useCurrentUserId,
  useCurrentUser,
  setStoredUserId,
} from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { ChevronDown, ChevronsUpDown, KeyRound, LayoutGrid, LogOut, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAuthenticatorEnrollment } from "../auth/authCapabilities";
import { usesBetterAuthClient } from "../lib/authMode";
import { useDialogFocus } from "../lib/useDialogFocus";
import { Menu, type MenuSection } from "./Menu";

const ClerkProfileOpener = lazy(() => import("../auth/ClerkAccountButton").then((module) => ({ default: module.ClerkProfileOpener })));

/**
 * The active users of the current workspace that the local/demo runtime lets
 * you act as. `undefined` while loading, and always `undefined` with real
 * sign-in (your membership decides who you are). Shared by the sidebar picker
 * and the demo banner's role switcher.
 */
export function useLocalActorChoices(): LocalActorChoice[] | undefined {
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
  return users;
}

/** Act as another workspace user (local/demo runtimes) — the picker's own mechanism. */
export function actAsLocalUser(id: string) {
  setStoredUserId(id as Id<"users">);
}

export function UserPicker({ compact = false }: { compact?: boolean } = {}) {
  const auth = useAuth();
  const society = useSociety();
  if (!society) return null;
  if (auth.mode !== "none") return <AccountMenu compact={compact} />;
  return <LocalActorPicker compact={compact} />;
}

/**
 * Hosted sign-in: one footer row (avatar, name, role) that opens the account
 * menu. The rail shows only the avatar; the menu is the same either way.
 */
function AccountMenu({ compact }: { compact: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const authenticatorEnrollment = useAuthenticatorEnrollment();
  const current = useCurrentUser();
  const [openClerkProfile, setOpenClerkProfile] = useState<(() => void) | null>(null);
  // Wrapped: a bare function passed to a state setter would run as an updater.
  const receiveClerkProfile = useCallback((open: (() => void) | null) => setOpenClerkProfile(() => open), []);

  const email = auth.session?.user.email ?? "";
  const name = current?.displayName ?? auth.session?.user.name ?? email;
  const role = current?.role;
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const securityAvailable = usesBetterAuthClient(auth.mode) && (authenticatorEnrollment || auth.session?.user.twoFactorEnabled === true);

  const accountItems: MenuSection["items"] = [];
  if (auth.mode === "convex") {
    accountItems.push({ id: "workspaces", label: "My workspaces", icon: <LayoutGrid size={14} />, onSelect: () => navigate("/account/workspaces") });
    // Sign-in methods links on to account security and to linking another login.
    accountItems.push({ id: "sign-in", label: "Sign-in & security", icon: <KeyRound size={14} />, onSelect: () => navigate("/account/sign-in-methods") });
  } else if (securityAvailable) {
    accountItems.push({ id: "security", label: "Account security", icon: <ShieldCheck size={14} />, onSelect: () => navigate("/account/security") });
  }
  if (auth.mode === "clerk" && openClerkProfile) {
    accountItems.push({ id: "clerk-profile", label: "Manage account", icon: <UserRound size={14} />, onSelect: openClerkProfile });
  }
  if (current?.memberId) {
    accountItems.push({ id: "portal", label: "Member portal", icon: <UsersRound size={14} />, onSelect: () => navigate("/portal") });
  }
  const sections: MenuSection[] = [
    ...(accountItems.length ? [{ id: "account", items: accountItems }] : []),
    { id: "session", items: [{ id: "sign-out", label: "Sign out", icon: <LogOut size={14} />, onSelect: () => void auth.signOut() }] },
  ];

  return (
    <>
      {auth.mode === "clerk" && (
        <Suspense fallback={null}><ClerkProfileOpener onReady={receiveClerkProfile} /></Suspense>
      )}
      <Menu
        label="Account"
        minWidth={240}
        header={
          <div className="sidebar-account__menu-head">
            <span className="sidebar-account__menu-name">{name}</span>
            {email && email !== name && <span className="muted sidebar-account__menu-email">{email}</span>}
            {role && <span className="muted sidebar-account__menu-role">{role} in this workspace</span>}
          </div>
        }
        sections={sections}
        trigger={
          <button
            type="button"
            className="user-picker sidebar-account__trigger"
            title={role ? `${name} (${role})` : name}
            aria-label={`Account: ${name}`}
          >
            <span className="sidebar-account__avatar" aria-hidden="true">{initial}</span>
            {!compact && <span className="sidebar-account__name">{name}</span>}
            {!compact && role && <span className="sidebar-account__role">{role}</span>}
            {!compact && <ChevronsUpDown size={12} className="sidebar-account__chevron" aria-hidden="true" />}
          </button>
        }
      />
    </>
  );
}

/** Local/demo runtimes: pick which workspace user to act as. */
function LocalActorPicker({ compact }: { compact: boolean }) {
  const users = useLocalActorChoices();
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
      if (compact) {
        const width = Math.min(260, window.innerWidth - rect.right - gap * 2 - margin);
        setAnchor({ bottom: Math.max(margin, window.innerHeight - rect.bottom), left: rect.right + gap * 2, width, maxHeight: window.innerHeight - margin * 2 });
        return;
      }
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
  }, [open, compact]);

  useEffect(() => {
    if (!users || users.length === 0) return;
    if (currentId && users.some((u: any) => u._id === currentId)) return;
    const owner = users.find((u: any) => u.role === "Owner") ?? users[0];
    if (owner) setStoredUserId(owner._id as Id<"users">);
  }, [currentId, users]);

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
            data-floating-layer=""
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
              border: 0,
              borderRadius: "var(--r-card)",
              boxShadow: "var(--elevation-2)",
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
