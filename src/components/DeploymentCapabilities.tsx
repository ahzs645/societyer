import { createContext, useContext, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../lib/convexApi";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import { setDeploymentUnavailableModules } from "../lib/modules";
import { ALL_CAPABILITIES, LOCAL_RUNTIME_CAPABILITIES, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE, STATIC_DEMO_CAPABILITIES, type DeploymentCapabilities } from "../../shared/deploymentCapabilities";

const CapabilitiesContext = createContext<DeploymentCapabilities>(ALL_CAPABILITIES);

const BROWSER_CONNECTORS_UNAVAILABLE =
  "This deployment doesn't run the browser connector service. An operator runs the connector runner and sets SOCIETYER_BROWSER_CONNECTORS=1 on Convex to enable it.";
const PROCUREMENT_REVIEW_LOCAL =
  "Procurement review reads a SharePoint folder through the hosted Societyer server, so it isn't available in the local or desktop app.";

/**
 * Loads which optional services the hosted deployment runs before the app
 * renders, so navigation, search and module gates never offer a feature whose
 * service is missing. The local and desktop runtimes bring their own services,
 * and the no-login demo simulates them.
 */
export function DeploymentCapabilitiesGate({ children }: { children: React.ReactNode }) {
  const local = isLocalDataRuntime();
  const loaded = useQuery(api.http.deploymentCapabilities, local ? "skip" : {});
  const capabilities = isStaticDemoRuntime() ? STATIC_DEMO_CAPABILITIES : local ? LOCAL_RUNTIME_CAPABILITIES : loaded;
  const value = useMemo(() => {
    if (!capabilities) return undefined;
    // Module checks are plain functions across the app; set before children render.
    setDeploymentUnavailableModules({
      ...(capabilities.browserConnectors ? {} : { browserConnectors: BROWSER_CONNECTORS_UNAVAILABLE }),
      ...(capabilities.procurementReview ? {} : { procurementReview: local ? PROCUREMENT_REVIEW_LOCAL : PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE }),
    });
    return capabilities;
  }, [capabilities, local]);
  if (!value) return <div className="page"><p className="muted">Loading workspace…</p></div>;
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useDeploymentCapabilities(): DeploymentCapabilities {
  return useContext(CapabilitiesContext);
}
