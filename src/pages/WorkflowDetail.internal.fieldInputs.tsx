// WorkflowDetail: reusable labeled input/textarea primitives with draft-save.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";
import {
  TemplateToken,
} from "./WorkflowDetail.internal.intakeFields";


export function LabeledInput({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  // Reset local draft when the parent value changes (e.g. selecting a different node).
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}

export function LabeledTextarea({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        value={draft}
        placeholder={placeholder}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}

export function TemplateTextarea({
  label,
  value,
  placeholder,
  tokens,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  tokens: TemplateToken[];
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [slash, setSlash] = useState<{ start: number; term: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }

  const filteredTokens = slash
    ? tokens
        .filter((token) => `${token.group} ${token.label} ${token.value}`.toLowerCase().includes(slash.term))
        .slice(0, 8)
    : [];

  const detectSlash = (text: string, cursor: number) => {
    const start = text.lastIndexOf("/", cursor - 1);
    if (start < 0) return null;
    const before = start === 0 ? "" : text[start - 1];
    const term = text.slice(start + 1, cursor);
    if (before && !/\s/.test(before)) return null;
    if (/\s/.test(term)) return null;
    return { start, term: term.toLowerCase() };
  };

  const updateDraft = (next: string, cursor: number) => {
    setDraft(next);
    setSlash(detectSlash(next, cursor));
  };

  const insertToken = (token: TemplateToken) => {
    const textarea = textareaRef.current;
    if (!textarea || !slash) return;
    const cursor = textarea.selectionStart ?? draft.length;
    const next = `${draft.slice(0, slash.start)}${token.value}${draft.slice(cursor)}`;
    setDraft(next);
    setSlash(null);
    requestAnimationFrame(() => {
      const nextCursor = slash.start + token.value.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <Field label={label}>
      <div className="template-textarea">
        <textarea
          ref={textareaRef}
          className="textarea"
          value={draft}
          placeholder={placeholder}
          rows={7}
          onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
          onKeyUp={(event) => {
            const target = event.currentTarget;
            setSlash(detectSlash(target.value, target.selectionStart));
          }}
          onBlur={() => {
            window.setTimeout(() => setSlash(null), 120);
            if (draft !== value) onSave(draft);
          }}
        />
        {slash && filteredTokens.length > 0 && (
          <div className="template-token-menu">
            {filteredTokens.map((token) => (
              <button
                key={`${token.group}-${token.value}`}
                type="button"
                className="template-token-menu__item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertToken(token);
                }}
              >
                <span className="template-token-menu__group">{token.group}</span>
                <span className="template-token-menu__label">{token.label}</span>
                <span className="template-token-menu__value mono">{token.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
        Type / to insert workflow, intake, document, or date fields.
      </div>
    </Field>
  );
}

export function FieldListEditor({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string[];
  onSave: (next: string[]) => void | Promise<void>;
}) {
  const asText = value.join("\n");
  const [draft, setDraft] = useState(asText);
  const lastExternal = useRef(asText);
  if (lastExternal.current !== asText) {
    lastExternal.current = asText;
    if (draft !== asText) setDraft(asText);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (next.join("\n") !== value.join("\n")) onSave(next);
        }}
      />
      {hint && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </Field>
  );
}
