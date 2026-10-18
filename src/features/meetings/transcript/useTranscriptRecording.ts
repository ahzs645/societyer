import { useCallback, useEffect, useState } from "react";
import { computePeaks, WAVEFORM_FILE_LIMIT } from "./waveform";

/** "device": opened from the user's computer. "attached": downloaded from meeting storage. */
export type RecordingOrigin = "device" | "attached";

/** Name and size of the last recording opened from the device. The file itself is never kept. */
export type RememberedRecording = { name: string; size: number };

const lastRecordingKey = (meetingId: string) => `societyer.transcript.lastRecording.${meetingId}`;

function readLastRecording(meetingId: string): RememberedRecording | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(lastRecordingKey(meetingId)) ?? "null");
    if (stored && typeof stored === "object" && "name" in stored && "size" in stored) {
      const { name, size } = stored;
      if (typeof name === "string" && typeof size === "number") return { name, size };
    }
  } catch {
    // unreadable or unavailable storage: nothing remembered
  }
  return null;
}

function rememberRecording(meetingId: string, file: File): RememberedRecording {
  const remembered = { name: file.name, size: file.size };
  try {
    localStorage.setItem(lastRecordingKey(meetingId), JSON.stringify(remembered));
  } catch {
    // quota / disabled storage: the hint just won't name the file next time
  }
  return remembered;
}

export function useTranscriptRecording(meetingId: string) {
  const [opened, setOpened] = useState<{ file: File; origin: RecordingOrigin } | null>(null);
  const recording = opened?.file ?? null;
  // Recordings are never uploaded, so after a reload only their name and size are known.
  const [lastRecording, setLastRecording] = useState(() => readLastRecording(meetingId));
  useEffect(() => setLastRecording(readLastRecording(meetingId)), [meetingId]);
  const setRecording = useCallback(
    (file: File, origin: RecordingOrigin = "device") => {
      setOpened({ file, origin });
      if (origin === "device") setLastRecording(rememberRecording(meetingId, file));
    },
    [meetingId],
  );
  const [source, setSource] = useState("");
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [waveformNote, setWaveformNote] = useState("");
  useEffect(() => {
    if (!recording) return;
    const url = URL.createObjectURL(recording);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);
  useEffect(() => {
    setPeaks(null);
    setWaveformNote("");
    if (!recording) return;
    if (recording.size > WAVEFORM_FILE_LIMIT) {
      setWaveformNote("Waveform skipped for recordings over 200 MB. Playback is still available.");
      return;
    }
    const abort = new AbortController();
    // A timer after two animation frames allows the recording controls to paint first.
    let timer = 0;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          setWaveformNote("Preparing waveform… Playback is available now.");
          void computePeaks(recording, 1600, abort.signal)
            .then((result) => {
              if (!abort.signal.aborted) {
                setPeaks(result);
                setWaveformNote("");
              }
            })
            .catch(() => {
              if (!abort.signal.aborted)
                setWaveformNote("Waveform unavailable for this format. Playback is still available.");
            });
        }, 0);
      });
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
  }, [recording]);
  return {
    recording,
    recordingOrigin: opened?.origin,
    setRecording,
    lastRecording,
    source,
    peaks,
    waveformNote,
  };
}
