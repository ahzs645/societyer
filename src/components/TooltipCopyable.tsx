import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { copyTextToClipboard } from "../lib/regulatoryCitations";

/**
 * An ID, account or registration number, token or link that copies on click.
 *
 * Hover or focus shows the full value with a "Click to copy" hint; clicking
 * (or Enter/Space) copies it and the hint becomes "Copied". Wraps the shared
 * `Tooltip` rather than changing it. Works without hover too: the inline copy
 * icon turns into a check, and a polite live region announces "Copied".
 */
export function TooltipCopyable({
  value,
  children,
  label,
  mono = true,
  showIcon = true,
  className,
  placement = "top",
}: {
  /** The exact text that goes on the clipboard. */
  value: string;
  /** What to show inline. Defaults to `value`. */
  children?: ReactNode;
  /** What is being copied, for the accessible name, e.g. "registration number". */
  label?: string;
  mono?: boolean;
  showIcon?: boolean;
  className?: string;
  placement?: "top" | "bottom" | "left" | "right";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    const ok = await copyTextToClipboard(value);
    setState(ok ? "copied" : "failed");
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState("idle"), 1600);
  };

  const hint = state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy — select the text instead" : "Click to copy";
  const classes = ["copyable", mono ? "copyable--mono" : "", state === "copied" ? "is-copied" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <Tooltip
      placement={placement}
      delay={200}
      content={
        <span className="tooltip-copyable">
          <span className="tooltip-copyable__value">{value}</span>
          <span className="tooltip-copyable__hint">{hint}</span>
        </span>
      }
    >
      <button
        type="button"
        className={classes}
        onClick={(event) => {
          // Rows and cards often open on click; copying must not.
          event.stopPropagation();
          void copy();
        }}
        aria-label={`Copy ${label ?? "value"} ${value}`}
      >
        <span className="copyable__text">{children ?? value}</span>
        {showIcon && (
          <span className="copyable__icon" aria-hidden="true">
            {state === "copied" ? <Check size={12} /> : <Copy size={12} />}
          </span>
        )}
        <span className="sr-only" aria-live="polite">{state === "copied" ? "Copied" : ""}</span>
      </button>
    </Tooltip>
  );
}
