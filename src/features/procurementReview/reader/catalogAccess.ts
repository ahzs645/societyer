/** Short-lived access scoped to one workspace and one HTTPS service. Never persisted. */
export type CatalogAccessGrant = { token: string; expiresAt: number; baseUrl: string };
export class CatalogAccess {
  private grant: CatalogAccessGrant | null = null;
  private pending: Promise<CatalogAccessGrant> | null = null;
  private controller = new AbortController();
  constructor(readonly societyId: string, readonly baseUrl: string, private mint: () => Promise<CatalogAccessGrant>, private transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    const url = new URL(baseUrl); if (url.origin !== baseUrl || url.protocol !== "https:") throw new Error("Invalid catalog service origin.");
  }
  private async token(force: boolean) {
    if (!force && this.grant && this.grant.expiresAt - Date.now() > 120_000) return this.grant;
    if (!this.pending) this.pending = this.mint().then(grant => {
      if (this.controller.signal.aborted) throw new Error("Catalog reader was closed.");
      if (grant.baseUrl !== this.baseUrl || grant.expiresAt <= Date.now()) throw new Error("Catalog grant belongs to another service or has expired.");
      this.grant = grant; return grant;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async read<T>(path: string, init: RequestInit = {}): Promise<T> {
    const signal = init.signal ? AbortSignal.any([init.signal, this.controller.signal]) : this.controller.signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const grant = await this.token(attempt === 1);
      signal.throwIfAborted();
      const response = await this.transport(this.baseUrl + "/v1/" + encodeURIComponent(this.societyId) + path, { ...init, signal, credentials: "omit", redirect: "error", headers: { ...init.headers, Authorization: "Bearer " + grant.token } });
      if (response.status === 401 && attempt === 0) { this.grant = null; continue; }
      if (!response.ok) throw new Error(response.status === 410 ? "This publication has expired. Refresh procurement to load the latest catalog." : `The procurement catalog could not be read (${response.status}). Try again shortly.`);
      const result = await response.json() as T; signal.throwIfAborted(); return result;
    }
    throw new Error("Sign in again to read this workspace's procurement catalog.");
  }
  close() { this.grant = null; this.controller.abort(); }
}
