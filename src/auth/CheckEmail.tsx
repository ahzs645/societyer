import type { ReactNode } from "react";
import { MailCheck } from "lucide-react";
import { BusyLabel } from "./AuthShell";

export type SentState = {
  /** reset: forgot password; verify: new account; unverified: sign-in before verifying. */
  kind: "reset" | "verify" | "unverified";
  email: string;
  /** When the last link was sent; "Send again" waits out a cooldown after it. */
  at: number;
};

const SENT_COPY: Record<SentState["kind"], { title: string; lede: (email: ReactNode) => ReactNode }> = {
  reset: {
    title: "Check your email",
    lede: (email) => <>If an account exists for {email}, we sent it a link to choose a new password. The link works for one hour.</>,
  },
  verify: {
    title: "Check your email",
    lede: (email) => <>We sent a link to {email}. Open it to confirm your account, then sign in.</>,
  },
  unverified: {
    title: "Confirm your email first",
    lede: (email) => <>Your email isn't confirmed yet. We sent a new link to {email}. Open it, then sign in.</>,
  },
};

/**
 * AuthShell props for the "Check your email" state. The caller renders the
 * shell itself, so the same shell instance stays mounted when the form gives
 * way to this state and its focus/announce effect sees the change.
 */
export function checkEmailShell(sent: SentState) {
  const copy = SENT_COPY[sent.kind];
  return {
    icon: <MailCheck size={20} />,
    title: copy.title,
    lede: copy.lede(<strong className="auth__email">{sent.email}</strong>),
    announce: plainText(copy.lede(sent.email)),
    stateKey: `sent-${sent.kind}`,
  };
}

/** Card body once a reset or verification link is on its way. */
export function CheckEmailBody({
  sent,
  busy,
  resendWait,
  resent,
  onResend,
  error,
}: {
  sent: SentState;
  /** Any request in flight; "resend" shows the spinner on Send again. */
  busy: string | null;
  /** Seconds until Send again is allowed. */
  resendWait: number;
  /** How many times the link was sent again; each one is announced. */
  resent: number;
  onResend: () => void;
  error: ReactNode;
}) {
  return (
    <div className="auth__state">
      <p className="auth__hint">Didn't get it? It can take a minute to arrive. Check your spam folder, then send it again.</p>
      <button
        type="button"
        className={`btn auth__submit${busy === "resend" ? " is-busy" : ""}`}
        disabled={busy !== null || resendWait > 0}
        onClick={onResend}
      >
        <BusyLabel busy={busy === "resend"} busyText="Sending…">
          {resendWait > 0 ? `Send again in ${resendWait}s` : "Send again"}
        </BusyLabel>
      </button>
      <p className="auth__resent" role="status">
        {resent > 0 && <span key={resent}>We sent another link to {sent.email}.</span>}
      </p>
      {error}
    </div>
  );
}

/** The lede as one string for the live region (its only markup is the email). */
function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return plainText((node.props as { children?: ReactNode }).children);
  }
  return "";
}
