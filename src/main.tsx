import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { convex } from "./lib/convex";
import { staticConvex } from "./lib/staticConvex";
import { isStaticDemoRuntime } from "./lib/staticRuntime";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { ModuleGate } from "./components/ModuleGate";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmProvider, PromptProvider } from "./components/Modal";
import { ToastProvider } from "./components/Toast";
import { applyThemePreference, getStoredThemePreference } from "./lib/theme";

const Dashboard = React.lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const SocietyPage = React.lazy(() => import("./pages/Society").then((m) => ({ default: m.SocietyPage })));
const OrganizationDetailsPage = React.lazy(() => import("./pages/OrganizationDetails").then((m) => ({ default: m.OrganizationDetailsPage })));
const OrganizationHistoryPage = React.lazy(() => import("./pages/OrganizationHistory").then((m) => ({ default: m.OrganizationHistoryPage })));
const OrganizationHistoryBudgetPage = React.lazy(() => import("./pages/OrganizationHistory").then((m) => ({ default: m.OrganizationHistoryBudgetPage })));
const GovernanceRegistersPage = React.lazy(() => import("./pages/EvidenceRegisters").then((m) => ({ default: m.GovernanceRegistersPage })));
const MeetingEvidencePage = React.lazy(() => import("./pages/EvidenceRegisters").then((m) => ({ default: m.MeetingEvidencePage })));
const FinanceImportsPage = React.lazy(() => import("./pages/EvidenceRegisters").then((m) => ({ default: m.FinanceImportsPage })));
const RecordsArchivePage = React.lazy(() => import("./pages/EvidenceRegisters").then((m) => ({ default: m.RecordsArchivePage })));
const ImportSessionsPage = React.lazy(() => import("./pages/ImportSessions").then((m) => ({ default: m.ImportSessionsPage })));
const MembersPage = React.lazy(() => import("./pages/Members").then((m) => ({ default: m.MembersPage })));
const DirectorsPage = React.lazy(() => import("./pages/Directors").then((m) => ({ default: m.DirectorsPage })));
const MeetingsPage = React.lazy(() => import("./pages/Meetings").then((m) => ({ default: m.MeetingsPage })));
const MeetingDetailPage = React.lazy(() => import("./pages/MeetingDetail").then((m) => ({ default: m.MeetingDetailPage })));
const MinutesPage = React.lazy(() => import("./pages/Minutes").then((m) => ({ default: m.MinutesPage })));
const FilingsPage = React.lazy(() => import("./pages/Filings").then((m) => ({ default: m.FilingsPage })));
const DeadlinesPage = React.lazy(() => import("./pages/Deadlines").then((m) => ({ default: m.DeadlinesPage })));
const DocumentsPage = React.lazy(() => import("./pages/Documents").then((m) => ({ default: m.DocumentsPage })));
const MinuteBookPage = React.lazy(() => import("./pages/MinuteBook").then((m) => ({ default: m.MinuteBookPage })));
const ConflictsPage = React.lazy(() => import("./pages/Conflicts").then((m) => ({ default: m.ConflictsPage })));
const FinancialsPage = React.lazy(() => import("./pages/Financials").then((m) => ({ default: m.FinancialsPage })));
const FinancialYearDetailPage = React.lazy(() => import("./pages/Financials").then((m) => ({ default: m.FinancialYearDetailPage })));
const WaveAccountDetailPage = React.lazy(() => import("./pages/Financials").then((m) => ({ default: m.WaveAccountDetailPage })));
const WaveResourceDetailPage = React.lazy(() => import("./pages/Financials").then((m) => ({ default: m.WaveResourceDetailPage })));
const WaveResourceTablePage = React.lazy(() => import("./pages/Financials").then((m) => ({ default: m.WaveResourceTablePage })));
const PrivacyPage = React.lazy(() => import("./pages/Privacy").then((m) => ({ default: m.PrivacyPage })));
const PoliciesPage = React.lazy(() => import("./pages/Policies").then((m) => ({ default: m.PoliciesPage })));
const SettingsPage = React.lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ApiKeysPage = React.lazy(() => import("./pages/ApiKeysPage").then((m) => ({ default: m.ApiKeysPage })));
const CommitteesPage = React.lazy(() => import("./pages/Committees").then((m) => ({ default: m.CommitteesPage })));
const CommitteeDetailPage = React.lazy(() => import("./pages/CommitteeDetail").then((m) => ({ default: m.CommitteeDetailPage })));
const GoalsPage = React.lazy(() => import("./pages/Goals").then((m) => ({ default: m.GoalsPage })));
const GoalDetailPage = React.lazy(() => import("./pages/GoalDetail").then((m) => ({ default: m.GoalDetailPage })));
const TasksPage = React.lazy(() => import("./pages/Tasks").then((m) => ({ default: m.TasksPage })));
const CommitmentsPage = React.lazy(() => import("./pages/Commitments").then((m) => ({ default: m.CommitmentsPage })));
const TimelinePage = React.lazy(() => import("./pages/Timeline").then((m) => ({ default: m.TimelinePage })));
const NotificationsPage = React.lazy(() => import("./pages/Notifications").then((m) => ({ default: m.NotificationsPage })));
const UsersPage = React.lazy(() => import("./pages/Users").then((m) => ({ default: m.UsersPage })));
const AuditLogPage = React.lazy(() => import("./pages/AuditLog").then((m) => ({ default: m.AuditLogPage })));
const ExportsPage = React.lazy(() => import("./pages/Exports").then((m) => ({ default: m.ExportsPage })));
const AgendaBuilderPage = React.lazy(() => import("./pages/AgendaBuilder").then((m) => ({ default: m.AgendaBuilderPage })));
const MotionBacklogPage = React.lazy(() => import("./pages/MotionBacklog").then((m) => ({ default: m.MotionBacklogPage })));
const MotionLibraryPage = React.lazy(() => import("./pages/MotionLibrary").then((m) => ({ default: m.MotionLibraryPage })));
const TreasurerPage = React.lazy(() => import("./pages/Treasurer").then((m) => ({ default: m.TreasurerPage })));
const MembershipPage = React.lazy(() => import("./pages/Membership").then((m) => ({ default: m.MembershipPage })));
const InspectionsPage = React.lazy(() => import("./pages/Inspections").then((m) => ({ default: m.InspectionsPage })));
const AttestationsPage = React.lazy(() => import("./pages/Attestations").then((m) => ({ default: m.AttestationsPage })));
const RetentionPage = React.lazy(() => import("./pages/Retention").then((m) => ({ default: m.RetentionPage })));
const InsurancePage = React.lazy(() => import("./pages/Insurance").then((m) => ({ default: m.InsurancePage })));
const SecretsPage = React.lazy(() => import("./pages/Secrets").then((m) => ({ default: m.SecretsPage })));
const PipaTrainingPage = React.lazy(() => import("./pages/PipaTraining").then((m) => ({ default: m.PipaTrainingPage })));
const ProxiesPage = React.lazy(() => import("./pages/Proxies").then((m) => ({ default: m.ProxiesPage })));
const AuditorsPage = React.lazy(() => import("./pages/Auditors").then((m) => ({ default: m.AuditorsPage })));
const MemberProposalsPage = React.lazy(() => import("./pages/MemberProposals").then((m) => ({ default: m.MemberProposalsPage })));
const ReceiptsPage = React.lazy(() => import("./pages/Receipts").then((m) => ({ default: m.ReceiptsPage })));
const EmployeesPage = React.lazy(() => import("./pages/Employees").then((m) => ({ default: m.EmployeesPage })));
const CourtOrdersPage = React.lazy(() => import("./pages/CourtOrders").then((m) => ({ default: m.CourtOrdersPage })));
const WrittenResolutionsPage = React.lazy(() => import("./pages/WrittenResolutions").then((m) => ({ default: m.WrittenResolutionsPage })));
const AgmWorkflowPage = React.lazy(() => import("./pages/AgmWorkflow").then((m) => ({ default: m.AgmWorkflowPage })));
const FilingPreFillPage = React.lazy(() => import("./pages/FilingPreFill").then((m) => ({ default: m.FilingPreFillPage })));
const BylawDiffPage = React.lazy(() => import("./pages/BylawDiff").then((m) => ({ default: m.BylawDiffPage })));
const BylawsHistoryPage = React.lazy(() => import("./pages/BylawsHistory").then((m) => ({ default: m.BylawsHistoryPage })));
const ReconciliationPage = React.lazy(() => import("./pages/Reconciliation").then((m) => ({ default: m.ReconciliationPage })));
const LandingPage = React.lazy(() => import("./pages/Landing").then((m) => ({ default: m.LandingPage })));
const LoginPage = React.lazy(() => import("./pages/Login").then((m) => ({ default: m.LoginPage })));
const BylawRulesPage = React.lazy(() => import("./pages/BylawRules").then((m) => ({ default: m.BylawRulesPage })));
const ElectionsPage = React.lazy(() => import("./pages/Elections").then((m) => ({ default: m.ElectionsPage })));
const ElectionDetailPage = React.lazy(() => import("./pages/ElectionDetail").then((m) => ({ default: m.ElectionDetailPage })));
const PortalPage = React.lazy(() => import("./pages/Portal").then((m) => ({ default: m.PortalPage })));
const CommunicationsPage = React.lazy(() => import("./pages/Communications").then((m) => ({ default: m.CommunicationsPage })));
const VolunteersPage = React.lazy(() => import("./pages/Volunteers").then((m) => ({ default: m.VolunteersPage })));
const GrantsPage = React.lazy(() => import("./pages/Grants").then((m) => ({ default: m.GrantsPage })));
const GrantDetailPage = React.lazy(() => import("./pages/Grants").then((m) => ({ default: m.GrantDetailPage })));
const GrantEditPage = React.lazy(() => import("./pages/Grants").then((m) => ({ default: m.GrantEditPage })));
const TransparencyPage = React.lazy(() => import("./pages/Transparency").then((m) => ({ default: m.TransparencyPage })));
const PaperlessPage = React.lazy(() => import("./pages/Paperless").then((m) => ({ default: m.PaperlessPage })));
const BrowserConnectorsPage = React.lazy(() => import("./pages/BrowserConnectors").then((m) => ({ default: m.BrowserConnectorsPage })));
const WorkflowsPage = React.lazy(() => import("./pages/Workflows").then((m) => ({ default: m.WorkflowsPage })));
const WorkflowDetailPage = React.lazy(() => import("./pages/WorkflowDetail").then((m) => ({ default: m.WorkflowDetailPage })));
const WorkflowRunsPage = React.lazy(() => import("./pages/WorkflowRuns").then((m) => ({ default: m.WorkflowRunsPage })));
const WorkflowPackagesPage = React.lazy(() => import("./pages/WorkflowPackages").then((m) => ({ default: m.WorkflowPackagesPage })));
const RoleHoldersPage = React.lazy(() => import("./pages/LegalOperations").then((m) => ({ default: m.RoleHoldersPage })));
const RightsLedgerPage = React.lazy(() => import("./pages/LegalOperations").then((m) => ({ default: m.RightsLedgerPage })));
const TemplateEnginePage = React.lazy(() => import("./pages/LegalOperations").then((m) => ({ default: m.TemplateEnginePage })));
const FormationMaintenancePage = React.lazy(() => import("./pages/LegalOperations").then((m) => ({ default: m.FormationMaintenancePage })));
const OutboxPage = React.lazy(() => import("./pages/Outbox").then((m) => ({ default: m.OutboxPage })));
const CustomFieldsPage = React.lazy(() => import("./pages/CustomFields").then((m) => ({ default: m.CustomFieldsPage })));
const PublicTransparencyPage = React.lazy(() => import("./pages/PublicTransparency").then((m) => ({ default: m.PublicTransparencyPage })));
const VolunteerApplyPage = React.lazy(() => import("./pages/VolunteerApply").then((m) => ({ default: m.VolunteerApplyPage })));
const GrantApplyPage = React.lazy(() => import("./pages/GrantApply").then((m) => ({ default: m.GrantApplyPage })));
import "./i18n";
import "./theme/palette.css";
import "./theme/tokens.css";
import "./styles/index.scss";

applyThemePreference(getStoredThemePreference());

function withModule(moduleKey: React.ComponentProps<typeof ModuleGate>["moduleKey"], element: React.ReactNode) {
  return <ModuleGate moduleKey={moduleKey}>{element}</ModuleGate>;
}

function AppProviders({ client }: { client: ConvexReactClient }) {
  return (
    <ConvexProvider client={client}>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <PromptProvider>
              <Outlet />
            </PromptProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </ConvexProvider>
  );
}

const staticDemoRuntime = isStaticDemoRuntime();
const routerBasename = staticDemoRuntime ? "/demo" : import.meta.env.BASE_URL;
const convexClient = staticDemoRuntime
  ? (staticConvex as unknown as ConvexReactClient)
  : convex;

function PageLoader() {
  return (
    <div style={{ padding: 24, color: "#888", fontSize: 13 }}>Loading…</div>
  );
}

function RootErrorFallback() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong.</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        The page hit an unrecoverable error. Try reloading. If it keeps happening, contact your administrator.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 14px",
          border: "1px solid #ccc",
          borderRadius: 6,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        Reload
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="root" fallback={<RootErrorFallback />}>
      <BrowserRouter
        basename={routerBasename}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Suspense fallback={<PageLoader />}>
        <Routes>
          {!staticDemoRuntime && <Route path="/" element={<LandingPage />} />}
          <Route element={<AppProviders client={convexClient} />}>
            {staticDemoRuntime && (
              <Route
                path="/"
                element={
                  <AuthGate>
                    <Layout />
                  </AuthGate>
                }
              >
                <Route index element={<Dashboard />} />
              </Route>
            )}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/public" element={<PublicTransparencyPage />} />
            <Route path="/public/:slug" element={<PublicTransparencyPage />} />
            <Route
              path="/public/:slug/volunteer-apply"
              element={<VolunteerApplyPage />}
            />
            <Route
              path="/public/:slug/grant-apply"
              element={<GrantApplyPage />}
            />
            <Route
              path="/portal"
              element={
                <AuthGate>
                  <PortalPage />
                </AuthGate>
              }
            />
            <Route
              path="/app"
              element={
                <AuthGate>
                  <Layout />
                </AuthGate>
              }
            >
            <Route index element={<Dashboard />} />
            <Route path="society" element={<SocietyPage />} />
            <Route path="organization-details" element={<OrganizationDetailsPage />} />
            <Route path="role-holders" element={<RoleHoldersPage />} />
            <Route path="rights-ledger" element={<RightsLedgerPage />} />
            <Route path="template-engine" element={<TemplateEnginePage />} />
            <Route path="formation-maintenance" element={<FormationMaintenancePage />} />
            <Route path="org-history" element={<OrganizationHistoryPage />} />
            <Route path="org-history/budgets/:budgetId" element={<OrganizationHistoryBudgetPage />} />
            <Route path="governance-registers" element={<GovernanceRegistersPage />} />
            <Route path="meeting-evidence" element={<MeetingEvidencePage />} />
            <Route path="finance-imports" element={<FinanceImportsPage />} />
            <Route path="records-archive" element={<RecordsArchivePage />} />
            <Route path="imports" element={<ImportSessionsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="directors" element={<DirectorsPage />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="meetings/:id" element={<MeetingDetailPage />} />
            <Route path="minutes" element={<MinutesPage />} />
            <Route path="filings" element={<FilingsPage />} />
            <Route path="deadlines" element={<DeadlinesPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="minute-book" element={<MinuteBookPage />} />
            <Route path="conflicts" element={<ConflictsPage />} />
            <Route path="financials" element={<FinancialsPage />} />
            <Route path="financials/fy/:fiscalYear" element={<FinancialYearDetailPage />} />
            <Route path="financials/wave/account/:resourceId" element={<WaveAccountDetailPage />} />
            <Route path="financials/wave/:resourceType/:resourceId" element={<WaveResourceDetailPage />} />
            <Route path="financials/wave/:resourceType" element={<WaveResourceTablePage />} />
            <Route
              path="grants"
              element={withModule("grants", <GrantsPage />)}
            />
            <Route
              path="grants/:id"
              element={withModule("grants", <GrantDetailPage />)}
            />
            <Route
              path="grants/:id/edit"
              element={withModule("grants", <GrantEditPage />)}
            />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route
              path="communications"
              element={withModule("communications", <CommunicationsPage />)}
            />
            <Route path="committees" element={<CommitteesPage />} />
            <Route path="committees/:id" element={<CommitteeDetailPage />} />
            <Route
              path="volunteers"
              element={withModule("volunteers", <VolunteersPage />)}
            />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="goals/:id" element={<GoalDetailPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="commitments" element={<CommitmentsPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="exports" element={<ExportsPage />} />
            <Route path="agendas" element={<AgendaBuilderPage />} />
            <Route path="motion-backlog" element={<MotionBacklogPage />} />
            <Route path="motion-library" element={<MotionLibraryPage />} />
            <Route path="treasurer" element={<TreasurerPage />} />
            <Route
              path="membership"
              element={withModule("membershipBilling", <MembershipPage />)}
            />
            <Route
              path="inspections"
              element={withModule("recordsInspection", <InspectionsPage />)}
            />
            <Route
              path="attestations"
              element={withModule("attestations", <AttestationsPage />)}
            />
            <Route
              path="retention"
              element={withModule("recordsInspection", <RetentionPage />)}
            />
            <Route
              path="insurance"
              element={withModule("insurance", <InsurancePage />)}
            />
            <Route
              path="access-custody"
              element={withModule("secrets", <SecretsPage />)}
            />
            <Route path="secrets" element={<Navigate to="/app/access-custody" replace />} />
            <Route
              path="pipa-training"
              element={withModule("pipaTraining", <PipaTrainingPage />)}
            />
            <Route
              path="proxies"
              element={withModule("voting", <ProxiesPage />)}
            />
            <Route
              path="auditors"
              element={withModule("auditors", <AuditorsPage />)}
            />
            <Route
              path="proposals"
              element={withModule("voting", <MemberProposalsPage />)}
            />
            <Route
              path="receipts"
              element={withModule("donationReceipts", <ReceiptsPage />)}
            />
            <Route
              path="employees"
              element={withModule("employees", <EmployeesPage />)}
            />
            <Route
              path="court-orders"
              element={withModule("courtOrders", <CourtOrdersPage />)}
            />
            <Route
              path="written-resolutions"
              element={withModule("voting", <WrittenResolutionsPage />)}
            />
            <Route path="meetings/:id/agm" element={<AgmWorkflowPage />} />
            <Route
              path="filings/prefill"
              element={withModule("filingPrefill", <FilingPreFillPage />)}
            />
            <Route path="bylaw-diff" element={<BylawDiffPage />} />
            <Route path="bylaw-rules" element={<BylawRulesPage />} />
            <Route path="bylaws-history" element={<BylawsHistoryPage />} />
            <Route
              path="elections"
              element={withModule("voting", <ElectionsPage />)}
            />
            <Route
              path="elections/:id"
              element={withModule("voting", <ElectionDetailPage />)}
            />
            <Route
              path="reconciliation"
              element={withModule("reconciliation", <ReconciliationPage />)}
            />
            <Route
              path="transparency"
              element={withModule("transparency", <TransparencyPage />)}
            />
            <Route
              path="paperless"
              element={withModule("paperless", <PaperlessPage />)}
            />
            <Route
              path="browser-connectors"
              element={withModule("browserConnectors", <BrowserConnectorsPage />)}
            />
            <Route
              path="workflows"
              element={withModule("workflows", <WorkflowsPage />)}
            />
            <Route
              path="workflows/:id"
              element={withModule("workflows", <WorkflowDetailPage />)}
            />
            <Route
              path="workflow-runs"
              element={withModule("workflows", <WorkflowRunsPage />)}
            />
            <Route
              path="workflow-packages"
              element={withModule("workflows", <WorkflowPackagesPage />)}
            />
            <Route path="outbox" element={<OutboxPage />} />
            <Route path="custom-fields" element={<CustomFieldsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/api-keys" element={<ApiKeysPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
