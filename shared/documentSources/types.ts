/** References to originals held by another service, separate from upload storage. */
export const MICROSOFT_DOCUMENT_SOURCE_PROVIDER = "microsoft-sharepoint" as const;

export type DocumentSourceCapabilities = Readonly<{
  browse: boolean;
  resolve: boolean;
  /** Metadata means filtering already-authorized, loaded folder entries. */
  search: "none" | "metadata" | "fulltext";
}>;

/** The server derives this actor from Societyer's authenticated principal. */
export type DocumentSourceActor = Readonly<{ userId: string; societyId: string }>;

/** Public connection configuration. No client secret, token or storage credentials. */
export type MicrosoftDocumentSourceConfig = Readonly<{
  tenantId: string;
  clientId: string;
  /** Graph site ID: hostname,siteCollectionGuid,webGuid. */
  siteId: string;
  driveId: string;
  siteUrl: string;
}>;

export type DocumentSource<ProviderId extends string, Config> = Readonly<{
  id: string;
  providerId: ProviderId;
  label: string;
  enabled: boolean;
  config: Config;
}>;

export type MicrosoftDocumentSource = DocumentSource<
  typeof MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
  MicrosoftDocumentSourceConfig
>;

export type MicrosoftDocumentLocator = Readonly<{
  tenantId: string;
  siteId: string;
  driveId: string;
  itemId: string;
}>;

/** A moving "latest" reference is not a retained, signed or pinned original. */
export type ExternalDocumentReference<
  Locator = MicrosoftDocumentLocator,
  ProviderId extends string = typeof MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
> = Readonly<{
  providerId: ProviderId;
  sourceId: string;
  locator: Locator;
  mode: "latest";
}>;

/** Ephemeral metadata: callers must not persist it into ordinary document rows. */
export type ExternalDocumentItem<Locator = MicrosoftDocumentLocator> = {
  locator: Locator;
  kind: "file" | "folder";
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  modifiedAtISO?: string;
  webUrl?: string;
  eTag?: string;
};

export type DocumentSourcePage<Locator = MicrosoftDocumentLocator> = {
  items: ExternalDocumentItem<Locator>[];
  nextCursor?: string;
};

/** Other providers implement this contract with their own config and locator. */
export interface DocumentSourceAdapter<Source, Locator> {
  readonly providerId: string;
  readonly capabilities: DocumentSourceCapabilities;
  browse(input: {
    source: Source;
    actor: DocumentSourceActor;
    parentItemId?: string;
    cursor?: string;
  }): Promise<DocumentSourcePage<Locator>>;
  resolve(input: {
    source: Source;
    actor: DocumentSourceActor;
    locator: Locator;
  }): Promise<ExternalDocumentItem<Locator>>;
}

export type DocumentSourceErrorCode =
  | "DOCUMENT_SOURCE_DISABLED"
  | "DOCUMENT_SOURCE_INVALID_CONFIGURATION"
  | "DOCUMENT_SOURCE_INVALID_REFERENCE"
  | "DOCUMENT_SOURCE_OUT_OF_SCOPE"
  | "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED"
  | "DOCUMENT_SOURCE_FORBIDDEN"
  | "DOCUMENT_SOURCE_NOT_FOUND"
  | "DOCUMENT_SOURCE_RATE_LIMITED"
  | "DOCUMENT_SOURCE_UNAVAILABLE"
  | "DOCUMENT_SOURCE_INVALID_RESPONSE"
  | "DOCUMENT_SOURCE_UNSUPPORTED";
