import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useEffect, useMemo, useState } from "react";
import { STATIC_DEMO_SOCIETY_ID } from "../lib/staticIds";
import { isStaticDemoRuntime } from "../lib/staticRuntime";

const KEY = "societyer.currentSocietyId";
const SOCIETY_CHANGED_EVENT = "societyer:society-changed";
let staticSocietyId = STATIC_DEMO_SOCIETY_ID as Id<"societies"> | null;

export function getStoredSocietyId(): Id<"societies"> | null {
  if (isStaticDemoRuntime()) return staticSocietyId;
  const value = localStorage.getItem(KEY);
  return (value as Id<"societies"> | null) ?? null;
}

export function setStoredSocietyId(id: Id<"societies"> | null) {
  if (isStaticDemoRuntime()) {
    staticSocietyId = id;
  } else if (id) {
    localStorage.setItem(KEY, id);
  } else {
    localStorage.removeItem(KEY);
  }
  window.dispatchEvent(new Event(SOCIETY_CHANGED_EVENT));
}

export function useSocieties() {
  const societies = useQuery(api.society.list, {});
  return useMemo(() => {
    if (!societies) return societies;
    return [...societies].sort((a: any, b: any) =>
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
      ? societies.some((s: any) => s._id === societyId)
      : false;
    if (!valid) setStoredSocietyId(societies[0]._id);
  }, [societies, societyId]);

  const society = useMemo(() => {
    if (!societies) return undefined;
    if (societies.length === 0) return null;
    const selected = societyId
      ? societies.find((s: any) => s._id === societyId)
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
  return useSocietySelection().society;
}
