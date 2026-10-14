import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Page tabs synced to a URL search param (default `tab`), like RecordShowPage:
 * deep links open the right tab and switching replaces history instead of
 * stacking entries. Unknown values fall back to `fallback`.
 */
export function useUrlTab<T extends string>(allowed: readonly T[], fallback: T, param = "tab") {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const setValue = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next === fallback) copy.delete(param);
          else copy.set(param, next);
          return copy;
        },
        { replace: true },
      );
    },
    [fallback, param, setParams],
  );
  return [value, setValue] as const;
}
