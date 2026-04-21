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
];

export function getConnectorManifest(connectorId: string) {
  return connectors.find((connector) => connector.id === connectorId);
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

export type ActiveWaveListTransactionsInput = z.infer<typeof activeWaveListTransactionsSchema> & {
  businessId: string;
};

export const bcRegistryFilingHistorySchema = z.object({
  corpNum: z.string().min(1).optional(),
  url: z.string().url().optional(),
  includePdfProbe: z.boolean().default(false),
  downloadPdfs: z.boolean().default(false),
});

export type BcRegistryFilingHistoryInput = z.infer<typeof bcRegistryFilingHistorySchema>;

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

const WAVE_CONNECTOR = connectors[0];
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

function bcRegistryCorpNumFromUrl(url: string) {
  try {
    return new URL(url).pathname.match(/\/societies\/([^/]+)(?:\/|$)/)?.[1];
  } catch {
    return undefined;
  }
}

export async function runBcRegistryFilingHistoryExport(page: Page, input: BcRegistryFilingHistoryInput) {
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

  if (!input.downloadPdfs) return extracted;

  const download = await downloadBcRegistryDocuments(page, extracted);
  return {
    ...extracted,
    download,
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

export function requireKnownConnector(connectorId: string) {
  const connector = getConnectorManifest(connectorId);
  if (!connector) {
    throw new ConnectorActionError(404, "connector_not_found", `Connector "${connectorId}" is not registered.`);
  }
  return connector;
}
