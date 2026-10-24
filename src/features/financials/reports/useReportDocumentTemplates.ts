import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/convexApi";
import type { InvoiceTemplate } from "../../../../shared/invoiceCommerce";

export type ReportDocumentTemplate = { _id: string; config: InvoiceTemplate; active: boolean };
const EMPTY: ReportDocumentTemplate[] = [];

/** Watch every small template page, so late defaults and changes beyond the initial range stay current. */
export function useReportDocumentTemplates(societyId: string) {
  const client = useConvex();
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ societyId: string; refresh: number; templates: ReportDocumentTemplate[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const stops: Array<() => void> = [];
    setError("");
    const readPage = (cursor: string | null) => new Promise<any>((resolve, reject) => {
      const watch = client.watchQuery(api.invoicePreferences.collectionPage, { societyId, collection: "templates", cursor });
      let first = true, previous = "";
      const changed = () => {
        if (cancelled) return;
        try {
          const page = watch.localQueryResult();
          if (page === undefined) return;
          const serialized = JSON.stringify(page);
          if (first) { first = false; previous = serialized; resolve(page); }
          else if (serialized !== previous) { previous = serialized; setRefresh((value) => value + 1); }
        } catch (problem) {
          if (first) { first = false; reject(problem); }
          else setError(problem instanceof Error ? problem.message : "Could not refresh document templates.");
        }
      };
      stops.push(watch.onUpdate(changed)); changed();
    });
    void (async () => {
      const templates: ReportDocumentTemplate[] = [], seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await readPage(cursor);
        if (cancelled) return;
        templates.push(...page.page);
        if (page.isDone) break;
        if (!page.continueCursor || seen.has(page.continueCursor)) throw new Error("Document template pagination did not advance. Retry loading templates.");
        seen.add(page.continueCursor); cursor = page.continueCursor;
      } while (true);
      if (!cancelled) setLoaded({ societyId, refresh, templates: [...new Map(templates.filter((template) => template.active).map((template) => [template._id, template])).values()] });
    })().catch((problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : "Could not load document templates."); });
    return () => { cancelled = true; for (const stop of stops) stop(); };
  }, [client, societyId, refresh]);
  const ready = loaded?.societyId === societyId && loaded.refresh === refresh && !error;
  return { templates: loaded?.societyId === societyId ? loaded.templates : EMPTY, ready, error, retry: () => setRefresh((value) => value + 1) };
}
