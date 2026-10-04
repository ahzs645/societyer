import type { ReactMutation } from "convex/react";
import type { FunctionReference } from "convex/server";

/** Check current authority before Convex can send or optimistically apply a write. */
export function permissionedMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: ReactMutation<Mutation>,
  isAllowed: () => boolean,
): ReactMutation<Mutation> {
  const guarded = ((...args: Parameters<ReactMutation<Mutation>>) => {
    if (!isAllowed()) return Promise.reject(new Error("Your workspace role cannot perform this action."));
    return mutation(...args);
  }) as ReactMutation<Mutation>;
  guarded.withOptimisticUpdate = (update) =>
    permissionedMutation(mutation.withOptimisticUpdate(update), isAllowed);
  return guarded;
}
