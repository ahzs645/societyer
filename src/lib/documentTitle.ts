import { useEffect } from "react";

export const APP_DOCUMENT_TITLE = "Societyer";

/** Browser tab / history / screen-reader title for a page: "<page> · Societyer". */
export function formatDocumentTitle(title: string | null | undefined, workspaceName?: string | null): string {
  const clean = String(title ?? "").replace(/\s+/g, " ").trim();
  const workspace = String(workspaceName ?? "").replace(/\s+/g, " ").trim();
  return [clean, workspace, APP_DOCUMENT_TITLE].filter(Boolean).join(" · ");
}

/**
 * Names the browser tab after the current page (WCAG 2.4.2) and puts the
 * previous title back when the page unmounts, so history entries and tabs are
 * distinguishable instead of all reading the app's tagline.
 */
export function useDocumentTitle(title: string | null | undefined, workspaceName?: string | null) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const clean = String(title ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const previous = document.title;
    document.title = formatDocumentTitle(clean, workspaceName);
    return () => {
      document.title = previous;
    };
  }, [title, workspaceName]);
}
