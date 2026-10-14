import { Component, forwardRef, lazy, Suspense, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const Editor = lazy(() => import("./MarkdownEditorImpl").then((module) => ({ default: module.MarkdownEditor })));

export interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Approximate height in textarea rows (matches the rows= prop on <textarea>). Defaults to 4. */
  rows?: number;
  /** Optional CSS-level min-height override (rarely needed; rows= is the normal knob). */
  minHeight?: string;
  readOnly?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  className?: string;
  /** Internal: the rich editor calls this once it can take input. */
  onReady?: () => void;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  /** Replace the editor's content imperatively. */
  setMarkdown: (markdown: string) => void;
  /** Read the editor's current content as markdown. Useful right before saving
   * so callers don't depend on the `onChange`→`setState`→re-render cycle having
   * flushed first. */
  getMarkdown: () => string;
  /** Internal: focus with the caret at the end of the content. */
  focusEnd?: () => void;
}

/** How long typing must pause before the plain field hands over to the rich editor. */
const HANDOFF_IDLE_MS = 1200;

/** An unavailable chunk must leave a local form usable, including during offline first-edit. */
class RichEditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * Keep rich editing out of read-only route loads; preserve the public imperative API while loading.
 *
 * Until the rich editor can take input (its chunk downloads, then Milkdown starts up), an editable
 * plain-text field stands in, so anything typed during load is kept. When the rich editor reports
 * ready, it already holds that text (it arrives through `value`/`onChange`), and focus moves to it
 * with the caret at the end so typing simply continues.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestOnChange = useRef(props.onChange);
  latestOnChange.current = props.onChange;
  const latest = useRef(props.value);
  const pendingMarkdown = useRef<string | undefined>(undefined);
  const pendingFocus = useRef(false);
  const [richReady, setRichReady] = useState(false);
  const [, redraw] = useState(0);
  if (latest.current !== props.value) pendingMarkdown.current = undefined;
  latest.current = props.value;
  const richReadyRef = useRef(false);
  richReadyRef.current = richReady;
  useImperativeHandle(ref, () => ({
    focus() {
      if (editorRef.current && richReadyRef.current) editorRef.current.focus();
      else if (textareaRef.current) textareaRef.current.focus();
      else pendingFocus.current = true;
    },
    setMarkdown(markdown) {
      if (editorRef.current && richReadyRef.current) editorRef.current.setMarkdown(markdown);
      else { pendingMarkdown.current = markdown; redraw((version) => version + 1); latestOnChange.current(markdown); }
    },
    getMarkdown() {
      if (editorRef.current && richReadyRef.current) return editorRef.current.getMarkdown();
      return pendingMarkdown.current ?? textareaRef.current?.value ?? latest.current;
    },
  }), []);
  // Whether the stand-in field had focus when the rich editor became ready.
  const handOffFocus = useRef(false);
  const attach = useCallback((handle: MarkdownEditorHandle | null) => {
    editorRef.current = handle;
  }, []);
  // Last keystroke in the stand-in field; the swap waits for a pause so no keystroke lands mid-handoff.
  const lastTypedAt = useRef(0);
  const onRichReady = useCallback(() => {
    const swap = () => {
      handOffFocus.current = pendingFocus.current || (!!textareaRef.current && document.activeElement === textareaRef.current);
      pendingFocus.current = false;
      setRichReady(true);
    };
    const waitForPause = () => {
      const field = textareaRef.current;
      const idleFor = Date.now() - lastTypedAt.current;
      const typing = !!field && document.activeElement === field && idleFor < HANDOFF_IDLE_MS;
      if (typing) window.setTimeout(waitForPause, HANDOFF_IDLE_MS - idleFor + 20);
      else swap();
    };
    waitForPause();
  }, []);
  useLayoutEffect(() => {
    if (!richReady || !handOffFocus.current) return;
    handOffFocus.current = false;
    const handle = editorRef.current;
    if (handle?.focusEnd) handle.focusEnd();
    else handle?.focus();
  }, [richReady]);
  const value = pendingMarkdown.current ?? props.value;
  const onPlainChange = (next: string) => {
    lastTypedAt.current = Date.now();
    pendingMarkdown.current = next;
    redraw((version) => version + 1);
    props.onChange(next);
  };
  const plainField = (loading: boolean) => <textarea className="input" id={richReady ? undefined : props.id} value={value} rows={props.rows ?? 4} readOnly={props.readOnly}
    style={{ minHeight: props.minHeight }} placeholder={props.placeholder}
    aria-label={props["aria-label"] ?? "Markdown text"} aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]}
    aria-busy={loading || undefined}
    ref={(element) => {
      textareaRef.current = element;
      if (element && pendingFocus.current && !loading) { pendingFocus.current = false; element.focus(); }
      else if (element && pendingFocus.current && loading) element.focus();
    }}
    onChange={(event) => onPlainChange(event.target.value)} />;
  const plainEditor = <div className={props.className}>
    <p className="muted" role="status">{props.readOnly ? "Rich editing could not load. The Markdown text is shown below." : "Rich editing could not load. You can edit and save Markdown text below."}</p>
    {plainField(false)}
  </div>;
  const loadingField = <div className={`markdown-editor-loading${props.className ? ` ${props.className}` : ""}`}>
    <span className="sr-only" role="status">Loading the formatting editor. You can keep typing.</span>
    {plainField(true)}
  </div>;
  return <RichEditorBoundary fallback={plainEditor}>
    {!richReady && loadingField}
    <Suspense fallback={null}>
      {/* Mounted hidden so Milkdown can start up while the plain field takes input. */}
      <div className="markdown-editor-rich" hidden={!richReady}>
        <Editor {...props} id={richReady ? props.id : undefined} value={value} ref={attach} onReady={onRichReady} />
      </div>
    </Suspense>
  </RichEditorBoundary>;
});
