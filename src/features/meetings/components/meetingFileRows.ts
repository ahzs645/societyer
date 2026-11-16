/**
 * What each file in "Recordings and transcripts" says and offers: the upload,
 * and for a recording its transcription (WhisperX job or speech provider) on
 * the same row. Pure, so the card stays thin and this is testable.
 */
import type { MeetingSource } from "../../../lib/meetingSourceTransfer";

export type FileJob = {
  id: string;
  sourceId: string;
  status: "queued" | "running" | "ready" | "applied" | "failed" | "cancelled" | string;
  phase: string | null;
  progress: number | null;
  error: string | null;
  segmentCount: number;
};

export type FileCapabilities = {
  /** A WhisperX processor is connected and enabled. */
  whisperX: boolean;
  /** A speech provider is configured (used when there's no WhisperX processor). */
  speech: boolean;
  /** minutes:write: transcribing and using a transcript. */
  canDraft: boolean;
  canReadTranscript: boolean;
};

export type FileAction =
  | "play"
  | "transcribe"
  | "retryTranscription"
  | "cancelTranscription"
  | "reviewTranscription"
  | "useTranscription"
  | "readText"
  | "useText"
  | "preview"
  | "download"
  | "cancelUpload";

export type FileRow = { status: string; tone: "neutral" | "busy" | "done" | "error"; actions: FileAction[] };

/** The latest job per recording (jobs arrive newest first). */
export function latestJobBySource(jobs: readonly FileJob[] | undefined): Map<string, FileJob> {
  const out = new Map<string, FileJob>();
  for (const job of jobs ?? []) if (!out.has(job.sourceId)) out.set(job.sourceId, job);
  return out;
}

const percent = (value: number) => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

export function meetingFileRow(source: MeetingSource, job: FileJob | undefined, caps: FileCapabilities, textLimitBytes: number): FileRow {
  if (source.status !== "ready") {
    if (source.status === "cancelled") return { status: "Upload cancelled", tone: "neutral", actions: [] };
    const done = source.size ? (100 * (source.verifiedOffset || source.offset)) / source.size : 0;
    return { status: `Upload not finished (${percent(done)}): choose the same file to resume`, tone: "busy", actions: ["cancelUpload"] };
  }
  const actions: FileAction[] = [];
  const recording = source.kind === "recording";
  let status = recording ? "Recording" : "Transcript file";
  let tone: FileRow["tone"] = "neutral";

  if (recording && caps.canReadTranscript) actions.push("play");

  if (recording && caps.whisperX && job && job.status !== "cancelled") {
    if (job.status === "queued") { status = "Queued for transcription"; tone = "busy"; actions.push("cancelTranscription"); }
    else if (job.status === "running") {
      status = `Transcribing${job.progress !== null ? ` · ${percent(job.progress * 100)}` : ""}${job.phase ? ` · ${job.phase}` : ""}`;
      tone = "busy";
      actions.push("cancelTranscription");
    } else if (job.status === "ready") {
      status = `Transcript ready · ${job.segmentCount.toLocaleString()} segments`;
      tone = "done";
      if (caps.canReadTranscript) actions.push("reviewTranscription");
      if (caps.canDraft) actions.push("useTranscription");
      actions.push("cancelTranscription");
    } else if (job.status === "applied") { status = "Transcribed · in use as the meeting transcript"; tone = "done"; }
    else if (job.status === "failed") {
      status = `Transcription failed${job.error ? `: ${job.error}` : ""}`;
      tone = "error";
      if (caps.canDraft) actions.push("retryTranscription");
    }
  } else if (recording && !source.textComplete && caps.canDraft && (caps.whisperX || caps.speech)) {
    if (source.jobStatus === "processing") { status = "Transcribing…"; tone = "busy"; }
    else actions.push("transcribe");
  }
  if (source.jobError) { status = `${status} · ${source.jobError}`; tone = "error"; }

  // Text the file carried (an export) or the speech provider produced.
  if (source.textComplete) {
    if (!recording) status = "Transcript file · text imported";
    if (caps.canReadTranscript) actions.push("readText");
    if (caps.canDraft && (source.textBytes ?? 0) <= textLimitBytes) actions.push("useText");
  }
  actions.push("preview", "download");
  return { status, tone, actions };
}
