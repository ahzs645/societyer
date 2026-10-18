import { useEffect, useRef } from "react";
import { useConvex } from "convex/react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useSociety } from "@/hooks/useSociety";
import { useCurrentUserId } from "@/hooks/useCurrentUser";
import { useToast } from "@/components/Toast";
import { agentToolsFor, type AgentToolContext } from "../../../shared/agentTools";
import { createBrowserAgentAdapter, toWebMcpTool, webMcpContexts } from "./browserAgentAdapter";

function reportRegistrationError(error: unknown) {
  console.warn("Societyer could not register a WebMCP tool.", error);
}

/**
 * Registers the shared agent tools (shared/agentTools) with WebMCP for the
 * signed-in user's role in the active workspace. Only tools the role may use
 * are registered; each call is still checked by the functions it runs.
 */
export function WebMcpTools() {
  const society = useSociety();
  const userId = useCurrentUserId() ?? undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const convex = useConvex();
  const { loaded, role, permissions } = usePermissions();
  const societyId = society?._id as string | undefined;
  const permissionKey = permissions.join(",");

  // Calls read the latest page state, not what it was at registration.
  const context = useRef<AgentToolContext | null>(null);
  context.current = societyId
    ? {
        surface: "browser",
        workspace: { id: societyId, name: society?.name, jurisdictionCode: society?.jurisdictionCode, entityType: society?.entityType },
        principal: { userId, role, permissions },
        browser: { navigate, notify: (title, detail) => toast.success(title, detail) },
        now: () => new Date(),
      }
    : null;

  useEffect(() => {
    const modelContexts = webMcpContexts();
    if (!societyId || !loaded || !modelContexts.length) return;
    const lifecycle = new AbortController();
    const tools = agentToolsFor({ surface: "browser", permissions: permissionKey ? permissionKey.split(",") : [] });
    const adapter = () => {
      if (!context.current) throw new Error("No Societyer workspace is selected.");
      return createBrowserAgentAdapter(convex, context.current);
    };
    const names = tools.map((tool) => tool.name).join(",");
    const registrations = modelContexts.flatMap((modelContext) =>
      tools.map((tool) => Promise.resolve(modelContext.registerTool(toWebMcpTool(tool, adapter), { signal: lifecycle.signal }))));
    void Promise.all(registrations)
      .then(() => {
        if (!lifecycle.signal.aborted) document.documentElement.dataset.webmcpTools = names;
      })
      .catch(reportRegistrationError);
    return () => {
      lifecycle.abort();
      if (document.documentElement.dataset.webmcpTools === names) delete document.documentElement.dataset.webmcpTools;
    };
  }, [convex, societyId, loaded, permissionKey]);

  return null;
}
