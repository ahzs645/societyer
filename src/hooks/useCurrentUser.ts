import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { getAuthMode } from "../lib/authMode";
import { STATIC_DEMO_USER_ID } from "../lib/staticIds";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";

const KEY = "societyer.currentUserId";
let staticUserId = STATIC_DEMO_USER_ID as Id<"users"> | null;
let principalUsers: Map<Id<"users">, Doc<"users">> | null = null;

export function setPrincipalUsers(users: readonly Doc<"users">[] | null) {
  principalUsers = users ? new Map(users.map((user) => [user._id, user])) : null;
}

export function getStoredUserId(): Id<"users"> | null {
  if (isStaticDemoRuntime()) return staticUserId;
  const value = localStorage.getItem(KEY) as Id<"users"> | null;
  if (
    getAuthMode() === "better-auth" &&
    !isLocalDataRuntime() &&
    value &&
    !principalUsers?.has(value)
  ) {
    localStorage.removeItem(KEY);
    return null;
  }
  return value;
}

export function setStoredUserId(id: Id<"users"> | null) {
  if (
    getAuthMode() === "better-auth" &&
    !isLocalDataRuntime() &&
    id &&
    !principalUsers?.has(id)
  ) {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("societyer:user-changed"));
    return;
  }
  if (isStaticDemoRuntime()) {
    staticUserId = id;
  } else if (id) {
    localStorage.setItem(KEY, id);
  } else {
    localStorage.removeItem(KEY);
  }
  window.dispatchEvent(new Event("societyer:user-changed"));
}

export function useCurrentUserId(): Id<"users"> | null {
  const [id, setId] = useState<Id<"users"> | null>(() => getStoredUserId());
  useEffect(() => {
    const h = () => setId(getStoredUserId());
    window.addEventListener("societyer:user-changed", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("societyer:user-changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return id;
}

export function useCurrentUser() {
  const id = useCurrentUserId();
  const usePrincipalUser = getAuthMode() === "better-auth" && !isLocalDataRuntime();
  const user = useQuery(api.users.get, !usePrincipalUser && id ? { id } : "skip");
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
  return getAuthMode() === "better-auth";
}
