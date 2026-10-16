import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Saves an open editor's draft the way its own Enter/Apply does. Returns
 * false when the draft cannot be saved and the editor should stay open.
 */
export type FieldInputFlush = () => boolean | void;

/** Registers the mounted editor's flush; returns the unregister call. */
export type RegisterFieldInputFlush = (flush: FieldInputFlush) => () => void;

/**
 * Provided by hosts that close editors from outside (the table closes its
 * cell editor on a click or tap elsewhere): they call the flush first, so
 * finishing an edit by tapping away saves it, exactly like Enter or blur.
 */
export const FieldInputFlushContext = createContext<RegisterFieldInputFlush | null>(null);

export function useFieldInputFlush(flush: FieldInputFlush) {
  const register = useContext(FieldInputFlushContext);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (!register) return;
    return register(() => flushRef.current());
  }, [register]);
}
