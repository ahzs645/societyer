import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";
import { authInstanceLabel, useAuthCapabilities } from "./authCapabilities";

type AuthShellProps = {
  title: string;
  /** One or two plain sentences under the title. */
  lede?: ReactNode;
  children?: ReactNode;
  /** A single line under the card, e.g. "New here? Create an account". */
  after?: ReactNode;
  /**
   * The footer help question, e.g. "Trouble signing in?". The shell finishes
   * it with "Contact <support email>" when the deployment names one, else
   * "Contact your workspace administrator."; without a question the footer
   * still offers "Need help? Contact <support email>".
   */
  help?: ReactNode;
  /** "plain" drops the card chrome for widgets that bring their own (Clerk). */
  variant?: "card" | "plain";
  /** A small decorative icon above the title, e.g. for "Check your email". */
  icon?: ReactNode;
  /**
   * Names the screen's current state ("sign-in", "reset-sent", …). When it
   * changes, focus moves to the title and the live region reads `announce`
   * (else a string lede), so screen readers hear the new state.
   */
  stateKey?: string;
  announce?: string;
};

/** Page frame shared by sign-in, password reset and invitation pages. */
export function AuthShell({ title, lede, children, after, help, variant = "card", icon, stateKey, announce }: AuthShellProps) {
  const capabilities = useAuthCapabilities();
  const instance = authInstanceLabel(capabilities);
  const supportEmail = capabilities?.supportEmail;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const shownStateKey = useRef(stateKey);
  const spoken = announce ?? (typeof lede === "string" ? lede : undefined);

  // Only on a change of state, never on first load: the page title and
  // autofocus-free form are enough there.
  useEffect(() => {
    if (shownStateKey.current === stateKey) return;
    shownStateKey.current = stateKey;
    headingRef.current?.focus();
    // The heading announces itself on focus; the live region adds the detail.
    // A fresh node each time makes repeated text announce again.
    const live = liveRef.current;
    if (live && spoken) {
      const line = document.createElement("span");
      line.textContent = spoken;
      live.replaceChildren(line);
    }
  }, [stateKey, spoken]);

  return (
    <div className="auth">
      <main className="auth__main">
        <div className="auth__brand">
          <span className="auth__wordmark">
            <SocietyerMark />
            <span>Societyer</span>
          </span>
          {instance && (
            <span className="auth__instance">
              <Building2 size={12} aria-hidden="true" />
              {instance}
            </span>
          )}
        </div>

        <section className={`auth__card${variant === "plain" ? " auth__card--plain" : ""}`} aria-labelledby="auth-title">
          <header className="auth__header">
            {icon && <span className="auth__icon" aria-hidden="true">{icon}</span>}
            <h1 id="auth-title" ref={headingRef} tabIndex={-1} className="auth__title">{title}</h1>
            {lede && <p className="auth__lede">{lede}</p>}
          </header>
          {children}
        </section>

        {after && <div className="auth__after">{after}</div>}
        <p ref={liveRef} className="sr-only" role="status" aria-live="polite" />
      </main>

      <footer className="auth__footer">
        {(help || supportEmail) && (
          <p className="auth__help">
            {help ?? "Need help?"}{" "}
            {supportEmail ? (
              <>Contact <a className="auth__help-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</>
            ) : (
              "Contact your workspace administrator."
            )}
          </p>
        )}
        {/* "/" is Societyer's public product page. A deployment that belongs
            to one organization has no home of its own to go back to. */}
        {!instance && <Link to="/" className="auth__footer-link">Back to home</Link>}
      </footer>
    </div>
  );
}

/** Keeps the button's width while a spinner replaces its label. */
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText: string; children: ReactNode }) {
  return (
    <>
      <span className="auth__submit-label" aria-hidden={busy || undefined}>{children}</span>
      {busy && (
        <>
          <span className="spinner spinner--md auth__submit-spinner" aria-hidden="true" />
          <span className="sr-only">{busyText}</span>
        </>
      )}
    </>
  );
}

/** A status line with a spinner, for "Checking your session…" style states. */
export function AuthPending({ children }: { children: ReactNode }) {
  return (
    <p className="auth__pending" role="status">
      <span className="spinner spinner--md" aria-hidden="true" />
      {children}
    </p>
  );
}

/** The favicon mark, drawn in theme colours. */
function SocietyerMark() {
  return (
    <svg className="auth__mark" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true" focusable="false">
      <rect className="auth__mark-tile" width="32" height="32" rx="8" />
      <path
        className="auth__mark-glyph"
        d="M10 12c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v2h-4v-1h-4v3h6c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2h-8c-1.1 0-2-.9-2-2v-2h4v1h4v-3h-6c-1.1 0-2-.9-2-2v-4z"
      />
    </svg>
  );
}
