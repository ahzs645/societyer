import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { speakerName } from "../../../../shared/transcriptModel";
import { Menu, type MenuSection } from "../../../components/Menu";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import {
  linkTargetMenuLabel,
  linkedTranscriptRange,
  transcriptLink,
  transcriptQuote,
  type MinutesLinkTarget,
} from "./transcriptLinks";
import type { LinkMinutesItem } from "./useMinutesLinks";
import { inCameraMenuSections, type InCameraProps } from "./InCameraTranscript";

type SelectedQuote = { text: string; speaker: string; start: number; end: number; left: number; top: number };

export function useTranscriptSelection({
  root,
  segments,
  speakers,
  onCopy,
  linkTargets,
  onLink,
  inCamera,
}: {
  root: RefObject<HTMLDivElement>;
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  onCopy: (text: string) => void;
  /** Minutes items this user may link; empty hides "Link to…". */
  linkTargets: readonly MinutesLinkTarget[];
  onLink: LinkMinutesItem;
  /** Editors of unapproved minutes can mark the selection as an in-camera session (decision A2). */
  inCamera?: Pick<InCameraProps, "choices" | "canMark" | "onMark">;
}) {
  const [selected, setSelected] = useState<SelectedQuote | null>(null);
  // While the "Link to…" menu is open, choosing an item may collapse the text
  // selection; keep the toolbar (and the menu it anchors) until the menu closes.
  const pinned = useRef(false);
  const inspect = useCallback(() => {
    if (pinned.current) return;
    const selection = window.getSelection();
    const node = root.current;
    if (!node || !selection?.rangeCount || selection.isCollapsed) {
      setSelected(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) {
      setSelected(null);
      return;
    }
    const parts = [...node.querySelectorAll<HTMLElement>("[data-segment]")]
      .map((segment) => ({ node: segment, text: selectedText(range, segment).trim() }))
      .filter((part) => part.text);
    const text = parts.map((part) => part.text).join(" ");
    const selectedSegments = parts.map((part) => part.node);
    const first = selectedSegments[0];
    const last = selectedSegments.at(-1);
    if (!first || !last) {
      setSelected(null);
      return;
    }
    // Prefer word timings; segment-only imports still produce useful range links.
    const words = selectedSegments
      .flatMap((segment) => [...segment.querySelectorAll<HTMLElement>("[data-word]")])
      .filter((word) => selectedText(range, word).trim());
    const bounds = range.getBoundingClientRect();
    setSelected({
      text,
      speaker: speakerName(segments[Number(first.dataset.segment)].speaker, speakers),
      start: Number(words.find((word) => first.contains(word))?.dataset.start ?? first.dataset.start),
      end: Number(words.filter((word) => last.contains(word)).at(-1)?.dataset.end ?? last.dataset.end),
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - (linkTargets.length || inCamera?.canMark ? 420 : 232))),
      top: Math.max(8, Math.min(bounds.top - 48, window.innerHeight - 56)),
    });
  }, [root, segments, speakers, linkTargets.length, inCamera?.canMark]);
  useEffect(() => {
    const hide = () => {
      if (!pinned.current) setSelected(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const change = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !root.current?.contains(selection.anchorNode) ||
        !root.current?.contains(selection.focusNode)
      )
        hide();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== "Escape") inspect();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", key);
    document.addEventListener("selectionchange", change);
    document.addEventListener("mouseup", inspect);
    document.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", key);
      document.removeEventListener("selectionchange", change);
      document.removeEventListener("mouseup", inspect);
      document.removeEventListener("keyup", keyup);
    };
  }, [inspect, root]);
  useLinkedTranscriptRange(root, segments);
  const onLinkMenu = useCallback(
    (open: boolean) => {
      pinned.current = open;
      if (!open) inspect();
    },
    [inspect],
  );
  const linkSections = (range: SelectedQuote): MenuSection[] =>
    (["motion", "actionItem"] as const)
      .map((kind) => ({
        id: kind,
        label: kind === "motion" ? "Motions" : "Action items",
        items: linkTargets
          .filter((target) => target.kind === kind)
          .map((target) => ({
            id: target.key,
            label: linkTargetMenuLabel(target),
            hint: target.ref ? formatTranscriptTime(target.ref.startSec) : undefined,
            onSelect: () => {
              // Clear the selection so the new citation shows; the toolbar closes with it.
              window.getSelection()?.removeAllRanges();
              void onLink(target, { startSec: range.start, endSec: range.end });
            },
          })),
      }))
      .filter((section) => section.items.length);
  return selected
    ? createPortal(
        <div
          className="transcript-selection-toolbar"
          role="toolbar"
          aria-label="Selected transcript text"
          style={{ left: selected.left, top: selected.top }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => onCopy(transcriptQuote(selected.text, selected.speaker, selected.start))}
          >
            Copy quote
          </button>
          <button type="button" onClick={() => onCopy(transcriptLink(selected.start, selected.end))}>
            Copy link
          </button>
          {linkTargets.length > 0 && (
            <Menu
              label="Link the selection to a minutes item"
              minWidth={280}
              sections={linkSections(selected)}
              onOpenChange={onLinkMenu}
              trigger={<button type="button">Link to…</button>}
            />
          )}
          {inCamera?.canMark && (
            <Menu
              label="Mark the selection as an in-camera session"
              minWidth={260}
              sections={inCameraMenuSections(inCamera, () => window.getSelection()?.removeAllRanges(), { startSec: selected.start, endSec: selected.end })}
              onOpenChange={onLinkMenu}
              trigger={<button type="button">Mark as in-camera…</button>}
            />
          )}
        </div>,
        document.body,
      )
    : null;
}

function useLinkedTranscriptRange(root: RefObject<HTMLDivElement>, segments: readonly TranscriptSegment[]) {
  const scrolled = useRef(false);
  useEffect(() => {
    const range = linkedTranscriptRange();
    if (!range || !segments.length) return;
    const overlaps = (node: HTMLElement) =>
      range.end > range.start
        ? Number(node.dataset.end) > range.start && Number(node.dataset.start) < range.end
        : Number(node.dataset.start) <= range.start && Number(node.dataset.end) > range.start;
    const nodes = [...(root.current?.querySelectorAll<HTMLElement>("[data-segment]") ?? [])].filter(overlaps);
    const highlighted = nodes.flatMap((node) => {
      const words = [...node.querySelectorAll<HTMLElement>("[data-word]")];
      return words.length ? words.filter(overlaps) : [node];
    });
    for (const node of highlighted) node.classList.add("is-linked-range");
    const frame = requestAnimationFrame(() => {
      if (!scrolled.current && nodes[0]) {
        nodes[0].scrollIntoView({ block: "center", behavior: "instant" });
        scrolled.current = true;
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const node of highlighted) node.classList.remove("is-linked-range");
    };
  }, [root, segments]);
}

/** Clip a selection to text content, excluding speaker headers and action controls. */
function selectedText(selection: Range, node: HTMLElement) {
  if (!selection.intersectsNode(node)) return "";
  const contents = document.createRange();
  contents.selectNodeContents(node);
  const clipped = selection.cloneRange();
  if (selection.compareBoundaryPoints(Range.START_TO_START, contents) < 0)
    clipped.setStart(contents.startContainer, contents.startOffset);
  if (selection.compareBoundaryPoints(Range.END_TO_END, contents) > 0)
    clipped.setEnd(contents.endContainer, contents.endOffset);
  return clipped.toString();
}
