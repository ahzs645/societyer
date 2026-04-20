// @ts-nocheck
import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Seed the demo society "Riverside Community Society".
// Idempotent-ish: if a society already exists, it wipes everything first.
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    await wipe(ctx);

    const societyId = await ctx.db.insert("societies", {
      name: "Riverside Community Society",
      incorporationNumber: "S-0098142",
      incorporationDate: "2011-03-18",
      fiscalYearEnd: "03-31",
      jurisdictionCode: "CA-BC",
      isCharity: true,
      isMemberFunded: false,
      registeredOfficeAddress: "2187 Commercial Drive, Vancouver, BC V5N 4B3",
      mailingAddress: "PO Box 4421 Stn Terminal, Vancouver, BC V6B 3Z7",
      purposes:
        "To operate a community space that supports arts programming, food security initiatives and youth mentorship in East Vancouver.",
      demoMode: true,
      privacyOfficerName: "Amara Okonkwo",
      privacyOfficerEmail: "privacy@riversidecs.ca",
      boardCadence: "Monthly",
      boardCadenceDayOfWeek: "Thursday",
      boardCadenceTime: "19:00",
      boardCadenceNotes: "Fourth Thursday of each month, except July & August.",
      updatedAt: Date.now(),
    });

    // Members
    const memberData = [
      ["Elena", "Vasquez", "Regular", true],
      ["Jordan", "Nakamura", "Regular", true],
      ["Priya", "Shah", "Regular", true],
      ["Theo", "Lafontaine", "Regular", true],
      ["Amara", "Okonkwo", "Regular", true],
      ["Dmitri", "Petrov", "Regular", true],
      ["Wei", "Chen", "Regular", true],
      ["Hannah", "Goldberg", "Regular", true],
      ["Samuel", "Ahmadi", "Regular", true],
      ["Fatima", "Al-Rashid", "Regular", true],
      ["Liam", "O'Sullivan", "Student", true],
      ["Nadia", "Volkov", "Student", true],
      ["Kai", "Tanaka", "Honorary", false],
      ["Rosa", "Martinez", "Regular", true],
      ["Oliver", "Kim", "Regular", true],
    ] as const;
    const memberIds: Record<string, any> = {};
    for (const [first, last, klass, voting] of memberData) {
      const id = await ctx.db.insert("members", {
        societyId,
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase().replace(/\W/g, "")}@example.ca`,
        membershipClass: klass,
        status: "Active",
        joinedAt: randomPastDate(4),
        votingRights: voting,
      });
      memberIds[`${first} ${last}`] = id;
    }

    // Directors
    const dirData = [
      ["Elena", "Vasquez", "President", true, "2024-06-15"],
      ["Jordan", "Nakamura", "Vice President", true, "2024-06-15"],
      ["Priya", "Shah", "Treasurer", true, "2024-06-15"],
      ["Theo", "Lafontaine", "Secretary", false, "2024-06-15"],
      ["Amara", "Okonkwo", "Director", true, "2023-06-10"],
      ["Dmitri", "Petrov", "Director", true, "2025-06-20"],
      ["Wei", "Chen", "Director", true, "2025-06-20"],
    ] as const;
    const directorIds: Record<string, any> = {};
    for (const [first, last, position, bcRes, start] of dirData) {
      const id = await ctx.db.insert("directors", {
        societyId,
        memberId: memberIds[`${first} ${last}`],
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}@riversidecs.ca`,
        position,
        isBCResident: bcRes,
        termStart: start,
        consentOnFile: true,
        status: "Active",
      });
      directorIds[`${first} ${last}`] = id;
    }

    // Meetings — past AGM + past board meeting + upcoming AGM + upcoming board
    const lastAgm = await ctx.db.insert("meetings", {
      societyId,
      type: "AGM",
      title: "2025 Annual General Meeting",
      scheduledAt: "2025-09-14T18:00:00-07:00",
      location: "Riverside Community Hall, 2187 Commercial Dr",
      electronic: false,
      noticeSentAt: "2025-08-24",
      quorumRequired: 3,
      status: "Held",
      attendeeIds: Object.values(directorIds).map(String),
      agendaJson: JSON.stringify([
        "Call to order & quorum",
        "Approval of 2024 AGM minutes",
        "President's report",
        "Treasurer's report & 2024–25 financial statements",
        "Appointment of reviewer",
        "Election of directors",
        "Special resolution: bylaw amendment (article 14)",
        "New business",
        "Adjournment",
      ]),
    });

    await ctx.db.insert("minutes", {
      societyId,
      meetingId: lastAgm,
      heldAt: "2025-09-14T18:00:00-07:00",
      attendees: dirData.map(([f, l]) => `${f} ${l}`).concat(["Hannah Goldberg", "Samuel Ahmadi", "Fatima Al-Rashid"]),
      absent: ["Rosa Martinez"],
      quorumMet: true,
      discussion:
        "President Vasquez opened the meeting at 18:02 and confirmed quorum. The 2024 AGM minutes were circulated in advance. Treasurer Shah walked through the 2024–25 financial statements, noting a 12% increase in program revenue and a modest operating surplus. The board discussed the arts programming renewal and the proposed amendment to article 14 of the bylaws regarding electronic participation in general meetings.",
      motions: [
        {
          text: "Motion to approve the 2024 AGM minutes as circulated.",
          movedBy: "Jordan Nakamura",
          secondedBy: "Amara Okonkwo",
          outcome: "Carried",
          votesFor: 9,
          votesAgainst: 0,
          abstentions: 1,
        },
        {
          text: "Motion to accept the 2024–25 financial statements as presented.",
          movedBy: "Priya Shah",
          secondedBy: "Theo Lafontaine",
          outcome: "Carried",
          votesFor: 10,
          votesAgainst: 0,
          abstentions: 0,
        },
        {
          text: "Special resolution: amend article 14 of the bylaws to permit fully electronic general meetings.",
          movedBy: "Elena Vasquez",
          secondedBy: "Wei Chen",
          outcome: "Carried",
          votesFor: 9,
          votesAgainst: 1,
          abstentions: 0,
        },
      ],
      decisions: [
        "2024 AGM minutes approved.",
        "2024–25 financial statements accepted.",
        "Article 14 bylaw amendment passed by special resolution.",
      ],
      actionItems: [
        {
          text: "File annual report and bylaw amendment via Societies Online within 30 days.",
          assignee: "Theo Lafontaine",
          dueDate: "2025-10-14",
          done: true,
        },
        {
          text: "Publish updated bylaws on society website.",
          assignee: "Amara Okonkwo",
          dueDate: "2025-10-01",
          done: true,
        },
        {
          text: "Open call for new programs committee volunteers.",
          assignee: "Jordan Nakamura",
          dueDate: "2025-11-15",
          done: false,
        },
      ],
      approvedAt: "2025-10-08",
    });

    const boardMeeting = await ctx.db.insert("meetings", {
      societyId,
      type: "Board",
      title: "Q4 board meeting",
      scheduledAt: "2026-01-22T19:00:00-08:00",
      location: "Zoom",
      electronic: true,
      noticeSentAt: "2026-01-12",
      quorumRequired: 4,
      status: "Held",
      attendeeIds: Object.values(directorIds).map(String),
    });

    await ctx.db.insert("minutes", {
      societyId,
      meetingId: boardMeeting,
      heldAt: "2026-01-22T19:00:00-08:00",
      attendees: dirData.map(([f, l]) => `${f} ${l}`),
      absent: [],
      quorumMet: true,
      discussion:
        "Board reviewed Q3 financials, programs pipeline for spring 2026, and a draft conflict-of-interest disclosure from director Petrov relating to a potential vendor contract with Petrov Print Co.",
      motions: [
        {
          text: "Motion to accept Q3 financial update.",
          movedBy: "Priya Shah",
          secondedBy: "Elena Vasquez",
          outcome: "Carried",
          votesFor: 6,
          votesAgainst: 0,
          abstentions: 0,
        },
        {
          text: "Motion to proceed with print vendor RFP excluding Petrov Print Co.",
          movedBy: "Jordan Nakamura",
          secondedBy: "Wei Chen",
          outcome: "Carried",
          votesFor: 5,
          votesAgainst: 0,
          abstentions: 1,
        },
      ],
      decisions: [
        "Q3 financials accepted.",
        "Petrov Print Co. excluded from print RFP due to disclosed conflict.",
      ],
      actionItems: [
        {
          text: "Issue print RFP to three qualified vendors.",
          assignee: "Jordan Nakamura",
          dueDate: "2026-02-15",
          done: false,
        },
        {
          text: "Draft Q4 fundraising plan.",
          assignee: "Amara Okonkwo",
          dueDate: "2026-03-01",
          done: false,
        },
      ],
    });

    await ctx.db.insert("meetings", {
      societyId,
      type: "Board",
      title: "Spring planning board meeting",
      scheduledAt: "2026-04-28T19:00:00-07:00",
      location: "Zoom",
      electronic: true,
      quorumRequired: 4,
      status: "Scheduled",
      attendeeIds: [],
    });

    await ctx.db.insert("meetings", {
      societyId,
      type: "AGM",
      title: "2026 Annual General Meeting",
      scheduledAt: "2026-09-20T18:00:00-07:00",
      location: "Riverside Community Hall, 2187 Commercial Dr",
      electronic: false,
      quorumRequired: 3,
      status: "Scheduled",
      attendeeIds: [],
    });

    // Filings
    await ctx.db.insert("filings", {
      societyId,
      kind: "AnnualReport",
      periodLabel: "2025 AGM",
      dueDate: "2025-10-14",
      filedAt: "2025-10-03",
      confirmationNumber: "BC-AR-208841",
      feePaidCents: 4000,
      status: "Filed",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "BylawAmendment",
      periodLabel: "Article 14 e-meeting",
      dueDate: "2025-10-14",
      filedAt: "2025-10-03",
      confirmationNumber: "BC-BA-991203",
      feePaidCents: 5000,
      status: "Filed",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "T3010",
      periodLabel: "FY 2024-25 charity return",
      dueDate: "2025-09-30",
      filedAt: "2025-08-22",
      confirmationNumber: "CRA-T3010-778142",
      status: "Filed",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "T4",
      periodLabel: "2025 payroll slips",
      dueDate: "2026-02-28",
      filedAt: "2026-02-19",
      status: "Filed",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "AnnualReport",
      periodLabel: "2026 AGM",
      dueDate: "2026-10-20",
      status: "Upcoming",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "T3010",
      periodLabel: "FY 2025-26 charity return",
      dueDate: "2026-09-30",
      status: "Upcoming",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "GSTHST",
      periodLabel: "Q1 2026",
      dueDate: "2026-04-30",
      status: "Upcoming",
    });
    await ctx.db.insert("filings", {
      societyId,
      kind: "ChangeOfDirectors",
      periodLabel: "Petrov & Chen appointments",
      dueDate: "2025-07-20",
      filedAt: "2025-07-10",
      status: "Filed",
    });

    // Deadlines
    const today = new Date();
    const plusDays = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    await ctx.db.insert("deadlines", {
      societyId,
      title: "Send AGM notice (14–60 days before AGM)",
      description: "Deliver notice to all voting members with date, time, location, and text of any special resolutions.",
      dueDate: plusDays(30),
      category: "Governance",
      done: false,
      recurrence: "Annual",
    });
    await ctx.db.insert("deadlines", {
      societyId,
      title: "Confirm at least 1 BC-resident director",
      dueDate: plusDays(7),
      category: "Governance",
      done: false,
      recurrence: "Annual",
    });
    await ctx.db.insert("deadlines", {
      societyId,
      title: "Review PIPA privacy policy",
      dueDate: plusDays(60),
      category: "Privacy",
      done: false,
      recurrence: "Annual",
    });
    await ctx.db.insert("deadlines", {
      societyId,
      title: "Remit monthly payroll source deductions",
      dueDate: plusDays(15),
      category: "Payroll",
      done: false,
      recurrence: "Monthly",
    });
    await ctx.db.insert("deadlines", {
      societyId,
      title: "File GST/HST Q1 2026 return",
      dueDate: "2026-04-30",
      category: "Tax",
      done: false,
      recurrence: "Quarterly",
    });

    // Documents
    const constitutionId = await ctx.db.insert("documents", {
      societyId,
      title: "Constitution",
      category: "Constitution",
      fileName: "constitution.pdf",
      mimeType: "application/pdf",
      retentionYears: 99,
      createdAtISO: "2011-03-18T00:00:00Z",
      flaggedForDeletion: false,
      tags: ["governance", "incorporation"],
    });
    const bylawsId = await ctx.db.insert("documents", {
      societyId,
      title: "Bylaws (v3, effective 2025-10-03)",
      category: "Bylaws",
      fileName: "bylaws-v3.pdf",
      mimeType: "application/pdf",
      retentionYears: 99,
      createdAtISO: "2025-10-03T00:00:00Z",
      flaggedForDeletion: false,
      tags: ["governance", "current"],
    });
    const privacyId = await ctx.db.insert("documents", {
      societyId,
      title: "PIPA privacy policy",
      category: "Policy",
      fileName: "privacy-policy.pdf",
      mimeType: "application/pdf",
      retentionYears: 10,
      createdAtISO: "2024-02-11T00:00:00Z",
      flaggedForDeletion: false,
      tags: ["privacy", "PIPA"],
    });
    await ctx.db.insert("documents", {
      societyId,
      title: "2024-25 Financial statements",
      category: "FinancialStatement",
      fileName: "fs-2024-25.pdf",
      mimeType: "application/pdf",
      retentionYears: 7,
      createdAtISO: "2025-08-10T00:00:00Z",
      flaggedForDeletion: false,
      tags: ["finance", "AGM-2025"],
    });
    await ctx.db.insert("documents", {
      societyId,
      title: "Director consent — Petrov (2025)",
      category: "Other",
      fileName: "consent-petrov.pdf",
      mimeType: "application/pdf",
      retentionYears: 10,
      createdAtISO: "2025-06-20T00:00:00Z",
      flaggedForDeletion: false,
      tags: ["directors"],
    });
    await ctx.db.insert("documents", {
      societyId,
      title: "Old board minutes (2014)",
      category: "Minutes",
      fileName: "minutes-2014.pdf",
      mimeType: "application/pdf",
      retentionYears: 10,
      createdAtISO: "2014-11-12T00:00:00Z",
      flaggedForDeletion: true,
      tags: ["archive"],
    });

    await ctx.db.patch(societyId, {
      constitutionDocId: constitutionId,
      bylawsDocId: bylawsId,
      privacyPolicyDocId: privacyId,
    });

    // Conflicts
    await ctx.db.insert("conflicts", {
      societyId,
      directorId: directorIds["Dmitri Petrov"],
      declaredAt: "2026-01-22",
      contractOrMatter: "Print services RFP (spring 2026)",
      natureOfInterest: "Director is majority owner of Petrov Print Co., a potential bidder.",
      abstainedFromVote: true,
      leftRoom: true,
      notes: "Board voted to exclude Petrov Print Co. from RFP.",
    });

    // Financials
    await ctx.db.insert("financials", {
      societyId,
      fiscalYear: "2024-2025",
      periodEnd: "2025-03-31",
      revenueCents: 48720000,
      expensesCents: 46110000,
      netAssetsCents: 9240000,
      restrictedFundsCents: 1200000,
      auditStatus: "ReviewEngagement",
      auditorName: "Maple Leaf CPA LLP",
      approvedByBoardAt: "2025-08-10",
      presentedAtMeetingId: lastAgm,
      remunerationDisclosures: [
        { role: "Executive Director", amountCents: 9200000 },
        { role: "Programs Manager", amountCents: 7800000 },
      ],
    });

    // Committees
    const programsCommitteeId = await ctx.db.insert("committees", {
      societyId,
      name: "Programs Committee",
      description:
        "Oversees arts, food security, and youth mentorship programs. Reviews program outcomes and recommends funding allocations to the board.",
      mission: "Deliver high-impact community programming in East Vancouver.",
      cadence: "Biweekly",
      cadenceNotes: "Alternating Tuesdays at 6:30pm, typically at the Hall.",
      nextMeetingAt: "2026-04-28T18:30:00-07:00",
      chairDirectorId: directorIds["Jordan Nakamura"],
      color: "#3b5bdb",
      status: "Active",
      createdAtISO: "2023-02-01T00:00:00Z",
    });
    const financeCommitteeId = await ctx.db.insert("committees", {
      societyId,
      name: "Finance & Audit Committee",
      description:
        "Reviews monthly financials, prepares annual statements for the board, and oversees the review engagement with Maple Leaf CPA LLP.",
      mission: "Maintain financial integrity and prepare the society for a full audit within 2 years.",
      cadence: "Monthly",
      cadenceNotes: "Second Wednesday of each month at 5:30pm, on Zoom.",
      nextMeetingAt: "2026-05-13T17:30:00-07:00",
      chairDirectorId: directorIds["Priya Shah"],
      color: "#0a8f4e",
      status: "Active",
      createdAtISO: "2023-02-01T00:00:00Z",
    });
    const governanceCommitteeId = await ctx.db.insert("committees", {
      societyId,
      name: "Governance Committee",
      description:
        "Maintains bylaws, policies, and director onboarding. Runs the annual director recruitment and orientation cycle.",
      mission: "Modernize the bylaws and build a skills-based director matrix.",
      cadence: "Quarterly",
      cadenceNotes: "First Monday of each quarter at 6:00pm.",
      nextMeetingAt: "2026-07-06T18:00:00-07:00",
      chairDirectorId: directorIds["Elena Vasquez"],
      color: "#a86400",
      status: "Active",
      createdAtISO: "2023-02-01T00:00:00Z",
    });

    const committeeMemberships: [any, string, string, any][] = [
      [programsCommitteeId, "Jordan Nakamura", "Chair", directorIds["Jordan Nakamura"]],
      [programsCommitteeId, "Amara Okonkwo", "Member", directorIds["Amara Okonkwo"]],
      [programsCommitteeId, "Wei Chen", "Member", directorIds["Wei Chen"]],
      [programsCommitteeId, "Hannah Goldberg", "Volunteer", undefined],
      [financeCommitteeId, "Priya Shah", "Chair", directorIds["Priya Shah"]],
      [financeCommitteeId, "Theo Lafontaine", "Member", directorIds["Theo Lafontaine"]],
      [financeCommitteeId, "Dmitri Petrov", "Member", directorIds["Dmitri Petrov"]],
      [governanceCommitteeId, "Elena Vasquez", "Chair", directorIds["Elena Vasquez"]],
      [governanceCommitteeId, "Theo Lafontaine", "Secretary", directorIds["Theo Lafontaine"]],
      [governanceCommitteeId, "Amara Okonkwo", "Member", directorIds["Amara Okonkwo"]],
    ];
    for (const [committeeId, name, role, directorId] of committeeMemberships) {
      await ctx.db.insert("committeeMembers", {
        committeeId,
        societyId,
        name,
        email: `${name.split(" ")[0].toLowerCase()}@riversidecs.ca`,
        role,
        directorId,
        joinedAt: "2024-06-15",
      });
    }

    // Committee meetings (past + upcoming)
    const progPast = await ctx.db.insert("meetings", {
      societyId,
      committeeId: programsCommitteeId,
      type: "Committee",
      title: "Programs Committee — Spring planning",
      scheduledAt: "2026-03-10T18:30:00-07:00",
      location: "Riverside Community Hall",
      electronic: false,
      quorumRequired: 3,
      status: "Held",
      attendeeIds: [],
    });
    await ctx.db.insert("minutes", {
      societyId,
      meetingId: progPast,
      heldAt: "2026-03-10T18:30:00-07:00",
      attendees: ["Jordan Nakamura", "Amara Okonkwo", "Wei Chen", "Hannah Goldberg"],
      absent: [],
      quorumMet: true,
      discussion:
        "Reviewed winter programming outcomes (attendance up 18% YoY). Discussed three proposals for spring: a youth filmmaking cohort, an indigenous food sovereignty workshop series, and expanding the community fridge partnership.",
      motions: [
        {
          text: "Recommend to board: fund youth filmmaking cohort at $12,000 from restricted arts fund.",
          movedBy: "Amara Okonkwo",
          secondedBy: "Wei Chen",
          outcome: "Carried",
          votesFor: 4,
          votesAgainst: 0,
          abstentions: 0,
        },
      ],
      decisions: ["Spring programming slate approved for board recommendation."],
      actionItems: [
        { text: "Draft filmmaking cohort budget for April board meeting.", assignee: "Jordan Nakamura", dueDate: "2026-04-15", done: true },
        { text: "Contact Downtown Eastside food network re: partnership.", assignee: "Amara Okonkwo", dueDate: "2026-04-01", done: false },
      ],
    });
    await ctx.db.insert("meetings", {
      societyId,
      committeeId: programsCommitteeId,
      type: "Committee",
      title: "Programs Committee — Spring kickoff",
      scheduledAt: "2026-04-28T18:30:00-07:00",
      location: "Riverside Community Hall",
      electronic: false,
      quorumRequired: 3,
      status: "Scheduled",
      attendeeIds: [],
    });
    await ctx.db.insert("meetings", {
      societyId,
      committeeId: financeCommitteeId,
      type: "Committee",
      title: "Finance Committee — April review",
      scheduledAt: "2026-04-08T17:30:00-07:00",
      location: "Zoom",
      electronic: true,
      quorumRequired: 2,
      status: "Held",
      attendeeIds: [],
    });
    await ctx.db.insert("meetings", {
      societyId,
      committeeId: financeCommitteeId,
      type: "Committee",
      title: "Finance Committee — May review",
      scheduledAt: "2026-05-13T17:30:00-07:00",
      location: "Zoom",
      electronic: true,
      quorumRequired: 2,
      status: "Scheduled",
      attendeeIds: [],
    });

    // Goals
    const auditGoalId = await ctx.db.insert("goals", {
      societyId,
      committeeId: financeCommitteeId,
      title: "Achieve a full audit for FY 2026-27",
      description:
        "Upgrade from review engagement to full audit within two fiscal years to unlock larger institutional funders.",
      category: "Strategic",
      status: "OnTrack",
      startDate: "2025-09-14",
      targetDate: "2027-09-30",
      progressPercent: 35,
      ownerName: "Priya Shah",
      milestones: [
        { title: "Board resolution authorizing audit-readiness workstream", done: true, dueDate: "2025-10-01" },
        { title: "Adopt accrual accounting for all restricted funds", done: true, dueDate: "2026-01-31" },
        { title: "Complete internal controls self-assessment", done: false, dueDate: "2026-06-30" },
        { title: "Select audit firm via RFP", done: false, dueDate: "2026-11-30" },
        { title: "First full audit completed", done: false, dueDate: "2027-09-30" },
      ],
      keyResults: [
        { description: "Months of reserve cash", currentValue: 3, targetValue: 6, unit: "months" },
        { description: "Internal control gaps closed", currentValue: 4, targetValue: 12, unit: "gaps" },
      ],
      createdAtISO: "2025-10-01T00:00:00Z",
    });
    const programGoalId = await ctx.db.insert("goals", {
      societyId,
      committeeId: programsCommitteeId,
      title: "Serve 5,000 program participants in FY 2026-27",
      description: "Scale combined attendance across arts, food, and youth programs from 3,800 last year.",
      category: "Program",
      status: "AtRisk",
      startDate: "2026-04-01",
      targetDate: "2027-03-31",
      progressPercent: 18,
      ownerName: "Jordan Nakamura",
      milestones: [
        { title: "Spring cohorts launched", done: true, dueDate: "2026-05-01" },
        { title: "Reach 2,000 cumulative participants", done: false, dueDate: "2026-09-30" },
        { title: "Reach 3,500 cumulative participants", done: false, dueDate: "2026-12-31" },
        { title: "Reach 5,000 cumulative participants", done: false, dueDate: "2027-03-31" },
      ],
      keyResults: [
        { description: "Total participants", currentValue: 890, targetValue: 5000, unit: "people" },
        { description: "New partner orgs", currentValue: 2, targetValue: 6, unit: "partners" },
      ],
      createdAtISO: "2026-04-01T00:00:00Z",
    });
    const governanceGoalId = await ctx.db.insert("goals", {
      societyId,
      committeeId: governanceCommitteeId,
      title: "Modernize bylaws under the new Societies Act",
      description: "Complete a full bylaws refresh covering electronic meetings, member-funded status evaluation, and director term limits.",
      category: "Strategic",
      status: "OnTrack",
      startDate: "2025-06-01",
      targetDate: "2026-10-31",
      progressPercent: 60,
      ownerName: "Elena Vasquez",
      milestones: [
        { title: "Article 14 (electronic meetings) amendment", done: true, dueDate: "2025-09-14" },
        { title: "Policy manual first draft", done: true, dueDate: "2026-02-01" },
        { title: "Member consultation period", done: false, dueDate: "2026-06-30" },
        { title: "Special resolution at 2026 AGM", done: false, dueDate: "2026-09-20" },
      ],
      keyResults: [],
      createdAtISO: "2025-06-01T00:00:00Z",
    });

    // Tasks across statuses and linkages
    const taskSeed: Array<{
      title: string;
      description?: string;
      status: string;
      priority: string;
      assignee?: string;
      dueDate?: string;
      committeeId?: any;
      goalId?: any;
      tags: string[];
    }> = [
      {
        title: "Draft filmmaking cohort budget",
        description: "Line items, venue, equipment, mentor honoraria. Share with Priya before board meeting.",
        status: "Done",
        priority: "High",
        assignee: "Jordan Nakamura",
        dueDate: "2026-04-15",
        committeeId: programsCommitteeId,
        goalId: programGoalId,
        tags: ["budget", "programs"],
      },
      {
        title: "Contact Downtown Eastside food network",
        description: "Explore partnership for community fridge expansion.",
        status: "InProgress",
        priority: "Medium",
        assignee: "Amara Okonkwo",
        dueDate: "2026-04-20",
        committeeId: programsCommitteeId,
        goalId: programGoalId,
        tags: ["partnerships"],
      },
      {
        title: "Internal controls self-assessment worksheet",
        description: "Use CPA Canada NPO guide as template.",
        status: "InProgress",
        priority: "High",
        assignee: "Priya Shah",
        dueDate: "2026-06-30",
        committeeId: financeCommitteeId,
        goalId: auditGoalId,
        tags: ["audit-readiness"],
      },
      {
        title: "Policy manual — conflict of interest section",
        status: "Todo",
        priority: "Medium",
        assignee: "Theo Lafontaine",
        dueDate: "2026-05-15",
        committeeId: governanceCommitteeId,
        goalId: governanceGoalId,
        tags: ["policy"],
      },
      {
        title: "Member consultation survey — draft questions",
        status: "Todo",
        priority: "Medium",
        assignee: "Elena Vasquez",
        dueDate: "2026-05-10",
        committeeId: governanceCommitteeId,
        goalId: governanceGoalId,
        tags: ["bylaws"],
      },
      {
        title: "Refresh donor acknowledgement letters",
        status: "Blocked",
        priority: "Low",
        assignee: "Amara Okonkwo",
        dueDate: "2026-05-01",
        committeeId: financeCommitteeId,
        tags: ["fundraising"],
      },
      {
        title: "Book hall for June programs showcase",
        status: "Done",
        priority: "Low",
        assignee: "Jordan Nakamura",
        dueDate: "2026-04-05",
        committeeId: programsCommitteeId,
        tags: ["logistics"],
      },
      {
        title: "Recruit 2 new directors (skills: legal, tech)",
        status: "InProgress",
        priority: "High",
        assignee: "Elena Vasquez",
        dueDate: "2026-08-01",
        committeeId: governanceCommitteeId,
        tags: ["recruitment", "board"],
      },
      {
        title: "RFP for audit firm — shortlist 3",
        status: "Todo",
        priority: "Urgent",
        assignee: "Priya Shah",
        dueDate: "2026-11-30",
        committeeId: financeCommitteeId,
        goalId: auditGoalId,
        tags: ["audit"],
      },
    ];
    for (const t of taskSeed) {
      const id = await ctx.db.insert("tasks", {
        societyId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        dueDate: t.dueDate,
        committeeId: t.committeeId,
        goalId: t.goalId,
        tags: t.tags,
        createdAtISO: "2026-04-01T00:00:00Z",
        completedAt: t.status === "Done" ? "2026-04-10T00:00:00Z" : undefined,
      });
      void id;
    }

    // Activity feed (most recent first when read desc)
    const activityRows: Array<[string, string, string, string]> = [
      ["You", "task", "completed", "Completed task \"Draft filmmaking cohort budget\""],
      ["Priya Shah", "goal", "updated", "Updated progress on goal \"Achieve a full audit for FY 2026-27\" to 35%"],
      ["Elena Vasquez", "committee", "created", "Added Theo Lafontaine as Secretary on Governance Committee"],
      ["Jordan Nakamura", "meeting", "held", "Held Programs Committee — Spring planning"],
      ["Theo Lafontaine", "filing", "filed", "Filed Change of Directors via Societies Online"],
      ["Amara Okonkwo", "document", "uploaded", "Uploaded Bylaws v3 to document repository"],
      ["You", "goal", "created", "Created goal \"Serve 5,000 program participants in FY 2026-27\""],
      ["Dmitri Petrov", "conflict", "declared", "Declared conflict of interest on Print services RFP"],
    ];
    const baseTs = Date.now();
    for (let i = 0; i < activityRows.length; i++) {
      const [actor, entityType, action, summary] = activityRows[i];
      await ctx.db.insert("activity", {
        societyId,
        actor,
        entityType,
        action,
        summary,
        createdAtISO: new Date(baseTs - (i + 1) * 3600_000).toISOString(),
      });
    }

    // Users with varied roles — the UserPicker auto-selects the Owner.
    const userSeed = [
      ["elena.vasquez@riversidecs.ca", "Elena Vasquez", "Owner"],
      ["jordan.nakamura@riversidecs.ca", "Jordan Nakamura", "Admin"],
      ["priya.shah@riversidecs.ca", "Priya Shah", "Director"],
      ["amara.okonkwo@riversidecs.ca", "Amara Okonkwo", "Director"],
      ["samuel.ahmadi@example.ca", "Samuel Ahmadi", "Member"],
      ["volunteer@riversidecs.ca", "Volunteer account", "Viewer"],
    ] as const;
    for (const [email, name, role] of userSeed) {
      await ctx.db.insert("users", {
        societyId,
        email,
        displayName: name,
        role,
        status: "Active",
        createdAtISO: new Date().toISOString(),
      });
    }

    // Subscription plans — demo only.
    await ctx.db.insert("subscriptionPlans", {
      societyId,
      name: "Regular member",
      description: "Voting rights at AGM, weekly programs discount.",
      priceCents: 2500,
      currency: "CAD",
      interval: "year",
      benefits: ["AGM vote", "Program discount", "Quarterly newsletter"],
      membershipClass: "Regular",
      active: true,
    });
    await ctx.db.insert("subscriptionPlans", {
      societyId,
      name: "Student",
      description: "Reduced dues for verified students.",
      priceCents: 500,
      currency: "CAD",
      interval: "year",
      benefits: ["AGM vote", "Program discount"],
      membershipClass: "Student",
      active: true,
    });
    await ctx.db.insert("subscriptionPlans", {
      societyId,
      name: "Sustainer",
      description: "Recurring support for core operations.",
      priceCents: 1500,
      currency: "CAD",
      interval: "month",
      benefits: ["Named in annual report", "Invite to donor events"],
      active: true,
    });

    // A couple of notifications so the bell lights up on first load.
    await ctx.db.insert("notifications", {
      societyId,
      kind: "deadline",
      severity: "warn",
      title: "GST/HST Q1 2026 due 2026-04-30",
      body: "Remit via CRA My Business Account. Filing bot handles pre-fill.",
      linkHref: "/filings",
      createdAtISO: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    await ctx.db.insert("notifications", {
      societyId,
      kind: "minutes",
      severity: "info",
      title: "Q4 board minutes ready for signature",
      body: "Two signatures required before adoption.",
      linkHref: "/minutes",
      createdAtISO: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    });

    // ========== Priority A/B demo rows ==========

    // Records inspections
    await ctx.db.insert("inspections", {
      societyId,
      inspectorName: "Samuel Ahmadi",
      isMember: true,
      recordsRequested: "2025 AGM minutes, current bylaws",
      inspectedAtISO: "2025-10-22",
      deliveryMethod: "electronic",
      feeCents: 0,
    });
    await ctx.db.insert("inspections", {
      societyId,
      inspectorName: "Vancouver Neighbourhood House (non-member)",
      isMember: false,
      recordsRequested: "2024-25 financial statements",
      inspectedAtISO: "2026-02-14",
      deliveryMethod: "electronic",
      feeCents: 1000,
      copyPages: 22,
      copyFeeCents: 220,
    });

    // Director attestations for current year — mostly signed, one missing
    const currentYear = new Date().getFullYear();
    const dirIdsArr = Object.values(directorIds) as any[];
    for (let i = 0; i < dirIdsArr.length - 1; i++) {
      await ctx.db.insert("directorAttestations", {
        societyId,
        directorId: dirIdsArr[i],
        year: currentYear,
        signedAtISO: new Date(Date.now() - (i + 1) * 864e5).toISOString(),
        isAtLeast18: true,
        notBankrupt: true,
        notDisqualified: true,
        stillResidentOrEligible: true,
      });
    }

    // Insurance
    await ctx.db.insert("insurancePolicies", {
      societyId,
      kind: "DirectorsOfficers",
      insurer: "Intact Public Entities",
      policyNumber: "D&O-RCS-2026-447",
      coverageCents: 200000000,
      premiumCents: 189000,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      renewalDate: "2026-12-31",
      sourceExternalIds: ["demo:insurance-dno-2026"],
      sensitivity: "restricted",
      riskFlags: ["restricted"],
      status: "Active",
    });
    await ctx.db.insert("insurancePolicies", {
      societyId,
      kind: "GeneralLiability",
      insurer: "Co-operators",
      policyNumber: "CGL-17742",
      coverageCents: 500000000,
      premiumCents: 312000,
      startDate: "2026-04-01",
      endDate: "2026-05-31",
      renewalDate: "2026-05-31", // renewal within 60 days — shows warning
      sourceExternalIds: ["demo:insurance-cgl-2026"],
      sensitivity: "restricted",
      riskFlags: ["restricted"],
      status: "Active",
    });

    // PIPA training
    const trainees = [
      ["Elena Vasquez", "Director", "PIPA"],
      ["Amara Okonkwo", "Staff", "PIPA"],
      ["Theo Lafontaine", "Director", "CASL"],
    ];
    for (const [name, role, topic] of trainees) {
      await ctx.db.insert("pipaTrainings", {
        societyId,
        participantName: name,
        role,
        topic,
        completedAtISO: "2025-11-18",
        nextDueAtISO: "2026-11-18",
        trainer: "BC Nonprofit Centre",
      });
    }

    // Auditor appointment for FY 2024-25
    await ctx.db.insert("auditorAppointments", {
      societyId,
      firmName: "Maple Leaf CPA LLP",
      engagementType: "ReviewEngagement",
      fiscalYear: "2024-2025",
      appointedBy: "Members",
      appointedAtISO: "2025-09-14",
      independenceAttested: true,
      status: "Active",
    });

    // Member proposal
    await ctx.db.insert("memberProposals", {
      societyId,
      title: "Establish a community grants committee",
      text: "That the society create a standing committee to review and recommend community grant applications…",
      submittedByName: "Hannah Goldberg",
      submittedAtISO: "2026-03-15",
      signatureCount: 3,
      thresholdPercent: 5,
      eligibleVotersAtSubmission: 14,
      includedInAgenda: false,
      status: "MeetsThreshold",
    });

    // Donation receipts (charity)
    await ctx.db.insert("donationReceipts", {
      societyId,
      charityNumber: "888822177 RR0001",
      receiptNumber: "000001",
      donorName: "Vancouver Foundation",
      amountCents: 500000,
      eligibleAmountCents: 500000,
      receivedOnISO: "2025-12-20",
      issuedAtISO: "2026-01-05T10:00:00Z",
      location: "Vancouver, BC",
      isNonCash: false,
    });
    await ctx.db.insert("donationReceipts", {
      societyId,
      charityNumber: "888822177 RR0001",
      receiptNumber: "000002",
      donorName: "Ahmadi Family",
      amountCents: 100000,
      eligibleAmountCents: 100000,
      receivedOnISO: "2026-02-10",
      issuedAtISO: "2026-02-15T10:00:00Z",
      location: "Vancouver, BC",
      isNonCash: false,
    });

    // Employees
    await ctx.db.insert("employees", {
      societyId,
      firstName: "Amara",
      lastName: "Okonkwo",
      role: "Executive Director",
      startDate: "2022-04-01",
      employmentType: "FullTime",
      annualSalaryCents: 9200000,
      worksafeBCNumber: "WSBC-RCS-22841",
      cppExempt: false,
      eiExempt: false,
    });
    await ctx.db.insert("employees", {
      societyId,
      firstName: "Jordan",
      lastName: "Nakamura",
      role: "Programs Manager",
      startDate: "2023-08-15",
      employmentType: "FullTime",
      annualSalaryCents: 7800000,
      worksafeBCNumber: "WSBC-RCS-22841",
      cppExempt: false,
      eiExempt: false,
    });

    // Records location notice
    await ctx.db.insert("recordsLocation", {
      societyId,
      address: "2187 Commercial Drive, Vancouver, BC (same as registered office)",
      noticePostedAtOffice: true,
      postedAtISO: "2024-01-10",
      computerProvidedForInspection: true,
      notes: "Electronic records accessible at the office on a dedicated kiosk.",
    });

    // Bylaw amendments — one filed (the article 14 e-meeting amendment from 2025), one in draft
    await ctx.db.insert("bylawAmendments", {
      societyId,
      title: "Article 14 — permit fully electronic general meetings",
      baseText:
        "14. Each general meeting must be held at a physical location in British Columbia. Members may not attend by electronic means.",
      proposedText:
        "14. A general meeting may be held in person, partly by electronic means, or fully by electronic means, provided the technology permits all participants to communicate with one another in real time. The board must include instructions for electronic participation in the meeting notice.",
      status: "Filed",
      createdByName: "Elena Vasquez",
      createdAtISO: "2025-07-12T00:00:00Z",
      updatedAtISO: "2025-10-03T00:00:00Z",
      consultationStartedAtISO: "2025-08-01T00:00:00Z",
      consultationEndedAtISO: "2025-09-13T00:00:00Z",
      resolutionPassedAtISO: "2025-09-14T00:00:00Z",
      votesFor: 9,
      votesAgainst: 1,
      abstentions: 0,
      filedAtISO: "2025-10-03T00:00:00Z",
      history: [
        { atISO: "2025-07-12T00:00:00Z", actor: "Elena Vasquez", action: "created", note: "Draft started by chair" },
        { atISO: "2025-08-01T00:00:00Z", actor: "Elena Vasquez", action: "consultation_started", note: "Open for member consultation" },
        { atISO: "2025-09-14T00:00:00Z", actor: "Theo Lafontaine", action: "resolution_passed", note: "For 9 · Against 1 · Abstain 0" },
        { atISO: "2025-10-03T00:00:00Z", actor: "Theo Lafontaine", action: "filed", note: "Filed via Societies Online (BC-BA-991203)" },
      ],
    });

    await ctx.db.insert("bylawAmendments", {
      societyId,
      title: "Article 9 — director term length",
      baseText:
        "9. A director's term begins at the AGM at which they are elected and ends at the close of the next AGM unless re-elected.",
      proposedText:
        "9. A director's term begins at the AGM at which they are elected and ends at the close of the second AGM thereafter, unless the director resigns earlier. Directors may serve up to three consecutive two-year terms before being required to step down for one year.",
      status: "Draft",
      createdByName: "Theo Lafontaine",
      createdAtISO: "2026-03-20T00:00:00Z",
      updatedAtISO: "2026-04-02T00:00:00Z",
      notes: "Governance Committee proposal — needs legal review before consultation.",
      history: [
        { atISO: "2026-03-20T00:00:00Z", actor: "Theo Lafontaine", action: "created", note: "Draft started" },
        { atISO: "2026-04-02T00:00:00Z", actor: "Elena Vasquez", action: "edited", note: "Tightened language on consecutive-term limit" },
      ],
    });

    // Written resolution (in lieu of meeting)
    await ctx.db.insert("writtenResolutions", {
      societyId,
      title: "Unanimous consent: bank signing authority update",
      text: "That Priya Shah and Elena Vasquez be authorized as co-signatories on the society's operating account at VanCity…",
      kind: "Special",
      circulatedAtISO: "2026-02-01",
      signatures: dirData.slice(0, 5).map(([f, l], i) => ({
        signerName: `${f} ${l}`,
        signedAtISO: new Date(Date.parse("2026-02-02") + i * 60000).toISOString(),
      })),
      requiredCount: 7,
      status: "Circulating",
    });

    await ctx.db.insert("workflows", {
      societyId,
      recipe: "unbc_affiliate_id_request",
      name: "UNBC Affiliate ID Request",
      status: "paused",
      provider: "n8n",
      providerConfig: {
        externalWebhookUrl: "http://127.0.0.1:5678/webhook/societyer/unbc-affiliate-id",
        externalEditUrl: "http://127.0.0.1:5678/workflow",
      },
      nodePreview: [
        { key: "manual", type: "manual_trigger", label: "Launch manually", description: "A Societyer user starts the affiliate request.", status: "ready" },
        { key: "intake", type: "form", label: "Affiliate intake form", description: "Collects the fields that map to the UNBC AcroForm widgets.", status: "ready" },
        { key: "fill_pdf", type: "pdf_fill", label: "Fill UNBC ID PDF", description: "n8n calls Societyer's PDF fill endpoint using the configured local template path.", status: "needs_setup" },
        { key: "save_document", type: "document_create", label: "Save generated PDF", description: "Stores the generated affiliate request as a Societyer document.", status: "ready" },
        { key: "notify", type: "email", label: "Notify manager", description: "Marks the workflow complete and leaves room for a real email/signature step later.", status: "draft" },
      ],
      trigger: { kind: "manual" },
      config: {
        pdfTemplateKey: "unbc_affiliate_id",
        sampleAffiliate: {
          "Legal First Name of Affiliate": "Sample",
          "Legal Middle Name of Affiliate": "A",
          "Legal Last Name of Affiliate": "Affiliate",
          "Current Mailing Address": "3333 University Way, Prince George, BC V2N 4Z9",
          "Emergency Contact(Name and Ph)": "Sample Contact 250 555 0100",
          "UNBC ID #": "000000000",
          "Birthdate of Affiliate (MM/DD/YYYY)": "01/01/1990",
          "Personal email address": "sample.affiliate@example.com",
          "Name of requesting Manager": "Sample Manager",
          "UNBC Department/Organization": "Sample Department",
          "Length of Affiliate status(lf known)": "1 year",
          ManagerPhone: "250-555-0101",
          "Manager Email": "manager@example.com",
          "Authorizing Name (if different from Manager)": "",
          "Date signed": "2026-04-18",
          "Check Box0": true,
          "Check Box1": false,
        },
      },
      createdByUserId: undefined,
    });

    return { societyId };
  },
});

export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    await wipe(ctx);
    return { ok: true };
  },
});

async function wipe(ctx: any) {
  const tables = [
    "activity",
    "tasks",
    "goals",
    "committeeMembers",
    "committees",
    "financials",
    "conflicts",
    "documents",
    "documentVersions",
    "deadlines",
    "filings",
    "filingBotRuns",
    "workflowRuns",
    "workflows",
    "minutes",
    "transcripts",
    "transcriptionJobs",
    "meetings",
    "directors",
    "members",
    "memberSubscriptions",
    "subscriptionPlans",
    "waveCacheStructures",
    "waveCacheResources",
    "waveCacheSnapshots",
    "financialTransactions",
    "financialAccounts",
    "financialConnections",
    "budgets",
    "signatures",
    "notifications",
    "notificationPrefs",
    "users",
    // Priority A/B additions
    "inspections",
    "directorAttestations",
    "writtenResolutions",
    "agmRuns",
    "noticeDeliveries",
    "insurancePolicies",
    "pipaTrainings",
    "proxies",
    "auditorAppointments",
    "memberProposals",
    "donationReceipts",
    "employees",
    "courtOrders",
    "recordsLocation",
    "sourceEvidence",
    "secretVaultItems",
    "archiveAccessions",
    "bylawAmendments",
    "societies",
  ];
  for (const t of tables) {
    const rows = await ctx.db.query(t).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
}

function randomPastDate(yearsBack: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Math.floor(Math.random() * yearsBack) - 1);
  d.setMonth(Math.floor(Math.random() * 12));
  d.setDate(1 + Math.floor(Math.random() * 27));
  return d.toISOString().slice(0, 10);
}
