import { localDataClient, reseedLocalData } from "./localDataClient";
import { getStoredSocietyId, setStoredSocietyId } from "../hooks/useSociety";

type CorporationMvpFixture = {
  societyId: string;
  directorId: string;
  officerId: string;
  shareholderId: string;
  controllerId: string;
  shareClassId: string;
  issuanceId: string;
  ontarioRegistrationId: string;
};

declare global {
  interface Window {
    __societyerE2E?: {
      reset(): Promise<void>;
      setupCorporationMvp(): Promise<CorporationMvpFixture>;
      inspect(): Promise<{
        selectedSocietyId: string | null;
        societies: Array<{ _id: string; name: string; entityType?: string; jurisdictionCode?: string }>;
        selectedRoleHolderCount: number;
      }>;
    };
  }
}

async function reset() {
  reseedLocalData();
}

async function setupCorporationMvp(): Promise<CorporationMvpFixture> {
  const created = await localDataClient.mutation("society:createWorkspace", {
    name: "Northstar Browser Flow Holdings Inc.",
    incorporationNumber: "777777-1",
    incorporationDate: "2025-02-10",
    fiscalYearEnd: "12-31",
    jurisdictionCode: "CA-FED-CBCA",
    entityType: "corporation__business_",
    actFormedUnder: "canada_business_corporations_act",
    officialEmail: "records@northstar.example",
  }) as any;

  const directorId = await localDataClient.mutation("legalOperations:upsertRoleHolder", {
    societyId: created.societyId,
    roleType: "director",
    status: "current",
    fullName: "Dina Director",
    ageOver18: true,
  }) as string;
  const officerId = await localDataClient.mutation("legalOperations:upsertRoleHolder", {
    societyId: created.societyId,
    roleType: "officer",
    status: "current",
    fullName: "Omar Officer",
    officerTitle: "president",
  }) as string;
  const shareholderId = await localDataClient.mutation("legalOperations:upsertRoleHolder", {
    societyId: created.societyId,
    roleType: "shareholder",
    status: "current",
    fullName: "Sera Shareholder",
  }) as string;
  const controllerId = await localDataClient.mutation("legalOperations:upsertRoleHolder", {
    societyId: created.societyId,
    roleType: "controller",
    status: "current",
    fullName: "Cleo Controller",
    natureOfControl: "Owns voting shares directly.",
  }) as string;

  const shareClassId = await localDataClient.mutation("legalOperations:upsertRightsClass", {
    societyId: created.societyId,
    className: "Common shares",
    classType: "share",
    status: "active",
    votingRights: "One vote per share.",
  }) as string;
  const issuanceId = await localDataClient.mutation("legalOperations:upsertRightsholdingTransfer", {
    societyId: created.societyId,
    transferType: "issuance",
    status: "posted",
    transferDate: "2025-02-11",
    rightsClassId: shareClassId,
    destinationRoleHolderId: shareholderId,
    quantity: 100,
    considerationType: "cash",
    priceToOrganizationCents: 100,
    priceToOrganizationCurrency: "cad",
  }) as string;

  const ontarioRegistrationId = await localDataClient.mutation("organizationDetails:upsertRegistration", {
    societyId: created.societyId,
    registrationType: "extra_provincial",
    jurisdiction: "CA-ON-OBCA",
    homeJurisdiction: "CA-FED-CBCA",
    registrationNumber: "ON-BROWSER-001",
    registrationDate: "2026-01-05",
    annualReturnDueDate: "2026-06-30",
    registryPortalKey: "ontario_business_registry",
    status: "active",
  }) as string;

  await waitForLocalQueryPropagation(created.societyId);
  setStoredSocietyId(created.societyId);

  return {
    societyId: created.societyId,
    directorId,
    officerId,
    shareholderId,
    controllerId,
    shareClassId,
    issuanceId,
    ontarioRegistrationId,
  };
}

async function waitForLocalQueryPropagation(societyId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const societies = await localDataClient.query("society:list", {}) as any[];
    if (societies.some((row) => row._id === societyId)) {
      await nextFrame();
      await nextFrame();
      return;
    }
    await delay(25);
  }
  throw new Error(`Created society ${societyId} was not visible to the local query layer.`);
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function inspect() {
  const selectedSocietyId = getStoredSocietyId();
  const societies = await localDataClient.query("society:list", {}) as any[];
  const selectedRoleHolders = selectedSocietyId
    ? await localDataClient.query("legalOperations:listRoleHolders", { societyId: selectedSocietyId }) as any[]
    : [];
  return {
    selectedSocietyId,
    societies: societies.map((row) => ({
      _id: row._id,
      name: row.name,
      entityType: row.entityType,
      jurisdictionCode: row.jurisdictionCode,
    })),
    selectedRoleHolderCount: selectedRoleHolders.length,
  };
}

window.__societyerE2E = { reset, setupCorporationMvp, inspect };
