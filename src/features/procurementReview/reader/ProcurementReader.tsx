/** The reader inside a page: the module header over the list; a notice brings its own header. */
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CatalogBrowser, NOTICE_PARAM } from "./CatalogBrowser";
import { ReaderSourceContext, type ReaderSource } from "./source";

export function ProcurementReader({ source, header }: { source: ReaderSource; header: ReactNode }) {
  const [params] = useSearchParams();
  return (
    <ReaderSourceContext.Provider value={source}>
      {!params.get(NOTICE_PARAM) && header}
      <CatalogBrowser />
    </ReaderSourceContext.Provider>
  );
}
