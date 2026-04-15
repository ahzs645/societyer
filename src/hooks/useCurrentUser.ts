import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { getAuthMode } from "../lib/authMode";

const KEY = "societyer.currentUserId";

export function getStoredUserId(): Id<"users"> | null {
  const v = localStorage.getItem(KEY);
  return (v as Id<"users"> | null) ?? null;
}

export function setStoredUserId(id: Id<"users"> | null) {
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
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
  const user = useQuery(api.users.get, id ? { id } : "skip");
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
