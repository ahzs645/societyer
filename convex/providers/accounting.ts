// Accounting adapter — Wave in live mode, demo-seeded data otherwise.
// Wave's API is GraphQL; the live branch is a clearly marked stub.
import { providers } from "./env";

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

export async function waveListAccounts(): Promise<{ provider: "wave" | "demo"; accounts: WaveAccount[] }> {
  const p = providers.accounting();
  if (p.id === "demo") return { provider: "demo", accounts: DEMO_ACCOUNTS };
  throw new Error("Live Wave sync requires WAVE_ACCESS_TOKEN + WAVE_BUSINESS_ID and a GraphQL action.");
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
  throw new Error("Live Wave sync requires WAVE_ACCESS_TOKEN + WAVE_BUSINESS_ID and a GraphQL action.");
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
