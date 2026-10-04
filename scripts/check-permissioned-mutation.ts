import assert from "node:assert/strict";
import type { ReactMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { permissionedMutation } from "../src/lib/permissionedMutation";

type Mutation = FunctionReference<"mutation", "public", { value: string }, string>;
let allowed = false;
let sent = 0;
let optimistic = 0;
const updates: Array<() => void> = [];
const mutation = Object.assign(async ({ value }: { value: string }) => {
  sent++;
  updates.forEach((update) => update());
  return `saved:${value}`;
}, {
  withOptimisticUpdate(update: () => void) {
    updates.push(update);
    return mutation;
  },
}) as unknown as ReactMutation<Mutation>;
const guarded = permissionedMutation(mutation, () => allowed).withOptimisticUpdate(() => { optimistic++; });
await assert.rejects(guarded({ value: "denied" }), /workspace role/);
assert.equal(sent, 0);
assert.equal(optimistic, 0);
allowed = true;
assert.equal(await guarded({ value: "allowed" }), "saved:allowed");
assert.equal(sent, 1);
assert.equal(optimistic, 1);
allowed = false;
await assert.rejects(guarded({ value: "revoked" }), /workspace role/);
assert.equal(sent, 1);
assert.equal(optimistic, 1);
console.log("PASS permissioned mutation denies pending/revoked writes before transport and optimistic updates; permitted results/options preserved");
