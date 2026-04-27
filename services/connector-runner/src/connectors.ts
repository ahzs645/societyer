import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { z } from "zod";

export type ConnectorManifest = {
  id: string;
  name: string;
  description: string;
  category?: string;
  auth: {
    startUrl: string;
    allowedOrigins: string[];
    profileKeyPrefix?: string;
    confirmMode?: "verified" | "profile";
  };
  browserDefaults?: {
    timezone?: string;
    locale?: string;
    viewport?: { width: number; height: number };
    browserVersion?: string;
  };
  actions: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  utility?: {
    title: string;
    description: string;
    steps: string[];
  };
};

export type ConnectorProfileInput = {
  profileKey: string;
  url: string;
  readOnly?: boolean;
  liveView?: boolean;
  waitForSelector?: string;
  authenticatedSelector?: string;
  unauthenticatedSelector?: string;
  includeBodyText?: boolean;
};

export type ConnectorActionMode = "profile" | "session";

export type ConnectorActionContext = {
  connector: ConnectorManifest;
  actionId: string;
  mode: ConnectorActionMode;
  profileKey: string;
};

type ConnectorActionDefinition = {
  inputSchema: z.ZodTypeAny;
  activeInputSchema?: z.ZodTypeAny;
  run: (page: Page, input: any, context: ConnectorActionContext) => Promise<Record<string, unknown>>;
};

type ConnectorProvider = {
  manifest: ConnectorManifest;
  verifyAuth?: (page: Page, input: ConnectorProfileInput) => Promise<Record<string, unknown>>;
  authIncompleteMessage?: (auth: Record<string, unknown>) => string;
  actions: Record<string, ConnectorActionDefinition>;
};

export class ConnectorActionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const connectors: ConnectorManifest[] = [
  {
    id: "wave",
    name: "Wave",
    category: "Accounting",
    description: "User-authorized Wave browser connector for transaction exports beyond the public API.",
    auth: {
      startUrl: "https://next.waveapps.com/",
      allowedOrigins: ["https://next.waveapps.com", "https://gql.waveapps.com"],
      profileKeyPrefix: "wave",
      confirmMode: "verified",
    },
    actions: [
      {
        id: "listTransactions",
        name: "List transactions",
        description: "Fetch Wave transactions through the authenticated browser session.",
      },
      {
        id: "importTransactions",
        name: "Import transactions",
        description: "Fetch all available Wave transactions and normalize them for Societyer financial records.",
      },
    ],
    utility: {
      title: "Wave data import",
      description: "Pull browser-session transactions and save normalized account rows into Societyer.",
      steps: [
        "Open Wave in the live browser and finish login.",
        "Confirm the saved profile or pull while the live session is active.",
        "Run Preview pull or Pull all & save from the Wave import panel.",
      ],
    },
  },
  {
    id: "bc-registry",
    name: "BC Registry",
    category: "Registry",
    description: "Browser utility profile for authenticated BC Registry filing-history exports.",
    auth: {
      startUrl: "https://www.bcregistry.ca/societies/",
      allowedOrigins: ["https://www.bcregistry.ca"],
      profileKeyPrefix: "bc-registry",
      confirmMode: "profile",
    },
    actions: [
      {
        id: "filingHistoryExport",
        name: "Filing history export",
        description: "Use a filing-history page utility to download digital PDFs and a CSV table of all filing records.",
      },
    ],
    utility: {
      title: "BC Registry filing export",
      description: "Run a live BC Registry page utility on a society filing-history page.",
      steps: [
        "Open BC Registry in the live browser and navigate to the target society filing history.",
        "Run the filing-history export while the live browser is still signed in.",
        "Save or stop the browser after export; closed BC Registry profiles can require a fresh login.",
      ],
    },
  },
  {
    id: "gcos",
    name: "GCOS",
    category: "Government funding",
    description: "User-authorized Grants and Contributions Online Services project snapshot exports.",
    auth: {
      startUrl: "https://www.canada.ca/en/employment-social-development/services/funding/gcos.html",
      allowedOrigins: ["https://www.canada.ca", "https://srv136.services.gc.ca"],
      profileKeyPrefix: "gcos",
      confirmMode: "profile",
    },
    browserDefaults: {
      timezone: "America/Vancouver",
      locale: "en-CA",
      viewport: { width: 1440, height: 900 },
    },
    actions: [
      {
        id: "exportProjects",
        name: "Export projects",
        description: "Read the GCOS Applications and Projects page and return project cards, statuses, and action URLs.",
      },
      {
        id: "exportProjectSnapshot",
        name: "Export project snapshot",
        description: "Read a selected GCOS project, including summary, approved values, agreement metadata, and correspondence.",
      },
    ],
    utility: {
      title: "GCOS grant import",
      description: "Collect ESDC/GCOS project records from the signed-in browser without submitting forms.",
      steps: [
        "Open GCOS in the live browser and finish GCKey or Sign-In Partner login.",
        "Run Project list to confirm the Applications and Projects page is available.",
        "Run Project snapshot for a selected project while the live browser remains signed in.",
      ],
    },
  },
];

export function getConnectorManifest(connectorId: string) {
  return connectors.find((connector) => connector.id === connectorId);
}

function requireConnectorManifest(connectorId: string) {
  const connector = getConnectorManifest(connectorId);
  if (!connector) throw new Error(`Connector manifest "${connectorId}" is not registered.`);
  return connector;
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const waveListTransactionsSchema = z.object({
  profileKey: z.string().min(1),
  businessId: z.string().min(1),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  first: z.number().int().min(1).max(100).default(100),
  maxPages: z.number().int().min(1).max(500).default(500),
  sort: z.enum(["DATE_DESC", "DATE_ASC"]).default("DATE_DESC"),
});

export type WaveListTransactionsInput = z.infer<typeof waveListTransactionsSchema>;

export const activeWaveListTransactionsSchema = waveListTransactionsSchema.omit({ profileKey: true, businessId: true }).extend({
  businessId: z.string().min(1).optional(),
});

export type ActiveWaveListTransactionsInput = z.infer<typeof activeWaveListTransactionsSchema>;

export const bcRegistryFilingHistorySchema = z.object({
  corpNum: z.string().min(1).optional(),
  url: z.string().url().optional(),
  includePdfProbe: z.boolean().default(false),
  downloadPdfs: z.boolean().default(false),
});

export type BcRegistryFilingHistoryInput = z.infer<typeof bcRegistryFilingHistorySchema>;

const bcRegistryFilingHistoryProfileSchema = bcRegistryFilingHistorySchema.extend({
  profileKey: z.string().min(1),
});

export const gcosExportProjectsSchema = z.object({
  search: z.string().optional(),
  pageSize: z.number().int().min(0).max(250).default(0),
  maxPages: z.number().int().min(1).max(25).default(10),
});

export type GcosExportProjectsInput = z.infer<typeof gcosExportProjectsSchema>;

const gcosExportProjectsProfileSchema = gcosExportProjectsSchema.extend({
  profileKey: z.string().min(1),
});

export const gcosProjectSnapshotSchema = z.object({
  projectId: z.string().min(1).optional(),
  programCode: z.string().min(1).optional(),
  includeAgreementPdfs: z.boolean().default(false),
});

export type GcosProjectSnapshotInput = z.infer<typeof gcosProjectSnapshotSchema>;

const gcosProjectSnapshotProfileSchema = gcosProjectSnapshotSchema.extend({
  profileKey: z.string().min(1),
});

export type WaveNormalizedAccount = {
  externalId: string;
  name: string;
  currency: string;
  accountType: "Bank" | "Credit" | "Income" | "Expense" | "Asset" | "Liability" | "Equity";
  balanceCents?: number;
  isRestricted: boolean;
  restrictedPurpose?: string;
};

export type WaveNormalizedTransaction = {
  externalId: string;
  accountExternalId: string;
  date: string;
  description: string;
  amountCents: number;
  category?: string;
  categoryAccountExternalId?: string;
  counterparty?: string;
  counterpartyExternalId?: string;
  counterpartyResourceType?: "vendor" | "customer";
};

const WAVE_CONNECTOR = requireConnectorManifest("wave");
const BC_REGISTRY_CONNECTOR = requireConnectorManifest("bc-registry");
const GCOS_CONNECTOR = requireConnectorManifest("gcos");
const WAVE_GQL_ENDPOINT = "https://gql.waveapps.com/graphql/internal";

const WAVE_TRANSACTIONS_QUERY = `
query TransactionsListPage($businessId: ID!, $filters: TransactionFilter, $first: Int, $after: String, $sort: [TransactionSort!]!) {
  business(id: $businessId) {
    id
    address {
      country {
        code
        __typename
      }
      __typename
    }
    roles
    organizationalType
    eligibleAnchorAccounts: accounts(anchorTiers: [CATEGORY_ELIGIBLE, PHYSICAL]) {
      edges {
        node {
          ...AccountFragment
          __typename
        }
        __typename
      }
      __typename
    }
    uncatAccounts: accounts(subtypes: [UNCATEGORIZED_INCOME, UNCATEGORIZED_EXPENSE]) {
      edges {
        node {
          ...AccountFragment
          __typename
        }
        __typename
      }
      __typename
    }
    transactions(first: $first, after: $after, filters: $filters, sort: $sort) {
      edges {
        node {
          ...TransactionFragment
          __typename
        }
        __typename
      }
      pageInfo {
        hasNextPage
        endCursor
        __typename
      }
      __typename
    }
    userHotspots {
      edges {
        node {
          name
          isViewed
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment AccountFragment on Account {
  id
  name
  accrualAnchorTier
  isArchived
  isPaymentsByWaveAccount
  currency {
    code
    __typename
  }
  subtype {
    name
    value
    type {
      value
      __typename
    }
    __typename
  }
  __typename
}

fragment SalesTaxFragment on SalesTax {
  id
  abbreviation
  name
  rate
  isArchived
  isRecoverable
  __typename
}

fragment TransactionLineItemFragment on ClientTransactionLineItem {
  account {
    ...AccountFragment
    __typename
  }
  amount
  accountAmount
  businessAmount
  customer {
    id
    name
    isArchived
    __typename
  }
  vendor {
    id
    name
    isArchived
    __typename
  }
  description
  itemType
  label
  matchedPeriodId
  matchedPeriod {
    id
    endDate
    status
    __typename
  }
  isReconciled
  order
  taxAction
  taxSummary {
    totalTaxAmount
    taxLiabilities {
      accountId
      isTaxAmountManuallySet
      amount
      salesTax {
        ...SalesTaxFragment
        __typename
      }
      __typename
    }
    __typename
  }
  meta {
    metaEntityType
    __typename
  }
  autocatCategoryStatus
  tags {
    id
    name
    archived
    __typename
  }
  __typename
}

fragment TransactionFragment on ClientTransaction {
  id
  amount
  notes
  date
  dateCreated
  description
  direction
  sequence
  userModifiedAt
  verificationStatus
  currency {
    code
    __typename
  }
  origin {
    externalId
    description
    type
    __typename
  }
  anchorLineItem {
    ...TransactionLineItemFragment
    __typename
  }
  lineItems {
    ...TransactionLineItemFragment
    __typename
  }
  detailActions {
    amount
    date
    description
    account
    category
    verificationStatus
    direction
    notes
    vendor
    customer
    lineItems
    save
    split
    canDelete
    copy
    attachment
    salesTax
    lineItemAmount
    __typename
  }
  listActions {
    amount
    date
    description
    account
    category
    verificationStatus
    attachment
    __typename
  }
  mergedFrom {
    transactionId
    __typename
  }
  mergeSource
  mergedVerificationState
  attachment {
    id
    type
    __typename
  }
  missingFields
  active
  __typename
}
`;

export async function verifyWaveAuth(page: Page) {
  const initialUrl = page.url();
  if (!initialUrl.startsWith("https://next.waveapps.com/") && !initialUrl.startsWith("https://my.waveapps.com/")) {
    await page.goto(WAVE_CONNECTOR.auth.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  const currentUrl = page.url();
  const title = await page.title().catch(() => undefined);
  const bodyText = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 4000);
  const dashboardUrl = /^https:\/\/next\.waveapps\.com\/[^/]+\/dashboard(?:[/?#]|$)/.test(currentUrl);
  const appUrl = currentUrl.startsWith("https://next.waveapps.com/") && !currentUrl.includes("/auth/");
  const loginUrl = /auth\.waveapps\.com|\/login|sign-?in|identifier/i.test(currentUrl);
  const loginish =
    loginUrl ||
    (!dashboardUrl && /log in|sign in|email|password|continue with google/i.test(bodyText));
  const authenticated = dashboardUrl || (appUrl && !loginish);

  return {
    connectorId: "wave",
    currentUrl,
    title,
    authenticated,
    reauthRequired: !authenticated,
    checkedAtISO: new Date().toISOString(),
    bodyText,
  };
}

async function selectorVisible(page: Page, selector?: string) {
  if (!selector) return undefined;
  try {
    return await page.locator(selector).first().isVisible({ timeout: 2_000 });
  } catch {
    return false;
  }
}

export function connectorOriginStatus(connector: ConnectorManifest, url: string) {
  try {
    const origin = new URL(url).origin;
    const allowed = connector.auth.allowedOrigins;
    return {
      origin,
      allowedOrigin: allowed.length === 0 || allowed.includes(origin),
    };
  } catch {
    return {
      origin: undefined,
      allowedOrigin: undefined,
    };
  }
}

async function verifyGenericConnectorAuth(page: Page, connector: ConnectorManifest, input: ConnectorProfileInput) {
  await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (input.waitForSelector) {
    await page.waitForSelector(input.waitForSelector, { timeout: 10_000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  const unauthenticated = await selectorVisible(page, input.unauthenticatedSelector);
  const authenticated = await selectorVisible(page, input.authenticatedSelector);
  const currentUrl = page.url();
  const bodyText = input.includeBodyText
    ? (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 4000)
    : undefined;

  return {
    connectorId: connector.id,
    profileKey: input.profileKey,
    currentUrl,
    title: await page.title().catch(() => undefined),
    authenticated:
      authenticated === true ? true :
      unauthenticated === true ? false :
      undefined,
    ...connectorOriginStatus(connector, currentUrl),
    checkedAtISO: new Date().toISOString(),
    bodyText,
  };
}

export async function verifyConnectorAuth(page: Page, connector: ConnectorManifest, input: ConnectorProfileInput) {
  const provider = requireConnectorProvider(connector.id);
  return provider.verifyAuth
    ? provider.verifyAuth(page, input)
    : verifyGenericConnectorAuth(page, connector, input);
}

export function connectorAuthIncompleteMessage(connector: ConnectorManifest, auth: Record<string, unknown>) {
  return requireConnectorProvider(connector.id).authIncompleteMessage?.(auth)
    ?? `${connector.name} login is not complete. Keep the live browser open, finish login, then confirm again.`;
}

export async function installWaveBearerCapture(page: Page, onBearer: (token: string) => void) {
  page.on("request", (request) => {
    const authorization = request.headers().authorization;
    if (request.url().startsWith(WAVE_GQL_ENDPOINT) && authorization?.toLowerCase().startsWith("bearer ")) {
      onBearer(authorization.slice("Bearer ".length));
    }
  });

  await page.addInitScript(() => {
    const tokenKey = "__societyerWaveBearerToken";
    const storeBearer = (authorization?: string | null) => {
      if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) return;
      Reflect.set(window, tokenKey, authorization.slice("Bearer ".length));
    };

    const readHeader = (headers: HeadersInit | undefined, name: string) => {
      if (!headers) return undefined;
      if (headers instanceof Headers) return headers.get(name);
      if (Array.isArray(headers)) {
        const row = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
        return row?.[1];
      }
      const record = headers as Record<string, string>;
      return record[name] ?? record[name.toLowerCase()];
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const requestHeaders = input instanceof Request ? input.headers : undefined;
      storeBearer(readHeader(init?.headers, "authorization") ?? requestHeaders?.get("authorization"));
      return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open as any;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    (XMLHttpRequest.prototype.open as any) = function (this: XMLHttpRequest, ...args: any[]) {
      Reflect.set(this, "__societyerRequestUrl", String(args[1] ?? ""));
      return originalOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
      if (name.toLowerCase() === "authorization") storeBearer(value);
      return originalSetRequestHeader.call(this, name, value);
    };
  });
}

export async function waitForWaveBearer(page: Page, getBearer: () => string | undefined, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bearer = getBearer() ?? await page.evaluate(() => Reflect.get(window, "__societyerWaveBearerToken")).catch(() => undefined);
    if (typeof bearer === "string" && bearer.length > 10) return bearer;
    await page.waitForTimeout(500);
  }
  return undefined;
}

export async function runWaveListTransactions(page: Page, input: WaveListTransactionsInput, bearer: string) {
  const output = await page.evaluate(
    async ({ bearer, endpoint, input, query }) => {
      const filters: Record<string, string> = {};
      if (input.startDate) filters.startDate = input.startDate;
      if (input.endDate) filters.endDate = input.endDate;

      let after: string | null = null;
      let pageCount = 0;
      let businessAccounts: any[] = [];
      const transactions: any[] = [];

      do {
        pageCount += 1;
        const response: Response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operationName: "TransactionsListPage",
            variables: {
              businessId: input.businessId,
              filters: Object.keys(filters).length > 0 ? filters : null,
              first: input.first,
              after,
              sort: [input.sort],
            },
            query,
          }),
        });
        const payload: any = await response.json();
        if (!response.ok || payload.errors?.length) {
          throw new Error(payload.errors?.[0]?.message ?? `Wave GraphQL returned ${response.status}.`);
        }

        const connection: any = payload.data?.business?.transactions;
        if (!connection) throw new Error("Wave GraphQL response did not include business.transactions.");

        if (pageCount === 1) {
          const business: any = payload.data?.business;
          const accountEdges = [
            ...(business?.eligibleAnchorAccounts?.edges ?? []),
            ...(business?.uncatAccounts?.edges ?? []),
          ];
          businessAccounts = accountEdges.map((edge: any) => edge.node).filter(Boolean);
        }

        transactions.push(...connection.edges.map((edge: any) => edge.node));
        after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after && pageCount < input.maxPages);

      return {
        businessId: input.businessId,
        filters,
        sort: input.sort,
        pageCount,
        hasMore: Boolean(after),
        transactionCount: transactions.length,
        businessAccounts,
        transactions,
      };
    },
    {
      bearer,
      endpoint: WAVE_GQL_ENDPOINT,
      input,
      query: WAVE_TRANSACTIONS_QUERY,
    },
  );

  return {
    ...output,
    normalized: normalizeWaveTransactionExport(output.businessAccounts, output.transactions),
  };
}

function normalizeWaveTransactionExport(businessAccounts: any[], transactions: any[]) {
  const accountsByExternalId = new Map<string, WaveNormalizedAccount>();
  const normalizedTransactions: WaveNormalizedTransaction[] = [];

  for (const account of businessAccounts) {
    upsertNormalizedAccount(accountsByExternalId, account);
  }

  for (const transaction of transactions) {
    const anchorAccount = transaction?.anchorLineItem?.account ?? transaction?.lineItems?.find((line: any) => line?.account)?.account;
    const account = upsertNormalizedAccount(accountsByExternalId, anchorAccount, transaction?.currency?.code);
    if (!account) continue;

    const categoryLine = transaction?.lineItems?.find((line: any) => line?.account?.id && line.account.id !== account.externalId);
    const categoryAccount = upsertNormalizedAccount(accountsByExternalId, categoryLine?.account, transaction?.currency?.code);
    const partyLine = transaction?.lineItems?.find((line: any) => line?.vendor?.name || line?.customer?.name);
    const counterpartyVendor = partyLine?.vendor;
    const counterpartyCustomer = partyLine?.customer;
    const counterparty = counterpartyVendor?.name ?? counterpartyCustomer?.name ?? transaction?.origin?.description;
    const counterpartyExternalId = counterpartyVendor?.id ?? counterpartyCustomer?.id;
    const counterpartyResourceType = counterpartyVendor?.id ? "vendor" : counterpartyCustomer?.id ? "customer" : undefined;
    const amountCents = signedWaveAmountCents(transaction?.amount, transaction?.direction);
    const date = String(transaction.date ?? transaction.dateCreated ?? "");
    if (!date) continue;

    normalizedTransactions.push(dropUndefined({
      externalId: String(transaction.id),
      accountExternalId: account.externalId,
      date,
      description: String(transaction.description ?? transaction.origin?.description ?? "Wave transaction"),
      amountCents,
      category: categoryAccount?.name ?? categoryLine?.account?.name ?? categoryLine?.account?.subtype?.name,
      categoryAccountExternalId: categoryAccount?.externalId,
      counterparty,
      counterpartyExternalId,
      counterpartyResourceType,
    }));
  }

  const transactionsByAccount = [...accountsByExternalId.values()]
    .map((account) => {
      const rows = normalizedTransactions.filter((transaction) => transaction.accountExternalId === account.externalId);
      return {
        accountExternalId: account.externalId,
        accountName: account.name,
        transactionCount: rows.length,
        totalCents: rows.reduce((sum, transaction) => sum + transaction.amountCents, 0),
      };
    })
    .filter((row) => row.transactionCount > 0)
    .sort((a, b) => b.transactionCount - a.transactionCount || a.accountName.localeCompare(b.accountName));

  return {
    accountCount: accountsByExternalId.size,
    transactionCount: normalizedTransactions.length,
    accounts: [...accountsByExternalId.values()],
    transactions: normalizedTransactions,
    transactionsByAccount,
  };
}

function upsertNormalizedAccount(
  accountsByExternalId: Map<string, WaveNormalizedAccount>,
  account: any,
  fallbackCurrency?: string,
) {
  if (!account?.id) return undefined;
  const externalId = String(account.id);
  const existing = accountsByExternalId.get(externalId);
  const name = String(account.name ?? existing?.name ?? "Wave account");
  const currency = String(account.currency?.code ?? existing?.currency ?? fallbackCurrency ?? "CAD");
  const accountType = waveAccountType(account?.subtype?.type?.value, account?.subtype?.value);
  const normalized = {
    externalId,
    name,
    currency,
    accountType,
    isRestricted: existing?.isRestricted ?? /grant|restricted|deferred/i.test(`${name} ${account?.subtype?.name ?? ""}`),
    restrictedPurpose: existing?.restrictedPurpose ?? (/grant|restricted/i.test(name) ? name : undefined),
  };
  accountsByExternalId.set(externalId, dropUndefined(normalized));
  return accountsByExternalId.get(externalId);
}

function waveAccountType(typeValue?: string, subtypeValue?: string): WaveNormalizedAccount["accountType"] {
  const type = String(typeValue ?? "").toUpperCase();
  const subtype = String(subtypeValue ?? "").toUpperCase();
  if (subtype === "CASH_AND_BANK" || type === "BANK") return "Bank";
  if (subtype === "CREDIT_CARD" || type === "CREDIT_CARD") return "Credit";
  if (type === "INCOME") return "Income";
  if (type === "EXPENSE") return "Expense";
  if (type === "LIABILITY") return "Liability";
  if (type === "EQUITY") return "Equity";
  return "Asset";
}

function signedWaveAmountCents(amount: unknown, direction: unknown) {
  const numeric = Number(amount ?? 0);
  const magnitude = Math.round(Math.abs(Number.isFinite(numeric) ? numeric : 0) * 100);
  if (String(direction).toUpperCase() === "WITHDRAWAL") return -magnitude;
  if (String(direction).toUpperCase() === "DEPOSIT") return magnitude;
  return Math.round((Number.isFinite(numeric) ? numeric : 0) * 100);
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}

export function businessIdFromWaveUrl(url: string) {
  const uuid = url.match(/^https:\/\/next\.waveapps\.com\/([^/]+)\//)?.[1];
  if (!uuid) return undefined;
  return Buffer.from(`Business:${uuid}`).toString("base64");
}

export function businessUuidFromWaveBusinessId(businessId: string) {
  try {
    const decoded = Buffer.from(businessId, "base64").toString("utf8");
    return decoded.match(/^Business:([0-9a-f-]+)$/i)?.[1];
  } catch {
    return undefined;
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

async function runWaveTransactionsAction(page: Page, input: WaveListTransactionsInput | ActiveWaveListTransactionsInput, context: ConnectorActionContext) {
  const businessId = input.businessId ?? businessIdFromWaveUrl(page.url());
  if (!businessId) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      "Wave is not on a business dashboard yet. Finish login in the live browser, then run the transaction pull before confirming and saving.",
    );
  }

  let bearer: string | undefined;
  await installWaveBearerCapture(page, (token) => {
    bearer = token;
  });
  await openWaveTransactionsPage(page, businessId);

  await page.evaluate(() => {
    const apollo = Reflect.get(window, "__APOLLO_CLIENT__");
    return apollo?.refetchObservableQueries?.();
  }).catch(() => undefined);
  bearer = await waitForWaveBearer(page, () => bearer, 5_000);

  if (!bearer) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    bearer = await waitForWaveBearer(page, () => bearer, 15_000);
  }

  if (!bearer) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      context.mode === "profile"
        ? "Wave did not expose an authenticated GraphQL bearer token. Open the Wave live login flow and finish the session first."
        : "Wave did not expose an authenticated GraphQL bearer token in the active browser session.",
    );
  }

  try {
    const output = await runWaveListTransactions(
      page,
      { ...input, businessId, profileKey: context.profileKey },
      bearer,
    );
    return {
      currentUrl: page.url(),
      title: await page.title().catch(() => undefined),
      ...output,
    };
  } finally {
    bearer = undefined;
  }
}

function bcRegistryCorpNumFromUrl(url: string) {
  try {
    return new URL(url).pathname.match(/\/societies\/([^/]+)(?:\/|$)/)?.[1];
  } catch {
    return undefined;
  }
}

export async function runBcRegistryFilingHistoryExport(page: Page, input: BcRegistryFilingHistoryInput) {
  const resultLog: Array<Record<string, unknown>> = [];
  const currentCorpNum = bcRegistryCorpNumFromUrl(page.url());
  const corpNum = input.corpNum?.trim() || currentCorpNum;
  const targetUrl = input.url
    ?? (page.url().includes("/filingHistory") ? page.url() : undefined)
    ?? (corpNum ? `https://www.bcregistry.ca/societies/${encodeURIComponent(corpNum)}/filingHistory` : undefined);

  if (!targetUrl) {
    throw new ConnectorActionError(
      400,
      "bc_registry_target_required",
      "Open a BC Registry society page or provide corpNum/url before running the filing-history export.",
    );
  }

  resultLog.push({
    level: "info",
    step: "open",
    message: "Opening BC Registry filing-history page.",
    targetUrl,
    timestampISO: new Date().toISOString(),
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForSelector("table", { timeout: 10_000 }).catch(() => undefined);

  const currentUrl = page.url();
  const bodyText = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 2_000);
  if (/logon\d*\.gov\.bc\.ca/i.test(currentUrl) || /requires you to login|Log in with|User ID/i.test(bodyText)) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      "BC Registry redirected to login. Finish login in the live browser, then run the filing-history export before saving the profile.",
    );
  }
  if (!/\/filingHistory(?:[/?#]|$)/i.test(currentUrl) && !/Filing\s+Date Filed\s+Details\s+View Documents/i.test(bodyText)) {
    throw new ConnectorActionError(
      422,
      "bc_registry_filing_history_not_detected",
      "The active BC Registry page does not look like a society filing-history page.",
    );
  }
  resultLog.push({
    level: "info",
    step: "detect",
    message: "Detected a BC Registry filing-history page.",
    currentUrl,
    timestampISO: new Date().toISOString(),
  });

  const extracted: any = await page.evaluate(`(async () => {
    const includePdfProbe = ${JSON.stringify(input.includePdfProbe)};
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const slug = (value) => clean(value)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "item";
    const dateSlug = (value) => slug(clean(value).split(" ").slice(0, 3).join(" "));
    const current = new URL(location.href);
    const currentCorpNum = current.pathname.match(/\\/societies\\/([^/]+)\\/filingHistory/)?.[1] ?? "";
    const headingText = [...document.querySelectorAll("h1,h2,h3")]
      .map((element) => clean(element.textContent))
      .find((text) => /society/i.test(text));
    const orgName = headingText ?? clean(document.querySelector("h2")?.textContent);
    const tables = [...document.querySelectorAll("table")];
    const table = document.querySelector("#filings-table")
      ?? tables.find((candidate) => /Filing\\s+Date Filed\\s+Details\\s+View Documents/i.test(clean(candidate.textContent)))
      ?? tables[0];

    const rowsByKey = new Map();
    const readVisibleRows = () => {
      const rowNodes = table
        ? [...table.querySelectorAll("tbody tr")].filter((row) => row.querySelectorAll("td").length >= 4)
        : [];
      for (const row of rowNodes) {
        const cells = [...row.querySelectorAll("td")];
        const filing = clean(cells[0]?.textContent);
        const dateFiled = clean(cells[1]?.textContent);
        const details = clean(cells[2]?.textContent);
        const key = [filing, dateFiled, details].join("::");
        if (filing || dateFiled || details) rowsByKey.set(key, row);
      }
    };

    const jquery = window.jQuery ?? window.$;
    try {
      const dataTable = jquery && table ? jquery(table).DataTable?.() : undefined;
      const pageInfo = dataTable?.page?.info?.();
      if (pageInfo && Number.isFinite(pageInfo.pages)) {
        const originalPage = pageInfo.page ?? 0;
        for (let pageIndex = 0; pageIndex < pageInfo.pages; pageIndex += 1) {
          dataTable.page(pageIndex).draw("page");
          await new Promise((resolve) => setTimeout(resolve, 150));
          readVisibleRows();
        }
        dataTable.page(originalPage).draw("page");
      }
    } catch {
      // Fall through to visible-row pagination.
    }

    if (!rowsByKey.size && table) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        readVisibleRows();
        const controls = [...document.querySelectorAll("a,button")];
        const next = controls.find((candidate) => {
          const text = clean(candidate.textContent);
          const disabled = candidate.closest(".disabled") || candidate.getAttribute("aria-disabled") === "true" || candidate.disabled;
          return !disabled && /^(next|›|>)$/i.test(text);
        });
        if (!next) break;
        next.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const rowNodes = [...rowsByKey.values()];
    const filings = rowNodes
      .map((row, rowIndex) => {
        const cells = [...row.querySelectorAll("td")];
        const filing = clean(cells[0]?.textContent);
        const dateFiled = clean(cells[1]?.textContent);
        const details = clean(cells[2]?.textContent);
        const docCell = cells[3];
        const documents = [...(docCell?.querySelectorAll("a[href]") ?? [])].map((link) => {
          const href = link.getAttribute("href") ?? "";
          const absoluteUrl = new URL(href, location.origin).href;
          const documentUrl = new URL(absoluteUrl);
          const reportName = documentUrl.searchParams.get("reportName") ?? slug(link.textContent);
          const eventId = documentUrl.searchParams.get("eventId") ?? "";
          const endpoint = documentUrl.pathname.split("/").pop() ?? "";
          return {
            name: clean(link.textContent) || reportName,
            reportName,
            eventId,
            endpoint,
            url: absoluteUrl,
            filename: \`\${currentCorpNum}_\${dateSlug(dateFiled)}_\${slug(filing)}_\${slug(reportName)}_\${eventId}.pdf\`,
          };
        });

        return {
          rowIndex,
          filing,
          dateFiled,
          details,
          paperOnly: documents.length === 0 && /paper only/i.test(clean(docCell?.textContent)),
          documentCount: documents.length,
          documents,
        };
      })
      .filter((row) => row.filing || row.dateFiled || row.details || row.paperOnly || row.documents.length > 0);

    const documents = filings.flatMap((filing) =>
      filing.documents.map((document) => ({
        filing: filing.filing,
        dateFiled: filing.dateFiled,
        ...document,
      })),
    );

    let pdfProbe = null;
    if (includePdfProbe && documents[0]) {
      const response = await fetch(documents[0].url, { credentials: "include" });
      const buffer = await response.arrayBuffer();
      pdfProbe = {
        status: response.status,
        contentType: response.headers.get("content-type"),
        byteLength: buffer.byteLength,
        startsWithPdf: new TextDecoder().decode(buffer.slice(0, 8)).startsWith("%PDF"),
        sampleFilename: documents[0].filename,
      };
    }

    const csvRows = [
      [
        "Corp Number",
        "Organization",
        "Filing",
        "Date Filed",
        "Details",
        "Paper Only",
        "Document Name",
        "Report Name",
        "Event ID",
        "Endpoint",
        "URL",
        "Filename",
      ],
      ...filings.flatMap((filing) => (
        filing.documents.length
          ? filing.documents.map((document) => [
            currentCorpNum,
            orgName,
            filing.filing,
            filing.dateFiled,
            filing.details,
            "false",
            document.name,
            document.reportName,
            document.eventId,
            document.endpoint,
            document.url,
            document.filename,
          ])
          : [[
            currentCorpNum,
            orgName,
            filing.filing,
            filing.dateFiled,
            filing.details,
            filing.paperOnly ? "true" : "false",
            "",
            "",
            "",
            "",
            "",
            "",
          ]]
      )),
    ];
    const csv = csvRows
      .map((row) => row.map((value) => \`"\${String(value ?? "").replace(/"/g, '""')}"\`).join(","))
      .join("\\n");

    return {
      currentUrl: location.href,
      title: document.title,
      corpNum: currentCorpNum,
      orgName,
      filingCount: filings.length,
      digitalFilingCount: filings.filter((row) => row.documentCount > 0).length,
      paperOnlyCount: filings.filter((row) => row.paperOnly).length,
      documentCount: documents.length,
      endpoints: [...new Set(documents.map((document) => document.endpoint))].sort(),
      filings,
      documents,
      csv,
      csvFilename: \`\${currentCorpNum || "bc-registry"}_filing_history.csv\`,
      pdfProbe,
    };
  })()`);

  resultLog.push({
    level: "info",
    step: "collect",
    message: "Collected filing-history table rows.",
    filingCount: extracted.filingCount,
    documentCount: extracted.documentCount,
    paperOnlyCount: extracted.paperOnlyCount,
    timestampISO: new Date().toISOString(),
  });

  if (!input.downloadPdfs) {
    return {
      ...extracted,
      resultLog,
    };
  }

  const download = await downloadBcRegistryDocuments(page, extracted);
  resultLog.push({
    level: download.failedCount > 0 ? "warn" : "info",
    step: "download",
    message: "Completed authenticated PDF download pass.",
    downloadedCount: download.downloadedCount,
    failedCount: download.failedCount,
    timestampISO: new Date().toISOString(),
  });
  return {
    ...extracted,
    download,
    resultLog,
  };
}

function safeExportFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file";
}

async function downloadBcRegistryDocuments(page: Page, extracted: any) {
  const exportRoot = process.env.CONNECTOR_EXPORT_DIR ?? "/tmp/societyer-browser-exports";
  const exportPublicRoot = process.env.CONNECTOR_EXPORT_PUBLIC_DIR;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `${safeExportFilename(extracted.corpNum || "bc-registry")}-${stamp}`;
  const exportDirectory = path.join(exportRoot, folderName);
  const pdfDirectory = path.join(exportDirectory, "pdfs");
  await fs.mkdir(pdfDirectory, { recursive: true });

  const csvFilename = safeExportFilename(extracted.csvFilename || "bc-registry_filing_history.csv");
  const csvPath = path.join(exportDirectory, csvFilename);
  await fs.writeFile(csvPath, extracted.csv ?? "", "utf8");

  const files: Array<Record<string, unknown>> = [];

  for (const document of extracted.documents ?? []) {
    const filename = safeExportFilename(String(document.filename ?? `${document.reportName ?? "document"}_${document.eventId ?? ""}.pdf`));
    const filePath = path.join(pdfDirectory, filename);
    try {
      const browserFetch: any = await page.evaluate(`(async () => {
        const response = await fetch(${JSON.stringify(String(document.url))}, {
          credentials: "include",
          headers: { accept: "application/pdf,*/*" },
        });
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
        }
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          byteLength: bytes.byteLength,
          startsWithPdf: new TextDecoder().decode(bytes.slice(0, 8)).startsWith("%PDF"),
          base64: btoa(binary),
        };
      })()`);
      const buffer = Buffer.from(String(browserFetch.base64 ?? ""), "base64");
      if (browserFetch.status < 200 || browserFetch.status >= 300 || !browserFetch.startsWithPdf) {
        files.push({
          status: "error",
          filename,
          url: document.url,
          httpStatus: browserFetch.status,
          contentType: browserFetch.contentType,
          byteLength: browserFetch.byteLength,
          error: browserFetch.startsWithPdf ? `HTTP ${browserFetch.status}` : "Response was not a PDF.",
        });
      } else {
        await fs.writeFile(filePath, buffer);
        files.push({
          status: "ok",
          filename,
          url: document.url,
          httpStatus: browserFetch.status,
          contentType: browserFetch.contentType,
          byteLength: buffer.byteLength,
          filePath,
          publicPath: exportPublicRoot ? path.posix.join(exportPublicRoot, folderName, "pdfs", filename) : undefined,
        });
      }
    } catch (error: any) {
      files.push({
        status: "error",
        filename,
        url: document.url,
        error: error?.message ?? "PDF download failed.",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const downloadedCount = files.filter((file) => file.status === "ok").length;
  const failedCount = files.filter((file) => file.status !== "ok").length;
  return {
    exportRoot,
    exportDirectory,
    exportPublicDirectory: exportPublicRoot ? path.posix.join(exportPublicRoot, folderName) : undefined,
    csvPath,
    csvPublicPath: exportPublicRoot ? path.posix.join(exportPublicRoot, folderName, csvFilename) : undefined,
    pdfDirectory,
    downloadedCount,
    failedCount,
    totalByteLength: files.reduce((sum, file) => sum + Number(file.byteLength ?? 0), 0),
    files,
  };
}

function gcosProjectIdFromUrl(url: string) {
  try {
    return new URL(url).pathname.match(/\/Project\/Project\/(?:Display|Manage|Agreement|Correspondence|ViewDocument)\/([^/?#]+)/i)?.[1];
  } catch {
    return undefined;
  }
}

function gcosProgramCodeFromUrl(url: string) {
  try {
    return new URL(url).pathname.match(/\/OSR\/pro\/([^/?#]+)/i)?.[1];
  } catch {
    return undefined;
  }
}

async function assertGcosAuthenticated(page: Page) {
  const url = page.url();
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (
    /\/auth|gckey|sign-?in|login|credential|banque|bank/i.test(url)
    || /Sign in with GCKey|Sign in with your bank|Welcome to GCKey|session has expired|Start with GCKey/i.test(bodyText)
  ) {
    throw new ConnectorActionError(
      401,
      "reauth_required",
      "GCOS login is not complete or the session expired. Finish login in the live browser, then run the GCOS export again.",
    );
  }
}

async function openGcosPage(page: Page, pathOrUrl: string) {
  const target = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://srv136.services.gc.ca${pathOrUrl}`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await assertGcosAuthenticated(page);
}

async function readGcosPage(page: Page, pathOrUrl: string) {
  await openGcosPage(page, pathOrUrl);
  return await page.evaluate(`(() => {
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const pageText = clean(document.body?.innerText);
    const hidden = {};
    for (const input of document.querySelectorAll("input[type=hidden][name]")) {
      const name = input.getAttribute("name");
      if (name) hidden[name] = input.value ?? "";
    }
    const screenIdentifier = clean(document.querySelector("#screenIdentifier, [name=ScreenIdentifier], [id*=ScreenIdentifier]")?.textContent)
      || hidden.ScreenIdentifier
      || hidden.screenIdentifier
      || "";
    const fields = [];
    const addField = (label, value, name, id) => {
      const normalizedLabel = clean(label).replace(/[:*]+$/, "").trim();
      const normalizedValue = clean(value);
      if (!normalizedLabel || !normalizedValue) return;
      if (/social insurance|\\bSIN\\b|account number|direct deposit|bank/i.test(normalizedLabel)) return;
      fields.push({ label: normalizedLabel, value: normalizedValue, name: name || undefined, id: id || undefined });
    };
    for (const input of document.querySelectorAll("input, textarea, select")) {
      const element = input;
      const type = (element.getAttribute("type") || "").toLowerCase();
      const name = element.getAttribute("name") || "";
      const id = element.getAttribute("id") || "";
      if (type === "hidden" || type === "password" || /sin|accountnumber|bank|directdeposit/i.test(name + " " + id)) continue;
      const label = id ? document.querySelector(\`label[for="\${CSS.escape(id)}"]\`)?.textContent : "";
      let value = "";
      if (element.tagName === "SELECT") {
        value = element.options?.[element.selectedIndex]?.textContent || element.value || "";
      } else if (type === "checkbox" || type === "radio") {
        if (!element.checked) continue;
        value = document.querySelector(\`label[for="\${CSS.escape(id)}"]\`)?.textContent || element.value || "Selected";
      } else {
        value = element.value || "";
      }
      addField(label || name || id, value, name, id);
    }
    for (const row of document.querySelectorAll("dt, th, .control-label, label, strong")) {
      const label = clean(row.textContent);
      const sibling = row.nextElementSibling;
      if (sibling) addField(label, sibling.textContent, undefined, sibling.id || undefined);
    }
    const links = [...document.querySelectorAll("a[href]")].map((link) => ({
      text: clean(link.textContent),
      href: new URL(link.getAttribute("href"), location.origin).href,
    })).filter((link) => link.text || link.href);
    return {
      url: location.href,
      title: document.title,
      screenIdentifier,
      hidden,
      fields,
      links,
      text: pageText.slice(0, 20000),
    };
  })()`);
}

function gcosExtractMoneyCents(value: unknown) {
  const text = String(value ?? "");
  const match = text.replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * 100);
}

function gcosExtractDate(value: unknown) {
  const text = String(value ?? "");
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function gcosFieldValue(pageData: any, patterns: RegExp[]) {
  const fields = Array.isArray(pageData?.fields) ? pageData.fields : [];
  const found = fields.find((field: any) => patterns.some((pattern) => pattern.test(String(field.label ?? ""))));
  return found?.value;
}

function normalizeGcosSnapshot(snapshot: any) {
  const summary = snapshot.summary ?? {};
  const approved = snapshot.approvedJobs ?? {};
  const projectNumber = gcosFieldValue(summary, [/project number/i, /tracking number/i]);
  const title = gcosFieldValue(summary, [/project title/i]) ?? snapshot.project?.title ?? "GCOS project";
  const cfpTitle = gcosFieldValue(summary, [/cfp title/i, /call for proposal/i]) ?? "ESDC GCOS";
  const requested = gcosExtractMoneyCents(gcosFieldValue(summary, [/total contribution.*esdc/i, /amount requested/i, /requested/i]));
  const awarded = gcosExtractMoneyCents(gcosFieldValue(approved, [/total contribution.*esdc/i, /approved/i, /contribution.*esdc/i]));
  const startDate = gcosExtractDate(gcosFieldValue(summary, [/start date/i]));
  const endDate = gcosExtractDate(gcosFieldValue(summary, [/end date/i]));
  return {
    title,
    funder: "Employment and Social Development Canada",
    program: cfpTitle,
    status: /closed/i.test(String(snapshot.project?.status ?? "")) ? "Closed" : /active|agreement|approved/i.test(String(snapshot.project?.status ?? "")) ? "Active" : "Submitted",
    amountRequestedCents: requested,
    amountAwardedCents: awarded,
    startDate,
    endDate,
    confirmationCode: projectNumber,
    sourceExternalIds: [
      snapshot.projectId ? `gcos:project:${snapshot.projectId}` : undefined,
      projectNumber ? `gcos:project-number:${projectNumber}` : undefined,
    ].filter(Boolean),
    opportunityUrl: snapshot.currentUrl,
    keyFacts: [
      projectNumber ? `Project number: ${projectNumber}` : undefined,
      snapshot.projectId ? `GCOS project ID: ${snapshot.projectId}` : undefined,
      snapshot.programCode ? `Program code: ${snapshot.programCode}` : undefined,
      awarded != null && requested != null ? `Approved/requested delta: $${((awarded - requested) / 100).toFixed(2)}` : undefined,
    ].filter(Boolean),
    sourceNotes: "Imported from a read-only GCOS browser connector snapshot. Sensitive employee and banking fields are intentionally excluded.",
  };
}

export async function runGcosExportProjects(page: Page, input: GcosExportProjectsInput) {
  await openGcosPage(page, "/OSR/pro/Project");
  const extracted: any = await page.evaluate(`(() => {
    const clean = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const cards = [...document.querySelectorAll("#containerResult article, #containerResult .panel, #containerResult .card, article, .panel, .card")];
    const containers = cards.length ? cards : [...document.querySelectorAll("tr, li")];
    const seen = new Set();
    const projects = [];
    for (const container of containers) {
      const text = clean(container.textContent);
      const links = [...container.querySelectorAll("a[href]")].map((link) => ({
        text: clean(link.textContent),
        href: new URL(link.getAttribute("href"), location.origin).href,
      }));
      const id = links.map((link) => link.href).join(" ").match(/\\/Project\\/Project\\/(?:Display|Manage|Agreement|Correspondence|ViewDocument)\\/([^/?#]+)/i)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const fields = {};
      for (const line of text.split(/\\n+/).map(clean).filter(Boolean)) {
        const match = line.match(/^([^:]{2,80}):\\s*(.+)$/);
        if (match) fields[clean(match[1])] = clean(match[2]);
      }
      const title = links.find((link) => /display|view application/i.test(link.href + " " + link.text))?.text
        || text.split(/\\n+/).map(clean).filter(Boolean)[0]
        || \`GCOS project \${id}\`;
      const actionUrl = (kind) => links.find((link) => new RegExp(\`/Project/Project/\${kind}/\`, "i").test(link.href))?.href;
      projects.push({
        projectId: id,
        title,
        status: Object.entries(fields).find(([key]) => /status/i.test(key))?.[1],
        trackingNumber: Object.entries(fields).find(([key]) => /tracking|project number/i.test(key))?.[1],
        fields,
        urls: {
          display: actionUrl("Display"),
          manage: actionUrl("Manage"),
          agreement: actionUrl("Agreement"),
          correspondence: actionUrl("Correspondence"),
          documents: actionUrl("ViewDocument"),
        },
        text: text.slice(0, 4000),
      });
    }
    return {
      currentUrl: location.href,
      title: document.title,
      projectCount: projects.length,
      projects,
    };
  })()`);
  if (!extracted.projectCount && /canada\.ca/.test(page.url())) {
    throw new ConnectorActionError(
      401,
      "gcos_project_list_not_open",
      "GCOS did not open the Applications and Projects page. Use the live browser to sign in and open GCOS, then run the export again.",
    );
  }
  return {
    ...extracted,
    resultLog: [{
      level: "info",
      step: "collect",
      message: "Collected GCOS project rows from the authenticated browser page.",
      projectCount: extracted.projectCount,
      timestampISO: new Date().toISOString(),
    }],
  };
}

export async function runGcosProjectSnapshot(page: Page, input: GcosProjectSnapshotInput) {
  const resultLog: Array<Record<string, unknown>> = [];
  const projectId = input.projectId?.trim() || gcosProjectIdFromUrl(page.url());
  if (projectId) {
    await openGcosPage(page, `/OSR/pro/Project/Project/Display/${encodeURIComponent(projectId)}`);
  } else {
    await assertGcosAuthenticated(page);
  }
  const programCode = input.programCode?.trim() || gcosProgramCodeFromUrl(page.url());
  if (!programCode || /^Project|Agreement|DD|EED|DocumentBundle|GCOS$/i.test(programCode)) {
    throw new ConnectorActionError(
      422,
      "gcos_program_not_detected",
      "Open a GCOS project application page or provide projectId/programCode before exporting a project snapshot.",
    );
  }

  resultLog.push({
    level: "info",
    step: "open",
    message: "Opened GCOS project application.",
    projectId,
    programCode,
    currentUrl: page.url(),
    timestampISO: new Date().toISOString(),
  });

  const landing: any = await readGcosPage(page, `/OSR/pro/${encodeURIComponent(programCode)}`);
  const summary: any = await readGcosPage(page, `/OSR/pro/${encodeURIComponent(programCode)}/Summary/Summary`).catch((error: any) => ({
    error: error?.message ?? "Summary page unavailable.",
  }));
  const approvedJobs: any = await readGcosPage(page, `/OSR/pro/${encodeURIComponent(programCode)}/JobDetails/IndexApproved`).catch((error: any) => ({
    error: error?.message ?? "Approved job details unavailable.",
  }));
  const agreement: any = await readGcosPage(page, "/OSR/pro/Agreement").catch((error: any) => ({
    error: error?.message ?? "Agreement page unavailable.",
  }));
  const correspondence: any = await readGcosPage(page, "/OSR/pro/Project/Correspondence").catch((error: any) => ({
    error: error?.message ?? "Correspondence page unavailable.",
  }));
  const eed: any = await readGcosPage(page, "/OSR/pro/EED").catch((error: any) => ({
    error: error?.message ?? "EED page unavailable.",
  }));
  const documents: any = await readGcosPage(page, "/OSR/pro/DocumentBundle").catch((error: any) => ({
    error: error?.message ?? "Supporting documents page unavailable.",
  }));

  const agreementLinks = Array.isArray(agreement?.links)
    ? agreement.links.filter((link: any) => /OpenDocument\/\d+/i.test(String(link.href)) && /IsAgreement=True/i.test(String(link.href)))
    : [];
  const correspondenceLinks = Array.isArray(correspondence?.links)
    ? correspondence.links.filter((link: any) => /ViewCorrespondence\/\d+/i.test(String(link.href)))
    : [];
  const correspondenceBodies = [];
  for (const link of correspondenceLinks.slice(0, 20)) {
    correspondenceBodies.push(await readGcosPage(page, link.href).catch((error: any) => ({
      url: link.href,
      error: error?.message ?? "Correspondence body unavailable.",
    })));
  }

  const downloadedAgreementPdfs = input.includeAgreementPdfs
    ? await downloadGcosAgreementDocuments(page, agreementLinks)
    : undefined;

  const snapshot = {
    projectId,
    programCode,
    currentUrl: page.url(),
    exportedAtISO: new Date().toISOString(),
    project: {
      title: gcosFieldValue(summary, [/project title/i]) ?? gcosFieldValue(landing, [/project title/i]),
      status: gcosFieldValue(landing, [/status/i]),
    },
    landing,
    summary,
    approvedJobs,
    agreement: {
      ...agreement,
      agreementLinks,
      downloadedAgreementPdfs,
    },
    correspondence: {
      ...correspondence,
      viewLinks: correspondenceLinks,
      bodies: correspondenceBodies,
    },
    eed,
    documents,
  };

  resultLog.push({
    level: "info",
    step: "collect",
    message: "Collected GCOS project snapshot pages.",
    agreementCount: agreementLinks.length,
    correspondenceCount: correspondenceLinks.length,
    timestampISO: new Date().toISOString(),
  });

  return {
    ...snapshot,
    normalizedGrant: normalizeGcosSnapshot(snapshot),
    resultLog,
  };
}

async function downloadGcosAgreementDocuments(page: Page, links: Array<{ href: string; text?: string }>) {
  const exportRoot = process.env.CONNECTOR_EXPORT_DIR ?? "/tmp/societyer-browser-exports";
  const exportPublicRoot = process.env.CONNECTOR_EXPORT_PUBLIC_DIR;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `gcos-agreements-${stamp}`;
  const exportDirectory = path.join(exportRoot, folderName);
  await fs.mkdir(exportDirectory, { recursive: true });
  const files = [];
  for (const link of links) {
    const documentId = String(link.href).match(/OpenDocument\/(\d+)/i)?.[1] ?? "agreement";
    const filename = safeExportFilename(`gcos_agreement_${documentId}.pdf`);
    const filePath = path.join(exportDirectory, filename);
    try {
      const browserFetch: any = await page.evaluate(`(async () => {
        const response = await fetch(${JSON.stringify(link.href)}, {
          credentials: "include",
          headers: { accept: "application/pdf,application/octet-stream,*/*" },
        });
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
        }
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          byteLength: bytes.byteLength,
          startsWithPdf: new TextDecoder().decode(bytes.slice(0, 8)).startsWith("%PDF"),
          base64: btoa(binary),
        };
      })()`);
      if (!browserFetch.startsWithPdf) {
        throw new Error(`Agreement download did not return a PDF (${browserFetch.contentType ?? "unknown content type"}).`);
      }
      await fs.writeFile(filePath, Buffer.from(browserFetch.base64, "base64"));
      files.push({
        status: "ok",
        documentId,
        filename,
        path: filePath,
        publicPath: exportPublicRoot ? path.posix.join(exportPublicRoot, folderName, filename) : undefined,
        byteLength: browserFetch.byteLength,
        contentType: browserFetch.contentType,
      });
    } catch (error: any) {
      files.push({
        status: "error",
        documentId,
        filename,
        url: link.href,
        error: error?.message ?? "Agreement PDF download failed.",
      });
    }
  }
  return {
    exportDirectory,
    exportPublicDirectory: exportPublicRoot ? path.posix.join(exportPublicRoot, folderName) : undefined,
    downloadedCount: files.filter((file) => file.status === "ok").length,
    failedCount: files.filter((file) => file.status !== "ok").length,
    files,
  };
}

export const connectorProviders: ConnectorProvider[] = [
  {
    manifest: WAVE_CONNECTOR,
    verifyAuth: (page) => verifyWaveAuth(page),
    authIncompleteMessage: () => "Wave login is not complete. Keep the live browser open, finish login, then confirm again.",
    actions: {
      listTransactions: {
        inputSchema: waveListTransactionsSchema,
        activeInputSchema: activeWaveListTransactionsSchema,
        run: runWaveTransactionsAction,
      },
      importTransactions: {
        inputSchema: waveListTransactionsSchema,
        activeInputSchema: activeWaveListTransactionsSchema,
        run: runWaveTransactionsAction,
      },
    },
  },
  {
    manifest: BC_REGISTRY_CONNECTOR,
    actions: {
      filingHistoryExport: {
        inputSchema: bcRegistryFilingHistoryProfileSchema,
        activeInputSchema: bcRegistryFilingHistorySchema,
        run: (page, input) => runBcRegistryFilingHistoryExport(page, input),
      },
    },
  },
  {
    manifest: GCOS_CONNECTOR,
    actions: {
      exportProjects: {
        inputSchema: gcosExportProjectsProfileSchema,
        activeInputSchema: gcosExportProjectsSchema,
        run: (page, input) => runGcosExportProjects(page, input),
      },
      exportProjectSnapshot: {
        inputSchema: gcosProjectSnapshotProfileSchema,
        activeInputSchema: gcosProjectSnapshotSchema,
        run: (page, input) => runGcosProjectSnapshot(page, input),
      },
    },
  },
];

export function getConnectorProvider(connectorId: string) {
  return connectorProviders.find((provider) => provider.manifest.id === connectorId);
}

export function requireConnectorProvider(connectorId: string) {
  const provider = getConnectorProvider(connectorId);
  if (!provider) {
    throw new ConnectorActionError(404, "connector_not_found", `Connector "${connectorId}" is not registered.`);
  }
  return provider;
}

export function requireConnectorAction(connectorId: string, actionId: string) {
  const provider = requireConnectorProvider(connectorId);
  const action = provider.actions[actionId];
  if (!action) {
    throw new ConnectorActionError(404, "connector_action_not_found", `Action "${actionId}" is not registered for ${connectorId}.`);
  }
  return action;
}

export function parseConnectorActionInput(connectorId: string, actionId: string, mode: ConnectorActionMode, body: unknown) {
  const action = requireConnectorAction(connectorId, actionId);
  const schema = mode === "session" ? action.activeInputSchema ?? action.inputSchema : action.inputSchema;
  return schema.parse(body);
}

export async function runConnectorAction(
  page: Page,
  connectorId: string,
  actionId: string,
  mode: ConnectorActionMode,
  input: unknown,
  profileKey: string,
) {
  const provider = requireConnectorProvider(connectorId);
  const action = requireConnectorAction(connectorId, actionId);
  return action.run(page, input, {
    connector: provider.manifest,
    actionId,
    mode,
    profileKey,
  });
}

export function requireKnownConnector(connectorId: string) {
  const connector = getConnectorManifest(connectorId);
  if (!connector) {
    throw new ConnectorActionError(404, "connector_not_found", `Connector "${connectorId}" is not registered.`);
  }
  return connector;
}
