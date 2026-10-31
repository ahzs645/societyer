/** The same confidentiality choice applies to ordinary and paged exports. */
import { inCameraExportRanges } from "./minutesPrivacy";
import { exportTranscript, type ExportableTranscript, type TranscriptExportFormat } from "./transcriptExport";

export type TranscriptExportConsent = { includeInCamera: boolean; acknowledgeUnmarked: boolean };
export function assertTranscriptExportConsent(
  plan: ReturnType<typeof inCameraExportRanges>,
  consent: TranscriptExportConsent,
  canIncludeInCamera: boolean,
): void {
  if (consent.includeInCamera && !canIncludeInCamera) throw new Error("In-camera access is required to include confidential discussion.");
  if (!consent.includeInCamera && plan.unmarked.length && !(canIncludeInCamera && consent.acknowledgeUnmarked)) {
    throw new Error("Mark the unmarked in-camera sessions before exporting, or acknowledge them with in-camera access.");
  }
}
export function exportTranscriptWithPolicy(
  transcript: ExportableTranscript,
  format: TranscriptExportFormat,
  options: { minutes: unknown; canIncludeInCamera: boolean; consent: TranscriptExportConsent; title?: string; date?: string },
) {
  if (options.minutes === undefined) throw new Error("Wait for the minutes and export privacy controls to load.");
  const plan = inCameraExportRanges(options.minutes);
  assertTranscriptExportConsent(plan, options.consent, options.canIncludeInCamera);
  return exportTranscript(transcript, format, {
    title: options.title, date: options.date,
    inCameraRanges: options.consent.includeInCamera ? [] : plan.ranges,
  });
}
