// Operator-only qualification helpers. This directory is never deployed to production.
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { runPortable } from "../../../shared/functions/seed";
import { toPortableMutationCtx } from "../../../convex/lib/portable";

function guard(issuer?: string) {
  if (process.env.OFFLINE_LOCAL_QUALIFICATION !== "1") throw new Error("Local qualification fixtures are disabled.");
  if (issuer && issuer !== process.env.BETTER_AUTH_BASE_URL) throw new Error("Fixture issuer must be the configured local broker.");
}
export const seedDemo = internalMutationGeneric({
  args: { owner: v.object({ issuer: v.string(), subject: v.string(), email: v.string() }) },
  handler: async (ctx, { owner }) => {
    guard(owner.issuer);
    const portable = await toPortableMutationCtx(ctx);
    // An operator bootstraps this disposable database with a real broker account.
    // Bind the demo Owner as it is inserted, before the unchanged seeder invokes
    // its membership-gated motion reconciliation. This never changes production
    // seed handlers or allows a public caller to mint a principal.
    const db = new Proxy(portable.db, { get(target, property, receiver) {
      if (property === "insert") return (table: any, values: any) => target.insert(table,
        table === "users" && values.role === "Owner" ? { ...values, authSubject: owner.subject, authIssuer: owner.issuer, authProvider: "better-auth", email: owner.email } : values);
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    return runPortable({ ...portable, db, principal: { kind: "user", runtime: "convex-hosted", assurance: "verified-jwt", subject: owner.subject, issuer: owner.issuer, authProvider: "better-auth" } });
  },
});
export const seed = internalMutationGeneric({
  args: { societyId: v.id("societies"), issuer: v.string(), identities: v.array(v.object({ key: v.string(), subject: v.string(), email: v.string(), role: v.string(), status: v.optional(v.string()) })) },
  handler: async (ctx, { societyId, issuer, identities }) => {
    guard(issuer);
    if (!(await ctx.db.get(societyId))) throw new Error("Qualification society is missing.");
    const societyB = await ctx.db.insert("societies", { name: "Foreign qualification workspace", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    const existing = await ctx.db.query("users").withIndex("by_society", q => q.eq("societyId", societyId)).collect();
    const selected = new Set<string>();
    const users: Record<string, string> = {};
    for (const identity of identities) {
      if (!["Owner", "Admin", "Director", "Member", "Viewer"].includes(identity.role)) throw new Error("Invalid qualification role.");
      const targetSociety = identity.key.endsWith("-b") ? societyB : societyId;
      const row = targetSociety === societyId && identity.status !== "Disabled" && identity.status !== "Invited"
        ? existing.find(user => user.role === identity.role && (!user.authSubject || (user.authSubject === identity.subject && user.authIssuer === issuer)) && !selected.has(user._id)) : undefined;
      const values = { societyId: targetSociety, role: identity.role, status: identity.status ?? "Active", email: identity.email,
        displayName: identity.key, authSubject: identity.subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() };
      const id = row ? (await ctx.db.patch(row._id, values), row._id) : await ctx.db.insert("users", values);
      selected.add(id); users[identity.key] = id;
    }
    return { societyA: societyId, societyB, users };
  },
});
export const inspect = internalQueryGeneric({ args: { societyId: v.id("societies"), table: v.string() }, handler: async (ctx, { societyId, table }) => {
  guard();
  // Never expose storage/authentication tables, and never return more than a bounded fixture sample.
  const tables = ["societies", "users", "members", "directors", "employees", "committees", "meetings", "minutes", "agendas", "agendaItems", "motions", "proxies", "conflicts", "directorAttestations", "auditorAppointments", "courtOrders", "filings", "deadlines", "commitments", "financials", "elections", "documents", "tasks", "volunteers", "grants", "communicationTemplates", "objectMetadata", "fieldMetadata", "views", "workflowRuns", "workflows", "insurancePolicies", "assets", "meetingTemplates", "goals", "waveCacheResources", "assetVerificationRuns", "legalPrecedentRuns", "generatedLegalDocuments"];
  if (!tables.includes(table)) throw new Error("Table is outside the qualification fixture allowlist.");
  if (table === "societies") return [await ctx.db.get(societyId)].filter(Boolean);
  // Child tables without their own society key are resolved through their fixed parent fields.
  if (table === "agendaItems") {
    const agendas = await ctx.db.query("agendas").withIndex("by_society", q => q.eq("societyId", societyId)).take(100);
    const rows = [];
    for (const agenda of agendas) rows.push(...await ctx.db.query("agendaItems").withIndex("by_agenda", q => q.eq("agendaId", agenda._id)).take(100));
    return rows.slice(0, 100);
  }
  return ctx.db.query(table).withIndex("by_society", q => q.eq("societyId", societyId)).take(100);
} });

export const seedPublicIntake = internalMutationGeneric({ args: {}, handler: async ctx => {
  guard();
  const societyId = await ctx.db.insert("societies", { name: "Public intake qualification", isCharity: false, isMemberFunded: false, updatedAt: Date.now(), publicSlug: `qualification-${Date.now()}`, publicTransparencyEnabled: true, publicVolunteerIntakeEnabled: true, publicGrantIntakeEnabled: true });
  const privateSocietyId = await ctx.db.insert("societies", { name: "Unpublished intake qualification", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const memberId = await ctx.db.insert("members", { societyId, firstName: "Protected", lastName: "Member", status: "Active", membershipClass: "Regular", joinedAt: "2026-10-04", votingRights: true });
  const grant = { societyId, title: "Qualification public opportunity", funder: "Test", status: "Open", createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() };
  const publicGrantId = await ctx.db.insert("grants", { ...grant, allowPublicApplications: true });
  const privateGrantId = await ctx.db.insert("grants", { ...grant, title: "Qualification private opportunity", allowPublicApplications: false });
  return { societyId, privateSocietyId, memberId, publicGrantId, privateGrantId, slug: (await ctx.db.get(societyId))!.publicSlug };
} });
export const configurePublicIntake = internalMutationGeneric({
  args: { societyId: v.id("societies"), disabledModules: v.array(v.string()), published: v.boolean(), volunteerEnabled: v.boolean(), grantEnabled: v.boolean(), opportunitiesOpen: v.boolean() },
  handler: async (ctx, args) => {
    guard();
    await ctx.db.patch(args.societyId, { disabledModules: args.disabledModules, publicTransparencyEnabled: args.published, publicVolunteerIntakeEnabled: args.volunteerEnabled, publicGrantIntakeEnabled: args.grantEnabled });
    const grants = await ctx.db.query("grants").withIndex("by_society", q => q.eq("societyId", args.societyId)).collect();
    for (const grant of grants) if (grant.title === "Qualification public opportunity") await ctx.db.patch(grant._id, { allowPublicApplications: args.opportunitiesOpen });
  },
});

export const seedLegacyDirectory = internalMutationGeneric({
  args: { societyA: v.id("societies"), societyB: v.id("societies"), prefix: v.string() },
  handler: async (ctx, { societyA, societyB, prefix }) => {
    guard();
    const rows: Record<string, string> = {};
    for (const [key, societies] of [["soleA", [societyA]], ["soleB", [societyB]], ["shared", [societyA, societyB]], ["unlinked", []]] as const) {
      const name = `${prefix} ${key}`;
      const nowISO = new Date().toISOString();
      const id = await ctx.db.insert("peopleDirectory", { fullName: name, searchName: name.toLowerCase(), createdAtISO: nowISO, updatedAtISO: nowISO });
      rows[key] = id;
      for (const societyId of societies) await ctx.db.insert("roleHolders", { societyId, directoryPersonId: id, roleType: "other", status: "current", fullName: name, citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: nowISO, updatedAtISO: nowISO });
    }
    return rows;
  },
});

export const seedBatchSociety = internalMutationGeneric({
  args: { issuer: v.string(), identities: v.array(v.object({ subject: v.string(), email: v.string(), role: v.string(), status: v.string() })) },
  handler: async (ctx, { issuer, identities }) => {
    guard(issuer);
    const societyId = await ctx.db.insert("societies", { name: "Packet authorization qualification", entityType: "society", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", jurisdictionCode: "CA-BC", incorporationNumber: "S-QUALIFICATION", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    for (const identity of identities) await ctx.db.insert("users", { societyId, role: identity.role, status: identity.status, email: identity.email, displayName: identity.role, authSubject: identity.subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
    return { societyId };
  },
});
export const cleanupBatchMemberships = internalMutationGeneric({ args: { societyId: v.id("societies") }, handler: async (ctx, { societyId }) => {
  guard();
  const society = await ctx.db.get(societyId);
  if (society?.name !== "Packet authorization qualification") throw new Error("Only the packet fixture can be cleaned up.");
  const members = await ctx.db.query("users").withIndex("by_society", q => q.eq("societyId", societyId)).collect();
  for (const member of members) await ctx.db.delete(member._id);
} });

export const seedEligibleMemberElection = internalMutationGeneric({
  args: { issuer: v.string(), owner: v.object({ subject: v.string(), email: v.string() }), member: v.object({ subject: v.string(), email: v.string() }) },
  handler: async (ctx, { issuer, owner, member }) => {
    guard(issuer);
    const societyId = await ctx.db.insert("societies", { name: "Eligible member election qualification", entityType: "society", actFormedUnder: "societies_act", jurisdictionCode: "CA-BC", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    const memberId = await ctx.db.insert("members", { societyId, firstName: "Eligible", lastName: "Voter", email: member.email, membershipClass: "Regular", status: "Active", joinedAt: "2026-01-01", votingRights: true });
    const membership = { societyId, status: "Active", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() };
    const ownerUserId = await ctx.db.insert("users", { ...membership, role: "Owner", displayName: "Election operator", authSubject: owner.subject, email: owner.email });
    const memberUserId = await ctx.db.insert("users", { ...membership, role: "Member", displayName: "Eligible voter", authSubject: member.subject, email: member.email, memberId });
    const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign election qualification", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    const foreignElectionId = await ctx.db.insert("elections", { societyId: foreignSocietyId, title: "Protected foreign election", status: "Open", opensAtISO: "2026-01-01T00:00:00Z", closesAtISO: "2027-01-01T00:00:00Z", anonymousBallot: true, createdAtISO: new Date().toISOString(), updatedAtISO: new Date().toISOString() });
    const foreignQuestionId = await ctx.db.insert("electionQuestions", { societyId: foreignSocietyId, electionId: foreignElectionId, title: "Foreign question", maxSelections: 1, options: [{ id: "foreign", label: "Foreign candidate" }], order: 0 });
    return { societyId, memberId, ownerUserId, memberUserId, foreignSocietyId, foreignElectionId, foreignQuestionId };
  },
});
export const cleanupElectionOperator = internalMutationGeneric({
  args: { societyId: v.id("societies"), ownerUserId: v.id("users") },
  handler: async (ctx, { societyId, ownerUserId }) => {
    guard();
    if ((await ctx.db.get(societyId))?.name !== "Eligible member election qualification") throw new Error("Only the election fixture can be cleaned up.");
    const operator = await ctx.db.get(ownerUserId);
    if (operator?.societyId !== societyId || operator?.role !== "Owner") throw new Error("Invalid election fixture operator.");
    await ctx.db.delete(ownerUserId);
  },
});

export const seedStructuredRegisters = internalMutationGeneric({
  args: { issuer: v.string(), identities: v.array(v.object({ subject: v.string(), email: v.string(), role: v.string() })) },
  handler: async (ctx, {issuer,identities}) => {
    guard(issuer);
    if(identities.length !== 3 || new Set(identities.map(row=>row.role)).size !== 3 || identities.some(row=>!["Owner","Viewer","Member"].includes(row.role))) throw new Error("Qualification needs exactly Owner, Viewer and Member.");
    const oldISO = "2025-01-01T00:00:00Z", newISO = "2026-01-01T00:00:00Z";
    const societyId = await ctx.db.insert("societies",{name:"Structured register qualification",isCharity:false,isMemberFunded:false,updatedAt:Date.now()});
    for(const identity of identities) await ctx.db.insert("users",{societyId,role:identity.role,status:"Active",displayName:`Structured ${identity.role}`,email:identity.email,authSubject:identity.subject,authIssuer:issuer,authProvider:"better-auth",createdAtISO:newISO});
    const rows: Record<string, any> = {};
    for(const roleType of ["director","officer","controller","member","other"]) {
      rows[roleType] = await ctx.db.insert("roleHolders",{societyId,roleType,status:"current",fullName:`${roleType} current`,email:`${roleType}@private.test`,citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],enteredAtISO:newISO,createdAtISO:oldISO,updatedAtISO:newISO});
      await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:rows[roleType],dataJson:JSON.stringify({roleType,status:"current",fullName:`${roleType} prior`,email:`${roleType}@private.test`}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO});
    }
    rows.changed = await ctx.db.insert("roleHolders",{societyId,roleType:"other",status:"current",fullName:"Readable representative",citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],enteredAtISO:newISO,createdAtISO:oldISO,updatedAtISO:newISO});
    await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:rows.changed,dataJson:JSON.stringify({roleType:"director",fullName:"Forbidden prior director",status:"current"}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO});
    rows.deleted = await ctx.db.insert("roleHolders",{societyId,roleType:"officer",status:"current",fullName:"Deleted officer",citizenshipCountries:[],taxResidenceCountries:[],relatedShareholderIds:[],controllingIndividualIds:[],sourceDocumentIds:[],sourceExternalIds:[],createdAtISO:oldISO,updatedAtISO:oldISO});
    await ctx.db.insert("roleHolderRevisions",{societyId,roleHolderId:rows.deleted,dataJson:JSON.stringify({roleType:"officer",fullName:"Deleted officer",status:"current"}),enteredAtISO:oldISO,supersededAtISO:newISO,createdAtISO:newISO}); await ctx.db.delete(rows.deleted);
    return {societyId,rows};
  },
});
export const cleanupStructuredRegisters = internalMutationGeneric({
  args:{societyId:v.id("societies")},
  handler:async(ctx,{societyId})=>{
    guard();
    if((await ctx.db.get(societyId))?.name !== "Structured register qualification") throw new Error("Not a structured register fixture.");
    for(const user of await ctx.db.query("users").withIndex("by_society",q=>q.eq("societyId",societyId)).collect()) await ctx.db.delete(user._id);
    return null;
  },
});
