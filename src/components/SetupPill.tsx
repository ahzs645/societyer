import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, CircleDashed, CircleDot, Clock3, EyeOff, Lock, MinusCircle } from "lucide-react";
import { useSetupGuideHidden, useSetupSummaryOnScreen } from "../hooks/useSetupProgress";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganizationSetup } from "../features/organizationSetup/useOrganizationSetup";
import { interfaceRouteReadPermission } from "../../shared/interfaceRouteAccess";
import { ORGANIZATION_SETUP_PATH, type SetupStepState, type SetupStepView } from "../../shared/organizationSetup/types";
import { isOrganizationSetupPath, setupPercent, setupStepLink, setupSummaryTitle } from "../lib/organizationSetupLinks";
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
  done: "Done",
  in_progress: "Started",
  todo: "To do",
  later: "Later",
  not_applicable: "Doesn't apply",
  restricted: "Ask an owner or admin",
};

function StateIcon({ state, next }: { state: SetupStepState; next: boolean }) {
  if (state === "done") return <CheckCircle2 size={16} />;
  if (next) return <CircleDot size={16} />;
  if (state === "in_progress") return <CircleDashed size={16} />;
  if (state === "later") return <Clock3 size={16} />;
  if (state === "not_applicable") return <MinusCircle size={16} />;
  if (state === "restricted") return <Lock size={16} />;
  return <Circle size={16} />;
}

type Anchor = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

const POPOVER_WIDTH = 340;

/**
 * Compact "Setup 3/14" pill. Follows the user across pages (sidebar header,
 * icon rail, or the phone top bar) and opens a popover with the current
 * phase's steps and a link to the setup view. Reads the same progress as the
 * setup view and the Dashboard summary card. Hidden once setup is complete,
 * while the Dashboard card is on screen, or when the viewer hides it here
 * (that hides the Dashboard card too; never the view). Dismissing only the
 * Dashboard card keeps the pill, so there is still a way back to setup.
 */
export function SetupPill({ variant }: { variant: Variant }) {
  const society = useSociety();
  const societyId = society?._id ? String(society._id) : null;
  const { hidden, setHidden } = useSetupGuideHidden(societyId);
  const summaryOnScreen = useSetupSummaryOnScreen();
  // Skip the query entirely once the viewer hid the pill.
  const progress = useOrganizationSetup(hidden ? null : societyId);
  const permissions = usePermissions();
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
        popoverRef.current?.querySelector<HTMLElement>("a.setup-pop__step.is-next") ??
        popoverRef.current?.querySelector<HTMLElement>("a, button");
      target?.focus({ preventScroll: true });
    }, 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (hidden || !progress || progress.complete || progress.counts.total === 0) return null;
  // Progress shows once: the Dashboard's summary card (while it is on screen)
  // or the setup view itself. A dismissed card leaves the pill as the way back.
  if (summaryOnScreen || isOrganizationSetupPath(location.pathname)) return null;

  const { done: completed, total } = progress.counts;
  const percent = setupPercent(progress);
  const summary = `Setup: ${completed} of ${total} done`;
  const phase = progress.phases.find((candidate) => candidate.key === progress.currentPhase) ?? progress.phases[0];
  const steps = phase?.steps ?? [];
  const nextKey = progress.next?.key;
  const restricted = (step: SetupStepView) => {
    if (step.state === "restricted") return true;
    // The progress query already checks route access; this catches a link the
    // viewer's role can't open before the next update arrives.
    const permission = step.to ? interfaceRouteReadPermission(step.to.split(/[?#]/)[0]) : undefined;
    return Boolean(permissions.loaded && permission && !permissions.can(permission));
  };

  const hide = () => {
    setOpen(false);
    setHidden(true);
    toast.info("Setup reminder hidden", {
      description: "The setup page is still in the menu.",
      action: { label: "Undo", onClick: () => setHidden(false) },
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
              <strong id={titleId}>{setupSummaryTitle(progress, society?.name)}</strong>
              <span>{completed} of {total} done{phase ? ` · ${phase.statusNote ?? phase.title}` : ""}</span>
            </div>
          </div>
          <ol className="setup-pop__steps">
            {steps.map((step) => {
              const isNext = step.key === nextKey;
              const locked = restricted(step);
              const state: SetupStepState = locked ? "restricted" : step.state;
              const body = (
                <>
                  <span className="setup-pop__state"><StateIcon state={state} next={isNext && !locked} /></span>
                  <span className="setup-pop__text">
                    <span className="setup-pop__title">{step.title}{step.optional ? <span className="setup-pop__optional"> (optional)</span> : null}</span>
                    {isNext && !locked && <span className="setup-pop__desc">{step.description}</span>}
                    {locked && <span className="setup-pop__desc">Ask an owner or admin to do this.</span>}
                  </span>
                  <span className="sr-only">, {isNext && !locked ? "Next" : STATE_LABEL[state]}</span>
                  {isNext && !locked && <ArrowRight size={14} className="setup-pop__go" aria-hidden="true" />}
                </>
              );
              const className = `setup-pop__step is-${state.replace("_", "-")}${isNext && !locked ? " is-next" : ""}`;
              return (
                <li key={step.key}>
                  {locked ? (
                    <div className={className}>{body}</div>
                  ) : (
                    <Link to={setupStepLink(step)} className={className} onClick={() => setOpen(false)}>{body}</Link>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="setup-pop__foot">
            <Link to={ORGANIZATION_SETUP_PATH} className="setup-pop__link" onClick={() => setOpen(false)}>Open setup</Link>
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
