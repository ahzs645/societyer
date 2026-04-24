// One-shot importer for the local OTE Meeting minutes 2 folder.
// For each meeting, uploads source file(s) to Convex storage, creates
// document(s), a meeting row, and a minutes row linked via sourceDocumentIds.
//
// Run: node scripts/import-ote-meeting-minutes.mjs

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const api = anyApi;
const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;
if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL");

const client = new ConvexHttpClient(url);

const SOCIETY_ID = "t17c6d4c2ss7gacaa93wdnagwh84ypzd"; // Over the Edge Newspaper Society
const ROOT = "/Users/ahmadjalil/Downloads/OTE Meeting minutes 2";

const MIME = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".m4a": "audio/mp4",
  ".whisper": "application/zip",
};

async function uploadFile(absPath, title, category) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const bytes = readFileSync(absPath);
  const size = statSync(absPath).size;
  const fileName = path.basename(absPath);

  let uploadUrl;
  try {
    uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
  } catch (err) {
    console.error(`     ✗ generateUploadUrl: ${err.message}`);
    throw err;
  }
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed for ${fileName}: ${res.status}`);
  const json = await res.json();
  const storageId = json.storageId ?? json.id ?? json;
  console.log("     uploaded; storageId=", storageId, "raw=", json);

  let docId;
  try {
    docId = await client.mutation(api.documents.create, {
      societyId: SOCIETY_ID,
      title,
      category,
      fileName,
      mimeType: mime,
      tags: ["ote-folder-import", "meeting-minutes"],
    });
  } catch (err) {
    console.error(`     ✗ documents.create (${title}): ${err.message}`);
    throw err;
  }
  try {
    await client.mutation(api.files.attachUploadedFileToDocument, {
      documentId: docId,
      storageId,
      fileName,
      mimeType: mime,
      fileSizeBytes: size,
    });
  } catch (err) {
    console.error(`     ✗ attachUploadedFileToDocument: ${err.message}`);
    throw err;
  }
  return docId;
}

function minutesStructuredFields(spec) {
  return compact({
    chairName: spec.chairName,
    secretaryName: spec.secretaryName,
    recorderName: spec.recorderName,
    calledToOrderAt: spec.calledToOrderAt,
    adjournedAt: spec.adjournedAt,
    remoteParticipation: spec.remoteParticipation,
    detailedAttendance: spec.detailedAttendance,
    sections: spec.sections,
    nextMeetingAt: spec.nextMeetingAt,
    nextMeetingLocation: spec.nextMeetingLocation,
    nextMeetingNotes: spec.nextMeetingNotes,
    sessionSegments: spec.sessionSegments,
    appendices: spec.appendices,
    agmDetails: spec.agmDetails,
  });
}

function compact(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return out;
}

const OCT_4_2024_SECTIONS = [
  {
    title: "Bank Account Access and Debit/Credit Cards",
    type: "discussion",
    discussion:
      "- Ahmad and Bruce have access to the Vancity bank account.\n- Debit cards from Vancity will be obtained soon.\n- A credit card application with TD Bank is in progress but may not be heavily used if Vancity becomes the primary bank.",
  },
  {
    title: "Payment for Newspaper",
    type: "motion",
    discussion:
      "- Amount: $1,800 per month after taxes.\n- Invoice has been provided to Lina and is available in the office.",
    decisions: ["Approved the payment of $1,800 per month for the newspaper for the next eight months, until April."],
  },
  {
    title: "Volume 31, Issue 1 Progress",
    type: "report",
    discussion: "- The first issue has been submitted and published successfully.",
    reportSubmitted: true,
  },
  {
    title: "Office Revamp and Costs",
    type: "motion",
    discussion:
      "- Ahmad presented a detailed list of office upgrade purchases.\n- Total Cost: $3,963.43 (after taxes).\n- Items purchased include monitors, Mac Mini, furniture, and office supplies.",
    decisions: ["Approved reimbursement to Ahmad Jalil for office upgrade purchases totaling $3,963.43."],
  },
  {
    title: "Potential New Hire",
    type: "discussion",
    discussion: "- Discussed hiring an additional editor to assist with communication and content management.",
    decisions: ["Decision to table this discussion for a future meeting."],
  },
  {
    title: "Document Scanning and Digitization",
    type: "discussion",
    discussion:
      "- All office documents have been scanned and are available on Teams.\n- Currently working on digitizing old articles to upload to the website.",
    actionItems: [
      { text: "Build the pathway to publish articles online.", assignee: "Ahmad Jalil", done: false },
      { text: "Review scanned documents on Teams.", assignee: "All Members", done: false },
    ],
  },
  {
    title: "Publishing Schedule",
    type: "discussion",
    discussion:
      "- Confirmed Publishing Dates:\n  - September 26\n  - October 24\n  - November 14\n  - December 5\n  - January 23\n  - February 13\n  - March 20\n  - April 10\n- Submission Deadline: End of Tuesday, one week prior to the publication date.\n- For the October 24 issue, the submission deadline is October 15.",
    actionItems: [{ text: "Upload publishing schedule and deadlines to Teams.", assignee: "Ahmad Jalil", done: false }],
  },
  {
    title: "OTE Phone Number Access",
    type: "discussion",
    discussion:
      "- The OTE phone number (250-960-5633) is now accessible via phone and computer.\n- Members can contact Ahmad to gain access.",
    actionItems: [{ text: "Contact Ahmad if access to the OTE phone number is needed.", assignee: "All Members", done: false }],
  },
  {
    title: "Expenses to be Reimbursed",
    type: "motion",
    discussion:
      "- **Expenses Incurred by Ahmad:**\n  - $80.00 for notary signing\n  - $33.01 for posters\n  - $19.95 for mailing to Vancity Bank\n- Receipts are recorded on Teams under Expenses.",
    decisions: ["Approved reimbursement of expenses totaling $132.96 to Ahmad."],
  },
  {
    title: "Potential Upcoming Costs",
    type: "motion",
    discussion:
      "- Canva Subscription:\n  - Cost: Approximately $150 per year\n- Adobe Creative Cloud Subscription:\n  - Cost: $25.99/month for the first year, then $45.99/month thereafter\n- Claud AI Subscription:\n  - Cost: $28/month USD plus tax\n- Ahmad explained the benefits of Claud AI for organizational knowledge management.",
    decisions: ["Approved the purchase of subscriptions for Canva, Adobe Creative Cloud, and Claud AI."],
    actionItems: [{ text: "Set up subscriptions for Canva, Adobe Creative Cloud, and Cloud AI using the OTE email.", assignee: "Ahmad Jalil", done: false }],
  },
  {
    title: "Multimedia Tools Discussion",
    type: "discussion",
    discussion:
      "- Considering purchases to enhance multimedia capabilities, including:\n  - DJI Mic 2: $479\n  - Phone Gimbal: $200\n  - DJI Osmo Pocket 2: $300",
    decisions: ["Decided to table the discussion until the next meeting due to budget considerations."],
  },
  {
    title: "Door Lock Replacement",
    type: "discussion",
    discussion:
      "- Considering upgrading the office door lock to a tap system for improved access control.\n- Estimated Cost: $1,500\n- Waiting for an official quote.\n- Possibility of requesting funding assistance from NUGSS.",
    actionItems: [{ text: "Obtain an official quote for the door lock replacement.", assignee: "Ahmad Jalil", done: false }],
  },
  {
    title: "Obligations for Insurance Renewal",
    type: "motion",
    discussion:
      "- Renewal Costs:\n  - Commercial General Liability Insurance: $1,084.00\n  - Directors & Officers Liability Insurance: $850.00",
    decisions: ["Approved payment of insurance premiums totaling $1,934.00."],
    actionItems: [{ text: "Follow up on insurance renewal and payments.", assignee: "Ahmad Jalil", done: false }],
  },
  {
    title: "Accounting System Integration",
    type: "discussion",
    discussion:
      "- Plan to use Wave, a free accounting system, to track expenses and payments to contributors.\n- Ahmad demonstrated Wave to the team.\n- No objections; agreed to proceed with integration.",
    decisions: ["Agreed to proceed with Wave accounting integration."],
    actionItems: [{ text: "Proceed with integrating the Wave accounting system.", assignee: "Ahmad Jalil", done: false }],
  },
  {
    title: "Quesnel Contact for Newspaper Shipping",
    type: "motion",
    discussion:
      "- Established contacts with Julie McRae and Anita Baziuk for shipping newspapers to Quesnel campus.\n- Estimated Shipping Cost: $50 to $100 per campus per issue.",
    decisions: ["Approved up to $100 per campus per issue for shipping newspapers."],
  },
  {
    title: "Team Considerations",
    type: "discussion",
    discussion:
      "- Team Meal Budget: Tabled for future discussion.\n- Decoration and Printing Budget: Tabled for future discussion.",
    decisions: ["Team meal budget tabled for future discussion.", "Decoration and printing budget tabled for future discussion."],
  },
  {
    title: "Bruce's Practicum Schedule",
    type: "discussion",
    discussion:
      "- Practicum Dates:\n  - November 4 to December 6\n  - February 10 to March 21\n  - March 31 to May 9\n- Bruce will be unavailable during these periods.",
  },
  {
    title: "Editorial and Team Responsibilities",
    type: "discussion",
    discussion:
      "- Need to develop clearer article guidelines to provide better direction to writers.\n- Discussed outlining primary responsibilities of each team member to ensure balanced workloads.",
    decisions: ["Decision to table this discussion for the next meeting."],
    actionItems: [
      { text: "Prepare for discussions on multimedia tools, team meal budget, decoration and printing budget, and editorial responsibilities in the next meeting.", assignee: "All Members", done: false },
    ],
  },
];

const OCT_4_2024_MOTIONS = [
  { text: "Approve the payment of $1,800 per month for the newspaper for the next eight months (until April)", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 1, sectionTitle: "Payment for Newspaper" },
  { text: "Approve reimbursement to Ahmad Jalil for office upgrade purchases totaling $3,963.43", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 3, sectionTitle: "Office Revamp and Costs" },
  { text: "Approve reimbursement of expenses totaling $132.96 to Ahmad", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 8, sectionTitle: "Expenses to be Reimbursed" },
  { text: "Approve the purchase of subscriptions for Canva, Adobe Creative Cloud, and Claud AI", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 9, sectionTitle: "Potential Upcoming Costs" },
  { text: "Approve payment of insurance premiums totaling $1,934.00", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 12, sectionTitle: "Obligations for Insurance Renewal" },
  { text: "Approve up to $100 per campus per issue for shipping newspapers", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", sectionIndex: 14, sectionTitle: "Quesnel Contact for Newspaper Shipping" },
  { text: "Adjourn the meeting", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried", resolutionType: "Procedural", sectionTitle: "Adjournment" },
];

const OCT_4_2024_ACTION_ITEMS = [
  { text: "Upload publishing schedule and deadlines to Teams.", assignee: "Ahmad Jalil", done: false },
  { text: "Work on the pathway to publish articles on the website.", assignee: "Ahmad Jalil", done: false },
  { text: "Set up subscriptions for Canva, Adobe Creative Cloud, and Cloud AI using the OTE email.", assignee: "Ahmad Jalil", done: false },
  { text: "Proceed with integrating the Wave accounting system.", assignee: "Ahmad Jalil", done: false },
  { text: "Obtain an official quote for the door lock replacement.", assignee: "Ahmad Jalil", done: false },
  { text: "Follow up on insurance renewal and payments.", assignee: "Ahmad Jalil", done: false },
  { text: "Review scanned documents on Teams.", assignee: "All Members", done: false },
  { text: "Contact Ahmad if access to the OTE phone number is needed.", assignee: "All Members", done: false },
  { text: "Prepare for discussions on multimedia tools, team meal budget, decoration and printing budget, and editorial responsibilities in the next meeting.", assignee: "All Members", done: false },
];

async function importMeeting(spec) {
  console.log(`\n→ ${spec.scheduledAt.slice(0, 10)} | ${spec.title}`);

  const docIds = [];
  for (const file of spec.files) {
    const docId = await uploadFile(
      path.join(ROOT, file.relPath),
      file.title,
      file.category ?? (spec.type === "AGM" ? "Other" : "Minutes"),
    );
    docIds.push(docId);
    console.log(`   doc ${docId} ← ${file.relPath}`);
  }

  let meetingId;
  try {
    meetingId = await client.mutation(api.meetings.create, {
    societyId: SOCIETY_ID,
    type: spec.type,
    title: spec.title,
    scheduledAt: spec.scheduledAt,
    location: spec.location,
    electronic: spec.electronic ?? false,
    status: "Held",
    attendeeIds: spec.attendees ?? [],
    agendaJson: spec.agenda ? JSON.stringify(spec.agenda) : undefined,
    notes: `Imported from local folder "OTE Meeting minutes 2" on ${new Date().toISOString().slice(0, 10)}.${spec.notes ? " " + spec.notes : ""}`,
    });
  } catch (err) {
    console.error(`   ✗ meetings.create failed:`, err.message);
    throw err;
  }
  console.log(`   meeting ${meetingId}`);

  let minutesId;
  try {
    minutesId = await client.mutation(api.minutes.create, {
    societyId: SOCIETY_ID,
    meetingId,
    heldAt: spec.scheduledAt,
    attendees: spec.attendees ?? [],
    absent: spec.absent ?? [],
    quorumMet: spec.quorumMet ?? true,
    discussion: spec.discussion,
    ...minutesStructuredFields(spec),
    motions: spec.motions ?? [],
    decisions: spec.decisions ?? [],
    actionItems: spec.actionItems ?? [],
    sourceDocumentIds: docIds,
      sourceExternalIds: spec.files.map((f) => `ote-folder:${f.relPath}`),
      draftTranscript: spec.draftTranscript,
    });
  } catch (err) {
    console.error(`   ✗ minutes.create failed:`, err.message);
    throw err;
  }
  console.log(`   minutes ${minutesId}`);
}

const MEETINGS = [
  {
    scheduledAt: "2023-12-17T16:21:00-08:00",
    type: "Board",
    title: "OTE Board Meeting — December 17, 2023 (End of Year Review)",
    location: "OTE Office, UNBC",
    electronic: false,
    attendees: [
      "Bruce Danesh",
      "Ahmad Jalil",
      "Lina Maksymova",
    ],
    files: [
      {
        relPath: "2024-2025/December/17/Meeting Minutes Summary December 17, 2023.docx",
        title: "OTE Board Meeting Minutes — December 17, 2023",
      },
    ],
    discussion:
      "End-of-year review covered publications and events (final issue, OTE family dinner, UNBC GSS referendum), equipment and infrastructure upgrades (new Mac and dock, newsstand mapping, $3,000 credit limit, new Claude account), digital presence updates (website Student Society section, Q&A masthead, feedback collection, link tree alternative, Instagram launch, referendum brochure), and financial updates (September honorariums paid, automatic CC payments). Reviewed graduate student involvement (Nahid Yari interested in coordinator role, target 2:1 or 3:1 ratio). Planned upcoming communications including Writer of the Year section and comic section.",
    motions: [
      {
        text: "Motion to begin meeting",
        movedBy: "Bruce Danesh",
        secondedBy: "Lina Maksymova",
        outcome: "Carried",
      },
      {
        text: "Motion to adjourn",
        movedBy: "Bruce Danesh",
        secondedBy: "Lina Maksymova",
        outcome: "Carried",
      },
    ],
    decisions: [
      "Increased credit card limit to $3,000 with automatic payments",
      "Maintain target 2:1 or 3:1 ratio of graduate student involvement",
    ],
    actionItems: [
      { text: "Complete and distribute referendum brochure", done: false },
      { text: "Execute planned social media content calendar", done: false },
      { text: "Contact Daniel Sims", done: false, assignee: "Bruce Danesh" },
      { text: "Develop Writer of the Year section", done: false },
      { text: "Explore comic section possibilities", done: false },
      {
        text: "Determine grad student coordinator compensation next semester",
        done: false,
      },
    ],
  },

  {
    scheduledAt: "2024-02-21T18:08:00-08:00",
    type: "AGM",
    title: "OTE Annual General Meeting — February 21, 2024",
    location: "Online",
    electronic: true,
    attendees: [
      "Mohammed ALALLOUSH",
      "Bruce Danesh",
      "Abdullah",
      "Tuba Raofi",
      "Kamran Hassani",
      "Douglas MINAKER",
    ],
    files: [
      {
        relPath: "AGM/Feb 2024/OTE ANNUAL GENERAL MEETING Feb 2024 (1).docx",
        title: "OTE AGM Minutes — February 21, 2024",
        category: "Minutes",
      },
      {
        relPath: "AGM/Feb 2024/AGM 2024 Feb 21-Updated.pptx",
        title: "OTE AGM Slide Deck — February 21, 2024",
        category: "Other",
      },
    ],
    agenda: [
      "Land acknowledgement",
      "Introduction of staff",
      "Financial statement report",
      "Writers Team insights (Bruce Danesh)",
      "Hiring new Board of Directors",
    ],
    discussion:
      "AGM opened with land acknowledgement by Mohammed ALALLOUSH (Editor in Chief) and called to order at 6:08 pm. Staff and members introduced. Financial statements presented: $20,000 net income as of January 31, 2024 and bank balance of $63,471.23; full year statements pending (fiscal year May–April). Recent bookkeeper change resulted in only 2 years of records being recovered. Instagram account blocked in Canada due to Meta/federal government conflict because the page identifies as 'newspaper'; new non-news page being launched. Bruce Danesh updated on Writers Team direction (student perspectives, local PG content, residence-life tips, clubs, PG activities). Hiring announcement: candidates to email over.the.edge.unbc@gmail.com by March 20 with resume + cover letter; new term starts April 1, 2024. Doug MINAKER (NUGSS GM) offered NUGSS social/email channels to promote board openings. Low student turnout noted but support for active student newspaper appreciated. Adjourned at 6:40 pm.",
    motions: [],
    decisions: [
      "Switch Instagram presence to a non-news-categorised page to bypass Meta block",
      "Open hiring window for new Board of Directors with March 20, 2024 deadline",
    ],
    actionItems: [
      { text: "Advertise board openings on OTE website, new Instagram, and via NUGSS president email", done: false },
      { text: "Recruit and onboard new Board of Directors with terms starting April 1, 2024", done: false },
    ],
  },

  {
    scheduledAt: "2024-04-29T18:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — April 29, 2024",
    location: "Online",
    electronic: true,
    attendees: [
      "Bruce Danesh",
      "Ahmad Jalil",
      "Anhelina Maksymova",
      "Abdullah Nahhas",
      "Nahid Yari",
      "Mohammed ALALLOUSH",
    ],
    files: [
      {
        relPath: "2024-2025/April/OTE-meeting-minutes-April-29-2024.docx",
        title: "OTE Board Meeting Minutes — April 29, 2024",
      },
    ],
    discussion:
      "Land acknowledgement by Mohammed ALALLOUSH (EIC). Bruce Danesh called to order at 6:00 pm. Ahmad Jalil walked the board through the OTE Bylaws and Constitution: membership, general meetings, directors, board positions, editorial policies, BC Society Act compliance, quorum requirements, recall process, and remuneration. No concerns raised on including graduate students. Statement of Directors confirmed: President Bruce Danesh, VP Ahmad Jalil, Secretary Anhelina Maksymova, Treasurer Abdullah Nahhas, Director Nahid Yari. Discussed Instagram block due to Meta/federal conflict and decided to start a new non-news Instagram presence; possible logo rebrand. Anhelina volunteered to maintain a centralized Excel sheet of bylaws, board members, and agenda items. Next meeting set for Monday May 13, 2024 at 6:30 pm. Adjourned at 7:00 pm.",
    motions: [],
    decisions: [
      "Confirmed slate: President Bruce Danesh, VP Ahmad Jalil, Secretary Anhelina Maksymova, Treasurer Abdullah Nahhas, Director Nahid Yari",
      "Start a new Instagram account that is not categorised as a news source",
    ],
    actionItems: [
      { text: "Analyse bylaws further with board feedback and prepare proposed updates for the next AGM", assignee: "Ahmad Jalil", done: false },
      { text: "Send updated board roster and bylaws to NUGSS", assignee: "Bruce Danesh", done: false },
      { text: "Send reminder + calendar invite for May 13 meeting", assignee: "Bruce Danesh", done: false },
    ],
  },

  {
    scheduledAt: "2024-05-13T20:30:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — May 13, 2024",
    location: "Online",
    electronic: true,
    attendees: [
      "Bruce Danesh",
      "Ahmad Jalil",
      "Anhelina Maksymova",
      "Abdullah Nahhas",
      "Nahid Yari",
      "Mohammed ALALLOUSH",
    ],
    files: [
      {
        relPath: "2024-2025/May/OTE-meeting-minutes-May 13th -2024 (1).docx",
        title: "OTE Board Meeting Minutes — May 13, 2024",
      },
    ],
    discussion:
      "Mohammed ALALLOUSH (EIC) offered the land acknowledgement. Bruce Danesh called to order at 8:30 pm. Bruce updated on NUGSS communication regarding OTE status and bylaws; recommended bylaws notified and approved. Decision to hold an extraordinary AGM to officially elect the current board and address issues with the prior AGM; tentatively Sunday June 23, 2024, 10:30 am. Ahmad Jalil presented bylaw updates from NUGSS feedback (graduate-student membership, non-student supporter category, election procedures). Mohammed proposed using the OTE office for writer/board interviews. Discussed need for an official UNBC email to replace Gmail. Anhelina presented logo rebrand options; shared in Facebook group for feedback. Next meeting set for Saturday June 15, 2024, prior to the AGM on June 22. Adjourned at 9:30 pm.",
    motions: [],
    decisions: [
      "Approved recommended bylaws as notified",
      "Schedule extraordinary AGM tentatively for Sunday June 23, 2024 at 10:30 am",
    ],
    actionItems: [
      { text: "CC Mohammed ALALLOUSH on all future NUGSS communication", assignee: "Bruce Danesh", done: false },
      { text: "Send extraordinary AGM announcement to NUGSS for distribution to students", done: false },
      { text: "Announce AGM on OTE website and request NUGSS email blast", assignee: "Mohammed ALALLOUSH", done: false },
      { text: "Finalize updated bylaws and present at the extraordinary AGM", assignee: "Ahmad Jalil", done: false },
      { text: "Add Ahmad Jalil and Bruce Danesh to office security access list", assignee: "Mohammed ALALLOUSH", done: false },
      { text: "Explore creating an official UNBC email for OTE", assignee: "Ahmad Jalil", done: false },
    ],
  },

  {
    scheduledAt: "2024-07-08T20:30:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — July 8, 2024",
    location: "Online",
    electronic: true,
    attendees: [
      "Bruce Danesh",
      "Ahmad Jalil",
      "Anhelina Maksymova",
      "Abdullah Nahhas",
      "Nahid Yari",
      "Mohammed ALALLOUSH",
    ],
    files: [
      {
        relPath: "2024-2025/July/July 8, OTE-meeting-minutes-May 13th -2024.docx",
        title: "OTE Board Meeting Minutes — July 8, 2024",
      },
    ],
    notes:
      "Source filename references 'May 13th' but content is the July 8, 2024 meeting (likely template-derived).",
    discussion:
      "Mohammed ALALLOUSH (EIC) gave the land acknowledgement. Called to order by Bruce Danesh at 8:30 pm. Updates on NUGSS communication regarding OTE status and bylaws; recommended bylaws approved. Reaffirmed plan to call an extraordinary AGM to formally elect the current board and address issues from the previous AGM (announcement at least 14 days in advance, quorum requirements emphasised). Ahmad Jalil presented updated bylaws addressing graduate-student membership, a non-student supporter category, and revised election procedures. Discussed using the OTE office for writer and board interviews. Discussed setting up an official UNBC email account in lieu of the existing Gmail. Anhelina presented logo rebrand options.",
    motions: [],
    decisions: [
      "Hold an extraordinary AGM to elect the current board",
      "Adopt the recommended bylaws presented by Ahmad Jalil",
    ],
    actionItems: [
      { text: "Ensure future NUGSS communication CC's Mohammed ALALLOUSH (over.the.edge.unbc@gmail.com)", assignee: "Bruce Danesh", done: false },
      { text: "Announce extraordinary AGM through NUGSS to students", done: false },
      { text: "Announce AGM on OTE website", assignee: "Mohammed ALALLOUSH", done: false },
      { text: "Finalize updated bylaws for the extraordinary AGM", assignee: "Ahmad Jalil", done: false },
    ],
  },

  {
    scheduledAt: "2024-07-23T18:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — July 23, 2024 (transcript-only placeholder)",
    location: "Online",
    electronic: true,
    attendees: [],
    files: [
      {
        relPath: "Over the Edge July 23.whisper",
        title: "OTE Board Meeting Whisper Transcript — July 23, 2024",
        category: "Other",
      },
    ],
    notes:
      "Placeholder meeting created from a Whisper-app transcript zip. Attendees, motions, and decisions still need to be parsed from the transcript and approved by reviewer.",
    discussion:
      "Source is a Whisper.app transcript export (.whisper zip containing transcripts JSON + audio). Content not yet parsed into structured discussion. Review transcript and update this minutes record with attendance, decisions, and action items.",
    motions: [],
    decisions: [],
    actionItems: [
      { text: "Parse Whisper transcript into structured minutes (attendees, motions, decisions, action items)", done: false },
    ],
    quorumMet: false,
    draftTranscript:
      "[Whisper.app transcript zip — see attached source document. Extract transcript JSON and replace this placeholder.]",
  },

  {
    scheduledAt: "2024-09-09T20:30:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — September 9, 2024",
    location: "Online",
    electronic: true,
    attendees: [
      "Bruce Danesh",
      "Ahmad Jalil",
      "Anhelina Maksymova",
    ],
    files: [
      {
        relPath: "2024-2025/Over the Edge (OTE) Board Meeting Minutes Sep 9th.docx",
        title: "OTE Board Meeting Minutes — September 9, 2024",
      },
    ],
    discussion:
      "Bruce Danesh acknowledged the territory of the Lheidli T'enneh and called the meeting to order at 8:30 pm. Acting EIC Ahmad Jalil reported on the Prince George Citizen publication deal, publishing schedule (target first week of each month), C-FUR audio collaboration possibility, banking onboarding (Bruce/Ahmad signed up; Abdullah next day; awaiting account access for capital projects and PG Citizen payments), and a new article submission form with consent disclaimers feeding a SharePoint list. Website updates: Get Involved page, payment tier info, /submissions page, WhatsApp join button. Office access: tap-system upgrade ($1,500) postponed pending NBCGSS office decision. Equipment: agreed to purchase a new staff computer (current Macs from 2012). Reviewed writer payment cap structure. Anhelina to update poster with one WhatsApp QR + website link, and produce board group photo. Ahmad to set up social media as 'Over the Edge Board Members' for transferability and grant Anhelina access. Discussed potential collaborations with NUGSS, NBCGSS, FNC, Timberwolf. Meetings to be held biweekly. Adjourned at 9:36 pm.",
    motions: [
      {
        text: "Purchase a new computer for the OTE office for staff use",
        movedBy: "Bruce Danesh",
        secondedBy: "Ahmad Jalil",
        outcome: "Carried",
      },
      {
        text: "Motion to adjourn",
        movedBy: "Ahmad Jalil",
        secondedBy: "Anhelina Maksymova",
        outcome: "Carried",
      },
    ],
    decisions: [
      "Approved purchase of a new staff computer for the OTE office",
      "Postpone tap-access office upgrade pending NBCGSS office allocation outcome",
      "Move to biweekly board meetings",
      "Aim for first week of each month for publication",
    ],
    actionItems: [
      { text: "Follow up with Gordon Kennedy on publication dates, templates/policies, and printing schedule", assignee: "Ahmad Jalil", done: false },
      { text: "Draft writer message about submission deadline and link", assignee: "Ahmad Jalil", done: false },
      { text: "Create board group photo and update poster with new info and links", assignee: "Anhelina Maksymova", done: false },
      { text: "Set up 'Over the Edge Board Members' social media accounts and grant Anhelina access", assignee: "Ahmad Jalil", done: false },
      { text: "Finalize SharePoint list for article submission tracking", assignee: "Ahmad Jalil", done: false },
      { text: "Email UNBC entities including Timberwolf socially; follow up on banking access; set OTE meeting times in OTE email; draft AI use guidance based on UNBC AI policy for the Get Involved page", assignee: "Bruce Danesh", done: false },
    ],
  },

  {
    scheduledAt: "2024-09-23T18:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — September 23, 2024 (Acting EIC update by email)",
    location: "Online",
    electronic: true,
    attendees: ["Bruce Danesh", "Anhelina Maksymova"],
    absent: ["Ahmad Jalil"],
    files: [
      {
        relPath: "2024-2025/September/23/Meeting Minutes.pdf",
        title: "OTE Board Update — September 23, 2024 (Acting EIC absentee report)",
      },
    ],
    notes:
      "Source PDF is an absentee email from Ahmad Jalil to the board summarising recent activity in lieu of his attendance.",
    discussion:
      "Acting Editor-in-Chief Ahmad Jalil could not attend; provided a written update covering: TD Bank account access secured and credit card application under review; Volume 31, Issue 1 finalised (articles, photos, design submitted) — to publish Thursday; office revamp underway and noticeably more usable; possible new hire ($500/month honorarium) if submissions grow; office document scanning complete with archive on Teams (OTEN Archive / Scanned Documents) and digitisation of past articles in progress; Vancity bank account still pending until signing documents are completed.",
    motions: [],
    decisions: [],
    actionItems: [
      { text: "Sign Vancity account documents to finalise account opening", done: false },
      { text: "Publish Volume 31 Issue 1 on schedule (Thursday)", done: false },
    ],
    quorumMet: false,
  },

  {
    scheduledAt: "2024-09-24T18:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — September 24, 2024 (Acting EIC update by email)",
    location: "Online",
    electronic: true,
    attendees: ["Bruce Danesh", "Anhelina Maksymova"],
    absent: ["Ahmad Jalil"],
    files: [
      {
        relPath: "2024-2025/September/24/Meeting Minutes Sep 24.pdf",
        title: "OTE Board Update — September 24, 2024 (Acting EIC absentee report)",
      },
    ],
    notes:
      "Source PDF is an absentee email update from Ahmad Jalil reiterating and expanding the Sep 23 update.",
    discussion:
      "Updated absentee report: TD Bank account access in place, credit card application under review; Vancity documents signed but Abdullah lacks signing authority and follow-up needed. Volume 31 Issue 1 final assets submitted; first production complete with 1,000 copies arriving Thursday; exploring new newsstand locations (Library, Degrees, Student Street, Winter Garden coffee shop). New stand cost ~$80 each; signage needs standardisation. Office and computer upgrade costs reflected in shared Excel. Considering $500/month honorarium for an additional hire if submissions grow. OTE phone line (250-960-5633) accessible on phone and computer. Meeting set with Prince George Citizen on October 2 at 2:30 pm for debrief. Outstanding reimbursements: $80 notary, $33.01 posters, $19.95 Vancity mailing. Considering Canva ($150/yr) and Adobe Creative Cloud (CAD $25.99/mo first year). UNBC payment process initiated for September 30 deposit to TD account.",
    motions: [],
    decisions: [],
    actionItems: [
      { text: "Resolve Vancity signing authority for Abdullah", done: false },
      { text: "Distribute 1,000 copies of Volume 31 Issue 1 on Thursday", done: false },
      { text: "Standardise newsstand signage and source new stands at ~$80 each", done: false },
      { text: "Prepare debrief notes for the October 2 meeting with Prince George Citizen", done: false },
      { text: "Process outstanding reimbursements (notary $80, posters $33.01, Vancity mailing $19.95)", done: false },
    ],
    quorumMet: false,
  },

  {
    scheduledAt: "2024-10-04T13:28:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — October 4, 2024",
    location: "NBCGSS Grad Lounge",
    electronic: false,
    attendees: ["Ahmad Jalil", "Bruce Danesh", "Lina Maksymova"],
    files: [
      {
        relPath: "2024-2025/October/3/OTE Meeting minutes Oct 4 2024.docx",
        title: "OTE Board Meeting Minutes — October 4, 2024",
      },
      {
        relPath: "2024-2025/October/3/University of Northern British Columbia 11.m4a",
        title: "OTE Board Meeting Audio Recording — October 4, 2024",
        category: "Other",
      },
    ],
    notes:
      "Source minutes header reads 'October 4, 2023' but content (Volume 31 Issue 1, 2024-25 publishing schedule) is unambiguously the 2024-10-04 meeting; date corrected on import.",
    agenda: [
      "Bank Account Access and Debit/Credit Cards",
      "Payment for Newspaper",
      "Volume 31, Issue 1 Progress",
      "Office Revamp and Costs",
      "Potential New Hire",
      "Document Scanning and Digitization",
      "Publishing Schedule",
      "OTE Phone Number Access",
      "Expenses to be Reimbursed",
      "Potential Upcoming Costs",
      "Multimedia Tools Discussion",
      "Door Lock Replacement",
      "Obligations for Insurance Renewal",
      "Accounting System Integration",
      "Quesnel Contact for Newspaper Shipping",
      "Team Considerations",
      "Bruce's Practicum Schedule",
      "Editorial and Team Responsibilities",
    ],
    discussion:
      "Banking: Vancity access in place for Ahmad and Bruce; debit cards arriving; TD credit card application in progress (lower priority if Vancity becomes primary). Newspaper payment of $1,800/mo approved for the next 8 months (through April). Volume 31 Issue 1 published successfully. Office revamp totalling $3,963.43 (monitors, Mac Mini, furniture, supplies) approved for reimbursement to Ahmad. Hiring an additional editor tabled. Document scanning complete; old articles being digitised; Ahmad to build publishing pathway. Publishing dates set: Sep 26, Oct 24, Nov 14, Dec 5, Jan 23, Feb 13, Mar 20, Apr 10 (submission deadline end of Tuesday one week prior; Oct 24 deadline = Oct 15). OTE phone line (250-960-5633) accessible. Reimbursed Ahmad $132.96 ($80 notary, $33.01 posters, $19.95 Vancity mailing). Approved subscriptions: Canva (~$150/yr), Adobe Creative Cloud ($25.99/mo first year then $45.99), Claude AI ($28/mo USD + tax). Multimedia (DJI Mic 2, gimbal, Osmo Pocket 2) tabled. Door-lock tap upgrade ~$1,500 awaiting quote; possible NUGSS funding ask. Insurance renewals approved: CGL $1,084 + D&O $850 = $1,934. Wave accounting integration agreed. Quesnel shipping via Julie McRae and Anita Baziuk approved up to $100/campus/issue. Team meal/decoration budgets tabled. Bruce unavailable Nov 4–Dec 6, Feb 10–Mar 21, Mar 31–May 9 (practicums). Editorial guidelines work tabled. Adjourned 1:51 pm.",
    sections: OCT_4_2024_SECTIONS,
    motions: OCT_4_2024_MOTIONS,
    decisions: [
      "Use Wave (free) as accounting system; Ahmad to integrate",
      "Tap-system door upgrade pending official quote and possible NUGSS funding",
      "Defer multimedia tools, team meal budget, decoration/printing budget, and editorial-guidelines work to next meeting",
    ],
    actionItems: OCT_4_2024_ACTION_ITEMS,
    nextMeetingAt: "To be determined",
    nextMeetingNotes:
      "Agenda items for next meeting: Multimedia Tools Purchase Decision; Team Meal Budget Discussion; Decoration and Printing Budget; Editorial Guidelines and Team Responsibilities.",
  },

  {
    scheduledAt: "2024-10-15T18:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — October 15, 2024 (Financial planning)",
    location: "Over the Edge Office, UNBC",
    electronic: false,
    attendees: ["Ahmad Jalil", "Bruce Danesh", "Lina Maksymova"],
    files: [
      {
        relPath: "2024-2025/October/15/Untitled document.pdf",
        title: "OTE Board Meeting Minutes — October 15, 2024 (Financial Planning)",
      },
    ],
    discussion:
      "Financial overview: bookkeeping estimates $300–$450 from Marina, MNP, KPMG. Current semester UNBC income $22,652, next semester estimate $20,000, total annual ~$42,000–$44,000. Yearly expenses ~$17,600 (printing $1,800; insurance $2,000; shipping $100; AI $40; Adobe + Canva $55; bookkeeping $400; submissions $5,200 at $65 × 10/mo × 8 months; additional printing $1,600 at $200 × 8). Net available ~$24,000–$26,400. Proposed board compensation modelled on NUGSS: President $1,600/yr, VP $1,400/yr, Directors at Large $1,200/yr each (board total $6,600/yr). Additional roles: Editor-in-Chief/Publisher (Ahmad) $900/mo × 8 = $7,200; Media Manager (Lina) $250/mo × 8 = $2,000. Board members paid end of each semester (December and April). Office relocation: considering swap with UNBC GSS post-referendum for centrality and visibility; Ahmad to send informal email after referendum and draft justification. Discussed Grammarly subscription value (UNBC GSS pays ~$7,500 USD/yr for 250 students); recommended cancelling in favour of AI alternatives like Claude / ChatGPT / Microsoft Word Editor / reimbursement model. Archive: collaboration with UNBC Archives to digitise past issues, historical TD Bank transactions back to 2016 collected; website now has Archive section with simple button layout. Reviewed 2017 Constitution and bylaws on board compensation — current structure differs and needs updates. Summer planning, NUGSS/UNBC GSS welcome content, possible C4 collaboration discussed.",
    motions: [],
    decisions: [
      "Adopt board compensation model — President $1,600/yr, VP $1,400/yr, Directors $1,200/yr each (total $6,600/yr)",
      "Editor-in-Chief/Publisher honorarium $900/mo × 8; Media Manager honorarium $250/mo × 8",
      "Board paid at end of each semester (December and April)",
      "Recommend cancelling UNBC GSS Grammarly subscription in favour of AI / per-student alternatives",
    ],
    actionItems: [
      { text: "Draft and approve new compensation structure for board members and additional roles", done: false },
      { text: "Update policies to reflect new operational structure", done: false },
      { text: "Create a justification statement for potential office relocation", done: false },
      { text: "Send informal inquiry about office space switch to UNBC GSS after referendum", assignee: "Ahmad Jalil", done: false },
      { text: "Continue work on website archive section", done: false },
      { text: "Reach out to partner organisations for future content contributions", done: false },
      { text: "Investigate Grammarly alternatives for UNBC GSS", done: false },
      { text: "Finalise bookkeeping arrangements (Marina / MNP / KPMG estimates)", done: false },
      { text: "Update contact information for other UNBC campuses", done: false },
    ],
  },

  {
    scheduledAt: "2025-03-31T18:00:00-07:00",
    type: "AGM",
    title: "OTE Annual General Meeting — March 31, 2025",
    location: "Online / NUGSS April Price Board Room",
    electronic: true,
    attendees: [
      "Behrouz (Bruce) Danesh",
      "Ahmad Jalil",
      "Lina Maksymova",
      "Nahid Yari",
      "Paul Peng",
      "Parniya Peykamiyan",
      "Amir Etminanrad",
      "Caleb Mueller",
    ],
    files: [
      { relPath: "AGM/March 2025/AGM Minutes OTE.docx", title: "OTE AGM Minutes — March 31, 2025", category: "Minutes" },
      { relPath: "AGM/March 2025/Agenda.docx", title: "OTE AGM Agenda — March 31, 2025", category: "Other" },
      { relPath: "AGM/March 2025/Changes.docx", title: "OTE AGM Proposed Bylaw Amendments — March 31, 2025", category: "Bylaws" },
      { relPath: "AGM/March 2025/Participant List.docx", title: "OTE AGM Participant List — March 31, 2025", category: "Other" },
      { relPath: "AGM/March 2025/Screenshot 2025-03-31 at 9.55.29\u202fPM.png", title: "OTE AGM Screenshot — March 31, 2025", category: "Other" },
    ],
    agenda: [
      "Land acknowledgement",
      "Call to order",
      "Approval of agenda",
      "Approval of previous AGM minutes (Feb 21, 2024)",
      "Reports (EIC / Financial / Social Media)",
      "Special resolutions: bylaw amendments (membership, alumni, board structure, role flexibility)",
      "Election of new board",
      "Adjournment",
    ],
    discussion:
      "AGM opened with land acknowledgement and called to order by Bruce Danesh, President. Roll call confirmed quorum (8 members, minimum 3). Agenda approved (motion: Bruce / Lina, carried). Reviewed Editor-in-Chief, Financial Statement, and Social Media reports. Considered special resolutions to amend bylaws: (1) Section 2.1(a) updated to include all UNBC students (removing 'undergraduate'); (2) new Section 2.1(d) allowing UNBC alumni as ordinary members; (3) streamlined board structure with flexible role assignments. Bylaw amendments reviewed against rationale (inclusivity, alignment with peer student societies such as CFUR, governance flexibility while maintaining clear leadership). Election of new board conducted. See attached Agenda, Changes (proposed amendments) and Participant List documents for the full record.",
    motions: [
      { text: "Approve the agenda as presented", movedBy: "Bruce", secondedBy: "Lina", outcome: "Carried" },
      { text: "Approve the minutes from the AGM held on February 21, 2024", outcome: "Carried" },
      { text: "Amend Section 2.1(a) to include all UNBC students (removing 'undergraduate')", outcome: "Carried", resolutionType: "Special" },
      { text: "Add Section 2.1(d) to allow UNBC alumni to become ordinary members", outcome: "Carried", resolutionType: "Special" },
    ],
    decisions: [
      "Bylaw amendments adopted: membership extended to all UNBC students and to alumni; board structure streamlined with flexible role assignments",
      "New board elected (see participant list and minutes attachment)",
    ],
    actionItems: [
      { text: "File adopted bylaw amendments with BC Registries", done: false },
      { text: "Update OTE website and member-facing materials with new membership eligibility", done: false },
    ],
  },

  {
    scheduledAt: "2025-04-04T15:00:00-07:00",
    type: "Board",
    title: "OTE Board Meeting — April 4, 2025 (New board onboarding)",
    location: "Over the Edge Office, UNBC",
    electronic: false,
    attendees: ["Ahmad Jalil", "Lina Maksymova", "Nahid Yari", "Parniya Peykamiyan"],
    absent: ["Bruce Danesh"],
    files: [
      {
        relPath: "2025-2026/Apr 4/Apr 4.docx",
        title: "OTE Board Meeting Notes — April 4, 2025",
      },
    ],
    notes:
      "Source document header reads 'April 4, 2023' but content (post-March 2025 AGM board incl. Parniya as new member, end-of-semester April issue, ~$8,000 summer budget) is unambiguously April 4, 2025; date corrected on import.",
    discussion:
      "Onboarding meeting for new board member. Recently completed April issue (semester's last) ready for distribution next week. Tax calculations being completed before end of April to resolve issues from previous leadership. Approximately $8,000 remaining budget for summer projects. Confirmed organisational structure: board members hold both director positions and specialised roles (Ahmad: EIC and VP; Lina: Media Manager; Nahid: Social Media Manager; all also general directors). Summer projects discussed: Microsoft Teams backup server (TBD); potential summer work for Lina and Nahid (~$2,000 each). Adjourned at 3:41 pm.",
    motions: [],
    decisions: [
      "Confirm board roles for incoming term: Ahmad (EIC/VP), Lina (Media Manager), Nahid (Social Media Manager), all also general directors",
    ],
    actionItems: [
      { text: "Distribute April issue next week", done: false },
      { text: "Complete tax calculations before end of April", assignee: "Ahmad Jalil", done: false },
      { text: "Scope Microsoft Teams backup server build", done: false },
      { text: "Plan summer work allocations (~$2,000 each for Lina and Nahid)", done: false },
    ],
  },
];

const onlyDate = process.argv[2];
const target = onlyDate
  ? MEETINGS.filter((m) => m.scheduledAt.startsWith(onlyDate))
  : MEETINGS;
let ok = 0;
let failed = 0;
for (const meeting of target) {
  try {
    await importMeeting(meeting);
    ok += 1;
  } catch (err) {
    failed += 1;
    console.error(`   ✗ failed: ${meeting.title}`);
    console.error(err);
  }
}

console.log(`\nDone. Imported ${ok} meeting${ok === 1 ? "" : "s"}; failed ${failed}.`);
