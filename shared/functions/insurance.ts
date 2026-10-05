/**
 * PORTABLE FUNCTIONS: the insurance domain (list / create / update / remove).
 *
 * Straight CRUD over the `insurancePolicies` table on `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { renewalPolicyDraft } from "../insuranceHistory";

export async function createRenewalPortable(ctx: PortableMutationCtx, args: {
  id: string; policyNumber: string; startDate: string; endDate: string;
  premiumCents?: number; policyFeeCents?: number; totalCostCents?: number;
}) {
  const original = await ctx.db.get(args.id, "insurancePolicies");
  if (!original || typeof original.societyId !== "string") throw new Error("insurancePolicies not found.");
  await requireSocietyMembership(ctx, original.societyId);
  await getOwned(ctx, "insurancePolicies", args.id, original.societyId);
  for (const date of [args.startDate, args.endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error("Enter valid policy term dates.");
    }
  }
  if (args.endDate <= args.startDate) throw new Error("The renewal end date must follow its start date.");
  if (!args.policyNumber.trim()) throw new Error("Enter the renewal policy number.");
  for (const amount of [args.premiumCents, args.policyFeeCents, args.totalCostCents]) {
    if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error("Costs must be nonnegative amounts in cents.");
  }
  const draft = renewalPolicyDraft(original as any);
  const now = new Date().toISOString();
  if (!original.policySeriesKey?.trim()) await ctx.db.patch(args.id, { policySeriesKey: draft.policySeriesKey, updatedAtISO: now });
  return ctx.db.insert("insurancePolicies", {
    ...draft,
    societyId: original.societyId,
    policyNumber: args.policyNumber.trim(),
    startDate: args.startDate,
    endDate: args.endDate,
    renewalDate: args.endDate,
    policyTermLabel: `${args.startDate.slice(0, 4)}-${args.endDate.slice(0, 4)}`,
    premiumCents: args.premiumCents,
    policyFeeCents: args.policyFeeCents,
    totalCostCents: args.totalCostCents,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("insurancePolicies")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  await requireSocietyMembership(ctx, String(args.societyId));
  for (const documentId of Array.isArray(args.sourceDocumentIds) ? args.sourceDocumentIds : []) {
    await getOwned(ctx, "documents", String(documentId), String(args.societyId));
  }
  const now = new Date().toISOString();
  return await ctx.db.insert("insurancePolicies", {
    ...args,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: Record<string, any> },
) {
  const candidate = await ctx.db.get(id, "insurancePolicies");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("insurancePolicies not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "insurancePolicies", id, candidate.societyId);
  for (const documentId of Array.isArray(patch.sourceDocumentIds) ? patch.sourceDocumentIds : []) {
    await getOwned(ctx, "documents", String(documentId), candidate.societyId);
  }
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "insurancePolicies");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("insurancePolicies not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "insurancePolicies", id, candidate.societyId);
  await ctx.db.delete(id);
}

export async function appendOperations(ctx: PortableMutationCtx, args: { id:string; moneyEntries?:any[]; amendments?:any[]; requirementChecks?:any[] }) {
  const { requireOwnedRow, principalUserId }=await import('./access');const { requirePermissionPortable }=await import('./permissions');
  const { requireEvidence, exactDay, uniqueRows }=await import('../evidenceReview');
  const policy=await requireOwnedRow(ctx,'insurancePolicies',args.id);const societyId=String(policy.societyId);
  await requirePermissionPortable(ctx,societyId,'financials:write');
  const patch:any={updatedAtISO:new Date().toISOString()};
  for(const field of ['moneyEntries','amendments','requirementChecks'] as const){
    const additions=args[field]??[];uniqueRows(additions);
    for(const row of additions){requireEvidence(row);if(!exactDay(row.observedDate))throw new Error('Operations require a valid evidenced day.');
      if(!['pending','verified','rejected'].includes(row.reviewStatus))throw new Error('Invalid review status.');
      if(field==='moneyEntries'){
        if(!['invoice','payment','refund','credit','claim_cost','recovery'].includes(row.kind)||!String(row.currency??'').trim())throw new Error('Record an entry kind and currency.');
        if(row.amountCents!=null&&(!Number.isSafeInteger(row.amountCents)||row.amountCents<0))throw new Error('Amounts must be nonnegative cents or unknown; entry kind determines the sign.');
      }
      if(field==='amendments'&&!['cancellation','endorsement','reinstatement'].includes(row.kind))throw new Error('Invalid policy amendment.');
    }
    const existing=policy[field]??[];const next=[...existing];
    for(const row of additions){const before=existing.find((item:any)=>item.id===row.id);if(before){if(JSON.stringify(before)!==JSON.stringify(row))throw new Error('Conflicting evidence ID. Append a new dated record.');}else next.push(row);}
    if(additions.length)patch[field]=next;
  }
  const events=(patch.amendments??policy.amendments??[]).filter((row:any)=>row.reviewStatus==='verified'&&row.observedDate<=new Date().toISOString().slice(0,10)).sort((a:any,b:any)=>a.observedDate.localeCompare(b.observedDate));
  const last=events.filter((row:any)=>['cancellation','reinstatement'].includes(row.kind)).at(-1);
  if(last)patch.status=last.kind==='cancellation'?'Cancelled':'Active';
  await ctx.db.patch(args.id,patch);return args.id;
}

export async function ensureRenewalTasks(ctx:PortableMutationCtx,args:{societyId:string;asOf:string;ownerUserId?:string}){
  const {requirePermissionPortable}=await import('./permissions');const {principalUserId}=await import('./access');
  const {exactDay}=await import('../evidenceReview');const {currentRenewalPolicies}=await import('../insuranceOperations');
  await requireSocietyMembership(ctx,args.societyId);await requirePermissionPortable(ctx,args.societyId,'financials:read');await requirePermissionPortable(ctx,args.societyId,'tasks:write');
  if(!exactDay(args.asOf))throw new Error('A valid scan day is required.');
  const ownerUserId=args.ownerUserId??await principalUserId(ctx,args.societyId);await getOwned(ctx,'users',ownerUserId,args.societyId);
  const policies=await listPortable(ctx,{societyId:args.societyId});const current=currentRenewalPolicies(policies,args.asOf);
  const tasks=await ctx.db.query('tasks').withIndex('by_society',q=>q.eq('societyId',args.societyId)).collect();
  const selected=current.filter(row=>(Date.parse(row.renewalDate)-Date.parse(args.asOf))/86400000<=60);
  let created=0;
  for(const policy of selected){for(const days of [60,30,7]){
    const dueDate=new Date(Date.parse(policy.renewalDate)-days*86400000).toISOString().slice(0,10);
    const key=`${policy._id}:${policy.renewalDate}:${days}`;
    if(tasks.some(row=>row.insuranceRenewalKey===key))continue;
    const id=await ctx.db.insert('tasks',{societyId:args.societyId,title:`Review ${policy.policyNumber} renewal (${days} days)`,description:`Review the policy term ending ${policy.renewalDate}. Source policy: ${policy._id}.`,status:'Todo',priority:'High',dueDate,responsibleUserIds:[ownerUserId],tags:['insurance-renewal'],insurancePolicyId:policy._id,insuranceRenewalKey:key,createdAtISO:new Date().toISOString()});
    tasks.push({_id:id,insuranceRenewalKey:key} as any);created++;
  }}
  return {currentDue:selected.length,overdue:selected.filter(row=>row.renewalDate<args.asOf).length,created};
}
