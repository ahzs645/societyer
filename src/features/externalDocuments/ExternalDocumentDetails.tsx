import { useState } from "react";
import { ExternalLink, Link2, RefreshCw, Unlink } from "lucide-react";
import { Link } from "react-router-dom";
import { useSociety } from "../../hooks/useSociety";
import { usePermissions } from "../../hooks/usePermissions";
import { Badge } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { formatBytes, openDocumentFile, type OpenableDocument } from "../../lib/documentOpen";
import { useExternalDocumentActions } from "./useExternalDocumentActions";
import { documentSourceLabel } from "./types";
import "./externalDocuments.css";

export function ExternalDocumentDetails({ document, canEdit = false, onUnlinked }: {
  document: OpenableDocument;
  canEdit?: boolean;
  onUnlinked?: () => void;
}) {
  const society = useSociety();
  const permissions = usePermissions();
  const actions = useExternalDocumentActions(society?._id, Boolean(document.externalReference));
  const [error, setError] = useState("");
  const [attemptedOpen, setAttemptedOpen] = useState(false);
  const source = actions.sourceFor(document);
  const busy = actions.busyDocumentId === document._id;
  const resolved = actions.lastResolved?.documentId === document._id ? actions.lastResolved : null;
  const disabled = !actions.moduleEnabled || Boolean(actions.unavailableReason) || !source?.enabled || busy;

  const check = async (open: boolean) => {
    setError("");
    setAttemptedOpen(open);
    try {
      if (open) await openDocumentFile(document, { getDownloadTarget: async () => null, getExternalTarget: actions.getExternalTarget });
      else await actions.resolve(document);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not access this source document."); }
  };

  if (!document.externalReference) return null;
  return (
    <section className="card external-documents" aria-label="External document link">
      <div className="card__head">
        <h2 className="card__title"><Link2 size={14} /> Linked source document</h2>
        <Badge tone={error ? "warn" : resolved ? "success" : "neutral"}>{error ? "Check failed" : resolved ? "Access checked" : "Not checked"}</Badge>
      </div>
      <div className="card__body external-documents__stack">
        <p className="muted">This record follows the latest file in {documentSourceLabel(document.externalReference.providerId)}. Open the source to read the file and its version history. No file snapshot is kept here.</p>
        <dl className="external-documents__facts">
          <dt>Source</dt><dd>{source?.label ?? documentSourceLabel(document.externalReference.providerId)}</dd>
          <dt>Link mode</dt><dd>Latest source file</dd>
          <dt>Source access</dt><dd>{resolved ? `Checked ${formatDateTime(resolved.checkedAt)} for the signed-in reader` : "Checked when you open or check the link"}</dd>
          {resolved && <>
            <dt>Name at source</dt><dd>{resolved.item.name}</dd>
            {resolved.item.modifiedAtISO && <><dt>Source modified</dt><dd>{formatDateTime(resolved.item.modifiedAtISO)}</dd></>}
            {resolved.item.sizeBytes !== undefined && <><dt>Size</dt><dd>{formatBytes(resolved.item.sizeBytes) ?? "0 B"}</dd></>}
          </>}
        </dl>
        {!actions.moduleEnabled && <p className="notice">External documents are off for this workspace. {permissions.can("settings:write") ? <Link to="/app/settings?tab=modules">Enable the module in Settings</Link> : "Ask a workspace administrator to enable the module."}</p>}
        {actions.unavailableReason && <p className="notice" role="status">{actions.unavailableReason}</p>}
        {actions.moduleEnabled && actions.sources === undefined && <p className="muted" role="status">Loading source settings…</p>}
        {actions.moduleEnabled && actions.sources && !source && <p className="notice">The configured source is unavailable. Ask a workspace administrator to review document source settings.</p>}
        {source && !source.enabled && <p className="notice">This document source is disabled. A workspace administrator can enable it in Settings.</p>}
        {error && <p className="notice notice--danger" role="alert">{error}</p>}
        <div className="external-documents__actions">
          <button type="button" className="btn btn--accent" disabled={disabled} onClick={() => void check(true)}><ExternalLink size={14} /> {busy ? "Checking access…" : "Open at source"}</button>
          <button type="button" className="btn" disabled={disabled} onClick={() => void check(false)}><RefreshCw size={14} /> Check link</button>
          {canEdit && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { void actions.unlink(document).then(unlinked => { if (unlinked) onUnlinked?.(); }); }}><Unlink size={14} /> Unlink</button>}
        </div>
        {attemptedOpen && resolved && <p className="muted">If the source tab did not open, allow pop-ups for Societyer and choose Open at source again.</p>}
      </div>
    </section>
  );
}
