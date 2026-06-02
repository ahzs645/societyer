# Societyer Desktop Local-First Plan

Societyer should move toward an Electron desktop app as a local-first vault with optional server-assisted services. It should not become a giant offline clone of every cloud service in the current stack.

The current repo is a good fit for this direction because the UI is Vite, React, and TypeScript, while the backend-facing surface is already concentrated around Convex queries, mutations, and actions. The desktop path should keep that UI-facing API shape intact, then choose the implementation at runtime.

## Product Model

Societyer Desktop stores society records and documents locally by default. Cloud sync, AI, public portals, payments, messaging, webhooks, and browser automation are optional connected services.

## Runtime Modes

The app should distinguish runtime mode from document storage. Runtime mode decides which data client backs the React app:

```ts
type RuntimeMode =
  | "convex-cloud"
  | "convex-self-hosted"
  | "local-indexeddb"
  | "electron-local";
```

Recommended meanings:

- `convex-cloud`: hosted Convex deployment.
- `convex-self-hosted`: local, Docker, Kubernetes, or other self-hosted Convex backend.
- `local-indexeddb`: browser-local persistent workspace using Dexie/IndexedDB.
- `electron-local`: Electron desktop workspace using local persistence and native file APIs.

The existing `/demo` client in `src/lib/staticConvex.ts` is a useful prototype adapter, but it should not be treated as a finished durable local database. It should be formalized into a reusable local workspace adapter with explicit seed data, persistence, migrations, and export/import boundaries.

## Document Storage Providers

Document storage should be configured separately from runtime mode:

```ts
type DocumentStorageProvider =
  | "convex-storage"
  | "rustfs-s3"
  | "local-filesystem"
  | "demo";
```

Recommended Electron default:

```ts
runtimeMode: "electron-local";
documentStorage: "local-filesystem";
syncStorage: "rustfs-s3" | "convex-storage" | null;
```

RustFS/S3 should remain available as remote or sync storage, not as a required local desktop dependency. The Electron default should use a local workspace folder and expose file operations only through preload APIs.

Suggested workspace layout:

```txt
Societyer Workspace/
  workspace.json
  data/
  documents/
    societies/
      <societyId>/
        documents/
          <documentId>/
            v1-original.pdf
            v2-reviewed.pdf
  backups/
  exports/
```

## Server-Assisted Services

These features should stay optional and connected:

- AI drafting, chat, model catalog, and transcription.
- Public transparency portal publishing.
- Webhooks.
- Email and SMS delivery.
- Stripe checkout and webhook handling.
- Wave, Paperless-ngx, and other external API pulls.
- Browser imports and authenticated browser automation.
- Multi-user cloud sync and collaboration.

The desktop app can store local data and call these services when configured. It should clearly show unavailable states when a connected service is offline or unconfigured.

## Browser Connectors

Browser imports should stay outside the core Electron package. The current Docker connector flow maps well to desktop:

- Electron stores endpoint URL and token/secret.
- Electron checks connector health.
- Electron shows connected/unavailable status.
- The connector service runs through Docker only when needed.

Do not bundle browser automation into the core desktop app.

## Electron Security Boundary

The renderer should not get direct Node or filesystem access. Electron native capabilities should be exposed through narrow preload APIs using context isolation and `contextBridge`.

Initial preload API shape:

```ts
window.societyerDesktop = {
  chooseWorkspaceDirectory(): Promise<string | null>;
  getWorkspaceInfo(): Promise<WorkspaceInfo | null>;
  writeDocumentVersion(input: WriteDocumentVersionInput): Promise<DocumentVersionRef>;
  readDocumentVersion(input: ReadDocumentVersionInput): Promise<ArrayBuffer>;
  openPath(path: string): Promise<void>;
  createBackup(): Promise<BackupResult>;
  checkConnector(endpoint: string): Promise<ConnectorHealth>;
};
```

## Implementation Order

1. Add runtime and storage descriptors without changing current behavior.
2. Extract the static/demo client into a reusable local adapter boundary.
3. Add `electron-local` mode, initially pointing at the same local adapter.
4. Add a document storage provider interface.
5. Add `local-filesystem` storage behind Electron preload APIs.
6. Keep RustFS/S3 as optional sync or remote storage.
7. Keep browser imports as a separate Docker connector service.
8. Package the Electron shell after the adapters are stable.

## Compatibility Buckets

Local CRUD viable:

- Societies, members, directors, meetings, minutes, tasks, filings, documents metadata, policies, grants, committees, assets, inspections, retention, custom fields, saved views.

Local stub viable:

- AI agents, notifications, communications, workflow runs, Wave sync, Paperless sync, public portal publishing.

Server required:

- Real email/SMS delivery, Stripe webhooks, public hosted portal, third-party webhooks, AI/transcription, authenticated external API pulls, browser imports, and multi-user collaboration across devices.
