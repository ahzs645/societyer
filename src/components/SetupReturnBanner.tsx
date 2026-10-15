import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { useOrganizationSetup } from "../features/organizationSetup/useOrganizationSetup";
import { SETUP_RETURN_PARAM } from "../../shared/organizationSetup/types";
import { findSetupStep, isOrganizationSetupPath, setupStepLink, setupViewStepLink } from "../lib/organizationSetupLinks";

/**
 * "← Back to setup" strip, rendered once in the shell. A setup step link
 * carries `?setup=<step>`; the step is remembered for the tab (pages rewrite
 * their own query strings and open drawers) so the way back survives. It shows
 * whether the step is done yet, switches to "Done. Next: …" when the step is
 * completed on the page, and clears when the viewer opens the setup view,
 * closes it, or after 30 minutes.
 */

export const SETUP_RETURN_STORAGE_KEY = "societyer.setup.returnStep";
const RETURN_TTL_MS = 30 * 60 * 1000;
const STEP_KEY_PATTERN = /^[a-z][a-z-]{0,39}$/;

type ReturnStep = {
  stepKey: string;
  societyId: string;
  savedAt: number;
  /** Whether the step was already done when the viewer arrived. */
  doneOnArrival?: boolean;
  /** Closed with ×: stays closed (even if the address still says `?setup=`) until the setup view is opened again. */
  dismissed?: boolean;
};

function readReturnStep(): ReturnStep | null {
  try {
    const raw = window.sessionStorage.getItem(SETUP_RETURN_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.stepKey !== "string" || typeof value.societyId !== "string" || typeof value.savedAt !== "number") return null;
    if (!STEP_KEY_PATTERN.test(value.stepKey)) return null;
    if (Date.now() - value.savedAt > RETURN_TTL_MS) {
      window.sessionStorage.removeItem(SETUP_RETURN_STORAGE_KEY);
      return null;
    }
    return value as ReturnStep;
  } catch {
    return null;
  }
}

function writeReturnStep(value: ReturnStep | null) {
  try {
    if (value) window.sessionStorage.setItem(SETUP_RETURN_STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(SETUP_RETURN_STORAGE_KEY);
  } catch {
    /* storage unavailable: the banner lasts for this page view */
  }
}

export function SetupReturnBanner() {
  const location = useLocation();
  const society = useSociety();
  const societyId = society?._id ? String(society._id) : null;
  const [entry, setEntry] = useState<ReturnStep | null>(readReturnStep);
  const onSetupView = isOrganizationSetupPath(location.pathname);

  // Pick up `?setup=<step>` from a followed link; forget the step once the
  // viewer is back on the setup view.
  useEffect(() => {
    if (onSetupView) {
      writeReturnStep(null);
      setEntry(null);
      return;
    }
    const fromUrl = new URLSearchParams(location.search).get(SETUP_RETURN_PARAM);
    if (fromUrl && societyId && STEP_KEY_PATTERN.test(fromUrl)) {
      setEntry((current) => {
        if (current && current.stepKey === fromUrl && current.societyId === societyId) return current;
        const stored = readReturnStep();
        if (stored && stored.stepKey === fromUrl && stored.societyId === societyId) return stored;
        const next = { stepKey: fromUrl, societyId, savedAt: Date.now() };
        writeReturnStep(next);
        return next;
      });
      return;
    }
    setEntry(readReturnStep());
  }, [location.pathname, location.search, onSetupView, societyId]);

  // Expire while the page stays open.
  useEffect(() => {
    if (!entry) return;
    const remaining = RETURN_TTL_MS - (Date.now() - entry.savedAt);
    const timer = window.setTimeout(() => {
      writeReturnStep(null);
      setEntry(null);
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [entry]);

  const active = Boolean(entry && !entry.dismissed && societyId && entry.societyId === societyId && !onSetupView);
  const progress = useOrganizationSetup(active ? societyId : null);
  const step = active ? findSetupStep(progress, entry?.stepKey) : undefined;
  const done = step?.state === "done";

  // Remember whether the step was already done on arrival, so completing it
  // here (and only then) offers the next step.
  useEffect(() => {
    if (!entry || !step || entry.doneOnArrival !== undefined) return;
    const next = { ...entry, doneOnArrival: done };
    writeReturnStep(next);
    setEntry(next);
  }, [entry, step, done]);

  if (!active || !entry || !step || !progress) return null;

  const dismiss = () => {
    const closed = { ...entry, dismissed: true };
    writeReturnStep(closed);
    setEntry(closed);
  };
  const justCompleted = done && entry.doneOnArrival === false;
  const next = justCompleted && progress.next && progress.next.key !== step.key ? progress.next : undefined;

  return (
    <div className={`setup-return${done ? " is-done" : ""}`} role="region" aria-label="Setup" data-setup-return="">
      <Link to={setupViewStepLink(step.key)} className="setup-return__back">
        <ArrowLeft size={14} aria-hidden="true" />
        <span>Back to setup</span>
      </Link>
      <span className="setup-return__sep" aria-hidden="true">·</span>
      <span className="setup-return__step" title={step.title}>{step.title}</span>
      <span className="setup-return__sep setup-return__sep--status" aria-hidden="true">·</span>
      <span className="setup-return__status" aria-live="polite">
        {next ? (
          <Link to={setupStepLink(next)} className="setup-return__next">
            <Check size={14} aria-hidden="true" />
            <span>Done. Next: <span className="setup-return__next-title">{next.title}</span></span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : done ? (
          <span className="setup-return__done"><Check size={14} aria-hidden="true" /> Done</span>
        ) : (
          <span className="setup-return__todo">Not done yet</span>
        )}
      </span>
      <button type="button" className="setup-return__close" onClick={dismiss} aria-label="Close the back to setup bar">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
