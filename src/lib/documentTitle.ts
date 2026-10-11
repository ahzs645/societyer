import { useEffect } from "react";

export const APP_DOCUMENT_TITLE = "Societyer";

/** Browser tab / history / screen-reader title for a page: "<page> · Societyer". */
export function formatDocumentTitle(title: string | null | undefined): string {
  const clean = String(title ?? "").replace(/\s+/g, " ").trim();
  return clean ? `${clean} · ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
}

/**
 * Names the browser tab after the current page (WCAG 2.4.2) and puts the
 * previous title back when the page unmounts, so history entries and tabs are
 * distinguishable instead of all reading the app's tagline.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const clean = String(title ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const previous = document.title;
    document.title = formatDocumentTitle(clean);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
