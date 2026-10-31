/** Favorites must be resolvable after reload, not just runnable in this palette session. */
export function canPinFavorite(
  item: { id: string; to?: string; run?: unknown },
  routes: ReadonlySet<string>,
  commandIds: ReadonlySet<string>,
): boolean {
  return item.to ? routes.has(item.to) : typeof item.run === "function" && commandIds.has(item.id);
}

/** Filter authority first, then project route tabs from the common Favorites order. */
export function orderedFavoriteRoutes<T extends { to: string }>(
  order: readonly ({ kind: "route" | "command"; id: string } | { kind: "view"; viewsKey: string; viewId: string })[],
  allowed: readonly T[],
): T[] {
  const byRoute = new Map(allowed.map((item) => [item.to, item]));
  const out: T[] = [];
  for (const ref of order) {
    if (ref.kind !== "route") continue;
    const item = byRoute.get(ref.id);
    if (item) { out.push(item); byRoute.delete(ref.id); }
  }
  // New pins may render one frame before the order reconciliation effect.
  return [...out, ...byRoute.values()];
}
