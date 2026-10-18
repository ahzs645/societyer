import { useRecordQuery } from "./useRecordQuery";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useSyncExternalStore } from "react";
import { getAuthMode } from "../lib/authMode";
import { STATIC_DEMO_USER_ID } from "../lib/staticIds";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";

const KEY = "societyer.currentUserId";
let staticUserId = STATIC_DEMO_USER_ID as Id<"users"> | null;
let tabUserId: Id<"users"> | null | undefined;
let principalUsers: Map<Id<"users">, Doc<"users">> | null = null;

export function setPrincipalUsers(users: readonly Doc<"users">[] | null) {
  principalUsers = users ? new Map(users.map((user) => [user._id, user])) : null;
}

export function getStoredUserId(): Id<"users"> | null {
  if (isStaticDemoRuntime()) return staticUserId;
  if (tabUserId === undefined) {
    try { tabUserId = localStorage.getItem(KEY) as Id<"users"> | null; }
    catch { tabUserId = null; }
  }
  const value = tabUserId;
  if (
    getAuthMode() !== "none" &&
    !isLocalDataRuntime() &&
    value &&
    !principalUsers?.has(value)
  ) {
    return null;
  }
  return value;
}

export function setStoredUserId(id: Id<"users"> | null) {
  if (
    getAuthMode() !== "none" &&
    !isLocalDataRuntime() &&
    id &&
    !principalUsers?.has(id)
  ) {
    return;
  }
  if (isStaticDemoRuntime()) {
    staticUserId = id;
  } else {
    tabUserId = id;
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch { /* Keep the tab usable when browser storage is unavailable. */ }
  }
  window.dispatchEvent(new Event("societyer:user-changed"));
}

function subscribeCurrentUser(onChange: () => void) {
  window.addEventListener("societyer:user-changed", onChange);
  return () => window.removeEventListener("societyer:user-changed", onChange);
}

export function useCurrentUserId(): Id<"users"> | null {
  return useSyncExternalStore(subscribeCurrentUser, getStoredUserId, () => null);
}

export function useCurrentUser() {
  const id = useCurrentUserId();
  const usePrincipalUser = getAuthMode() !== "none" && !isLocalDataRuntime();
  // A stored id can name a user that is not in this workspace (the bundled
  // demo owner in a fresh local workspace, or a removed user): that reads as
  // "no current user", not as an error (A8).
  const user = useRecordQuery<Doc<"users">>(api.users.get, !usePrincipalUser && id ? { id } : "skip");
  if (usePrincipalUser) return id ? principalUsers?.get(id) ?? null : null;
  return user ?? null;
}

const RANK: Record<string, number> = {
  Owner: 100,
  Admin: 80,
  Director: 60,
  Member: 40,
  Viewer: 20,
};

export function hasRole(role: string | undefined | null, required: string): boolean {
  if (!role) return false;
  return (RANK[role] ?? 0) >= (RANK[required] ?? 0);
}

export function isRealAuthEnabled() {
  return getAuthMode() !== "none";
}
