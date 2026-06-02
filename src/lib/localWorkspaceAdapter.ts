import { staticConvex, reseedStaticDemoData } from "./staticConvex";
import { getRuntimeDescriptor, type RuntimeDescriptor } from "./runtimeMode";

export type LocalWorkspaceAdapter = {
  client: typeof staticConvex;
  runtime: RuntimeDescriptor;
  reseed(): void;
};

export function createLocalWorkspaceAdapter(): LocalWorkspaceAdapter {
  const runtime = getRuntimeDescriptor();
  return {
    client: staticConvex,
    runtime,
    reseed: reseedStaticDemoData,
  };
}
