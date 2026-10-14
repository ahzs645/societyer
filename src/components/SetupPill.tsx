import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, CircleDot, EyeOff } from "lucide-react";
import { useSetupProgress, type SetupStepState } from "../hooks/useSetupProgress";
import { useToast } from "./Toast";

type Variant = "sidebar" | "rail" | "topbar";

/** Progress ring: the filled arc is the share of setup checks complete. */
export function SetupRing({ percent, size = 18 }: { percent: number; size?: number }) {
  const stroke = size >= 22 ? 3 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, percent)) / 100;
  return (
    <svg className="setup-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="setup-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
      <circle
        className="setup-ring__fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

const STATE_LABEL: Record<SetupStepState, string> = {
  complete: "Complete",
  next: "Next",
  upcoming: "To do",
};

function StateIcon({ state }: { state: SetupStepState }) {
  if (state === "complete") return <CheckCircle2 size={16} />;
  if (state === "next") return <CircleDot size={16} />;
  return <Circle size={16} />;
}

type Anchor = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

const POPOVER_WIDTH = 340;

/**
 * Compact "Setup 6/8" activation pill. Follows the user across pages (sidebar
 * header, icon rail, or the phone top bar) and opens a popover listing the
 * remaining steps. Hidden once setup is complete or the guide is dismissed —
 * dismissal is shared with the Dashboard's setup guide.
 */
export function SetupPill({ variant }: { variant: Variant }) {
  const progress = useSetupProgress();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const titleId = useId();

  // Close when the user navigates (a step link was followed).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const gap = 6;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - margin * 2);
      let left: number;
      let top: number | undefined;
      if (variant === "rail") {
        left = rect.right + gap;
        top = rect.top;
      } else if (variant === "topbar") {
        left = rect.right - width;
        top = rect.bottom + gap;
      } else {
        left = rect.left;
        top = rect.bottom + gap;
      }
      left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
      const maxHeight = Math.max(200, window.innerHeight - (top ?? 0) - margin);
      setAnchor({ top, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => {
      const target =
        popoverRef.current?.querySelector<HTMLElement>(".setup-pop__step.is-next") ??
        popoverRef.current?.querySelector<HTMLElement>("a, button");
      target?.focus({ preventScroll: true });
    }, 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!progress || progress.loading || progress.hidden || progress.allComplete || progress.total === 0) return null;
  // The Dashboard shows the full checklist; don't repeat it there.
  if (location.pathname === "/app" || location.pathname === "/app/") return null;

  const { completed, total, percent, steps } = progress;
  const summary = `Setup ${completed} of ${total} complete`;

  const hide = () => {
    setOpen(false);
    progress.setHidden(true);
    toast.info("Setup guide hidden", {
      action: { label: "Undo", onClick: () => progress.setHidden(false) },
    });
  };

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a, button"));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`setup-pill setup-pill--${variant}${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`${summary}. Show remaining setup steps`}
        title={variant === "sidebar" ? undefined : summary}
        onClick={() => setOpen((value) => !value)}
      >
        <SetupRing percent={percent} size={variant === "topbar" ? 24 : 18} />
        {variant === "sidebar" && (
          <>
            <span className="setup-pill__label">Setup</span>
            <span className="setup-pill__count">{completed}/{total}</span>
          </>
        )}
        {variant === "topbar" && <span className="setup-pill__ring-count" aria-hidden="true">{completed}</span>}
      </button>
      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className="setup-pop"
          role="dialog"
          aria-labelledby={titleId}
          data-floating-layer=""
          style={{ top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: anchor.maxHeight }}
          onKeyDown={onPopoverKeyDown}
        >
          <div className="setup-pop__head">
            <SetupRing percent={percent} size={32} />
            <div className="setup-pop__intro">
              <strong id={titleId}>Finish setting up</strong>
              <span>{completed} of {total} checks complete</span>
            </div>
          </div>
          <ol className="setup-pop__steps">
            {steps.map((step) => {
              const state = progress.stateOf(step);
              return (
                <li key={step.id}>
                  <Link to={step.to} className={`setup-pop__step is-${state}`} onClick={() => setOpen(false)}>
                    <span className="setup-pop__state"><StateIcon state={state} /></span>
                    <span className="setup-pop__text">
                      <span className="setup-pop__title">{step.title}</span>
                      {state === "next" && <span className="setup-pop__desc">{step.description}</span>}
                    </span>
                    <span className="sr-only">, {STATE_LABEL[state]}</span>
                    {state === "next" && <ArrowRight size={14} className="setup-pop__go" aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="setup-pop__foot">
            <Link to="/app" className="setup-pop__link" onClick={() => setOpen(false)}>Open the setup guide</Link>
            <button type="button" className="setup-pop__hide" onClick={hide}>
              <EyeOff size={13} aria-hidden="true" /> Hide
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
