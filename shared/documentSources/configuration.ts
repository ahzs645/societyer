import { DocumentSourceError, validateMicrosoftDocumentSource } from "./policy";
import {
  MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
  type DocumentSourceCapabilities,
  type MicrosoftDocumentSource,
} from "./types";

export const MICROSOFT_DOCUMENT_SOURCE_CAPABILITIES: DocumentSourceCapabilities = Object.freeze({
  browse: true,
  resolve: true,
  search: "metadata",
});

/** A provider must implement the adapter contract before being offered here. */
export const DOCUMENT_SOURCE_PROVIDERS = Object.freeze([Object.freeze({
  providerId: MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
  label: "Microsoft SharePoint",
  capabilities: MICROSOFT_DOCUMENT_SOURCE_CAPABILITIES,
})]);

export type DocumentSourceSettings = {
  enabled: boolean;
  sources: MicrosoftDocumentSource[];
};

/** No environment or upload-storage setting implicitly enables external sources. */
export function defaultDocumentSourceSettings(): DocumentSourceSettings {
  return { enabled: false, sources: [] };
}

export function validateDocumentSourceSettings(value: unknown): DocumentSourceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_CONFIGURATION");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["enabled", "sources"].includes(key))
      || typeof input.enabled !== "boolean" || !Array.isArray(input.sources) || input.sources.length > 50) {
    throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_CONFIGURATION");
  }
  const sources = input.sources.map(validateMicrosoftDocumentSource);
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_CONFIGURATION");
  return { enabled: input.enabled, sources };
}
