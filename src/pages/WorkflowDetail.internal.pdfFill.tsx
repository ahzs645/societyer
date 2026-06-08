// WorkflowDetail: PDF template selection, preview, and pdf_fill node setup.
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
  IntakeField,
} from "./WorkflowDetail.internal.intakeFields";
import {
  FieldMappingWizardModal,
  suggestMappingForField,
  summariseMappings,
} from "./WorkflowDetail.internal.fieldMapping";


export function PdfFillSetup({
  node,
  cfg,
  intakeFields,
  documents,
  recipeFields,
  onSave,
}: {
  node: any;
  cfg: Record<string, any>;
  intakeFields: IntakeField[];
  documents: any[];
  recipeFields: string[];
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const pdfs = (documents ?? []).filter(
    (doc: any) => doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.fileName ?? ""),
  );
  const selectedDoc = pdfs.find((doc: any) => doc._id === cfg.templateDocumentId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const inspectPdfTemplate = useAction(api.workflows.inspectPdfTemplate);
  const toast = useToast();

  const mappings: Record<string, any> = (cfg.fieldMappings && typeof cfg.fieldMappings === "object")
    ? cfg.fieldMappings
    : {};
  const currentFields: string[] = Array.isArray(cfg.fields) && cfg.fields.length > 0
    ? cfg.fields
    : recipeFields.length > 0
      ? recipeFields
      : Object.keys(mappings);
  const mappingSummary = summariseMappings(currentFields, mappings);
  const inspection = cfg.fieldInspection && typeof cfg.fieldInspection === "object"
    ? cfg.fieldInspection
    : null;

  const autoDetectFields = async () => {
    if (!selectedDoc) return;
    setDetecting(true);
    try {
      const result = await inspectPdfTemplate({ documentId: selectedDoc._id });
      const detected = Array.isArray(result?.fields)
        ? result.fields.map((field: any) => String(field.name)).filter(Boolean)
        : [];
      if (detected.length === 0) {
        toast.error("No fillable PDF fields found");
        return;
      }
      const nextMappings = { ...mappings };
      for (const field of detected) {
        if (nextMappings[field]) continue;
        nextMappings[field] = suggestMappingForField(field, intakeFields) ?? { kind: "empty" };
      }
      await onSave({
        fields: detected,
        fieldMappings: nextMappings,
        fieldInspection: {
          detectedAtISO: result.detectedAtISO,
          fieldCount: result.fieldCount,
          pageCount: result.pageCount,
          tables: result.tables ?? [],
        },
      });
      toast.success(
        "PDF fields detected",
        `${detected.length} fields${result?.tables?.length ? ` · ${result.tables.length} table group(s)` : ""}`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Could not inspect the PDF");
    } finally {
      setDetecting(false);
    }
  };

  return (
    <>
      <Field label="PDF template">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            {selectedDoc ? (
              <>
                <strong>{selectedDoc.title ?? selectedDoc.fileName}</strong>
                {selectedDoc.fileName && selectedDoc.fileName !== selectedDoc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {selectedDoc.fileName}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">No template selected.</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setPickerOpen(true)}
            >
              {selectedDoc ? "Change template" : "Browse PDFs"}
            </button>
            {selectedDoc && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onSave({ templateDocumentId: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {pdfs.length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
            Upload a fillable PDF in <span className="mono">/app/documents</span> to see it here.
          </div>
        )}
      </Field>

      <PdfPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        pdfs={pdfs}
        selectedId={cfg.templateDocumentId}
        onPick={async (id) => {
          await onSave({ templateDocumentId: id });
          setPickerOpen(false);
        }}
      />

      <Field label="Field mapping">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            <strong>
              {mappingSummary.mapped} of {mappingSummary.total} fields mapped
            </strong>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {mappingSummary.mapped === 0
                ? "Open the wizard to map each AcroForm field to a value."
                : mappingSummary.breakdown}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMapperOpen(true)}
          >
            {mappingSummary.mapped === 0 ? "Start mapping" : "Edit mapping"}
          </button>
        </div>
      </Field>

      <FieldMappingWizardModal
        open={mapperOpen}
        onClose={() => setMapperOpen(false)}
        fields={currentFields}
        mappings={mappings}
        intakeFields={intakeFields}
        onFieldsChange={(fields) => onSave({ fields })}
        onMappingsChange={(next) => onSave({ fieldMappings: next })}
      />

      {inspection && (
        <Field label="Detected structure">
          <div className="workflow-codebox">
            {inspection.fieldCount ?? currentFields.length} fields
            {Array.isArray(inspection.tables) && inspection.tables.length > 0
              ? ` · ${inspection.tables.map((table: any) => `${table.label}: ${table.rowCount} rows`).join(" · ")}`
              : " · no repeated field tables detected"}
          </div>
        </Field>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!selectedDoc || detecting}
          title={selectedDoc ? "Read AcroForm field names from the selected PDF." : "Pick a PDF template first."}
          onClick={autoDetectFields}
        >
          {detecting ? "Detecting..." : "Auto-detect fields"}
        </button>
      </div>
    </>
  );
}

// Full-screen picker with a left list + right preview iframe.

export function PdfPickerModal({
  open,
  onClose,
  pdfs,
  selectedId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  pdfs: any[];
  selectedId?: string;
  onPick: (id: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);

  useEffect(() => {
    if (open) setFocusedId(selectedId);
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pdfs;
    return pdfs.filter((doc: any) =>
      [doc.title, doc.fileName, doc.category]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [search, pdfs]);

  const focused = filtered.find((d: any) => d._id === focusedId) ?? filtered[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Select a fillable PDF template"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            disabled={!focused}
            onClick={() => focused && onPick(focused._id)}
          >
            Select template
          </button>
        </>
      }
    >
      <div className="pdf-picker">
        <aside className="pdf-picker__list">
          <input
            className="input"
            placeholder="Search title, filename, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="pdf-picker__items">
            {filtered.length === 0 && (
              <div className="muted" style={{ padding: 12 }}>
                No PDFs match.
              </div>
            )}
            {filtered.map((doc: any) => (
              <button
                key={doc._id}
                type="button"
                className={`pdf-picker__item${
                  focused && focused._id === doc._id ? " is-active" : ""
                }`}
                onClick={() => setFocusedId(doc._id)}
                onDoubleClick={() => onPick(doc._id)}
              >
                <strong>{doc.title ?? doc.fileName}</strong>
                {doc.fileName && doc.fileName !== doc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {doc.fileName}
                  </span>
                )}
                {doc.category && (
                  <span className="cell-tag" style={{ alignSelf: "flex-start" }}>
                    {doc.category}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>
        <section className="pdf-picker__preview">
          {focused ? (
            <PdfPreviewPane doc={focused} />
          ) : (
            <div className="muted" style={{ padding: 24 }}>
              Pick a document on the left to preview it here.
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function PdfPreviewPane({ doc }: { doc: any }) {
  const latest = useQuery(api.documentVersions.latest, { documentId: doc._id });
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!latest?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const target = await getDownloadTarget({ versionId: latest._id });
        if (cancelled) return;
        if (target?.kind === "url" && target.url) {
          setUrl(target.url);
        } else if (target?.kind === "local-filesystem") {
          setError("Local filesystem documents cannot be previewed in this web iframe.");
        } else {
          setError(target?.reason ?? "This document version does not expose a preview URL.");
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Unable to load preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latest?._id, getDownloadTarget]);

  return (
    <div className="pdf-preview">
      <div className="pdf-preview__meta">
        <strong>{doc.title ?? doc.fileName}</strong>
        <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
          {doc.fileName ?? "—"} · {doc.category ?? "—"}
        </div>
      </div>
      <div className="pdf-preview__frame">
        {error && (
          <div className="muted" style={{ padding: 16 }}>
            {error}
          </div>
        )}
        {!error && url && (
          <iframe title="PDF preview" src={url} className="pdf-preview__iframe" />
        )}
        {!error && !url && latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            Loading preview…
          </div>
        )}
        {!error && !latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            No file attached to this document yet.
          </div>
        )}
      </div>
    </div>
  );
}
