type Interval = { startSec: number; endSec: number };
const endIndexes = new WeakMap<readonly Interval[], { size: number; ends: Float64Array }>();

function containingOverlap(intervals: readonly Interval[], lastStarted: number, time: number): number {
  let index = endIndexes.get(intervals);
  if (!index) {
    let size = 1;
    while (size < intervals.length) size *= 2;
    const ends = new Float64Array(size * 2).fill(-Infinity);
    intervals.forEach((interval, position) => {
      ends[size + position] = interval.endSec;
    });
    for (let node = size - 1; node > 0; node--) {
      ends[node] = Math.max(ends[node * 2], ends[node * 2 + 1]);
    }
    index = { size, ends };
    endIndexes.set(intervals, index);
  }
  const { size, ends } = index;
  // Find the latest containing interval when a shorter overlapping cue ended.
  const find = (node: number, left: number, right: number): number => {
    if (left > lastStarted || ends[node] <= time) return -1;
    if (right - left === 1) return left;
    const mid = (left + right) >>> 1;
    const latest = find(node * 2 + 1, mid, right);
    return latest >= 0 ? latest : find(node * 2, left, mid);
  };
  return find(1, 0, size);
}
/** Immutable, sorted starts; in a gap retain the last segment that started. */
export function activeIndex(intervals: readonly Interval[], time: number): number {
  if (!Number.isFinite(time)) return -1;
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (intervals[mid].startSec <= time) low = mid + 1;
    else high = mid;
  }
  const started = low - 1;
  if (started < 0 || time < intervals[started].endSec) return started;
  const containing = containingOverlap(intervals, started, time);
  return containing >= 0 ? containing : started;
}
export function activeWordIndex(words: readonly Interval[], time: number): number {
  const index = activeIndex(words, time);
  return index >= 0 && time < words[index].endSec ? index : -1;
}
export function formatTranscriptTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(total % 60).padStart(2, "0")}`;
}
