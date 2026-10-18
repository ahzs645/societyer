import { useCallback, useEffect, useRef, useState } from "react";

export function useMediaClock() {
  const element = useRef<HTMLMediaElement | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const mediaRef = useCallback((node: HTMLMediaElement | null) => {
    if (element.current && element.current !== node) pendingSeek.current = null;
    element.current = node;
    setMedia(node);
  }, []);
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    setError("");
    if (!media) return;
    let frame = 0;
    const update = () => {
      setCurrentTime(media.currentTime);
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    };
    const metadata = () => {
      if (pendingSeek.current !== null && Number.isFinite(media.duration) && media.readyState >= 1) {
        media.currentTime = Math.max(0, Math.min(media.duration, pendingSeek.current));
        pendingSeek.current = null;
      }
      update();
    };
    const tick = () => {
      update();
      if (!media.paused && !media.ended) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      setPlaying(true);
      cancelAnimationFrame(frame);
      tick();
    };
    const pause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      update();
    };
    const fail = () => {
      setError("This recording could not be played. Try a format supported by your browser.");
      pause();
    };
    const events = {
      play,
      pause,
      ended: pause,
      timeupdate: update,
      seeked: update,
      loadedmetadata: metadata,
      durationchange: metadata,
      error: fail,
    };
    for (const [name, listener] of Object.entries(events)) media.addEventListener(name, listener);
    metadata();
    return () => {
      cancelAnimationFrame(frame);
      for (const [name, listener] of Object.entries(events)) media.removeEventListener(name, listener);
      media.pause();
    };
  }, [media]);
  const play = useCallback(() => {
    const promise = element.current?.play();
    promise?.catch(() => setError("Playback could not start. Try opening another recording."));
  }, []);
  const pause = useCallback(() => element.current?.pause(), []);
  const toggle = useCallback(() => {
    if (element.current?.paused) play();
    else pause();
  }, [play, pause]);
  const seek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const node = element.current;
    if (!node || !Number.isFinite(node.duration) || node.readyState < 1) {
      pendingSeek.current = Math.max(0, seconds);
      return;
    }
    pendingSeek.current = null;
    node.currentTime = Math.max(0, Math.min(node.duration, seconds));
    setCurrentTime(node.currentTime);
  }, []);
  const skip = useCallback(
    (delta: number) => seek((pendingSeek.current ?? element.current?.currentTime ?? 0) + delta),
    [seek],
  );
  const setRate = useCallback((rate: number) => {
    if (element.current) element.current.playbackRate = rate;
  }, []);
  return {
    mediaRef,
    element,
    currentTime,
    duration,
    playing,
    error,
    play,
    pause,
    toggle,
    seek,
    skip,
    setRate,
  };
}
export type MediaClock = ReturnType<typeof useMediaClock>;
