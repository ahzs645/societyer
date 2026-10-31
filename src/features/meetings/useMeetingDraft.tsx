import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getStoredUserId } from "../../hooks/useCurrentUser";
import { getStoredSocietyId } from "../../hooks/useSociety";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../../lib/staticRuntime";
import { getRuntimeMode } from "../../lib/runtimeMode";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { createMeetingDraftJournal, meetingDraftIdentityKey, type MeetingDraftIdentity, type MeetingDraftState } from "./lib/meetingDraftStore";

type Scope = { identity: MeetingDraftIdentity; active: () => boolean; recordLabel?: string };
export const MeetingDraftScopeContext = createContext<Scope | null>(null);

/** Bound membership/identity comes from the existing auth and workspace hooks. */
export function useMeetingDraftScope(meetingId: string | undefined, societyId: string | undefined, userId: string | null, recordLabel = "meeting") {
  const auth = useAuth();
  const runtime = isStaticDemoRuntime() ? "demo" : isLocalDataRuntime() ? `local:${getRuntimeMode()}` : `convex:${import.meta.env.VITE_CONVEX_URL ?? ""}`;
  const accountId = `${auth.mode}:${auth.session?.user.id ?? userId ?? ""}`;
  const verified = auth.isAuthenticated && auth.membershipStatus === "bound" && !!userId && !!societyId && !!meetingId
    && getStoredUserId() === userId && getStoredSocietyId() === societyId;
  const identity = verified ? { runtime, accountId, userId, societyId, meetingId } as MeetingDraftIdentity : null;
  const key = identity ? meetingDraftIdentityKey(identity) : null;
  const latestKey = useRef(key);
  const mounted = useRef(true);
  latestKey.current = key;
  // React replays mount effects in development. Re-enable the parent scope
  // before child passive effects refresh their journals; otherwise replay
  // clears the recovered list while the scope still looks unmounted.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useMemo<Scope | null>(() => identity ? {
    identity, recordLabel,
    active: () => mounted.current && latestKey.current === key && getStoredUserId() === identity.userId && getStoredSocietyId() === identity.societyId,
    // Identity is a tuple; changing any account/workspace/runtime field creates a new scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null, [key, recordLabel]);
}

const EMPTY: MeetingDraftState<never> = { recoveries: [], error: null, savedOnDevice: false };
const noSubscribe = () => () => {};
const noSnapshot = () => EMPTY;

export function useMeetingDraft<T>(editor: string, valid: (value: unknown) => value is T) {
  const scope = useContext(MeetingDraftScopeContext);
  const validator = useRef(valid);
  validator.current = valid;
  const journal = useMemo(() => scope ? createMeetingDraftJournal<T>({
    identity: scope.identity, editor, active: scope.active, recordLabel: scope.recordLabel,
    storage: () => window.localStorage,
    valid: (value): value is T => validator.current(value),
  }) : null, [scope, editor]);
  const state = useSyncExternalStore(journal?.subscribe ?? noSubscribe, journal?.getSnapshot ?? noSnapshot, journal?.getSnapshot ?? noSnapshot);
  useEffect(() => {
    if (!journal) return;
    journal.refresh();
    const refresh = () => journal.refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh); };
  }, [journal]);
  return { journal, ...state };
}

export function MeetingDraftRecovery<T>({ draft, label, onRestore, disabled = false, disabledReason, recordLabel = "meeting", recoveryNotice }: {
  draft: ReturnType<typeof useMeetingDraft<T>>;
  label: string;
  onRestore: (payload: T) => void;
  disabled?: boolean;
  disabledReason?: string;
  recordLabel?: string;
  /** Extra guidance shown with the recovery copies, before anyone restores one. */
  recoveryNotice?: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  if (!draft.journal?.isActive()) return null;
  return <>
    {draft.error && <p className="flag flag--warn" role="alert">{draft.error}</p>}
    {draft.savedOnDevice && <p className="muted" role="status">Your {label} draft is saved on this device. Server save is separate.</p>}
    {draft.recoveries.length > 0 && <div className="flag flag--warn" aria-label={`Recover ${label} drafts`}>
      <p>{draft.recoveries.length === 1 ? "A draft from another editing session is" : `${draft.recoveries.length} drafts from other editing sessions are`} saved on this device. Restore to review before saving to the server. Another open tab may still be editing.</p>
      {recoveryNotice && <p className="muted">{recoveryNotice}</p>}
      {draft.recoveries.map((entry) => <div className="row" style={{ gap: 8, flexWrap: "wrap" }} key={entry.key}>
        <span>{new Date(entry.savedAt).toLocaleString()}</span>
        <button className="btn-action" type="button" disabled={disabled} onClick={() => {
          try { onRestore(draft.journal!.recover(entry)); }
          catch (error) { toast.error("Could not restore the draft", error instanceof Error ? error.message : String(error)); }
        }}>Restore {label} draft</button>
        <button className="btn-action" type="button" onClick={async () => {
          try {
            if (await confirm({ title: `Discard this ${label} recovery copy?`, message: `This removes only the selected copy from this device. The saved ${recordLabel} and other drafts stay unchanged.`, confirmLabel: "Discard recovery copy", tone: "warn" })) draft.journal!.discard(entry);
          } catch (error) { toast.error("Could not discard the recovery copy", error instanceof Error ? error.message : String(error)); }
        }}>Discard recovery copy</button>
      </div>)}
      {disabled && <p className="muted">{disabledReason ?? "Finish or discard your current edits before restoring another draft."}</p>}
    </div>}
  </>;
}
