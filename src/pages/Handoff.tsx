import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { Link, Navigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../auth/AuthShell";
import { AppBootScreen } from "../components/AppBootScreen";
import { loadSessionAuthClient } from "../lib/sessionAuthClient";
import {
  beginHandoff,
  handoffOutcome,
  issueHandoff,
  type HandoffBegin,
  type HandoffFetch,
  type HandoffIssue,
} from "../lib/sessionHandoff";
import { originHost, parseDomainWorkspace } from "../lib/workspaceDomain";

/**
 * Landing for a cross-domain session handoff (see sessionHandoff.ts). The
 * fragment was already stripped, and a code redeemed, before the session hook
 * mounted (`completeSessionHandoff` in convexAuthClient.ts). This page runs
 * the middle steps and then only continues.
 */
export default function HandoffPage() {
  const auth = useAuth();
  const outcome = handoffOutcome();
  if (auth.mode !== "convex") return <Navigate to="/app" replace />;
  if (outcome?.status === "step") return <HandoffStep step={outcome.step} />;
  const next = outcome?.next ?? "/app";
  if (outcome?.status === "redeemed") {
    if (auth.sessionStatus === "loading") return <AppBootScreen label="Opening your workspace…" />;
    // The stored workspace is applied by sign-in's startup choice, and only if
    // this login is a member there.
    if (auth.session) return <Navigate to={next} replace />;
  }
  return (
    <AuthShell title="Sign in to continue" lede="This link expired or was already used. Sign in to continue.">
      <Link className="btn btn--primary auth__submit" to={`/login?redirect=${encodeURIComponent(next)}`}>{auth.session ? "Continue" : "Sign in"}</Link>
    </AuthShell>
  );
}

/**
 * Steps 2 (target) and 3 (source). The other origin must be a mapped
 * workspace domain, so a trusted domain can't be used as an open redirect.
 */
function HandoffStep({ step }: { step: HandoffBegin | HandoffIssue }) {
  const auth = useAuth();
  const convex = useConvex();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);
  const peer = step.mode === "begin" ? step.from : step.target;
  const sessionReady = step.mode === "begin" || auth.sessionStatus === "authenticated";
  const signedOut = step.mode === "issue" && auth.sessionStatus !== "loading" && auth.sessionStatus !== "authenticated";

  useEffect(() => {
    if (started.current || !sessionReady) return;
    started.current = true;
    void (async () => {
      try {
        const mapped = parseDomainWorkspace(await convex.query(api.workspaceDomains.resolveOrigin, { origin: peer }));
        if (!mapped) {
          setProblem(`${originHost(peer) ?? "That site"} isn't one of this deployment's workspace sites, so the switch was stopped.`);
          return;
        }
        const url = step.mode === "begin"
          ? await beginHandoff(step, { currentOrigin: window.location.origin })
          : await issueHandoff(step, (await loadSessionAuthClient()).authClient.$fetch as unknown as HandoffFetch);
        // Replace, so Back from the destination returns to the switcher, not to a spent hop.
        window.location.replace(url);
      } catch (cause) {
        console.warn("[societyer-auth] session handoff step failed", cause);
        setProblem(cause instanceof Error && cause.message ? cause.message : "That workspace couldn't be opened. Try again.");
      }
    })();
  }, [convex, peer, sessionReady, step]);

  if (signedOut) {
    return (
      <AuthShell title="Sign in to switch workspaces" lede="Sign in here first, then switch again.">
        <Link className="btn btn--primary auth__submit" to="/login?redirect=%2Fapp">Sign in</Link>
      </AuthShell>
    );
  }
  if (problem) {
    return (
      <AuthShell title="Couldn't switch workspaces" lede={problem}>
        <Link className="btn btn--primary auth__submit" to="/app">Continue</Link>
      </AuthShell>
    );
  }
  return <AppBootScreen label="Opening your workspace…" />;
}
