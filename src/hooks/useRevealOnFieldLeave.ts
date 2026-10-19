import { useRef } from "react";

/**
 * Handlers for a form's wrapper (a <fieldset>) whose "Required before
 * saving" note waits until a field has been left, so an empty form doesn't
 * open in red.
 *
 * Leaving a field by keyboard reveals the note. A press inside the form does
 * not: the press blurs the previous field before it lands, so a note inserted
 * above the fields mid-press slides the pressed control away and the press
 * opens nothing (a select or date trigger). Pointer users see the note when
 * they press Save instead.
 */
export function useRevealOnFieldLeave(reveal: () => void) {
  const pressedInside = useRef(false);
  return {
    onPointerDownCapture: () => {
      pressedInside.current = true;
    },
    onKeyDownCapture: () => {
      pressedInside.current = false;
    },
    onBlur: () => {
      if (!pressedInside.current) reveal();
    },
  };
}
