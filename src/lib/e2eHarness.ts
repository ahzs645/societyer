import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { localDataClient, reseedLocalData } from "./localDataClient";
import { getStoredSocietyId, setStoredSocietyId } from "../hooks/useSociety";
import { setStoredUserId } from "../hooks/useCurrentUser";
import { verifyFixtureFormation } from "../../scripts/helpers/verifiedFormation";

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

/** CBCA by default; `"CA-BC"` builds the same fixture as a BC company. */
type CorporationMvpOptions = { jurisdictionCode?: "CA-FED-CBCA" | "CA-BC" };

declare global {
  interface Window {
    __societyerE2E?: {
      navigate?: (to: string | number) => void;
      reset(): Promise<void>;
      setupInteractionAudit(): Promise<any>;
      inspectInteractionAudit(societyId: string): Promise<any>;
      failNextInteractionWrite(name: "tasks:update" | "notifications:markRead"): void;
      setupCorporationMvp(options?: CorporationMvpOptions): Promise<CorporationMvpFixture>;
      setupPathway(): Promise<{ societyId: string; documentId: string; reviewerId: string }>;
      inspectPathway(societyId: string): Promise<any>;
      inspect(): Promise<{
        selectedSocietyId: string | null;
        societies: Array<{ _id: string; name: string; entityType?: string; jurisdictionCode?: string }>;
        selectedRoleHolderCount: number;
      }>;
    };
  }
}

async function reset() {
  await reseedLocalData();
}

async function setupPathway() {
  // These are normal, permission-checked local mutations, not a graph-state bypass.
  const created = await localDataClient.mutation("society:createWorkspace", {
    name: "Pathway Browser Preparation Inc.", fiscalYearEnd: "12-31",
    jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
    actFormedUnder: "canada_business_corporations_act",
  }) as any;
  const memberships = await localDataClient.query("users:list", { societyId: created.societyId }) as any[];
  const owner = memberships.find((membership) => membership.role === "Owner" && membership.status === "Active");
  if (!owner) throw new Error("Pathway fixture requires its real Active Owner.");
  setStoredUserId(owner._id);
  const documentId = await localDataClient.mutation("documents:create", { societyId: created.societyId, title: "Browser preparation evidence", category: "governance", tags: ["test_fixture"] }) as string;
  const reviewerId = await localDataClient.mutation("users:upsert", { societyId: created.societyId, email: "reviewer@pathway.example", displayName: "Independent Pathway Reviewer", role: "Admin", status: "Active" }) as string;
  await waitForLocalQueryPropagation(created.societyId);
  setStoredSocietyId(created.societyId);
  return { societyId: created.societyId, documentId, reviewerId };
}

async function inspectPathway(societyId: string) { return localDataClient.query("pathways:status", { societyId }); }

async function setupCorporationMvp(options: CorporationMvpOptions = {}): Promise<CorporationMvpFixture> {
  const bcCompany = options.jurisdictionCode === "CA-BC";
  const created = await localDataClient.mutation("society:createWorkspace", {
    name: bcCompany ? "Northstar BC Holdings Ltd." : "Northstar Browser Flow Holdings Inc.",
    incorporationNumber: bcCompany ? "BC7777777" : "777777-1",
    incorporationDate: "2025-02-10",
    fiscalYearEnd: "12-31",
    jurisdictionCode: bcCompany ? "CA-BC" : "CA-FED-CBCA",
    entityType: "corporation__business_",
    actFormedUnder: bcCompany ? "business_corporations_act" : "canada_business_corporations_act",
    officialEmail: "records@northstar.example",
  }) as any;

  // Planned dates do not activate statutory duties. This opt-in browser fixture
  // records explicitly synthetic, owned file evidence through the same upload
  // and certificate-verification mutations used by the native fixtures.
  await verifyFixtureFormation(localDataClient, created.societyId, "2025-02-10");

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
    fullyPaidConfirmedAt: "2025-02-11",
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
    homeJurisdiction: bcCompany ? "CA-BC" : "CA-FED-CBCA",
    registrationNumber: "ON-BROWSER-001",
    registrationDate: "2026-01-05",
    activityCommencementDate: "2026-01-05",
    corporationClass: "federal_corporation",
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


/** Synthetic records only, through the same permission-checked local entry points. */
async function setupInteractionAudit() {
  const created = await localDataClient.mutation("society:createWorkspace", {
    name: "Interaction Browser Society", fiscalYearEnd: "12-31", jurisdictionCode: "CA-BC",
    entityType: "society", actFormedUnder: "societies_act",
  }) as any;
  const societyId = String(created.societyId);
  const users = await localDataClient.query("users:list", { societyId }) as any[];
  const owner = users.find(row => row.role === "Owner" && row.status === "Active");
  if (!owner) throw new Error("The interaction fixture requires its real owner.");
  setStoredUserId(owner._id); setStoredSocietyId(societyId);
  const second = await localDataClient.mutation("users:upsert", { societyId, email: "second@interaction.example.test", displayName: "Second Synthetic Owner", role: "Admin", status: "Active" }) as string;
  const goalIds: string[] = [];
  for (const title of ["Interaction goal A", "Interaction goal B"]) goalIds.push(await localDataClient.mutation("goals:create", {
    societyId, title, category: "Other", status: "Active", startDate: "2026-01-01", targetDate: "2027-01-01", progressPercent: 0, milestones: [], keyResults: [],
  }) as string);
  const taskIds: string[] = [];
  for (let index = 0; index < 2; index++) taskIds.push(await localDataClient.mutation("tasks:create", {
    societyId, title: `Interaction task ${index ? "B" : "A"}`, status: "Todo", priority: "Medium", tags: [],
    goalId: goalIds[index], dueDate: "2026-10-31", assignee: "Synthetic source owner",
    responsibleUserIds: [owner._id, second], checklist: [{ id: "first", title: "Original step", done: false }],
  }) as string);
  for (const [title, linkHref] of [["Interaction linked bell", "/app/tasks"], ["Interaction no-link bell", undefined], ["Interaction page link", "/app/tasks"]]) {
    await localDataClient.mutation("notifications:create", { societyId, kind: "general", severity: "info", title, linkHref });
  }
  await waitForLocalQueryPropagation(societyId);
  return { societyId, taskIds, goalIds, userIds: [owner._id, second] };
}
async function inspectInteractionAudit(societyId: string) {
  return { tasks: await localDataClient.query("tasks:list", { societyId }), notifications: await localDataClient.query("notifications:list", { societyId, limit: 100 }) };
}
function failNextInteractionWrite(name: "tasks:update" | "notifications:markRead") {
  const original = localDataClient.mutation.bind(localDataClient);
  localDataClient.mutation = ((reference: any, args: any) => {
    if ((typeof reference === "string" ? reference : reference?.[Symbol.for("functionName")]) === name) {
      localDataClient.mutation = original;
      return Promise.reject(new Error("Injected interaction write failure"));
    }
    return original(reference, args);
  }) as typeof localDataClient.mutation;
}

window.__societyerE2E = { setupInteractionAudit, inspectInteractionAudit, failNextInteractionWrite, reset, setupCorporationMvp, setupPathway, inspectPathway, inspect };

/** Uses the real router, so same-route history tests do not simulate navigation with pushState. */
export function E2ERouterBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const harness = window.__societyerE2E;
    if (!harness) return;
    const go = (to: string | number) => { if (typeof to === "number") navigate(to); else navigate(to); };
    harness.navigate = go;
    return () => { if (harness.navigate === go) delete harness.navigate; };
  }, [navigate]);
  return null;
}
