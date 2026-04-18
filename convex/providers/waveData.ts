// Wave data explorer adapter. This intentionally stores Wave payloads as
// resource snapshots so the app can inspect data shapes without pretending
// every Wave object is a financial transaction.
import {
  redactWaveDiagnostic,
  waveEnvironmentStatus,
  waveEnv,
  waveGraphQLEndpoint,
} from "./waveDiagnostics";

type WaveResourceType =
  | "availableBusiness"
  | "business"
  | "account"
  | "vendor"
  | "customer"
  | "product"
  | "invoice"
  | "estimate"
  | "salesTax";

export type WaveSnapshotResource = {
  resourceType: WaveResourceType;
  externalId?: string;
  label: string;
  secondaryLabel?: string;
  typeValue?: string;
  subtypeValue?: string;
  status?: string;
  currencyCode?: string;
  amountValue?: string;
  dateValue?: string;
  searchText: string;
  rawJson: string;
};

export type WaveSnapshotStructure = {
  typeName: string;
  kind: string;
  fieldCount: number;
  fieldsJson: string;
  rawJson: string;
};

export type WaveSnapshotPayload = {
  provider: "wave";
  businessId: string;
  businessName: string;
  currencyCode?: string;
  fetchedAtISO: string;
  resourceCounts: Record<string, number>;
  resources: WaveSnapshotResource[];
  structures: WaveSnapshotStructure[];
};

type WaveHealthStepStatus = "pass" | "warn" | "fail" | "skip";

export type WaveHealthStep = {
  id: string;
  label: string;
  status: WaveHealthStepStatus;
  message: string;
  detail?: Record<string, string | number | boolean | undefined>;
};

export type WaveHealthCheckResult = {
  provider: "wave";
  mode: "live" | "not_configured";
  ok: boolean;
  status: "pass" | "warn" | "fail";
  checkedAtISO: string;
  env: ReturnType<typeof waveEnvironmentStatus>;
  business?: {
    source: "env" | "argument" | "firstAccessible";
    name?: string;
    currencyCode?: string;
  };
  steps: WaveHealthStep[];
};

const PAGE_SIZE = 100;

const STRUCTURE_TYPES = [
  "Query",
  "Mutation",
  "Business",
  "BusinessConnection",
  "Account",
  "AccountType",
  "AccountSubtype",
  "Vendor",
  "VendorConnection",
  "Customer",
  "CustomerConnection",
  "Product",
  "ProductConnection",
  "Invoice",
  "InvoiceConnection",
  "InvoicePayment",
  "AREstimate",
  "AREstimateConnection",
  "SalesTax",
  "SalesTaxConnection",
  "Money",
  "Currency",
  "Address",
  "Transaction",
  "MoneyTransactionCreateInput",
  "MoneyTransactionsCreateInput",
];

async function waveGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = waveEnv("WAVE_ACCESS_TOKEN");
  if (!token) {
    throw new Error("Wave data cache requires WAVE_ACCESS_TOKEN.");
  }

  const response = await fetch(waveGraphQLEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail = payload?.errors?.map((row: any) => row.message).join("; ") || text.trim();
    throw new Error(redactWaveDiagnostic(detail || `Wave request failed with status ${response.status}.`, variableStrings(variables)));
  }

  if (payload?.errors?.length) {
    throw new Error(redactWaveDiagnostic(payload.errors.map((row: any) => row.message).join("; "), variableStrings(variables)));
  }

  return payload.data as T;
}

export async function waveFetchSnapshot(args?: { businessId?: string }): Promise<WaveSnapshotPayload> {
  if (!waveEnv("WAVE_ACCESS_TOKEN")) {
    return demoWaveSnapshot(args?.businessId ?? waveEnv("WAVE_BUSINESS_ID"));
  }

  const businesses = await waveListBusinesses();
  const businessId = args?.businessId ?? waveEnv("WAVE_BUSINESS_ID") ?? businesses[0]?.id;
  if (!businessId) {
    throw new Error("Wave data cache requires WAVE_BUSINESS_ID or at least one accessible Wave business.");
  }

  const [
    business,
    accounts,
    vendors,
    customers,
    products,
    invoices,
    estimates,
    salesTaxes,
    structures,
  ] = await Promise.all([
    waveBusiness(businessId),
    waveConnection(businessId, "accounts", ACCOUNT_CONNECTION_QUERY),
    waveConnection(businessId, "vendors", VENDOR_CONNECTION_QUERY),
    waveConnection(businessId, "customers", CUSTOMER_CONNECTION_QUERY),
    waveConnection(businessId, "products", PRODUCT_CONNECTION_QUERY),
    waveConnection(businessId, "invoices", INVOICE_CONNECTION_QUERY),
    waveConnection(businessId, "estimates", ESTIMATE_CONNECTION_QUERY),
    waveConnection(businessId, "salesTaxes", SALES_TAX_CONNECTION_QUERY),
    waveStructures(),
  ]);

  const resources: WaveSnapshotResource[] = [
    ...businesses.map((row) => resource("availableBusiness", row, {
      label: row.name,
      secondaryLabel: row.currency?.code,
      status: row.isArchived ? "archived" : "active",
      currencyCode: row.currency?.code,
      dateValue: row.modifiedAt ?? row.createdAt,
    })),
    resource("business", business, {
      label: business.name,
      secondaryLabel: business.currency?.code,
      status: business.isArchived ? "archived" : "active",
      currencyCode: business.currency?.code,
      dateValue: business.modifiedAt ?? business.createdAt,
    }),
    ...accounts.map((row: any) => resource("account", row, {
      label: row.name,
      secondaryLabel: [row.type?.value, row.subtype?.value].filter(Boolean).join(" / "),
      typeValue: row.type?.value,
      subtypeValue: row.subtype?.value,
      status: row.isArchived ? "archived" : "active",
      currencyCode: row.currency?.code,
      amountValue: row.balanceInBusinessCurrency ?? row.balance,
    })),
    ...vendors.map((row: any) => resource("vendor", row, {
      label: row.name,
      secondaryLabel: row.email ?? row.displayId,
      status: row.isArchived ? "archived" : "active",
      currencyCode: row.currency?.code,
      dateValue: row.modifiedAt ?? row.createdAt,
    })),
    ...customers.map((row: any) => resource("customer", row, {
      label: row.name,
      secondaryLabel: row.email ?? row.displayId,
      status: row.isArchived ? "archived" : "active",
      currencyCode: row.currency?.code,
      amountValue: row.outstandingAmount?.value,
      dateValue: row.modifiedAt ?? row.createdAt,
    })),
    ...products.map((row: any) => resource("product", row, {
      label: row.name,
      secondaryLabel: row.description,
      status: row.isArchived ? "archived" : row.isSold && row.isBought ? "sold+bought" : row.isSold ? "sold" : row.isBought ? "bought" : "inactive",
      amountValue: row.unitPrice,
      dateValue: row.modifiedAt ?? row.createdAt,
    })),
    ...invoices.map((row: any) => resource("invoice", row, {
      label: row.invoiceNumber ?? row.title,
      secondaryLabel: row.customer?.name ?? row.title,
      status: row.status,
      currencyCode: row.currency?.code,
      amountValue: row.total?.value,
      dateValue: row.invoiceDate,
    })),
    ...estimates.map((row: any) => resource("estimate", row, {
      label: row.estimateNumber ?? row.title,
      secondaryLabel: row.customer?.name ?? row.title,
      status: row.status,
      currencyCode: row.currency?.code,
      amountValue: row.total?.value,
      dateValue: row.estimateDate,
    })),
    ...salesTaxes.map((row: any) => resource("salesTax", row, {
      label: row.name,
      secondaryLabel: row.abbreviation,
      status: row.isArchived ? "archived" : "active",
      dateValue: row.modifiedAt ?? row.createdAt,
    })),
  ];

  const resourceCounts: Record<string, number> = {};
  for (const row of resources) {
    resourceCounts[row.resourceType] = (resourceCounts[row.resourceType] ?? 0) + 1;
  }

  return {
    provider: "wave",
    businessId,
    businessName: business.name,
    currencyCode: business.currency?.code,
    fetchedAtISO: new Date().toISOString(),
    resourceCounts,
    resources,
    structures,
  };
}

function demoWaveSnapshot(businessId = "demo_wave_business"): WaveSnapshotPayload {
  const business = {
    id: businessId,
    name: "Riverside demo book",
    currency: { code: "CAD", symbol: "$", name: "Canadian Dollar" },
    timezone: "America/Vancouver",
    isArchived: false,
  };
  const accounts = [
    {
      id: "demo_operating",
      name: "Operating chequing",
      type: { value: "ASSET", name: "Asset" },
      subtype: { value: "CASH_AND_BANK", name: "Cash and Bank" },
      balanceInBusinessCurrency: "34900.00",
      currency: { code: "CAD" },
    },
    {
      id: "demo_grant",
      name: "Neighbourhood grant fund",
      type: { value: "ASSET", name: "Asset" },
      subtype: { value: "CASH_AND_BANK", name: "Cash and Bank" },
      balanceInBusinessCurrency: "27500.00",
      currency: { code: "CAD" },
    },
  ];
  const vendors = [
    { id: "demo_vendor_print", name: "Harbour Print Co.", email: "print@example.org", isArchived: false },
    { id: "demo_vendor_facilities", name: "City Facilities", email: "facilities@example.org", isArchived: false },
  ];
  const products = [
    { id: "demo_product_hall", name: "Hall rental", isBought: true, isSold: false, unitPrice: "420.00" },
    { id: "demo_product_program", name: "Program fee", isBought: false, isSold: true, unitPrice: "25.00" },
  ];
  const invoices = [
    {
      id: "demo_invoice_1001",
      invoiceNumber: "INV-1001",
      title: "Monthly program fees",
      status: "PAID",
      invoiceDate: new Date().toISOString().slice(0, 10),
      total: { value: "840.00", currency: { code: "CAD" } },
      customer: { name: "Program participants" },
      currency: { code: "CAD" },
    },
  ];
  const structures = demoWaveStructures();
  const resources: WaveSnapshotResource[] = [
    resource("availableBusiness", business, {
      label: business.name,
      secondaryLabel: business.currency.code,
      status: "active",
      currencyCode: business.currency.code,
    }),
    resource("business", business, {
      label: business.name,
      secondaryLabel: business.currency.code,
      status: "active",
      currencyCode: business.currency.code,
    }),
    ...accounts.map((row) => resource("account", row, {
      label: row.name,
      secondaryLabel: [row.type.value, row.subtype.value].join(" / "),
      typeValue: row.type.value,
      subtypeValue: row.subtype.value,
      status: "active",
      currencyCode: row.currency.code,
      amountValue: row.balanceInBusinessCurrency,
    })),
    ...vendors.map((row) => resource("vendor", row, {
      label: row.name,
      secondaryLabel: row.email,
      status: "active",
    })),
    ...products.map((row) => resource("product", row, {
      label: row.name,
      status: row.isSold ? "sold" : "bought",
      amountValue: row.unitPrice,
    })),
    ...invoices.map((row) => resource("invoice", row, {
      label: row.invoiceNumber,
      secondaryLabel: row.title,
      status: row.status,
      currencyCode: row.currency.code,
      amountValue: row.total.value,
      dateValue: row.invoiceDate,
    })),
  ];

  const resourceCounts: Record<string, number> = {};
  for (const row of resources) {
    resourceCounts[row.resourceType] = (resourceCounts[row.resourceType] ?? 0) + 1;
  }

  return {
    provider: "wave",
    businessId,
    businessName: business.name,
    currencyCode: business.currency.code,
    fetchedAtISO: new Date().toISOString(),
    resourceCounts,
    resources,
    structures,
  };
}

function demoWaveStructures(): WaveSnapshotStructure[] {
  const rows = [
    ["Business", "OBJECT", [{ name: "id" }, { name: "name" }, { name: "accounts" }]],
    ["Account", "OBJECT", [{ name: "id" }, { name: "name" }, { name: "type" }, { name: "subtype" }]],
    ["Vendor", "OBJECT", [{ name: "id" }, { name: "name" }, { name: "email" }]],
    ["Product", "OBJECT", [{ name: "id" }, { name: "name" }, { name: "isBought" }, { name: "isSold" }]],
    ["Invoice", "OBJECT", [{ name: "id" }, { name: "invoiceNumber" }, { name: "total" }]],
    ["Money", "OBJECT", [{ name: "value" }, { name: "currency" }]],
  ] as const;
  return rows.map(([typeName, kind, fields]) => {
    const raw = { name: typeName, kind, fields };
    return {
      typeName,
      kind,
      fieldCount: fields.length,
      fieldsJson: JSON.stringify(fields),
      rawJson: JSON.stringify(raw),
    };
  });
}

export async function waveHealthCheck(args: { businessId?: string } = {}): Promise<WaveHealthCheckResult> {
  const checkedAtISO = new Date().toISOString();
  const env = waveEnvironmentStatus();
  const steps: WaveHealthStep[] = [];
  const token = waveEnv("WAVE_ACCESS_TOKEN")?.trim();
  const configuredBusinessId = waveEnv("WAVE_BUSINESS_ID")?.trim();
  const argumentBusinessId = args.businessId?.trim();
  const missingRequired = env.filter((row) => row.required && !row.present);

  steps.push({
    id: "environment",
    label: "Environment",
    status: missingRequired.length > 0 ? "fail" : "pass",
    message: missingRequired.length > 0
      ? `Missing required Wave environment: ${missingRequired.map((row) => row.name).join(", ")}.`
      : "Required Wave environment is configured.",
  });

  const finish = (mode: WaveHealthCheckResult["mode"], business?: WaveHealthCheckResult["business"]): WaveHealthCheckResult => {
    const status = steps.some((step) => step.status === "fail")
      ? "fail"
      : steps.some((step) => step.status === "warn")
      ? "warn"
      : "pass";
    return {
      provider: "wave",
      mode,
      ok: status !== "fail",
      status,
      checkedAtISO,
      env,
      business,
      steps,
    };
  };

  if (!token) {
    steps.push({
      id: "auth",
      label: "Wave auth",
      status: "skip",
      message: "Skipped because WAVE_ACCESS_TOKEN is not configured.",
    });
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "skip",
      message: "Skipped because Wave auth could not run.",
    });
    return finish("not_configured");
  }

  let businesses: any[] = [];
  try {
    businesses = await waveListBusinesses();
    steps.push({
      id: "auth",
      label: "Wave auth",
      status: "pass",
      message: "Wave accepted the access token.",
      detail: { accessibleBusinesses: businesses.length },
    });
  } catch (error) {
    steps.push({
      id: "auth",
      label: "Wave auth",
      status: "fail",
      message: redactWaveDiagnostic(error),
    });
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "skip",
      message: "Skipped because Wave auth failed.",
    });
    return finish("live");
  }

  const selectedBusinessId = argumentBusinessId ?? configuredBusinessId ?? businesses[0]?.id;
  const businessSource: "env" | "argument" | "firstAccessible" | undefined = argumentBusinessId
    ? "argument"
    : configuredBusinessId
    ? "env"
    : selectedBusinessId
    ? "firstAccessible"
    : undefined;

  if (!configuredBusinessId && selectedBusinessId) {
    steps.push({
      id: "business-selection",
      label: "Business selection",
      status: "warn",
      message: "WAVE_BUSINESS_ID is missing; the check used the first accessible business only for this probe.",
    });
  }

  if (!selectedBusinessId || !businessSource) {
    steps.push({
      id: "business-selection",
      label: "Business selection",
      status: "fail",
      message: "Wave auth worked, but no accessible business was returned.",
    });
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "skip",
      message: "Skipped because no Wave business could be selected.",
    });
    return finish("live");
  }

  let business: WaveHealthCheckResult["business"] = { source: businessSource };
  try {
    const row = await waveBusiness(selectedBusinessId);
    business = {
      source: businessSource,
      name: row?.name,
      currencyCode: row?.currency?.code,
    };
    steps.push({
      id: "business-read",
      label: "Business read",
      status: "pass",
      message: "Wave returned the selected business.",
      detail: { currencyCode: row?.currency?.code },
    });
  } catch (error) {
    steps.push({
      id: "business-read",
      label: "Business read",
      status: "fail",
      message: redactWaveDiagnostic(error, [selectedBusinessId]),
    });
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "skip",
      message: "Skipped because the Wave business read failed.",
    });
    return finish("live", business);
  }

  try {
    const accounts = await waveAccountsProbe(selectedBusinessId);
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "pass",
      message: "Wave returned the accounts connection.",
      detail: { accountCount: accounts.totalCount },
    });
  } catch (error) {
    steps.push({
      id: "accounts",
      label: "Accounts probe",
      status: "fail",
      message: redactWaveDiagnostic(error, [selectedBusinessId]),
    });
  }

  return finish("live", business);
}

async function waveListBusinesses(): Promise<any[]> {
  const query = `
    query($page: Int!, $pageSize: Int!) {
      businesses(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            name
            isPersonal
            isArchived
            currency { code symbol name }
            timezone
            createdAt
            modifiedAt
          }
        }
      }
    }
  `;
  return await connectionPages<any>(query, {}, "businesses");
}

async function waveAccountsProbe(businessId: string): Promise<{ totalCount: number }> {
  const query = `
    query($businessId: ID!, $page: Int!, $pageSize: Int!) {
      business(id: $businessId) {
        accounts(page: $page, pageSize: $pageSize, isArchived: false) {
          pageInfo { currentPage totalPages totalCount }
          edges {
            node {
              id
              name
              isArchived
              type { value name }
            }
          }
        }
      }
    }
  `;
  const data = await waveGraphQL<any>(query, { businessId, page: 1, pageSize: 1 });
  const connection = data?.business?.accounts;
  if (!connection) throw new Error("Wave accounts query returned no account connection.");
  return { totalCount: Number(connection.pageInfo?.totalCount ?? connection.edges?.length ?? 0) };
}

async function waveBusiness(businessId: string): Promise<any> {
  const query = `
    query($businessId: ID!) {
      business(id: $businessId) {
        id
        name
        isPersonal
        isArchived
        organizationalType
        type { name value }
        subtype { name value }
        currency { code symbol name plural exponent }
        timezone
        address {
          addressLine1
          addressLine2
          city
          province { code name }
          country { code name }
          postalCode
        }
        phone
        fax
        mobile
        tollFree
        website
        createdAt
        modifiedAt
      }
    }
  `;
  const data = await waveGraphQL<any>(query, { businessId });
  if (!data?.business) throw new Error("Wave business not found.");
  return data.business;
}

async function waveConnection(businessId: string, field: string, query: string): Promise<any[]> {
  return await connectionPages<any>(query, { businessId }, field);
}

async function connectionPages<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await waveGraphQL<any>(query, { ...variables, page, pageSize: PAGE_SIZE });
    const connection = data?.business?.[field] ?? data?.[field];
    totalPages = connection?.pageInfo?.totalPages ?? page;
    for (const edge of connection?.edges ?? []) {
      if (edge?.node) rows.push(edge.node);
    }
    page += 1;
  } while (page <= totalPages);
  return rows;
}

async function waveStructures(): Promise<WaveSnapshotStructure[]> {
  const query = `
    query($typeName: String!) {
      __type(name: $typeName) {
        name
        kind
        fields {
          name
          args {
            name
            type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
          }
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
        inputFields {
          name
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
        enumValues {
          name
        }
        possibleTypes {
          name
          kind
        }
      }
    }
  `;
  const rows = await Promise.all(
    STRUCTURE_TYPES.map(async (typeName) => {
      const data = await waveGraphQL<any>(query, { typeName });
      const raw = data?.__type;
      if (!raw) return null;
      const fields = raw.fields ?? raw.inputFields ?? raw.enumValues ?? raw.possibleTypes ?? [];
      return {
        typeName,
        kind: raw.kind,
        fieldCount: fields.length,
        fieldsJson: JSON.stringify(fields),
        rawJson: JSON.stringify(raw),
      };
    }),
  );
  return rows.filter(Boolean) as WaveSnapshotStructure[];
}

function resource(
  resourceType: WaveResourceType,
  raw: any,
  meta: Partial<WaveSnapshotResource>,
): WaveSnapshotResource {
  const rawJson = JSON.stringify(raw);
  const label = meta.label ?? raw.name ?? raw.title ?? raw.id ?? resourceType;
  const searchText = [
    resourceType,
    raw.id,
    label,
    meta.secondaryLabel,
    meta.typeValue,
    meta.subtypeValue,
    meta.status,
    meta.currencyCode,
    meta.amountValue,
    raw.email,
    raw.displayId,
    raw.invoiceNumber,
    raw.estimateNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    resourceType,
    externalId: raw.id,
    label,
    secondaryLabel: meta.secondaryLabel,
    typeValue: meta.typeValue,
    subtypeValue: meta.subtypeValue,
    status: meta.status,
    currencyCode: meta.currencyCode,
    amountValue: meta.amountValue == null ? undefined : String(meta.amountValue),
    dateValue: meta.dateValue,
    searchText,
    rawJson,
  };
}

function variableStrings(variables: Record<string, unknown>) {
  return Object.values(variables).filter((value): value is string => typeof value === "string");
}

const MONEY = `
  value
  minorUnitValue
  currency { code symbol name }
`;

const ADDRESS = `
  addressLine1
  addressLine2
  city
  province { code name }
  country { code name }
  postalCode
`;

const ACCOUNT_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      accounts(page: $page, pageSize: $pageSize, isArchived: false) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            classicId
            name
            description
            displayId
            currency { code symbol name }
            type { value name }
            subtype { value name }
            normalBalanceType
            isArchived
            sequence
            balance
            balanceInBusinessCurrency
          }
        }
      }
    }
  }
`;

const VENDOR_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      vendors(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            name
            address { ${ADDRESS} }
            firstName
            lastName
            displayId
            email
            mobile
            phone
            fax
            tollFree
            website
            internalNotes
            currency { code symbol name }
            shippingDetails {
              name
              address { ${ADDRESS} }
              phone
              instructions
            }
            createdAt
            modifiedAt
            isArchived
          }
        }
      }
    }
  }
`;

const CUSTOMER_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      customers(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            name
            address { ${ADDRESS} }
            firstName
            lastName
            displayId
            email
            mobile
            phone
            fax
            tollFree
            website
            internalNotes
            currency { code symbol name }
            outstandingAmount { ${MONEY} }
            overdueAmount { ${MONEY} }
            shippingDetails {
              name
              address { ${ADDRESS} }
              phone
              instructions
            }
            createdAt
            modifiedAt
            isArchived
          }
        }
      }
    }
  }
`;

const PRODUCT_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      products(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            name
            description
            unitPrice
            isSold
            isBought
            isArchived
            incomeAccount { id name type { value } subtype { value } }
            expenseAccount { id name type { value } subtype { value } }
            defaultSalesTaxes { id name abbreviation }
            createdAt
            modifiedAt
          }
        }
      }
    }
  }
`;

const INVOICE_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      invoices(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            createdAt
            modifiedAt
            status
            title
            subhead
            invoiceNumber
            poNumber
            invoiceDate
            dueDate
            amountDue { ${MONEY} }
            amountPaid { ${MONEY} }
            taxTotal { ${MONEY} }
            total { ${MONEY} }
            discountTotal { ${MONEY} }
            subtotal { ${MONEY} }
            currency { code symbol name }
            exchangeRate
            customer { id name email displayId }
            items {
              id
              description
              quantity
              unitPrice
              subtotal { ${MONEY} }
              total { ${MONEY} }
              account { id name type { value } subtype { value } }
              product { id name }
            }
            payments {
              id
              paymentDate
              amount
              memo
              paymentMethod
              paymentProvider
              transactionId
              accountingTransactionId
              account { id name }
            }
            memo
            footer
            disableCreditCardPayments
            disableBankPayments
            disableAmexPayments
            lastSentAt
            lastSentVia
            lastViewedAt
          }
        }
      }
    }
  }
`;

const ESTIMATE_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      estimates(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            createdAt
            modifiedAt
            status
            title
            subhead
            estimateNumber
            poNumber
            estimateDate
            dueDate
            amountDue { ${MONEY} }
            amountPaid { ${MONEY} }
            taxTotal { ${MONEY} }
            total { ${MONEY} }
            discountTotal { ${MONEY} }
            subtotal { ${MONEY} }
            depositStatus
            depositUnit
            depositValue
            depositTotal { ${MONEY} }
            depositPaymentStatus
            currency { code symbol name }
            exchangeRate
            customer { id name email displayId }
            items {
              id
              description
              quantity
              unitPrice
              subtotal { ${MONEY} }
              total { ${MONEY} }
              account { id name type { value } subtype { value } }
              product { id name }
            }
            payments {
              id
              paymentDate
              paymentAccountId
              paymentMethod
              paymentProvider
              transactionId
            }
            memo
            footer
            disableCreditCardPayments
            disableBankPayments
            disableAmexPayments
            lastSentAt
            lastSentVia
            lastViewedAt
          }
        }
      }
    }
  }
`;

const SALES_TAX_CONNECTION_QUERY = `
  query($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      salesTaxes(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
            id
            name
            abbreviation
            description
            taxNumber
            showTaxNumberOnInvoices
            rates { effective rate }
            isCompound
            isRecoverable
            isArchived
            createdAt
            modifiedAt
          }
        }
      }
    }
  }
`;
