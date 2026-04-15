// @ts-nocheck
import { query } from "./_generated/server";
import { v } from "convex/values";
import { getActiveBylawRuleSet } from "./lib/bylawRules";

export const summary = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [society, members, directors, meetings, filings, deadlines, conflicts, committees, goals, tasks, rules] = await Promise.all([
      ctx.db.get(societyId),
      ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("conflicts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("goals").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("tasks").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      getActiveBylawRuleSet(ctx, societyId),
    ]);

    const now = Date.now();
    const activeDirectors = directors.filter((d) => d.status === "Active");
    const bcResidents = activeDirectors.filter((d) => d.isBCResident).length;
    const activeMembers = members.filter((m) => m.status === "Active");
    const upcomingMeetings = meetings
      .filter((m) => new Date(m.scheduledAt).getTime() >= now && m.status === "Scheduled")
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const overdueFilings = filings.filter(
      (f) => f.status !== "Filed" && new Date(f.dueDate).getTime() < now,
    );
    const upcomingFilings = filings
      .filter((f) => f.status !== "Filed" && new Date(f.dueDate).getTime() >= now)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const openDeadlines = deadlines.filter((d) => !d.done);
    const openConflicts = conflicts.filter((c) => !c.resolvedAt);

    return {
      society,
      counts: {
        members: activeMembers.length,
        directors: activeDirectors.length,
        bcResidents,
        meetingsThisYear: meetings.filter(
          (m) => new Date(m.scheduledAt).getFullYear() === new Date().getFullYear(),
        ).length,
        overdueFilings: overdueFilings.length,
        openDeadlines: openDeadlines.length,
        openConflicts: openConflicts.length,
        committees: committees.filter((c) => c.status === "Active").length,
        openGoals: goals.filter((g) => g.status !== "Completed").length,
        openTasks: tasks.filter((t) => t.status !== "Done").length,
      },
      upcomingMeetings: upcomingMeetings.slice(0, 3),
      upcomingFilings: upcomingFilings.slice(0, 5),
      overdueFilings,
      complianceFlags: buildFlags({ society, activeDirectors, bcResidents, members, rules }),
    };
  },
});

function buildFlags(args: {
  society: any;
  activeDirectors: any[];
  bcResidents: number;
  members: any[];
  rules: any;
}) {
  const flags: { level: "ok" | "warn" | "err"; text: string }[] = [];
  const { society, activeDirectors, bcResidents } = args;
  if (!society) return flags;
  if (activeDirectors.length < 3 && !society.isMemberFunded)
    flags.push({ level: "err", text: "Fewer than 3 active directors (s.42 Societies Act)." });
  if (bcResidents < 1)
    flags.push({ level: "err", text: "No BC-resident director on record." });
  const missingConsent = activeDirectors.filter((d) => !d.consentOnFile);
  if (missingConsent.length)
    flags.push({
      level: "warn",
      text: `${missingConsent.length} director(s) missing written consent.`,
    });
  if (!society.privacyPolicyDocId)
    flags.push({ level: "warn", text: "No PIPA privacy policy on file." });
  if (!society.constitutionDocId)
    flags.push({ level: "warn", text: "Constitution not uploaded." });
  if (!society.bylawsDocId)
    flags.push({ level: "warn", text: "Bylaws not uploaded." });
  if (!args.rules?._id)
    flags.push({
      level: "warn",
      text: "Bylaw rule set not configured — governance workflows are using BC defaults.",
    });
  if (flags.length === 0)
    flags.push({ level: "ok", text: "No compliance issues detected." });
  return flags;
}
