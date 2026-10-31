import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { IN_CAMERA_ACCESS_PERMISSION, IN_CAMERA_TRANSCRIPT_LINE, inCameraExportRanges, isTimedTranscript } from "../../../../shared/minutesPrivacy";
import { meetingCalendarDate, type MeetingDateLike } from "../../../../shared/meetingDates";
import {
  TRANSCRIPT_DOWNLOAD_FORMATS,
  transcriptExportHint,
  type ExportableTranscript,
  type TranscriptExportFormat,
} from "../../../../shared/transcriptExport";
import { Menu, type MenuSection } from "../../../components/Menu";
import { Modal } from "../../../components/Modal";
import { Checkbox } from "../../../components/Controls";
import { Banner } from "../../../components/ui";
import { usePermissions } from "../../../hooks/usePermissions";
import { useRecordQuery } from "../../../hooks/useRecordQuery";
import { triggerBlobDownload } from "../../../lib/zip";
import { useSociety } from "../../../hooks/useSociety";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { exportTranscriptWithPolicy, type TranscriptExportConsent } from "../../../../shared/transcriptExportPolicy";
import { TRANSCRIPT_EXPORT_BYTE_LIMIT } from "../../../../shared/pagedTranscriptExport";

type ExportMeeting = MeetingDateLike & { title?: string };
type InCameraPlan = ReturnType<typeof inCameraExportRanges>;

/**
 * The Transcript tab's Export menu: the working transcript as WebVTT, SRT or
 * Whisper JSON, built in the browser and saved as a file (every runtime).
 * When the minutes record an in-camera session, a dialog asks whether to
 * include it first; see "Export" in docs/meeting-transcript-workspace.md.
 */
export function TranscriptExportMenu({
  meetingId,
  transcript,
  minutes,
  onExported,
  loadTranscript,
  sourceKey,
}: {
  meetingId: Id<"meetings">;
  transcript: (Partial<ExportableTranscript> & { provider?: string }) | null | undefined;
  minutes: unknown;
  onExported: (message: string) => void;
  /** Whole-transcript loader; never pass the currently displayed page as the export. */
  loadTranscript?: (signal: AbortSignal, onProgress: (message: string) => void) => Promise<ExportableTranscript>;
  sourceKey?: string;
}) {
  const { can, loaded } = usePermissions();
  const society = useSociety();
  const userId = useCurrentUserId();
  const meeting = useRecordQuery<ExportMeeting>(api.meetings.get, { id: meetingId });
  const plan = useMemo(() => inCameraExportRanges(minutes), [minutes]);
  const [pending, setPending] = useState<TranscriptExportFormat | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const allowed = loaded && can("minutes:read") && minutes !== undefined && !!meeting;
  const includeAllowed = can(IN_CAMERA_ACCESS_PERMISSION);
  const policyKey = JSON.stringify([meetingId, sourceKey, society?._id, userId, allowed, includeAllowed, plan]);
  const latestKey = useRef(policyKey);
  latestKey.current = policyKey;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    request.current?.abort();
    setPending(null);
  }, [policyKey]);
  // Untimed text has synthetic five-second lines: exporting captions would invent timings.
  const segments = transcript?.segments;
  const available = Boolean(loadTranscript || (segments?.length && isTimedTranscript(transcript)));
  const hasInCamera = plan.ranges.length > 0 || plan.unmarked.length > 0;
  const download = async (format: TranscriptExportFormat, consent: TranscriptExportConsent) => {
    if (!allowed || !available || request.current) return;
    const operation = new AbortController();
    request.current = operation;
    setBusy(true); setError(""); setProgress("Preparing transcript export…");
    const key = policyKey;
    try {
      const source = loadTranscript
        ? await loadTranscript(operation.signal, (message) => { if (mounted.current && !operation.signal.aborted) setProgress(message); })
        : { ...transcript, segments: segments! };
      operation.signal.throwIfAborted();
      // A changed account, workspace, permission, source revision or privacy plan
      // cancels the entire operation, including after the final page arrives.
      if (!mounted.current || latestKey.current !== key) throw new Error("Export context changed. Review the privacy choices and try again.");
      const file = exportTranscriptWithPolicy(source, format, {
        title: meeting?.title, date: meetingCalendarDate(meeting), minutes,
        consent, canIncludeInCamera: includeAllowed,
      });
      if (new TextEncoder().encode(file.content).byteLength > TRANSCRIPT_EXPORT_BYTE_LIMIT) throw new Error("This transcript exceeds the 64 MB export limit. No file was exported.");
      triggerBlobDownload(new Blob([file.content], { type: file.mime }), file.fileName);
      const privacy = !hasInCamera ? "" : consent.includeInCamera ? ", in-camera parts included"
        : `${file.inCameraCount ? `, ${file.inCameraCount} in-camera parts left out` : ""}${plan.unmarked.length ? ", may contain unmarked in-camera parts" : ""}`;
      const size = file.tooLargeToImport && format !== "txt" ? " It is over 16 MB, so it cannot be imported again as one timed file." : "";
      const message = `Downloaded ${file.fileName}${privacy}.${size}`;
      setProgress(message); onExported(message);
    } catch (failure) {
      if (mounted.current) {
        setProgress("");
        setError(operation.signal.aborted ? "Export cancelled. No file was downloaded." : failure instanceof Error ? failure.message : "Export failed. No file was downloaded.");
      }
    } finally {
      if (request.current === operation) request.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  if (!available) return null;
  const sections: MenuSection[] = [
    {
      id: "formats",
      label: "Download transcript as",
      items: TRANSCRIPT_DOWNLOAD_FORMATS.map((format) => ({
        id: format.id,
        label: `${format.label} (.${format.extension})`,
        hint: loadTranscript ? "All transcript pages" : transcriptExportHint(format.id, { segments: segments ?? [] }),
        disabled: !allowed || busy,
        onSelect: () => { if (hasInCamera) setPending(format.id); else void download(format.id, { includeInCamera: false, acknowledgeUnmarked: false }); },
      })),
    },
  ];
  return (
    <>
      <Menu
        align="right"
        label="Export transcript"
        sections={sections}
        trigger={
          <button type="button" className="btn-action" disabled={!allowed || busy} title={!allowed ? "Wait for the minutes and export permissions to load" : undefined}>
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        }
      />
      {busy && <button type="button" className="btn-action" onClick={() => request.current?.abort()}>Cancel export</button>}
      {progress && <span role="status">{progress}</span>}
      {error && <span role="alert">{error}</span>}
      {pending && (
        <InCameraExportDialog
          key={`${pending}:${policyKey}`}
          format={pending}
          plan={plan}
          canIncludeInCamera={can(IN_CAMERA_ACCESS_PERMISSION)}
          onClose={() => setPending(null)}
          onDownload={(consent) => {
            void download(pending, consent);
            setPending(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Before exporting a transcript whose minutes record an in-camera session:
 * "Include in-camera parts" (off by default, in-camera access only), and an
 * explicit acknowledgement when some session isn't marked in the recording,
 * because those parts can't be cut out.
 */
function InCameraExportDialog({
  format,
  plan,
  canIncludeInCamera,
  onClose,
  onDownload,
}: {
  format: TranscriptExportFormat;
  plan: InCameraPlan;
  canIncludeInCamera: boolean;
  onClose: () => void;
  onDownload: (consent: TranscriptExportConsent) => void;
}) {
  const [include, setInclude] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const label = TRANSCRIPT_DOWNLOAD_FORMATS.find((entry) => entry.id === format)?.label ?? format;
  const unmarked = plan.unmarked.length > 0;
  const marked = plan.ranges.length;
  // Without in-camera access an unmarked session can't be exported at all; with it, only knowingly.
  const blocked = !include && unmarked && !canIncludeInCamera;
  const ready = include ? canIncludeInCamera : !unmarked || (canIncludeInCamera && acknowledged);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Export transcript as ${label}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={!ready || blocked}
            onClick={() => onDownload({ includeInCamera: include, acknowledgeUnmarked: acknowledged })}
            data-autofocus=""
          >
            <Download size={15} aria-hidden="true" />
            Download
          </button>
        </>
      }
    >
      <div className="col">
        <p>These minutes record an in-camera session.</p>
        <Checkbox
          checked={include}
          disabled={!canIncludeInCamera}
          onChange={(checked) => {
            setInclude(checked);
            setAcknowledged(false);
          }}
          label="Include in-camera parts"
          hint={
            canIncludeInCamera
              ? `Leave off to replace each in-camera run with “${IN_CAMERA_TRANSCRIPT_LINE}”.`
              : "Only people with in-camera access can include them."
          }
        />
        {include ? (
          <Banner tone="warn" title="This file will contain in-camera discussion">
            Keep and share it like the confidential minutes.
          </Banner>
        ) : unmarked ? (
          <Banner tone="warn" title="This export may contain in-camera content">
            Not marked in the recording: {plan.unmarked.join(", ")}. Those parts can't be cut out
            {marked ? `; the ${marked} marked ${marked === 1 ? "session is" : "sessions are"} replaced` : ""}.
            {canIncludeInCamera
              ? " Mark each session first (select its lines, then Mark as in-camera…), or confirm below."
              : " Mark each session (select its lines, then Mark as in-camera…) before exporting."}
          </Banner>
        ) : (
          <p className="transcript-muted">
            {marked === 1 ? "The marked in-camera session is" : `All ${marked} marked in-camera sessions are`} left out.
          </p>
        )}
        {!include && unmarked && canIncludeInCamera && (
          <Checkbox
            checked={acknowledged}
            onChange={setAcknowledged}
            label="I understand this file may contain in-camera content"
          />
        )}
      </div>
    </Modal>
  );
}
