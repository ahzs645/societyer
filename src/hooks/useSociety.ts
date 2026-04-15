import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useSociety() {
  return useQuery(api.society.get, {});
}

export function useSeed() {
  return useMutation(api.seed.run);
}
