type LedgerSmbAccountLike = {
  id?: string | number;
  chart_id?: string | number;
  accno?: string | number;
  account_number?: string | number;
  description?: string;
  label?: string;
  category?: string;
  type?: string;
  normal_balance?: string;
};

export type LedgerSmbConnectionConfig = {
  baseUrl?: string;
  database?: string;
  username?: string;
  password?: string;
  apiKey?: string;
};

type LedgerSmbJournalEntryLike = {
  id?: string | number;
  reference?: string;
  description?: string;
  memo?: string;
  transdate?: string;
  transaction_date?: string;
  approved?: boolean;
  lines?: LedgerSmbJournalLineLike[];
};

type LedgerSmbJournalLineLike = {
  id?: string | number;
  account_id?: string | number;
  chart_id?: string | number;
  accno?: string | number;
  description?: string;
  debit?: string | number;
  credit?: string | number;
  amount?: string | number;
};

export type LedgerSmbClient = {
  listAccounts(): Promise<ReturnType<typeof normalizeLedgerSmbAccount>[]>;
  listJournalEntries(args?: { sinceISO?: string }): Promise<ReturnType<typeof normalizeLedgerSmbJournalEntry>[]>;
  get<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
};

export function ledgerSmbEnvConfig(): LedgerSmbConnectionConfig {
  return {
    baseUrl: env("LEDGERSMB_BASE_URL"),
    database: env("LEDGERSMB_DATABASE"),
    username: env("LEDGERSMB_USERNAME"),
    password: env("LEDGERSMB_PASSWORD"),
    apiKey: env("LEDGERSMB_API_KEY"),
  };
}

export function ledgerSmbEnvironmentStatus() {
  const config = ledgerSmbEnvConfig();
  return [
    { name: "LEDGERSMB_BASE_URL", configured: Boolean(config.baseUrl), purpose: "LedgerSMB API base URL" },
    { name: "LEDGERSMB_DATABASE", configured: Boolean(config.database), purpose: "LedgerSMB company/database selector" },
    { name: "LEDGERSMB_USERNAME", configured: Boolean(config.username), purpose: "LedgerSMB basic-auth username" },
    { name: "LEDGERSMB_PASSWORD", configured: Boolean(config.password), purpose: "LedgerSMB basic-auth password" },
    { name: "LEDGERSMB_API_KEY", configured: Boolean(config.apiKey), purpose: "LedgerSMB bearer/API token" },
  ];
}

export function createLedgerSmbClient(config: LedgerSmbConnectionConfig = ledgerSmbEnvConfig()): LedgerSmbClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) throw new Error("LedgerSMB sync requires LEDGERSMB_BASE_URL.");

  async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), `${baseUrl}/`);
    if (config.database) url.searchParams.set("database", config.database);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: "GET",
      headers: ledgerSmbHeaders(config),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim();
      throw new Error(redactLedgerSmbDiagnostic(detail || `LedgerSMB request failed with status ${response.status}.`, config));
    }
    return (await response.json()) as T;
  }

  return {
    get: request,
    async listAccounts() {
      const rows = await request<any[]>("/api/accounts");
      return arrayOf(rows).map(normalizeLedgerSmbAccount);
    },
    async listJournalEntries(args?: { sinceISO?: string }) {
      const rows = await request<any[]>("/api/journal-entries", { since: args?.sinceISO });
      return arrayOf(rows).map(normalizeLedgerSmbJournalEntry);
    },
  };
}

export function ledgerSmbAccountMappingCandidate(row: ReturnType<typeof normalizeLedgerSmbAccount>) {
  return {
    provider: "ledgersmb",
    externalAccountId: row.externalId,
    externalAccountCode: row.code,
    externalAccountName: row.name,
    externalCategory: row.accountType,
    confidence: row.externalId || row.code ? "high" : "medium",
    notes: row.subtype,
  };
}

export function normalizeLedgerSmbAccount(row: LedgerSmbAccountLike) {
  const category = String(row.category ?? row.type ?? "").toUpperCase();
  const accountType =
    category.includes("A") || category.includes("ASSET")
      ? "Asset"
      : category.includes("L") || category.includes("LIAB")
        ? "Liability"
        : category.includes("Q") || category.includes("EQUITY")
          ? "Equity"
          : category.includes("I") || category.includes("INCOME")
            ? "Income"
            : category.includes("E") || category.includes("EXPENSE")
              ? "Expense"
              : "Asset";
  return {
    externalId: String(row.id ?? row.chart_id ?? row.accno ?? row.account_number ?? ""),
    code: String(row.accno ?? row.account_number ?? ""),
    name: String(row.description ?? row.label ?? row.accno ?? "LedgerSMB account"),
    accountType,
    subtype: category.toLowerCase() || undefined,
    normalBalance: normalizeNormalBalance(row.normal_balance, accountType),
    sourceSystem: "ledgersmb",
  };
}

export function normalizeLedgerSmbJournalEntry(row: LedgerSmbJournalEntryLike) {
  return {
    sourceExternalId: String(row.id ?? row.reference ?? ""),
    reference: row.reference ? String(row.reference) : undefined,
    date: String(row.transdate ?? row.transaction_date ?? ""),
    memo: String(row.description ?? row.memo ?? row.reference ?? "LedgerSMB journal entry"),
    source: "ledgersmb",
    status: row.approved === false ? "draft" : "posted",
    rawJson: JSON.stringify(row),
    lines: (row.lines ?? []).map(normalizeLedgerSmbJournalLine),
  };
}

export function normalizeLedgerSmbJournalLine(row: LedgerSmbJournalLineLike) {
  const debitCents = moneyToCents(row.debit);
  const creditCents = moneyToCents(row.credit);
  const amountCents = debitCents || creditCents || Math.abs(moneyToCents(row.amount));
  return {
    sourceExternalId: row.id != null ? String(row.id) : undefined,
    accountExternalId: String(row.account_id ?? row.chart_id ?? row.accno ?? ""),
    accountCode: row.accno != null ? String(row.accno) : undefined,
    description: row.description ? String(row.description) : undefined,
    side: debitCents > 0 ? "debit" : "credit",
    amountCents,
    rawJson: JSON.stringify(row),
  };
}

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value?: string) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function ledgerSmbHeaders(config: LedgerSmbConnectionConfig) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (!config.apiKey && config.username && config.password) {
    const encoded = btoa(`${config.username}:${config.password}`);
    headers.Authorization = `Basic ${encoded}`;
  }
  return headers;
}

function redactLedgerSmbDiagnostic(input: string, config: LedgerSmbConnectionConfig) {
  let output = input;
  for (const secret of [config.password, config.apiKey].filter(Boolean) as string[]) {
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

function arrayOf(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeNormalBalance(value: unknown, accountType: string) {
  const text = String(value ?? "").toLowerCase();
  if (text === "debit" || text === "credit") return text;
  return accountType === "Asset" || accountType === "Expense" ? "debit" : "credit";
}

function moneyToCents(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}
