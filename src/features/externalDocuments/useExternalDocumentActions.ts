import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../lib/convexApi";
import { isLocalDataRuntime } from "../../lib/staticRuntime";
import { useModuleEnabled } from "../../hooks/useModules";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import type { OpenableDocument } from "../../lib/documentOpen";
import { acquireDocumentSourceToken } from "./microsoftAccess";
import { documentSourceId, documentSourcesRevision, externalDocumentWebUrl, type DocumentSource, type ExternalDocumentItem } from "./types";

export function externalDocumentUnavailableReason() {
  if (isLocalDataRuntime()) return "Connect from the hosted workspace to browse and open external documents. Source settings can be prepared here.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You are offline. Reconnect to browse or open external documents.";
  return undefined;
}

export function useExternalDocumentAvailability() {
  const [reason, setReason] = useState(externalDocumentUnavailableReason);
  useEffect(() => {
    const refresh = () => setReason(externalDocumentUnavailableReason());
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    refresh();
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
  }, []);
  return reason;
}

/** Acquire only from an explicit user action; never put the token into a local runtime queue. */
export async function documentSourceToken(source: DocumentSource) {
  const unavailable = externalDocumentUnavailableReason();
  if (unavailable) throw new Error(unavailable);
  if (!source.enabled) throw new Error("This document source is disabled. Ask a workspace administrator to enable it.");
  if (source.providerId !== "microsoft-sharepoint") throw new Error("This document provider is not available on this deployment.");
  return acquireDocumentSourceToken(source, { interactive: true });
}

export function useExternalDocumentActions(societyId: string | undefined, active = true) {
  const moduleEnabled = useModuleEnabled("externalDocuments");
  const currentUserId = useCurrentUserId();
  const unavailableReason = useExternalDocumentAvailability();
  const sources = useQuery(api.documentSources.list, societyId && active && moduleEnabled ? { societyId } : "skip") as DocumentSource[] | undefined;
  const sourceRevision = documentSourcesRevision(sources);
  const contextKey = JSON.stringify([societyId, moduleEnabled, currentUserId, sourceRevision]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const resolveAction = useAction(api.documentSources.resolve);
  const unlinkMutation = useMutation(api.documentSources.unlink);
  const confirm = useConfirm();
  const toast = useToast();
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [lastResolved, setLastResolved] = useState<{ documentId: string; item: ExternalDocumentItem; checkedAt: string; contextKey: string } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1; setLastResolved(null); setBusyDocumentId(null);
    return () => { requestId.current += 1; };
  }, [societyId, moduleEnabled, currentUserId, sourceRevision]);

  useEffect(() => {
    const clear = () => { requestId.current += 1; setLastResolved(null); setBusyDocumentId(null); };
    window.addEventListener("societyer:document-source-accounts-cleared", clear);
    return () => window.removeEventListener("societyer:document-source-accounts-cleared", clear);
  }, []);

  const sourceFor = (document: OpenableDocument) => sources?.find(source => documentSourceId(source) === document.externalReference?.sourceId);
  const resolve = async (document: OpenableDocument): Promise<ExternalDocumentItem> => {
    if (!moduleEnabled) throw new Error("External documents are turned off for this workspace. Enable the module in Settings to open the source.");
    if (!document.externalReference) throw new Error("This document no longer has an external reference.");
    const unavailable = externalDocumentUnavailableReason();
    if (unavailable) throw new Error(unavailable);
    const source = sourceFor(document);
    if (!source) throw new Error(sources === undefined ? "Source settings are still loading. Try again in a moment." : "This document source is no longer configured.");
    const currentRequest = ++requestId.current;
    setBusyDocumentId(document._id);
    setLastResolved(null);
    try {
      const accessToken = await documentSourceToken(source);
      if (currentRequest !== requestId.current || currentContext.current !== contextKey) throw new Error("The active reader or workspace changed. Open the document again.");
      const item = await resolveAction({ documentId: document._id, accessToken }) as ExternalDocumentItem;
      if (currentRequest !== requestId.current || currentContext.current !== contextKey) throw new Error("The active reader or workspace changed. Open the document again.");
      if (item.kind !== "file") throw new Error("This reference no longer identifies a file.");
      // Keep display metadata only in component memory. Every Open resolves a new URL.
      const { webUrl: _webUrl, ...displayItem } = item;
      setLastResolved({ documentId: document._id, item: displayItem, checkedAt: new Date().toISOString(), contextKey });
      return item;
    } finally { if (currentRequest === requestId.current) setBusyDocumentId(null); }
  };

  const getExternalTarget = async (document: OpenableDocument) => ({ url: externalDocumentWebUrl(await resolve(document)) });
  const unlink = async (document: OpenableDocument): Promise<boolean> => {
    const accepted = await confirm({
      title: "Unlink document?",
      message: "Remove this source link? The Societyer record and the file in its source service will remain.",
      confirmLabel: "Unlink",
      tone: "danger",
    });
    if (!accepted) return false;
    setBusyDocumentId(document._id);
    try {
      await unlinkMutation({ documentId: document._id });
      setLastResolved(null);
      toast.success("Source link removed", "The Societyer record and the source file remain.");
      return true;
    } catch (error) {
      toast.error("Could not unlink document", error instanceof Error ? error.message : String(error));
      return false;
    } finally { setBusyDocumentId(null); }
  };

  return { sources, moduleEnabled, unavailableReason, busyDocumentId, lastResolved: lastResolved?.contextKey === contextKey ? lastResolved : null, sourceFor, resolve, getExternalTarget, unlink };
}
