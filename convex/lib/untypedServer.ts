import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

import { meetingInvalidatingMutation } from "./offlineMeetingInvalidation";

export const query = queryGeneric as any;
export const internalQuery = internalQueryGeneric as any;
export const mutation = mutationGeneric as any;
export const internalMutation = meetingInvalidatingMutation(internalMutationGeneric) as any;
export const action = actionGeneric as any;
export const internalAction = internalActionGeneric as any;

