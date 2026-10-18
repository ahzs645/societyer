import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { FileUp, FileX } from "lucide-react";

/* ------------------------------------------------------------------ types */

export type FileDragState = "idle" | "over" | "over-reject";
export type FileDropZoneState = FileDragState | "busy" | "error";

export type FileRejection = {
  file: File;
  reason: "type" | "size";
  message: string;
};

export type UseFileDropOptions = {
  /** Same syntax as `<input accept>`: MIME types, `type/*` wildcards and `.ext`. */
  accept?: string;
  maxBytes?: number;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  onReject?: (rejections: FileRejection[]) => void;
  /**
   * Also take pasted files while focus is anywhere inside this element (for
   * example the drawer that holds the zone). Pastes inside the zone itself are
   * always handled.
   */
  pasteTargetRef?: RefObject<HTMLElement | null>;
};

/* ------------------------------------------------------- accept matching */

type AcceptRule = { kind: "mime"; value: string } | { kind: "wildcard"; prefix: string } | { kind: "ext"; value: string };

function parseAccept(accept: string | undefined): AcceptRule[] {
  if (!accept) return [];
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part): AcceptRule => {
      if (part.startsWith(".")) return { kind: "ext", value: part };
      if (part.endsWith("/*")) return { kind: "wildcard", prefix: part.slice(0, -1) };
      return { kind: "mime", value: part };
    });
}

// MIME types whose subtype doesn't spell out the extension a caller is likely
// to list. Only used for the dragover guess; the drop check uses the file name.
const EXT_MIME_HINTS: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".svg": ["image/svg+xml"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/x-markdown"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
};

function mimeMatches(rules: AcceptRule[], mime: string): boolean {
  const type = mime.toLowerCase();
  return rules.some((rule) => {
    if (rule.kind === "mime") return rule.value === type;
    if (rule.kind === "wildcard") return type.startsWith(rule.prefix);
    const ext = rule.value.slice(1);
    return type.split("/")[1]?.split("+")[0] === ext || (EXT_MIME_HINTS[rule.value] ?? []).includes(type);
  });
}

export function fileMatchesAccept(file: File, accept: string | undefined): boolean {
  const rules = parseAccept(accept);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  if (rules.some((rule) => rule.kind === "ext" && name.endsWith(rule.value))) return true;
  return file.type ? mimeMatches(rules, file.type) : false;
}

/**
 * Guess during dragover, when only MIME types are visible. Items with no type
 * (common for HEIC or unknown extensions) get the benefit of the doubt; the
 * real check runs on drop.
 */
function dragLooksAcceptable(transfer: DataTransfer, accept: string | undefined): boolean {
  const rules = parseAccept(accept);
  if (rules.length === 0) return true;
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  if (items.length === 0) return true;
  return items.some((item) => !item.type || mimeMatches(rules, item.type));
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes("Files");
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== "file");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Screenshots arrive as "image.png"; give them a name worth keeping. */
function namePastedFile(file: File): File {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
  const now = new Date();
  const ext = file.type.split("/")[1]?.split("+")[0] || "png";
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return new File([file], `Pasted image ${stamp}.${ext}`, { type: file.type, lastModified: now.getTime() });
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length > 0) return direct;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/* ------------------------------------------------------------------ hook */

/**
 * Drag-and-drop, paste and picker plumbing for a file zone. Tracks drag depth
 * so crossing child elements doesn't flicker the highlight, guesses accept vs
 * reject while dragging, and validates type and size when files land.
 */
export function useFileDrop(options: UseFileDropOptions) {
  const { accept, maxBytes, multiple = false, disabled = false, pasteTargetRef } = options;
  const [dragState, setDragState] = useState<FileDragState>("idle");
  const [rejection, setRejection] = useState<string | null>(null);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const reset = () => {
    depth.current = 0;
    setDragState("idle");
  };

  // A drag can end without a dragleave reaching the zone (dropped elsewhere,
  // cancelled with Escape over a child). Clear the highlight either way.
  useEffect(() => {
    if (dragState === "idle") return undefined;
    const clear = () => {
      depth.current = 0;
      setDragState("idle");
    };
    window.addEventListener("drop", clear);
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("drop", clear);
      window.removeEventListener("dragend", clear);
    };
  }, [dragState]);

  useEffect(() => {
    if (disabled) {
      depth.current = 0;
      setDragState("idle");
    }
  }, [disabled]);

  const take = (incoming: File[]) => {
    const current = latest.current;
    if (current.disabled || incoming.length === 0) return;
    const candidates = current.multiple ? incoming : incoming.slice(0, 1);
    const rejected: FileRejection[] = [];
    const accepted: File[] = [];
    for (const file of candidates) {
      if (!fileMatchesAccept(file, current.accept)) {
        rejected.push({ file, reason: "type", message: `${file.name || "That file"} isn't a supported file type.` });
      } else if (current.maxBytes !== undefined && file.size > current.maxBytes) {
        rejected.push({ file, reason: "size", message: `${file.name || "That file"} is ${formatBytes(file.size)}. The limit is ${formatBytes(current.maxBytes)}.` });
      } else {
        accepted.push(file);
      }
    }
    setRejection(rejected.length > 0 ? rejected.map((item) => item.message).join(" ") : null);
    if (rejected.length > 0) current.onReject?.(rejected);
    if (accepted.length > 0) void current.onFiles(accepted);
  };

  const handlePaste = (event: ClipboardEvent | ReactClipboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || latest.current.disabled) return;
    const data = event.clipboardData;
    // Let text pastes into fields through, even when the clipboard also carries
    // an image rendition (Word and Excel copies do).
    if (isEditable(event.target) && data?.types.includes("text/plain")) return;
    const files = filesFromClipboard(data).map(namePastedFile);
    if (files.length === 0) return;
    event.preventDefault();
    take(files);
  };

  useEffect(() => {
    const target = pasteTargetRef?.current;
    if (!target) return undefined;
    const listener = (event: ClipboardEvent) => handlePaste(event);
    target.addEventListener("paste", listener);
    return () => target.removeEventListener("paste", listener);
    // handlePaste reads everything through `latest`, so the ref is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteTargetRef]);

  const open = () => {
    if (!latest.current.disabled) inputRef.current?.click();
  };

  const rootProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (disabled) return;
      depth.current += 1;
      setDragState(dragLooksAcceptable(event.dataTransfer, accept) ? "over" : "over-reject");
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event.dataTransfer)) return;
      // Always claim file drags so a drop on a disabled zone can't navigate the tab away.
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (disabled) return;
      const next = dragLooksAcceptable(event.dataTransfer, accept) ? "over" : "over-reject";
      if (next !== dragState) setDragState(next);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event.dataTransfer) || disabled) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragState("idle");
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      take(Array.from(event.dataTransfer.files ?? []));
    },
    onPaste: (event: ReactClipboardEvent<HTMLElement>) => handlePaste(event),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      // The whole zone is a tap target; real controls inside keep their own clicks.
      if (event.target instanceof Element && event.target.closest("button, a, input, label, [data-file-drop-ignore]")) return;
      open();
    },
  };

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    accept,
    multiple,
    disabled,
    hidden: true,
    tabIndex: -1,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Clear now so choosing the same file again still fires a change.
      event.target.value = "";
      take(files);
    },
  };

  return { dragState, rejection, clearRejection: () => setRejection(null), open, inputRef, rootProps, inputProps };
}

/* ------------------------------------------------------------- component */

export type FileDropZoneProps = UseFileDropOptions & {
  /** Main line, e.g. "Drop a receipt here". */
  title: ReactNode;
  /** Shown instead of `title` on touch screens, where nothing can be dragged. */
  touchTitle?: ReactNode;
  hint?: ReactNode;
  chooseLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  /** 0..1 once real byte progress exists; omit for an indeterminate bar. */
  progress?: number;
  error?: string | null;
  rejectLabel?: string;
  icon?: ReactNode;
  /** Passed to the hidden input so phones can offer the camera directly. */
  capture?: InputHTMLAttributes<HTMLInputElement>["capture"];
  className?: string;
  ariaLabel?: string;
};

function liveMessage(state: FileDropZoneState, busyLabel: string, rejectLabel: string): string {
  if (state === "over") return "Release to add the file.";
  if (state === "over-reject") return rejectLabel;
  if (state === "busy") return busyLabel;
  return "";
}

export function FileDropZone({
  title,
  touchTitle,
  hint,
  chooseLabel = "Choose file",
  busy = false,
  busyLabel = "Uploading…",
  progress,
  error,
  rejectLabel = "This file type isn't supported",
  icon,
  capture,
  className,
  ariaLabel,
  ...options
}: FileDropZoneProps) {
  const disabled = !!options.disabled;
  const drop = useFileDrop({ ...options, disabled: disabled || busy });
  const hintId = useId();
  const shownError = error ?? drop.rejection;
  const state: FileDropZoneState = busy ? "busy" : drop.dragState !== "idle" ? drop.dragState : shownError ? "error" : "idle";
  const determinate = typeof progress === "number" && Number.isFinite(progress);
  const percent = determinate ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : undefined;

  return (
    <div
      className={["file-drop", `is-${state}`, disabled ? "is-disabled" : "", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
      aria-describedby={hint ? hintId : undefined}
      aria-disabled={disabled || busy || undefined}
      aria-busy={busy || undefined}
      tabIndex={disabled || busy ? -1 : 0}
      data-state={state}
      {...drop.rootProps}
    >
      <svg className="file-drop__border" aria-hidden="true" focusable="false">
        <rect x="0" y="0" width="100%" height="100%" rx="12" ry="12" />
      </svg>
      <span className="file-drop__icon" aria-hidden="true">
        {state === "over-reject" ? <FileX size={16} /> : icon ?? <FileUp size={16} />}
      </span>
      <div className="file-drop__text">
        <span className="file-drop__title">
          {state === "busy" ? busyLabel : state === "over-reject" ? rejectLabel : state === "over" ? "Drop to add the file" : (
            <>
              <span className="file-drop__title-pointer">{title}</span>
              <span className="file-drop__title-touch">{touchTitle ?? title}</span>
            </>
          )}
        </span>
        {state !== "busy" && (
          <button type="button" className="btn btn--ghost btn--sm file-drop__choose" disabled={disabled} onClick={drop.open}>
            {chooseLabel}
          </button>
        )}
        {hint && <span id={hintId} className="file-drop__hint muted">{hint}</span>}
        {busy && (
          <span
            className={`file-drop__progress${determinate ? "" : " is-indeterminate"}`}
            role="progressbar"
            aria-label={busyLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className="file-drop__progress-bar" style={determinate ? { width: `${percent}%` } : undefined} />
          </span>
        )}
        {shownError && !busy && <span className="file-drop__error" role="alert">{shownError}</span>}
      </div>
      <span className="sr-only" aria-live="polite">{liveMessage(state, busyLabel, rejectLabel)}</span>
      <input {...drop.inputProps} capture={capture} />
    </div>
  );
}
