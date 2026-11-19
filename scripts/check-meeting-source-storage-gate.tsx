// The shared frontend must not mount the SharePoint broker client in a native
// workspace, while loading, or after switching away from a SharePoint workspace.
// Uses the real Convex React subscription hooks with an in-memory query source.
//   node --import tsx scripts/check-meeting-source-storage-gate.tsx
import assert from "node:assert/strict";
import React, { useEffect } from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { WorkspaceMeetingSourceGate } from "../src/features/meetings/components/WorkspaceMeetingSourceGate";
import type { WorkspaceStoragePolicy } from "../src/lib/runtimeMode";

const policies = new Map<string, WorkspaceStoragePolicy>();
const listeners = new Map<string, Set<() => void>>();
const queries: string[] = [];
const client = {
  watchQuery(query: Parameters<typeof getFunctionName>[0], args: { societyId: string }) {
    assert.equal(getFunctionName(query), "workspaceStoragePolicies:forWorkspace");
    queries.push(args.societyId);
    return {
      localQueryResult: () => policies.get(args.societyId),
      onUpdate(callback: () => void) {
        const callbacks = listeners.get(args.societyId) ?? new Set<() => void>();
        callbacks.add(callback);
        listeners.set(args.societyId, callbacks);
        return () => { callbacks.delete(callback); };
      },
      journal: () => undefined,
    };
  },
} as unknown as ConvexReactClient;

const mounted: string[] = [];
const cleanedUp: string[] = [];
function BrokerClient({ societyId }: { societyId: string }) {
  useEffect(() => {
    mounted.push(societyId);
    return () => { cleanedUp.push(societyId); };
  }, [societyId]);
  return <span>SharePoint files for {societyId}</span>;
}

function View({ societyId }: { societyId: string }) {
  return <ConvexProvider client={client}>
    <WorkspaceMeetingSourceGate societyId={societyId}>
      <BrokerClient societyId={societyId} />
    </WorkspaceMeetingSourceGate>
  </ConvexProvider>;
}

function publish(societyId: string, policy: WorkspaceStoragePolicy) {
  policies.set(societyId, policy);
  for (const callback of listeners.get(societyId) ?? []) callback();
}

const sharePoint = { nativeUploads: false, documentVersionProvider: "sharepoint" as const };
const native = { nativeUploads: true, documentVersionProvider: "native" as const };
let renderer: ReactTestRenderer;
await act(async () => { renderer = create(<View societyId="ddc-like" />); });
assert.equal(renderer!.toJSON(), null, "loading policy does not mount the broker client");
assert.deepEqual(mounted, []);
assert.ok(queries.includes("ddc-like"), "the policy belongs to the meeting's explicit workspace");

await act(async () => { publish("ddc-like", sharePoint); });
assert.deepEqual(mounted, ["ddc-like"]);
assert.ok(renderer!.toJSON(), "SharePoint workspace shows its broker controls");

await act(async () => { renderer!.update(<View societyId="firstform-like" />); });
assert.equal(renderer!.toJSON(), null, "switching to an unresolved workspace never reuses the old policy");
assert.deepEqual(cleanedUp, ["ddc-like"], "the previous broker client unmounts, allowing transfer cleanup");
await act(async () => { publish("ddc-like", sharePoint); });
assert.equal(renderer!.toJSON(), null, "late updates for the previous workspace cannot show controls");
await act(async () => { publish("firstform-like", native); });
assert.equal(renderer!.toJSON(), null, "native workspace does not mount any SharePoint client");
assert.deepEqual(mounted, ["ddc-like"]);

await act(async () => { renderer!.update(<View societyId="ddc-like" />); });
assert.deepEqual(mounted, ["ddc-like", "ddc-like"], "switching back restores the correct workspace's controls");
await act(async () => { publish("ddc-like", native); });
assert.equal(renderer!.toJSON(), null, "a live provider-policy change removes the broker controls");
assert.deepEqual(cleanedUp, ["ddc-like", "ddc-like"]);

const beforeEmpty = queries.length;
await act(async () => { renderer!.update(<View societyId="" />); });
assert.equal(renderer!.toJSON(), null);
assert.equal(queries.length, beforeEmpty, "an absent workspace does not issue a policy query");
await act(async () => { renderer!.unmount(); });
assert.ok([...listeners.values()].every(callbacks => callbacks.size === 0), "all subscriptions are cleaned up");
console.log("Meeting source storage gate passed: SharePoint, native, loading, workspace switches, stale updates and live policy changes.");
