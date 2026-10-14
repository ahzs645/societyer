import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  cardsWorkspacePortable,
  cardsUpsertCardPortable,
  cardsRemoveCardPortable,
  cardsUpsertStatementPortable,
  cardsRemoveStatementPortable,
  cardsSetStatementReconciledPortable,
} from "../shared/functions/businessRegisters";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Corporate cards register: card accounts (last four digits only), monthly
// statements and their reconciliation against the card lines in the bank
// feed. No card issuing and no payments.

export const workspace = authorizedQuery("corporateCards:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => cardsWorkspacePortable(await toPortableQueryCtx(ctx), args),
});

export const upsertCard = authorizedMutation("corporateCards:upsertCard", mutation)({
  args: {
    id: v.optional(v.id("corporateCards")),
    societyId: v.id("societies"),
    nickname: v.optional(v.string()),
    cardholderName: v.string(),
    employeeId: v.optional(v.id("employees")),
    last4: v.string(),
    issuer: v.string(),
    network: v.optional(v.string()),
    limitCents: v.optional(v.number()),
    financialAccountId: v.optional(v.id("financialAccounts")),
    agreementDocumentId: v.optional(v.id("documents")),
    status: v.optional(v.string()),
    openedOn: v.optional(v.string()),
    closedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => cardsUpsertCardPortable(await toPortableMutationCtx(ctx), args),
});

export const removeCard = authorizedMutation("corporateCards:removeCard", mutation)({
  args: { id: v.id("corporateCards") },
  returns: v.any(),
  handler: async (ctx, args) => cardsRemoveCardPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertStatement = authorizedMutation("corporateCards:upsertStatement", mutation)({
  args: {
    id: v.optional(v.id("cardStatements")),
    societyId: v.id("societies"),
    cardId: v.id("corporateCards"),
    periodStart: v.string(),
    periodEnd: v.string(),
    statementDate: v.optional(v.string()),
    paymentDueDate: v.optional(v.string()),
    previousBalanceCents: v.number(),
    statementBalanceCents: v.number(),
    documentId: v.optional(v.id("documents")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => cardsUpsertStatementPortable(await toPortableMutationCtx(ctx), args),
});

export const removeStatement = authorizedMutation("corporateCards:removeStatement", mutation)({
  args: { id: v.id("cardStatements") },
  returns: v.any(),
  handler: async (ctx, args) => cardsRemoveStatementPortable(await toPortableMutationCtx(ctx), args),
});

export const setStatementReconciled = authorizedMutation("corporateCards:setStatementReconciled", mutation)({
  args: { id: v.id("cardStatements"), reconciled: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => cardsSetStatementReconciledPortable(await toPortableMutationCtx(ctx), args),
});
