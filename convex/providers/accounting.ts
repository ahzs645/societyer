// Accounting adapter — Wave in live mode, demo-seeded data otherwise.
import { providers } from "./env";
import { redactWaveDiagnostic, waveGraphQLEndpoint } from "./waveDiagnostics";

export type WaveAccount = {
  externalId: string;
  name: string;
  currency: string;
  accountType: "Bank" | "Credit" | "Income" | "Expense" | "Asset" | "Liability" | "Equity";
  balanceCents: number;
  isRestricted: boolean;
  restrictedPurpose?: string;
};

export type WaveTransaction = {
  externalId: string;
  accountExternalId: string;
  date: string;
  description: string;
  amountCents: number;
  category?: string;
  counterparty?: string;
};

const DEMO_ACCOUNTS: WaveAccount[] = [
  { externalId: "acc_chk_01", name: "Operating Chequing (RBC)", currency: "CAD", accountType: "Bank", balanceCents: 8_421_75, isRestricted: false },
  { externalId: "acc_sav_01", name: "Reserve Savings", currency: "CAD", accountType: "Bank", balanceCents: 54_300_00, isRestricted: false },
  { externalId: "acc_arts_01", name: "Arts Programming (restricted)", currency: "CAD", accountType: "Bank", balanceCents: 42_180_50, isRestricted: true, restrictedPurpose: "VanCity arts grant — programming only" },
  { externalId: "acc_food_01", name: "Food Security (restricted)", currency: "CAD", accountType: "Bank", balanceCents: 12_640_25, isRestricted: true, restrictedPurpose: "United Way pantry grant" },
  { externalId: "acc_inc_donations", name: "Donations & fundraising", currency: "CAD", accountType: "Income", balanceCents: 62_810_00, isRestricted: false },
  { externalId: "acc_inc_programs", name: "Program fees", currency: "CAD", accountType: "Income", balanceCents: 18_430_00, isRestricted: false },
  { externalId: "acc_exp_wages", name: "Wages & benefits", currency: "CAD", accountType: "Expense", balanceCents: 48_200_00, isRestricted: false },
  { externalId: "acc_exp_facilities", name: "Facilities & utilities", currency: "CAD", accountType: "Expense", balanceCents: 13_410_00, isRestricted: false },
  { externalId: "acc_exp_programs", name: "Program supplies", currency: "CAD", accountType: "Expense", balanceCents: 9_280_00, isRestricted: false },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DEMO_TX: WaveTransaction[] = [
  { externalId: "tx_1001", accountExternalId: "acc_chk_01", date: daysAgo(2), description: "BCHydro — Hall utilities", amountCents: -412_80, category: "Facilities & utilities", counterparty: "BC Hydro" },
  { externalId: "tx_1002", accountExternalId: "acc_chk_01", date: daysAgo(3), description: "Payroll run (biweekly)", amountCents: -8_140_00, category: "Wages & benefits" },
  { externalId: "tx_1003", accountExternalId: "acc_chk_01", date: daysAgo(5), description: "Donation — Monthly donor batch", amountCents: 2_640_00, category: "Donations & fundraising" },
  { externalId: "tx_1004", accountExternalId: "acc_arts_01", date: daysAgo(7), description: "Youth art supplies", amountCents: -612_40, category: "Program supplies" },
  { externalId: "tx_1005", accountExternalId: "acc_sav_01", date: daysAgo(10), description: "Transfer from operating", amountCents: 5_000_00 },
  { externalId: "tx_1006", accountExternalId: "acc_chk_01", date: daysAgo(12), description: "Program fees — spring session", amountCents: 1_840_00, category: "Program fees" },
  { externalId: "tx_1007", accountExternalId: "acc_food_01", date: daysAgo(14), description: "Neighbourhood pantry restock", amountCents: -840_10, category: "Program supplies" },
  { externalId: "tx_1008", accountExternalId: "acc_chk_01", date: daysAgo(18), description: "Insurance premium", amountCents: -1_280_00, category: "Facilities & utilities", counterparty: "Co-operators" },
  { externalId: "tx_1009", accountExternalId: "acc_chk_01", date: daysAgo(22), description: "Grant disbursement — VanCity arts", amountCents: 15_000_00, category: "Donations & fundraising", counterparty: "VanCity Foundation" },
  { externalId: "tx_1010", accountExternalId: "acc_chk_01", date: daysAgo(25), description: "Staff laptops (2)", amountCents: -2_240_00, category: "Facilities & utilities" },
];

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

async function waveGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const endpoint = waveGraphQLEndpoint();
  const token = env("WAVE_ACCESS_TOKEN");
  if (!token) {
    throw new Error("Live Wave sync requires WAVE_ACCESS_TOKEN.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(redactWaveDiagnostic(detail || `Wave request failed with status ${response.status}.`, variableStrings(variables)));
  }

  const data = await response.json();
  if ((data as any)?.errors?.length) {
    throw new Error(redactWaveDiagnostic((data as any).errors.map((row: any) => row.message).join("; "), variableStrings(variables)));
  }
  return (data as any).data as T;
}

function variableStrings(variables: Record<string, unknown>) {
  return Object.values(variables).filter((value): value is string => typeof value === "string");
}

export async function waveListAccounts(): Promise<{ provider: "wave" | "demo"; accounts: WaveAccount[] }> {
  const p = providers.accounting();
  if (p.id === "demo") return { provider: "demo", accounts: DEMO_ACCOUNTS };
  const businessId = env("WAVE_BUSINESS_ID");
  if (!businessId) {
    throw new Error("Live Wave sync requires WAVE_BUSINESS_ID.");
  }

  const query = `
    query($businessId: ID!, $page: Int!, $pageSize: Int!) {
      business(id: $businessId) {
        accounts(page: $page, pageSize: $pageSize) {
          pageInfo {
            currentPage
            totalPages
          }
          edges {
            node {
              id
              name
              type {
                value
              }
              subtype {
                value
              }
              balance
              balanceInBusinessCurrency
              normalBalanceType
              isArchived
            }
          }
        }
      }
    }
  `;

  const rows: WaveAccount[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await waveGraphQL<any>(query, { businessId, page, pageSize: 100 });
    const connection = data?.business?.accounts;
    totalPages = connection?.pageInfo?.totalPages ?? page;
    for (const edge of connection?.edges ?? []) {
      const node = edge?.node;
      if (!node || node.isArchived) continue;
      rows.push({
        externalId: node.id,
        name: node.name,
        currency: "CAD",
        accountType:
          node.type?.value === "BANK"
            ? "Bank"
            : node.type?.value === "CREDIT_CARD"
            ? "Credit"
            : node.type?.value === "INCOME"
            ? "Income"
            : node.type?.value === "EXPENSE"
            ? "Expense"
            : "Asset",
        balanceCents: Math.round(
          Number(node.balanceInBusinessCurrency ?? node.balance ?? 0) * 100,
        ),
        isRestricted: /grant|restricted|deferred/i.test(`${node.name} ${node.subtype?.value ?? ""}`),
        restrictedPurpose: /grant|restricted/i.test(node.name) ? node.name : undefined,
      });
    }
    page += 1;
  } while (page <= totalPages);

  return { provider: "wave", accounts: rows };
}

export async function waveListTransactions(args?: {
  sinceISO?: string;
}): Promise<{ provider: "wave" | "demo"; transactions: WaveTransaction[] }> {
  const p = providers.accounting();
  if (p.id === "demo") {
    const filtered = args?.sinceISO
      ? DEMO_TX.filter((t) => t.date >= args!.sinceISO!)
      : DEMO_TX;
    return { provider: "demo", transactions: filtered };
  }
  const businessId = env("WAVE_BUSINESS_ID");
  if (!businessId) {
    throw new Error("Live Wave sync requires WAVE_BUSINESS_ID.");
  }

  const query = `
    query($businessId: ID!, $page: Int!, $pageSize: Int!) {
      business(id: $businessId) {
        invoices(page: $page, pageSize: $pageSize) {
          pageInfo {
            currentPage
            totalPages
          }
          edges {
            node {
              id
              title
              invoiceDate
              status
              customer {
                name
              }
              total {
                value
              }
              amountPaid {
                value
              }
              items {
                account {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const rows: WaveTransaction[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await waveGraphQL<any>(query, { businessId, page, pageSize: 100 });
    const connection = data?.business?.invoices;
    totalPages = connection?.pageInfo?.totalPages ?? page;
    for (const edge of connection?.edges ?? []) {
      const node = edge?.node;
      if (!node?.invoiceDate) continue;
      if (args?.sinceISO && node.invoiceDate < args.sinceISO) continue;
      const paidValue = Number(node.amountPaid?.value ?? node.total?.value ?? 0);
      rows.push({
        externalId: node.id,
        accountExternalId: node.items?.[0]?.account?.id ?? "wave-income",
        date: node.invoiceDate,
        description: node.title || `Invoice ${node.id}`,
        amountCents: Math.round(paidValue * 100),
        category: node.items?.[0]?.account?.name ?? "Invoice",
        counterparty: node.customer?.name,
      });
    }
    page += 1;
  } while (page <= totalPages);

  return { provider: "wave", transactions: rows };
}

export function waveOAuthUrl(args: { redirectUri: string; state: string }): string {
  // Wave's OAuth endpoint. This URL is used as a deep link from the Connect
  // screen. In demo mode the UI short-circuits back to itself instead of
  // bouncing through Wave.
  const p = providers.accounting();
  if (p.id === "demo") return `#demo-wave-oauth?state=${encodeURIComponent(args.state)}`;
  const clientId = (globalThis as any).process?.env?.WAVE_CLIENT_ID ?? "missing";
  const scope = "business:read account:read transaction:read";
  return `https://api.waveapps.com/oauth2/authorize/?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(args.redirectUri)}&state=${encodeURIComponent(args.state)}`;
}
