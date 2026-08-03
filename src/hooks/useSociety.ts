import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useAuth } from "../auth/AuthProvider";
import { getAuthMode } from "../lib/authMode";
import { STATIC_DEMO_SOCIETY_ID } from "../lib/staticIds";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import { setStoredUserId } from "./useCurrentUser";

const KEY = "societyer.currentSocietyId";
const SOCIETY_CHANGED_EVENT = "societyer:society-changed";
let staticSocietyId = STATIC_DEMO_SOCIETY_ID as Id<"societies"> | null;
let membershipUserIds: Map<Id<"societies">, Id<"users">> | null = null;

type SocietyView = Doc<"societies"> & {
  logoUrl?: string;
  logoDarkUrl?: string;
  letterheadUrl?: string;
};

function requiresMembershipSelection() {
  return getAuthMode() === "better-auth" && !isLocalDataRuntime();
}

export function setMembershipSocietyIds(
  memberships: ReadonlyArray<{ societyId: Id<"societies">; userId: Id<"users"> }> | null,
) {
  membershipUserIds = memberships
    ? new Map(memberships.map(({ societyId, userId }) => [societyId, userId]))
    : null;
}

export function getStoredSocietyId(): Id<"societies"> | null {
  if (isStaticDemoRuntime()) return staticSocietyId;
  const value = localStorage.getItem(KEY) as Id<"societies"> | null;
  if (requiresMembershipSelection() && value && !membershipUserIds?.has(value)) {
    localStorage.removeItem(KEY);
    return null;
  }
  return value;
}

export function setStoredSocietyId(id: Id<"societies"> | null) {
  if (requiresMembershipSelection() && id && !membershipUserIds?.has(id)) {
    if (!isStaticDemoRuntime()) localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(SOCIETY_CHANGED_EVENT));
    return;
  }

  if (isStaticDemoRuntime()) {
    staticSocietyId = id;
  } else if (id) {
    localStorage.setItem(KEY, id);
  } else {
    localStorage.removeItem(KEY);
  }
  if (requiresMembershipSelection()) {
    setStoredUserId(id ? membershipUserIds?.get(id) ?? null : null);
  }
  window.dispatchEvent(new Event(SOCIETY_CHANGED_EVENT));
}

export function useSocieties() {
  const auth = useAuth();
  const localSocieties = useQuery(
    api.society.list,
    auth.mode === "better-auth" ? "skip" : {},
  ) as SocietyView[] | undefined;
  const societies = (auth.mode === "better-auth" ? auth.societies : localSocieties) as
    | SocietyView[]
    | undefined;
  return useMemo(() => {
    if (!societies) return societies;
    return [...societies].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? ""),
    );
  }, [societies]);
}

export function useSocietySelection() {
  const societies = useSocieties();
  const [societyId, setSocietyIdState] = useState<Id<"societies"> | null>(() =>
    getStoredSocietyId(),
  );

  useEffect(() => {
    const sync = () => setSocietyIdState(getStoredSocietyId());
    window.addEventListener(SOCIETY_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SOCIETY_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!societies) return;
    if (societies.length === 0) {
      if (societyId !== null) setStoredSocietyId(null);
      return;
    }
    const valid = societyId
      ? societies.some((society) => society._id === societyId)
      : false;
    if (!valid) setStoredSocietyId(societies[0]._id);
  }, [societies, societyId]);

  const society = useMemo(() => {
    if (!societies) return undefined;
    if (societies.length === 0) return null;
    const selected = societyId
      ? societies.find((candidate) => candidate._id === societyId)
      : null;
    return selected ?? societies[0] ?? null;
  }, [societies, societyId]);

  return {
    societies,
    society,
    societyId: society?._id ?? null,
    setSocietyId: setStoredSocietyId,
  };
}

export function useSociety() {
  return useSocietySelection().society as SocietyView;
}
