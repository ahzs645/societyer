import { useMemo, useRef } from "react";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { permissionedMutation } from "../lib/permissionedMutation";

/** Pass a flag from the page's current usePermissions result; pending authority denies writes. */
export function usePermissionedMutation<Mutation extends FunctionReference<"mutation">>(
  reference: Mutation,
  allowed: boolean,
): ReactMutation<Mutation> {
  const mutation = useMutation(reference);
  const authority = useRef(allowed);
  authority.current = allowed;
  return useMemo(() => permissionedMutation(mutation, () => authority.current), [mutation]);
}
