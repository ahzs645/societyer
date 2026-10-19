import { useMemo, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { IN_CAMERA_ACCESS_PERMISSION, IN_CAMERA_TRANSCRIPT_LINE, inCameraExportRanges, isTimedTranscript } from "../../../../shared/minutesPrivacy";
import { meetingCalendarDate, type MeetingDateLike } from "../../../../shared/meetingDates";
import {
  exportTranscript,
  TRANSCRIPT_EXPORT_FORMATS,
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
}: {
  meetingId: Id<"meetings">;
  transcript: (Partial<ExportableTranscript> & { provider?: string }) | null | undefined;
  minutes: unknown;
  onExported: (message: string) => void;
}) {
  const { can } = usePermissions();
  const meeting = useRecordQuery<ExportMeeting>(api.meetings.get, { id: meetingId });
  const plan = useMemo(() => inCameraExportRanges(minutes), [minutes]);
  const [pending, setPending] = useState<TranscriptExportFormat | null>(null);
  // Untimed text has synthetic five-second lines: exporting them as captions would invent timings.
  const segments = transcript?.segments;
  if (!transcript || !segments?.length || !isTimedTranscript(transcript)) return null;
  const hasInCamera = plan.ranges.length > 0 || plan.unmarked.length > 0;
  const download = (format: TranscriptExportFormat, includeInCamera: boolean) => {
    const file = exportTranscript({ ...transcript, segments }, format, {
      title: meeting?.title,
      date: meetingCalendarDate(meeting),
      inCameraRanges: includeInCamera ? [] : plan.ranges,
    });
    triggerBlobDownload(new Blob([file.content], { type: file.mime }), file.fileName);
    const privacy = !hasInCamera
      ? ""
      : includeInCamera
        ? ", in-camera parts included"
        : [
            file.inCameraCount
              ? `, ${file.inCameraCount} in-camera ${file.inCameraCount === 1 ? "part" : "parts"} left out`
              : "",
            plan.unmarked.length ? ", may contain unmarked in-camera parts" : "",
          ].join("");
    const size = file.tooLargeToImport ? " It is over 16 MB, so it can't be imported again as one file." : "";
    onExported(`Downloaded ${file.fileName}${privacy}.${size}`);
  };
  const sections: MenuSection[] = [
    {
      id: "formats",
      label: "Download transcript as",
      items: TRANSCRIPT_EXPORT_FORMATS.map((format) => ({
        id: format.id,
        label: `${format.label} (.${format.extension})`,
        hint: transcriptExportHint(format.id, { segments }),
        onSelect: () => (hasInCamera ? setPending(format.id) : download(format.id, false)),
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
          <button type="button" className="btn-action">
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        }
      />
      {pending && (
        <InCameraExportDialog
          format={pending}
          plan={plan}
          canIncludeInCamera={can(IN_CAMERA_ACCESS_PERMISSION)}
          onClose={() => setPending(null)}
          onDownload={(includeInCamera) => {
            download(pending, includeInCamera);
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
  onDownload: (includeInCamera: boolean) => void;
}) {
  const [include, setInclude] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const label = TRANSCRIPT_EXPORT_FORMATS.find((entry) => entry.id === format)?.label ?? format;
  const unmarked = plan.unmarked.length > 0;
  const marked = plan.ranges.length;
  // Without in-camera access an unmarked session can't be exported at all; with it, only knowingly.
  const blocked = !include && unmarked && !canIncludeInCamera;
  const ready = include || !unmarked || (canIncludeInCamera && acknowledged);
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
            onClick={() => onDownload(include)}
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
