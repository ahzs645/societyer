export type TenantOwnedSession = {
  tenantKey: string;
  sessionId: string;
};

function storageKey(tenantKey: string, sessionId: string): string {
  return JSON.stringify([tenantKey, sessionId]);
}

export class TenantSessionStore<T extends TenantOwnedSession> {
  private readonly sessions = new Map<string, T>();

  get size(): number {
    return this.sessions.size;
  }

  set(session: T): void {
    this.sessions.set(storageKey(session.tenantKey, session.sessionId), session);
  }

  get(tenantKey: string | undefined, sessionId: string): T | undefined {
    if (!tenantKey) return undefined;
    return this.sessions.get(storageKey(tenantKey, sessionId));
  }

  delete(tenantKey: string, sessionId: string): boolean {
    return this.sessions.delete(storageKey(tenantKey, sessionId));
  }

  list(tenantKey: string): T[] {
    return [...this.sessions.values()].filter((session) => session.tenantKey === tenantKey);
  }

  values(): IterableIterator<T> {
    return this.sessions.values();
  }
}
