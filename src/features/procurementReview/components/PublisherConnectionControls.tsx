/**
 * Zoer publisher: one workspace key that lets Zoer's server publish this
 * catalog on its own, through convex/procurementPublisherHttp.ts. The browser
 * makes the key and only its SHA-256 is saved, so the connection string can be
 * shown just once. Mounted for settings editors; the server checks the same.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../lib/convexApi";
import { Modal, useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { relative } from "../../../lib/format";
import { convexAuthSiteUrl } from "../../../lib/convexSite";
import { copyTextToClipboard } from "../../../lib/regulatoryCitations";
import { encodePublisherConnection, PUBLISHER_ENDPOINT_PATH } from "../../../../shared/procurementReview/publisherConnection";

type PublisherSettings = { enabled: boolean; createdAt: number; lastUsedAt: number | null; lastOperation: string | null; lastError: string | null } | null;
const OPERATIONS: Record<string, string> = { status: "connection test", reportSource: "source report", publicationPolicy: "publishing check", recordPublication: "catalog publication" };
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function PublisherConnectionControls({ societyId, folder }: { societyId: string; folder: string }) {
  const connection = useQuery(api.procurementPublisher.settings, { societyId }) as PublisherSettings | undefined;
  const configure = useMutation(api.procurementPublisher.configure), revoke = useMutation(api.procurementPublisher.revoke);
  const confirm = useConfirm(), toast = useToast();
  const [busy, setBusy] = useState(false), [connectionString, setConnectionString] = useState<string | null>(null), [copied, setCopied] = useState(false);
  if (connection === undefined) return null;
  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try { await action(); } catch (error) { toast.error(failure, error instanceof Error ? error.message : undefined); } finally { setBusy(false); }
  };
  const createKey = async () => {
    if (connection && !await confirm({ title: "Replace the Zoer key?", message: "The current key stops working at once. Zoer needs the new connection to keep publishing.", confirmLabel: "Replace key", tone: "warn" })) return;
    await run(async () => {
      const key = hex(crypto.getRandomValues(new Uint8Array(32)));
      // Encode first: a deployment URL Zoer can't use fails here, before the old key is replaced.
      const text = encodePublisherConnection({ endpoint: convexAuthSiteUrl() + PUBLISHER_ENDPOINT_PATH, key, societyId, folder });
      await configure({ societyId, keyHash: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))) });
      setCopied(false); setConnectionString(text);
    }, "Couldn't create the connection key");
  };
  const setEnabled = (enabled: boolean) => run(async () => { await configure({ societyId, enabled }); }, enabled ? "Couldn't turn the publisher on" : "Couldn't turn the publisher off");
  const remove = async () => {
    if (!await confirm({ title: "Remove the Zoer connection?", message: "Zoer can't publish to this workspace until you create a new key.", confirmLabel: "Remove", tone: "danger" })) return;
    await run(async () => { await revoke({ societyId }); }, "Couldn't remove the connection");
  };
  const copy = async () => {
    if (connectionString && await copyTextToClipboard(connectionString)) setCopied(true);
    else toast.error("Clipboard unavailable", "Select the text and copy it instead.");
  };
  const state = !connection ? "Not connected. Zoer's server can publish this catalog on its own with a connection key."
    : !connection.enabled ? "Turned off. Zoer's requests are refused until you turn it back on."
    : connection.lastUsedAt ? `Connected. Last used ${relative(connection.lastUsedAt)}${connection.lastOperation ? ` (${OPERATIONS[connection.lastOperation] ?? connection.lastOperation})` : ""}.`
    : "Connected. Zoer hasn't used this key yet.";

  return <div className="col" style={{ gap: 8, marginTop: 8 }} aria-label="Zoer publisher" role="group">
    <h3 className="card__title">Zoer publisher</h3>
    <p className="muted">{state}</p>
    {connection?.enabled && connection.lastError && <p className="muted">Last request refused: {connection.lastError}</p>}
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn" disabled={busy} onClick={() => void createKey()}>{connection ? "Replace key" : "Create connection key"}</button>
      {connection && <button type="button" className="btn" disabled={busy} onClick={() => void setEnabled(!connection.enabled)}>{connection.enabled ? "Turn off" : "Turn on"}</button>}
      {connection && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void remove()}>Remove</button>}
    </div>
    <Modal open={connectionString !== null} onClose={() => setConnectionString(null)} title="Zoer connection" size="md" dismissOnBackdrop={false}
      footer={<>
        <button type="button" className="btn" onClick={() => setConnectionString(null)}>Done</button>
        <button type="button" className="btn btn--accent" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
      </>}>
      <p>Paste this into Zoer → Societyer publishing. It's shown only once.</p>
      <textarea className="textarea mono" readOnly rows={5} aria-label="Zoer connection string" value={connectionString ?? ""}
        onFocus={event => event.currentTarget.select()} style={{ width: "100%", overflowWrap: "anywhere" }} />
    </Modal>
  </div>;
}
