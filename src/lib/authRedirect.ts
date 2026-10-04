const redirectOrigin = "https://societyer.invalid";

/** Keep login and invitation callbacks on the application's origin. */
export function getSafeAuthRedirect(redirect: string | null): string {
  if (
    !redirect?.startsWith("/") ||
    redirect.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(redirect)
  ) return "/app";

  try {
    const url = new URL(redirect, redirectOrigin);
    if (url.origin !== redirectOrigin || url.pathname.startsWith("//")) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/app";
  }
}
