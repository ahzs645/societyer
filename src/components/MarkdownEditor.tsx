import { Component, forwardRef, lazy, Suspense, useCallback, useImperativeHandle, useRef, useState, type ReactNode } from "react";

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
}

export interface MarkdownEditorHandle {
  focus: () => void;
  /** Replace the editor's content imperatively. */
  setMarkdown: (markdown: string) => void;
  /** Read the editor's current content as markdown. Useful right before saving
   * so callers don't depend on the `onChange`→`setState`→re-render cycle having
   * flushed first. */
  getMarkdown: () => string;
}

/** An unavailable chunk must leave a local form usable, including during offline first-edit. */
class RichEditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Keep rich editing out of read-only route loads; preserve the public imperative API while loading. */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestOnChange = useRef(props.onChange);
  latestOnChange.current = props.onChange;
  const latest = useRef(props.value);
  const pendingMarkdown = useRef<string | undefined>(undefined);
  const pendingFocus = useRef(false);
  const [, redraw] = useState(0);
  if (latest.current !== props.value) pendingMarkdown.current = undefined;
  latest.current = props.value;
  useImperativeHandle(ref, () => ({
    focus() {
      if (editorRef.current) editorRef.current.focus();
      else if (textareaRef.current) textareaRef.current.focus();
      else pendingFocus.current = true;
    },
    setMarkdown(markdown) {
      if (editorRef.current) editorRef.current.setMarkdown(markdown);
      else { pendingMarkdown.current = markdown; redraw((version) => version + 1); latestOnChange.current(markdown); }
    },
    getMarkdown() { return editorRef.current?.getMarkdown() ?? pendingMarkdown.current ?? textareaRef.current?.value ?? latest.current; },
  }), []);
  const attach = useCallback((handle: MarkdownEditorHandle | null) => {
    editorRef.current = handle;
    if (handle && pendingFocus.current) { pendingFocus.current = false; handle.focus(); }
  }, []);
  const value = pendingMarkdown.current ?? props.value;
  const plainEditor = <div className={props.className}>
    <p className="muted" role="status">{props.readOnly ? "Rich editing could not load. The Markdown text is shown below." : "Rich editing could not load. You can edit and save Markdown text below."}</p>
    <textarea className="input" id={props.id} value={value} rows={props.rows ?? 4} readOnly={props.readOnly}
      style={{ minHeight: props.minHeight }} placeholder={props.placeholder}
      aria-label={props["aria-label"] ?? "Markdown text"} aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]}
      ref={(element) => {
        textareaRef.current = element;
        if (element && pendingFocus.current) { pendingFocus.current = false; element.focus(); }
      }}
      onChange={(event) => {
        pendingMarkdown.current = event.target.value;
        redraw((version) => version + 1);
        props.onChange(event.target.value);
      }} />
  </div>;
  return <RichEditorBoundary fallback={plainEditor}><Suspense fallback={<div className="markdown-editor-loading" aria-busy="true">
    <div role="status">Loading editor…</div>
    <textarea className="input" readOnly value={value} rows={props.rows ?? 4} aria-label="Editor content while loading" />
  </div>}>
    <Editor {...props} value={value} ref={attach} />
  </Suspense></RichEditorBoundary>;
});
