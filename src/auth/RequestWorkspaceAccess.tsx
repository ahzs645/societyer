import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuth } from "./AuthProvider";
import { BusyLabel } from "./AuthShell";
import { formatDate } from "../lib/format";

export type AccessRequestAvailability =
  | { enabled: false }
  | {
    enabled: true;
    message?: string;
    alreadyMember: boolean;
    existing?: { id: string; status: "pending" | "approved" | "declined" | "withdrawn"; createdAtISO: string };
  };

const NOTE_LIMIT = 500;

const SUBMIT_FAILURES: Record<string, string> = {
  unavailable: "This workspace isn't taking requests right now.",
  "already-member": "You already have a membership here. Ask an administrator for help.",
  "rate-limited": "You've sent too many requests today. Try again tomorrow.",
  "email-unverified": "Verify your email address first, then ask again.",
  "identity-disabled": "This sign-in is disabled. Contact an administrator.",
  unauthenticated: "Sign in again, then ask again.",
};

/** `accessRequests:availability` for a workspace named by this domain; undefined while loading. */
export function useAccessRequestAvailability(societyId: string | undefined): AccessRequestAvailability | undefined {
  const auth = useAuth();
  return useQuery(
    api.accessRequests.availability,
    auth.mode === "convex" && auth.isConvexAuthenticated && societyId ? { societyId } : "skip",
  ) as AccessRequestAvailability | undefined;
}

/**
 * "Request access" on the no-access screen of a mapped domain. Renders nothing
 * unless that workspace takes requests (docs/shared-workspaces/user-guide.md).
 */
export function RequestWorkspaceAccess({ societyId, workspaceName }: { societyId: string; workspaceName: string }) {
  const auth = useAuth();
  const availability = useAccessRequestAvailability(societyId);
  const submit = useMutation(api.accessRequests.submit);
  const withdraw = useMutation(api.accessRequests.withdraw);
  const [note, setNote] = useState("");
  const [askAgain, setAskAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!availability?.enabled) return null;
  const existing = availability.existing;

  if (availability.alreadyMember) {
    if (existing?.status !== "approved") return null;
    return (
      <section className="account-section" aria-label="Access request">
        <p role="status" className="notice notice--success auth__notice">Your request was approved.</p>
        <button
          type="button"
          className="btn btn--primary auth__submit"
          onClick={() => auth.refreshMembership(societyId as Id<"societies">)}
        >
          Open {workspaceName}
        </button>
      </section>
    );
  }

  if (existing?.status === "pending") {
    return (
      <section className="account-section" aria-label="Access request">
        <p role="status" className="notice notice--info auth__notice">
          Request sent {formatDate(existing.createdAtISO)}. An administrator of {workspaceName} will review it.
        </p>
        <button
          type="button"
          className="auth__link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await withdraw({ id: existing.id });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not withdraw the request.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Withdraw request
        </button>
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
      </section>
    );
  }

  if (existing?.status === "declined" && !askAgain) {
    return (
      <section className="account-section" aria-label="Access request">
        <p role="status" className="notice notice--warn auth__notice">Your request to join {workspaceName} was declined.</p>
        <button type="button" className="auth__link" onClick={() => setAskAgain(true)}>Ask again</button>
      </section>
    );
  }

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      const result = await submit({ societyId, ...(trimmed ? { note: trimmed } : {}) }) as { status: string };
      if (result.status === "requested" || result.status === "already-requested") {
        setNote("");
        setAskAgain(false);
      } else {
        setError(SUBMIT_FAILURES[result.status] ?? "Could not send the request.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth__form" onSubmit={send} aria-label={`Request access to ${workspaceName}`}>
      <fieldset className="auth__fieldset" disabled={busy}>
        {availability.message && <p className="auth__hint">{availability.message}</p>}
        <label className="field auth-field">
          <span className="field__label">Note for the administrators (optional)</span>
          <textarea
            className="input"
            rows={3}
            maxLength={NOTE_LIMIT}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
        <button type="submit" className="btn btn--primary auth__submit">
          <BusyLabel busy={busy} busyText="Sending…">Request access</BusyLabel>
        </button>
      </fieldset>
    </form>
  );
}
