import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TranscriptSegment } from "./timedTranscript";
import { activeIndex, activeWordIndex } from "./activeIndex";

export function useTranscriptTracking({
  root,
  segments,
  currentTime,
  hasMedia,
  query,
  editIndex,
  relabelIndex,
  followRevision,
  jumpIndex,
  jumpRevision,
}: {
  root: RefObject<HTMLDivElement>;
  segments: readonly TranscriptSegment[];
  currentTime: number;
  hasMedia: boolean;
  query: string;
  editIndex: number | null;
  relabelIndex: number | null;
  followRevision: number;
  jumpIndex: number;
  jumpRevision: number;
}) {
  const previous = useRef<{ segment: HTMLElement | null; word: HTMLElement | null }>({
    segment: null,
    word: null,
  });
  const lastIndexes = useRef({ segment: -2, word: -2 });
  const [following, setFollowing] = useState(true);
  const scrollTo = useCallback((node: HTMLElement) => {
    const bounds = node.getBoundingClientRect();
    const player = document.querySelector(".transcript-player")?.getBoundingClientRect();
    const top = Math.max(window.innerHeight * 0.2, (player?.bottom ?? 0) + 16);
    const bottom = Math.max(top, window.innerHeight * 0.8);
    // Move only as far as needed to bring the active line into the middle viewport band.
    const delta = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
    if (!delta) return;
    // The meeting page scrolls inside its own container, not the window.
    let scroller: HTMLElement | null = node.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    (scroller ?? window).scrollBy({
      top: delta,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, []);
  useEffect(() => {
    const manual = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".transcript-player")) return;
      setFollowing(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input,textarea,select,[role='slider'],[contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key))
        setFollowing(false);
    };
    const scrollbar = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth) setFollowing(false);
    };
    window.addEventListener("wheel", manual, { passive: true });
    window.addEventListener("touchmove", manual, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", scrollbar);
    return () => {
      window.removeEventListener("wheel", manual);
      window.removeEventListener("touchmove", manual);
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", scrollbar);
    };
  }, []);
  useEffect(() => {
    setFollowing(true);
    lastIndexes.current = { segment: -2, word: -2 };
  }, [followRevision]);
  useEffect(() => {
    lastIndexes.current = { segment: -2, word: -2 };
  }, [segments, query, editIndex, relabelIndex, following]);
  useEffect(() => {
    const index = hasMedia ? activeIndex(segments, currentTime) : -1;
    const words = segments[index]?.words;
    const wordIndex = words ? activeWordIndex(words, currentTime) : -1;
    if (index === lastIndexes.current.segment && wordIndex === lastIndexes.current.word) return;
    const segment = root.current?.querySelector<HTMLElement>(`[data-segment="${index}"]`) ?? null;
    const word = segment?.querySelector<HTMLElement>(`[data-word="${wordIndex}"]`) ?? null;
    const old = previous.current;
    if (old.segment !== segment) {
      old.segment?.classList.remove("is-active");
      old.segment?.removeAttribute("aria-current");
      segment?.classList.add("is-active");
      segment?.setAttribute("aria-current", "true");
    }
    if (segment && following && index !== lastIndexes.current.segment) scrollTo(segment);
    if (old.word !== word) {
      old.word?.classList.remove("is-active-word");
      word?.classList.add("is-active-word");
    }
    previous.current = { segment, word };
    lastIndexes.current = { segment: index, word: wordIndex };
  }, [
    currentTime,
    segments,
    hasMedia,
    following,
    scrollTo,
    query,
    editIndex,
    relabelIndex,
    followRevision,
    root,
  ]);
  useEffect(() => {
    if (!jumpRevision) return;
    const node = root.current?.querySelector<HTMLElement>(`[data-segment="${jumpIndex}"]`);
    if (node) scrollTo(node);
  }, [jumpIndex, jumpRevision, scrollTo, root]);
  const resume = () => {
    setFollowing(true);
    if (previous.current.segment) scrollTo(previous.current.segment);
  };
  return { following, setFollowing, scrollTo, resume };
}

export function useTranscriptActions({
  root,
  hasMedia,
  canWrite,
  onSeek,
  onOpenSpeaker,
}: {
  root: RefObject<HTMLDivElement>;
  hasMedia: boolean;
  canWrite: boolean;
  onSeek: (seconds: number) => void;
  onOpenSpeaker: (label: string) => void;
}) {
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [relabelIndex, setRelabelIndex] = useState<number | null>(null);
  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const start = pointer.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) start.moved = true;
    };
    const cancelled = () => {
      pointer.current = null;
    };
    window.addEventListener("pointermove", moved, { passive: true });
    window.addEventListener("pointercancel", cancelled);
    return () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointercancel", cancelled);
    };
  }, []);
  const done = useCallback(() => {
    setEditIndex(null);
    setRelabelIndex(null);
  }, []);
  const edit = useCallback((index: number) => {
    setEditIndex(index);
    setRelabelIndex(null);
  }, []);
  const relabel = useCallback((index: number) => {
    setRelabelIndex(index);
    setEditIndex(null);
  }, []);
  return {
    editIndex,
    relabelIndex,
    done,
    edit,
    relabel,
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        pointer.current = { x: event.clientX, y: event.clientY, moved: false };
      },
      onPointerCancel: () => {
        pointer.current = null;
      },
      onClick: (event: React.MouseEvent<HTMLDivElement>) => {
        if (!(event.target instanceof Element)) return;
        const target = event.target;
        const start = pointer.current;
        pointer.current = null;
        const selection = window.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          root.current &&
          selection.rangeCount > 0 &&
          selection.getRangeAt(0).intersectsNode(root.current)
        )
          return;
        if (
          event.detail > 0 &&
          start &&
          (start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)
        )
          return;
        const speaker = target.closest<HTMLElement>("[data-speaker-label]");
        if (speaker && canWrite) {
          onOpenSpeaker(speaker.dataset.speakerLabel!);
          return;
        }
        if (target.closest("input,textarea,select,form,button,[role=menu],[role=dialog]")) {
          const buttonSeek = target.closest<HTMLElement>("[data-seek]");
          if (buttonSeek && hasMedia) onSeek(Number(buttonSeek.dataset.seek));
          return;
        }
        const seek = target.closest<HTMLElement>("[data-seek],[data-start]");
        if (seek && hasMedia) onSeek(Number(seek.dataset.seek ?? seek.dataset.start));
      },
    },
  };
}

export function handleWorkspaceKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  hasMedia: boolean,
  toggle: () => void,
  skip: (delta: number) => void,
) {
  const target = event.target;
  if (
    !(target instanceof Element) ||
    target.closest(
      "input,textarea,select,[role=menu],[role=dialog],[contenteditable]:not([contenteditable='false'])",
    ) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !hasMedia
  )
    return;
  const key = event.key.toLowerCase();
  if (key === " " && target.closest("button,summary")) return;
  if (
    ["ArrowLeft", "ArrowRight"].includes(event.key) &&
    target.closest('select,summary,button,[role="slider"]')
  )
    return;
  if (key === " " || key === "k") {
    event.preventDefault();
    if (!event.repeat) toggle();
  } else if (key === "j" || event.key === "ArrowLeft") {
    event.preventDefault();
    skip(key === "j" ? -10 : -5);
  } else if (key === "l" || event.key === "ArrowRight") {
    event.preventDefault();
    skip(key === "l" ? 10 : 5);
  }
}
