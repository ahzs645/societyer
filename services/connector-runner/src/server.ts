import express, { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import { createBrowserBackend } from "./browserBackend.js";

const port = Number(process.env.CONNECTOR_RUNNER_PORT ?? 8890);
const runnerSecret = process.env.CONNECTOR_RUNNER_SECRET;
const exposeCdpUrl = process.env.CONNECTOR_DEBUG_EXPOSE_CDP_URL === "true";
const backend = createBrowserBackend();

type ActiveSession = {
  sessionId: string;
  providerSessionId: string;
  profileKey: string;
  startedAtISO: string;
  dashboardUrl?: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
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

async function selectorVisible(page: Page, selector?: string) {
  if (!selector) return undefined;
  try {
    return await page.locator(selector).first().isVisible({ timeout: 2_000 });
  } catch {
    return false;
  }
}

function publicSession(session: ActiveSession) {
  return {
    sessionId: session.sessionId,
    profileKey: session.profileKey,
    provider: backend.provider,
    startedAtISO: session.startedAtISO,
    currentUrl: session.page.url(),
    dashboardUrl: session.dashboardUrl,
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

app.get("/sessions", (_req, res) => {
  res.json({ sessions: [...activeSessions.values()].map(publicSession) });
});

app.post("/sessions/start-login", asyncRoute(async (req, res) => {
  const input = sessionStartSchema.parse(req.body);
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

  const session: ActiveSession = {
    sessionId: crypto.randomUUID(),
    providerSessionId: browserSession.providerSessionId,
    profileKey: browserSession.profileKey,
    startedAtISO: new Date().toISOString(),
    dashboardUrl: browserSession.dashboardUrl,
    browser,
    context,
    page,
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
  res.status(500).json({ error: error?.message ?? "Connector runner error." });
});

app.listen(port, () => {
  console.log(`[connector-runner] listening on http://127.0.0.1:${port} provider=${backend.provider}`);
});
