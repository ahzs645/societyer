/** Server-only Graph primitives. Deployment consent/token custody and live verification remain separate. */
export type SharePointConnection = {
  tenantId: string; siteId: string; driveId: string;
  authorizationMode: "delegated" | "application";
  /** Administrator-approved hosts for Graph-issued upload/download URLs. */
  transferHosts: readonly string[];
  maxFileBytes: number;
};
export type SharePointLocator = { provider: "sharepoint"; tenantId: string; siteId: string; driveId: string; itemId: string; versionId?: string };
export type SharePointItem = { locator: SharePointLocator; fileName: string; sizeBytes: number; eTag: string };
export type GraphTokenSupplier = (binding: { tenantId: string; authorizationMode: SharePointConnection["authorizationMode"]; audience: "https://graph.microsoft.com" }) => Promise<string>;
export type SharePointAdapterDependencies = { token: GraphTokenSupplier; fetch?: typeof fetch; wait?: (ms: number) => Promise<void> };
const GRAPH = "https://graph.microsoft.com/v1.0";
const CHUNK = 320 * 1024;

function identifier(value: string): string {
  if (!value || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new Error("Invalid SharePoint resource identifier.");
  return encodeURIComponent(value);
}
export function validateSharePointConnection(connection: SharePointConnection): SharePointConnection {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(connection.tenantId)) throw new Error("A verified Microsoft tenant UUID is required.");
  identifier(connection.siteId); identifier(connection.driveId);
  if (!["delegated", "application"].includes(connection.authorizationMode)) throw new Error("Invalid Graph authorization mode.");
  if (!Number.isSafeInteger(connection.maxFileBytes) || connection.maxFileBytes < 1 || connection.maxFileBytes > 2 * 1024 ** 3) throw new Error("SharePoint file limit must be between 1 byte and 2 GiB.");
  if (!connection.transferHosts.length || connection.transferHosts.some((host) => !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host) || !host.includes(".") || host.includes(".."))) throw new Error("List exact administrator-approved transfer hostnames.");
  return Object.freeze({ ...connection, transferHosts: Object.freeze([...connection.transferHosts].map((host) => host.toLowerCase())) });
}

export class SharePointAdapter {
  private readonly connection: SharePointConnection;
  private readonly request: typeof fetch;
  private readonly wait: (ms: number) => Promise<void>;
  constructor(connection: SharePointConnection, private readonly dependencies: SharePointAdapterDependencies) {
    this.connection = validateSharePointConnection(connection);
    this.request = dependencies.fetch ?? fetch;
    this.wait = dependencies.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  private fetchBound(url: string, init: RequestInit = {}): Promise<Response> {
    return this.request(url, { ...init, signal: AbortSignal.timeout(15_000) });
  }
  private locator(itemId: string, versionId?: string): SharePointLocator {
    if (!/^[a-z\d!._-]+$/i.test(itemId)) throw new Error("Invalid SharePoint item identifier.");
    identifier(itemId); if (versionId) identifier(versionId);
    return { provider: "sharepoint", tenantId: this.connection.tenantId, siteId: this.connection.siteId, driveId: this.connection.driveId, itemId, ...(versionId ? { versionId } : {}) };
  }
  private bound(locator: SharePointLocator) {
    this.locator(locator.itemId, locator.versionId);
    if (locator.provider !== "sharepoint" || locator.tenantId !== this.connection.tenantId || locator.siteId !== this.connection.siteId || locator.driveId !== this.connection.driveId) throw new Error("SharePoint resource is outside the approved connection.");
    const base = `/drives/${identifier(locator.driveId)}/items/${identifier(locator.itemId)}`;
    return locator.versionId ? `${base}/versions/${identifier(locator.versionId)}` : base;
  }
  private transferUrl(value: unknown): string {
    let url: URL;
    try { url = new URL(String(value)); } catch { throw new Error("Invalid Graph transfer target."); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !this.connection.transferHosts.includes(url.hostname.toLowerCase())) throw new Error("Graph transfer target is outside the approved connection.");
    return url.href;
  }
  private graphUrl(pathOrUrl: string): string {
    const url = new URL(pathOrUrl.startsWith("/") ? `${GRAPH}${pathOrUrl}` : pathOrUrl);
    const scope = `/v1.0/drives/${encodeURIComponent(this.connection.driveId)}/`;
    if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith(scope) || url.username || url.password || url.hash || [...url.searchParams.keys()].some((key) => /^(access_token|refresh_token|client_secret|authorization)$/i.test(key))) throw new Error("Graph continuation is outside the approved drive.");
    return url.href;
  }
  private async accessToken(): Promise<string> {
    let token: string;
    try { token = await this.dependencies.token({ tenantId: this.connection.tenantId, authorizationMode: this.connection.authorizationMode, audience: "https://graph.microsoft.com" }); }
    catch { throw new Error("Graph token acquisition failed."); }
    if (!token || /[\r\n]/.test(token)) throw new Error("Graph token supplier returned an invalid token.");
    return token;
  }
  private async json(response: Response): Promise<any> {
    try { return await response.json(); } catch { throw new Error("Graph returned invalid JSON metadata."); }
  }
  private async graph(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.graphUrl(path);
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.accessToken();
      const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
      let response: Response;
      try { response = await this.fetchBound(url, { ...init, headers, redirect: "manual" }); } catch { throw new Error("Graph request failed."); }
      if ([429, 503].includes(response.status) && attempt < 2) {
        const retryHeader = response.headers.get("Retry-After");
        const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
        await response.body?.cancel();
        await this.wait(Number.isFinite(retrySeconds) ? Math.min(30_000, Math.max(0, retrySeconds * 1000)) : 1000 * (attempt + 1));
        continue;
      }
      if ([409, 412].includes(response.status)) throw new Error("SharePoint version conflict; refresh the item and retry with its current eTag.");
      if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) throw new Error(`Graph request rejected (${response.status}).`);
      return response;
    }
    throw new Error("Graph request retry limit reached.");
  }
  private item(value: any): SharePointItem {
    if (value?.parentReference?.driveId !== this.connection.driveId || !value.id || !value.eTag || typeof value.name !== "string" || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > this.connection.maxFileBytes) throw new Error("Graph returned invalid or out-of-scope item metadata.");
    return { locator: this.locator(value.id), fileName: value.name, sizeBytes: value.size, eTag: value.eTag };
  }
  async verifyResource(): Promise<{ tenantId: string; siteId: string; driveId: string }> {
    const drive = await this.json(await this.graph(`/drives/${identifier(this.connection.driveId)}/?$select=id,sharePointIds`));
    if (drive.id !== this.connection.driveId || drive.sharePointIds?.tenantId?.toLowerCase() !== this.connection.tenantId.toLowerCase()) throw new Error("Graph drive ownership did not match the approved tenant.");
    // Explicit site membership is probed through the fixed site/drive relationship.
    const token = await this.accessToken();
    let response: Response;
    try { response = await this.fetchBound(`${GRAPH}/sites/${identifier(this.connection.siteId)}/drives/${identifier(this.connection.driveId)}?$select=id`, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" }); }
    catch { throw new Error("Graph site membership verification failed."); }
    if (!response.ok || (await this.json(response)).id !== this.connection.driveId) throw new Error("Graph drive is not available under the approved site.");
    return { tenantId: this.connection.tenantId, siteId: this.connection.siteId, driveId: this.connection.driveId };
  }
  private uploadTarget(fileName: string, existing?: { locator: SharePointLocator; eTag: string }): string {
    if (!fileName || fileName.length > 240 || /[/\\\x00-\x1f]/.test(fileName) || [".", ".."].includes(fileName)) throw new Error("Use a single bounded SharePoint filename.");
    if (existing) {
      if (!existing.eTag || existing.eTag.length > 1024 || /[\r\n]/.test(existing.eTag) || existing.locator.versionId) throw new Error("Updating a SharePoint item requires its current eTag.");
      return this.bound(existing.locator);
    }
    return `/drives/${identifier(this.connection.driveId)}/root:/${encodeURIComponent(fileName)}:`;
  }
  async upload(fileName: string, bytes: Uint8Array, options: { existing?: { locator: SharePointLocator; eTag: string }; mimeType?: string } = {}): Promise<SharePointItem> {
    if (!bytes.byteLength || bytes.byteLength > this.connection.maxFileBytes) throw new Error("SharePoint upload exceeds the configured file limit.");
    const target = this.uploadTarget(fileName, options.existing);
    const headers = { "Content-Type": options.mimeType ?? "application/octet-stream", ...(options.existing ? { "If-Match": options.existing.eTag } : { "If-None-Match": "*" }) };
    if (bytes.byteLength <= 4 * 1024 ** 2) {
      const response = await this.graph(`${target}/content?@microsoft.graph.conflictBehavior=fail`, { method: "PUT", headers, body: bytes as BodyInit });
      const item = this.item(await this.json(response));
      if (item.sizeBytes !== bytes.byteLength) throw new Error("SharePoint upload size did not match the submitted bytes.");
      return item;
    }
    const session = await this.json(await this.graph(`${target}/createUploadSession`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name: fileName } }) }));
    const uploadUrl = this.transferUrl(session.uploadUrl);
    try {
      for (let start = 0; start < bytes.byteLength; start += CHUNK) {
        const end = Math.min(start + CHUNK, bytes.byteLength);
        const response = await this.fetchBound(uploadUrl, { method: "PUT", redirect: "manual", headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}` }, body: bytes.slice(start, end) as BodyInit });
        if (end < bytes.byteLength) {
          if (response.status !== 202) throw new Error("Graph resumable upload did not accept a bounded chunk.");
          const progress = await this.json(response);
          if (!Array.isArray(progress.nextExpectedRanges) || progress.nextExpectedRanges[0] !== `${end}-`) throw new Error("Graph resumable upload returned an unexpected chunk position.");
        } else {
          if (!response.ok || response.status === 202) throw new Error("Graph resumable upload did not finalize.");
          const item = this.item(await this.json(response));
          if (item.sizeBytes !== bytes.byteLength) throw new Error("SharePoint upload size did not match the submitted bytes.");
          return item;
        }
      }
    } catch {
      // Transfer URLs are bearer capabilities. Never return them or include vendor exception text.
      try { await this.fetchBound(uploadUrl, { method: "DELETE", redirect: "manual" }); } catch { /* Best-effort abandoned-session cancellation. */ }
      throw new Error("SharePoint resumable upload failed; session cancellation was attempted.");
    }
    throw new Error("SharePoint upload did not finalize.");
  }
  async download(locator: SharePointLocator): Promise<Uint8Array> {
    let response = await this.graph(`${this.bound(locator)}/content`);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const url = this.transferUrl(response.headers.get("Location"));
      try { response = await this.fetchBound(url, { redirect: "manual" }); } catch { throw new Error("SharePoint content transfer failed."); }
      if (!response.ok) throw new Error("SharePoint content transfer rejected.");
    }
    const declared = response.headers.get("Content-Length");
    if (declared && Number(declared) > this.connection.maxFileBytes) { await response.body?.cancel(); throw new Error("SharePoint download exceeds the configured file limit."); }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > this.connection.maxFileBytes) { await reader.cancel(); throw new Error("SharePoint download exceeds the configured file limit."); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  }
  async versions(locator: SharePointLocator, continuation?: string): Promise<{ versions: SharePointLocator[]; continuation?: string }> {
    if (locator.versionId) throw new Error("List versions from a logical SharePoint item.");
    const versionPath = `${this.bound(locator)}/versions`;
    const path = continuation ?? versionPath;
    if (new URL(this.graphUrl(path)).pathname !== `/v1.0${versionPath}`) throw new Error("Graph version continuation is outside the approved item.");
    const page = await this.json(await this.graph(path));
    if (!Array.isArray(page.value)) throw new Error("Invalid Graph version page.");
    return { versions: page.value.map((version: any) => this.locator(locator.itemId, version.id)), ...(page["@odata.nextLink"] ? { continuation: this.graphUrl(page["@odata.nextLink"]) } : {}) };
  }
  async delta(continuation?: string): Promise<{ items: Array<SharePointItem | { locator: SharePointLocator; deleted: true }>; next?: string; checkpoint?: string; resetRequired: boolean }> {
    let response: Response;
    try { response = await this.graph(continuation ?? `/drives/${identifier(this.connection.driveId)}/root/delta`); } catch (error) {
      if (error instanceof Error && error.message === "Graph request rejected (410).") return { items: [], resetRequired: true };
      throw error;
    }
    const page = await this.json(response); if (!Array.isArray(page.value)) throw new Error("Invalid Graph delta page.");
    return { items: page.value.map((item: any) => item.deleted ? { locator: this.locator(item.id), deleted: true as const } : this.item(item)),
      ...(page["@odata.nextLink"] ? { next: this.graphUrl(page["@odata.nextLink"]) } : {}), ...(page["@odata.deltaLink"] ? { checkpoint: this.graphUrl(page["@odata.deltaLink"]) } : {}), resetRequired: false };
  }
}
