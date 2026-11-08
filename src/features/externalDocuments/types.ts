import type { DocumentSource as ProviderDocumentSource, ExternalDocumentItem as ProviderDocumentItem, MicrosoftDocumentSourceConfig } from "../../../shared/documentSources/types";

/** Display contracts reuse the adapter's config and ephemeral item types. */
export type DocumentSourceConfig = MicrosoftDocumentSourceConfig;

export type DocumentSource = ProviderDocumentSource<string, DocumentSourceConfig> & {
  _id?: string;
  createdAtISO?: string;
  updatedAtISO?: string;
};

export type ExternalDocumentItem = ProviderDocumentItem;

/** Public document marker. The provider's locator lives in a separate private reference row. */
export type ExternalDocumentReference = {
  sourceId: string;
  providerId: string;
  referenceId: string;
  mode: "latest";
};

export function documentSourceId(source: DocumentSource) {
  return String(source.id ?? source._id);
}

export function documentSourcesRevision(sources: DocumentSource[] | undefined) {
  return sources ? JSON.stringify(sources.map(source => [documentSourceId(source), source.enabled, source.updatedAtISO, source.config])) : "loading";
}

export function documentSourceLabel(providerId: string) {
  return providerId === "microsoft-sharepoint" ? "Microsoft SharePoint" : "External document service";
}

/** The server verifies provider URLs; the browser also rejects active URL schemes. */
export function externalDocumentWebUrl(item: ExternalDocumentItem): string {
  if (!item.webUrl) throw new Error("The source did not return a browser link for this document.");
  const url = new URL(item.webUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The source returned an unsupported document link.");
  }
  return url.href;
}
