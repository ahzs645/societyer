import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DocumentVersionRef = {
  provider: "local-filesystem";
  key: string;
  fileName: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
};

type WriteDocumentVersionInput = {
  societyId: string;
  documentId: string;
  version: number;
  fileName: string;
  mimeType?: string;
  bytes: ArrayBuffer | Uint8Array | number[];
};

type ReadDocumentVersionInput = {
  key: string;
};

type WorkspaceInfo = {
  id: string;
  name: string;
  rootPath: string;
};

type DesktopConfig = {
  workspaceRoot?: string;
  setupComplete?: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL || process.env.SOCIETYER_ELECTRON_DEV === "1";

let mainWindow: BrowserWindow | null = null;
let workspaceRoot: string | null = null;
let workspaceInfo: WorkspaceInfo | null = null;

function configPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

async function readDesktopConfig(): Promise<DesktopConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    return {
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : undefined,
      setupComplete: parsed.setupComplete === true,
    };
  } catch {
    return {};
  }
}

async function writeDesktopConfig(next: DesktopConfig) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(configPath(), JSON.stringify(next, null, 2));
}

async function updateDesktopConfig(patch: DesktopConfig) {
  const current = await readDesktopConfig();
  const next = { ...current, ...patch };
  await writeDesktopConfig(next);
  return next;
}

async function ensureWorkspace() {
  if (workspaceRoot && workspaceInfo) return { root: workspaceRoot, info: workspaceInfo };

  const config = await readDesktopConfig();
  const root =
    process.env.SOCIETYER_WORKSPACE_DIR ||
    config.workspaceRoot ||
    path.join(app.getPath("userData"), "workspace");
  workspaceRoot = root;
  workspaceInfo = await readOrCreateWorkspaceInfo(root);
  return { root, info: workspaceInfo };
}

async function readOrCreateWorkspaceInfo(root: string): Promise<WorkspaceInfo> {
  await mkdir(root, { recursive: true });
  const workspacePath = path.join(root, "workspace.json");
  try {
    const parsed = JSON.parse(await readFile(workspacePath, "utf8"));
    return {
      id: String(parsed.id || randomUUID()),
      name: String(parsed.name || "Societyer Workspace"),
      rootPath: root,
    };
  } catch {
    const info = {
      id: randomUUID(),
      name: "Societyer Workspace",
      rootPath: root,
    };
    await writeFile(workspacePath, JSON.stringify(info, null, 2));
    return info;
  }
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "item";
}

function bufferFromBytes(value: WriteDocumentVersionInput["bytes"]) {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.from(new Uint8Array(value));
}

function documentRelativePath(input: Omit<WriteDocumentVersionInput, "bytes">) {
  const societyId = sanitizeSegment(input.societyId);
  const documentId = sanitizeSegment(input.documentId);
  const version = sanitizeSegment(`v${input.version}`);
  const fileName = sanitizeSegment(input.fileName);
  return path.join("documents", "societies", societyId, "documents", documentId, `${version}-${fileName}`);
}

function resolveWorkspaceKey(root: string, key: string) {
  const resolved = path.resolve(root, key);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("Document key is outside the workspace.");
  }
  return resolved;
}

async function writeDocumentVersion(input: WriteDocumentVersionInput): Promise<DocumentVersionRef> {
  const { root } = await ensureWorkspace();
  const key = documentRelativePath(input);
  const absolutePath = resolveWorkspaceKey(root, key);
  const bytes = bufferFromBytes(input.bytes);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    provider: "local-filesystem",
    key,
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function readDocumentVersion(input: ReadDocumentVersionInput) {
  const { root } = await ensureWorkspace();
  const filePath = resolveWorkspaceKey(root, input.key);
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function openDocumentVersion(input: ReadDocumentVersionInput) {
  const { root } = await ensureWorkspace();
  const filePath = resolveWorkspaceKey(root, input.key);
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
}

async function createBackup() {
  const { root } = await ensureWorkspace();
  const backupRoot = path.join(root, "backups");
  await mkdir(backupRoot, { recursive: true });
  const backupPath = path.join(backupRoot, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await cp(root, backupPath, {
    recursive: true,
    filter: (source) => !source.startsWith(backupRoot),
  });
  return { path: backupPath };
}

async function checkConnector(endpoint: string) {
  try {
    const response = await fetch(new URL("/healthz", endpoint).toString());
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok,
      provider: body?.browser?.provider ?? body?.provider,
      message: response.ok ? undefined : `Connector returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connector is unavailable.",
    };
  }
}

function registerIpc() {
  ipcMain.handle("societyer:chooseWorkspaceDirectory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    workspaceRoot = result.filePaths[0];
    workspaceInfo = await readOrCreateWorkspaceInfo(workspaceRoot);
    await updateDesktopConfig({ workspaceRoot });
    return workspaceRoot;
  });
  ipcMain.handle("societyer:getWorkspaceInfo", async () => (await ensureWorkspace()).info);
  ipcMain.handle("societyer:getSetupState", async () => {
    const config = await readDesktopConfig();
    return { complete: config.setupComplete === true };
  });
  ipcMain.handle("societyer:setSetupComplete", async (_event, complete: boolean) => {
    const config = await updateDesktopConfig({ setupComplete: complete === true });
    return { complete: config.setupComplete === true };
  });
  ipcMain.handle("societyer:writeDocumentVersion", (_event, input: WriteDocumentVersionInput) => writeDocumentVersion(input));
  ipcMain.handle("societyer:readDocumentVersion", (_event, input: ReadDocumentVersionInput) => readDocumentVersion(input));
  ipcMain.handle("societyer:openDocumentVersion", (_event, input: ReadDocumentVersionInput) => openDocumentVersion(input));
  ipcMain.handle("societyer:createBackup", () => createBackup());
  ipcMain.handle("societyer:checkConnector", (_event, endpoint: string) => checkConnector(endpoint));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.resolve(__dirname, "../../dist/index.html"));
  }
}

registerIpc();

app.whenReady().then(async () => {
  await ensureWorkspace();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
