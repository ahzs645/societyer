/**
 * STABLE APPLICATION IDS (entityId).
 *
 * The audit's load-bearing blocker for cross-runtime sync: durable identity
 * today is the opaque Convex `_id` (656 `v.id()` FKs), there is no portable id
 * column, and fixtures hardcode `static_*` strings as ids. You cannot mint a
 * Convex-native `_id` outside a deployment, so an offline-created row has no
 * legitimate identity to later promote to the cloud.
 *
 * `entityId` is a runtime-independent, lexicographically-sortable id (ULID-ish:
 * 48 bits of time + random suffix, Crockford base32). A row's DURABLE identity
 * is its `entityId`; each runtime additionally keeps a native key (`_id`) and a
 * mapping. This unblocks: offline create -> cloud promote, cloud clone -> local,
 * backup restore into a different deployment, and conflict detection.
 *
 * Deterministic mode (injected clock + counter) exists so tests are stable —
 * see createEntityIdFactory.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: number, length: number): string {
  let out = "";
  let n = value;
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

export interface EntityIdFactoryOptions {
  /** Returns epoch milliseconds. Inject for deterministic tests. */
  now?: () => number;
  /** Returns a float in [0,1). Inject for deterministic tests. */
  random?: () => number;
}

export interface EntityIdFactory {
  mint(prefix?: string): string;
}

/**
 * Build an id factory. With injected `now`/`random` the output is deterministic,
 * which the differential tests rely on. Ids from the same millisecond stay
 * monotonic via an internal counter.
 */
export function createEntityIdFactory(options: EntityIdFactoryOptions = {}): EntityIdFactory {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  let lastTime = -1;
  let counter = 0;

  return {
    mint(prefix?: string): string {
      const time = Math.max(0, Math.floor(now()));
      if (time === lastTime) counter += 1;
      else {
        lastTime = time;
        counter = 0;
      }
      // 10 base32 chars of time (~ULID timestamp), then randomness + counter.
      const timePart = encodeBase32(time, 10);
      const randPart = encodeBase32(Math.floor(random() * 32 ** 6), 6);
      const counterPart = encodeBase32(counter, 2);
      const body = `${timePart}${randPart}${counterPart}`;
      return prefix ? `${prefix}_${body}` : body;
    },
  };
}

const defaultFactory = createEntityIdFactory();

/** Mint a stable entityId using the ambient (non-deterministic) factory. */
export function mintEntityId(prefix?: string): string {
  return defaultFactory.mint(prefix);
}

/** Heuristic: does this look like a minted entityId rather than a native `_id`? */
export function looksLikeEntityId(value: string, prefix?: string): boolean {
  const body = prefix ? (value.startsWith(`${prefix}_`) ? value.slice(prefix.length + 1) : value) : value;
  return /^[0-9A-HJKMNP-TV-Z]{16,20}$/.test(body);
}

/**
 * Bidirectional map between a runtime's native key (`_id`) and the durable
 * `entityId`. Each runtime owns one of these; sync/export/import translate
 * through it so a portable id survives crossing a runtime boundary.
 */
export class EntityIdMap {
  private byEntity = new Map<string, string>();
  private byNative = new Map<string, string>();

  set(entityId: string, nativeId: string): void {
    this.byEntity.set(entityId, nativeId);
    this.byNative.set(nativeId, entityId);
  }

  nativeFor(entityId: string): string | undefined {
    return this.byEntity.get(entityId);
  }

  entityFor(nativeId: string): string | undefined {
    return this.byNative.get(nativeId);
  }

  /** Ensure an entityId exists for a native id, minting one if absent. */
  ensureEntityFor(nativeId: string, mint: () => string): string {
    const existing = this.byNative.get(nativeId);
    if (existing) return existing;
    const minted = mint();
    this.set(minted, nativeId);
    return minted;
  }

  size(): number {
    return this.byEntity.size;
  }
}
