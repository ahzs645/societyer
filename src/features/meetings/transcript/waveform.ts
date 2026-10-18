export const WAVEFORM_FILE_LIMIT = 200 * 1024 * 1024;

/** Decode after paint. Abort cannot interrupt the browser decoder, but stops all subsequent work. */
export async function computePeaks(
  file: File,
  buckets = 1600,
  signal?: AbortSignal,
): Promise<Float32Array | null> {
  if (file.size > WAVEFORM_FILE_LIMIT) return null;
  if (!Number.isInteger(buckets) || buckets < 1 || buckets > 10_000)
    throw new Error("Invalid waveform bucket count.");
  signal?.throwIfAborted();
  const context = new OfflineAudioContext(1, 1, 8000);
  let bytes: ArrayBuffer | null = await file.arrayBuffer();
  signal?.throwIfAborted();
  let buffer: AudioBuffer | null = await context.decodeAudioData(bytes);
  bytes = null;
  signal?.throwIfAborted();
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer!.getChannelData(index),
  );
  const peaks = new Float32Array(buckets);
  for (let bucket = 0; bucket < buckets; bucket++) {
    signal?.throwIfAborted();
    const start = Math.floor((bucket * buffer.length) / buckets);
    const end = Math.floor(((bucket + 1) * buffer.length) / buckets);
    for (let sample = start; sample < end; sample++) {
      let mono = 0;
      for (const channel of channels) mono += channel[sample] / channels.length;
      peaks[bucket] = Math.max(peaks[bucket], Math.abs(mono));
    }
    // Yield between chunks so playback and cancellation remain responsive.
    if (bucket % 80 === 79) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const max = peaks.reduce((peak, value) => Math.max(peak, value), 0);
  if (max) {
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] /= max;
    }
  }
  channels.length = 0;
  buffer = null;
  return peaks;
}
