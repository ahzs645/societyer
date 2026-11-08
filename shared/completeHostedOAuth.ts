/** Redeem a cross-domain callback before mounting session-dependent routes. */
export function createOAuthHandoff(
  client: { verify: (token: string) => Promise<string | null>; establishSession: (token: string) => Promise<void>; refreshSession: () => void },
  page: { href: () => string; replace: (url: URL) => void },
) {
  let pending: Promise<void> | undefined;
  return (): Promise<void> => {
    if (pending) return pending;
    const url = new URL(page.href());
    const token = url.searchParams.get("ott");
    if (!token) return Promise.resolve();
    url.searchParams.delete("ott");
    page.replace(url);
    pending = (async () => {
      const sessionToken = await client.verify(token);
      if (!sessionToken) throw new Error("This sign-in link expired. Please sign in again.");
      await client.establishSession(sessionToken);
      client.refreshSession();
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
