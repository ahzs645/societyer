/** meetingMinutes record (design §4.3): the minutes spine. */
import { z } from "zod";
import { fieldValue, FvBoolean, FvDate, FvNumber, FvPersonRef, FvString, FvTime, Locator, RECORD_STATUSES } from "./common";

export const MEETING_MINUTES_SCHEMA_VERSION = "meetingMinutes/1";

export const BODY_KINDS = ["board", "executive", "operations", "committee", "agm", "sgm", "members", "joint", "unknown"] as const;
export const MEETING_TYPES = ["regular", "annual_general", "special_general", "committee", "special", "in_camera", "joint", "workshop", "unknown"] as const;
export const ATTENDANCE_CATEGORIES = ["present", "regrets", "absent", "staff", "guest", "proxy", "unlabelled"] as const;
export const MOTION_OUTCOMES = ["carried", "defeated", "tabled", "withdrawn", "deferred", "no_quorum", "unknown"] as const;

export const AttendanceEntry = z.object({
  nameAsWritten: FvString,
  category: fieldValue(z.enum(ATTENDANCE_CATEGORIES)),
  role: FvString.optional(),
  affiliation: FvString.optional(),
  proxyFor: FvString.optional(),
  arrivalOrLeave: FvString.optional(),
  /** Run-level identity (stage 7): the people-directory key this entry resolved to. */
  personKey: z.string().optional(),
});
export type AttendanceEntry = z.infer<typeof AttendanceEntry>;

export const QuorumRecord = z.object({
  stated: fieldValue(z.enum(["met", "not_met", "not_recorded"])),
  count: FvNumber.optional(),
  checkpoints: z.array(z.object({ text: z.string(), locators: z.array(Locator) })).optional(),
});

export const MinutesSection = z.object({
  number: FvString.optional(),
  title: FvString,
  presenter: FvPersonRef.optional(),
  /** Verbatim discussion as span references, not paraphrase. */
  discussion: z.array(Locator).optional(),
  reportRefs: z.array(FvString).optional(),
});

export const MotionRecord = z.object({
  text: FvString,
  movedBy: FvPersonRef.optional(),
  secondedBy: FvPersonRef.optional(),
  outcome: fieldValue(z.enum(MOTION_OUTCOMES)),
  votes: fieldValue(z.object({ for: z.number().int().optional(), against: z.number().int().optional(), abstain: z.number().int().optional() })).optional(),
  byConsensus: FvBoolean.optional(),
  resolutionType: fieldValue(z.enum(["ordinary", "special", "unanimous", "unknown"])).optional(),
  adoptsMinutesOf: fieldValue(z.object({ date: z.string().optional(), precision: z.string().optional(), body: z.string().optional(), text: z.string() })).optional(),
  adoptsPolicy: FvString.optional(),
  adoptsAgenda: FvBoolean.optional(),
  ratifies: FvString.optional(),
  conditional: FvBoolean.optional(),
  sectionRef: FvString.optional(),
});
export type MotionRecord = z.infer<typeof MotionRecord>;

export const ActionItemRecord = z.object({
  text: FvString,
  assigneeAsWritten: FvString.optional(),
  due: FvDate.optional(),
  statusAsWritten: FvString.optional(),
  carriedFromRef: FvString.optional(),
  sectionRef: FvString.optional(),
});
export type ActionItemRecord = z.infer<typeof ActionItemRecord>;

export const MeetingMinutesRecord = z.object({
  title: FvString.optional(),
  organizationName: FvString.optional(),
  body: fieldValue(z.enum(BODY_KINDS)),
  bodyLabel: FvString.optional(),
  meetingType: fieldValue(z.enum(MEETING_TYPES)),
  date: FvDate,
  startTime: FvTime.optional(),
  endTime: FvTime.optional(),
  location: FvString.optional(),
  electronic: FvBoolean.optional(),
  recordStatus: fieldValue(z.enum(RECORD_STATUSES)),
  chair: FvPersonRef.optional(),
  recorder: FvPersonRef.optional(),
  calledToOrderAt: FvTime.optional(),
  adjournedAt: FvTime.optional(),
  attendance: z.array(AttendanceEntry),
  quorum: QuorumRecord.optional(),
  sections: z.array(MinutesSection),
  motions: z.array(MotionRecord),
  decisions: z.array(FvString).optional(),
  actionItems: z.array(ActionItemRecord),
  nextMeeting: fieldValue(z.object({ date: z.string().optional(), time: z.string().optional(), location: z.string().optional(), body: z.string().optional(), text: z.string() })).optional(),
  attachmentsReferenced: z.array(FvString).optional(),
  sessionSegments: z.array(fieldValue(z.object({ type: z.enum(["in_camera", "recess", "other"]), title: z.string().optional() }))).optional(),
});
export type MeetingMinutesRecord = z.infer<typeof MeetingMinutesRecord>;
