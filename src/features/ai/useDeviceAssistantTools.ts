/**
 * The on-device assistant's tools for the person signed in to this local or
 * desktop workspace: which shared agent tools to offer (their permissions,
 * reads only unless "Allow the assistant to propose changes" is on), and the
 * adapter that runs them.
 *
 * The adapter is `createPortableAgentAdapter` over the app's client, which in
 * these runtimes is the local portable runtime (src/lib/staticConvexClient.ts):
 * every call runs a portable function on this device, as this person, with
 * its own policy. Nothing is sent anywhere by a tool; only the model request
 * leaves the page, to the address in On-device AI settings.
 */
import { useCallback, useMemo } from "react";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { usePermissions } from "@/hooks/usePermissions";
import { createPortableAgentAdapter } from "../../../shared/agentTools/portableAdapter";
import type { AgentTool, AgentToolAdapter, AgentWorkspace, ToolArgs } from "../../../shared/agentTools";
import { deviceAssistantTools } from "../../lib/localAi/assistantToolLoop";

export type DeviceAssistantTools = {
  /** Offered to the model; empty when tools are off or the model doesn't take them. */
  tools: readonly AgentTool[];
  /** Change tools an Approve may run: the setting and the person's permissions, whatever the model. */
  changeTools: readonly AgentTool[];
  /** A fresh adapter for the current person and workspace. */
  adapter: () => AgentToolAdapter;
};

export function useDeviceAssistantTools(input: {
  /** Offer tools to the model. */
  enabled: boolean;
  /** "Allow the assistant to propose changes" is on. */
  proposeChanges: boolean;
  workspace: AgentWorkspace | undefined;
  userId: string | undefined;
}): DeviceAssistantTools {
  const convex = useConvex();
  const { role, permissions } = usePermissions();
  const permissionKey = permissions.join(",");
  const { enabled, proposeChanges, workspace, userId } = input;

  const allowed = useMemo(
    () => (workspace ? deviceAssistantTools({ permissions: permissionKey ? permissionKey.split(",") : [], proposeChanges }) : []),
    [proposeChanges, workspace, permissionKey],
  );
  const tools = useMemo(() => (enabled ? allowed : []), [enabled, allowed]);
  const changeTools = useMemo(() => allowed.filter((tool) => tool.kind !== "read"), [allowed]);

  const adapter = useCallback((): AgentToolAdapter => {
    if (!workspace) throw new Error("No Societyer workspace is selected.");
    const runtime = {
      runQuery: <T>(name: string, args: ToolArgs) => convex.query(makeFunctionReference<"query", ToolArgs, T>(name), args),
      runMutation: <T>(name: string, args: ToolArgs) => convex.mutation(makeFunctionReference<"mutation", ToolArgs, T>(name), args),
    };
    return createPortableAgentAdapter(runtime, {
      surface: "device",
      workspace,
      principal: { userId, role, permissions: permissionKey ? permissionKey.split(",") : [] },
      now: () => new Date(),
    });
  }, [convex, workspace, userId, role, permissionKey]);

  return { tools, changeTools, adapter };
}
