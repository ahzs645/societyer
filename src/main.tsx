import React from "react";
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
import { Dashboard } from "./pages/Dashboard";
import { SocietyPage } from "./pages/Society";
import { MembersPage } from "./pages/Members";
import { DirectorsPage } from "./pages/Directors";
import { MeetingsPage } from "./pages/Meetings";
import { MeetingDetailPage } from "./pages/MeetingDetail";
import { MinutesPage } from "./pages/Minutes";
import { FilingsPage } from "./pages/Filings";
import { DeadlinesPage } from "./pages/Deadlines";
import { DocumentsPage } from "./pages/Documents";
import { ConflictsPage } from "./pages/Conflicts";
import { FinancialsPage } from "./pages/Financials";
import { PrivacyPage } from "./pages/Privacy";
import { SettingsPage } from "./pages/Settings";
import { CommitteesPage } from "./pages/Committees";
import { CommitteeDetailPage } from "./pages/CommitteeDetail";
import { GoalsPage } from "./pages/Goals";
import { GoalDetailPage } from "./pages/GoalDetail";
import { TasksPage } from "./pages/Tasks";
import { TimelinePage } from "./pages/Timeline";
import { NotificationsPage } from "./pages/Notifications";
import { UsersPage } from "./pages/Users";
import { AuditLogPage } from "./pages/AuditLog";
import { ExportsPage } from "./pages/Exports";
import { AgendaBuilderPage } from "./pages/AgendaBuilder";
import { MotionLibraryPage } from "./pages/MotionLibrary";
import { TreasurerPage } from "./pages/Treasurer";
import { MembershipPage } from "./pages/Membership";
import { InspectionsPage } from "./pages/Inspections";
import { AttestationsPage } from "./pages/Attestations";
import { RetentionPage } from "./pages/Retention";
import { InsurancePage } from "./pages/Insurance";
import { PipaTrainingPage } from "./pages/PipaTraining";
import { ProxiesPage } from "./pages/Proxies";
import { AuditorsPage } from "./pages/Auditors";
import { MemberProposalsPage } from "./pages/MemberProposals";
import { ReceiptsPage } from "./pages/Receipts";
import { EmployeesPage } from "./pages/Employees";
import { CourtOrdersPage } from "./pages/CourtOrders";
import { WrittenResolutionsPage } from "./pages/WrittenResolutions";
import { AgmWorkflowPage } from "./pages/AgmWorkflow";
import { FilingPreFillPage } from "./pages/FilingPreFill";
import { BylawDiffPage } from "./pages/BylawDiff";
import { BylawsHistoryPage } from "./pages/BylawsHistory";
import { ReconciliationPage } from "./pages/Reconciliation";
import { LandingPage } from "./pages/Landing";
import { LoginPage } from "./pages/Login";
import { BylawRulesPage } from "./pages/BylawRules";
import { ElectionsPage } from "./pages/Elections";
import { ElectionDetailPage } from "./pages/ElectionDetail";
import { PortalPage } from "./pages/Portal";
import { CommunicationsPage } from "./pages/Communications";
import { VolunteersPage } from "./pages/Volunteers";
import { GrantsPage } from "./pages/Grants";
import { TransparencyPage } from "./pages/Transparency";
import { PublicTransparencyPage } from "./pages/PublicTransparency";
import { VolunteerApplyPage } from "./pages/VolunteerApply";
import { GrantApplyPage } from "./pages/GrantApply";
import "./i18n";
import "./theme/tokens.css";
import "./styles/index.scss";

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
        <Routes>
          <Route
            path="/"
            element={staticDemoRuntime ? <Navigate to="/app" replace /> : <LandingPage />}
          />
          <Route element={<AppProviders client={convexClient} />}>
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
            <Route path="members" element={<MembersPage />} />
            <Route path="directors" element={<DirectorsPage />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="meetings/:id" element={<MeetingDetailPage />} />
            <Route path="minutes" element={<MinutesPage />} />
            <Route path="filings" element={<FilingsPage />} />
            <Route path="deadlines" element={<DeadlinesPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="conflicts" element={<ConflictsPage />} />
            <Route path="financials" element={<FinancialsPage />} />
            <Route
              path="grants"
              element={withModule("grants", <GrantsPage />)}
            />
            <Route path="privacy" element={<PrivacyPage />} />
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
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="exports" element={<ExportsPage />} />
            <Route path="agendas" element={<AgendaBuilderPage />} />
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
            <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
