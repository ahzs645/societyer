import express, { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { createBrowserBackend } from "./browserBackend.js";
import {
  activeWaveListTransactionsSchema,
  businessIdFromWaveUrl,
  businessUuidFromWaveBusinessId,
  ConnectorActionError,
  connectors,
  installWaveBearerCapture,
  requireKnownConnector,
  runWaveListTransactions,
  verifyWaveAuth,
  waitForWaveBearer,
  waveListTransactionsSchema,
} from "./connectors.js";

const port = Number(process.env.CONNECTOR_RUNNER_PORT ?? 8890);
const runnerSecret = process.env.CONNECTOR_RUNNER_SECRET;
const exposeCdpUrl = process.env.CONNECTOR_DEBUG_EXPOSE_CDP_URL === "true";
const publicWebSocketBaseUrl = process.env.CONNECTOR_RUNNER_PUBLIC_WS_URL ?? `ws://127.0.0.1:${port}`;
const backend = createBrowserBackend();

type ActiveSession = {
  sessionId: string;
  connectorId?: string;
  providerSessionId: string;
  profileKey: string;
  startedAtISO: string;
  dashboardUrl?: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  vncHost?: string;
  vncPort?: number;
};

const activeSessions = new Map<string, ActiveSession>();

const sessionStartSchema = z.object({
  profileKey: z.string().min(1),
  startUrl: z.string().url().optional(),
  liveView: z.boolean().default(true),
  timezone: z.string().optional(),
  browserVersion: z.string().optional(),
  proxyUrl: z.string().url().optional(),
});

const profilePageSchema = z.object({
  profileKey: z.string().min(1),
  url: z.string().url(),
  readOnly: z.boolean().default(true),
  liveView: z.boolean().default(false),
  waitForSelector: z.string().optional(),
  authenticatedSelector: z.string().optional(),
  unauthenticatedSelector: z.string().optional(),
  includeBodyText: z.boolean().default(false),
  timezone: z.string().optional(),
  browserVersion: z.string().optional(),
  proxyUrl: z.string().url().optional(),
});

const sessionPasteSchema = z.object({
  text: z.string().min(1).max(20_000),
  pressEnter: z.boolean().default(false),
  selector: z.string().optional(),
});

function requireRunnerSecret(req: Request, res: Response, next: NextFunction) {
  if (!runnerSecret) {
    if (process.env.NODE_ENV === "production") {
      res.status(500).json({ error: "CONNECTOR_RUNNER_SECRET is required in production." });
      return;
    }
    next();
    return;
  }

  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  const provided = req.headers["x-connector-runner-secret"] ?? bearer;
  if (provided !== runnerSecret) {
    res.status(401).json({ error: "Unauthorized connector runner request." });
    return;
  }
  next();
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

async function connectSession(cdpUrl: string) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  return { browser, context, page };
}

async function closeActiveSession(session: ActiveSession) {
  await session.browser.close().catch(() => undefined);
  await backend.stopSession(session.providerSessionId).catch(() => undefined);
  activeSessions.delete(session.sessionId);
}

function blitzVncHost() {
  try {
    return new URL(process.env.BLITZBROWSER_CDP_URL ?? "ws://127.0.0.1:9999").hostname;
  } catch {
    return "127.0.0.1";
  }
}

async function canConnect(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(150);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function discoverVncPorts(host: string) {
  const checks: Array<Promise<number | undefined>> = [];
  for (let candidate = 13001; candidate <= 13099; candidate += 2) {
    checks.push(canConnect(host, candidate).then((open) => open ? candidate : undefined));
  }
  const ports = await Promise.all(checks);
  return new Set(ports.filter((candidate): candidate is number => typeof candidate === "number"));
}

async function detectNewVncPort(before: Set<number>, host: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const after = await discoverVncPorts(host);
    const assigned = new Set([...activeSessions.values()].map((session) => session.vncPort).filter(Boolean));
    const fresh = [...after].filter((candidate) => !before.has(candidate) && !assigned.has(candidate));
    if (fresh.length > 0) return fresh[0];
    const unassigned = [...after].filter((candidate) => !assigned.has(candidate));
    if (unassigned.length === 1) return unassigned[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

async function selectorVisible(page: Page, selector?: string) {
  if (!selector) return undefined;
  try {
    return await page.locator(selector).first().isVisible({ timeout: 2_000 });
  } catch {
    return false;
  }
}

async function openWaveTransactionsPage(page: Page, businessId: string) {
  const businessUuid = businessUuidFromWaveBusinessId(businessId);
  if (!businessUuid) return;
  const transactionsUrl = `https://next.waveapps.com/${businessUuid}/transactions`;
  if (page.url().startsWith(transactionsUrl)) return;
  await page.goto(transactionsUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

function publicSession(session: ActiveSession) {
  const vncWebSocketUrl = session.vncPort
    ? `${publicWebSocketBaseUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(session.sessionId)}/vnc`
    : undefined;
  return {
    sessionId: session.sessionId,
    connectorId: session.connectorId,
    profileKey: session.profileKey,
    provider: backend.provider,
    startedAtISO: session.startedAtISO,
    currentUrl: session.page.url(),
    dashboardUrl: session.dashboardUrl,
    vncWebSocketUrl,
  };
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    runner: "connector-runner",
    browser: await backend.healthCheck(),
    activeSessions: activeSessions.size,
  });
}));

app.use(requireRunnerSecret);

app.get("/connectors", (_req, res) => {
  res.json({ connectors });
});

app.get("/sessions", (_req, res) => {
  res.json({ sessions: [...activeSessions.values()].map(publicSession) });
});

app.post("/sessions/start-login", asyncRoute(async (req, res) => {
  const input = sessionStartSchema.parse(req.body);
  const vncHost = blitzVncHost();
  const beforeVncPorts = input.liveView ? await discoverVncPorts(vncHost) : new Set<number>();
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: input.liveView,
    timezone: input.timezone,
    browserVersion: input.browserVersion,
    proxyUrl: input.proxyUrl,
  });

  const { browser, context, page } = await connectSession(browserSession.cdpUrl);
  if (input.startUrl) {
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  const vncPort = input.liveView ? await detectNewVncPort(beforeVncPorts, vncHost) : undefined;

  const session: ActiveSession = {
    sessionId: crypto.randomUUID(),
    providerSessionId: browserSession.providerSessionId,
    profileKey: browserSession.profileKey,
    startedAtISO: new Date().toISOString(),
    dashboardUrl: browserSession.dashboardUrl,
    browser,
    context,
    page,
    vncHost: vncPort ? vncHost : undefined,
    vncPort,
  };
  activeSessions.set(session.sessionId, session);

  res.json({
    ...publicSession(session),
    liveViewEnabled: browserSession.liveViewEnabled,
    cdpUrl: exposeCdpUrl ? browserSession.cdpUrl : undefined,
  });
}));

app.post("/sessions/:sessionId/finish-login", asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const result = {
    sessionId: session.sessionId,
    profileKey: session.profileKey,
    finalUrl: session.page.url(),
    title: await session.page.title().catch(() => undefined),
    savedAtISO: new Date().toISOString(),
  };
  await closeActiveSession(session);
  res.json(result);
}));

app.post("/sessions/:sessionId/stop", asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  await closeActiveSession(session);
  res.json({ sessionId, stoppedAtISO: new Date().toISOString() });
}));

app.post("/sessions/:sessionId/paste", asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const input = sessionPasteSchema.parse(req.body);
  const result: any = await session.page.evaluate(`(() => {
    const payload = ${JSON.stringify({ selector: input.selector, text: input.text })};
    const selector = payload.selector;
    const text = payload.text;
    const editableSelector = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), [contenteditable='true']";
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const isEditable = (element) => {
      if (!element) return false;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return !element.disabled && element.type !== "hidden";
      }
      return element instanceof HTMLElement && element.isContentEditable;
    };
    const describe = (element, beforeLength, afterLength) => ({
      tag: element?.tagName ?? null,
      type: element instanceof HTMLInputElement ? element.type : null,
      name: element?.getAttribute("name"),
      id: element instanceof HTMLElement ? element.id : undefined,
      placeholder: element?.getAttribute("placeholder"),
      beforeLength,
      afterLength,
    });

    let element = selector ? document.querySelector(selector) : document.activeElement;
    if (!isEditable(element)) {
      element = [...document.querySelectorAll(editableSelector)].find((candidate) => isEditable(candidate) && isVisible(candidate)) ?? null;
    }
    if (!isEditable(element)) {
      return { inserted: false, reason: "No focused or visible editable field was found.", target: describe(document.activeElement) };
    }

    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const before = element.value.length;
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? element.value.length;
      const nextValue = element.value.slice(0, start) + text + element.value.slice(end);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (valueSetter) valueSetter.call(element, nextValue);
      else element.value = nextValue;
      const caret = start + text.length;
      try {
        element.setSelectionRange(caret, caret);
      } catch {
        // Some input types, including email in Chromium, do not support programmatic selection ranges.
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { inserted: true, target: describe(element, before, element.value.length) };
    }

    const before = element.textContent?.length ?? 0;
    document.execCommand("insertText", false, text);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return { inserted: true, target: describe(element, before, element.textContent?.length ?? 0) };
  })()`);

  if (!result.inserted) {
    throw new ConnectorActionError(409, "paste_target_not_found", result.reason ?? "No editable field is focused in the browser.");
  }
  if (input.pressEnter) {
    await session.page.keyboard.press("Enter");
  }

  res.json({
    sessionId,
    insertedCharacterCount: input.text.length,
    pressedEnter: input.pressEnter,
    target: result.target,
    currentUrl: session.page.url(),
    pastedAtISO: new Date().toISOString(),
  });
}));

app.post("/connectors/:connectorId/auth/start", asyncRoute(async (req, res) => {
  const connector = requireKnownConnector(String(req.params.connectorId));
  const input = sessionStartSchema.parse({
    ...req.body,
    startUrl: req.body?.startUrl ?? connector.auth.startUrl,
  });
  const vncHost = blitzVncHost();
  const beforeVncPorts = input.liveView ? await discoverVncPorts(vncHost) : new Set<number>();
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: input.liveView,
    timezone: input.timezone,
    browserVersion: input.browserVersion,
    proxyUrl: input.proxyUrl,
  });

  const { browser, context, page } = await connectSession(browserSession.cdpUrl);
  await page.goto(input.startUrl!, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const vncPort = input.liveView ? await detectNewVncPort(beforeVncPorts, vncHost) : undefined;

  const session: ActiveSession = {
    sessionId: crypto.randomUUID(),
    connectorId: connector.id,
    providerSessionId: browserSession.providerSessionId,
    profileKey: browserSession.profileKey,
    startedAtISO: new Date().toISOString(),
    dashboardUrl: browserSession.dashboardUrl,
    browser,
    context,
    page,
    vncHost: vncPort ? vncHost : undefined,
    vncPort,
  };
  activeSessions.set(session.sessionId, session);

  res.json({
    ...publicSession(session),
    liveViewEnabled: browserSession.liveViewEnabled,
    cdpUrl: exposeCdpUrl ? browserSession.cdpUrl : undefined,
  });
}));

app.post("/connectors/:connectorId/auth/verify", asyncRoute(async (req, res) => {
  const connector = requireKnownConnector(String(req.params.connectorId));
  const input = profilePageSchema.parse({
    ...req.body,
    url: req.body?.url ?? connector.auth.startUrl,
    readOnly: req.body?.readOnly ?? true,
    liveView: req.body?.liveView ?? false,
  });
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: input.liveView,
    readOnly: input.readOnly,
    timezone: input.timezone,
    browserVersion: input.browserVersion,
    proxyUrl: input.proxyUrl,
  });

  const { browser, page } = await connectSession(browserSession.cdpUrl);
  try {
    if (connector.id === "wave") {
      res.json(await verifyWaveAuth(page));
      return;
    }
    res.json({ connectorId: connector.id, authenticated: undefined, checkedAtISO: new Date().toISOString() });
  } finally {
    await browser.close().catch(() => undefined);
  }
}));

app.post("/connectors/:connectorId/auth/sessions/:sessionId/confirm", asyncRoute(async (req, res) => {
  const connector = requireKnownConnector(String(req.params.connectorId));
  const sessionId = String(req.params.sessionId);
  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  if (session.connectorId && session.connectorId !== connector.id) {
    res.status(409).json({ error: `Session belongs to ${session.connectorId}, not ${connector.id}.` });
    return;
  }

  if (connector.id !== "wave") {
    throw new ConnectorActionError(404, "connector_verifier_not_found", `Connector "${connector.id}" does not define an auth verifier.`);
  }

  const auth = await verifyWaveAuth(session.page);
  if (!auth.authenticated) {
    res.status(409).json({
      ...auth,
      sessionId: session.sessionId,
      profileKey: session.profileKey,
      saved: false,
      error: "Wave login is not complete.",
      message: "Wave login is not complete. Keep the live browser open, finish login, then confirm again.",
    });
    return;
  }

  const result = {
    ...auth,
    sessionId: session.sessionId,
    profileKey: session.profileKey,
    saved: true,
    savedAtISO: new Date().toISOString(),
    finalUrl: session.page.url(),
    title: await session.page.title().catch(() => undefined),
  };
  await closeActiveSession(session);
  res.json(result);
}));

app.post("/connectors/:connectorId/auth/sessions/:sessionId/actions/:actionId", asyncRoute(async (req, res) => {
  const connector = requireKnownConnector(String(req.params.connectorId));
  const sessionId = String(req.params.sessionId);
  const actionId = String(req.params.actionId);
  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  if (session.connectorId && session.connectorId !== connector.id) {
    res.status(409).json({ error: `Session belongs to ${session.connectorId}, not ${connector.id}.` });
    return;
  }
  if (connector.id !== "wave" || !["listTransactions", "importTransactions"].includes(actionId)) {
    throw new ConnectorActionError(404, "connector_action_not_found", `Action "${actionId}" is not registered for ${connector.id}.`);
  }

  const input = activeWaveListTransactionsSchema.parse(req.body);
  const businessId = input.businessId ?? businessIdFromWaveUrl(session.page.url());
  if (!businessId) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      "Wave is not on a business dashboard yet. Finish login in the live browser, then run the transaction pull before confirming and saving.",
    );
  }

  const startedAtISO = new Date().toISOString();
  let bearer: string | undefined;
  await installWaveBearerCapture(session.page, (token) => {
    bearer = token;
  });
  await openWaveTransactionsPage(session.page, businessId);

  await session.page.evaluate(() => {
    const apollo = Reflect.get(window, "__APOLLO_CLIENT__");
    return apollo?.refetchObservableQueries?.();
  }).catch(() => undefined);
  bearer = await waitForWaveBearer(session.page, () => bearer, 5_000);

  if (!bearer) {
    await session.page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await session.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    bearer = await waitForWaveBearer(session.page, () => bearer, 15_000);
  }

  if (!bearer) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      "Wave did not expose an authenticated GraphQL bearer token in the active browser session.",
    );
  }

  const output = await runWaveListTransactions(
    session.page,
    { ...input, businessId, profileKey: session.profileKey },
    bearer,
  );
  bearer = undefined;
  res.json({
    runId: crypto.randomUUID(),
    connectorId: connector.id,
    actionId,
    sessionId: session.sessionId,
    profileKey: session.profileKey,
    provider: backend.provider,
    startedAtISO,
    completedAtISO: new Date().toISOString(),
    currentUrl: session.page.url(),
    title: await session.page.title().catch(() => undefined),
    ...output,
  });
}));

app.post("/connectors/:connectorId/actions/:actionId", asyncRoute(async (req, res) => {
  const connector = requireKnownConnector(String(req.params.connectorId));
  const actionId = String(req.params.actionId);
  if (connector.id !== "wave" || !["listTransactions", "importTransactions"].includes(actionId)) {
    throw new ConnectorActionError(404, "connector_action_not_found", `Action "${actionId}" is not registered for ${connector.id}.`);
  }

  const input = waveListTransactionsSchema.parse(req.body);
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: false,
    readOnly: true,
  });

  const { browser, page } = await connectSession(browserSession.cdpUrl);
  const runId = crypto.randomUUID();
  const startedAtISO = new Date().toISOString();
  let bearer: string | undefined;
  try {
    await installWaveBearerCapture(page, (token) => {
      bearer = token;
    });
    await page.goto(connector.auth.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await openWaveTransactionsPage(page, input.businessId);
    bearer = await waitForWaveBearer(page, () => bearer);
    if (!bearer) {
      throw new ConnectorActionError(
        401,
        "reauth_required",
        "Wave did not expose an authenticated GraphQL bearer token. Open the Wave live login flow and finish the session first.",
      );
    }

    const output = await runWaveListTransactions(page, input, bearer);
    res.json({
      runId,
      connectorId: connector.id,
      actionId,
      profileKey: browserSession.profileKey,
      provider: backend.provider,
      startedAtISO,
      completedAtISO: new Date().toISOString(),
      currentUrl: page.url(),
      title: await page.title().catch(() => undefined),
      ...output,
    });
  } finally {
    bearer = undefined;
    await browser.close().catch(() => undefined);
  }
}));

app.post("/profiles/validate", asyncRoute(async (req, res) => {
  const input = profilePageSchema.parse(req.body);
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: input.liveView,
    readOnly: input.readOnly,
    timezone: input.timezone,
    browserVersion: input.browserVersion,
    proxyUrl: input.proxyUrl,
  });

  const { browser, page } = await connectSession(browserSession.cdpUrl);
  try {
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (input.waitForSelector) {
      await page.waitForSelector(input.waitForSelector, { timeout: 10_000 });
    }

    const unauthenticated = await selectorVisible(page, input.unauthenticatedSelector);
    const authenticated = await selectorVisible(page, input.authenticatedSelector);
    const bodyText = input.includeBodyText
      ? (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 4000)
      : undefined;

    res.json({
      profileKey: browserSession.profileKey,
      provider: backend.provider,
      currentUrl: page.url(),
      title: await page.title().catch(() => undefined),
      authenticated:
        authenticated === true ? true :
        unauthenticated === true ? false :
        undefined,
      checkedAtISO: new Date().toISOString(),
      bodyText,
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}));

app.post("/runs/open-page", asyncRoute(async (req, res) => {
  const input = profilePageSchema.parse(req.body);
  const browserSession = await backend.createSession({
    profileKey: input.profileKey,
    persist: true,
    liveView: input.liveView,
    readOnly: input.readOnly,
    timezone: input.timezone,
    browserVersion: input.browserVersion,
    proxyUrl: input.proxyUrl,
  });

  const { browser, page } = await connectSession(browserSession.cdpUrl);
  const startedAtISO = new Date().toISOString();
  try {
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (input.waitForSelector) {
      await page.waitForSelector(input.waitForSelector, { timeout: 10_000 });
    }
    const bodyText = input.includeBodyText
      ? (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 4000)
      : undefined;

    res.json({
      runId: crypto.randomUUID(),
      profileKey: browserSession.profileKey,
      provider: backend.provider,
      startedAtISO,
      completedAtISO: new Date().toISOString(),
      currentUrl: page.url(),
      title: await page.title().catch(() => undefined),
      bodyText,
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}));

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request body.", issues: error.issues });
    return;
  }
  if (error instanceof ConnectorActionError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: error?.message ?? "Connector runner error." });
});

const vncWebSocketServer = new WebSocketServer({ noServer: true });

function toBuffer(data: WebSocket.RawData) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as any);
}

function attachVncProxy(ws: WebSocket, _request: IncomingMessage, session: ActiveSession) {
  if (!session.vncHost || !session.vncPort) {
    ws.close(1011, "VNC stream is unavailable for this session.");
    return;
  }

  const vnc = net.createConnection({ host: session.vncHost, port: session.vncPort });
  const closeBoth = () => {
    vnc.destroy();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  vnc.on("data", (chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
  });
  vnc.on("error", closeBoth);
  vnc.on("close", closeBoth);
  ws.on("message", (data) => {
    if (!vnc.destroyed) vnc.write(toBuffer(data));
  });
  ws.on("error", closeBoth);
  ws.on("close", closeBoth);
}

vncWebSocketServer.on("connection", attachVncProxy);

const server = app.listen(port, () => {
  console.log(`[connector-runner] listening on http://127.0.0.1:${port} provider=${backend.provider}`);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://connector-runner.local");
  const match = url.pathname.match(/^\/sessions\/([^/]+)\/vnc$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const session = activeSessions.get(decodeURIComponent(match[1]));
  if (!session?.vncPort) {
    socket.destroy();
    return;
  }

  vncWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
    vncWebSocketServer.emit("connection", ws, request, session);
  });
});
