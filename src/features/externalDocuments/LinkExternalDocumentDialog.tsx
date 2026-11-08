import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { ChevronRight, FileText, Folder, Link2 } from "lucide-react";
import { api } from "../../lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { usePermissions } from "../../hooks/usePermissions";
import { useModuleEnabled } from "../../hooks/useModules";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import { formatDateTime } from "../../lib/format";
import { formatBytes } from "../../lib/documentOpen";
import { documentCategoryOptions } from "../../../shared/documentCategories";
import { documentSourceToken, useExternalDocumentAvailability } from "./useExternalDocumentActions";
import { documentSourceId, documentSourcesRevision, type DocumentSource, type ExternalDocumentItem } from "./types";
import "./externalDocuments.css";

type FolderCrumb = { itemId: string; name: string };

export function LinkExternalDocumentDialog({ societyId, open, onClose, onLinked }: {
  societyId: string;
  open: boolean;
  onClose(): void;
  onLinked(documentId: string): void;
}) {
  const permissions = usePermissions();
  const moduleEnabled = useModuleEnabled("externalDocuments");
  const currentUserId = useCurrentUserId();
  const unavailable = useExternalDocumentAvailability();
  const canLink = permissions.loaded && permissions.can("documents:write");
  const sources = useQuery(api.documentSources.list, open && moduleEnabled ? { societyId } : "skip") as DocumentSource[] | undefined;
  const browse = useAction(api.documentSources.browse);
  const link = useAction(api.documentSources.link);
  const toast = useToast();
  const [sourceId, setSourceId] = useState("");
  const [storedPath, setPath] = useState<FolderCrumb[]>([]);
  const [storedItems, setItems] = useState<ExternalDocumentItem[] | null>(null);
  const [storedNextCursor, setNextCursor] = useState<string | undefined>();
  const [storedFilter, setFilter] = useState("");
  const [storedSelected, setSelected] = useState<ExternalDocumentItem | null>(null);
  const [resultContext, setResultContext] = useState<string | null>(null);
  const [title, setTitle] = useState("Linked document");
  const [category, setCategory] = useState("Other");
  const [browsing, setBrowsing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [storedError, setError] = useState("");
  const [errorContext, setErrorContext] = useState<string | null>(null);
  const requestId = useRef(0);
  const enabledSources = sources?.filter(source => source.enabled && source.providerId === "microsoft-sharepoint") ?? [];
  const sourceRevision = documentSourcesRevision(sources);
  const contextKey = JSON.stringify([open, societyId, currentUserId, moduleEnabled, sourceRevision, sourceId]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  // Hide prior-reader metadata during render, before any passive cleanup runs.
  const resultIsCurrent = resultContext === contextKey;
  const path = resultIsCurrent ? storedPath : [];
  const items = resultIsCurrent ? storedItems : null;
  const nextCursor = resultIsCurrent ? storedNextCursor : undefined;
  const filter = resultIsCurrent ? storedFilter : "";
  const selected = resultIsCurrent ? storedSelected : null;
  const error = errorContext === contextKey ? storedError : "";
  const source = enabledSources.find(candidate => documentSourceId(candidate) === sourceId);
  const busy = browsing || linking;

  useEffect(() => {
    requestId.current += 1;
    setResultContext(null); setErrorContext(null);
    setSourceId(""); setPath([]); setItems(null); setSelected(null); setNextCursor(undefined);
    setFilter(""); setTitle("Linked document"); setCategory("Other"); setError(""); setBrowsing(false); setLinking(false);
    return () => { requestId.current += 1; };
  }, [open, societyId, currentUserId, moduleEnabled]);

  useEffect(() => {
    const clear = () => {
      requestId.current += 1;
      setResultContext(null); setErrorContext(null);
      setItems(null); setSelected(null); setNextCursor(undefined); setPath([]); setBrowsing(false); setLinking(false);
    };
    window.addEventListener("societyer:document-source-accounts-cleared", clear);
    return () => window.removeEventListener("societyer:document-source-accounts-cleared", clear);
  }, []);

  useEffect(() => {
    if (!sourceId && enabledSources.length) setSourceId(documentSourceId(enabledSources[0]));
  }, [sources, sourceId]);

  useEffect(() => {
    requestId.current += 1;
    setResultContext(null); setErrorContext(null);
    setItems(null); setSelected(null); setNextCursor(undefined); setPath([]); setFilter(""); setBrowsing(false); setLinking(false);
  }, [sourceRevision]);

  const changeSource = (id: string) => {
    requestId.current += 1;
    setResultContext(null); setErrorContext(null);
    setSourceId(id); setPath([]); setItems(null); setSelected(null); setNextCursor(undefined); setFilter(""); setError(""); setBrowsing(false);
  };

  const loadFolder = async (nextPath: FolderCrumb[], append = false) => {
    if (!source || busy || unavailable || !moduleEnabled || currentContext.current !== contextKey) return;
    const currentRequest = ++requestId.current;
    const requestContext = contextKey;
    const isCurrent = () => currentRequest === requestId.current && currentContext.current === requestContext;
    setBrowsing(true); setError("");
    try {
      const accessToken = await documentSourceToken(source);
      if (!isCurrent()) return;
      const result = await browse({
        societyId, sourceId: documentSourceId(source), accessToken,
        ...(nextPath.length ? { parent: { itemId: nextPath[nextPath.length - 1].itemId } } : {}),
        ...(append && nextCursor ? { cursor: nextCursor } : {}),
      }) as { items: ExternalDocumentItem[]; nextCursor?: string };
      if (!isCurrent()) return;
      setResultContext(requestContext);
      setItems(append
        ? Array.from(new Map([...(items ?? []), ...result.items].map(item => [item.locator.itemId, item])).values())
        : result.items);
      setPath(nextPath);
      setNextCursor(result.nextCursor);
      if (!append) { setSelected(null); setFilter(""); }
    } catch (caught) {
      if (!isCurrent()) return;
      setResultContext(null); setErrorContext(requestContext);
      setItems(null); setSelected(null); setNextCursor(undefined);
      setError(caught instanceof Error ? caught.message : "Could not browse this document source.");
    } finally { if (isCurrent()) setBrowsing(false); }
  };

  const save = async () => {
    if (!source || !selected || !canLink || busy || unavailable || !moduleEnabled || currentContext.current !== contextKey) return;
    if (!title.trim()) { setErrorContext(contextKey); setError("Enter the title that Societyer record readers should see."); return; }
    const currentRequest = ++requestId.current;
    const requestContext = contextKey;
    const isCurrent = () => currentRequest === requestId.current && currentContext.current === requestContext;
    setLinking(true); setError("");
    try {
      const accessToken = await documentSourceToken(source);
      if (!isCurrent()) return;
      const result = await link({ societyId, sourceId: documentSourceId(source), item: { itemId: selected.locator.itemId }, title: title.trim(), category, accessToken }) as { documentId: string; alreadyLinked: boolean };
      if (!isCurrent()) return;
      toast.success(result.alreadyLinked ? "Document already linked" : "Document linked", "The file stays in its source library.");
      onLinked(String(result.documentId));
    } catch (caught) {
      if (!isCurrent()) return;
      setResultContext(null); setErrorContext(requestContext);
      setItems(null); setSelected(null); setNextCursor(undefined);
      setError(caught instanceof Error ? caught.message : "Could not link this document.");
    } finally { if (isCurrent()) setLinking(false); }
  };

  const filtered = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    return (items ?? []).filter(item => !term || `${item.name} ${item.mimeType ?? ""}`.toLocaleLowerCase().includes(term));
  }, [items, filter]);

  return (
    <Drawer open={open} onClose={linking ? () => undefined : onClose} title="Link existing document" size="wide" className="external-documents"
      footer={<>
        <button type="button" className="btn" disabled={linking} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--accent" disabled={!selected || !source || !canLink || busy || Boolean(unavailable) || !moduleEnabled || !title.trim()} onClick={() => void save()}><Link2 size={14} /> {linking ? "Linking…" : "Link document"}</button>
      </>}>
      <div className="external-documents__stack">
        <p className="muted">Choose a file from an approved library. The link follows the latest file; Societyer does not keep a file snapshot.</p>
        {!moduleEnabled && <p className="notice" role="status">External documents are off for this workspace.</p>}
        {unavailable && <p className="notice" role="status">{unavailable}</p>}
        {sources === undefined && moduleEnabled && <p className="muted" role="status">Loading document sources…</p>}
        {sources && enabledSources.length === 0 && <p className="notice">No document source is enabled. {permissions.can("settings:write") ? <Link to="/app/settings?tab=runtime" onClick={onClose}>Configure document sources</Link> : "Ask a workspace administrator to configure a source."}</p>}
        {!!enabledSources.length && <>
          <Field label="Document source">
            <Select value={sourceId} disabled={busy} onChange={changeSource} options={enabledSources.map(candidate => ({ value: documentSourceId(candidate), label: candidate.label }))} />
          </Field>
          <div className="external-documents__actions">
            <button type="button" className="btn" disabled={!source || busy || Boolean(unavailable)} onClick={() => void loadFolder(path)}>{browsing ? "Loading folder…" : items === null ? "Browse library" : "Refresh folder"}</button>
            {items === null && <span className="muted">Microsoft sign-in is requested when you browse.</span>}
          </div>
        </>}
        {error && <div className="notice notice--danger" role="alert">{error}</div>}
        {items !== null && <>
          <nav className="external-documents__breadcrumbs" aria-label="Document source folder">
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void loadFolder([])}>Library</button>
            {path.map((crumb, index) => <span className="external-documents__actions" key={crumb.itemId}>
              <ChevronRight size={12} aria-hidden="true" />
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void loadFolder(path.slice(0, index + 1))}>{crumb.name}</button>
            </span>)}
          </nav>
          <Field label="Filter loaded items in this folder" hint="Filters names and file types already loaded in this folder. Load more to include additional items.">
            <input className="input" type="search" value={filter} onChange={event => setFilter(event.target.value)} disabled={linking} />
          </Field>
          {filtered.length === 0 && <p className="muted" role="status">{filter ? "No loaded items match this filter." : "This folder has no files or folders available to you."}</p>}
          <ul className="external-documents__files" aria-label="Files and folders">
            {filtered.map(item => <li key={item.locator.itemId}>
              <button type="button" className="external-documents__entry" disabled={busy}
                {...(item.kind === "file" ? { "aria-pressed": selected?.locator.itemId === item.locator.itemId } : {})}
                onClick={() => item.kind === "folder" ? void loadFolder([...path, { itemId: item.locator.itemId, name: item.name }]) : setSelected(item)}>
                {item.kind === "folder" ? <Folder size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                <span className="external-documents__entry-info"><strong>{item.name}</strong>
                  <small className="muted">{item.kind === "folder" ? "Folder" : [item.mimeType, formatBytes(item.sizeBytes), item.modifiedAtISO ? formatDateTime(item.modifiedAtISO) : undefined].filter(Boolean).join(" · ") || "File"}</small>
                </span>
                {item.kind === "folder" && <ChevronRight size={14} aria-hidden="true" />}
              </button>
            </li>)}
          </ul>
          {nextCursor && <div><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void loadFolder(path, true)}>Load more items</button></div>}
        </>}
        {selected && <div className="external-documents__selected external-documents__stack">
          <div><strong>Selected at source</strong><div>{selected.name}</div><span className="muted">{source?.label} · Latest file</span></div>
          <Field label="Title in Societyer (visible to record readers)" required hint="Choose what Societyer readers may see, including readers who cannot open the Microsoft file. The source filename is not copied automatically.">
            <input className="input" value={title} maxLength={240} disabled={linking} onChange={event => setTitle(event.target.value)} />
          </Field>
          <Field label="Category"><Select value={category} disabled={linking} onChange={setCategory} options={documentCategoryOptions([])} /></Field>
        </div>}
      </div>
    </Drawer>
  );
}
